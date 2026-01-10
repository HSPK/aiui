## AIUI - 工业级 AI Gateway 前端设计方案

工业级（Industrial-Grade）的 AI Gateway 前端
**稳定性、交互流畅度、数据可视化的性能以及类型安全**。

后端已经用了 Python (FastAPI + Pydantic)
前端技术栈: **Next.js (React) + TypeScript**。

### 1. 技术栈选型 (Tech Stack)

- **框架**: [Next.js 14/15 (App Router)](https://nextjs.org/) - 工业级标准，SSR/CSR 混合，路由管理强大。
    
- **UI 组件库**: [Shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS](https://tailwindcss.com/) - 现在的 AI 产品（OpenAI, Vercel）都在用这种风格，高度可定制，支持深色模式。使用 shadcn cli来新建项目。
    
- **状态管理/数据请求**: [TanStack Query (React Query)](https://tanstack.com/query/latest) - 极其适合管理 Dashboard 数据、缓存、轮询和服务端状态。
    
- **表格/数据展示**: [TanStack Table](https://tanstack.com/table/latest) - 处理成千上万条日志记录不卡顿（Headless UI）。
    
- **图表**: [Recharts](https://recharts.org/) 或 [ECharts](https://echarts.apache.org/) - 绘制用量趋势图。
    
- **AI 流式交互**: [Vercel AI SDK](https://sdk.vercel.ai/docs) - 专门解决流式输出（Streaming）、多轮对话状态管理的库，省去手写 `fetch`流处理的麻烦。

---

### 2. 核心功能模块设计

#### 模块一：仪表盘 (Dashboard) - 用量看板

**目标**：一目了然地看到 Token 消耗、成本和系统健康度。

- **布局**：
    
    - **顶部 KPI 卡片**：今日总请求数、今日消耗 Token、预估成本、平均延迟 (P99)。
        
    - **主图表 (Line Chart)**：过去 24 小时/7 天的 Token 消耗趋势，按 Model 分组（多条线）。
        
    - **饼图 (Pie Chart)**：各模型调用比例。
        
    - **错误率监控**：4xx/5xx 状态码的时间分布。
        
- **技术点**：
    
    - 使用 `Recharts` 绘制。
        
    - 后端提供 `/v1/statistics` 接口，前端用 React Query 缓存数据，支持右上角选择“日期范围”。

#### 模块二：Playground (多任务调试工作台)

**目标**：打造类似 IDE 的多标签页（Multi-Tab）调试环境，集成多种 AI 任务流。

- **核心架构**：
    - **Tab 标签页管理**：支持同时打开多个调试会话，类似浏览器 Tab。
    - **任务类型支持**：新建 Tab 时可选择任务类型：
        1.  **ChatFlow (默认)**：多轮对话调试。
        2.  **Prompt Design**：提示词工程与单次测试。
        3.  **Embedding**：向量生成与可视化测试。
        4.  **Rerank**：重排序模型评分测试。
    -- **历史记录保存**：新建 Tab 时可选择加载历史记录，方便复现问题。支持过滤和搜索历史对话。

- **详细设计 - ChatFlow 模式**：
    - **布局结构**：
        - **顶部**：Tab 栏与模型选择器（支持**多选**进入对比模式）。
        - **中间**：对话展示区（Message Stream），展示 User/Assistant 气泡。
        - **底部**：增强型输入框（Textarea + Attachments）。
        - **右侧栏**：参数配置（Temperature, MaxTokens）与 System Prompt 设置。
    - **交互特性**：
        - **多模型对比**：同时从多个模型接收流式响应，横向分栏对比效果。
        - **思考过程 (CoT)**：折叠展示推理模型（o1/r1）的 `reasoning_content`。
        - **流式渲染**：Markdown 实时渲染与代码高亮。

- **其他模式规划**：
    - **Prompt Design**：左侧变量编辑器 ({input})，右侧实时预览与批跑。
    - **Embedding/Rerank**：输入文本列表，输出向量维度/相似度分数可视化。
        
#### 模块三：日志审计 (Logs & Tracing)

**目标**：快速定位 bad case，查看原始 JSON。

- **布局**：高密度数据表格。
    
- **列定义**：Trace ID (截断显示，点击复制)、时间、User、Model、Tokens (Prompt/Completion)、耗时、Status (带颜色 Tag)。
    
- **过滤器 (Filters)**：

- **抽屉详情 (Drawer)**：点击某一行，右侧滑出 Drawer，展示完整的 Request Body 和 Response Body (使用 `react-json-view` 进行格式化展示)。
    

#### 模块四：供应商与模型管理 (Providers)

**目标**：管理上游 API Key 和模型映射。

- **功能**：
    
    - **卡片式列表**：OpenAI, Google, Azure 等。
        
    - **状态检测**：前端定期 ping 后端接口，显示供应商健康状态（绿灯/红灯）。
        
    - **模型映射表**：编辑 `gpt-4-turbo` 映射到后端的哪个具体 deployment。
        

---

### 3. 关键 UI 组件实现思路

#### (1) 展示“思考过程”的 Chat Bubble

#### (2) 使用 Vercel AI SDK 处理流式

不需要自己写 `fetch` 和 `reader.read()`。

---

### 4. 目录结构建议 (Next.js App Router)

```
app/
(auth)/             # 登录/注册页
└── login/
├── (dashboard)/        # 需要鉴权的页面布局
│   ├── layout.tsx      # Sidebar, Header
│   ├── page.tsx        # 仪表盘 (Dashboard)
│   ├── chat/           # 对话页面
│   ├── logs/           # 日志表格
│   ├── providers/      # 供应商管理
│   └── settings/       # 用户与Token管理
└── layout.tsx
components/
├── ui/                 # Shadcn 基础组件 (Button, Input, Table...)
├── charts/             # 封装的图表组件
├── chat/               # ChatBubble, ModelSelector
└── logs/               # LogTable, LogFilters
lib/
├── api.ts              # Axios/Fetch 封装
├── utils.ts
└── types.ts            # 与后端 Pydantic 对应的 TypeScript 接口
hooks/
├── use-metrics.ts      # React Query hooks
└── use-stream.ts
```
### 5. 工业级体验的细节加分项

1. **Dark Mode (深色模式)**: 开发者工具标配，使用 `next-themes` 实现一键切换。
    
2. **Command K (命令面板)**: 类似 VS Code，按 `Cmd+K` 弹出搜索框，快速跳转到某个 Model 的设置或某个 Log，可以使用 `cmdk` 库。
    
3. **Toast 通知**: 操作成功/失败的反馈，推荐 `sonner`，非常漂亮且高性能。
    
4. **Copy to cURL**: 在日志详情页，提供一个按钮 "Copy as cURL"，方便开发者直接在终端复现请求。
    
5. **Skeleton Loading (骨架屏)**: 图表加载时不要转圈圈，而是显示灰色的占位骨架，体验更丝滑。
    

### 总结

要设计一个工业级的前端：

1. **UI 风格**：选择 **Shadcn/ui**，它是目前 AI 领域的审美标准。
    
2. **数据层**：利用你后端强大的 SQL 聚合能力，前端只负责用 **Recharts** 展示。
    
3. **交互层**：利用 **Vercel AI SDK** 解决流式对话的复杂性，手动实现“思考过程”的可折叠 UI。
    
4. **管理层**：**TanStack Table** 是处理海量日志过滤和展示的唯一真神。

