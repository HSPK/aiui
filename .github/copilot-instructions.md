# AIUI – Copilot Instructions

工业级 AI Gateway，**前后端一体化** 仓库：**Next.js 16 App Router + React 19 + TypeScript (strict) + SQLite (Drizzle ORM)**。Route Handlers (Node runtime) 同时承担 OpenAI 兼容网关、Playground 后端、CRUD API；前端用 TanStack Query + Zustand。**没有独立 Python 后端**（旧 FastAPI 已退役）。

## 设计准则（修改/新增功能时必须遵守）

1. **修改一个字段 / 新增一个端点 / 新增一种模态时，代码改动量必须降到最小**。已有的 factory 模式都是为此服务的——不要绕过它们写一遍重复样板：
   | 新增 | 改动文件 |
   |---|---|
   | 一个 wire-format 字段 | 1 个 zod schema + 1 列 Drizzle column + 1 行 serializer |
   | 一个 CRUD 端点 | 1 段 zod + 1 个 `defineRoute(...)` + 1 个 service 函数（FE api/hooks/keys 自动派生） |
   | 一种新模态（image / video / 自定义协议） | 1 个 `capabilities/<id>.ts` + 1 行 `register.ts` 的 side-effect import + 1 个 6 行 Route Handler 调 `forwardGeneration(user, "<id>", body)` |
   | 一个新的 FE domain | 1 个 `defineResource(...)` 调用（5 行） |
2. **功能保持原子性**：一个 domain 一个文件夹（`lib/server/<domain>/` + `lib/api/<domain>.ts` + `lib/schemas/<domain>.ts`）。**不要**给一个 domain 拆出 schemas/service/serializer 又各起一遍 thin re-export 层。
3. **单一真相**：`lib/schemas/<domain>.ts`（zod）是 wire 类型唯一来源；`lib/server/db/schema.ts`（Drizzle）是 DB 唯一来源；前端 / 服务端类型一律 `z.infer` 派生。**不要**手写并行的 TS interface。
4. **开发阶段不保持向后兼容**：thin re-export、过渡 alias、unused dead code，发现就删；通过 `bun run build` 与各 e2e 验证。
5. **工厂模式**优先（`defineRoute` / `defineResource` / `registerCapability`）；只有当 endpoint 形态确实特殊（auth/gateway 流式 / 单例 prefs）才手写。

## Commands

使用 **bun**：`bun install`、`bun run dev|build|start|lint`。Drizzle：`bunx drizzle-kit generate|studio`。**别用 npm/yarn/pnpm**（`bun.lock` 是事实源、`package.json` pin 了 `packageManager`）。首次 `bun install` 出 "Blocked N postinstall" 时跑 `bun pm trust <pkg>`（至少要 trust `better-sqlite3`、`esbuild`、`unrs-resolver`）。

加 shadcn 基础组件：`bunx shadcn@latest add <component>`（new-york / neutral / lucide）。

**没有单元测试套件**。验证流程：
1. `bun run build`（包含 TS 严格检查）
2. `bun run lint`（**baseline 是 129 problems** — 都是 pre-existing；只看自己改动有没有引入新 error）
3. `node scripts/e2e-<feature>.mjs`（在线场景测试，见下）

### E2E 脚本（`scripts/*.mjs`）

每个脚本会在临时目录 spin 起整个 stack（带 stub upstream 时也 spin 一个 stub），跑完打印 `N/M expectations passed` 并 exit 0/1：

- `scripts/e2e-latency-split.mjs` — gateway 转发 + 日志记录的 TTFT / total 拆分（streaming 和 non-streaming 两条路径都验）
- `scripts/e2e-preferences.mjs` — `/api/users/me/preferences` round-trip（默认值、partial PATCH 不动其他字段、跨 GET 持久化、zod 校验）

跑单个：`node scripts/e2e-latency-split.mjs`。改动 gateway / logs / preferences / schemas 时都要跑相关脚本。新增功能也鼓励加一个 `scripts/e2e-<feature>.mjs`，跟随同一 spawn-server-then-curl 风格。

## 必备环境变量

配置文件是单一真相，但 env vars 始终优先于配置。下表里的所有变量都对应配置文件的一个字段（见下一节）：

| 变量 | 配置文件字段 | 说明 |
|---|---|---|
| `AIUI_MASTER_KEY` | `master_key` | AES-256-GCM 主密钥。轮换会让已存 key 解不开。 |
| `AIUI_DB_PATH` | `database.path` | SQLite 路径，默认 `<userCwd>/data/aiui.db`（已 gitignore）。**只通过 CLI 配置生效**——`bun run start` 直接走需要 env。 |
| `AIUI_CONFIG_PATH` | — | 配置文件路径覆盖；不设按下文顺序搜索。 |
| `AIUI_USER_CWD` | — | **CLI 自动设置**：`bin/aiui.mjs` 把用户当前目录传给 Next，使 `preflight` 和 `db/index.ts` 都基于用户工作目录解析路径。手写代码一律走 `process.env.AIUI_USER_CWD || process.cwd()`。 |
| `AIUI_ADMIN_USERNAME` / `AIUI_ADMIN_PASSWORD` | `admin.username` / `admin.password` | 首次启动且 `users` 表为空时引导首位 admin。 |
| `AIUI_SESSION_TTL_DAYS` | `session.ttl_days` | 浏览器会话 TTL，默认 30。在 `auth.ts:sessionTtlMs()` 每次创建 session 时读，所以 CLI 之外也能生效。 |
| `AIUI_MODELS_CACHE_TTL` | `cache.models_ttl_seconds` | `/models` 发现缓存的秒数，默认 300。`discovery.ts:cacheTtlMs()` 按需读。 |
| `AIUI_SERVER_PORT` / `AIUI_SERVER_HOSTNAME` | `server.port` / `server.hostname` | CLI 启动监听；`-p`/`-H` 仍优先。Next 进程里没人用。 |

## CLI（`bin/aiui.mjs`）

`package.json` `bin` 字段把它暴露为 `aiui` 命令。子命令：

- `aiui init-config [--out PATH | --user | --print | --force]` — 生成带随机 `master_key` 的 YAML 模板（含全部 infra 段 + OpenAI/Azure provider 示例 + 所有注释）。默认写 `./aiui.config.yaml`。
- `aiui start` / `aiui dev` — **先跑 `preflightFromConfig()`**（hoist 所有 env vars）再 spawn 包目录里的 `next` binary，同时注入 `AIUI_USER_CWD=process.cwd()`。
- 无参 → `aiui start`。

不要在 CLI 里读 DB / 加密 / 启业务流程：它只做参数解析 + preflight + spawn。所有共享解析逻辑住在 `lib/preflight.mjs`（plain JS，既能被 CLI 直接 import，又能被 server-side `config.ts` 复用）。

## 配置文件 + 模型发现 + Capabilities + Provider 类型

完整说明见 `README.md`。要点：

- 模型**不在配置文件里**——provider 的 `/models`（OpenAI）或 `/openai/deployments?…` 回落 `/openai/models?…`（Azure）端点动态发现，结果按 `AIUI_MODELS_CACHE_TTL` 缓存。Provider 增/改/删时自动 `clearDiscoveryCache()`（已埋在 `app/api/providers/**/route.ts`）；用户也可 `POST /api/providers/reload`。
- `gateway.ts:resolveModel(name)`（**async**）查找顺序：DB `models` 表（admin UI 加的 override）→ discovery 缓存 fuzzy hit（命中后用 `classifyModel(upstreamId)` 推断 capability）→ 404。
- `provider.type` 决定上游 URL 形态和鉴权头（`openai` Bearer / `azure` api-key + URL 包到 `/openai/deployments/{model.upstreamModelId}`），全部逻辑集中在 `lib/server/gateway/index.ts:upstreamUrl` / `buildUpstreamHeaders`。
- **Capabilities 是可扩展模态系统**：`lib/server/capabilities/<id>.ts` 调 `registerCapability({ id, endpoint, supportsStreaming, matches, summarizeInput, parseResponse, parseStreamChunk })`；side-effect imports **必须**集中在 `register.ts`，**不能**放回 `index.ts`（TDZ 循环依赖陷阱）。`gateway.ts` 和 `discovery.ts` 都 `import "./capabilities/register"` 确保注册先发生。

## 共享 Schemas（`lib/schemas/`）— 单一真相

每个 domain 一个文件：`common / user / provider / model / apikey / capability / log / conversation / playground / preferences`。每个文件 export：

- `<entity>DTOSchema` — wire 输出（zod object）
- `<entity>CreateSchema` / `<entity>UpdateSchema` — 输入（service + route handler 用 zod 校验）
- `<entity>ListQuerySchema` — URL query 参数
- 派生 TS 类型：`<Entity>DTO` / `<Entity>CreateInput` / `<Entity>UpdateInput` / `<Entity>ListQuery`（**全部** `z.infer` 派生，不要手写）
- 通用类型 `BaseResponse<T>`、`Paginated<T>` 在 `common.ts`

`lib/types/` 已删除——前端组件直接 `import type { ProviderDTO } from "@/lib/schemas/provider"`。没有兼容别名（`ProviderConfig` 等）。

## 路径别名

`@/*` → repo 根。`@/components`、`@/lib`、`@/lib/server` 等都用别名导入。

## 后端层（`lib/server/<domain>/`）

每个 domain 一个文件夹，目录结构都长这样：

```
lib/server/<domain>/
├── index.ts         一行 `export * from "./service"`（或显式列）
├── service.ts       业务逻辑；DTO 类型从 @/lib/schemas/<domain> import
└── serializer.ts    （仅 providers/models）DB row → DTO 映射
```

**不要**再起 `schemas.ts` thin re-export 文件；route handler 和 service 都直接从 `@/lib/schemas/<domain>` import zod schema 和输入类型。

每个 service 文件都以 `import "server-only"` 起头作为防呆。**不要把它们 import 到客户端组件**。关键模块：

| 文件 | 职责 |
|---|---|
| `db/schema.ts` | Drizzle schema（users / sessions / api_keys / providers / models / conversations / messages / generation_logs / user_preferences）。**改完必须 `bunx drizzle-kit generate`**；运行时 `db/index.ts` 自动跑 migration。`sqliteTable` extraConfig 用**数组形式** `(t) => [index(...).on(t.x), ...]`（旧的 object 形式已废弃）。 |
| `db/index.ts` | 单例 `db = drizzle(better-sqlite3)`，WAL + `foreign_keys=ON`；dev 下挂在 globalThis 防热重载重复连接。 |
| `auth.ts` | `createSession`/`getCurrentUser`/`requireUser`/`requireAdmin` + `authenticateGateway`（Bearer 优先、cookie 兜底）。Cookie 名 `aiui_session`，httpOnly + sameSite=lax。DB 里只存 SHA256 token。 |
| `crypto.ts` | AES-256-GCM `encryptSecret`/`decryptSecret` + `maskSecret` 用于上游 API key；`generateApiKey` 生成 `sk-aiui-…` 凭据并返回 hash。 |
| `response.ts` | `BaseResponse<T>` 信封 + `ok(data)`/`fail(msg)` + `HttpError` 体系（`badRequest` / `unauthorized` / `forbidden` / `notFound`）+ `handle(err)` 统一 catch。 |
| `route.ts` | **`defineRoute`** 工厂——见下。 |
| `gateway/index.ts` | **网关核心**：`resolveModel(name)`、`forwardGeneration(user, capabilityId, body, opts)` 通用转发。流式响应用 `TransformStream` tee：原样吐给客户端的同时累积 content/reasoning 用于日志。**自动写 `generation_logs`**，含 capability、input_summary、prompt/completion/total tokens、`first_token_latency_ms` (TTFT, 仅流式)、`total_latency_ms` (E2E, 总是)、status、reason。 |
| `capabilities/` | 见上节。 |
| `discovery.ts` | 模型动态发现 + 缓存。 |
| `config.ts` | 启动时调 `preflightFromConfig()` hoist infra env vars，再 upsert `providers[]`。由 `init.ts:ensureInit()` 调用。 |
| `init.ts` + `bootstrap.ts` | `ensureInit()` 先 `loadConfigFile()` 再 `bootstrapAdmin()`，懒加载且只跑一次。 |

### 写新 Route Handler 的样板（用 `defineRoute`）

```ts
import "server-only";
import { z } from "zod";
import { defineRoute } from "@/lib/server/route";
import { providerCreateSchema } from "@/lib/schemas/provider";
import { createProvider, listProviders } from "@/lib/server/providers";

export const GET = defineRoute({
    handler: () => listProviders(),
});

export const POST = defineRoute({
    auth: "admin",                     // "public" | "user" (默认) | "admin" | "gateway"
    body: providerCreateSchema,        // zod；request body 自动 parse + 校验
    handler: ({ user, body }) => createProvider(body),
});

// 带 params 的路由
export const PATCH = defineRoute({
    auth: "admin",
    params: z.object({ id: z.string().min(1) }),
    body: providerUpdateSchema,
    handler: ({ params, body }) => updateProvider(params.id, body),
});
```

`defineRoute` 自动包办：`await ensureInit()` → 鉴权（按 `auth` 字段）→ parse + 校验 `params` / `query` / `body` → 调 `handler` → 包 `ok(data)` 或 `handle(err)`。`runtime = "nodejs"` 和 `dynamic = "force-dynamic"` 由它在内部强制。

handler 返回原生 `Response` 会原样直通（用于 SSE / 二进制）。返回值是 `undefined` / `null` 时包成 `ok(null)`。

REST 动词约定：列表/创建用 `GET` / `POST` 在 `/<resource>/route.ts`；单实例 read/update/delete 用 `GET` / `PATCH` / `DELETE` 在 `/<resource>/[id]/route.ts`。**不要**用 `/users/create`、`/users/update/:name` 这类动词路径。

## 前端层

### HTTP（`lib/api/`）

每个 domain 一个 `lib/api/<domain>.ts`，**全部走 `defineResource` 工厂**（`lib/api/resource.ts`）：

```ts
// lib/api/users.ts — 整个文件
import { defineResource } from "./resource";
import type { Paginated } from "@/lib/schemas/common";
import type { UserCreateInput, UserDTO, UserFilterParams, UserUpdateInput } from "@/lib/schemas/user";

export const users = defineResource<
    UserDTO, UserCreateInput, UserUpdateInput, UserFilterParams, Paginated<UserDTO>
>({
    path: "/users",
    key: "users",
});
```

`defineResource` 返回一个 flat 对象，同时含：
- 裸 fetch：`list / get / create / update / remove`
- 自动 invalidation 的 hooks：`useList / useGet / useCreate / useUpdate / useDelete / useInvalidate`
- 查询键：`keys.all() / keys.list(q) / keys.one(id)`

配置项：`listShape: "paginated" | "array"`、`invalidates: ["other-key"]`（mutation 成功时连带 invalidate）、`staleTime`、`paramsOf` 投影 query。

**非 CRUD 端点用对象 spread 扩展同一对象**，不要起新模块：

```ts
export const providers = {
    ...defineResource<...>({ path: "/providers", key: "providers", listShape: "array", invalidates: ["models"] }),
    listModels: (id: string) => fetcher<ModelDTO[]>(`/providers/${encodeURIComponent(id)}/models`),
    reload: () => fetcher<null>("/providers/reload", { method: "POST" }),
    useModels: (id) => useQuery({ ... }),
};
```

特殊形态保持手写（不要硬塞工厂）：`auth.ts`（3 个端点）、`gateway.ts`（SSE 流式 + 标题生成）、`preferences.ts`（per-user singleton，不是 CRUD）。

`lib/hooks/` 已删除——hooks 跟 resource 同源。**不要**新建 `lib/hooks/use-*.ts`。

### `client.ts` 约定
- `BaseResponse<T> = { code, msg, data }`；`fetcher<T>` 拆 `data`，`code !== 0` 或 HTTP 非 2xx 抛 `ApiError`
- **认证靠 httpOnly cookie**（每个请求带 `credentials: "include"`）；**别再用** localStorage 或 `Authorization` 头
- 401 自动跳 `/login?from=<current>`；登录端点传 `skipAuthRedirect: true` 防循环
- `rawFetch` 留给 SSE / 二进制（不拆 envelope）

### 状态分层

- **服务端态** → TanStack Query；查询键统一通过 `<resource>.keys.*()` 或 `defineResource` 自动派生（不要手写 magic string array）
- **跨设备用户偏好** → DB（`user_preferences` 表 + `lib/schemas/preferences.ts` + `lib/api/preferences.ts`）。`preferences.useGet()` 拿到 DTO；`preferences.useUpdate()` PATCH 完直接 `setQueryData` 回写缓存，不重新拉
- **设备本地 UI 偏好** → `lib/stores/device-settings-store.ts`（localStorage key `aiui-device-settings`，只放 `sendOnEnter / showTimestamps / compactMode`）
- **设备本地 UI 状态** → `lib/stores/playground-store.ts`（localStorage key `playground-storage`）；`partialize` 故意把每个 tab 的 `messages` 清空再持久化，重开时从后端拉
- `context/auth-context.tsx` 的 `login`/`logout` 都 `removeQueries({ queryKey: ["preferences"] })`（和其他 per-user 缓存），防止共享浏览器账号间数据串掉。新加 per-user 缓存域时也要在这两个钩子里清

### Playground 流水线（保持模块边界）

- `components/playground/chat/stream-parser.ts` — 纯 SSE 解析器（`event:` + `data:`、`[DONE]`、OpenAI `choices[0].delta.{content,reasoning_content}`）
- `components/playground/chat/stream-client.ts` — 一个 `StreamClient` 一次请求，自带 `AbortController`，POST `${API_BASE}/playground/chat`，读响应头 `X-Message-ID` / `X-Generation-ID` / `X-Conversation-ID`
- `components/playground/chat/throttled-updater.ts` — 节流 `setMessages`（默认 100ms）
- `components/playground/chat/use-chat-stream.ts` — `streamMultiple` 给多模型对比开多个 client；`stopAll` 全部 abort
- `components/playground/use-playground-chat.ts` — UI 用的编排 hook

扩展流式协议时在 `stream-parser.ts` 的 `ParsedEvent` 里加新类型，在 `StreamClient.stream` 处理——**别在别处 parse SSE**。

服务端的 `/api/playground/chat` 路由把请求转给 `lib/server/gateway/index.ts:forwardGeneration` (capabilityId `"chat"`)，并在 `onComplete` 里把 assistant 消息写入 `messages` 表。Conversation 不存在则自动创建。

## OpenAI 兼容网关

- `POST /api/v1/chat/completions` / `POST /api/v1/embeddings` / `POST /api/v1/images/generations` / `POST /api/v1/audio/{speech,transcriptions}` / `POST /api/v1/rerank` / `GET /api/v1/models`
- 鉴权：**Bearer `sk-aiui-…`**（外部应用，DB 存 SHA256）或 **session cookie**（同源浏览器场景，比如 `generateTitle`）
- 每次调用都写 `generation_logs`（含上游耗时、tokens、`first_token_latency_ms` / `total_latency_ms`、status、reason）

## 路由组

- `app/(auth)/login/` — 公开
- `app/(dashboard)/` — `AuthProvider`（`context/auth-context.tsx`）+ `Sidebar` 兜底；未登录跳 `/login?from=…`
- `app/api/**` — Route Handlers（用 `defineRoute` 时无需手写 `runtime`/`dynamic`）

### 全局 providers
`components/AppProviders.tsx`（挂在 `app/layout.tsx`）：next-themes → QueryClientProvider（`retry: 1`, `refetchOnWindowFocus: false`）→ `AuthProvider` → `Toaster`。

## UI 约定

- Tailwind 类合并必走 `cn(...)`（`@/lib/utils`，clsx + tailwind-merge）
- Icons `lucide-react`、Toast `import { toast } from "sonner"`、主题 `next-themes`
- Tailwind v4 + CSS variables（设计 token 在 `app/globals.css`）；用语义类 `bg-background` / `text-muted-foreground` / `border-border`，别用裸色
- 用 hooks/浏览器 API/Zustand/TanStack Query 的文件 **必须** `"use client"` 头
- shadcn 基础组件（`components/ui/`）是 CLI 生成的——升级时优先 `bunx shadcn@latest add` 重生而不是手改
- Admin-only UI 通过 `useAuth()` 拿 `user?.role === "admin"` 判断
- 日期字段都是 ISO 字符串；前端用 `lib/utils.ts` 的 `normalizeDate` / `formatToLocal`（假设 UTC，没时区会补 `Z`）

## 常见陷阱

- **避免 shadowing namespace imports**：`import { providers } from "@/lib/api"` 后不要再 `const providers = ...`，否则 TS 推断会回退到 `any`。常用别名：`providerList`、`modelOptions`、`convList`
- **`lib/api/conversations.ts:conversations` 内部用了 base.update 包装 `updateTitle(id, title)`**——之后 `conversations.update()` 已是 PATCH 整对象语义，标题级更新走 `updateTitle`
- **Drizzle 字段重命名 / 增列**：跑 `bunx drizzle-kit generate` 时是交互式 prompt——必要时通过 `script -qc 'bunx drizzle-kit generate --name <slug>' /dev/null` 包一层 TTY，按方向键选 rename vs create
- **新建 `user_preferences` 字段**：加 zod field → 加默认值 → 服务端 `getPreferences` 自动 merge（前向兼容旧行）。**不需要**任何 migration，因为整列是 JSON
- **写 e2e**：仿 `scripts/e2e-preferences.mjs`——`mkdtempSync` 临时目录、写 `.config/aiui.yaml`、`spawn("bun", ["run", "next", "start", ...])`、`AIUI_USER_CWD=tmp`、跑断言、`server.kill()`
