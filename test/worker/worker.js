/******************************************************************************/


import { DurableObject } from "cloudflare:workers";


/******************************************************************************/


/* A simple Durable Object that increments a counter on each visit. */
export class Counter extends DurableObject {
  async incrementAndGet() {
    // Get the current count from storage, defaulting to 0 if it doesn't exist.
    // In the RPC-style, storage is accessed via `this.state.storage`.
    let count = (await this.ctx.storage.get("count")) || 0;

    // Increment the count and store the new value.
    count++;
    await this.ctx.storage.put("count", count);

    return count;
  }
}


/******************************************************************************/


/* The main worker fetch handler. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // If the request is for the DO, get a stub and call its RPC method.
    if (url.pathname === "/do") {
      // Get a unique ID for the DO. Using a fixed name ensures we always
      // get the same instance.
      const stub = env.DO_COUNTER.getByName("aegis-test");

      // Instead of forwarding the whole request with stub.fetch(), we now
      // call the specific RPC method we defined on the Counter class.
      const count = await stub.incrementAndGet();

      // Return the new count
      return new Response(`Durable Object 'Counter' count is: ${count}`);
    }

    // If requested, add a simple JSON object to the queue
    if (url.pathname === "/queue") {
      await env.QUEUE_MAIN.send({ url: request.url, method: request.method });
      return new Response("Sent message to queue");
    }

    // Simple test route
    if (url.pathname === "/test") {
      return new Response("Hello World");
    }

    // For any other request, return a 404. This allows Miniflare's
    // transparent static asset serving to handle the request if it matches a file.
    return new Response("Not found", { status: 404 });
  },

  // When the configuration says that we are a consumer of a queue, this gets
  // invoked whenever data arrives at the queue. We push the value into the
  // KV store to be delivered back to the testbed.
  async queue(batch, env) {
    const messages = [];
    for (const message of batch.messages) {
      messages.push(message.body);
      message.ack();
    }
    if (messages.length > 0) {
      await env.KV_CONFIG.put('queue-messages', JSON.stringify(messages));
    }
  },
};


/******************************************************************************/
