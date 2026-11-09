/******************************************************************************/


import { aegis, $ } from "@axel669/aegis";

import fs from 'node:fs';
import path from 'node:path';

import { loadWranglerConfig } from '../lib/wrangler.js';
import { resolveEnvironmentConfig } from '../lib/config.js';
import { loadTestEnvironment } from '../lib/env.js';
import { createMiniflareOptions } from '../lib/miniflare.js';
import { initializeCustomChecks } from '../lib/index.js';


initializeCustomChecks();


/******************************************************************************/


export const name = "Environment Variable Loading";


// Dynamically generate the required test folders and files so that when we run
// we are ready to go.
const rootDir = process.cwd();
const testDir1 = path.resolve(rootDir, 'test/envTest1');
const testDir2 = path.resolve(rootDir, 'test/envTest2');

if (fs.existsSync(testDir1) === false) {
  fs.mkdirSync(testDir1, { recursive: true });
}
if (fs.existsSync(testDir2) === false) {
  fs.mkdirSync(testDir2, { recursive: true });
}

// -----------------------------------------------------------------------------
// Setup envTest1 files (Mutually Exclusive .vars Precedence)
// -----------------------------------------------------------------------------
fs.writeFileSync(path.join(testDir1, 'wrangler.jsonc'), JSON.stringify({
  name: "env-test-1",
  main: "./worker.js",
  vars: {
    TOP_VAR: "top_val",
    SHARED_VAR: "top_shared"
  },
  env: {
    dev: {
      vars: {
        DEV_VAR: "dev_val",
        SHARED_VAR: "dev_shared"
      }
    }
  }
}, null, 2));

fs.writeFileSync(path.join(testDir1, '.test.vars'), `
SHARED_VAR="vars_shared"
VARS_ONLY="vars_only_val"
`.trim());

fs.writeFileSync(path.join(testDir1, '.test.vars.dev'), `
SHARED_VAR="dev_vars_shared"
DEV_VARS_ONLY="dev_vars_only_val"
`.trim());

// -----------------------------------------------------------------------------
// Setup envTest2 files (Merged .env Precedence & Fallbacks)
// -----------------------------------------------------------------------------
fs.writeFileSync(path.join(testDir2, 'wrangler.jsonc'), JSON.stringify({
  name: "env-test-2",
  main: "./worker.js",
  vars: {
    CONFIG_VAR: "config_val"
  }
}, null, 2));

// Additional config specifically for testing secrets filtering.
//
// Because secrets are NON-INHERITABLE, if we are going to test against the
// 'dev' environment, the secrets must be explicitly defined in 'dev'.
fs.writeFileSync(path.join(testDir2, 'wrangler-secrets.jsonc'), JSON.stringify({
  name: "env-test-secrets",
  main: "./worker.js",
  env: {
    dev: {
      secrets: {
        required: ["BASE_ONLY", "LOCAL_ONLY"]
      }
    }
  }
}, null, 2));

// Additional config specifically for testing empty fallsbacks
fs.writeFileSync(path.join(testDir2, 'wrangler-empty.jsonc'), JSON.stringify({
  name: "env-test-empty",
  main: "./worker.js"
}, null, 2));

fs.writeFileSync(path.join(testDir2, '.test.env'), `
SHARED_VAR="base_shared"
BASE_ONLY="base_val"
`.trim());

fs.writeFileSync(path.join(testDir2, '.test.env.dev'), `
SHARED_VAR="dev_shared"
DEV_ONLY="dev_val"
`.trim());

fs.writeFileSync(path.join(testDir2, '.test.env.local'), `
SHARED_VAR="local_shared"
LOCAL_ONLY="local_val"
`.trim());

fs.writeFileSync(path.join(testDir2, '.test.env.dev.local'), `
SHARED_VAR="dev_local_shared"
DEV_LOCAL_ONLY="dev_local_val"
`.trim());


/******************************************************************************/


/* This helper function simulates the exact loading and merging process that
 * happens inside aegisSetup(), allowing us to test the final resolved bindings
 * that would be injected into the worker. */
function simulateAegisLoad(targetFolder, targetEnv, configFile = 'wrangler.jsonc') {
  // Aegis 0.4 runs tests in worker threads, where process.chdir() is not
  // available. Load the fixture with explicit paths instead.
  const rawConfig = loadWranglerConfig(path.join(targetFolder, configFile));
  const config = resolveEnvironmentConfig(rawConfig, targetEnv);
  const testEnvVars = loadTestEnvironment(config, targetEnv, rootDir, targetFolder);
  const miniflareOptions = createMiniflareOptions(config, {});

  // Locate the main worker and merge the resolved test environment variables
  const mainWorker = miniflareOptions.workers.find(w => w.name === 'main');
  if (mainWorker.bindings === undefined) {
    mainWorker.bindings = {};
  }
  Object.assign(mainWorker.bindings, testEnvVars);

  return mainWorker.bindings;
}


/******************************************************************************/


aegis.test`Mutually Exclusive .vars Files (envTest1)`(() => {
  // Run without environment should load .test.vars and top-level vars
  const baseBindings = simulateAegisLoad(testDir1, undefined);

  const expectedBase = {
    TOP_VAR: "top_val",
    SHARED_VAR: "vars_shared", // Overridden by .test.vars
    VARS_ONLY: "vars_only_val" // From .test.vars
  };

  $.check`Without env, loads .test.vars and overrides top-level config`(
    $.deepEquals(baseBindings, expectedBase)
  );

  // Run with 'dev' environment should load .test.vars.dev and dev-level vars
  const devBindings = simulateAegisLoad(testDir1, 'dev');

  const expectedDev = {
    DEV_VAR: "dev_val",                // From env.dev.vars
    SHARED_VAR: "dev_vars_shared",     // Overridden by .test.vars.dev
    DEV_VARS_ONLY: "dev_vars_only_val" // From .test.vars.dev
  };

  $.check`With env, loads .test.vars.dev and overrides environment config`(
    $.deepEquals(devBindings, expectedDev)
  );

  // Explicitly verify that no cross-contamination occurred
  $.check`Base bindings do not contain dev-only variables`(
    $.eq(baseBindings.DEV_VARS_ONLY, undefined)
  );

  $.check`Dev bindings do not contain base-only variables`(
    $.eq(devBindings.VARS_ONLY, undefined)
  );
});


/******************************************************************************/


aegis.test`Merged .env Files (envTest2)`(() => {
  // Run with 'dev' environment
  const mergedBindings = simulateAegisLoad(testDir2, 'dev');

  const expectedMerged = {
    BASE_ONLY: "base_val",           // From .test.env
    DEV_ONLY: "dev_val",             // From .test.env.dev
    LOCAL_ONLY: "local_val",         // From .test.env.local
    DEV_LOCAL_ONLY: "dev_local_val", // From .test.env.dev.local
    SHARED_VAR: "dev_local_shared"   // Highest precedence file wins the shared key
  };

  $.check`All 4 .env files load and merge with correct precedence`(
    $.deepEquals(mergedBindings, expectedMerged)
  );
});


/******************************************************************************/


aegis.test`Secrets Filtering`(() => {
  // Run with 'dev' environment but pointing to the secrets config
  const secretsBindings = simulateAegisLoad(testDir2, 'dev', 'wrangler-secrets.jsonc');

  const expectedSecrets = {
    BASE_ONLY: "base_val",
    LOCAL_ONLY: "local_val"
  };

  $.check`Loaded variables are strictly filtered to secrets.required`(
    $.deepEquals(secretsBindings, expectedSecrets)
  );

  $.check`Unrequired variables are discarded`(
    $.eq(secretsBindings.DEV_ONLY, undefined)
  );

  // The loader logs the variables that it loaded for debugging. Required
  // secrets must remain visible by name, but their values must never appear.
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    simulateAegisLoad(testDir2, 'dev', 'wrangler-secrets.jsonc');
  } finally {
    console.log = originalLog;
  }

  const output = logs.join('\n');
  $.check`Required secrets are logged with a redacted value`(
    $.includes(output, 'BASE_ONLY = [redacted]'),
    $.includes(output, 'LOCAL_ONLY = [redacted]')
  );

  $.check`Required secret values are not logged`(
    $.eq(output.includes('base_val') || output.includes('local_val'), false)
  );
});


/******************************************************************************/


aegis.test`Disable Dot-Env Loading`(() => {
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

  try {
    // Use the empty config to ensure absolutely nothing loads from config
    const emptyBindings = simulateAegisLoad(testDir2, 'dev', 'wrangler-empty.jsonc');

    $.check`Dot-env files are entirely skipped when flag is false`(
      $.eq(Object.keys(emptyBindings).length, 0)
    );
  } finally {
    delete process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV;
  }
});


/******************************************************************************/


aegis.test`Include Process Environment`(() => {
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'true';
  process.env.AEGIS_CROSS_PLATFORM_TEST = 'active';
  process.env.BASE_ONLY = 'process-secret';

  try {
    // Use the empty config. .test.env files WILL still load alongside the
    // process environment variables.
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let processBindings;
    try {
      processBindings = simulateAegisLoad(testDir2, 'dev', 'wrangler-empty.jsonc');
    } finally {
      console.log = originalLog;
    }

    $.check`Explicit cross-platform process variable is loaded`(
      $.eq(processBindings.AEGIS_CROSS_PLATFORM_TEST, 'active')
    );

    $.check`Standard .env files still load alongside process env`(
      $.eq(processBindings.BASE_ONLY, 'process-secret')
    );

    const output = logs.join('\n');
    $.check`Process-env overrides are labelled without printing their value`(
      $.includes(output, 'BASE_ONLY = [from process.env]')
    );

    $.check`Process-env values never appear in the debug output`(
      $.eq(output.includes('process-secret'), false)
    );
  } finally {
    delete process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV;
    delete process.env.AEGIS_CROSS_PLATFORM_TEST;
    delete process.env.BASE_ONLY;
  }
});


/******************************************************************************/
