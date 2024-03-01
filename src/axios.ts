import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { EventSourceMessage, getBytes, getLines, getMessages } from "./parse";

// Defines the MIME type for an event stream.
export const EventStreamContentType = "text/event-stream";

// Default interval in milliseconds to wait before retrying a failed request.
const DefaultRetryInterval = 1000;

// HTTP header used to send the ID of the last event received.
const LastEventId = "last-event-id";

/**
 * Enum for categorizing errors into request-related and others.
 */
export enum NodeEventSourceErrorType {
  Request = "Request",
  Other = "Other",
}

/**
 * Interface for the error object, including the type of error and its origin.
 */
export interface NodeEventSourceError {
  type: NodeEventSourceErrorType;
  origin: AxiosError | any; // Origin of the error, AxiosError for request errors, otherwise any type.
}

/**
 * Configuration interface for the NodeEventSource request, extending AxiosRequestConfig but omitting responseType and validateStatus.
 */
export interface NodeEventSourceRequestConfig
  extends Omit<AxiosRequestConfig, "responseType" | "validateStatus"> {
  /**
   * Interval for retrying a request upon failure. Defaults to 1000.
   */
  retryInterval?: number;

  /**
   * Custom headers for the request. Only string key-value pairs are supported.
   */
  headers?: Record<string, string>;

  /**
   * Called when a response is received. Use this to validate that the response
   * actually matches what you expect (and throw if it doesn't.) If not provided,
   * will default to a basic validation to ensure the content-type is text/event-stream.
   * Will call only request status code >= 200 && < 300.
   */
  onOpen?: (response: AxiosResponse) => Promise<void> | void;

  /**
   * Called when a message is received. NOTE: Unlike the default browser
   * EventSource.onmessage, this callback is called for _all_ events,
   * even ones with a custom `event` field.
   */
  onMessage?: (ev: EventSourceMessage) => void;

  /**
   * Called when a response finishes.
   */
  onClose?: () => void;

  /**
   * Called when a network error occurs, return true to retry, return false or not return to abort.
   * If not provided, any NodeEventSourceError will be thrown.
   */
  onError?: (err: NodeEventSourceError) => boolean | void;
}

export function nodeEventSource(
  url: string,
  {
    retryInterval = DefaultRetryInterval,
    signal: inputSignal,
    headers: inputHeaders,
    onOpen = defaultOnOpen,
    onMessage,
    onClose,
    onError = defaultOnError,
    ...rest
  }: NodeEventSourceRequestConfig
) {
  return new Promise<void>((resolve, reject) => {
    // make a copy of the input headers since we may modify it below:
    const headers = { ...inputHeaders };
    if (!headers.accept) {
      headers.accept = EventStreamContentType;
    }

    let curRequestController: AbortController;
    let retryTimer = 0;
    function dispose() {
      clearTimeout(retryTimer);
      curRequestController.abort();
    }

    // if the incoming signal aborts, dispose resources and resolve:
    inputSignal?.addEventListener("abort", () => {
      dispose();
      resolve(); // don't waste time constructing/logging errors
    });

    async function create() {
      curRequestController = new AbortController();

      try {
        const response = await axios({
          url,
          ...rest,
          headers,
          signal: curRequestController.signal,
          responseType: "stream",
        });

        await onOpen(response);

        await getBytes(
          response.data!,
          getLines(
            getMessages(
              (id) => {
                if (id) {
                  // store the id and send it back on the next retry:
                  headers[LastEventId] = id;
                } else {
                  // don't send the last-event-id header anymore:
                  delete headers[LastEventId];
                }
              },
              (retry) => {
                retryInterval = retry;
              },
              onMessage
            )
          )
        );

        onClose?.();
        dispose();
        resolve();
      } catch (err) {
        if (!curRequestController.signal.aborted) {
          // if we haven't aborted the request ourselves:
          try {
            // check if we need to retry:
            const shouldRetry =
              onError?.({
                type:
                  err instanceof AxiosError
                    ? NodeEventSourceErrorType.Request
                    : NodeEventSourceErrorType.Other,
                origin: err,
              }) ?? false;
            clearTimeout(retryTimer);
            if (shouldRetry) {
              retryTimer = setTimeout(create, retryInterval);
            }
          } catch (innerErr) {
            // we should not retry anymore:
            dispose();
            reject(innerErr);
          }
        }
      }
    }

    create();
  });
}

function defaultOnOpen(response: AxiosResponse) {
  const contentType = response.headers["Content-Type"] as string;
  if (!contentType?.startsWith(EventStreamContentType)) {
    throw new Error(
      `Expected content-type to be ${EventStreamContentType}, Actual: ${contentType}`
    );
  }
}

function defaultOnError(err: NodeEventSourceError) {
  throw err;
}
