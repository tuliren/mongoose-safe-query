import { expect } from 'chai';
import { FilterQuery } from 'mongoose';
import { Project } from './setupSchema';
import { QUERY_MIDDLEWARES } from '../src/safeQuery';
import { DEFAULT_OPTIONS, InvalidField, SafeQuery } from '../src';
import { safeQuery } from './setupPlugin';

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

// Update methods requires a second argument for the $set operator.
// Otherwise the first argument becomes $set operation, and there won't
// be any filter statement at all.
const updateMiddlewares = ['findOneAndUpdate', 'update', 'updateOne', 'updateMany'];

describe('SafeQuery', () => {
  after(() => {
    safeQuery
      .setWarnCondition(DEFAULT_OPTIONS.shouldWarn)
      .setThrowCondition(DEFAULT_OPTIONS.shouldThrow)
      .setFieldCheckHandler({ warnAction: DEFAULT_OPTIONS.checkField.warnAction })
      .setIndexCheckHandler({
        warnAction: DEFAULT_OPTIONS.checkIndex.warnAction,
        minCoverage: DEFAULT_OPTIONS.checkIndex.minCoverage,
      });
  });

  describe('getMetadata', () => {
    it('returns model metadata from a model', async () => {
      // @ts-ignore-next-line
      const metadata = safeQuery.getMetadata(Project);
      expect(metadata.modelName).to.equal('project');
      expect(Array.from(metadata.fields)).to.include.members(['_id', 'name', 'createdAt']);
      expect(metadata.indices).to.include.deep.members([['_id'], ['name'], ['createdAt']]);
    });
  });

  describe('update options', () => {
    it('updates warn condition', async () => {
      safeQuery.setWarnCondition(() => true);
      expect(safeQuery.shouldWarn()).to.be.true;

      safeQuery.setWarnCondition(() => false);
      expect(safeQuery.shouldWarn()).to.be.false;

      safeQuery.setWarnCondition(true);
      expect(safeQuery.shouldWarn()).to.be.true;

      safeQuery.setWarnCondition(false);
      expect(safeQuery.shouldWarn()).to.be.false;
    });

    it('updates throw condition', async () => {
      safeQuery.setThrowCondition(() => true);
      expect(safeQuery.shouldThrow()).to.be.true;

      safeQuery.setThrowCondition(() => false);
      expect(safeQuery.shouldThrow()).to.be.false;

      safeQuery.setThrowCondition(true);
      expect(safeQuery.shouldThrow()).to.be.true;

      safeQuery.setThrowCondition(false);
      expect(safeQuery.shouldThrow()).to.be.false;
    });
  });

  describe('getRootQueryFields', () => {
    interface TestCase {
      name: string;
      query: FilterQuery<any>;
      fields: string[];
    }

    const testCases: Array<TestCase> = [
      { name: 'empty query', query: {}, fields: [] },
      { name: '_id query', query: { _id: '123' }, fields: ['_id'] },
      {
        name: 'plain query',
        query: { createdAt: '2020-09-09', customer: 'bee' },
        fields: ['createdAt', 'customer'],
      },
      {
        name: 'nested query 1',
        query: { customer: { alias: 'bee' } },
        fields: ['customer'],
      },
      {
        name: 'nested query 2',
        query: { 'customer.alias': 'bee' },
        fields: ['customer'],
      },
      {
        name: 'nested query 3',
        query: { 'customer.alias': 'bee', 'customer.id': '1009' },
        fields: ['customer'],
      },
      {
        name: '$and query',
        query: { $and: [{ createdAt: '2020-09-09' }, { customer: 'bee' }] },
        fields: ['createdAt', 'customer'],
      },
      {
        name: '$or query',
        query: { $or: [{ createdAt: '2020-09-09' }, { createdAt: { $gt: '2021-01-01' } }] },
        fields: ['createdAt'],
      },
      {
        name: '$nor query',
        query: { $nor: [{ price: 1.99 }, { sale: true }] },
        fields: ['price', 'sale'],
      },
      {
        name: 'complex query',
        query: {
          $or: [
            { $and: [{ 'customer.alias': 'bee' }, { createdAt: '2020-09-09' }] },
            { $nor: [{ location: 'U.S.' }, { status: 'in progress' }] },
            { batch: 'abc' },
          ],
        },
        fields: ['customer', 'createdAt', 'location', 'status', 'batch'],
      },
      {
        name: 'query with _bsontype',
        // The query will look like this if an ObjectId is passed into
        // find or findOne method directly, which actually works...
        query: {
          _bsontype: 'ObjectID',
          id: {
            data: [95, 59, 16, 39, 138, 200, 59, 0, 30, 49, 68, 252],
            type: Buffer,
          },
        },
        fields: ['id'],
      },
    ];

    testCases.forEach(({ name, query, fields }) => {
      it(`returns root query fields for ${name}`, async () => {
        // @ts-ignore-next-line
        expect(SafeQuery.getRootQueryFields(query)).have.members(fields);
      });
    });
  });

  describe('getNonExistingFields', () => {
    interface TestCase {
      queryFields: string[];
      modelFields: Set<string>;
      nonExistingFields: string[];
    }

    const testCases: Array<TestCase> = [
      {
        queryFields: ['_id', 'createdAt'],
        modelFields: new Set<string>(['_id', 'createdAt', 'customer']),
        nonExistingFields: [],
      },
      {
        queryFields: ['_id', 'createdAt'],
        modelFields: new Set<string>(['_id']),
        nonExistingFields: ['createdAt'],
      },
    ];

    testCases.forEach(({ queryFields, modelFields, nonExistingFields }, index) => {
      it(`[test case ${index}] returns non existing fields`, async () => {
        // @ts-ignore-next-line
        expect(SafeQuery.getNonExistingFields(queryFields, modelFields)).have.members(
          nonExistingFields,
        );
      });
    });
  });

  describe('isCoveredByIndex', () => {
    interface TestCase {
      queryFields: string[];
      indices: string[][];
      minCoverage: number;
      isCovered: boolean;
    }

    const testCases: Array<TestCase> = [
      {
        queryFields: ['_id', 'createdAt'],
        indices: [['createdAt', '_id']],
        minCoverage: 1,
        isCovered: true,
      },
      {
        queryFields: ['_id', 'createdAt'],
        indices: [['_id']],
        minCoverage: 1,
        isCovered: false,
      },
      {
        queryFields: ['_id', 'createdAt'],
        indices: [['_id']],
        minCoverage: 0.5,
        isCovered: true,
      },
      // This plugin only checks the root field. So this case will pass.
      {
        queryFields: ['customer'],
        indices: [['customer.name', 'customer.id']],
        minCoverage: 1,
        isCovered: true,
      },
      {
        queryFields: ['customer', 'customer'],
        indices: [['customer.name', 'customer.id']],
        minCoverage: 1,
        isCovered: true,
      },
    ];

    testCases.forEach(({ queryFields, indices, minCoverage, isCovered }, index) => {
      it(`[test case ${index}] returns query coverage verdict`, async () => {
        // @ts-ignore-next-line
        expect(SafeQuery.isCoveredByIndex(queryFields, indices, minCoverage)).to.equal(isCovered);
      });
    });
  });

  describe('field check', () => {
    const validQuery = { name: 'test_project' };
    const invalidQuery = { invalidField: true };
    let warningMessages: string[] = [];

    describe('warning', () => {
      beforeEach(() => {
        warningMessages = [];
        safeQuery
          .clearWarnedFieldQueries()
          .setWarnCondition(() => true)
          .setThrowCondition(() => false)
          .setFieldCheckHandler({
            warnAction: () => {
              warningMessages.push('invalid field');
            },
          })
          .setIndexCheckHandler({
            warnAction: () => {},
          });
      });

      QUERY_MIDDLEWARES.forEach(method => {
        it(`[${method}] does not warn about valid query`, async () => {
          if (updateMiddlewares.includes(method)) {
            // @ts-ignore-next-line
            await Project[method](validQuery, { $set: { arbitraryField: true } });
          } else {
            // @ts-ignore-next-line
            await Project[method](validQuery);
          }
          expect(warningMessages.length).to.equal(0);
        });

        it(`[${method}] warns about invalid field only once`, async () => {
          for (let i = 1; i <= 2; ++i) {
            if (updateMiddlewares.includes(method)) {
              // @ts-ignore-next-line
              await Project[method](invalidQuery, { $set: { arbitraryField: true } });
            } else {
              // @ts-ignore-next-line
              await Project[method](invalidQuery);
            }
            expect(warningMessages.length).to.equal(1);
          }
        });
      });
    });

    describe('throw', () => {
      beforeEach(() => {
        safeQuery
          .setWarnCondition(() => false)
          .setThrowCondition(() => true)
          .setFieldCheckHandler({
            throwMessage: () => 'invalid field',
          })
          .setIndexCheckHandler({
            throwMessage: () => '',
          });
      });

      QUERY_MIDDLEWARES.forEach(method => {
        it(`[${method}] does not throw for valid query`, async () => {
          if (updateMiddlewares.includes(method)) {
            await expect(
              // @ts-ignore-next-line
              Project[method](validQuery, { $set: { arbitraryField: true } }),
            ).to.eventually.not.be.rejected;
          } else {
            // @ts-ignore-next-line
            await expect(Project[method](validQuery)).to.eventually.not.be.rejected;
          }
        });

        it(`[${method}] throws for invalid field`, async () => {
          if (updateMiddlewares.includes(method)) {
            await expect(
              // @ts-ignore-next-line
              Project[method](invalidQuery, { $set: { arbitraryField: true } }),
            ).to.eventually.be.rejectedWith(InvalidField);
          } else {
            // @ts-ignore-next-line
            await expect(Project[method](invalidQuery)).to.eventually.be.rejectedWith(InvalidField);
          }
        });
      });
    });
  });

  /**
   * These unit tests rely on this index on the project model: { name: 1 }
   */
  describe('index check', () => {
    const query = {
      name: 'test_project',
      uncoveredField: true,
    };
    let warningMessages: string[] = [];

    describe('warning', () => {
      beforeEach(() => {
        warningMessages = [];
        safeQuery
          .clearWarnedIndexQueries()
          .setWarnCondition(() => true)
          .setThrowCondition(() => false)
          .setFieldCheckHandler({
            warnAction: () => {},
          })
          .setIndexCheckHandler({
            warnAction: () => {
              warningMessages.push('insufficient index coverage');
            },
          })
          ;
      });

      QUERY_MIDDLEWARES.forEach(method => {
        it(`[${method}] does not warn about query with sufficient index coverage`, async () => {
          safeQuery.setIndexCheckHandler({ minCoverage: 0.5 });

          if (updateMiddlewares.includes(method)) {
            // @ts-ignore-next-line
            await Project[method](query, { $set: { arbitraryField: true } });
          } else {
            // @ts-ignore-next-line
            await Project[method](query);
          }
          expect(warningMessages.length).to.equal(0);
        });

        it(`[${method}] warns about query without sufficient index coverage only once`, async () => {
          safeQuery.setIndexCheckHandler({ minCoverage: 0.55 });

          for (let i = 1; i <= 2; ++i) {
            if (updateMiddlewares.includes(method)) {
              // @ts-ignore-next-line
              await Project[method](query, { $set: { arbitraryField: true } });
            } else {
              // @ts-ignore-next-line
              await Project[method](query);
            }
            expect(warningMessages.length).to.equal(1);
          }
        });
      });
    });

    describe('throw', () => {
      beforeEach(() => {
        safeQuery
          .setWarnCondition(() => false)
          .setThrowCondition(() => true)
          .setFieldCheckHandler({
            throwMessage: () => '',
          })
          .setIndexCheckHandler({
            throwMessage: () => 'insufficient index coverage',
          });
      });

      QUERY_MIDDLEWARES.forEach(method => {
        it(`[${method}] does not throw for query with sufficient index coverage`, async () => {
          safeQuery.setIndexCheckHandler({ minCoverage: 0.5 });

          if (updateMiddlewares.includes(method)) {
            await expect(
              // @ts-ignore-next-line
              Project[method](query, { $set: { arbitraryField: true } }),
            ).to.eventually.not.be.rejected;
          } else {
            // @ts-ignore-next-line
            await expect(Project[method](query)).to.eventually.not.be.rejected;
          }
        });

        it(`[${method}] throws for query without sufficient index coverage`, async () => {
          safeQuery.setIndexCheckHandler({ minCoverage: 0.55 });

          if (updateMiddlewares.includes(method)) {
            await expect(
              // @ts-ignore-next-line
              Project[method](query, { $set: { arbitraryField: true } }),
            ).to.eventually.be.rejectedWith(InvalidField);
          } else {
            // @ts-ignore-next-line
            await expect(Project[method](query)).to.eventually.be.rejectedWith(InvalidField);
          }
        });
      });
    });
  });
});
