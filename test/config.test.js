/******************************************************************************/


import { Collection, $check, $ } from "@axel669/aegis";

import { createMiniflareOptions } from "../lib/wrangler.js";


/******************************************************************************/


export default Collection`Wrangler Configuration Parsing`({
  /* This section tests the direct, 1-to-1 mappings of top-level worker
   * properties from the wrangler config to the Miniflare options. */
  "Basic Worker Properties": ({ runScope }) => {
    const config = {
      main: './worker.js',
      compatibility_date: '2025-01-01',
      compatibility_flags: ['flag1', 'flag2']
    };

    const expected = {
      workers: [
        {
          name: 'main',
          modules: true,
          bindings: {},
          scriptPath: './worker.js',
          compatibilityDate: '2025-01-01',
          compatibilityFlags: ['flag1', 'flag2']
        }
      ]
    };

    $check`Direct properties are mapped correctly`
      .value(createMiniflareOptions(config, {}))
      .deepEquals($, expected);
  },


  /****************************************************************************/


  /* This section tests that the dev server configuration is correctly
   * added to the top-level Miniflare options. */
  "Development Server Configuration": ({ runScope }) => {
    const config = {
      dev: {
        port: 8787,
        hostname: '0.0.0.0'
      }
    };

    const expected = {
      host: '0.0.0.0',
      port: 8787,
      workers: [
          {
          name: 'main',
          modules: true,
          bindings: {}
        }
      ]
    };

    $check`[dev] server config is added to top-level options`
      .value(createMiniflareOptions(config, {}))
      .deepEquals($, expected);
  },


  /****************************************************************************/


  /* This section tests that simple key-value variables from the [vars] block
   * are correctly placed into the 'bindings' object. */
  "Variable Bindings (vars)": ({ runScope }) => {
    const config = {
      vars: {
        API_KEY: 'secret',
        ENVIRONMENT: 'testing'
      }
    };

    const expected = {
      workers: [
        {
          name: 'main',
          modules: true,
          bindings: {
            API_KEY: 'secret',
            ENVIRONMENT: 'testing'
          }
        }
      ]
    };

    $check`[vars] are mapped to bindings`
      .value(createMiniflareOptions(config, {}))
      .deepEquals($, expected);
  },


  /****************************************************************************/


  /* This section tests the mapping of the static asset binding. */
  "Asset Binding": ({ runScope }) => {
    const config = {
      assets: {
        binding: 'ASSETS',
        directory: './public'
      }
    };

    const expected = {
      workers: [
        {
          name: 'main',
          modules: true,
          bindings: {},
          assets: {
            binding: 'ASSETS',
            directory: './public'
          }
        }
      ]
    };

    $check`[assets] are mapped correctly`
      .value(createMiniflareOptions(config, {}))
      .deepEquals($, expected);
  },


  /****************************************************************************/


  /* This section tests bindings that are defined as an array of objects in the
   * wrangler config but are expected as a simple array of binding names by
   * Miniflare. */
  "Array-based Bindings (KV, R2)": ({ runScope }) => {
    const config = {
      kv_namespaces: [{ binding: 'KV_BINDING', id: 'kv_id' }],
      r2_buckets: [{ binding: 'R2_BINDING', bucket_name: 'r2_bucket' }]
    };

    const expected = {
      workers: [
        {
          name: 'main',
          modules: true,
          bindings: {},
          kvNamespaces: ['KV_BINDING'],
          r2Buckets: ['R2_BINDING']
        }
      ]
    };

    $check`KV and R2 bindings are mapped to arrays of names`
      .value(createMiniflareOptions(config, {}))
      .deepEquals($, expected);
  },


  /****************************************************************************/


  /* This section tests bindings that are defined as an array of objects but
   * must be transformed into a single key-value object for Miniflare. */
  "Object-based Bindings (D1, DO, Queues)": ({ runScope }) => {
    const config = {
      d1_databases: [
        { binding: 'DB', database_id: 'd1_id' }
      ],
      durable_objects: {
        bindings: [
          { name: 'DO_BINDING', class_name: 'Counter' }
        ]
      },
      queues: {
        producers: [
          { binding: 'QUEUE_BINDING', queue: 'my-queue' }
        ],
        consumers: [
          { queue: 'my-queue' }
        ]
      }
    };

    const expected = {
      workers: [
        {
          name: 'main',
          modules: true,
          bindings: {},
          d1Databases: { 'DB': 'd1_id' },
          durableObjects: { 'DO_BINDING': 'Counter' },
          queueProducers: { 'QUEUE_BINDING': 'my-queue' },
          queueConsumers: { 'my-queue': {} }
        }
      ]
    };

    $check`D1, DO, and Queue bindings are mapped to objects`
      .value(createMiniflareOptions(config, {}))
      .deepEquals($, expected);
  },


  /****************************************************************************/


  /* This section tests the special handling for service bindings, including
   * the case where a mock is provided and the case where it is not. */
  "Service Bindings": ({ runScope }) => {
    const config = {
      services: [
        { binding: 'MOCKED_SERVICE', service: 'my-mocked-worker' },
        { binding: 'UNMOCKED_SERVICE', service: 'my-unmocked-worker' }
      ]
    };

    const workerMocks = {
      'my-mocked-worker': {
        script: `export default { fetch: () => new Response("mocked") }`
      }
    };

    // Create options using the configured services and mocked up workers;
    // note that one is missing.
    const result = createMiniflareOptions(config, workerMocks);

    // The total worker count should be three, and the first one should know
    // about the bindings in the first (main) worker.
    $check`Service bindings and worker count are correct`
      .value(result)
      .eq($.workers.length, 3)
      .deepEquals($.workers[0].serviceBindings, {
        'MOCKED_SERVICE': 'my-mocked-worker',
        'UNMOCKED_SERVICE': 'my-unmocked-worker'
      });

    // The worker that was mocked up should have the same script as the one
    // from the workerMock setup.
    const mockedWorker = result.workers.find(w => w.name === 'my-mocked-worker');
    $check`Provided mock is used for the mocked service`
      .value(mockedWorker)
      .eq($.script, workerMocks['my-mocked-worker'].script);

    // The worker that was not mocked should still have a script, but it should
    // not be the one used by the other mocked worker and it should still be
    // a string.
    //
    // We don't compare what it is exactly, since that is an implemenation
    // detail; it's enough to know that it exists and is a string and did not
    // incorrectly get the wrong value.
    const unmockedWorker = result.workers.find(w => w.name === 'my-unmocked-worker');
    $check`Default stub is used for the unmocked service`
      .value(unmockedWorker)
      .instanceof($.script, String)
      .neq($.script, workerMocks['my-mocked-worker'].script);
  },


  /****************************************************************************/


  /* This final section combines all possible options into a single config
   * object to ensure they are all processed together correctly. This test
   * also implicitly verifies the behavior for a service that does not have
   * a provided mock. */
  "Full Configuration": ({ runScope }) => {
    const fullConfig = {
      main: './worker.js',
      compatibility_date: '2025-01-01',
      vars: { ENV: 'production' },
      assets: { binding: 'ASSETS', directory: './dist' },
      kv_namespaces: [{ binding: 'KV', id: 'kv_id' }],
      r2_buckets: [{ binding: 'R2', bucket_name: 'r2_bucket' }],
      d1_databases: [{ binding: 'DB', database_id: 'd1_id' }],
      durable_objects: { bindings: [{ name: 'DO', class_name: 'Counter' }] },
      services: [{ binding: 'SERVICE', service: 'my-service' }],
      dev: { port: 9000 }
    };

    const expected = {
      port: 9000,
      host: '127.0.0.1',
      workers: [
        {
          name: 'main',
          modules: true,
          scriptPath: './worker.js',
          compatibilityDate: '2025-01-01',
          bindings: { ENV: 'production' },
          assets: { binding: 'ASSETS', directory: './dist' },
          kvNamespaces: ['KV'],
          r2Buckets: ['R2'],
          d1Databases: { 'DB': 'd1_id' },
          durableObjects: { 'DO': 'Counter' },
          serviceBindings: { 'SERVICE': 'my-service' }
        },
        {
          name: 'my-service',
          modules: true,
          script: `
          export default {
            fetch(request) {
              console.log(\`(cf-aegis) mock for service 'my-service' received a request for: \${request.url}\`);
              return new Response('Service not implemented in test environment', { status: 404 });
            }
          }
        `
        }
      ]
    };

    // Create options
    const result = createMiniflareOptions(fullConfig, {});

    // Pull out the declarations for the two workers.
    const mainWorker = result.workers.find(w => w.name === 'main');
    const mockWorker = result.workers.find(w => w.name === 'my-service');

    $check`Full config: main worker is correct`
      .value(mainWorker)
      .deepEquals($, expected.workers[0]);

    $check`Full config: mock worker is correct`
      .value(mockWorker.script.trim())
      .eq($, expected.workers[1].script.trim());

    $check`Full config: dev server options are correct`
      .value(result)
      .eq($.port, expected.port)
      .eq($.host, expected.host);
  },
});


/******************************************************************************/
