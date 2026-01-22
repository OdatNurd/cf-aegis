/******************************************************************************/


import { initializeCustomChecks } from "../lib/index.js";


/******************************************************************************/


// Import our custom checks.
initializeCustomChecks();


/******************************************************************************/


export const config = {
  files: [
    "test/config.test.js",
    "test/setup.test.js",
    "test/fetch.test.js",
    "test/assets.test.js",
    "test/mixed.test.js",
  ],

  // The usual setup and teardown hooks are in the individual tests since they
  // exercise different configuration files and setups.

  // Can be set to "afterSection" or "afterCollection" to have the test suite
  // exit as soon as a check fails in a section or collection. Default of
  // "ignore" runs all tests without stopping on failures.
  failAction: "afterSection",
}


/******************************************************************************/
