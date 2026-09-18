// Barrel — split by domain (auth/events/venues/equipment/registrations) so
// each ticket's schema changes touch one small file instead of everyone
// sharing one large validation.ts. Every existing `@/lib/validation` and
// `../validation` import keeps resolving here unchanged; nothing was removed
// or renamed, only moved.

export * from "./auth";
export * from "./events";
export * from "./venues";
export * from "./equipment";
export * from "./registrations";
