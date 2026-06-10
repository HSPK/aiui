import "server-only";
import type { SessionUser } from "../auth";
import { getCapability } from "../capabilities";
import { resolveVariantId, type UpstreamCallArgs } from "../adapters";
import { applyFieldFilter } from "../adapters/openai";
import { getVariant, type VariantContext } from "../api-variants";
import { getPreferences } from "../preferences";
import { badRequest, HttpError } from "../response";
import { mergeParams, resolveModel } from "./index";
import { completeLog, startLog } from "./log";
import { handleNonStream } from "./non-stream";
import type { ForwardResult } from "./types";

/**
 * Multipart upstream forwarder for capabilities whose upstream wire
 * shape is `multipart/form-data` (audio.transcription, video create).
 *
 * The standard JSON pipeline in `forwardGeneration` doesn't apply
 * here — there's no canonical chat-completion body to merge, no
 * `transformRequest`, no `applyFieldFilter`. We resolve the model →
 * provider, post the FormData verbatim (letting fetch set the
 * Content-Type with the right boundary), and route the response
 * through the same `handleNonStream` path so logs stay uniform.
 *
 * `model` MUST be present as a form field — same contract as the
 * JSON gateway.
 */
export async function forwardMultipartGeneration(
    user: SessionUser,
    capabilityId: string,
    form: FormData,
    opts: { signal?: AbortSignal } = {},
): Promise<ForwardResult> {
    const capability = getCapability(capabilityId);
    if (!capability) throw badRequest(`Unknown capability "${capabilityId}"`);

    const requestedModel = form.get("model");
    if (typeof requestedModel !== "string" || !requestedModel) {
        throw badRequest("`model` form field is required");
    }

    const { model, provider, adapter, meta, apiKey } = await resolveModel(requestedModel);

    const variantId = resolveVariantId(adapter, capability, model, meta);
    const variant = getVariant(variantId);
    if (!variant) throw badRequest(`No upstream variant registered for "${variantId}"`);
    if (variant.capability !== capability.id) {
        throw badRequest(
            `Variant "${variantId}" serves "${variant.capability}", not "${capability.id}"`,
        );
    }

    const ctx: VariantContext = { provider, model, meta, capability, stream: false };
    const callArgs: UpstreamCallArgs = { provider, model, meta, capability, variant, stream: false };

    // Apply the same merge + filter pipeline as the JSON path, even
    // though the body is FormData. Without this, `model.default_params`
    // is silently ignored on multipart capabilities (audio transcription,
    // video create), and Foundry's strict `accepted_fields` / `rejected_fields`
    // filter is bypassed — both contract violations vs. CLAUDE.md.
    //
    // Strategy: extract the scalar (non-File) fields into a JSON-shaped
    // dict, run mergeParams + applyFieldFilter on it, rebuild the
    // FormData with merged scalars + original File entries. File
    // entries are never subject to default_params merge (they're the
    // payload, not metadata).
    const scalars: Record<string, unknown> = {};
    const files: Array<[string, File]> = [];
    for (const [k, v] of form.entries()) {
        if (v instanceof File) {
            files.push([k, v]);
        } else {
            scalars[k] = String(v);
        }
    }
    let mergedScalars: Record<string, unknown>;
    let filteredScalars: Record<string, unknown>;
    try {
        mergedScalars = mergeParams(scalars, model, provider);
        filteredScalars = applyFieldFilter(mergedScalars, meta);
    } catch (err) {
        if (err instanceof HttpError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw badRequest(`Failed to translate multipart body: ${message}`);
    }

    // Re-stamp model with upstream id so providers / Azure deployment
    // routing stays consistent with the JSON path.
    filteredScalars.model = model.upstreamModelId;

    const upstreamForm = new FormData();
    for (const [k, v] of Object.entries(filteredScalars)) {
        if (v === undefined || v === null) continue;
        if (typeof v === "object") {
            upstreamForm.append(k, JSON.stringify(v));
        } else {
            upstreamForm.append(k, String(v));
        }
    }
    for (const [k, file] of files) upstreamForm.append(k, file);

    // Summarise BEFORE the upstream-id rewrite so logs reflect the
    // caller-facing model + any text prompt fields.
    const summary = summariseForm(form, capability.id);
    const logId = startLog({
        userId: user.id,
        modelName: model.name,
        capability: capability.id,
        requestBody: redactForm(form),
        inputSummary: summary?.slice(0, 1000) ?? null,
    });

    // Drop the JSON Content-Type the adapter would have set — fetch
    // generates `multipart/form-data; boundary=…` automatically when
    // body is FormData and Content-Type is absent.
    const headers = { ...adapter.upstreamHeaders(callArgs, apiKey) };
    delete headers["Content-Type"];
    delete headers["content-type"];

    const started = Date.now();
    // Multipart endpoints are non-stream (audio.speech / transcription
    // returns the full audio buffer, video create returns a job id),
    // so the operative timeout is a real wall-clock cap on the
    // upstream call. MIN(model.timeout, user_pref) so neither setting
    // can be silently bypassed — see comment in forwardGeneration.
    // Compose with the caller signal so EITHER a client disconnect
    // (mid-upload of an MB-sized audio file) OR the deadline aborts
    // the upstream POST. Without combining, the upstream fetch would
    // hold the socket + spend provider $ until the timeout elapsed
    // even after the client gave up.
    const userTimeoutSec = getPreferences(user.id).gateway_timeout_seconds;
    const effectiveSec = Math.max(1, Math.min(userTimeoutSec, model.timeout));
    const timeoutMs = effectiveSec * 1000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = opts.signal
        ? AbortSignal.any([opts.signal, timeoutSignal])
        : timeoutSignal;
    let upstream: Response;
    try {
        upstream = await fetch(adapter.upstreamUrl(callArgs), {
            method: "POST",
            headers,
            body: upstreamForm,
            signal: combinedSignal,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        completeLog(logId, { status: "failed", reason: message, totalLatencyMs: Date.now() - started });
        throw new HttpError(`Upstream request failed: ${message}`, 502);
    }

    if (!upstream.ok) {
        const text = await upstream.text().catch(() => upstream.statusText);
        completeLog(logId, {
            status: "failed",
            reason: `Upstream HTTP ${upstream.status}`,
            output: text.slice(0, 4000),
            totalLatencyMs: Date.now() - started,
        });
        return {
            response: new Response(text, {
                status: upstream.status,
                headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
            }),
            logId,
        };
    }

    return handleNonStream({ upstream, variant, ctx, opts: {}, started, logId });
}

function summariseForm(form: FormData, capabilityId: string): string | null {
    const prompt = form.get("prompt");
    if (typeof prompt === "string" && prompt) return prompt;
    if (capabilityId === "audio.transcription") {
        const f = form.get("file");
        const name = f instanceof File ? f.name : null;
        const size = f instanceof File ? f.size : null;
        if (name) return `audio file: ${name}${size ? ` (${size} bytes)` : ""}`;
        return "audio input";
    }
    return null;
}

function redactForm(form: FormData): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) {
        if (v instanceof File) {
            out[k] = { _kind: "file", name: v.name, type: v.type, size: v.size };
        } else {
            const s = String(v);
            out[k] = s.length > 4000 ? `${s.slice(0, 4000)}…(+${s.length - 4000})` : s;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Generic upstream proxy: used by polling/download/delete endpoints that hang
// off the same provider as the create call (e.g. GET /videos/{id}, DELETE
// /videos/{id}, GET /videos/{id}/content).
// ---------------------------------------------------------------------------

interface ProxyArgs {
    user: SessionUser;
    /** Caller-facing model name so we can resolve which provider owns this resource. */
    modelName: string;
    /** Relative path appended to provider.baseUrl (must include leading slash). */
    path: string;
    method?: "GET" | "DELETE" | "POST";
    /** Optional query string (no leading `?`). */
    query?: string;
    body?: BodyInit;
    /** Override / supplement adapter headers. */
    headers?: Record<string, string>;
    /** Optional caller signal (e.g. client disconnect on a long poll) —
     *  combined with the gateway timeout so EITHER aborts the upstream. */
    signal?: AbortSignal;
}

/**
 * Lightweight proxy for follow-up requests that ride on top of a
 * previously-created resource. No gateway pipeline, no log — the
 * resource creation was already logged at submit time. Routes through
 * the resolved adapter's `resourceUrl` + `resourceHeaders` so Azure
 * deployments (where polling must hit
 * `/openai/deployments/{deployment}/videos/{id}?api-version=...`
 * with `api-key:` instead of `Authorization: Bearer …`) work
 * end-to-end without per-adapter branching here.
 */
export async function gatewayProxy(args: ProxyArgs): Promise<Response> {
    const { model, provider, adapter, apiKey } = await resolveModel(args.modelName);
    if (!provider.enabled) throw badRequest(`Provider "${provider.name}" is disabled`);

    const resourceArgs = {
        provider,
        model,
        path: args.path,
        query: args.query,
    };
    const buildUrl = adapter.resourceUrl ?? ((a) => {
        const base = a.provider.baseUrl.replace(/\/$/, "");
        let u = `${base}${a.path}`;
        if (a.query) u += `?${a.query}`;
        return u;
    });
    const buildAuth = adapter.resourceHeaders ?? ((_a, key) => {
        const h: Record<string, string> = {};
        if (key) h["Authorization"] = `Bearer ${key}`;
        return h;
    });

    const url = buildUrl(resourceArgs);
    const headers: Record<string, string> = { ...buildAuth(resourceArgs, apiKey) };
    Object.assign(headers, args.headers ?? {});
    if (args.body && !headers["Content-Type"] && !(args.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    // Same MIN(user_pref, model.timeout) cap as the JSON/multipart
    // paths — without it, a stalled upstream would hang each poll /
    // download / delete indefinitely, leaking server sockets on every
    // misbehaving video job.
    const userTimeoutSec = getPreferences(args.user.id).gateway_timeout_seconds;
    const effectiveSec = Math.max(1, Math.min(userTimeoutSec, model.timeout));
    const timeoutSignal = AbortSignal.timeout(effectiveSec * 1000);
    const combinedSignal = args.signal
        ? AbortSignal.any([args.signal, timeoutSignal])
        : timeoutSignal;

    const res = await fetch(url, {
        method: args.method ?? "GET",
        headers,
        body: args.body,
        signal: combinedSignal,
    });

    // Pass-through: preserve content-type so binary downloads work.
    const passthroughHeaders: Record<string, string> = {
        "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
    };
    const cl = res.headers.get("Content-Length");
    if (cl) passthroughHeaders["Content-Length"] = cl;
    const cd = res.headers.get("Content-Disposition");
    if (cd) passthroughHeaders["Content-Disposition"] = cd;

    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: passthroughHeaders,
    });
}
