import "server-only";
import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { ensureInit } from "./init";
import {
    authenticateGateway as authGateway,
    getCurrentUser,
    requireAdmin,
    requireUser,
    type SessionUser,
} from "./auth";
import { badRequest, fail, handle, HttpError, ok } from "./response";

/**
 * defineRoute — declarative Next.js Route Handler factory.
 *
 * Every API route in this codebase used to repeat the same eight lines:
 *   1. `await ensureInit()`
 *   2. resolve the caller (cookie session or bearer api-key)
 *   3. extract URL params / search params
 *   4. parse + validate the body
 *   5. run the handler
 *   6. wrap success in `ok()`
 *   7. wrap errors in `handle()`
 *   8. `export const runtime / dynamic`
 *
 * `defineRoute({ auth, body, query, params, handler })` collapses all of
 * that into a single declarative call. Authentication is required by
 * default (`auth: "user"`); request shapes are validated with zod and
 * the parsed values are passed to the handler typed.
 *
 *   export const POST = defineRoute({
 *     auth: "admin",
 *     body: z.object({ name: z.string().min(1) }),
 *     handler: async ({ user, body }) => userService.create(user, body),
 *   });
 *
 * The handler can return:
 *   • A plain value           → wrapped in BaseResponse via `ok()`.
 *   • A native `Response`     → passed through (streaming, binary, custom).
 *   • `undefined` / `null`    → ok(null).
 *
 * The wrapper enforces `runtime = "nodejs"` and `dynamic = "force-dynamic"`
 * for every route — Route Handlers must opt out of caching to talk to
 * better-sqlite3, and historically a few routes forgot one or the other.
 */

export type RouteAuth = "public" | "user" | "admin" | "gateway";

interface ParamsCtx<P> { params: Promise<P> }

type Unwrap<T extends z.ZodType | undefined> = T extends z.ZodType ? z.infer<T> : undefined;

export interface RouteHandlerArgs<TAuth extends RouteAuth, TParams, TBody, TQuery> {
    req: NextRequest;
    user: TAuth extends "public" ? SessionUser | null : SessionUser;
    params: TParams;
    body: TBody;
    query: TQuery;
}

export interface DefineRouteOptions<
    TAuth extends RouteAuth,
    PSchema extends z.ZodType | undefined,
    BSchema extends z.ZodType | undefined,
    QSchema extends z.ZodType | undefined,
> {
    auth?: TAuth;
    params?: PSchema;
    body?: BSchema;
    query?: QSchema;
    handler: (
        args: RouteHandlerArgs<TAuth, Unwrap<PSchema>, Unwrap<BSchema>, Unwrap<QSchema>>,
    ) => Promise<unknown> | unknown;
}

export function defineRoute<
    TAuth extends RouteAuth = "user",
    PSchema extends z.ZodType | undefined = undefined,
    BSchema extends z.ZodType | undefined = undefined,
    QSchema extends z.ZodType | undefined = undefined,
>(opts: DefineRouteOptions<TAuth, PSchema, BSchema, QSchema>) {
    const auth = (opts.auth ?? "user") as TAuth;

    return async (req: NextRequest, ctx: ParamsCtx<unknown> = { params: Promise.resolve({}) }) => {
        try {
            await ensureInit();

            // ---- auth ----
            let user: SessionUser | null = null;
            switch (auth) {
                case "public":
                    user = await getCurrentUser();  // may be null, that's fine
                    break;
                case "user":
                    user = await requireUser();
                    break;
                case "admin":
                    user = await requireAdmin();
                    break;
                case "gateway":
                    user = await authGateway(req);
                    break;
            }

            // ---- params ----
            const rawParams = ctx.params ? await ctx.params : {};
            const params = opts.params ? parseOrThrow(opts.params, rawParams, "params") : rawParams;

            // ---- query ----
            const rawQuery = Object.fromEntries(new URL(req.url).searchParams);
            const query = opts.query ? parseOrThrow(opts.query, rawQuery, "query") : rawQuery;

            // ---- body ----
            let body: unknown = undefined;
            if (opts.body) {
                let parsed: unknown = {};
                if (req.method !== "GET" && req.method !== "HEAD") {
                    try {
                        parsed = await req.json();
                    } catch {
                        throw badRequest("Request body must be valid JSON");
                    }
                }
                body = parseOrThrow(opts.body, parsed, "body");
            }

            const result = await opts.handler({
                req,
                user: user as RouteHandlerArgs<TAuth, unknown, unknown, unknown>["user"],
                params: params as Unwrap<PSchema>,
                body: body as Unwrap<BSchema>,
                query: query as Unwrap<QSchema>,
            });

            if (result instanceof Response) return result;
            return ok(result === undefined ? null : result);
        } catch (err) {
            if (err instanceof ZodError) {
                return fail(formatZodIssues(err), 400);
            }
            return handle(err);
        }
    };
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        const message = formatZodIssues(parsed.error, label, value);
        throw new HttpError(message, 400);
    }
    return parsed.data;
}

/** Walk an issue path against the input that failed validation. Returns
 *  `undefined` when the field is absent — which is how we tell "you forgot
 *  this field" apart from "you sent the wrong type".
 *
 *  zod v3 exposed a `received: "undefined"` discriminator on the issue and
 *  this used to read it directly. zod v4 dropped both `received` and
 *  `input` from the issue object, so that check silently became dead code
 *  and every missing-field error started leaking zod's raw wording
 *  ("id: Invalid input: expected string, received undefined") on every
 *  endpoint. Resolving against the input is version-independent. */
function valueAtPath(input: unknown, path: readonly PropertyKey[]): unknown {
    let cur = input;
    for (const segment of path) {
        if (cur === null || typeof cur !== "object") return undefined;
        cur = (cur as Record<PropertyKey, unknown>)[segment];
    }
    return cur;
}

/** Distinguishes "no input available" from "input was literally undefined".
 *  A ZodError thrown from inside a handler reaches `formatZodIssues`
 *  without the value that produced it. */
const NO_INPUT = Symbol("no-input");

function formatZodIssues(err: ZodError, label = "input", input: unknown = NO_INPUT): string {
    if (err.issues.length === 0) return `Invalid ${label}`;
    return err.issues
        .map((i) => {
            const path = i.path.length > 0 ? i.path.join(".") : label;
            // Treat missing required fields specially for nicer error text.
            if (
                i.code === "invalid_type" &&
                input !== NO_INPUT &&
                valueAtPath(input, i.path as readonly PropertyKey[]) === undefined
            ) {
                return `${path}: required`;
            }
            return `${path}: ${i.message}`;
        })
        .join("; ");
}

// Re-export so route files don't have to import zod themselves for trivial schemas.
export { z };
