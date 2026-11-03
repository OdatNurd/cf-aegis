/******************************************************************************/


import { readFile } from "node:fs/promises";
import { Collection, $check, $ } from "@axel669/aegis";

import { aegisSetup, aegisTeardown } from "../lib/index.js";


/******************************************************************************/


export default Collection`Mixed Worker & Assets`({
  /* This section verifies that we can serve static assets in a mixed environment
   * where a worker script is also present. */
  "Asset Fetching": async ({ runScope }) => {
    const ctx = {};
    const expected = await readFile("./test/worker/public/test.txt", "utf-8");

    // Initialize with the mixed configuration
    await aegisSetup(ctx, './test/worker/wrangler_mixed.toml');

    await $check`Fetch of existing asset succeeds with correct content`
      .call(async () => {
        const res = await ctx.fetch('/test.txt');
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, expected);

    await $check`Fetch of non-existent asset returns 404`
      .call(async () => {
        const res = await ctx.fetch('/does-not-exist.txt');
        return { status: res.status };
      })
      .eq($.status, 404);

    await $check`POST to an asset path falls through to the user worker`
      .call(async () => {
        const res = await ctx.fetch('/test.txt', { method: 'POST' });
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 404)
      .eq($.text, 'Not found');

    await $check`Asset responses support range, conditional, and HEAD requests`
      .call(async () => {
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

        return {
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
      })
      .eq($.baseStatus, 200)
      .eq($.acceptRanges, 'bytes')
      .eq($.etagPresent, true)
      .eq($.rangeStatus, 206)
      .eq($.rangeText, expected.slice(0, 4))
      .eq($.rangeContentRange, `bytes 0-3/${Buffer.byteLength(expected)}`)
      .eq($.conditionalStatus, 304)
      .eq($.conditionalText, '')
      .eq($.unsatisfiableStatus, 416)
      .eq($.unsatisfiableContentRange, `bytes */${Buffer.byteLength(expected)}`)
      .eq($.headStatus, 200)
      .eq($.headLength, String(Buffer.byteLength(expected)))
      .eq($.headText, '');

    await aegisTeardown(ctx);
  },


  /****************************************************************************/


  /* This section verifies that the worker script is still reachable and functioning
   * correctly alongside the asset serving. */
  "Worker Route Fetching": async ({ runScope }) => {
    const ctx = {};
    await aegisSetup(ctx, './test/worker/wrangler_mixed.toml');

    // 1. Wrapped Context Fetch
    await $check`Inner fetch with fragment succeeds on valid worker route`
      .call(async () => {
        const res = await ctx.fetch('/test');
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, 'Hello World');

    // 2. Miniflare Dispatch Fetch
    await $check`Raw fetch with full URL succeeds on valid worker route`
      .call(async () => {
        const url = new URL('/test', ctx.serverBaseUrl).toString();
        const res = await ctx.worker.dispatchFetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, 'Hello World');

    // 3. Node Native Fetch
    await $check`Node fetch succeeds on valid worker route`
      .call(async () => {
        const url = new URL('/test', ctx.serverBaseUrl).toString();
        const res = await fetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, 'Hello World');

    await aegisTeardown(ctx);
  },


  /****************************************************************************/


  /* This section verifies that the worker can explicitly access the asset
   * binding to fetch files programmatically. This verifies that our workaround
   * works, if it's present, and that miniflare works, if its not. */
  "Explicit Asset Binding": async ({ runScope }) => {
    const ctx = {};
    const expected = await readFile("./test/worker/public/test.txt", "utf-8");

    await aegisSetup(ctx, './test/worker/wrangler_mixed.toml');

    await $check`Worker can fetch existing asset via binding`
      .call(async () => {
        const res = await ctx.fetch('/asset_test_one');
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, expected);

    await $check`Worker receives 404 when fetching missing asset via binding`
      .call(async () => {
        const res = await ctx.fetch('/asset_test_two');
        return { status: res.status };
      })
      .eq($.status, 404);

    await aegisTeardown(ctx);
  },
});


/******************************************************************************/
