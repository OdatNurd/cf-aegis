/******************************************************************************/


import { readFile } from "node:fs/promises";
import { aegis, $ } from "@axel669/aegis";

import { aegisSetup, aegisTeardown, initializeCustomChecks } from "../lib/index.js";


initializeCustomChecks();


/******************************************************************************/


export const name = "Static Assets";


/******************************************************************************/


aegis.test`Asset Fetching`(async () => {
  const ctx = {};
  const expected = await readFile("./test/worker/public/test.txt", "utf-8");
  const expectedWebp = await readFile("./test/worker/public/test.webp", "utf-8");

  // Initialize with the static-specific configuration
  try {
    await aegisSetup(ctx, './test/worker/wrangler_static.toml');

    const asset = await ctx.fetch('/test.txt');
    $.check`Fetch of existing asset succeeds with correct content`(
      $.eq(asset.status, 200),
      $.eq(await asset.text(), expected)
    );

    const missing = await ctx.fetch('/does-not-exist.txt');
    $.check`Fetch of non-existent asset returns 404`(
      $.eq(missing.status, 404)
    );

    const webp = await ctx.fetch('/test.webp');
    $.check`Non-text assets receive their mime-db content type`(
      $.eq(webp.status, 200),
      $.eq(webp.headers.get('content-type'), 'image/webp'),
      $.eq(await webp.text(), expectedWebp)
    );
  } finally {
    await aegisTeardown(ctx);
  }
});


/******************************************************************************/
