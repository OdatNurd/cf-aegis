/******************************************************************************/


import { Miniflare } from 'miniflare';
import { aegis } from '@axel669/aegis';

import path from 'node:path';

import { loadTestEnvironment } from './env.js'
import { loadWranglerConfig } from './wrangler.js'
import { resolveEnvironmentConfig } from './config.js'
import { createMiniflareOptions, applyAssetRouterWorkaround, applyModuleRoots } from './miniflare.js'


/******************************************************************************/


// The appropriate handling for static assets is to use the options outlined
// here to tell Miniflare to serve files that are in the configured folder, with
// the binding being used to actually fetch such assets. Miniflare should handle
// this by trying assets first and then falling back.
//
// However it does not do this; instead the asset handler takes full control.
// This appears to be a bug in Miniflare.
//
// If this is set to true, then we apply a workaround by applying a proxy router
// to the worker stack as the first worker in order to serve the assets, and
// remove that information from the configuration at the point where it is
// applied to miniflare.
const APPLY_ASSET_WORKAROUND = true;


/******************************************************************************/


/* This is a helper function that determines if two JavaScript values are
 * considered to be equal, with recursion being used to ensure that if the
 * values provided are objects that those objects are either literally the same
 * or considered the same by having an equivalent content.
 *
 * The returns value is true if the two values are identical or false if they
 * are not. */
function isDeepEqual(a, b, seen = new WeakMap()) {
  // Identical references and primitive values are equal. Handle NaN as a
  // value that is equal to itself for the purpose of these checks.
  if (a === b) {
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number' &&
      Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }

  // The two values are not strictly identical. They need to each be an object
  // for us to want to continue.
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  // An Array is also an object, and numeric keys can make it look like an
  // object; both values must agree about whether they are arrays.
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  // Track pairs that are already being compared. This makes cyclic structures
  // terminate while still allowing distinct cyclic structures to compare equal.
  let compared = seen.get(a);
  if (compared !== undefined && compared.has(b) === true) {
    return true;
  }
  if (compared === undefined) {
    compared = new WeakSet();
    seen.set(a, compared);
  }
  compared.add(b);

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }

  if (a instanceof Map || b instanceof Map) {
    if ((a instanceof Map) === false || (b instanceof Map) === false || a.size !== b.size) {
      return false;
    }

    for (const [key, value] of a) {
      if (b.has(key) === false || isDeepEqual(value, b.get(key), seen) === false) {
        return false;
      }
    }
    return true;
  }

  if (a instanceof Set || b instanceof Set) {
    if ((a instanceof Set) === false || (b instanceof Set) === false || a.size !== b.size) {
      return false;
    }

    const remaining = [...b];
    for (const value of a) {
      const index = remaining.findIndex(other => isDeepEqual(value, other, seen));
      if (index === -1) {
        return false;
      }
      remaining.splice(index, 1);
    }
    return true;
  }

  // Collect the keys from both objects. If these are not the same length then
  // the compare cannot succeed.
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }

  // The two objects may be equal to each other, since we know that they are
  // each objects with the same number of keys.
  //
  // To verify we scan over all of the keys in the first object and ensure that
  // they exist in the second object, and that their values are identical via
  // a recursive call to ourselves.
  for (const key of keysA) {
    if (keysB.includes(key) === false || isDeepEqual(a[key], b[key], seen) === false) {
      return false;
    }
  }

  // If we get here, the objects we were given must be equal.
  return true;
}


/******************************************************************************/


/* Initializes some custom Aegis checks that make testing easier. The intention
 * is to extend the base test suite with tests that may be commonly used in
 * projects without having to continually re-implement.
 *
 * As such, this is an entirely optional call and is not needed. */
export function initializeCustomChecks(aegisApi = aegis) {
  // Check that a value is an array.
  aegisApi.createAssertion({
    name: 'isArray',
    type: 'value',
    run: source => Array.isArray(source) === true
  });

  // Check that a value is NOT an array.
  aegisApi.createAssertion({
    name: 'isNotArray',
    type: 'value',
    run: source => Array.isArray(source) === false
  });

  // Check that a value is a plain object.
  aegisApi.createAssertion({
    name: 'isObject',
    type: 'value',
    run: source => source !== null && typeof source === 'object' && source.constructor === Object
  });

  // Check that a value is NOT a plain object.
  aegisApi.createAssertion({
    name: 'isNotObject',
    type: 'value',
    run: source => source === null || typeof source !== 'object' || source.constructor !== Object
  });

  // Check that a value is an object that has a specific number of keys.
  aegisApi.createAssertion({
    name: 'keyCount',
    type: 'value',
    run: (object, length) => object !== null &&
      typeof object === 'object' &&
      Object.keys(object).length === length
  });

  // Check that a value is a function.
  aegisApi.createAssertion({
    name: 'isFunction',
    type: 'value',
    run: source => source instanceof Function
  });

  // Check that a value is NOT a function.
  aegisApi.createAssertion({
    name: 'isNotFunction',
    type: 'value',
    run: source => (source instanceof Function) === false
  });

  // Check that two values are equal, using deep recursion to verify that any
  // contents of arrays and objects are also identical.
  aegisApi.createAssertion({
    name: 'deepEquals',
    type: 'value',
    run: (source, expected) => isDeepEqual(source, expected)
  });

  // Check that two values are NOT equal, using deep recursion.
  aegisApi.createAssertion({
    name: 'notDeepEquals',
    type: 'value',
    run: (source, expected) => isDeepEqual(source, expected) === false
  });

  // Check that a function throws, optionally with an exact error message.
  // Aegis' built-in throws assertion only checks that something was thrown; a
  // number of the helpers in this package promise a specific message.
  aegisApi.createAssertion({
    name: 'throwsMessage',
    type: 'func',
    run: (result, expected) => result.ok === false &&
      (expected === undefined || result.error?.message === expected),
    error: (_result, expected) => expected === undefined
      ? 'Expected function to throw'
      : `Expected function to throw ${JSON.stringify(expected)}`
  });
}


/******************************************************************************/


/* An Aegis helper function for the `setup` hook. It creates a Miniflare
 * instance configured with bindings defined in the provided configuration.
 *
 * The input config can be either a Miniflare configuration object or a path
 * containing a Wrangler configuration file (in TOML, JSON, or JSONC format).
 *
 * If a filename is provided, that file is loaded and parsed to get the config
 * needed; otherwise, it is assumed that the configuration that is passed in is
 * consistent and valid.
 *
 * The `helperOptions` argument allows for customizing the setup:
 * - `portAdjustment`: An integer to add to the configured port (default: 0)
 * - `workerMocks`: An object containing mock worker definitions (default: {})
 * - `env`: The name of the environment configuration to utilize
 *          (default: undefined)
 *
 * The provided Aegis context (e.g., runScope) will be populated with:
 * - `worker`: The Miniflare instance.
 * - `env`: An object containing all the configured bindings, ready for use.
 * - `isServerListening`: true if the configuration file included dev server
 *    configuration, false otherwise.
 * - `serverBaseUrl`: the base URL the server is listening on (if it is)
 * - `fetch`: A function to perform a fetch style operation against the worker
 *            defined, with automatic handling for knowing what the bound port
 *            is; if the server is not listening, this will generate an error
 *            response instead.
 *
 * Resolve the file paths in a Wrangler config relative to the directory that
 * contains the configuration file. Aegis 0.4 runs test files in worker threads,
 * where process.chdir() is unavailable, so setup must not depend on changing
 * the process working directory. *sigh*. */
function resolveConfigPaths(config, baseDir) {
  const resolved = { ...config };

  if (typeof resolved.main === 'string') {
    resolved.main = path.resolve(baseDir, resolved.main);
  }

  if (resolved.assets !== undefined) {
    resolved.assets = {
      ...resolved.assets,
      directory: path.resolve(baseDir, resolved.assets.directory)
    };
  }

  return resolved;
}


export async function aegisSetup(ctx, inputConfig, helperOptions = {}) {
  // Pull the options we want out of the provided helper options, setting up a
  // default if they are missing.
  const { portAdjustment = 0, workerMocks = {}, env: targetEnv } = helperOptions;

  // Validate the adjustment before changing the context; a bad value should
  // fail cleanly rather than producing a string or an out-of-range port.
  if (Number.isInteger(portAdjustment) === false) {
    throw new TypeError('portAdjustment must be an integer');
  }

  // By default, we assume that the configuration does not tell us to listen for
  // incoming connections.
  ctx.isServerListening = false;

  // Keep the project root for relative reporting; the directory containing a
  // loaded config file is tracked separately below.
  const rootDir = process.cwd();

  // Our initial config is what was provided, but as a guard, assume an empty
  // object.
  let rawConfig = inputConfig || {};
  let createdWorker;
  let configDir = rootDir;

  try {
    // If the input configuration was given to us as a string, then it is a
    // wrangler configuration file. Paths in that file are relative to the file
    // itself, so load it and keep track of its directory without changing the
    // process working directory.
    if (typeof rawConfig === 'string') {
      const configPath = path.resolve(rootDir, rawConfig);
      configDir = path.dirname(configPath);
      rawConfig = loadWranglerConfig(configPath);
    }

    // Resolve the raw configuration down to the requested environment.
    const config = resolveConfigPaths(
      resolveEnvironmentConfig(rawConfig, targetEnv),
      configDir
    );

    // Load in the test environment variables so that we can merge them into the
    // appropriate bindings array.
    const testEnvVars = loadTestEnvironment(config, targetEnv, rootDir, configDir);

    // Convert the configuration (either loaded or not) into an object that is
    // appropriate for Miniflare.
    const miniflareOptions = createMiniflareOptions(config, workerMocks);

    // If the Miniflare options include a port, it means we need to set up
    // our context for a listening server.
    if (miniflareOptions.port !== undefined) {
      // Apply the port adjustment. This allows us to shift the port used by
      // tests so they don't collide with a local dev instance running on the
      // default port.
      if (Number.isInteger(miniflareOptions.port) === false) {
        throw new TypeError('dev.port must be an integer');
      }

      const adjustedPort = miniflareOptions.port + portAdjustment;
      if (adjustedPort < 1 || adjustedPort > 65535) {
        throw new RangeError('dev.port plus portAdjustment must be between 1 and 65535');
      }
      miniflareOptions.port = adjustedPort;

      // Turn on the flag that indicates that we're listening, and set what our
      // port and inner base URL will be.
      ctx.isServerListening = true;
      ctx.serverPort = miniflareOptions.port;
      ctx.serverBaseUrl = `http://${miniflareOptions.host}:${miniflareOptions.port}`;
    }

    // Look up the worker that is the main worker (it should be the first one
    // but better safe than sorry); if it does not list a script or a script
    // path, then insert a simple stub; this allows Miniflare to fire even if no
    // worker is defined, with a base handler.
    const mainWorker = miniflareOptions.workers.find(w => w.name === 'main');
    if (mainWorker !== undefined &&
        (mainWorker.script === undefined || mainWorker.script === null) &&
        (mainWorker.scriptPath === undefined || mainWorker.scriptPath === null)) {
      mainWorker.script = 'export default {}';
    }

    // console.debug(`miniflare options:`, JSON.stringify(miniflareOptions, null, 2));

    // If we are supposed to apply the asset workaround, do that now, at the
    // last possible second before we create the object.
    if (APPLY_ASSET_WORKAROUND === true) {
      applyAssetRouterWorkaround(miniflareOptions.workers);
    }

    // Miniflare names modules relative to `modulesRoot`, which defaults to the
    // working directory. Ensure that scripts on disk stay inside that root so
    // that tests do not depend on running from the configuration's directory.
    applyModuleRoots(miniflareOptions.workers);

    // Update the environment of the workers; we patch in any environment
    // variables that we might have loaded, as well as ensuring that the
    // variable that lets tested code know it's being tested is defined.
    for (const worker of miniflareOptions.workers) {
      if (worker.bindings === undefined) {
        worker.bindings = {};
      }

      // If this is the main worker, then apply any environment variables that
      // we got to the bindings on top of what is already present.
      if (worker.name === 'main') {
        Object.assign(worker.bindings, testEnvVars);
      }

      // Any worker that does not have the test definition variable set to
      // something explicitly should have that value set.
      if (worker.bindings.CF_AEGIS === undefined) {
        worker.bindings.CF_AEGIS = 'true';
      }
    }

    // Create the worker, and then fetch all of the bindings that exist on the
    // main worker. Keep a local reference so a failure after construction can
    // dispose of the Miniflare instance instead of leaking it.
    createdWorker = new Miniflare(miniflareOptions);
    ctx.worker = createdWorker;
    ctx.env = await ctx.worker.getBindings('main');

    // The test suite may want to perform a fetch test by actually mimicking a
    // fetch call; this helper makes that easier by allowing URL fragment
    // fetches to hit the worker without having to know what the configured port
    // is.
    ctx.fetch = async (url, init) => {
      // If the server is not actually listening, then generate a failure
      // response.
      if (ctx.isServerListening === false) {
        return new Response('Fetch aborted: Miniflare server is not configured to listen on a port.',
          { status: 503, statusText: 'Service Unavailable' });
      }

      // If the incoming URL is a fragment, convert it into a a full URL based
      // on our configured base; this allows the caller to hit '/api/thing'
      // without having to know what port the server is listening on.
      let finalUrl = url;
      if (url.startsWith('http') === false) {
        finalUrl = new URL(url, ctx.serverBaseUrl).toString();
      }

      // Do the fetch now.
      return fetch(finalUrl, init);
    };

    // Tell the user if the server is listening.
    if (ctx.isServerListening === true) {
      console.log(`[cf-aegis] miniflare server is listening on ${ctx.serverBaseUrl}`);
    }
  } catch (error) {
    // If setup failed after the instance was created, clean it up before
    // propagating the original error.
    if (createdWorker !== undefined && createdWorker !== null) {
      try {
        await createdWorker.dispose();
      } catch {
        // Preserve the setup error; disposal is best-effort cleanup.
      }
    }

    delete ctx.worker;
    delete ctx.env;
    delete ctx.fetch;
    delete ctx.isServerListening;
    delete ctx.serverPort;
    delete ctx.serverBaseUrl;

    throw error;
  }
}


/******************************************************************************/


/* An Aegis helper function used to tear down a Miniflare instance that was set
 * up via a call to aegisSetup().
 *
 * This should be invoked in the teardown hook that associates with the setup
* hook in which you invoked the setup function. */
export async function aegisTeardown(ctx) {
  if (ctx.worker !== undefined && ctx.worker !== null) {
    await ctx.worker.dispose();
  }

  delete ctx.worker;
  delete ctx.env;
  delete ctx.fetch;
  delete ctx.isServerListening;
  delete ctx.serverPort;
  delete ctx.serverBaseUrl;
}


/******************************************************************************/
