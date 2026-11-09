/******************************************************************************/


import { readFile } from "node:fs/promises";
import { aegis, $ } from "@axel669/aegis";

import { aegisSetup, aegisTeardown, initializeCustomChecks } from "../lib/index.js";


initializeCustomChecks();


/******************************************************************************/


export const name = "Mixed Worker & Assets";


/******************************************************************************/


aegis.test`Asset Fetching`(async () => {
  const ctx = {};
  const expected = await readFile("./test/worker/public/test.txt", "utf-8");

  // Initialize with the mixed configuration
  try {
    await aegisSetup(ctx, './test/worker/wrangler_mixed.toml');

    const asset = await ctx.fetch('/test.txt');
    $.check`Fetch of existing asset succeeds with correct content`(
      $.eq(asset.status, 200),
      $.eq(await asset.text(), expected)
    );

    const missing = await ctx.fetch('/does-not-exist.txt');
    $.check`Fetch of non-existent asset returns 404`(
      $.eq(missing.status, 404)
    );

    const post = await ctx.fetch('/test.txt', { method: 'POST' });
    $.check`POST to an asset path falls through to the user worker`(
      $.eq(post.status, 404),
      $.eq(await post.text(), 'Not found')
    );

    const base = await ctx.fetch('/test.txt');
    const etag = base.headers.get('etag');
    const range = await ctx.fetch('/test.txt', {
      headers: { Range: 'bytes=0-3' }
    });
    const conditional = await ctx.fetch('/test.txt', {
      headers: { 'If-None-Match': etag }
    });
    const unsatisfiable = await ctx.fetch('/test.txt', {
      headers: { Range: 'bytes=9999-10000' }
    });
    const head = await ctx.fetch('/test.txt', { method: 'HEAD' });
    const byteLength = Buffer.byteLength(expected);
    const result = {
      baseStatus: base.status,
      acceptRanges: base.headers.get('accept-ranges'),
      etagPresent: typeof etag === 'string' && etag.startsWith('"'),
      rangeStatus: range.status,
      rangeText: await range.text(),
      rangeContentRange: range.headers.get('content-range'),
      conditionalStatus: conditional.status,
      conditionalText: await conditional.text(),
      unsatisfiableStatus: unsatisfiable.status,
      unsatisfiableContentRange: unsatisfiable.headers.get('content-range'),
      headStatus: head.status,
      headLength: head.headers.get('content-length'),
      headText: await head.text(),
      byteLength
    };

    $.check`Asset responses support range, conditional, and HEAD requests`(
      $.eq(result.baseStatus, 200),
      $.eq(result.acceptRanges, 'bytes'),
      $.eq(result.etagPresent, true),
      $.eq(result.rangeStatus, 206),
      $.eq(result.rangeText, expected.slice(0, 4)),
      $.eq(result.rangeContentRange, `bytes 0-3/${Buffer.byteLength(expected)}`),
      $.eq(result.conditionalStatus, 304),
      $.eq(result.conditionalText, ''),
      $.eq(result.unsatisfiableStatus, 416),
      $.eq(result.unsatisfiableContentRange, `bytes */${Buffer.byteLength(expected)}`),
      $.eq(result.headStatus, 200),
      $.eq(result.headLength, String(Buffer.byteLength(expected))),
      $.eq(result.headText, '')
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/


aegis.test`Worker Route Fetching`(async () => {
  const ctx = {};
  try {
    await aegisSetup(ctx, './test/worker/wrangler_mixed.toml');

    // 1. Wrapped Context Fetch
    const inner = await ctx.fetch('/test');
    $.check`Inner fetch with fragment succeeds on valid worker route`(
      $.eq(inner.status, 200),
      $.eq(await inner.text(), 'Hello World')
    );

    // 2. Miniflare Dispatch Fetch
    const dispatchUrl = new URL('/test', ctx.serverBaseUrl).toString();
    const dispatch = await ctx.worker.dispatchFetch(dispatchUrl);
    $.check`Raw fetch with full URL succeeds on valid worker route`(
      $.eq(dispatch.status, 200),
      $.eq(await dispatch.text(), 'Hello World')
    );

    // 3. Node Native Fetch
    const nodeFetch = await fetch(dispatchUrl);
    $.check`Node fetch succeeds on valid worker route`(
      $.eq(nodeFetch.status, 200),
      $.eq(await nodeFetch.text(), 'Hello World')
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/


aegis.test`Explicit Asset Binding`(async () => {
  const ctx = {};
  const expected = await readFile("./test/worker/public/test.txt", "utf-8");

  try {
    await aegisSetup(ctx, './test/worker/wrangler_mixed.toml');

    const asset = await ctx.fetch('/asset_test_one');
    $.check`Worker can fetch existing asset via binding`(
      $.eq(asset.status, 200),
      $.eq(await asset.text(), expected)
    );

    const missing = await ctx.fetch('/asset_test_two');
    $.check`Worker receives 404 when fetching missing asset via binding`(
      $.eq(missing.status, 404)
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/
