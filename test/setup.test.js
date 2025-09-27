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


  /* This section performs an integration test on all bindings except for
   * static assets. It verifies that loading a full wrangler configuration
   * results in a correctly configured Miniflare environment. */
  "Handles Full Configuration (No Assets)": async ({ runScope }) => {
    const tomlConfig = loadWranglerConfig('./test/worker/wrangler.toml');
    const jsoncConfig = loadWranglerConfig('./test/worker/wrangler.jsonc');

    await $check`TOML and JSONC configs are structurally identical`
      .value(tomlConfig)
      .deepEquals($, jsoncConfig);

    const ctx = {};
    const workerMocks = {
      'my-auth-worker': {
        script: `export default { fetch: () => new Response('Mocked Auth Service Response') }`,
      },
    };

    await aegisSetup(ctx, './test/worker/wrangler.toml', workerMocks);

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
