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

```bash
# 1. 安装依赖
bun install

# 2. 准备环境变量
cat > .env.local <<'EOF'
AIUI_DB_PATH=./data/aiui.db
AIUI_MASTER_KEY=<32 字节随机串，用于加密上游 Provider 的 API key>
AIUI_ADMIN_USERNAME=admin
AIUI_ADMIN_PASSWORD=<引导首位 admin 用户的初始密码>
EOF

# 3. 启动开发
bun run dev          # next dev
# 或生产构建+启动
bun run build && bun run start
```

首次启动会自动：
1. 在 `./data/` 下创建 SQLite 文件并跑 `drizzle/` 里的 migrations
2. 根据 `AIUI_ADMIN_USERNAME`/`AIUI_ADMIN_PASSWORD` 引导首位 admin 账号（仅在 users 表为空时执行）
3. 如果项目根存在 `aiui.config.yaml` / `.yml` / `.json`（或 `AIUI_CONFIG_PATH` 指向的文件），upsert 其中的 providers/models 到 DB（详见下文）

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AIUI_MASTER_KEY` | ✅ | AES-256-GCM 主密钥，加密 Provider 的 `api_key`。**轮换会导致已存储 key 无法解密**。 |
| `AIUI_DB_PATH` | | SQLite 路径，默认 `./data/aiui.db` |
| `AIUI_CONFIG_PATH` | | 启动时加载的配置文件路径；默认查找根目录的 `aiui.config.yaml/.yml/.json` |
| `AIUI_ADMIN_USERNAME` | | 首位 admin 用户名（默认 `admin`） |
| `AIUI_ADMIN_PASSWORD` | | 首位 admin 密码；不设置则不会自动引导 |
| `NEXT_PUBLIC_API_URL` | | 前端 API 基址，默认 `/api`（同源） |

## Provider 类型

| `type` | URL 形态 | 鉴权 | 备注 |
|---|---|---|---|
| `openai`（默认） | `POST {base_url}/chat/completions` / `/embeddings` | `Authorization: Bearer {api_key}` | 适用 OpenAI 官方、DeepSeek、Together、Groq、本地 vLLM 等任何 OpenAI 兼容上游 |
| `azure` | `POST {base_url}/openai/deployments/{deployment}/chat/completions?api-version=…` | `api-key: {api_key}` 头 | `Model` 表里的 **Upstream Model ID** 填 Azure **部署名**；`api_version` 留空时默认 `2024-10-21` |

通过 admin UI 在 `/providers` 创建 provider 时可选择类型；或在配置文件中声明（见下）。

## 本地配置文件

通过文件声明 providers/models，启动时按 `name` 做 **upsert**（不删 DB 里多余的条目，UI 与文件可共存）。

**路径**：默认查找项目根的 `aiui.config.yaml` / `aiui.config.yml` / `aiui.config.json`；或用 `AIUI_CONFIG_PATH=/path/to/config.yaml` 指定。

**字段**：见仓库根的 `aiui.config.example.yaml`。要点：
- 字符串支持 `${ENV_VAR}` 插值，方便把 secrets 留在环境里
- `api_key` 字段省略时**不会**清空 DB 中已存的密钥（保护 UI 改过的值）
- 文件里没有的 DB 条目**不会**被删除
- 解析/写入失败仅 warning，不阻断启动

最小示例：

```yaml
providers:
  - name: openai
    type: openai
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
  - name: azure-eastus
    type: azure
    base_url: https://my-resource.openai.azure.com
    api_version: "2024-10-21"
    api_key: ${AZURE_OPENAI_API_KEY}

models:
  - name: gpt-4o-mini
    provider: openai
    upstream_model_id: gpt-4o-mini
    type: chat
  - name: azure-gpt-4o          # 调用网关时用这个 name
    provider: azure-eastus
    upstream_model_id: gpt-4o-prod-deployment  # Azure 部署名
    type: chat
```

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
