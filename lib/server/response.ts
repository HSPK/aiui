import "server-only";
import { NextResponse } from "next/server";

export interface BaseResponse<T> {
    code: number;
    msg: string;
    data: T;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
    const body: BaseResponse<T> = { code: 0, msg: "ok", data };
    return NextResponse.json(body, init);
}

export function fail(msg: string, status = 400, code = -1, init?: ResponseInit): NextResponse {
    const body: BaseResponse<null> = { code, msg, data: null };
    return NextResponse.json(body, { ...init, status });
}

export class HttpError extends Error {
    status: number;
    code: number;
    /** Extra response headers — used for things like `Retry-After` on
     *  429 rate-limit responses. Folded into the NextResponse by
     *  `handle()`. Empty by default. */
    headers?: Record<string, string>;
    constructor(message: string, status = 400, code = -1, headers?: Record<string, string>) {
        super(message);
        this.status = status;
        this.code = code;
        this.headers = headers;
        this.name = "HttpError";
    }
}

export function notFound(msg = "Not found"): HttpError {
    return new HttpError(msg, 404, -1);
}

export function badRequest(msg: string): HttpError {
    return new HttpError(msg, 400, -1);
}

export function unauthorized(msg = "Unauthorized"): HttpError {
    return new HttpError(msg, 401, -1);
}

export function forbidden(msg = "Forbidden"): HttpError {
    return new HttpError(msg, 403, -1);
}

/** 429 Too Many Requests. `retryAfterSeconds` populates the
 *  standard `Retry-After` header so client SDKs (OpenAI, Anthropic,
 *  generic HTTP libs) can back off automatically — without it, the
 *  caller can only scrape seconds out of the human-readable message. */
export function tooManyRequests(msg: string, retryAfterSeconds: number): HttpError {
    return new HttpError(msg, 429, -1, { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) });
}

export function handle(err: unknown): NextResponse {
    if (err instanceof HttpError) {
        const init = err.headers ? { headers: err.headers } : undefined;
        return fail(err.message, err.status, err.code, init);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[loom] unhandled error:", err);
    return fail(message, 500, -1);
}
