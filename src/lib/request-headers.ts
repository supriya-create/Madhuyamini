/**
 * Request headers set by `src/proxy.ts` for server components that have no
 * access to the URL (layouts). The proxy overwrites them on every matched
 * request, so a value a client sends never reaches the application.
 */
export const ADMIN_PATH_HEADER = "x-madhuyamini-path";
