import crypto from 'crypto';
import { FilterQuery, HookNextFunction, Model, Schema } from 'mongoose';
import _ from 'lodash';
import {
  DEFAULT_OPTIONS,
  FieldCheckHandler,
  FullSafeQueryOptions,
  IndexCheckHandler,
  InvalidField,
  LowIndexCoverage,
  ModelMetadata,
  SafeQueryOptions,
  SchemaIndex,
  ViolatingQuery,
} from './types';

const SUPPORTED_QUERY_SELECTORS = ['$and', '$nor', '$or'];

// https://mongoosejs.com/docs/middleware.html#types-of-middleware
export const QUERY_MIDDLEWARES: string[] = [
  'count',
  'deleteMany',
  'deleteOne',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndRemove',
  'findOneAndUpdate',
  'remove',
  'update',
  'updateOne',
  'updateMany',
];

// These are document middlewares by default. To register a query pre hook,
// specify { query: true, document: false }.
const DEFAULT_MODEL_MIDDLEWARES = ['remove'];

export const FIELDS_TO_IGNORE = ['_bsontype'];

export class SafeQuery {
  private modelMetadataMap: Map<string, ModelMetadata>;
  private warnedFieldQueries: Set<string>;
  private warnedIndexQueries: Set<string>;
  private options: FullSafeQueryOptions;

  constructor(options: SafeQueryOptions = DEFAULT_OPTIONS) {
    this.modelMetadataMap = new Map<string, ModelMetadata>();
    this.warnedFieldQueries = new Set<string>();
    this.warnedIndexQueries = new Set<string>();
    this.options = _.defaultsDeep({}, options, DEFAULT_OPTIONS);
  }

  private getMetadata(model: Model<any>): ModelMetadata {
    const modelName = model.modelName;
    const existingMetadata = this.modelMetadataMap.get(modelName);
    if (existingMetadata) {
      return existingMetadata;
    }

    const schema: Schema = model.schema;
    const schemaIndexes: SchemaIndex[] = schema.indexes();
    const newMetadata: ModelMetadata = {
      modelName,
      fields: new Set<string>(Object.keys(_.get(schema, 'tree'))),
      indices: schemaIndexes.map((a: SchemaIndex) => Object.keys(a[0])).concat([['_id']]),
    };
    this.modelMetadataMap.set(modelName, newMetadata);
    return newMetadata;
  }

  public shouldWarn(): boolean {
    return this.options.shouldWarn();
  }

  public setWarnCondition(warnCondition: boolean | (() => boolean)): this {
    if (typeof warnCondition === 'boolean') {
      this.options.shouldWarn = () => warnCondition;
    } else {
      this.options.shouldWarn = warnCondition;
    }
    return this;
  }

  public shouldThrow(): boolean {
    return this.options.shouldThrow();
  }

  public setThrowCondition(throwCondition: boolean | (() => boolean)): this {
    if (typeof throwCondition === 'boolean') {
      this.options.shouldThrow = () => throwCondition;
    } else {
      this.options.shouldThrow = throwCondition;
    }
    return this;
  }

  public setFieldCheckHandler(fieldCheckHandler: Partial<FieldCheckHandler>): this {
    this.options.checkField = _.defaults(fieldCheckHandler, this.options.checkField);
    return this;
  }

  public setIndexCheckHandler(indexCheckHandler: Partial<IndexCheckHandler>): this {
    this.options.checkIndex = _.defaults(indexCheckHandler, this.options.checkIndex);
    return this;
  }

  public clearWarnedFieldQueries(): this {
    this.warnedFieldQueries = new Set<string>();
    return this;
  }

  public clearWarnedIndexQueries(): this {
    this.warnedIndexQueries = new Set<string>();
    return this;
  }

  public getPlugin(): (inputSchema: Schema) => any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const instance = this;

    return function (schema: Schema) {
      if (!instance.options.checkField && !instance.options.checkIndex) {
        return;
      }

      const checkQueryFn = function <T extends FilterQuery<any>>(
        this: T,
        next: HookNextFunction,
      ): void {
        const queryConditions = this._conditions;
        if (!queryConditions) {
          return next();
        }
        const queryFields = SafeQuery.getRootQueryFields(queryConditions);
        if (queryFields.length === 0) {
          return next();
        }

        const model = this.model;
        const modelMetadata = instance.getMetadata(model);
        const queryOptions = this.options;
        if (instance.options.checkField) {
          instance.checkField(modelMetadata, queryConditions, queryFields, queryOptions, next);
        }
        if (instance.options.checkIndex) {
          instance.checkIndex(modelMetadata, queryConditions, queryFields, queryOptions, next);
        }
        return next();
      };

      for (const queryMiddleware of QUERY_MIDDLEWARES) {
        if (DEFAULT_MODEL_MIDDLEWARES.includes(queryMiddleware)) {
          // Type definition of pre method:
          // https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/mongoose/index.d.ts#L1002
          // This definition is wrong according to the notes in
          // https://mongoosejs.com/docs/middleware.html#types-of-middleware
          // The second parameter for certain middleware specifies where to register the hook.
          // @ts-ignore-next-line
          schema.pre(queryMiddleware, { query: true, document: false }, checkQueryFn);
        } else {
          schema.pre(queryMiddleware, checkQueryFn);
        }
      }
    };
  }

  private checkField(
    modelMetadata: ModelMetadata,
    queryConditions: FilterQuery<any>,
    queryFields: string[],
    queryOptions: any,
    next: HookNextFunction,
  ) {
    const violatingFields = SafeQuery.getNonExistingFields(queryFields, modelMetadata.fields);
    if (violatingFields.length === 0) {
      return;
    }

    const violatingQuery: ViolatingQuery = {
      modelName: modelMetadata.modelName,
      violatingFields,
      comment: queryOptions?.comment,
      fullQuery: queryConditions,
    };
    if (this.options.shouldThrow() && this.options.checkField.throwMessage) {
      const message = this.options.checkField.throwMessage(violatingQuery);
      return next(new InvalidField(message));
    }
    if (this.options.shouldWarn() && this.options.checkField.warnAction) {
      const hash = SafeQuery.hash(queryFields).slice(-5);
      const newQuery = !this.warnedFieldQueries.has(hash);
      if (newQuery) {
        this.options.checkField.warnAction(violatingQuery);
        this.warnedFieldQueries.add(hash);
      }
    }
  }

  private checkIndex(
    modelMetadata: ModelMetadata,
    queryConditions: FilterQuery<any>,
    queryFields: string[],
    queryOptions: any,
    next: HookNextFunction,
  ) {
    if (modelMetadata.indices.length === 0 || queryFields.length === 0) {
      return;
    }
    const minCoverage = Math.max(this.options.checkIndex.minCoverage || 0, 0);
    if (SafeQuery.isCoveredByIndex(queryFields, modelMetadata.indices, minCoverage)) {
      return;
    }

    const violatingQuery: ViolatingQuery = {
      modelName: modelMetadata.modelName,
      violatingFields: queryFields,
      comment: queryOptions?.comment,
      fullQuery: queryConditions,
    };
    if (this.options.shouldThrow() && this.options.checkIndex.throwMessage) {
      const message = this.options.checkIndex.throwMessage(violatingQuery);
      return next(new LowIndexCoverage(message));
    }
    if (this.options.shouldWarn() && this.options.checkIndex.warnAction) {
      const hash = SafeQuery.hash(queryFields).slice(-5);
      const newQuery = !this.warnedIndexQueries.has(hash);
      if (newQuery) {
        this.options.checkIndex.warnAction(violatingQuery);
        this.warnedIndexQueries.add(hash);
      }
    }
  }

  private static getRootQueryFields(queryConditions: FilterQuery<any>): string[] {
    const queryFields: Set<string> = new Set<string>();
    for (const [fieldOrOperator, expression] of Object.entries(queryConditions)) {
      if (FIELDS_TO_IGNORE.includes(fieldOrOperator)) {
        continue;
      }

      if (SUPPORTED_QUERY_SELECTORS.includes(fieldOrOperator) && Array.isArray(expression)) {
        // Ignore root query selectors like $text, $where, and $comment.
        for (const subConditions of expression) {
          SafeQuery.getRootQueryFields(subConditions).forEach(f => queryFields.add(f));
        }
      } else if (!fieldOrOperator.startsWith('$')) {
        // Only include root level field.
        const field = fieldOrOperator.split('.')[0];
        queryFields.add(field);
      }
    }
    return Array.from(queryFields);
  }

  /**
   * Return query fields that does not exist in model fields.
   */
  private static getNonExistingFields(queryFields: string[], modelFields: Set<string>): string[] {
    return queryFields.filter(f => !modelFields.has(f));
  }

  private static isCoveredByIndex(
    queryFields: string[],
    indices: string[][],
    minCoverage: number,
  ): boolean {
    const totalFieldCount = queryFields.length;
    const queryFieldSet = new Set<string>(queryFields);
    for (const index of indices) {
      let coveredFieldCount = 0;
      for (const indexField of index) {
        const indexFieldPrefix = indexField.split('.')[0];
        if (queryFieldSet.has(indexFieldPrefix)) {
          coveredFieldCount += 1;
        } else {
          break;
        }
      }
      if (coveredFieldCount / totalFieldCount >= minCoverage) {
        return true;
      }
    }
    return false;
  }

  private static hash(queryFields: string[]): string {
    const sortedFields = _.sortBy(queryFields);
    return crypto.createHash('sha1').update(sortedFields.join('')).digest('base64');
  }
}
