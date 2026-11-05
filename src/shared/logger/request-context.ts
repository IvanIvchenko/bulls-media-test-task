import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

/** Carries the id of the request being handled through every `await`, so any log line can name it. */
export const requestContext = new AsyncLocalStorage<RequestContext>();
