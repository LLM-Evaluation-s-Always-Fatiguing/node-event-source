# Node Event Source

[![github-releases](https://img.shields.io/npm/dm/%40llm-eaf%2Fnode-event-source?color=7B916E&labelColor=black&logo=github&style=for-the-badge)](https://www.npmjs.com/package/@llm-eaf/node-event-source)

> This library was inspired by and includes some code from [@microsoft/fetch-event-source](https://github.com/Azure/fetch-event-source). We are grateful to the author and contributors of that library.

This library offers an enhanced API for making [Event Source requests](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), also known as server-sent events, incorporating all the features available in the [Axios API](https://axios-http.com/docs/api_intro) for use within a Node.js environment.

The [default browser EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) imposes several restrictions on the type of request you're allowed to make: the [only parameters](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/EventSource#Parameters) you're allowed to pass in are the `url` and `withCredentials`, so:

- You cannot pass in a request body: you have to encode all the information necessary to execute the request inside the URL, which is [limited to 2000 characters](https://stackoverflow.com/questions/417142) in most browsers.
- You cannot pass in custom request headers
- You can only make GET requests - there is no way to specify another method.
- If the connection is cut, you don't have any control over the retry strategy: the browser will silently retry for you a few times and then stop, which is not good enough for any sort of robust application.

This library provides an alternate interface for consuming server-sent events, based on the Axios API. It is fully compatible with the [Event Stream format](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format), so if you already have a server emitting these events, you can consume it just like before. However, you now have greater control over the request and response so:

- You can use any request method/headers/body, plus all the other functionality exposed by axios() except `responseType` and `validateStatus`.
- You have access to the response object if you want to do some custom validation/processing before parsing the event source. This is useful in case you have API gateways (like nginx) in front of your application server: if the gateway returns an error, you might want to handle it correctly.
- If the connection gets cut or an error occurs, you have full control over the retry strategy.

# Install

```sh
npm install @llm-eaf/node-event-source axios
```

# Usage

```ts
import { nodeEventSource } from "@llm-eaf/node-event-source";

await nodeEventSource("/api/sse", {
  onMessage(ev) {
    console.log(ev.data);
  },
});
```

> If your server not response with text/event-stream Content-Type, please use your own onOpen callBack.

```ts
import { nodeEventSource } from "@llm-eaf/node-event-source";

await nodeEventSource("/api/sse", {
  onOpen(response) {
  },
  onMessage(ev) {
    console.log(ev.data);
  },
});
```

You can pass in all the [other parameters](https://axios-http.com/docs/req_config) except `responseType` and `validateStatus` exposed by the default axios API, for example:

```ts
const ctrl = new AbortController();
nodeEventSource("/api/sse", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: {
    foo: "bar",
  },
  signal: ctrl.signal,
});
```

You can add better error handling, for example:

```ts
class FatalError extends Error {}

nodeEventSource("/api/sse", {
  async onopen(response) {
    
  },
  onMessage(msg) {
    // if the server emits an error message, throw an exception
    // so it gets handled by the onerror callback below:
    if (msg.event === "FatalError") {
      throw new FatalError(msg.data);
    }
  },
  onError(err) {
    if (err instanceof FatalError) {
      throw err; // rethrow to stop the operation
    } else if (err instanceof NodeEventSourceError) {
      switch (err.type) {
        case NodeEventSourceErrorType.Request:
          const axiosError = err.origin as AxiosError;
          // you can handle the axios error here https://axios-http.com/docs/handling_errors
          break;
        case NodeEventSourceErrorType.Other:
          break;
        default:
          break;
      }
    } else {
      console.error(err);
    }
    // return true to retry.
  },
});
```
