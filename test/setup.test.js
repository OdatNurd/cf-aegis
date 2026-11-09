/******************************************************************************/


import { aegis, $ } from "@axel669/aegis";
import { Miniflare } from "miniflare";
import fs from "fs";
import os from "node:os";
import path from "node:path";

import { aegisSetup, aegisTeardown, initializeCustomChecks } from "../lib/index.js";
import { applyModuleRoots } from "../lib/miniflare.js";
import { loadWranglerConfig } from "../lib/wrangler.js";


initializeCustomChecks();


/******************************************************************************/


export const name = "Aegis Setup and Teardown";


/******************************************************************************/


aegis.test`Baseline Setup/Teardown`(async () => {
  // Create an empty context object to be populated by the setup function.
  const ctx = {};

  // Run the setup function with the empty config.
  try {
    await aegisSetup(ctx);

    // Verify that the setup function populated the context object with all of
    // the expected default properties.
    $.check`Context is correctly populated after setup`(
      $.instanceof(ctx.worker, Miniflare),
      $.isObject(ctx.env),
      $.isFunction(ctx.fetch),
      $.eq(ctx.isServerListening, false),
      $.eq(ctx.serverBaseUrl, undefined)
    );
  } finally {
    // Always dispose of the worker, even if a check above fails.
    await aegisTeardown(ctx);
  }

  // Verify that the teardown function has completely emptied the context
  // object, returning it to its original state.
  $.check`Context is empty after teardown`(
    $.deepEquals(ctx, {})
  );
});


/******************************************************************************/


aegis.test`Server Port Teardown`(async () => {
  const ctx = {};
  try {
    await aegisSetup(ctx, './test/worker/wrangler.toml');

    $.check`Configured server port is exposed during the test`(
      $.eq(ctx.serverPort, 9002),
      $.eq(ctx.isServerListening, true)
    );
  } finally {
    await aegisTeardown(ctx);
  }

  $.check`Server port and all other setup values are removed at teardown`(
    $.deepEquals(ctx, {})
  );
});


/******************************************************************************/


aegis.test`Port Validation`(async () => {
  const invalidPort = {};
  let invalidPortError;
  try {
    await aegisSetup(invalidPort, { dev: { port: '9002' } });
  } catch (caught) {
    invalidPortError = caught;
  }

  $.check`String dev.port is rejected`(
    $.instanceof(invalidPortError, TypeError)
  );

  $.check`Invalid dev.port leaves the context empty`(
    $.deepEquals(invalidPort, {})
  );

  const invalidAdjustment = {};
  let invalidAdjustmentError;
  try {
    await aegisSetup(invalidAdjustment, { dev: { port: 9002 } }, {
      portAdjustment: '1'
    });
  } catch (caught) {
    invalidAdjustmentError = caught;
  }

  $.check`Non-integer portAdjustment is rejected`(
    $.instanceof(invalidAdjustmentError, TypeError)
  );

  const outOfRange = {};
  let outOfRangeError;
  try {
    await aegisSetup(outOfRange, { dev: { port: 9002 } }, {
      portAdjustment: 65000
    });
  } catch (caught) {
    outOfRangeError = caught;
  }

  $.check`Out-of-range adjusted port is rejected`(
    $.instanceof(outOfRangeError, RangeError)
  );

  $.check`Out-of-range setup leaves the context empty`(
    $.deepEquals(outOfRange, {})
  );
});


/******************************************************************************/


aegis.test`Setup Failure Cleanup`(async () => {
  const ctx = {};
  let error;

  try {
    await aegisSetup(ctx, { main: './definitely-missing-worker.js' });
  } catch (caught) {
    error = caught;
  }

  $.check`Invalid worker setup reports an error`(
    $.instanceof(error, Error)
  );

  $.check`Failed setup leaves the context empty`(
    $.deepEquals(ctx, {})
  );
});


/******************************************************************************/


aegis.test`CF_AEGIS Environment Variable`(async () => {
  const ctx1 = {};

  // Provide an empty config, which should result in CF_AEGIS being injected
  // with the default value of 'true'.
  try {
    await aegisSetup(ctx1, {});

    $.check`CF_AEGIS is injected as 'true' by default`(
      $.eq(ctx1.env.CF_AEGIS, 'true')
    );
  } finally {
    await aegisTeardown(ctx1);
  }

  const ctx2 = {};

  // Provide a config that explicitly sets a value for CF_AEGIS, which should
  // bypass the injection and keep the configured value.
  try {
    await aegisSetup(ctx2, { vars: { CF_AEGIS: 'custom-value' } });

    $.check`Pre-existing CF_AEGIS is not overwritten`(
      $.eq(ctx2.env.CF_AEGIS, 'custom-value')
    );
  } finally {
    await aegisTeardown(ctx2);
  }
});


/******************************************************************************/


aegis.test`Handles Full Configuration (No Assets)`(async () => {
  const tomlConfig = loadWranglerConfig('./test/worker/wrangler.toml');
  const jsoncConfig = loadWranglerConfig('./test/worker/wrangler.jsonc');
  const jsonConfig = loadWranglerConfig('./test/worker/wrangler.json');

  $.check`TOML, JSONC, and JSON configs are structurally identical`(
    $.deepEquals(tomlConfig, jsoncConfig),
    $.deepEquals(tomlConfig, jsonConfig)
  );

  const ctx = {};
  const workerMocks = {
    'my-auth-worker': {
      script: `export default { fetch: () => new Response('Mocked Auth Service Response') }`,
    },
  };

  try {
    await aegisSetup(ctx, './test/worker/wrangler.toml', { workerMocks });

    $.check`Injected CF_AEGIS variable is present in the loaded configuration`(
      $.eq(ctx.env.CF_AEGIS, 'true')
    );

    $.check`Variables are bound correctly`(
      $.eq(ctx.env.API_VERSION, 'v1.0.0'),
      $.eq(ctx.env.ENVIRONMENT, 'testing')
    );

    const databaseRow = await (async () => {
      await ctx.env.DB_MAIN.exec(`CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)`);
      await ctx.env.DB_MAIN.prepare(`INSERT INTO test (name) VALUES (?)`).bind('hello').run();
      return await ctx.env.DB_MAIN.prepare(`SELECT * FROM test`).first();
    })();
    $.check`D1 database is functional`(
      $.isObject(databaseRow),
      $.eq(databaseRow.name, 'hello')
    );

    const kvValue = await (async () => {
      await ctx.env.KV_CONFIG.put('test-key', 'test-value');
      return await ctx.env.KV_CONFIG.get('test-key');
    })();
    $.check`KV namespace is functional`(
      $.eq(kvValue, 'test-value')
    );

    const r2Text = await (async () => {
      await ctx.env.R2_BUCKET.put('test-file.txt', 'Hello from R2!');
      const r2Object = await ctx.env.R2_BUCKET.get('test-file.txt');
      return await r2Object.text();
    })();
    $.check`R2 bucket is functional`(
      $.eq(r2Text, 'Hello from R2!')
    );

    const durableObject = await (async () => {
      const res1 = await ctx.fetch('/do');
      const text1 = await res1.text();
      const res2 = await ctx.fetch('/do');
      const text2 = await res2.text();
      return {
        status1: res1.status, text1,
        status2: res2.status, text2,
      };
    })();
    $.check`Durable Object is functional`(
      $.eq(durableObject.status1, 200),
      $.eq(durableObject.text1, `Durable Object 'Counter' count is: 1`),
      $.eq(durableObject.status2, 200),
      $.eq(durableObject.text2, `Durable Object 'Counter' count is: 2`)
    );

    const queueResult = await (async () => {
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
    })();
    $.check`Queue is functional`(
      $.eq(queueResult.res.status, 200),
      $.isArray(queueResult.messages),
      $.keyCount(queueResult.messages, 1),
      $.deepEquals(queueResult.messages[0], {
        url: `${ctx.serverBaseUrl}/queue`,
        method: 'GET'
      })
    );

    const serviceResult = await (async () => {
      const authRes = await ctx.env.AUTH_SERVICE.fetch('http://localhost/auth');
      const authText = await authRes.text();
      const logRes = await ctx.env.LOGGING_SERVICE.fetch('http://localhost/log');
      const logText = await logRes.text();
      return { authText, logText };
    })();
    $.check`Service bindings are functional`(
      $.eq(serviceResult.authText, 'Mocked Auth Service Response'),
      $.eq(serviceResult.logText, 'Service not implemented in test environment')
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/


aegis.test`Handles Static Asset Configuration`(async () => {
  const tomlConfig = loadWranglerConfig('./test/worker/wrangler_static.toml');
  const jsoncConfig = loadWranglerConfig('./test/worker/wrangler_static.jsonc');

  $.check`Static TOML and JSONC configs are structurally identical`(
    $.deepEquals(tomlConfig, jsoncConfig)
  );

  const ctx = {};
  try {
    await aegisSetup(ctx, './test/worker/wrangler_static.toml');

    const assetContent = fs.readFileSync('./test/worker/public/test.txt', 'utf8');

    const response = await ctx.fetch('/test.txt');
    $.check`Static asset is served correctly`(
      $.eq(response.status, 200),
      $.eq(await response.text(), assetContent)
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/


aegis.test`Module Roots Are Working Directory Independent`(() => {
  const inside = path.resolve('./test/worker/worker.js');
  const outside = path.resolve(os.tmpdir(), 'aegis-worker.js');
  const workers = [
    { name: 'inside', scriptPath: inside },
    { name: 'outside', scriptPath: outside },
    { name: 'inline', script: 'export default {}' },
    { name: 'explicit', scriptPath: outside, modulesRoot: '/explicit' },
  ];

  applyModuleRoots(workers);

  const outsideRelative = path.relative(workers[1].modulesRoot, outside);

  $.check`Scripts inside the working directory keep the default module root`(
    $.eq(workers[0].modulesRoot, process.cwd())
  );

  $.check`Scripts outside the working directory get an enclosing module root`(
    $.eq(outsideRelative.startsWith('..'), false),
    $.eq(path.isAbsolute(outsideRelative), false)
  );

  $.check`Inline scripts and explicit module roots are left alone`(
    $.eq(workers[2].modulesRoot, undefined),
    $.eq(workers[3].modulesRoot, '/explicit')
  );
});


/******************************************************************************/
