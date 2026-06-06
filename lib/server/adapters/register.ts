import "server-only";

/**
 * Side-effect-only imports that register each built-in adapter with the
 * registry. Modules in `lib/server/adapters/<id>.ts` call `registerAdapter(...)`
 * at module-load time.
 *
 * IMPORTANT: registration ORDER matters — `resolveAdapter()` falls back
 * to "first `matches()` true" when no explicit `adapter_id` is set.
 * Register the most specific adapters first so they shadow the more
 * general ones.
 *
 * (TDZ guard: just like `capabilities/register.ts`, this is the ONLY
 *  place that does the side-effect imports — do NOT move them into
 *  `index.ts` or the const registries hit a temporal-dead-zone race.)
 */

import "./azure-foundry"; // most specific (matches *.inference.ai.azure.com)
import "./azure-openai";  // matches *.openai.azure.com (sans inference)
import "./openai";        // catch-all fallback
