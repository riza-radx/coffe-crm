import { QueryClient, environmentManager } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api/fetch-json";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        // 401/403/404/409/422 from our own route handlers are never worth retrying.
        retry: (failureCount, error) =>
          error instanceof ApiRequestError && error.status < 500 ? false : failureCount < 2,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  // On the server every request gets its own client, so no cache is ever shared
  // between two users. In the browser the singleton is reused, because React throws
  // away a client created during a render that suspends.
  if (environmentManager.isServer()) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

/** Called on sign-out: list responses are RBAC-scoped, so the cache must not outlive the session. */
export function clearQueryCache() {
  browserQueryClient?.clear();
}
