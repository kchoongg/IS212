// The stand-in for src/lib/prisma.ts in route tests. A test file opts in with
// `vi.mock("@/lib/prisma")`, and Vitest swaps in this module for every import
// of the real one - the route's, and apiAuth's - so no test opens a database
// connection.
//
// Every `prisma.<model>.<method>` is a vi.fn() created the first time it is
// touched, so a test only sets up the calls its route actually makes:
//
//   db.venue.findUnique.mockResolvedValue({ id: "v1", name: "Hall A" });
//
// A method nobody set up returns undefined, like any bare vi.fn().

import { vi, type Mock } from "vitest";

type Model = Record<string, Mock>;

let models: Record<string, Model> = {};
let clientMethods: Record<string, Mock> = {};

function model(name: string): Model {
  models[name] ??= new Proxy({} as Model, {
    get(fns, method) {
      if (typeof method !== "string") return undefined;
      fns[method] ??= vi.fn();
      return fns[method];
    },
  });
  return models[name];
}

/// `prisma.$transaction` in both its forms. The callback form gets this same
/// mock as its `tx`, so a write made inside a transaction is asserted exactly
/// like one made outside it; the array form resolves each query in order.
function transaction(): Mock {
  return vi.fn(async (work: unknown) =>
    typeof work === "function" ? work(prisma) : Promise.all(work as Promise<unknown>[])
  );
}

export const prisma: Record<string, Model> & Record<`$${string}`, Mock> = new Proxy({} as never, {
  get(_target, key) {
    // `then` must stay undefined or awaiting the client would treat it as a promise.
    if (typeof key !== "string" || key === "then") return undefined;
    if (key.startsWith("$")) {
      clientMethods[key] ??= key === "$transaction" ? transaction() : vi.fn();
      return clientMethods[key];
    }
    return model(key);
  },
});

/// Forget every stub and every recorded call. Run before each test (the kit in
/// src/test/kit.ts does it) so one test's setup cannot leak into the next.
export function resetPrismaMock() {
  models = {};
  clientMethods = {};
}
