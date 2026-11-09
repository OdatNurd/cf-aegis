/******************************************************************************/


import { aegis, $ } from "@axel669/aegis";
import { initializeCustomChecks } from "../lib/index.js";


initializeCustomChecks();


/******************************************************************************/


export const name = "Custom Checks";


/******************************************************************************/


aegis.test`Deep Equality Edge Cases`(() => {
  const cycleA = { value: 1 };
  cycleA.self = cycleA;

  const cycleB = { value: 1 };
  cycleB.self = cycleB;

  $.check`Cyclic structures terminate and compare equal`(
    $.deepEquals(cycleA, cycleB)
  );

  $.check`Different cyclic structures compare unequal`(
    $.notDeepEquals(cycleA, { value: 2, self: null })
  );

  $.check`Dates compare by timestamp`(
    $.deepEquals(new Date(0), new Date(0))
  );

  $.check`Different dates compare unequal`(
    $.notDeepEquals(new Date(0), new Date(1))
  );

  $.check`Maps compare by keys and values`(
    $.deepEquals(new Map([['answer', 42]]), new Map([['answer', 42]]))
  );

  $.check`Maps with different values compare unequal`(
    $.notDeepEquals(new Map([['answer', 42]]), new Map([['answer', 43]]))
  );

  $.check`Sets compare independent of insertion order`(
    $.deepEquals(new Set([1, 2, 3]), new Set([3, 2, 1]))
  );

  $.check`Sets with different members compare unequal`(
    $.notDeepEquals(new Set([1, 2, 3]), new Set([1, 2, 4]))
  );

  $.check`NaN is considered deeply equal to itself`(
    $.deepEquals(NaN, NaN)
  );
});


/******************************************************************************/
