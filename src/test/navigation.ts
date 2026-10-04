// Stand-in for `next/navigation` in tests (aliased in vitest.config.mts).
//
// The real hooks need the App Router mounted around the component. Here they
// read from plain variables a test sets, and `router` is a set of spies:
//
//   setRoute("/events/EVT-000007", { id: "EVT-000007" });
//   ...
//   expect(router.push).toHaveBeenCalledWith("/events");

import { vi } from "vitest";

export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

let pathname = "/";
let params: Record<string, string> = {};
let search = new URLSearchParams();

/// Where the component under test thinks it is. `path` may carry a query
/// string; `routeParams` are the dynamic segments, e.g. { id: "EVT-000007" }.
export function setRoute(path: string, routeParams: Record<string, string> = {}) {
  const [name, query = ""] = path.split("?");
  pathname = name;
  search = new URLSearchParams(query);
  params = routeParams;
}

export function resetNavigation() {
  setRoute("/");
  Object.values(router).forEach((spy) => spy.mockReset());
}

export const useRouter = () => router;
export const usePathname = () => pathname;
export const useParams = () => params;
export const useSearchParams = () => search;

export function redirect(url: string): never {
  throw new Error(`redirect(${url})`);
}

export function notFound(): never {
  throw new Error("notFound()");
}
