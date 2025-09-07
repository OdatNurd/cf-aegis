/******************************************************************************/


import { Miniflare } from 'miniflare';
import { addCheck } from '@axel669/aegis';

import path from 'path';

import { loadWranglerConfig, createMiniflareOptions } from './wrangler.js'


/******************************************************************************/


/* This is a helper function that determines if two Javascript values are
 * considered to be equal, with recursion being used to ensure that if the
 * values provided are objects that those objects are either literally the same
 * or considered the same by having an equivalent content.
 *
 * The returns value is true if the two values are identical or false if they
 * are not. */
function isDeepEqual(a, b) {
  // If the two values we were given are literally identical to each other, we
  // can stop now. This catches non-object values as well as objects that are
  // literally the same reference.
  if (a === b) {
    return true;
  }

  // The two values are not strictly identical. They need to each be an object
  // for us to want to continue.
  //
  // This also ensures that we don't throw errors by trying to pull keys from
  // something that's not an object.
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  // The above will fall through to here if both values are objects, but an
  // Array is also an object, and you can fetch its indices as keys, which means
  // that we can mistakenly thing that an array and an object with numeric keys
  // are identical; so both either need to be an array or both need not to be.
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  // We have two distinct objects. Collect the keys from both objects so that
  // we can compare them. If these are not the same length then we already know
  // that this compare will fail and we can short circuit exit.
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
    if (keysB.includes(key) === false || isDeepEqual(a[key], b[key]) === false) {
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
export function initializeCustomChecks() {
  // Check that a value is an array.
  addCheck.value.isArray(
    source => Array.isArray(source) === true
  );

  // Check that a value is NOT an array.
  addCheck.value.isNotArray(
    source => Array.isArray(source) === false
  );

  // Check that a value is a plain object.
  addCheck.value.isObject(
    source => source !== null && typeof source === 'object' && source.constructor === Object
  );

  // Check that a value is NOT a plain object.
  addCheck.value.isNotObject(
    source => source === null || typeof source !== 'object' || source.constructor !== Object
  );

  // Check that a value is an object that has a specific number of keys.
  addCheck.value.keyCount(
    (object, length) => Object.keys(object).length === length
  );

  // Check that a value is a function.
  addCheck.value.isFunction(
    source => source instanceof Function
  );

  // Check that a value is NOT a function.
  addCheck.value.isNotFunction(
    source => (source instanceof Function) === false
  );

  // Check that two values are equal, using deep recursion to verify that any
  // contents of arrays and objects are also identical.
  addCheck.value.deepEquals(
    (source, expected) => isDeepEqual(source, expected)
  );

  // Check that two values are NOT equal, using deep recursion.
  addCheck.value.notDeepEquals(
    (source, expected) => isDeepEqual(source, expected) === false
  );
}


/******************************************************************************/


/* An Aegis helper function for the `setup` hook. It creates a Miniflare
 * instance configured with bindings defined in the provided configuration.
 *
 * The input config can be either a Miniflare configuration object or a path
 * containing a Wrangler configuration file (in either TOML or JSONC format).
 *
 * If a filename is provided, that file is loaded and parsed to get the config
 * needed; otherwise, it is assumed that the configuration that is passed in is
 * consistent and valid.
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
 */
 export async function aegisSetup(ctx, inputConfig, workerMocks = {}) {
  // By default, we assume that the configuration does not tell us to listen for
  // incoming connections.
  ctx.isServerListening = false;

  // If we load a configuration file we need to change the working directory;
  // this stores what the working dir was before that, so we can put it back
  // before we proceed.
  let originalCwd = null;

  // Our initial config is what was provided, but as a guard, assume an empty
  // object.
  let config = inputConfig || {};

  try {
    // If the input configuration was given to us as a string, then it is a
    // wrangler configuration file. Paths in the file are relative to the
    // current directory, so temporarily switch to that folder and load the
    // config.
    if (typeof config === 'string') {
      // Capture the current working directory, and then temporarily swap to the
      // one that contains the configuration file.
      originalCwd = process.cwd();
      process.chdir(path.dirname(config));

      // Load the configuration file now; since we are in the location of that
      // file, we only need the name.
      config = loadWranglerConfig(path.basename(config));
    }

    // Convert the configuration (either loaded or not) into an object that is
    // appropriate for Miniflare.
    const miniflareOptions = createMiniflareOptions(config, workerMocks);

    // If the Miniflare options include a port, it means we need to set up
    // our context for a listening server.
    if (miniflareOptions.port !== undefined) {
      // Turn on the flag that indicates that we're listening, and set what our
      // inner base URL will be.
      ctx.isServerListening = true;
      ctx.serverBaseUrl = `http://${miniflareOptions.host}:${miniflareOptions.port}`;
    }

    // Look up the worker that is the main worker (it should be the first one
    // but better safe than sorry); if it does not list a script or a script
    // path, then insert a simple stub; this allows Miniflare to fire even if
    // no worker is defined, with a base handler.
    const mainWorker = miniflareOptions.workers.find(w => w.name === 'main');
    if (mainWorker &&
        (mainWorker.script === undefined || mainWorker.script === null) &&
        (mainWorker.scriptPath === undefined || mainWorker.scriptPath === null)) {
      mainWorker.script = 'export default {}';
    }

    // console.debug(`miniflare options:`, JSON.stringify(miniflareOptions, null, 2));

    // Create the worker, and then fetch all of the bindings that exist on the
    // main worker.
    ctx.worker = new Miniflare(miniflareOptions);
    ctx.env = await ctx.worker.getBindings('main');

    // The test suite may want to perform a fetch test by actually mimicking a
    // fetch call; this helper makes that easier by allowing URL fragment
    // fetches to hit the worker without having to know what the configured
    // port is.
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
    if (ctx.isServerListening) {
      console.log(`miniflare server is listening on ${ctx.serverBaseUrl}`);
    }
  }

  finally {
    // No matter how we leave the try block, make sure that the working
    // directory is put back to what it started at.
    if (originalCwd !== null) {
      process.chdir(originalCwd);
    }
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
  delete ctx.serverBaseUrl;
}


/******************************************************************************/
