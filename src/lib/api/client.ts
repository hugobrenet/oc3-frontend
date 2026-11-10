import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { authorizationHeader } from "./auth";
import {
  IMPERSONATE_HEADER,
  IMPERSONATION_REFUSED_HEADER,
  impersonationHeader,
} from "./impersonation";
import { sessionRefused, stopImpersonating } from "@/lib/session";

/**
 * HTTP client typed from the OpenAPI spec of the oc3 apicollector.
 * In dev, /api is proxied by Vite to OC3_API_TARGET.
 *
 * With an OIDC session the cookie goes with every request on its own (same
 * origin); with the collector password, the Basic header is added here.
 */
/** The path the API is served under, the SPA's own origin proxying it. */
export const API_BASE = "/api";

// The global fetch is looked up at each request rather than captured at load: a
// test that stubs it reaches this client as it reaches `apiGetDynamic`.
export const api = createClient<paths>({
  baseUrl: API_BASE,
  fetch: (request) => globalThis.fetch(request),
});

/**
 * Header the server requires on the requests of a cookie session that change
 * something: only same-origin JavaScript can set it, which a forged cross-site
 * request cannot do.
 */
const CSRF_HEADER = "X-OC3-CSRF";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

api.use({
  onRequest({ request }) {
    const header = authorizationHeader();
    if (header !== null) request.headers.set("Authorization", header);
    if (!SAFE_METHODS.has(request.method.toUpperCase())) request.headers.set(CSRF_HEADER, "1");
    const impersonate = impersonationHeader();
    if (impersonate !== null) request.headers.set(IMPERSONATE_HEADER, impersonate);
    return request;
  },
  onResponse({ response }) {
    // The privilege was withdrawn or the user removed: back to one's own identity.
    if (response.headers.has(IMPERSONATION_REFUSED_HEADER)) stopImpersonating();
    // Credentials refused or session ended: back to the sign-in screen, or, for an
    // OIDC session, a notice offering to sign in again (`sessionRefused`).
    if (response.status === 401) sessionRefused();
    return response;
  },
});

/** Answer of an API call on a path known only at runtime. */
export interface DynamicResponse {
  status: number;
  body: unknown;
}

/**
 * Whether path names an API endpoint and nothing else: absolute, without query,
 * fragment, backslash, empty or dot segment ("." or "..", encoded or not, which
 * the URL parser resolves before the request leaves).
 */
export function isApiPath(path: string): boolean {
  if (!path.startsWith("/") || /[?#\\]/.test(path)) return false;
  return path
    .slice(1)
    .split("/")
    .every((segment) => segment !== "" && !/^(?:\.|%2e){1,2}$/i.test(segment));
}

/**
 * GET on an API path known only at runtime, such as the candidates a form
 * definition fetches from any collector endpoint: the typed client needs the path
 * at compile time. Same credentials and same handling of a refused session as
 * `api`. Repeated query keys carry a list. A path that is not a plain API
 * path (isApiPath) is refused before any request. `signal` stops the request, for a
 * reader that goes away before the answer.
 */
export async function apiGetDynamic(
  path: string,
  query: Record<string, string | string[]>,
  signal?: AbortSignal,
): Promise<DynamicResponse> {
  if (!isApiPath(path)) throw new Error(`invalid API path: ${path}`);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const headers = new Headers({ Accept: "application/json" });
  const header = authorizationHeader();
  if (header !== null) headers.set("Authorization", header);
  const impersonate = impersonationHeader();
  if (impersonate !== null) headers.set(IMPERSONATE_HEADER, impersonate);
  const qs = params.toString();
  const response = await fetch(`/api${path}${qs === "" ? "" : `?${qs}`}`, { headers, signal });
  if (response.status === 401) sessionRefused();
  if (response.headers.has(IMPERSONATION_REFUSED_HEADER)) stopImpersonating();
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // Not JSON: the text itself, for the error message.
  }
  return { status: response.status, body };
}
