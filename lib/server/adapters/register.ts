import "server-only";

/**
 * Side-effect-only imports that register each built-in adapter with the
 * registry. Modules in `lib/server/adapters/<id>.ts` call `registerAdapter(...)`
 * at module-load time.
 *
 * Registration order is NOT load-bearing: `resolveAdapter()` skips adapters
 * flagged `fallback: true` (the openai catch-all) while probing, so a
 * specific adapter wins no matter when it registered. This used to depend on
 * import order, and `azure-foundry.ts`'s value import of `./openai` quietly
 * broke it — every provider without an explicit `adapter_id` resolved to
 * plain openai, including Azure ones.
 *
 * (TDZ guard: just like `capabilities/register.ts`, this is the ONLY
 *  place that does the side-effect imports — do NOT move them into
 *  `index.ts` or the const registries hit a temporal-dead-zone race.)
 */

import "./azure-foundry"; // matches *.services.ai.azure.com / *.inference.ai.azure.com
import "./azure-openai";  // matches *.openai.azure.com
import "./openai";        // catch-all fallback (fallback: true)
