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
