/******************************************************************************/


import path from 'path';


/******************************************************************************/


/* When converting from a Wrangler configuration to a Miniflare configuration,
 * these keys represent a direct 1:1 mapping of keys in the wranger config
 * object to keys in the output object, although their name may change.
 *
 * These are all treated as optional; note that 'main' is actually a required
 * field, but for our test case purposes we treat it as optional and later
 * back-fill it with a stub when setting up the worker, so that tests that
 * don't need a worker don't need to explicitly define one. */
const keyMappings = [
  { source: 'main', target: 'scriptPath' },
  { source: 'compatibility_date', target: 'compatibilityDate' },
  { source: 'compatibility_flags', target: 'compatibilityFlags' },
];

/* When converting from a Wrangler configuration to a Miniflare configuration,
 * these keys represent configuration options that are specified as arrays of
 * objects which contain (among other things) a 'binding' key that specifies
 * the name, but for which Miniflare requires only an array of names.
 *
 * For example, R2 mappings is a set of objects that indicate binding names and
 * the buckets that associate with them, but in Miniflare only the binding names
 * are needed.*/
const arrayMappings = [
  { source: 'kv_namespaces', target: 'kvNamespaces' },
  { source: 'r2_buckets', target: 'r2Buckets' },
];

/* When converting from a Wrangler configuration to a Miniflare configuration,
 * these keys represent configuration options that are arrays of objects, but
 * unlike the above instead of being an array of names, they need to be given
 * to Miniflare as objects where the keys are names of things and the value
 * is the configured identifier.
 *
 * For example, the D1 databases would be an object where the keys are binding
 * names and the values are the database ID (used to construct the name of the
 * persisted DB, if that is turned on).
 *
 * Technically, the services key is also one of these, but it is handled
 * distinctly because we take mock service configurations into account. */
const objectMappings = [
  {
    source: 'queues.producers', target: 'queueProducers',
    key: 'binding', value: 'queue'
  },
  {
    source: 'queues.consumers', target: 'queueConsumers',
    key: 'queue', staticValue: {}
  },
  {
    source: 'd1_databases', target: 'd1Databases',
    key: 'binding', value: 'database_id'
  },
  {
    source: 'durable_objects.bindings', target: 'durableObjects',
    key: 'name', value: 'class_name'
  },
];


/******************************************************************************/


/* This helper adapts an object structured as a Wrangler configuration file into
 * the structure that is required by the Miniflare constructor, which has a
 * similar but not fully identical layout. The structure of this object is
 * what you would see if you parsed a (valid) wrangler config fle.
 *
 * Wrangler configurations can contain service bindings to other workers, but
 * such workers are leveraged by the worker being defined in the configuration
 * and so for the purposes of unit testing they may need to exist so that they
 * can be accessed, but they need not be complete.
 *
 * The workerMocks allows for mapping in mock workers that associate with such
 * bindings to facilitate testing. If the incoming configuration lists a binding
 * to another worker but there is no mock for it, a stub mock will be inserted
 * in its place. In this object, the keys are the names of the services while
 * the object has a "script" or "scriptPath" argument to declare the script or
 * the file that contains the script, respetively.
 *
 * Note that that wrangler configuration can contain more configuration keys
 * than those that are handled here; keys not mentioned are silently ignored. */
export function createMiniflareOptions(config, workerMocks) {
  // The configuration options for the main worker. If the config does not
  // contain any other service bindings, this will be the only worker.
  const mainWorker = {
    name: "main",
    modules: true,
    bindings: {},
  };

  // The list of defined workers. The code always uses an array of workers even
  // if there is only ever one, for simplicity, since the way top level bindings
  // are handled is different depending on whether or there are multiple
  // workers and that's a headache we don't need.
  const workers = [mainWorker];

  // Defined environment variables are a simple mapping directly into the list
  // of bindings in the object.
  if (config.vars !== undefined) {
    mainWorker.bindings = { ...config.vars };
  }

  // If static assets are defined, they go directly into the worker config with
  // identical keys.
  if (config.assets !== undefined) {
    const { binding, directory } = config.assets;
    mainWorker.assets = { binding, directory };
  }

  // Iterate over and apply all of the direct key mappings into the config,
  // should they exist.
  for (const mapping of keyMappings) {
    if (config[mapping.source] !== undefined) {
      mainWorker[mapping.target] = config[mapping.source];
    }
  }

  // Now handle all of the mappings that just need to be arrays of names.
  for (const mapping of arrayMappings) {
    if (config[mapping.source]) {
      mainWorker[mapping.target] = config[mapping.source].map(item => item.binding);
    }
  }

  // Now handle all of the mappings that convert from an array of objects into
  // a single object where the keys and values convey the full information.
  for (const mapping of objectMappings) {
    // Helper to access nested properties like 'queues.producers'
    const getSourceArray = (config, path) => {
      return path.split('.').reduce((obj, key) => obj && obj[key], config);
    };

    const sourceArray = getSourceArray(config, mapping.source);

    if (sourceArray) {
      mainWorker[mapping.target] = Object.fromEntries(
        sourceArray.map(item => [item[mapping.key], mapping.staticValue ?? item[mapping.value]])
      );
    }
  }

  // Services is a special case; for every service that is defined (if any) we
  // need to create a new worker item and add it to the workers array, but also
  // the list of
  if (config.services !== undefined) {
    // As with above, all services need to be added to the main worker's
    // service bindings as an object in which the keys are the name of the
    // binding and the value is the name of the worker it's bound to.
    mainWorker.serviceBindings = Object.fromEntries(
      config.services.map(service => [service.binding, service.service])
    );

    // Create a new version of the list of services that are defined, turning
    // the basic information in the configuration into the minimal amount of
    // config that is needed to define a worker in Miniflare.
    //
    // This utilizes information from the mock workers to set up the endpoints.
    const mockWorkers = config.services.map(service => {
      // Alias the name of the service, for sanity.
      const serviceName = service.service;

      // If there is an entry in the workerMocks array for a service of this
      // name, then we can use the information from it to directly inject into
      // the output.
      if (workerMocks[serviceName] !== undefined) {
        console.log(`mocking service '${serviceName}' with provided script.`);
        return { name: serviceName, modules: true, ...workerMocks[serviceName] };
      }

      // If we fall through, there was no definition for this service in the
      // list of mocked services. In this case, we inject a static script so
      // that the service at least functions, but it will return a response that
      // indicates that it's not mocked.
      console.log(`warning: no mock provided for service '${serviceName}'; applying default mock`);
      return {
        name: serviceName,
        modules: true,
        script: `
          export default {
            fetch(request) {
              console.log(\`(cf-aegis) mock for service '${serviceName}' received a request for: \${request.url}\`);
              return new Response('Service not implemented in test environment', { status: 404 });
            }
          }
        `,
      };
    });

    // Add the workers to the configuration now.
    workers.push(...mockWorkers);
  }

  // The final shape of the configuration is an object with a key that is the
  // workers defined, which could be either one or many.
  const miniflareOptions = { workers };

  // If the configuration includes development server options, then we want
  // to add them to the top-level options for Miniflare.
  if (config.dev?.port !== undefined) {
    miniflareOptions.host = config.dev.hostname || '127.0.0.1';
    miniflareOptions.port = config.dev.port;
  }

  return miniflareOptions;
}


/******************************************************************************/
