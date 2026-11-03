/******************************************************************************/


import { Collection, $check, $ } from "@axel669/aegis";
import { Miniflare } from "miniflare";
import fs from "fs";

import { aegisSetup, aegisTeardown } from "../lib/index.js";
import { loadWranglerConfig } from "../lib/wrangler.js";


/******************************************************************************/


export default Collection`Aegis Setup and Teardown`({
  /* This section tests the behavior of the setup and teardown helpers when
   * they are given a simple, empty configuration. This verifies the baseline
   * behavior of the functions. */
  "Baseline Setup/Teardown": async ({ runScope }) => {
    // Create an empty context object to be populated by the setup function.
    const ctx = {};

    // Run the setup function with the empty config.
    await aegisSetup(ctx);

    // Verify that the setup function populated the context object with all
    // of the expected default properties.
    $check`Context is correctly populated after setup`
      .value(ctx)
      .instanceof($.worker, Miniflare)
      .isObject($.env)
      .isFunction($.fetch)
      .eq($.isServerListening, false)
      .eq($.serverBaseUrl, undefined);

    // Run the teardown function to clean up the context.
    await aegisTeardown(ctx);

    // Verify that the teardown function has completely emptied the context
    // object, returning it to its original state.
    $check`Context is empty after teardown`
      .value(ctx)
      .deepEquals($, {});
  },


  /****************************************************************************/


  /* This section verifies that the CF_AEGIS environment variable is correctly
   * injected into the worker bindings, and that it does not overwrite a
   * value if the user explicitly configured one. */
  /* This section verifies that a configured server port is removed along
   * with the rest of the values that setup adds to the context. */
  "Server Port Teardown": async ({ runScope }) => {
    const ctx = {};
    await aegisSetup(ctx, './test/worker/wrangler.toml');

    $check`Configured server port is exposed during the test`
      .value(ctx)
      .eq($.serverPort, 9002)
      .eq($.isServerListening, true);

    await aegisTeardown(ctx);

    $check`Server port and all other setup values are removed at teardown`
      .value(ctx)
      .deepEquals($, {});
  },


  /****************************************************************************/


  /* This section verifies that invalid port values fail clearly before a
   * Miniflare instance is created. */
  "Port Validation": async ({ runScope }) => {
    const invalidPort = {};
    let invalidPortError;
    try {
      await aegisSetup(invalidPort, { dev: { port: '9002' } });
    } catch (caught) {
      invalidPortError = caught;
    }

    $check`String dev.port is rejected`
      .value(invalidPortError instanceof TypeError)
      .eq($, true);

    $check`Invalid dev.port leaves the context empty`
      .value(invalidPort)
      .deepEquals($, {});

    const invalidAdjustment = {};
    let invalidAdjustmentError;
    try {
      await aegisSetup(invalidAdjustment, { dev: { port: 9002 } }, {
        portAdjustment: '1'
      });
    } catch (caught) {
      invalidAdjustmentError = caught;
    }

    $check`Non-integer portAdjustment is rejected`
      .value(invalidAdjustmentError instanceof TypeError)
      .eq($, true);

    const outOfRange = {};
    let outOfRangeError;
    try {
      await aegisSetup(outOfRange, { dev: { port: 9002 } }, {
        portAdjustment: 65000
      });
    } catch (caught) {
      outOfRangeError = caught;
    }

    $check`Out-of-range adjusted port is rejected`
      .value(outOfRangeError instanceof RangeError)
      .eq($, true);

    $check`Out-of-range setup leaves the context empty`
      .value(outOfRange)
      .deepEquals($, {});
  },


  /****************************************************************************/


  /* This section verifies that a failed setup does not leave partial values
   * or a live Miniflare instance in the context. */
  "Setup Failure Cleanup": async ({ runScope }) => {
    const ctx = {};
    let error;

    try {
      await aegisSetup(ctx, { main: './definitely-missing-worker.js' });
    } catch (caught) {
      error = caught;
    }

    $check`Invalid worker setup reports an error`
      .value(error instanceof Error)
      .eq($, true);

    $check`Failed setup leaves the context empty`
      .value(ctx)
      .deepEquals($, {});
  },


  /****************************************************************************/


  /* This section verifies that the CF_AEGIS environment variable is correctly
   * injected into the worker bindings, and that it does not overwrite a
   * value if the user explicitly configured one. */
  "CF_AEGIS Environment Variable": async ({ runScope }) => {
    const ctx1 = {};

    // Provide an empty config, which should result in CF_AEGIS being injected
    // with the default value of 'true'.
    await aegisSetup(ctx1, {});

    $check`CF_AEGIS is injected as 'true' by default`
      .value(ctx1.env)
      .eq($.CF_AEGIS, 'true');

    await aegisTeardown(ctx1);

    const ctx2 = {};

    // Provide a config that explicitly sets a value for CF_AEGIS, which should
    // bypass the injection and keep the configured value.
    await aegisSetup(ctx2, { vars: { CF_AEGIS: 'custom-value' } });

    $check`Pre-existing CF_AEGIS is not overwritten`
      .value(ctx2.env)
      .eq($.CF_AEGIS, 'custom-value');

    await aegisTeardown(ctx2);
  },


  /****************************************************************************/


  /* This section performs an integration test on all bindings except for
   * static assets. It verifies that loading a full wrangler configuration
   * results in a correctly configured Miniflare environment. */
  "Handles Full Configuration (No Assets)": async ({ runScope }) => {
    const tomlConfig = loadWranglerConfig('./test/worker/wrangler.toml');
    const jsoncConfig = loadWranglerConfig('./test/worker/wrangler.jsonc');
    const jsonConfig = loadWranglerConfig('./test/worker/wrangler.json');

    await $check`TOML, JSONC, and JSON configs are structurally identical`
      .value(tomlConfig)
      .deepEquals($, jsoncConfig)
      .deepEquals($, jsonConfig);

    const ctx = {};
    const workerMocks = {
      'my-auth-worker': {
        script: `export default { fetch: () => new Response('Mocked Auth Service Response') }`,
      },
    };

    await aegisSetup(ctx, './test/worker/wrangler.toml', { workerMocks });

    await $check`Injected CF_AEGIS variable is present in the loaded configuration`
      .value(ctx.env)
      .eq($.CF_AEGIS, 'true');

    $check`Variables are bound correctly`
      .value(ctx.env)
      .eq($.API_VERSION, 'v1.0.0')
      .eq($.ENVIRONMENT, 'testing');

    await $check`D1 database is functional`
      .call(async () => {
        await ctx.env.DB_MAIN.exec(`CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)`);
        await ctx.env.DB_MAIN.prepare(`INSERT INTO test (name) VALUES (?)`).bind('hello').run();
        return await ctx.env.DB_MAIN.prepare(`SELECT * FROM test`).first();
      })
      .isObject($)
      .eq($.name, 'hello');

    await $check`KV namespace is functional`
      .call(async () => {
        await ctx.env.KV_CONFIG.put('test-key', 'test-value');
        return await ctx.env.KV_CONFIG.get('test-key');
      })
      .eq($, 'test-value');

    await $check`R2 bucket is functional`
      .call(async () => {
        await ctx.env.R2_BUCKET.put('test-file.txt', 'Hello from R2!');
        const r2Object = await ctx.env.R2_BUCKET.get('test-file.txt');
        return await r2Object.text();
      })
      .eq($, 'Hello from R2!');

    await $check`Durable Object is functional`
      .call(async () => {
        const res1 = await ctx.fetch('/do');
        const text1 = await res1.text();
        const res2 = await ctx.fetch('/do');
        const text2 = await res2.text();
        return {
          status1: res1.status, text1,
          status2: res2.status, text2,
        };
      })
      .eq($.status1, 200)
      .eq($.text1, `Durable Object 'Counter' count is: 1`)
      .eq($.status2, 200)
      .eq($.text2, `Durable Object 'Counter' count is: 2`);

    await $check`Queue is functional`
      .call(async () => {
        // Deliver a message to the queue
        const res = await ctx.fetch('/queue');

        // Due to the async nature of the queue, we need to poll for a short
        // time to get the result;
        process.stdout.write('awaiting queue data');
        for (let i = 0; i < 50; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const messages = await ctx.env.KV_CONFIG.get('queue-messages', 'json');

          if (messages !== null && messages.length > 0) {
            process.stdout.write('dequeued\n');
            return { res, messages };
          }
          process.stdout.write('.');
        }

        return { res, messages: [ { error: 'dequeue timed out' } ] };
      })
      .eq($.res.status, 200)
      .isArray($.messages)
      .keyCount($.messages, 1)
      .deepEquals($.messages[0], {
        url: `${ctx.serverBaseUrl}/queue`,
        method: 'GET'
      });

    await $check`Service bindings are functional`
      .call(async () => {
        const authRes = await ctx.env.AUTH_SERVICE.fetch('http://localhost/auth');
        const authText = await authRes.text();
        const logRes = await ctx.env.LOGGING_SERVICE.fetch('http://localhost/log');
        const logText = await logRes.text();
        return { authText, logText };
      })
      .eq($.authText, 'Mocked Auth Service Response')
      .eq($.logText, 'Service not implemented in test environment');

    await aegisTeardown(ctx);
  },


  /****************************************************************************/


  /* This section performs an integration test specifically for the static
   * assets binding. */
  "Handles Static Asset Configuration": async ({ runScope }) => {
    const tomlConfig = loadWranglerConfig('./test/worker/wrangler_static.toml');
    const jsoncConfig = loadWranglerConfig('./test/worker/wrangler_static.jsonc');

    await $check`Static TOML and JSONC configs are structurally identical`
      .value(tomlConfig)
      .deepEquals($, jsoncConfig);

    const ctx = {};
    await aegisSetup(ctx, './test/worker/wrangler_static.toml');

    const assetContent = fs.readFileSync('./test/worker/public/test.txt', 'utf8');

    await $check`Static asset is served correctly`
      .call(async () => {
        const res = await ctx.fetch('/test.txt');
        return {
          status: res.status,
          text: await res.text()
        };
      })
      .eq($.status, 200)
      .eq($.text, assetContent);

    await aegisTeardown(ctx);
  },
});


/******************************************************************************/
