# AIUI – Copilot Instructions

工业级 AI Gateway，单仓全栈：**Next.js 16 App Router + React 19 + TypeScript strict + SQLite (Drizzle + better-sqlite3)**。Route Handlers 同时承担 OpenAI 兼容网关、Playground 后端、CRUD API。**没有独立后端**。详细背景见 `README.md`。

## 设计准则（修改前必读）

1. **新增功能必须最小改动**：
   - wire 字段 = 3 处（zod schema + Drizzle column + 1 行 serializer）
   - CRUD 端点 = 3 处（zod + `defineRoute` + service）
   - 新模态 = 2 文件（`capabilities/<id>.ts` + 1 行 `register.ts` import + 6 行 Route Handler 调 `forwardGeneration`）
   - 新 FE domain = 1 个 `defineResource(...)` 调用（5 行；api + hooks + keys 自动派生）
2. **功能原子性**：一个 domain 一个文件夹/文件，不起 thin re-export 中间层
3. **单一真相**：`lib/schemas/<domain>.ts`（zod）是 wire 类型唯一来源，`lib/server/db/schema.ts`（Drizzle）是 DB 唯一来源。**所有** TS 类型通过 `z.infer` 派生，绝不手写并行 interface
4. **开发期不保后向兼容**：thin wrapper / 过渡 alias / dead code 发现就删
5. 优先用工厂（`defineRoute` / `defineResource` / `registerCapability`）；只有形态特殊（auth、SSE gateway、singleton prefs）才手写

## Commands

`bun install` / `bun run dev|build|start|lint`。Drizzle：`bunx drizzle-kit generate`（会问 rename vs create——交互式 prompt，用 `script -qc '...' /dev/null` 包一层 TTY）。**别用 npm/yarn/pnpm**（`bun.lock` 是事实源）。

**没有单元测试**。验证：`bun run build`（含 TS 严格检查）+ `bun run lint`（baseline 129 problems，只看新引入的）+ 跑相关 `scripts/e2e-*.mjs`（独立 spawn server + 断言，仿 `e2e-preferences.mjs` 风格写新的）。

## 关键工厂

### `defineRoute`（`lib/server/route.ts`）

每个 Route Handler 都长这样——`runtime/dynamic`、`ensureInit`、auth、zod 校验、`ok/handle` 全自动：

```ts
import { defineRoute } from "@/lib/server/route";
import { providerCreateSchema } from "@/lib/schemas/provider";
import { createProvider } from "@/lib/server/providers";

export const POST = defineRoute({
    auth: "admin",              // "public" | "user" (默认) | "admin" | "gateway"
    body: providerCreateSchema,
    handler: ({ user, body }) => createProvider(body),
});
```

handler 返回原生 `Response` 直通（SSE/二进制）；其他值包成 `ok(data)`。

REST 约定：列表/创建在 `/<resource>/route.ts` (GET/POST)；实例在 `/<resource>/[id]/route.ts` (GET/PATCH/DELETE)。不要用 `/users/create`、`/users/update/:name` 这种动词路径。

### `defineResource`（`lib/api/resource.ts`）

FE 一个 domain = 一个文件：

```ts
export const users = defineResource<UserDTO, UserCreateInput, UserUpdateInput, UserFilterParams, Paginated<UserDTO>>({
    path: "/users",
    key: "users",
});
```

返回 flat 对象同时含：裸 fetch（`list/get/create/update/remove`）+ hooks（`useList/useGet/useCreate/useUpdate/useDelete/useInvalidate`，自动 cache invalidation）+ `keys.{all,list,one}`。配置：`listShape: "array"|"paginated"`、`invalidates: ["other-key"]`（mutation 连带 invalidate）、`staleTime`、`paramsOf`。

非 CRUD 端点用对象 spread 扩展同一对象，**不要起新模块**：

```ts
export const providers = {
    ...defineResource<...>({ path: "/providers", key: "providers", listShape: "array", invalidates: ["models"] }),
    reload: () => fetcher<null>("/providers/reload", { method: "POST" }),
    useModels: (id) => useQuery({ ... }),
};
```

特殊形态手写：`auth`（3 个端点）、`gateway`（SSE）、`preferences`（per-user singleton）。`lib/hooks/` 不存在——hooks 跟 resource 同源，**不要**新建 `lib/hooks/use-*.ts`。

### `registerCapability`（`lib/server/capabilities/`）

新模态：放 `lib/server/capabilities/<id>.ts` 调 `registerCapability(...)`，在 `register.ts` 加一行 `import "./<id>"`，写 6 行 Route Handler 调 `forwardGeneration(user, "<id>", body)`。`gateway/index.ts` 永远不动。

**TDZ 陷阱**：side-effect import 必须放 `register.ts`，**不能**回 `index.ts`，否则 `registry.set` 在 const 初始化前执行。`gateway.ts` 和 `discovery.ts` 都 `import "./capabilities/register"` 确保注册先发生。

## 架构要点

- **路径别名** `@/*` → repo 根
- **路由组**：`app/(auth)/login/` 公开；`app/(dashboard)/` 由 `context/auth-context.tsx` 兜底；`app/api/**` 全部 Route Handlers
- **后端 `lib/server/<domain>/`** 每个文件夹 = `index.ts`（一行 `export * from "./service"`） + `service.ts` + 可选 `serializer.ts`。**不要**起 `schemas.ts` thin re-export——route 和 service 都直接 `import from "@/lib/schemas/<domain>"`。所有 server 文件首行 `import "server-only"`
- **gateway**：`lib/server/gateway/index.ts` `resolveModel(name)` (async) 顺序 = DB `models` 表 → discovery cache → 404。`forwardGeneration(user, capabilityId, body, opts)` 统一转发。**流式用 TransformStream tee**：原样吐给客户端的同时累积日志。每次调用都写 `generation_logs`，含 capability、input_summary、tokens、`first_token_latency_ms` (TTFT, 仅流式)、`total_latency_ms` (E2E, 总是)
- **Provider 类型** `openai`（默认）vs `azure`：URL 与 auth header 形态分支集中在 `gateway/index.ts:upstreamUrl/buildUpstreamHeaders`。Azure 时 `models.upstreamModelId` 是 **deployment 名**
- **模型不进配置文件**——provider 的 `/models` 动态发现，按 `AIUI_MODELS_CACHE_TTL` 缓存；provider 增改删时自动 `clearDiscoveryCache()`
- **HTTP** `lib/api/client.ts:fetcher<T>` 拆 `{code,msg,data}` envelope；**认证靠 httpOnly cookie**，全部请求 `credentials: "include"`；401 自动跳 `/login?from=…`；登录端点传 `skipAuthRedirect: true`
- **Drizzle** schema 改完必须 `bunx drizzle-kit generate`，重启时 `db/index.ts` 自动跑 migration。`sqliteTable` extraConfig 用**数组**形式 `(t) => [index(...).on(t.x)]`（object 形式已废弃）

## 状态分层

| 类型 | 存哪 |
|---|---|
| 服务端态 | TanStack Query，键走 `<resource>.keys.*` 自动派生 |
| 跨设备用户偏好 | DB `user_preferences` 表，`lib/api/preferences.ts` singleton 形态 |
| 设备本地 UI 偏好 | `lib/stores/device-settings-store.ts`（localStorage `aiui-device-settings`，只放 `sendOnEnter/showTimestamps/compactMode`） |
| 设备本地 UI 状态 | `lib/stores/playground-store.ts`（`partialize` 故意清空 `messages[]`，重开从后端拉） |

新增 per-user 缓存域时，`context/auth-context.tsx` 的 `login`/`logout` 里都要 `removeQueries({ queryKey: [...] })`，防止共享浏览器账号串数据。

## Playground 流水线

`components/playground/chat/`：`stream-parser`（纯 SSE 解析）→ `stream-client`（一次请求一个 `StreamClient`+`AbortController`，读 `X-{Conversation,Message,Generation}-ID` 头）→ `throttled-updater`（节流 setMessages）→ `use-chat-stream.ts`（`streamMultiple`/`stopAll`）。扩协议只改 `stream-parser.ts` 的 `ParsedEvent`，**别在别处 parse SSE**。

## UI 约定

- 用 hooks/Zustand/TanStack Query 的文件首行必须 `"use client"`
- Tailwind 合并走 `cn(...)`（`@/lib/utils`）；用语义类 `bg-background/text-muted-foreground/border-border`，别裸色
- shadcn 基础组件（`components/ui/`）是 CLI 生成的——升级优先 `bunx shadcn@latest add` 重生
- Icons `lucide-react`、Toast `import { toast } from "sonner"`、Admin gate `useAuth().user?.role === "admin"`
- 日期都是 ISO 字符串；前端 `lib/utils.ts:normalizeDate / formatToLocal`（无时区补 `Z`）

## 常见陷阱

- **Namespace shadowing**：`import { providers } from "@/lib/api"` 后不要 `const providers = ...`——TS 推断会回退 `any`。命名 `providerList / modelOptions / convList`
- **新 `user_preferences` 字段**：加 zod field + 加默认值即可，`getPreferences` 自动 merge 旧行；JSON 列**不需要** migration
- **CLI**：`bin/aiui.ts` 用 [citty](https://github.com/unjs/citty) 的 `defineCommand` 描述符（Click 风格，与 `defineRoute`/`defineResource` 同构）；`scripts/build-cli.mjs` 用 esbuild 打包成 `bin/aiui.mjs`（compiled artifact 已 gitignore；`prepare` 钩子在 `bun install` 时自动重建，`bun run build` 也会先跑 `build:cli`）。源里只做参数解析 + `preflight` + spawn next；共享解析逻辑住 `lib/preflight.ts`（CLI 与服务端 `config.ts` 都用，类型来自 `lib/schemas/config.ts`）。CLI 自动注入 `AIUI_USER_CWD=process.cwd()`，服务端始终 `process.env.AIUI_USER_CWD || process.cwd()` 解析路径。新增子命令：再写一个 `defineCommand({ meta, args, run })` 挂到 `main` 的 `subCommands` 即可，`--help` 自动派生
