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
    constructor(message: string, status = 400, code = -1) {
        super(message);
        this.status = status;
        this.code = code;
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

export function handle(err: unknown): NextResponse {
    if (err instanceof HttpError) {
        return fail(err.message, err.status, err.code);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[loom] unhandled error:", err);
    return fail(message, 500, -1);
}
