# AIUI – Copilot Instructions

工业级 AI Gateway，**前后端一体化** 仓库：**Next.js 16 App Router + React 19 + TypeScript (strict) + SQLite (Drizzle ORM)**。Route Handlers (Node runtime) 同时承担 OpenAI 兼容网关、Playground 后端、CRUD API；前端用 TanStack Query + Zustand。**没有独立 Python 后端**（旧 FastAPI 已退役）。

## Commands

使用 **bun**：`bun install`、`bun run dev|build|start|lint`。Drizzle：`bunx drizzle-kit generate|studio`。**别用 npm/yarn/pnpm**（`bun.lock` 是事实源、`package.json` 已 pin `packageManager`）。

若 `bun install` 提示 "Blocked N postinstall"，跑 `bun pm trust <pkg>`（首次至少要 trust `better-sqlite3`、`esbuild`、`unrs-resolver`）。

无测试套件。改完跑 `bun run build`（包含 TS 检查）+ `bun run lint`。

加 shadcn 基础组件用 `bunx shadcn@latest add <component>`（new-york / neutral / lucide）。

## 必备环境变量

| 变量 | 说明 |
|---|---|
| `AIUI_MASTER_KEY` | **必填**。AES-256-GCM 主密钥，加密 Provider 的 `api_key`。轮换会让已存的 key 解不开。 |
| `AIUI_DB_PATH` | SQLite 路径，默认 `./data/aiui.db`（已在 `.gitignore`）。 |
| `AIUI_ADMIN_USERNAME` / `AIUI_ADMIN_PASSWORD` | 首次启动且 `users` 表为空时引导首位 admin；不设置就不引导。 |

## 架构

### Route Groups
- `app/(auth)/login/` — 公开
- `app/(dashboard)/` — `AuthProvider`（`context/auth-context.tsx`）+ `Sidebar` 兜底；不登录跳 `/login?from=…`
- `app/api/**` — Route Handlers（**全部 `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`**，因为 `better-sqlite3` 是 Node-only 原生模块，且响应不能缓存）

### 全局 providers
`components/AppProviders.tsx`（挂在 `app/layout.tsx`）：next-themes → QueryClientProvider（`retry: 1`, `refetchOnWindowFocus: false`）→ `AuthProvider` → `Toaster`。

### 路径别名
`@/*` → repo 根。`@/components`、`@/lib`、`@/lib/server` 等都用别名导入。

## 后端层（`lib/server/**`）

不要把这些文件 import 到客户端组件！每个都以 `import "server-only"` 开头作为防呆。

| 文件 | 职责 |
|---|---|
| `db/schema.ts` | Drizzle schema（users / sessions / api_keys / providers / models / conversations / messages / generation_logs）。**改完必须 `bunx drizzle-kit generate`**，重启时 `lib/server/db/index.ts` 会自动跑 migration。 |
| `db/index.ts` | 单例 `db = drizzle(better-sqlite3)`，开启 WAL + `foreign_keys=ON`；dev 下挂在 globalThis 防热重载重复连接。 |
| `auth.ts` | `createSession`/`getCurrentUser`/`requireUser`/`requireAdmin` + `authenticateBearer`（公共网关用）+ `authenticateGateway`（Bearer 优先、cookie 兜底）。Cookie 名 `aiui_session`，httpOnly + sameSite=lax，30 天 TTL。DB 里只存 SHA256 token。 |
| `password.ts` | `bcrypt` 哈希（cost=10）。 |
| `crypto.ts` | AES-256-GCM `encryptSecret`/`decryptSecret` + `maskSecret` 用于上游 API key；`generateApiKey` 生成 `sk-aiui-…` 凭据并返回 hash。 |
| `response.ts` | `BaseResponse<T>` 信封 + `ok(data)`/`fail(msg)` + `HttpError` 体系（`badRequest` / `unauthorized` / `forbidden` / `notFound`）+ `handle(err)` 统一 catch。 |
| `serializers.ts` | DB row → API DTO（`serializeProvider` / `serializeModel`，含 `n_models` 计数与 `api_key_mask`）。 |
| `gateway.ts` | **网关核心**：`resolveModel(name)`、`forwardChatCompletions(user, body, opts)`（流式时用 `TransformStream` tee 一份做日志累积）、`forwardEmbeddings(user, body)`、`mergeParams`（user > model defaults > provider defaults）。**所有上游调用都自动写 `generation_logs`**。 |
| `bootstrap.ts` + `init.ts` | `ensureInit()` 引导首位 admin，懒加载且只跑一次。**每个 Route Handler 第一行必须 `await ensureInit()`**。 |

### 写新 Route Handler 的样板
```ts
import "server-only";
import { NextRequest } from "next/server";
import { ensureInit } from "@/lib/server/init";
import { requireUser, requireAdmin } from "@/lib/server/auth";
import { handle, ok, badRequest } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        await ensureInit();
        const user = await requireUser();        // 或 requireAdmin()
        // ... drizzle query ...
        return ok(data);
    } catch (err) {
        return handle(err);
    }
}
```

## 前端层

### HTTP（`lib/api.ts`）
所有非流式请求走单例 `api` 对象 — 别在组件里裸 `fetch`。
- `BaseResponse<T> = { code, msg, data }`；`fetcher<T>` 拆 `data`，`code !== 0` 或 HTTP 非 2xx 抛 `ApiError`。
- **认证靠 httpOnly cookie**（每个请求带 `credentials: "include"`）；**别再用** localStorage 或 `Authorization` 头（旧的 `getAuthHeader`/`setAuthHeader` 已删）。
- 401 自动跳 `/login?from=<current>`；登录端点传 `skipAuthRedirect: true` 防循环。
- 流式 chat（`api.playgroundChat`）和 `api.generateTitle` 也走 `credentials: "include"`。

### 状态
- 服务端态 → TanStack Query；key 用稳定数组（`["user","me"]`、`["providers"]`、`["models"]`、`["logs", filters]`、`["apikeys"]`）。
- 客户端态 → `lib/stores/`：
  - `playground-store.ts`（`playground-storage`）— **`partialize` 故意把每个 tab 的 `messages` 清空再持久化**，重新打开时从后端拉。
  - `settings-store.ts`（`aiui-settings`）。

### Playground 流水线（保持模块边界）
- `components/playground/chat/stream-parser.ts` — 纯 SSE 解析器（`event:` + `data:`、`[DONE]`、OpenAI `choices[0].delta.{content,reasoning_content}`）。
- `components/playground/chat/stream-client.ts` — 一个 `StreamClient` 一次请求，自带 `AbortController`，POST `${API_BASE}/playground/chat`，读响应头 `X-Message-ID` / `X-Generation-ID` / `X-Conversation-ID`。
- `components/playground/chat/throttled-updater.ts` — 节流 `setMessages`（默认 100ms）。
- `components/playground/chat/use-chat-stream.ts` — `streamMultiple` 给多模型对比开多个 client；`stopAll` 全部 abort。
- `components/playground/use-playground-chat.ts` — UI 用的编排 hook。

扩展流式协议时在 `stream-parser.ts` 的 `ParsedEvent` 里加新类型，在 `StreamClient.stream` 处理 — **别在别处 parse SSE**。

服务端的 `/api/playground/chat` 路由把请求转给 `lib/server/gateway.ts:forwardChatCompletions`，并在 `onComplete` 里把 assistant 消息写入 `messages` 表。Conversation 不存在则自动创建。

## OpenAI 兼容网关

- `POST /api/v1/chat/completions` / `POST /api/v1/embeddings` / `GET /api/v1/models`
- 鉴权：**Bearer `sk-aiui-…`**（外部应用）或 **session cookie**（同源浏览器场景，比如 `generateTitle`）
- 每次调用都写 `generation_logs`，含上游耗时、tokens、状态、失败原因
- 流式响应用 `TransformStream` tee：原样吐给客户端的同时累积 content 用于日志

## 类型

`lib/types/`（重导出在 `lib/types/index.ts`）：`api`/`provider`/`model`/`user`/`log`/`apikey`。**`playground` 类型故意不在 index 重导出** — 显式 `import from "@/lib/types/playground"`（`lib/api.ts` 也是这么做的）。日期字段都是 ISO 字符串；前端用 `lib/utils.ts` 的 `normalizeDate` / `formatToLocal`（假设 UTC，没时区会补 `Z`）。

## UI 约定

- Tailwind 类合并必走 `cn(...)`（`@/lib/utils`，clsx + tailwind-merge）。
- Icons `lucide-react`、Toast `import { toast } from "sonner"`、主题 `next-themes`。
- Tailwind v4 + CSS variables（设计 token 在 `app/globals.css`）；用语义类 `bg-background` / `text-muted-foreground` / `border-border`，别用裸色。
- 用 hooks/浏览器 API/Zustand/TanStack Query 的文件 **必须** `"use client"` 头。
- shadcn 基础组件（`components/ui/`）是 CLI 生成的 — 升级时优先 `bunx shadcn@latest add` 重生而不是手改。
- Admin-only UI 通过 `useAuth()` 拿 `user?.role === "admin"` 判断。
