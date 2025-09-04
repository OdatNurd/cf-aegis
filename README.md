# Cloudflare Aegis Test Wrapper


This package includes a set of helpers to facilitate testing projects with the
[Aegis](https://www.npmjs.com/package/@axel669/aegis) test runner and an
in-memory D1 database powered by Miniflare for use when developing
[Cloudflare Workers](https://developers.cloudflare.com/workers/).

To use these utilities, you must install the required peer dependencies into
your own project's `devDependencies` if you have not already done so.

```sh
pnpm add -D @axel669/aegis miniflare
```

The `@odatnurd/cf-aegis` module exports the following functions:


```javascript
export async function aegisSetup(ctx, dbName = 'DB') {}
```
An async function to be called from the `setup` hook in your Aegis config. It
creates a new Miniflare instance with a D1 database binding named `dbName`.

The provided Aegis scope context (e.g. runScope) object will be populated with
a `db` property that provides the database context, and a `worker` property
that stores the Miniflare worker.

---

```javascript
export async function aegisTeardown(ctx) {}
```
An async function to be called from the `teardown` hook in your Aegis config
that aligns with the `setup` hook. It safely disposes of the Miniflare instance
created by `aegisSetup`.


---

```javascript
export function initializeCustomChecks() {}
```

A function that registers several custom checks with Aegis to simplify testing.
This augments the internal tests that are already available in Aegis.

* `.isArray($)`: Checks if a value is an array.
* `.isNotArray($)`: Checks if a value is not an array.
* `.isObject($)`: Checks if a value is a plain object.
* `.isNotObject($)`: Checks if a value is not a plain object.
* `.keyCount($, count)`: Checks if an object has an exact number of keys.
* `.isFunction($)`: A shortcut to check if a value is an instance of
  `Function`.


### Configuration

You can import the helper functions into your `aegis.config.js` file to easily
set up a test environment, optionally also populating one or more SQL files into
the database first in order to set up testing if using a database (for example
via [@odatnurd/d1-query](https://www.npmjs.com/package/@odatnurd/d1-query))

**Example `aegis.config.js`:**

```js
import { initializeCustomChecks, aegisSetup, aegisTeardown } from '@odatnurd/cf-aegis';

import { initializeD1Checks, execSQLFiles } from '@odatnurd/d1-query/aegis';

initializeCustomChecks();
initializeD1Checks();

export const config = {
    files: [
        "test/**/*.test.js",
    ],
    hooks: {
        async setup(ctx) {
            await aegisSetup(ctx, 'DB');
            await execSQLFiles(ctx.db, 'test/setup.sql');
        },

        async teardown(ctx) {
            await aegisTeardown(ctx);
        },
    },
    failAction: "afterSection",
}
```
