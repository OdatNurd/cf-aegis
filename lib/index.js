/******************************************************************************/


import { addCheck } from '@axel669/aegis';
import { Miniflare } from 'miniflare';


/******************************************************************************/

/*
 * Initializes some custom Aegis checks that make testing easier.
 *
 * This is entirely optional and is a basic extension of the tests that are
 * available by default in Aegis.
 */
export function initializeCustomChecks() {
  // Check that a value is an array.
  addCheck.value.isArray(
      source => Array.isArray(source) === true
  );

  // Check that a value is NOT an array.
  addCheck.value.isNotArray(
      source => Array.isArray(source) === false
  );

  // Check that a value is a plain object.
  addCheck.value.isObject(
    source => source !== null && typeof source === 'object' && source.constructor === Object
  );

  // Check that a value is NOT a plain object.
  addCheck.value.isNotObject(
    source => source === null || typeof source !== 'object' || source.constructor !== Object
  );

  // Check that a value is an object that has a specific number of keys.
  addCheck.value.keyCount(
    (object, length) => Object.keys(object).length === length
  );

  // Check that a value is a function.
  addCheck.value.isFunction(
    source => source instanceof Function
  );
}


/******************************************************************************/


/**
 * An Aegis helper function to be used in an Aegis setup hook of some sort.
 * When invoked, it will create a Miniflare instance with a D1 database binding
 * attached, and then run the provided setup SQL file or files (if any) in
 * order to populate it.
 *
 * This must be provided an Aegis context (such as the runScope) and will add to
 * it a 'worker' and 'db' property.
 *
 * The function can also be optionally passed either the name of a single SQL
 * file or an array of SQL files, which will be loaded and executed.
 *
 * The optional dbName property sets the name of the database binding in the
 * Miniflare instance, should you need to control that. */
 export async function aegisSetup(ctx, dbName = 'DB') {
  ctx.worker = new Miniflare({
    script: 'export default {}',
    modules: true,
    d1Databases: [dbName]
  });

  await ctx.worker.ready;
  ctx.db = await ctx.worker.getD1Database(dbName);
}


/******************************************************************************/


/**
 * An Aegis helper funciton used to tear down a Miniflare instance that was set
 * up via a call to aegisSetup().
 *
 * This should be invoked in the teardown hook that associates with the setup
 * hook in which you invoked the setup function. */
export async function aegisTeardown(ctx) {
  if (ctx.worker) {
    await ctx.worker.dispose();
  }

  delete ctx.worker;
  delete ctx.db;
}


/******************************************************************************/
