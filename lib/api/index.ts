// Per-domain api modules. Each `*Resource` object exposes both raw fetch
// functions and TanStack Query hooks generated from a single descriptor —
// see lib/api/resource.ts. Custom (non-CRUD) endpoints are colocated in
// the same module.

export { auth } from "./auth";
export { users } from "./users";
export { providers } from "./providers";
export { models } from "./models";
export { apiKeys } from "./apikeys";
export { logs } from "./logs";
export { conversations, messages } from "./conversations";
export { gateway } from "./gateway";
export { capabilities } from "./capabilities";

export { ApiError, fetcher, rawFetch, withQuery, API_BASE } from "./client";
export { defineResource } from "./resource";
