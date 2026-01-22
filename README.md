# Cloudflare Aegis Test Wrapper


This package includes a set of helpers to facilitate testing projects with the
[Aegis](https://www.npmjs.com/package/@axel669/aegis) test runner and a
[Cloudflare Worker](https://developers.cloudflare.com/workers/) via
[Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/).

To use these utilities, you must install the required peer dependencies into
your own project's `devDependencies` if you have not already done so.

```sh
pnpm add -D @axel669/aegis miniflare json5 smol-toml
```

The `@odatnurd/cf-aegis` module exports the following functions:


```javascript
export async function aegisSetup(ctx, inputConfig, { portAdjustment = 0, workerMocks = {} }) {}
```
An async function to be invoked from the `setup` hook in your Aegis config file.
This uses the provided configuration to create a new Miniflare instance.

`inputConfig` can be one of:
- A wrangler configuration file (in `TOML` or `JSONC` format)
- An object with the structure of a parsed Wrangler configuration file

Using the configuration, a Miniflare worker is configured, and the passed in
`ctx` object has the following fields injected into it:

- `worker`: the actual Miniflare worker instance
- `env`: an object that contains all of the configured bindings, as they would
  be presented to you in a worker
- `isServerListening`: a boolean that indicates if the configuration contained
  a port, in which case a development service will be started

Additionally, the following keys will be added when `isServerListening` is set
to `true`:
- `serverPort`: the port that the server is listening on, including any desired
  adjustment (see below).
- `serverBaseUrl`: the full base URL for all routes in the worker, including the
  configured port.
- `fetch`: a wrapped function on the `fetch()` method that allows fetching from
  URL fragments without needing to know the port (e.g `ctx.fetch('/api/thing')`)


The configuration currently supports:
- `D1` databases
- `R2` storage
- `Durable Objects`
- `KV`
- `Queues`
- `Static Assets` (see below)
- `Service Bindings`

When using `service bindings`, all services will, by default, be mocked to
include a `fetch` handler that generates an error response saying the service
is not mocked. This facilitates testing in cases where the bound services are
not needed.

Optionally, the `workerMocks` field in the passed options object can be
populated; the keys are the names of the service bindings, and the values are
objects that contain either a `script` or `scriptPath` field to specify the
body of the service.

The options can also include a portAdjustment which will be added to the port
in the configuration before it is passed to Miniflare; this allows the port to
be modified during test runs, which can be handy for things like running the
tests while a development server is running on the same machine.

> ⚠️ **Warning**
> Currently, there appear to be a bug in miniflar that causes it static asset
> handling to not work properly when a worker is defined; it should try to fetch
> assets first, and then fall back to the main worker. However instead the asset
> handler consumes all requests and will 404 on anything that is not an asset.
>
> `cf-aegis` has a workaround in place for this that injects extra workers in to
> mimic what should happen, to allow for tests that use assets to work as they
> are expected to.

---

```javascript
export async function aegisTeardown(ctx) {}
```
An async function to be called from the `teardown` hook in your Aegis config
that aligns with the `setup` hook. It safely disposes of the Miniflare instance
created by `aegisSetup` and removes from `ctx` all of the values added to it by
`aegisSetup`.


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
* `.isNotFunction($)`: A shortcut to check if a value is not an instance of
  `Function`.
* `.deepEquals($, expected)`: Does a deep equality check (e.g. on an array or
 an object) to ensure that they are completely equal; can also be used on other
 values as well.
* `.notDeepEquals($, expected)`: Does a deep equality check as above, but with a
  check for inequality instead.


The `@odatnurd/cf-aegis/config` module exports the following function:


```javascript
export function loadWranglerConfig(filename) {}
```
Given the path to a Wrangler configuration file (in either `TOML` or `JSONC`
format), load the configuration and return the object back.

This can be useful in cases where you want tests to be configured via the same
Wrangler config that you use to develop and deploy your application, but you
need to amend it prior to testing in some fashion.


### Configuration Examples

You can import the helper functions into your `aegis.config.js` file to easily
set up a test environment. The `aegisSetup()` function accepts either an object
that is a structured Wrangler config object or the name of a wrangler config
file, and will configure Miniflare appropriately.

**Example `aegis.config.js`:**

This example configures a worker to include a binding for a database and an R2
bucket; they appear in the `ctx` as `ctx.env.DB` and `ctx.env.BUCKET`
respectively.

```js
import { initializeCustomChecks, aegisSetup, aegisTeardown } from '@odatnurd/cf-aegis';

initializeCustomChecks();

export const config = {
    files: [
        "test/**/*.test.js",
    ],
    hooks: {
        async setup(ctx) {
            await aegisSetup(ctx, {
              d1_databases: [{
                binding: 'DB',
                database_name: 'test-db',
                database_id: 'test-db-id'
              }],
              r2_buckets: [{
                binding: 'BUCKET',
                bucket_name: 'test-bucket'
              }]
            });
        },

        async teardown(ctx) {
            await aegisTeardown(ctx);
        },
    },
    failAction: "afterSection",
}
```

The format of the configuration object is that of a loaded Wrangler
configuration file in either of the supported formats. Optionally, if you
already have a config file to use, you can point the function at it and it will
load the config for you.

**wrangler.toml**

```toml
name = "aegis-test"
main = "src/index.js"
compatibility_date = "2024-04-05"

[[d1_databases]]
binding = "DB"
database_name = "test-db"
database_id = "test-db-id"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "test-bucket"
```

or if you prefer to not use `Toms Obnoxious Malformed Language`, `JSONC` is
also supported:

```jsonc
{
  "name": "aegis-test",
  "main": "src/index.js",
  "compatibility_date": "2024-04-05",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "test-db",
      "database_id": "test-db-id"
    }
  ],
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "test-bucket"
    }
  ]
}
```

Then the example becomes:

```js
import { initializeCustomChecks, aegisSetup, aegisTeardown } from '@odatnurd/cf-aegis';

initializeCustomChecks();

export const config = {
    files: [
        "test/**/*.test.js",
    ],
    hooks: {
        async setup(ctx) {
            // You can use either 'wrangler.toml' or 'wrangler.jsonc' here
            await aegisSetup(ctx, './wrangler.toml');
        },

        async teardown(ctx) {
            await aegisTeardown(ctx);
        },
    },
    failAction: "afterSection",
}
```


#### Mocking Service Bindings

Should your configuration require that you bind to another worker, by default
the binding will be set up such that all requests to that worker generate an
error response telling you that it is not mocked; this is considered the most
common use case, where you would be reusing an existing configuration but
testing code paths that don't touch external services.

If you require such services to be implemented, you can tell `aegisSetup()` what
services to mock and how the mocks work. This can be done via an inline script
as in this example or by providing a `scriptPath` instead to point at a file,
should the mock be more complex.

```js
import { initializeCustomChecks, aegisSetup, aegisTeardown } from '@odatnurd/cf-aegis';

initializeCustomChecks();

export const config = {
    files: [
        "test/**/*.test.js",
    ],
    hooks: {
        async setup(ctx) {
            // Define the inline configuration for the main worker
            const config = {
              services: [{
                // The name of the binding; e.g. ctx.env.LOG_SERVICE
                binding: 'LOG_SERVICE',
                service: 'log-service'
              }]
            };

            const workerMocks = {
              'log-service': {
                // For a more complex mock, you can use scriptPath: './path/to/mock-worker.js'
                script: `export default {
                  fetch(request) {
                    return new Response('Success', { status: 200 });
                  }
                }`
              }
            };

            await aegisSetup(ctx, config, { workerMocks });
        },

        async teardown(ctx) {
            await aegisTeardown(ctx);
        },
    },
    failAction: "afterSection",
}
```
