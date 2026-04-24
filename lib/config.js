/******************************************************************************/


/* The list of keys that are known to the current configuration loader,
 * categorized by whether or not an environment specific version can inherit
 * from the top level configuration or not.
 *
 *  - Inheritable keys fall back to the top level definition if they are not
 *    explicitly defined within an environment.
 *
 *  - Non-inheritable keys must exist entirely independently per environment and
 *    never fall back to a top level definition. */
const INHERITABLE_KEYS = [
  'main',
  'compatibility_date',
  'compatibility_flags',
  'assets',
  'dev',
];

const NON_INHERITABLE_KEYS = [
  'vars',
  'kv_namespaces',
  'r2_buckets',
  'd1_databases',
  'durable_objects',
  'queues',
  'services',
  'secrets',
];


/******************************************************************************/


/* Takes a raw parsed Wrangler configuration object and an optional environment
 * name and returns back a resolved for that specific environment by applying
 * Cloudflare's inheritance rules.
 *
 * When envName is undefined, this extracts only the top level configuration
 * keys that the loader knows about.
 *
 * When an envName is provided, the inheritable keys are pulled from the top
 * level and then overridden by any of the inheritable keys from the specific
 * environment provided, followed by applying all of the non-inheritable keys
 * specified.
 *
 * The resolved configuration is returned back. */
 export function resolveEnvironmentConfig(rawConfig, envName) {
  const resolved = {};

  // When there is no environment specified, all we have to do is pull all of
  // the keys we know about from the top level config and put them into the
  // resulting config, which we then return back.
  if (envName === undefined) {
    for (const key of INHERITABLE_KEYS) {
      if (rawConfig[key] !== undefined) {
        resolved[key] = rawConfig[key];
      }
    }

    for (const key of NON_INHERITABLE_KEYS) {
      if (rawConfig[key] !== undefined) {
        resolved[key] = rawConfig[key];
      }
    }

    return resolved;
  }

  // An environment was specified, so the first thing we need to do is pull the
  // environment specific to that environment out into an object.
  const envConfig = rawConfig?.env?.[envName] ?? {};

  // Starting with inheritable keys, if there is a version of this key in the
  // environment specific config, then apply it to the resolved config;
  // otherwise, use whatever value was in the global section.
  for (const key of INHERITABLE_KEYS) {
    if (envConfig[key] !== undefined) {
      resolved[key] = envConfig[key];
    } else if (rawConfig[key] !== undefined) {
      resolved[key] = rawConfig[key];
    }
  }

  // Now we can grab all of the non-inheritable keys out of the configuration
  // and apply them to the configuration; if they don't exist in the env
  // portion, then they will not be used.
  for (const key of NON_INHERITABLE_KEYS) {
    if (envConfig[key] !== undefined) {
      resolved[key] = envConfig[key];
    }
  }

  return resolved;
}


/******************************************************************************/
