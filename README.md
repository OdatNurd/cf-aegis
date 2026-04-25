# Cloudflare Aegis Test Wrapper


This package is a helper package that facilitates writing unit tests for a
[Cloudflare Worker](https://developers.cloudflare.com/workers/) using
the [Aegis](https://www.npmjs.com/package/@axel669/aegis) test
library, for those that are not interested in using the
[Cloudflare Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
via [vitest](https://vitest.dev/).

Behind the scenes,
[Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/)
is used to run the worker in a manner consistent with how
[Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
would run it.


## Requirements

To use the test utilities contained within this package, you must install the
required peer dependencies into your own project's `devDependencies` if you
have not already done so:

```sh
pnpm add -D @axel669/aegis miniflare json5 smol-toml
```


## Usage

The core library itself exposes a small subset of functions that allow it to
load a `Wrangler` configuration file, ensure that any environment variables and
secrets are properly set up (including across environments, see below) and
launch the worker, as well as cleaning up after it as well.

> ℹ️ **Info**
> Some of the other modules in the package have exportable functions, such as
> for loading a Wrangler configuration file, reducing it to only the environment
> to be executed, and so on.
>
> These are not part of the officially supported public interface, but are
> nonetheless available for use with the caveat that there is some possibility
> that they might be replaced or altered in the future.


### Core Functionality

```js
import {
  aegisSetup,
  aegisTeardown,
  initializeCustomChecks
} from '@odatnurd/cf-aegis'
```

---

```javascript
export async function aegisSetup(ctx, inputConfig, {
  portAdjustment = 0,
  workerMocks = {},
  env = undefined
}) {}
```
An `async` function to be invoked in your tests, for example from the `setup`
hook in your Aegis config file. This uses the provided configuration to create
a new Miniflare instance within which your tests can run.

`inputConfig` can be one of:
- A wrangler configuration file filename (in `TOML` or `JSONC` format)
- An object with the structure of a parsed Wrangler configuration file

Using the configuration, a Miniflare worker is configured, and the passed in
`ctx` object has the following fields injected into it:

- `worker`: the actual Miniflare worker instance
- `env`: an object that contains all of the configured bindings, as they would
  be presented to you in a worker at runtime
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
- `vars` environment variables and secrets (see below)
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

> ℹ️ **Info**
> When running, if the `env` for the worker does not already supply it, a
> `CF_AEGIS` environment variable with its value set to "true" will be injected
> to allow tests to know that they are running in the test environment.
>
> Should such a variable actually exist, its value will be left untouched.

> ⚠️ **Warning**
> Currently, there appears to be a bug in Miniflare that causes it static asset
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
An async function that will safely shut down and dispose of a Miniflare
worker instance created by `aegisSetup` and removes from the `ctx` all of the
values that `aegisSetup` added to it.

Generally you would call this from the `teardown` hook in your Aegis
configuration file, although importantly you want to pair it with `aegisSetup`,
however that gets called.

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


### Specifying an Environment

Wrangler configurations support multiple environments (e.g. `staging`,
`production`), utilizing a mix of inheritable and non-inheritable keys. You can
instruct `aegisSetup` to resolve the configuration for a specific environment
by passing the `env` property in the helper options object.

This mimics using the `-e` / `--env` functionality of `wrangler` to specify the
environment to run within.

```js
import { aegisSetup, } from '@odatnurd/cf-aegis';

// This resolves the config exactly as `wrangler dev -e staging`
// would. Inheritable keys (like `main` and `compatibility_date`) fall
// back to the top-level. Non-inheritable keys (like `vars`,
// `d1_databases`, `secrets`) are strictly isolated to the 'staging'
// block.
await aegisSetup(ctx, './wrangler.jsonc', {
  env: 'staging'
});

```

### Environment Variables and Secrets

`cf-aegis` faithfully mimics Wrangler's native environment variable and secret
loading mechanisms to ensure your tests run as closely to production as
possible. However, to prevent inadvertently committing or leaking actual
development secrets, the library looks for test-specific file names instead of
the standard Wrangler defaults.

This allows you to store your actual test configurations in your repository to
facilitate testing, and act as an extra layer of documentation for what your
worker actually expects.

When `aegisSetup` is invoked, it will attempt to load environment variable
files from the directory containing the passed configuration file; when invoked
with an already loaded configuration file, the files will be loaded from the
current working directory instead.

**`.test.vars` files (Replaces `.dev.vars`)**

These files take absolute precedence and are mutually exclusive; only one of
the two will be loaded:

* If an environment is specified in the call to aegisSetup, it looks for
  `.test.vars.<envName>`.
* If no environment is specified, or the specific file doesn't exist, it falls
  back to `.test.vars`.

As in Wrangler, if a `.test.vars` file of any type is loaded, `.test.env` files
are ignored entirely and will not be loaded even if present.

**`.test.env` files (Replaces `.env`)**

If no `.test.vars` files are found, the system will fall back to loading
`.test.env` files formatted using standard `dotenv` syntax. Unlike `.vars`
files, these are merged together. Files appearing later in this list have
higher precedence and will overwrite matching keys from earlier files that may
have been loaded.

1. `.test.env`
2. `.test.env.<envName>`
3. `.test.env.local`
4. `.test.env.<envName>.local`

> ℹ️ **Info**
> Just like Wrangler, you can control the fallback behavior using process
> environment variables.
>
> Setting `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV="false"` will skip loading
> `.test.env` files entirely.
>
> If no `.test.vars` files are found, setting
> `CLOUDFLARE_INCLUDE_PROCESS_ENV="true"` will merge your entire system
> `process.env` into the worker bindings.

**Secrets Validation**

If your Wrangler configuration defines a `secrets` key with a `required` array,
`cf-aegis` will strictly filter all loaded variables. Only the keys explicitly
listed in the `required` array will be injected into the worker's environment.
Any required secrets not found in the loaded files will generate a warning log
to the console.


## Test Configuration Examples

You can import the helper functions into your `aegis.config.js` file to easily
set up a test environment. The `aegisSetup()` function accepts either an object
that is a structured Wrangler config object or the name of a wrangler config
file, and will configure Miniflare appropriately.

**Example `aegis.config.js`:**

This example configures a worker to include a binding for a database and an R2
bucket; they appear in the `ctx` as `ctx.env.DB` and `ctx.env.BUCKET`
respectively.

```js
import {
  initializeCustomChecks,
  aegisSetup,
  aegisTeardown
} from '@odatnurd/cf-aegis';

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

or if you prefer to not use `Tom's Obnoxious Malformed Language`, `JSONC` is
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

Using a configuration file, the previous configuration example becomes much
simpler:

```js
// You can use either 'wrangler.toml' or 'wrangler.jsonc' here.
await aegisSetup(ctx, './wrangler.toml');
```


## Mocking Service Bindings

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
// Define the inline configuration for the main worker; this could of
// course also be specified to the configuration as a filename of a
// wrangler file.
const config = {
  services: [{
    // The name of the binding; e.g. ctx.env.LOG_SERVICE
    binding: 'LOG_SERVICE',
    service: 'log-service'
  }]
};

const workerMocks = {
  'log-service': {
    // It is also possible to use scriptPath instead to provide a
    // source file, for a more complex mock:
    //     scriptPath: './path/to/mock-worker.js'
    script: `export default {
      fetch(request) {
        return new Response('Success', { status: 200 });
      }
    }`
  }
};

await aegisSetup(ctx, config, { workerMocks });
```
