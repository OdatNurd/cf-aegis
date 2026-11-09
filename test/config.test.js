/******************************************************************************/


import { aegis, $ } from "@axel669/aegis";

import {
  createMiniflareOptions,
  applyAssetRouterWorkaround
} from "../lib/miniflare.js";
import { resolveEnvironmentConfig } from "../lib/config.js";
import { initializeCustomChecks } from "../lib/index.js";


initializeCustomChecks();


/******************************************************************************/


export const name = "Wrangler Configuration Parsing";


/******************************************************************************/


aegis.test`Basic Worker Properties`(() => {
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

  $.check`Direct properties are mapped correctly`(
    $.deepEquals(createMiniflareOptions(config, {}), expected)
  );
});


/******************************************************************************/


aegis.test`Development Server Configuration`(() => {
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

  $.check`[dev] server config is added to top-level options`(
    $.deepEquals(createMiniflareOptions(config, {}), expected)
  );
});


/******************************************************************************/


aegis.test`Variable Bindings (vars)`(() => {
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

  $.check`[vars] are mapped to bindings`(
    $.deepEquals(createMiniflareOptions(config, {}), expected)
  );
});


/******************************************************************************/


aegis.test`Asset Binding`(() => {
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

  $.check`[assets] are mapped correctly`(
    $.deepEquals(createMiniflareOptions(config, {}), expected)
  );
});


/******************************************************************************/


aegis.test`Asset Workaround Worker Names`(() => {
  const workers = [
    {
      name: 'main',
      modules: true,
      bindings: {},
      assets: { binding: 'ASSETS', directory: './public' }
    },
    { name: 'asset-router', modules: true, script: '' },
    { name: 'asset-store', modules: true, script: '' }
  ];

  applyAssetRouterWorkaround(workers);

  const names = workers.map(worker => worker.name);
  $.check`Asset workaround uses unique worker names`(
    $.eq(new Set(names).size, names.length),
    $.eq(new Set(names).size, 5)
  );

  $.check`Asset workaround renames both colliding helpers`(
    $.includes(names, 'asset-router-2'),
    $.includes(names, 'asset-store-2')
  );
});


/******************************************************************************/


aegis.test`Array-based Bindings (KV, R2)`(() => {
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

  $.check`KV and R2 bindings are mapped to arrays of names`(
    $.deepEquals(createMiniflareOptions(config, {}), expected)
  );
});


/******************************************************************************/


aegis.test`Object-based Bindings (D1, DO, Queues)`(() => {
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

  $.check`D1, DO, and Queue bindings are mapped to objects`(
    $.deepEquals(createMiniflareOptions(config, {}), expected)
  );
});


/******************************************************************************/


aegis.test`Service Bindings`(() => {
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

  // Create options using the configured services and mocked up workers; note
  // that one is missing.
  const result = createMiniflareOptions(config, workerMocks);

  // The total worker count should be three, and the first one should know about
  // the bindings in the first (main) worker.
  $.check`Service bindings and worker count are correct`(
    $.eq(result.workers.length, 3),
    $.deepEquals(result.workers[0].serviceBindings, {
      'MOCKED_SERVICE': 'my-mocked-worker',
      'UNMOCKED_SERVICE': 'my-unmocked-worker'
    })
  );

  // The worker that was mocked up should have the same script as the one from
  // the workerMock setup.
  const mockedWorker = result.workers.find(w => w.name === 'my-mocked-worker');
  $.check`Provided mock is used for the mocked service`(
    $.eq(mockedWorker.script, workerMocks['my-mocked-worker'].script)
  );

  // The worker that was not mocked should still have a script, but it should
  // not be the one used by the other mocked worker and it should still be a
  // string.
  //
  // We don't compare what it is exactly, since that is an implemenation detail;
  // it's enough to know that it exists and is a string and did not incorrectly
  // get the wrong value.
  const unmockedWorker = result.workers.find(w => w.name === 'my-unmocked-worker');
  $.check`Default stub is used for the unmocked service`(
    $.instanceof(unmockedWorker.script, String),
    $.neq(unmockedWorker.script, workerMocks['my-mocked-worker'].script)
  );
});


/******************************************************************************/


aegis.test`Duplicate Service Bindings`(() => {
  const config = {
    services: [
      { binding: 'FIRST_SERVICE', service: 'shared-service' },
      { binding: 'SECOND_SERVICE', service: 'shared-service' }
    ]
  };

  const result = createMiniflareOptions(config, {
    'shared-service': {
      script: `export default { fetch: () => new Response("shared") }`
    }
  });

  $.check`Duplicate service bindings produce one worker`(
    $.deepEquals(
      result.workers.map(worker => worker.name),
      ['main', 'shared-service']
    )
  );

  $.check`Both bindings to the shared service are retained`(
    $.deepEquals(result.workers[0].serviceBindings, {
      FIRST_SERVICE: 'shared-service',
      SECOND_SERVICE: 'shared-service'
    })
  );
});


/******************************************************************************/


aegis.test`Secrets Configuration`(() => {
  // Valid case: secrets.required is an array
  const validConfig = {
    secrets: {
      required: ['API_KEY', 'OTHER_SECRET'],
      ignored_key: 'should not appear'
    }
  };

  const validExpected = {
    workers: [
      {
        name: 'main',
        modules: true,
        bindings: {}
      }
    ]
  };

  $.check`Secrets config is not forwarded to Miniflare options`(
    $.deepEquals(createMiniflareOptions(validConfig, {}), validExpected)
  );

  // Invalid case: secrets.required is not an array
  const invalidConfig = {
    secrets: {
      required: 'API_KEY'
    }
  };

  const emptyExpected = {
    workers: [
      {
        name: 'main',
        modules: true,
        bindings: {}
      }
    ]
  };

  $.check`Invalid secrets.required (not an array) is safely ignored`(
    $.deepEquals(createMiniflareOptions(invalidConfig, {}), emptyExpected)
  );

  // Invalid case: secrets object exists but lacks required key
  const missingRequiredConfig = {
    secrets: {
      other_key: ['API_KEY']
    }
  };

  $.check`Secrets object without required key is safely ignored`(
    $.deepEquals(createMiniflareOptions(missingRequiredConfig, {}), emptyExpected)
  );
});


/******************************************************************************/


aegis.test`Full Configuration`(() => {
  const fullConfig = {
    main: './worker.js',
    compatibility_date: '2025-01-01',
    vars: { ENV: 'production' },
    secrets: { required: ['MY_SECRET'] },
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
              console.log(\`[cf-aegis] mock for service 'my-service' received a request for: \${request.url}\`);
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

  $.check`Full config: main worker is correct`(
    $.deepEquals(mainWorker, expected.workers[0])
  );

  $.check`Full config: mock worker is correct`(
    $.eq(mockWorker.script.trim(), expected.workers[1].script.trim())
  );

  $.check`Full config: dev server options are correct`(
    $.eq(result.port, expected.port),
    $.eq(result.host, expected.host)
  );
});


/******************************************************************************/


aegis.test`Environment Resolution`(() => {
  const rawConfig = {
    // Inheritable top-level keys
    main: './top-level.js',
    compatibility_date: '2025-01-01',
    dev: { port: 8080 },
    assets: { binding: 'ASSETS', directory: './public' },

    // Non-inheritable top-level keys
    vars: { ENV: 'production', ONLY_TOP: 'yes' },
    durable_objects: { bindings: [{ name: 'DO', class_name: 'Counter' }] },

    // Environment overrides
    env: {
      staging: {
        // Overriding an inheritable key
        assets: { binding: 'ASSETS', directory: './staging-public' },

        // Environment-specific non-inheritable keys
        vars: { ENV: 'staging', ONLY_ENV: 'yes' },
        kv_namespaces: [{ binding: 'KV', id: 'staging_kv' }]
      }
    }
  };

  // Test Case 1: No environment specified
  const defaultResolved = resolveEnvironmentConfig(rawConfig, undefined);
  const expectedDefault = {
    main: './top-level.js',
    compatibility_date: '2025-01-01',
    dev: { port: 8080 },
    assets: { binding: 'ASSETS', directory: './public' },
    vars: { ENV: 'production', ONLY_TOP: 'yes' },
    durable_objects: { bindings: [{ name: 'DO', class_name: 'Counter' }] }
  };

  $.check`Default environment resolves strictly top-level keys`(
    $.deepEquals(defaultResolved, expectedDefault)
  );

  // Test Case 2: Environment specified
  const stagingResolved = resolveEnvironmentConfig(rawConfig, 'staging');
  const expectedStaging = {
    // Inherited from top level
    main: './top-level.js',
    compatibility_date: '2025-01-01',
    dev: { port: 8080 },

    // Overridden by environment
    assets: { binding: 'ASSETS', directory: './staging-public' },

    // Strict environment non-inheritable keys (top-level counterparts ignored)
    vars: { ENV: 'staging', ONLY_ENV: 'yes' },
    kv_namespaces: [{ binding: 'KV', id: 'staging_kv' }]
  };

  $.check`Specified environment inherits, overrides, and isolates correctly`(
    $.deepEquals(stagingResolved, expectedStaging)
  );
});


/******************************************************************************/
