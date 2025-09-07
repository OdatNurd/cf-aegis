/******************************************************************************/


import { Collection, $check, $ } from "@axel669/aegis";

import { aegisSetup, aegisTeardown } from "../lib/index.js";


/******************************************************************************/


export default Collection`Worker Route Fetching`({
  /* This section performs tests to ensure that the fetch handler that we wrap
   * into the context works as expected. */
  "Wrapped Fetch": async ({ runScope }) => {
    const ctx = {};
    await aegisSetup(ctx, './test/worker/wrangler.toml');

    await $check`Inner fetch with fragment succeeds on valid route`
      .call(async () => {
        const res = await ctx.fetch('/test');
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, 'Hello World');

    await $check`Inner fetch with fragment fails on invalid route`
      .call(async () => {
        const res = await ctx.fetch('/non-existent-route');
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 404)
      .eq($.text, 'Not found');

    await $check`Inner fetch with full URL succeeds on valid route`
      .call(async () => {
        const url = new URL('/test', ctx.serverBaseUrl).toString();
        const res = await ctx.fetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, 'Hello World');

    await $check`Inner fetch with full URL fails on invalid route`
      .call(async () => {
        const url = new URL('/non-existent-route', ctx.serverBaseUrl).toString();
        const res = await ctx.fetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 404)
      .eq($.text, 'Not found');

    await aegisTeardown(ctx);
  },


  /****************************************************************************/


  /* This section performs tests similar to the prior one but using the internal
   * Miniflare dispatchFetch() handler. */
  "Miniflare Dispatch": async ({ runScope }) => {
    const ctx = {};
    await aegisSetup(ctx, './test/worker/wrangler.toml');

    await $check`Raw fetch with fragment succeeds on valid route`
      .call(async () => {
        const url = new URL('/test', ctx.serverBaseUrl).toString();
        const res = await ctx.worker.dispatchFetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, 'Hello World');

    await $check`Raw fetch with fragment fails on invalid route`
      .call(async () => {
        const url = new URL('/non-existent-route', ctx.serverBaseUrl).toString();
        const res = await ctx.worker.dispatchFetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 404)
      .eq($.text, 'Not found');

    await $check`Raw fetch with full URL succeeds on valid route`
      .call(async () => {
        const url = new URL('/test', ctx.serverBaseUrl).toString();
        const res = await ctx.worker.dispatchFetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, 'Hello World');

    await $check`Raw fetch with full URL fails on invalid route`
      .call(async () => {
        const url = new URL('/non-existent-route', ctx.serverBaseUrl).toString();
        const res = await ctx.worker.dispatchFetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 404)
      .eq($.text, 'Not found');

    await aegisTeardown(ctx);
  },


  /****************************************************************************/


  /* This section is similar to the above but uses the node fetch() method to do
   * this, as an extra test. */
  "Node Fetch": async ({ runScope }) => {
    const ctx = {};
    await aegisSetup(ctx, './test/worker/wrangler.toml');

    await $check`Node fetch succeeds on valid route`
      .call(async () => {
        const url = new URL('/test', ctx.serverBaseUrl).toString();
        const res = await fetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 200)
      .eq($.text, 'Hello World');

    await $check`Node fetch fails on invalid route`
      .call(async () => {
        const url = new URL('/non-existent-route', ctx.serverBaseUrl).toString();
        const res = await fetch(url);
        return { status: res.status, text: await res.text() };
      })
      .eq($.status, 404)
      .eq($.text, 'Not found');

    await aegisTeardown(ctx);
  },
});


/******************************************************************************/
