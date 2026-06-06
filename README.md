# AIUI

工业级 AI Gateway，前后端一体化：**Next.js 16 App Router + React 19 + TypeScript + SQLite (Drizzle ORM)**，提供标准 **OpenAI 兼容** 协议的网关、Playground、日志审计、Provider/Model 管理、用户与 API Key 管理。

## 技术栈

- **框架**：[Next.js 16 (App Router)](https://nextjs.org/) — Route Handlers 同时承载前端与后端
- **UI**：[Shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS v4](https://tailwindcss.com/)
- **服务端状态**：[TanStack Query](https://tanstack.com/query/latest) + [TanStack Table](https://tanstack.com/table/latest)
- **客户端状态**：Zustand（带 `persist`）
- **数据库**：SQLite + [Drizzle ORM](https://orm.drizzle.team/)（`better-sqlite3` 驱动）
- **认证**：bcrypt + httpOnly session cookie；外部网关支持 `sk-aiui-…` Bearer API Key
- **流式**：原生 `fetch`/SSE，自实现 stream-parser + throttled-updater（支持多模型并发对比）
- **包管理**：[Bun](https://bun.sh/)

## 快速开始

### 作为 CLI 工具使用（推荐）

```bash
bun install
bun run build

# 一键生成带随机 master_key 的配置文件
./bin/aiui.mjs init-config        # 写到 ./aiui.config.yaml
# 或：./bin/aiui.mjs init-config --user  # 写到 ~/.config/aiui.yaml

# 编辑配置：填 API key / 加 provider / 加 model
$EDITOR aiui.config.yaml

# 启动
./bin/aiui.mjs                    # 默认 == start
./bin/aiui.mjs start -p 3000
./bin/aiui.mjs dev                # next dev
./bin/aiui.mjs help
```

如果通过 `npm i -g .` 安装则可直接 `aiui` 调用，从任意目录启动；CLI 会把当前目录通过 `AIUI_USER_CWD` 透传给 Next，配置文件 / SQLite 文件都相对你的工作目录解析。

### 作为开发仓库使用

```bash
bun install
cat > .env.local <<'EOF'
AIUI_MASTER_KEY=<32 字节随机串，加密上游 Provider 的 api_key>
AIUI_ADMIN_USERNAME=admin
AIUI_ADMIN_PASSWORD=<引导首位 admin 用户的初始密码>
EOF
bun run dev
```

首次启动会自动：
1. 在 `./data/` 下创建 SQLite 文件并跑 `drizzle/` 里的 migrations
2. 根据 `AIUI_ADMIN_USERNAME`/`AIUI_ADMIN_PASSWORD` 引导首位 admin（仅在 `users` 表为空时）
3. 查找配置文件（见下文搜索顺序）；如果有 `master_key` 且未设置环境变量，会自动应用；providers/models 按 `name` upsert 到 DB

## 配置文件

**配置文件是网关所有可配置项的单一真相**。每个顶层字段对应一个环境变量；启动时由 CLI 一次性 hoist 到 `process.env`（**env 已有则不覆盖**），后续代码统一从 env 读取。

按以下顺序查找（首个命中即用）：

1. `$AIUI_CONFIG_PATH`（显式覆盖）
2. `./aiui.config.{yaml,yml,json}`（项目根，向后兼容）
3. `./.config/aiui.{yaml,yml,json}`（项目本地 XDG 风格）
4. `$XDG_CONFIG_HOME/aiui.{yaml,yml,json}`（用户级，默认 `~/.config/`）

`./` 指 CLI 调用时的工作目录（通过 `AIUI_USER_CWD` 传给 Next），不是 Next 进程的 cwd。

**完整字段**（`aiui init-config` 生成的模板含全部带注释示例）：

```yaml
master_key: <32 字节 hex>          # → AIUI_MASTER_KEY；env 优先

database:
  path: ./data/aiui.db             # → AIUI_DB_PATH（只能通过 CLI 生效）

server:
  port: 3000                       # → AIUI_SERVER_PORT；CLI -p 优先
  hostname: 0.0.0.0                # → AIUI_SERVER_HOSTNAME；CLI -H 优先

admin:
  username: admin                  # → AIUI_ADMIN_USERNAME
  password: ${AIUI_ADMIN_PASSWORD} # → AIUI_ADMIN_PASSWORD

session:
  ttl_days: 30                     # → AIUI_SESSION_TTL_DAYS

cache:
  models_ttl_seconds: 300          # → AIUI_MODELS_CACHE_TTL；/models 发现缓存 TTL

providers:                         # 文件 + admin UI 可共存；按 name upsert
  - name: openai
    type: openai                   # openai | azure
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}     # 任意字符串字段都支持 ${ENV_VAR}
```

**模型不在配置文件里**。每个 provider 的模型列表通过它自己的 `/models`（Azure 则是 `/openai/deployments?api-version=…`，回落 `/openai/models?...`）端点动态发现，结果按 `cache.models_ttl_seconds` 缓存。需要自定义 `context_window` / 设别名 / 注册 Azure 部署时，通过 admin UI 的 Models 页加一条"override 行"，它会 shadow 同名的发现项。

**约定**：
- env vars 始终优先于配置文件
- 字符串字段支持 `${ENV_VAR}` 插值
- providers 按 `name` upsert；DB 里多出的条目不动
- 省略 `api_key` 字段**不会**覆盖 DB 里已有的密钥；显式写 `null` 才会清空
- 旧的 `models:` 区段被忽略（带 warning），存在仅为提示用户迁移
- 解析错误只 warn，不阻塞启动
- 真实文件名（`aiui.config.yaml` / `.config/aiui.yaml`）已在 `.gitignore`

⚠️ 配置里如果带了 `master_key` 或明文 API key，**不要提交到版本控制**。

## 模型解析

| 顺序 | 来源 | 用途 |
|---|---|---|
| 1 | DB `models` 表 | 显式 override：Azure 部署、改 context window、设别名 |
| 2 | Provider `/models` 动态发现（缓存） | 大多数 OpenAI 兼容 provider 全自动；无需任何配置 |

`POST /v1/chat/completions { "model": "..." }` 走相同的解析链：先查 DB，再扫所有 enabled provider 的发现缓存。`POST /api/providers/reload` 会 flush 缓存，admin 改了 provider 之后系统也会自动 flush。

**Azure 例外**：Azure 的 `/openai/deployments?...` 端点通常需要 management-plane 权限，data-plane api-key 一般够不到；回落到 `/openai/models?...` 只能拿到 base model 名（不是 deployment）。所以 Azure 用户通常要在 admin UI 的 Models 页**手动**注册一个 override 行：display name → deployment id。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AIUI_MASTER_KEY` | （二选一） | AES-256-GCM 主密钥；或写在配置文件 `master_key:`。**轮换会让已存的 Provider key 解不开**。 |
| `AIUI_DB_PATH` | | SQLite 路径，默认 `<userCwd>/data/aiui.db` |
| `AIUI_CONFIG_PATH` | | 配置文件路径覆盖；不设则按上文顺序搜索 |
| `AIUI_USER_CWD` | | CLI 自动设置；服务端把它当工作目录解析配置/DB |
| `AIUI_ADMIN_USERNAME` | | 首位 admin 用户名（默认 `admin`） |
| `AIUI_ADMIN_PASSWORD` | | 首位 admin 密码；不设则不引导 |
| `AIUI_SESSION_TTL_DAYS` | | 浏览器会话 TTL，默认 30 |
| `AIUI_MODELS_CACHE_TTL` | | `/models` 发现缓存秒数，默认 300 |
| `AIUI_SERVER_PORT` / `AIUI_SERVER_HOSTNAME` | | CLI 启动端口/绑定；`-p`/`-H` 优先 |
| `NEXT_PUBLIC_API_URL` | | 前端 API 基址，默认 `/api`（同源） |

## Provider 类型

| `type` | URL 形态 | 鉴权 | 备注 |
|---|---|---|---|
| `openai`（默认） | `POST {base_url}/chat/completions` / `/embeddings` | `Authorization: Bearer {api_key}` | 适用 OpenAI 官方、DeepSeek、Together、Groq、本地 vLLM 等任何 OpenAI 兼容上游 |
| `azure` | `POST {base_url}/openai/deployments/{deployment}/chat/completions?api-version=…` | `api-key: {api_key}` 头 | `Model` 表里的 **Upstream Model ID** 填 Azure **部署名**；`api_version` 留空时默认 `2024-10-21` |

通过 admin UI 在 `/providers` 创建 provider 时可选择类型；或在配置文件中声明（见下）。

## 数据模型

| 表 | 用途 |
|---|---|
| `users` | 系统用户（admin/user） |
| `sessions` | 会话（cookie 值为 token，DB 存 SHA256） |
| `api_keys` | 用户为 OpenAI 兼容网关签发的 `sk-aiui-…` 凭据（DB 存 SHA256） |
| `providers` | OpenAI 兼容上游（name + base_url + 加密 api_key + default_params） |
| `models` | name → (provider, upstream_model_id) 映射，含 type / context_window / pricing |
| `conversations` / `messages` | Playground 对话 + 消息历史 |
| `generation_logs` | 网关每次调用的审计记录（请求/响应/耗时/tokens/状态） |

## API 一览

> 全部返回统一信封 `{ code, msg, data }`，`code !== 0` 视为业务错误。

### 认证
- `POST /api/login` — 设置 session cookie
- `POST /api/logout` — 清除 cookie
- `GET /api/users/me`

### 资源（cookie 鉴权；写操作需 admin）
- `GET/POST /api/users`、`POST /api/users/create`、`POST /api/users/update/:username`、`DELETE /api/users/delete/:username`
- `GET/POST /api/providers`、`GET/PUT/DELETE /api/providers/:id`、`POST /api/providers/:id/check`、`GET /api/providers/:id/models`
- `GET/POST /api/models`、`GET/PUT/DELETE /api/models/:id`
- `GET /api/conversations`、`DELETE /api/conversations/:id`、`PUT /api/conversations/:id/title`、`GET /api/conversations/:id/messages`
- `POST /api/messages/:id/rate`
- `GET /api/logs/generations`、`GET /api/logs/generations/:id`
- `GET/POST /api/apikeys`、`DELETE /api/apikeys/:id`

### Playground（cookie 鉴权）
- `POST /api/playground/chat` — SSE 流；自动持久化对话/消息，响应头带 `X-Conversation-ID`/`X-Message-ID`/`X-Generation-ID`

### OpenAI 兼容网关（Bearer API Key 或 cookie 鉴权）
- `POST /api/v1/chat/completions` — 标准 OpenAI 协议，支持 `stream`
- `POST /api/v1/embeddings`
- `GET /api/v1/models`

#### 外部调用示例

```bash
curl https://your-aiui.example.com/api/v1/chat/completions \
  -H "Authorization: Bearer sk-aiui-…" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role":"user","content":"hello"}],
    "stream": true
  }'
```

## 目录结构

```
app/
├── (auth)/login/             # 公开页
├── (dashboard)/              # 鉴权页（Sidebar + AuthProvider）
│   ├── page.tsx              # Dashboard
│   ├── chat/                 # Playground
│   ├── logs/                 # 日志审计
│   ├── providers/            # Provider / Model 管理
│   └── settings/
│       ├── page.tsx
│       ├── api-keys/         # 用户级 API Key 管理
│       └── users/            # 用户管理（admin only）
└── api/                      # Route Handlers (Node runtime)
    ├── login, logout, users/me
    ├── users, providers, models, ...
    ├── playground/chat       # SSE 流式（持久化对话）
    └── v1/chat/completions   # 公共 OpenAI 兼容入口
components/                   # UI + 业务组件（shadcn 基础组件在 ui/）
context/auth-context.tsx      # AuthProvider（cookie + /users/me 驱动）
lib/
├── api.ts                    # 浏览器侧 fetch 封装
├── server/                   # 服务端代码
│   ├── db/                   # Drizzle schema + 初始化
│   ├── auth.ts               # session + bearer 鉴权
│   ├── crypto.ts             # AES-GCM、SHA256、API key 生成
│   ├── gateway.ts            # OpenAI 兼容转发 + 日志
│   ├── password.ts           # bcrypt
│   ├── response.ts           # BaseResponse 信封 + HttpError
│   ├── serializers.ts        # DB → API DTO
│   └── bootstrap.ts          # 首位 admin 引导
├── stores/                   # Zustand
├── types/                    # 与后端共享的 DTO
└── utils.ts
drizzle/                      # 生成的 migration SQL（drizzle-kit）
data/                         # 运行时 SQLite（已 .gitignore）
```

## 开发要点

- 任何后端路由开头必须 `await ensureInit()` 以保证首次启动跑过 migration 与 admin 引导。
- 写操作走 `requireAdmin()`，读操作走 `requireUser()`；网关入口走 `authenticateGateway(req)`（Bearer 优先，cookie 兜底）。
- 上游 Provider 的 `api_key` 一律走 `encryptSecret`/`decryptSecret`；列表接口仅返回 `api_key_mask`（`sk-…BEEF` 格式）。
- 新增表：改 `lib/server/db/schema.ts` → `bunx drizzle-kit generate` → 重启服务自动跑 migration。
- 不要在客户端直接 `fetch`；统一走 `lib/api.ts` 的 `api` 对象（自动带 cookie、统一错误处理、401 自动跳 `/login`）。
- 流式：服务端用 `forwardChatCompletions` 的 tee（TransformStream）同时转发字节给客户端 + 累积 content 用于落日志。

## 脚本

```bash
bun install                       # 装依赖
bun run dev                       # next dev
bun run build                     # 生产构建（包含 TS 类型检查）
bun run start                     # 生产启动
bun run lint                      # ESLint

# Drizzle
bunx drizzle-kit generate         # 根据 schema 生成 SQL migration
bunx drizzle-kit studio           # 可视化 DB 浏览器
```

无测试套件；通过 `bun run build` + 手工 e2e 验证。
