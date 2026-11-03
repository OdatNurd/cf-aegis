/******************************************************************************/


import { Collection, $check, $ } from "@axel669/aegis";


/******************************************************************************/


export default Collection`Custom Checks`({
  "Deep Equality Edge Cases": ({ runScope }) => {
    const cycleA = { value: 1 };
    cycleA.self = cycleA;

    const cycleB = { value: 1 };
    cycleB.self = cycleB;

    $check`Cyclic structures terminate and compare equal`
      .value(cycleA)
      .deepEquals($, cycleB);

    $check`Different cyclic structures compare unequal`
      .value(cycleA)
      .notDeepEquals($, { value: 2, self: null });

    $check`Dates compare by timestamp`
      .value(new Date(0))
      .deepEquals($, new Date(0));

    $check`Different dates compare unequal`
      .value(new Date(0))
      .notDeepEquals($, new Date(1));

    $check`Maps compare by keys and values`
      .value(new Map([['answer', 42]]))
      .deepEquals($, new Map([['answer', 42]]));

    $check`Maps with different values compare unequal`
      .value(new Map([['answer', 42]]))
      .notDeepEquals($, new Map([['answer', 43]]));

    $check`Sets compare independent of insertion order`
      .value(new Set([1, 2, 3]))
      .deepEquals($, new Set([3, 2, 1]));

    $check`Sets with different members compare unequal`
      .value(new Set([1, 2, 3]))
      .notDeepEquals($, new Set([1, 2, 4]));

    $check`NaN is considered deeply equal to itself`
      .value(NaN)
      .deepEquals($, NaN);
  }
});


/******************************************************************************/
