/**
 * A simple Durable Object that increments a counter on each visit.
 */
export class Counter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    // Get the current count from storage, defaulting to 0 if it doesn't exist
    let count = (await this.state.storage.get("count")) || 0;

    // Increment the count and store the new value
    count++;
    await this.state.storage.put("count", count);

    // Return the new count
    return new Response(`Durable Object 'Counter' count is: ${count}`);
  }
}


/**
 * The main worker fetch handler.
 */
export default {
  async fetch(request, env) {
    // If the request is for the DO, get a stub and forward the request
    if (new URL(request.url).pathname === "/do") {
      // Get a unique ID for the DO. Using a fixed name ensures we always
      // get the same instance.
      const id = env.DO_COUNTER.idFromName("aegis-test");
      const stub = env.DO_COUNTER.get(id);

      // Forward the request to the Durable Object
      return stub.fetch(request);
    }

    return new Response("Worker fetch handler reached. Use /do to access the Durable Object.");
  },
};