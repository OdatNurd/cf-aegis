/******************************************************************************/


import { aegis, $ } from "@axel669/aegis";

import { aegisSetup, aegisTeardown, initializeCustomChecks } from "../lib/index.js";


initializeCustomChecks();


/******************************************************************************/


export const name = "Worker Route Fetching";


/******************************************************************************/


aegis.test`Wrapped Fetch`(async () => {
  const ctx = {};
  try {
    await aegisSetup(ctx, './test/worker/wrangler.toml');

    const fragment = await ctx.fetch('/test');
    $.check`Inner fetch with fragment succeeds on valid route`(
      $.eq(fragment.status, 200),
      $.eq(await fragment.text(), 'Hello World')
    );

    const missingFragment = await ctx.fetch('/non-existent-route');
    $.check`Inner fetch with fragment fails on invalid route`(
      $.eq(missingFragment.status, 404),
      $.eq(await missingFragment.text(), 'Not found')
    );

    const fullUrl = new URL('/test', ctx.serverBaseUrl).toString();
    const full = await ctx.fetch(fullUrl);
    $.check`Inner fetch with full URL succeeds on valid route`(
      $.eq(full.status, 200),
      $.eq(await full.text(), 'Hello World')
    );

    const missingUrl = new URL('/non-existent-route', ctx.serverBaseUrl).toString();
    const missingFull = await ctx.fetch(missingUrl);
    $.check`Inner fetch with full URL fails on invalid route`(
      $.eq(missingFull.status, 404),
      $.eq(await missingFull.text(), 'Not found')
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/


aegis.test`Miniflare Dispatch`(async () => {
  const ctx = {};
  try {
    await aegisSetup(ctx, './test/worker/wrangler.toml');

    const fragmentUrl = new URL('/test', ctx.serverBaseUrl).toString();
    const fragment = await ctx.worker.dispatchFetch(fragmentUrl);
    $.check`Raw fetch with fragment succeeds on valid route`(
      $.eq(fragment.status, 200),
      $.eq(await fragment.text(), 'Hello World')
    );

    const missingUrl = new URL('/non-existent-route', ctx.serverBaseUrl).toString();
    const missing = await ctx.worker.dispatchFetch(missingUrl);
    $.check`Raw fetch with fragment fails on invalid route`(
      $.eq(missing.status, 404),
      $.eq(await missing.text(), 'Not found')
    );

    const full = await ctx.worker.dispatchFetch(fragmentUrl);
    $.check`Raw fetch with full URL succeeds on valid route`(
      $.eq(full.status, 200),
      $.eq(await full.text(), 'Hello World')
    );

    const missingFull = await ctx.worker.dispatchFetch(missingUrl);
    $.check`Raw fetch with full URL fails on invalid route`(
      $.eq(missingFull.status, 404),
      $.eq(await missingFull.text(), 'Not found')
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/


aegis.test`Node Fetch`(async () => {
  const ctx = {};
  try {
    await aegisSetup(ctx, './test/worker/wrangler.toml');

    const validUrl = new URL('/test', ctx.serverBaseUrl).toString();
    const valid = await fetch(validUrl);
    $.check`Node fetch succeeds on valid route`(
      $.eq(valid.status, 200),
      $.eq(await valid.text(), 'Hello World')
    );

    const missingUrl = new URL('/non-existent-route', ctx.serverBaseUrl).toString();
    const missing = await fetch(missingUrl);
    $.check`Node fetch fails on invalid route`(
      $.eq(missing.status, 404),
      $.eq(await missing.text(), 'Not found')
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/
