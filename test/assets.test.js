/******************************************************************************/


import { readFile } from "node:fs/promises";
import { Collection, $check, $ } from "@axel669/aegis";

import { aegisSetup, aegisTeardown } from "../lib/index.js";


/******************************************************************************/


export default Collection`Static Assets`({
  /* This section verifies that the library correctly delegates to the underlying
   * asset handling when configured to do so in the wrangler toml. */
  "Asset Fetching": async ({ runScope }) => {
    const ctx = {};
    const expected = await readFile("./test/worker/public/test.txt", "utf-8");

    // Initialize with the static-specific configuration
    await aegisSetup(ctx, './test/worker/wrangler_static.toml');

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
});


/******************************************************************************/
