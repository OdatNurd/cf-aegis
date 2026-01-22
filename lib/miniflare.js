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


/* This internal helper function implements a workaround for an apparent bug in
 * Miniflare where using the 'assets' configuration causes requests to never
 * fall through to the user worker if the asset is missing.
 *
 * To fix this, if the main worker in the workers list has an asset configuration,
 * this will remove it and inject a new Router worker in the front that will
 * serve assets, and then if that fails it will forward the request to the
 * original main worker.
 *
 * This will safely do nothing if the main worker has no assets key. */
export function applyAssetRouterWorkaround(workers) {
  // The main worker is always the first one in the worker list; pull that out
  // here.
  const mainWorker = workers[0];
  const routerName = "asset-router";
  const storeName = "asset-store";

  // If there are no assets in the main worker, then we can leave; otherwise
  // alias the config object and remove the binding from the worker config so
  // that it does not cause us issues.
  const assetConfig = mainWorker.assets;
  if (assetConfig === undefined) {
    return;
  } else {
    delete mainWorker.assets;
  }

  // This worker does the heavy lifting; it uses the KV lookp provided by the
  // "worker sites" feature we turn on below and looks up the appropriate file,
  // returning it back. If the file is not present, it returns a 404 back.
  //
  // This represents what the bug in the current Miniflare asset handling is
  // doing when it's not suposed to.
  const storeScript = `
    // Pull in the static manifest that gets injected by the Miniflare runtime
    // when the "worker sites" feature is enabled, which happens when we set the
    // sitePath in the config below.
    //
    // It is a JSON string mapping file paths to the storage keys in KV.
    import manifestJSON from "__STATIC_CONTENT_MANIFEST";
    const manifest = JSON.parse(manifestJSON);

    // A small simple list of static mime types for common web assets; probably
    // not complete, but good enough for the purpose here.
    const MIME_TYPES = {
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      txt: 'text/plain',
      xml: 'text/xml',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      wasm: 'application/wasm'
    };

    // Get the mine type for the file at the given path, based on its extension.
    function getMime(path) {
      const ext = path.split('.').pop().toLowerCase();
      return MIME_TYPES[ext] || 'application/octet-stream';
    }

    export default {
      async fetch(request, env, ctx) {
        const url = new URL(request.url);
        // Decode URI to handle spaces/special chars, remove leading slash
        const path = decodeURIComponent(url.pathname).slice(1);

        // Try to find the asset key in the manifest, first by exact match and
        // then by directory match.
        let key = manifest[path];
        let assetPath = path;

        // If the key wasnt found, then check it as a folder by seeing if there
        // is an index file within it. There are two variations here, since it
        // is frequently an issue that people forget to put the '/' on the end
        // of a folder name.
        if (key === undefined) {
          if (path.endsWith('/') === true || path === '') {
             assetPath = path + 'index.html';
             key = manifest[assetPath];
          } else {
             assetPath = path + '/index.html';
             key = manifest[assetPath];
          }
        }

        // If we found a key, then try to fetch it from KV so that we can use it
        // in our response.
        //
        // env.__STATIC_CONTENT is the injected KV namespoace used by the
        // "worker sites" functionality.
        if (key !== undefined) {
          const body = await env.__STATIC_CONTENT.get(key, { type: 'stream' });

          // The get() method returns null if the key doesn't exist (though
          // the manifest said it should). If we find it, ship it back.
          if (body !== null) {
            return new Response(body, {
              headers: {
                'Content-Type': getMime(assetPath)
              }
            });
          }
        }

        // If we didn't find anything, return404 explicitly so that the router
        // knows that in this particular case it should be falling through.
        return new Response("Not Found", { status: 404 });
      }
    }
  `;

  // This worker is a Router worker and is the main fix to the Miniflare bug; it
  // is positioned in front of the main worker script in the configuration; it
  // hits the asset-store router above to see if a file is present or not; if it
  // is, it serves that content. Otherwise, it falls through to the worker.
  const routerScript = `
    export default {
      async fetch(request, env, ctx) {
        // Check the asset service to see if it knows about  this file; if it
        // does not, then we should defer to the main user worker instead, so
        // that it can handle as appropriate.
        const response = await env.ASSET_STORE.fetch(request);
        if (response.status === 404) {
          return env.USER_WORKER.fetch(request);
        }

        // We found the asset, so we can just return it now.
        return response;
      }
    }
  `;

  // Set up a script path for the script body we injected above; this starts as
  // a root path, but if the main worker has a path, then we adjust to use that
  // path instead, to keep things consistent.
  let baseScriptPath = path.resolve(".");
  if (mainWorker.scriptPath !== undefined && mainWorker.scriptPath !== null) {
    baseScriptPath = path.dirname(mainWorker.scriptPath);
  }
  const storeScriptPath = path.resolve(baseScriptPath, "asset-store-workaround.js");
  const routerScriptPath = path.resolve(baseScriptPath, "asset-router-workaround.js");

  // Configure the storage worker now; this uses sitePath to make this worker
  // activate the "worker sites" functionality, which gets it to give us a KV
  // file manifest for the asset files in the given folder.
  const storeWorker = {
    name: storeName,
    modules: true,
    sitePath: assetConfig.directory,
    script: storeScript,
    scriptPath: storeScriptPath
  };

  // Configure the router worker now; this gets bound to the storage worker,
  // which it uses to look up file content, and the user worker (the main worker
  // defined in the config) so that it knows where to defer incoming requests to
  // if they are not assets.
  const routerWorker = {
    name: routerName,
    modules: true,
    script: routerScript,
    scriptPath: routerScriptPath,
    serviceBindings: {
      USER_WORKER: mainWorker.name,
      ASSET_STORE: storeName
    }
  };

  // If the main worker has any compatibility date or options set, mirror them
  // in the other workrs so things are consistent.
  if (mainWorker.compatibilityDate !== undefined) {
    storeWorker.compatibilityDate = mainWorker.compatibilityDate;
    routerWorker.compatibilityDate = mainWorker.compatibilityDate;
  }
  if (mainWorker.compatibilityFlags !== undefined) {
    storeWorker.compatibilityFlags = mainWorker.compatibilityFlags;
    routerWorker.compatibilityFlags = mainWorker.compatibilityFlags;
  }

  // If the user configured a binding name for assets, we bind that name in the
  // MAIN worker to point to the safe Asset Store. This allows the main worker
  // to fetch assets without causing a request loop.
  if (assetConfig.binding !== undefined) {
    if (mainWorker.serviceBindings === undefined) {
      mainWorker.serviceBindings = {};
    }
    mainWorker.serviceBindings[assetConfig.binding] = storeName;
  }

  // Inject the workers now, first the store, then the router, since the unshift
  // puts the items at the front, and we require the router to be first so that
  // it is the one that gets the requests.
  workers.unshift(storeWorker);
  workers.unshift(routerWorker);
}


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
