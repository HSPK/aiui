import "server-only";
import { promises as fs, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Image artifact persistence for `generation_logs`.
 *
 * Why: image-generation upstreams return either a hosted `url` (which
 * expires) or a base64 `b64_json` blob (~MB per image). Persisting the
 * raw b64 inline in `generation_logs.generation` (JSON column) bloats
 * the DB by a factor of 10–100× and makes the log viewer's JSON tree
 * unusable. Mirroring the existing `sanitizeForJsonView` strategy for
 * large text/JSON, we strip the b64 from the log payload and write
 * each image to a per-log directory on disk; the log keeps a stable
 * `url` reference (and `loom_artifact: true` marker) that the FE log
 * viewer reads to render inline thumbnails.
 *
 * The original (untouched) payload is still served to the API caller
 * — only the *log copy* is rewritten. The image-generation playground
 * therefore continues to receive b64_json verbatim.
 */

const USER_CWD = process.env.LOOM_USER_CWD || process.cwd();
const ARTIFACTS_ROOT = resolve(USER_CWD, "data", "log-artifacts");

export interface PersistedArtifact {
    /** Position within the upstream `data[]` array. */
    index: number;
    mime: string;
    bytes: number;
    /** Absolute filesystem path. */
    path: string;
    /** Same-origin URL the FE viewer (and the log JSON) reference. */
    url: string;
}

function extFromMime(mime: string): string {
    switch (mime.toLowerCase()) {
        case "image/png": return "png";
        case "image/jpeg":
        case "image/jpg": return "jpg";
        case "image/webp": return "webp";
        case "image/gif": return "gif";
        default: return "bin";
    }
}

export function artifactDir(logId: string): string {
    return resolve(ARTIFACTS_ROOT, logId);
}

export function artifactPath(logId: string, index: number, ext: string): string {
    return resolve(artifactDir(logId), `${index}.${ext}`);
}

export function artifactUrl(logId: string, index: number): string {
    return `/api/logs/generations/${encodeURIComponent(logId)}/images/${index}`;
}

/**
 * Walk the log copy of `normalized.data[]` and persist every `b64_json`
 * to disk. Mutates the passed object in place — callers MUST clone
 * first if they need to preserve the original (e.g. to forward it to
 * the API caller as-is).
 *
 * Returns the descriptors of every artifact written, ordered by index.
 *
 * SECURITY: strips upstream-forged `loom_artifact` / `loom_artifacts`
 * markers FIRST so a compromised provider can't pre-set the trust
 * markers + a `javascript:` url that the FE gallery would then render
 * as `<a href>` (stored XSS). The markers are reserved for THIS
 * function — set them only on entries we ourselves wrote to disk.
 */
export async function persistImageArtifacts(
    logId: string,
    normalized: Record<string, unknown>,
): Promise<PersistedArtifact[]> {
    // Strip any forged top-level marker before we touch anything else.
    delete (normalized as Record<string, unknown>).loom_artifacts;

    const data = (normalized as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];

    const artifacts: PersistedArtifact[] = [];
    let dirEnsured = false;

    for (let i = 0; i < data.length; i++) {
        const entry = data[i];
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        // Strip per-entry forged markers — if the upstream returned
        // {loom_artifact:true, url:"javascript:..."} we must NOT let
        // it survive into the log payload that the FE will trust.
        delete e.loom_artifact;
        const b64 = typeof e.b64_json === "string" ? e.b64_json : null;
        if (!b64) continue;

        // Decode + write.
        const buf = Buffer.from(b64, "base64");
        const mime = typeof e.mime === "string"
            ? e.mime
            : typeof e.output_format === "string"
              ? `image/${e.output_format}`
              : "image/png";
        const ext = extFromMime(mime);
        const path = artifactPath(logId, i, ext);

        if (!dirEnsured) {
            mkdirSync(artifactDir(logId), { recursive: true });
            dirEnsured = true;
        }
        await fs.writeFile(path, buf);

        // Rewrite the entry: drop the b64 blob, point `url` at our
        // same-origin proxy, and mark it so the FE log viewer knows
        // this URL is a loom-managed artifact (vs an expiring upstream
        // URL). Keeping the rest of the upstream entry intact
        // preserves fields like `revised_prompt`.
        delete e.b64_json;
        e.url = artifactUrl(logId, i);
        e.loom_artifact = true;
        e.bytes = buf.byteLength;
        e.mime = mime;

        artifacts.push({
            index: i,
            mime,
            bytes: buf.byteLength,
            path,
            url: artifactUrl(logId, i),
        });
    }

    // Top-level convenience array — lets the FE viewer enumerate
    // artifacts without re-walking `data[]`.
    if (artifacts.length > 0) {
        (normalized as Record<string, unknown>).loom_artifacts = artifacts.map((a) => ({
            index: a.index,
            url: a.url,
            mime: a.mime,
            bytes: a.bytes,
        }));
    }
    return artifacts;
}

/** Filesystem read for the artifact route — performs a path-traversal
 *  guard since `index` comes off the URL. */
export async function readArtifact(
    logId: string,
    index: number,
): Promise<{ buf: Buffer; mime: string } | null> {
    // Probe each known extension; cheap (≤4 readFile attempts) and avoids
    // listing the directory just to find the right suffix. The first
    // missing file we hit also implicitly probes the parent dir, so
    // there's no need for a separate existsSync — let ENOENT bubble.
    for (const ext of ["png", "jpg", "webp", "gif", "bin"]) {
        const path = artifactPath(logId, index, ext);
        try {
            const buf = await fs.readFile(path);
            const mime = ext === "jpg" ? "image/jpeg" : ext === "bin" ? "application/octet-stream" : `image/${ext}`;
            return { buf, mime };
        } catch {
            // not this ext (or dir missing); fall through
        }
    }
    return null;
}

/** Best-effort recursive removal of every artifact attached to a
 *  generation_logs row. Called when the row is deleted (directly or
 *  via cascade from user deletion) — without this, every image-gen
 *  log leaks its on-disk blobs forever even after the DB row vanishes.
 *  Swallows ENOENT and any other FS error so log deletion never fails
 *  because the artifacts dir was already removed. */
export async function removeArtifacts(logId: string): Promise<void> {
    try {
        await fs.rm(artifactDir(logId), { recursive: true, force: true });
    } catch {
        // Best-effort — swallow.
    }
}
