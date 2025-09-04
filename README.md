# Cloudflare Aegis Test Wrapper


This package includes a set of helpers to facilitate testing your own projects
with the [Aegis](https://www.npmjs.com/package/@axel669/aegis) test runner and
an in-memory D1 database powered by Miniflare for use when developing
Cloudflare Workers.

To use these utilities, you must install the required peer dependencies into
your own project's `devDependencies` if you have not already done so.

```sh
pnpm add -D @odatnurd/d1-query @axel669/aegis miniflare fs-jetpack
```

> ℹ️ If you are actively using
> [@odatnurd/d1-query](https://www.npmjs.com/package/@odatnurd/d1-query) in your
> project, that library should be installed as a regular `dependency` and not a
> `devDependency`

The `@odatnurd/cf-aegis` module exports the following functions:


```javascript
export async function aegisSetup(ctx, sqlSetupFiles = undefined, dbName = 'DB') {}
```
An async function to be called from the `setup` hook in your Aegis config. It
creates a new Miniflare instance with an in-memory D1 database and, if
provided, executes one or more SQL files to prepare the database schema and
data.

The provided Aegis scope (e.g. runScope) object will be populated with a `db`
property that provides the database context, and a `worker` property that
stores the Miniflare worker. You can control the Miniflare DB binding name with
dbName if desired.

You may also optionally pass either a SQL file name as a string or an array of
SQL file names to populate the database.

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

initializeCustomChecks();

export const config = {
    files: [
        "test/**/*.test.js",
    ],
    hooks: {
        async setup(ctx) {
            await aegisSetup(ctx, 'test/setup.sql', 'DB');
        },

        async teardown(ctx) {
            await aegisTeardown(ctx);
        },
    },
    failAction: "afterSection",
}
```
