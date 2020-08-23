import { FilterQuery } from 'mongoose';

export type SchemaIndex = [Record<string, any>, Record<string, any>];

export type ModelMetadata = {
  modelName: string;
  fields: Set<string>;
  indices: string[][];
};

export interface ViolatingQuery {
  modelName: string;
  violatingFields: string[];
  comment?: string;
  fullQuery: FilterQuery<any>;
}

export class InvalidField extends Error {
}

export class LowIndexCoverage extends Error {
}

interface BaseCheckHandler {
  // If warning is enabled, this function will be run.
  warnAction?: (query: ViolatingQuery) => void;
  // If error throwing is enabled, the message returned
  // by this function will be thrown out.
  throwMessage?: (query: ViolatingQuery) => string;
}

export interface FieldCheckHandler extends BaseCheckHandler {
}

export interface IndexCheckHandler extends BaseCheckHandler {
  // A floating number as the percentage of minimum required index coverage
  minCoverage: number;
}

export interface FullSafeQueryOptions {
  shouldWarn: () => boolean;
  shouldThrow: () => boolean;
  checkField: FieldCheckHandler;
  checkIndex: IndexCheckHandler;
}

export type SafeQueryOptions = Partial<FullSafeQueryOptions>;

function defaultFieldWarningHandler(query: ViolatingQuery): void {
  // eslint-disable-next-line no-console
  console.warn(`Invalid query fields in ${query.modelName}: ${query.violatingFields.join(', ')}`);
}

function defaultIndexWarningHandler(query: ViolatingQuery): void {
  // eslint-disable-next-line no-console
  console.warn(
    `Insufficient index coverage in ${query.modelName}: ${query.violatingFields.join(', ')}`,
  );
}

export const DEFAULT_OPTIONS: FullSafeQueryOptions = {
  shouldWarn: () => true,
  shouldThrow: () => false,
  checkField: {
    warnAction: defaultFieldWarningHandler,
  },
  checkIndex: {
    minCoverage: 0.5,
    warnAction: defaultIndexWarningHandler,
  },
};
