/******************************************************************************/


import fs from 'fs';
import path from 'path';
import { parse as parseToml } from 'smol-toml';
import JSON5 from 'json5';
import { addCheck } from '@axel669/aegis';
import { Miniflare } from 'miniflare';


/******************************************************************************/

/*
 * Initializes some custom Aegis checks that make testing easier.
 *
 * This is entirely optional and is a basic extension of the tests that are
 * available by default in Aegis.
 */
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
}


/******************************************************************************/

/**
 * Loads and parses a wrangler configuration file.
 * Supports .toml and .jsonc extensions.
 *
 * @param {string} filename - The path to the wrangler config file.
 * @returns {object} The parsed configuration object.
 * @throws {Error} If the file extension is not .toml or .jsonc.
 */
function loadWranglerConfig(filename) {
  const extension = path.extname(filename);
  const content = fs.readFileSync(filename, 'utf8');

  if (extension === '.toml') {
    return parseToml(content);
  }

  if (extension === '.jsonc') {
    return JSON5.parse(content);
  }

  throw new Error(`Unsupported config file extension: '${extension}'. Must be .toml or .jsonc.`);
}

/**
 * Adapts a wrangler.toml-like configuration object into the format required
 * by the Miniflare constructor.
 *
 * @param {object} config - The wrangler.toml-like configuration.
 * @returns {object} The options object for the Miniflare constructor.
 */
function createMiniflareOptions(config) {
  const options = {};

  // Map wrangler.toml keys to Miniflare constructor keys
  if (config.main) {
    options.scriptPath = config.main;
  }
  if (config.d1_databases) {
    options.d1Databases = config.d1_databases.map(db => db.binding);
  }
  if (config.kv_namespaces) {
    options.kvNamespaces = config.kv_namespaces.map(kv => kv.binding);
  }
  if (config.r2_buckets) {
    options.r2Buckets = config.r2_buckets.map(r2 => r2.binding);
  }
  if (config.queues?.producers) {
    options.queues = config.queues.producers.map(q => q.binding);
  }
  if (config.durable_objects?.bindings) {
    options.durableObjects = Object.fromEntries(
      config.durable_objects.bindings.map(obj => [obj.name, obj.class_name])
    );
  }
  if (config.vars) {
    options.bindings = { ...config.vars };
  }
  // CORRECT MAPPING: [assets] in wrangler.toml maps to the 'assets' option in Miniflare.
  if (config.assets) {
    options.assets = {
        binding: config.assets.binding,
        directory: config.assets.directory,
    }
  }

  return options;
}

/**
 * An Aegis helper function for the `setup` hook. It creates a Miniflare
 * instance configured with bindings defined in the provided configuration.
 *
 * The provided Aegis context (e.g., runScope) will be populated with:
 * - `worker`: The Miniflare instance.
 * - `env`: An object containing all the configured bindings, ready for use.
 *
 * @param {object} ctx - The Aegis context object (e.g., runScope).
 * @param {string|object} config - A configuration object, or a string path to a
 * wrangler.toml/jsonc configuration file.
 */
 export async function aegisSetup(ctx, config) {
  let finalConfig = config || {};
  let originalCwd = null;

  try {
    // If loading from a file, temporarily change the CWD to that file's directory.
    if (typeof finalConfig === 'string') {
      const configFile = finalConfig;
      const configFileDir = path.dirname(configFile);

      originalCwd = process.cwd();
      process.chdir(configFileDir);

      finalConfig = loadWranglerConfig(path.basename(configFile));
    }

    const miniflareOptions = createMiniflareOptions(finalConfig);

    // Always use modules, and provide a default empty script if a real one isn't specified.
    miniflareOptions.modules = true;
    if (miniflareOptions.scriptPath === undefined) {
      miniflareOptions.script = 'export default {}';
    }

    console.log(`(Aegis) Final Miniflare options:`, miniflareOptions);

    ctx.worker = new Miniflare(miniflareOptions);

    await ctx.worker.ready;
    ctx.env = {};

    // Attach all bindings to the env object for easy access in tests.
    for (const [idx, name] of (miniflareOptions.d1Databases || []).entries()) {
      console.log(`(Aegis) Attaching binding: name='${name}', type='D1', options=`, finalConfig.d1_databases[idx]);
      ctx.env[name] = await ctx.worker.getD1Database(name);
    }
    for (const [idx, name] of (miniflareOptions.kvNamespaces || []).entries()) {
      console.log(`(Aegis) Attaching binding: name='${name}', type='KV', options=`, finalConfig.kv_namespaces[idx]);
      ctx.env[name] = await ctx.worker.getKVNamespace(name);
    }
    for (const [idx, name] of (miniflareOptions.r2Buckets || []).entries()) {
      console.log(`(Aegis) Attaching binding: name='${name}', type='R2', options=`, finalConfig.r2_buckets[idx]);
      ctx.env[name] = await ctx.worker.getR2Bucket(name);
    }
    for (const [idx, name] of (miniflareOptions.queues || []).entries()) {
      console.log(`(Aegis) Attaching binding: name='${name}', type='Queue', options=`, finalConfig.queues.producers[idx]);
      ctx.env[name] = await ctx.worker.getQueue(name);
    }
    for (const [name, className] of Object.entries(miniflareOptions.durableObjects || {})) {
      const options = finalConfig.durable_objects.bindings.find(b => b.name === name);
      console.log(`(Aegis) Attaching binding: name='${name}', type='DurableObject', options=`, options);
      ctx.env[name] = await ctx.worker.getDurableObjectNamespace(name);
    }

    // Get simple key-value and asset bindings
    const bindings = await ctx.worker.getBindings();
    for (const key in (miniflareOptions.bindings || {})) {
      console.log(`(Aegis) Attaching binding: name='${key}', type='Var', value='${finalConfig.vars[key]}'`);
      ctx.env[key] = bindings[key];
    }
    if (miniflareOptions.assets) {
      const key = miniflareOptions.assets.binding;
      console.log(`(Aegis) Attaching binding: name='${key}', type='Assets', options=`, finalConfig.assets);
      ctx.env[key] = bindings[key];
    }
  } finally {
    // Restore the original working directory if it was changed.
    if (originalCwd) {
      process.chdir(originalCwd);
    }
  }
}


/******************************************************************************/


/**
 * An Aegis helper funciton used to tear down a Miniflare instance that was set
 * up via a call to aegisSetup().
 *
 * This should be invoked in the teardown hook that associates with the setup
* hook in which you invoked the setup function. */
export async function aegisTeardown(ctx) {
  if (ctx.worker !== undefined && ctx.worker !== null) {
    await ctx.worker.dispose();
  }

  if (ctx.env !== undefined && ctx.env !== null) {
    for (const key of Object.keys(ctx.env)) {
        delete ctx.env[key];
    }
  }

  delete ctx.worker;
  delete ctx.env;
}


/******************************************************************************/


// --- Test Runner Snippet ---

(async () => {
  // 1. Define the Aegis context and the path to your config file.
  const ctx = {};
  const configFile = '/home/odatnurd/local/src/luddatumbazo/wrangler.toml';

  console.log(`--- Running Aegis setup with config: ${configFile} ---`);

  try {
    // 2. Call the setup function with the context and config file.
    await aegisSetup(ctx, configFile);

    // 3. Log the resulting environment to verify it was created correctly.
    console.log('--- Setup Complete. Resulting ctx.env: ---');
    for (const key of Object.keys(ctx.env)) {
      console.log(`  - ${key}:`, ctx.env[key]);
    }

  } catch (error) {
    console.error('--- Test snippet failed ---:', error);
  } finally {
    // 4. Always run the teardown function to clean up resources.
    console.log('--- Tearing Down ---');
    await aegisTeardown(ctx);
    console.log('--- Teardown Complete ---');
  }
})();
