# Mongoose Safe Query

[![build](https://github.com/tuliren/mongoose-safe-query/workflows/build/badge.svg)](https://github.com/tuliren/mongoose-safe-query/actions) [![npm version](https://badge.fury.io/js/mongoose-safe-query.svg)](https://www.npmjs.com/package/mongoose-safe-query)

A mongoose plugin that verifies the fields in a query to ensure that:
- All fields exist in mongoose schema.
- The query has sufficient index coverage.

When there is any violation, you can configure the plugin to run arbitrary code, or throw a customizable message.

## Installation

```sh
npm install mongoose-safe-query
```

## Usage

Apply the plugin to all schemas:

```ts
import mongoose from 'mongoose';
import { SafeQuery } from 'mongoose-safe-query';

const safeQuery = new SafeQuery();
const safeQueryPlugin = safeQuery.getPlugin();

mongoose.plugin(safeQueryPlugin);

// Define schemas afterwards
```

Apply the plugin to specific schemas:

```ts
import mongoose from 'mongoose';
import { SafeQuery } from 'mongoose-safe-query';

const safeQuery = new SafeQuery();
const safeQueryPlugin = safeQuery.getPlugin();

const schema = new mongoose.Schema({ /* schema definition */ });

schema.plugin(safeQueryPlugin);
```

Usually you have multiple schemas. You can create the `safeQuery` instance and `safeQueryPlugin` in a separate file, and share it with all the schemas. See [Notes](#notes) below to details.

## Configurations

When creating a `SafeQuery` instance, you can customize the plugin as follows.

### Example

```ts
const safeQuery = new SafeQuery()
  // Always warn
  .setWarnCondition(true)
  // Only throw in non-production environment
  .setThrowCondition(() => process.env.NODE_ENV !== 'production')
  .setFieldCheckHandler({
    warnAction: (query: ViolatingQuery) => {
      // Log to your logging framework
    },
    throwMessage: (query: ViolatingQuery) => {
      return `Query fields do not exist in ${query.modelName}: ` +
        query.violatingFields.join(', ');
    },
  })
  .setIndexCheckHandler({
    // Query requires at least 25% index coverage
    minCoverage: 0.25,
    warnAction: (query: ViolatingQuery) => {
      // Log to your logging framework
    },
    throwMessage: (query: ViolatingQuery) => {
      return `Query has insufficient index coverage in ${query.modelName}: ` +
        query.violatingFields.join(', ');
    },
  });
```

### Overall

| Option | Type | Setter | Definition |
| ---- | ---- | ---- | ---- |
| `shouldWarn` | `() => boolean` | `setWarnCondition` | Whether a warning action should be run if there is any violation. Default to always return `true`. |
| `shouldThrow` | `() => boolean` | `setThrowCondition` | Whether an exception should be thrown if there is any violation. Default to always return `false`. |
| `checkField` | `object` | `setFieldCheckHandler` | See [Field Existence Config](#field-existence-config). |
| `checkIndex` | `object` | `setIndexCheckHandler` | See [Index Coverage Config](#index-coverage-config). |

- For convenience, you can pass in a boolean constant to `setWarnCondition` and `setThrowCondition` if no dynamic evaluation is needed.

### Field Existence Config

- This config determines what to do if a query has fields that do not exist in the schema.
- Setter: `setFieldCheckHandler`.

| Option | Type | Default | Definition |
| ---- | ---- | ---- | ---- |
| `warnAction` | `(query: ViolatingQuery) => void` | Log a warning message to console. | Given a violation query, define the warning action to run. |
| `throwMessage` | `(query: ViolatingQuery) => string` | `undefined` | Given a violation query, return a message. This message will be wrapped in `InvalidField` error and thrown. |

- The plugin will only run the warning action if `shouldWarn` returns `true` and `warnAction` is defined.
- Similarly, it will only throw an `InvalidField` error if `shouldThrow` return `true` and `throwMessage` is defined.

### Index Coverage Config

- This config determines what to do if a query has insufficient coverage.
- Setter: `setIndexCheckHandler`.

| Option | Type | Default | Definition |
| ---- | ---- | ---- | ---- |
| `minCoverage` | `number` | 0.25 | A floating number representing the percentage of fields that should be covered by an index. |
| `warnAction` | `(query: ViolatingQuery) => void` | Log a warning message to console. | Given a violation query, define the warning action to run. |
| `throwMessage` | `(query: ViolatingQuery) => string` | `undefined` | Given a violation query, return a message. This message will be wrapped in `LowIndexCoverage` error and thrown. |

- The plugin will only run the warning action if `shouldWarn` returns `true` and `warnAction` is defined.
- Similarly, it will only throw a `LowIndexCoverage` error if `shouldThrow` return `true` and `throwMessage` is defined.

## Notes
- All plugins created from the same `SafeQuery` instance share the configurations. Any update to the configurations will be shared by models whose schemas are configured with the same plugin.
- For each query with the same fields, the warning action will only be run once. This is because usually you log the violating query in the warning action. This feature prevents the logging framework from being flooded by frequent queries.

## References
- [Mongoose plugins](https://mongoosejs.com/docs/plugins.html)
- [Mongoose middleware](https://mongoosejs.com/docs/middleware.html)

## License
[ISC](LICENSE.md)
