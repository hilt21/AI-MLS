# 错题进步簿 | Mistake Learning MVP

小学与初中数学错题学习闭环的 v0.1 工程实现。**试点代码，尚未达到真实未成年人公开上线的安全/合规标准。**

## 技术栈

- Next.js + React + TypeScript，响应式移动 Web
- Supabase Self-hosting（Auth、Postgres、Storage、RLS）
- 中国大陆区域多模态模型接口（OpenAI-compatible Qwen VLM）
- ts-fsrs 复习调度，服务端原子提交，重放日志

## 已编写的模块

- 学生账号登录/登出（管理员在核实监护人同意后，后台发放账号）
- 6MB 图片上传、服务器转 WebP 去除 EXIF/GPS 元数据、每日 20 张配额、私有存储，异步识别任务（最多 3 次尝试）
- 题目结构化校验、学生核对和原图对照、Markdown/LaTeX 渲染
- 复习任务、Again/Hard/Good/Easy 调度、重复请求幂等及并发版本锁
- 最近学习自评统计、删除题目/原图/学习记录、后台清理学生账户脚本

## 启动（必须先配置资源）

1. Node.js 20.9+，运行 `npm install`。
2. 自托管 Supabase（按 Supabase 官方 Docker 指引），在空项目中运行 `supabase/migrations/001_init.sql`。
3. `cp .env.example .env.local`，填入 Supabase URL、publishable key、后端 secret key、已验证的自有登录域名、worker secret、境内模型端点和 key。
4. 运行 `npm run dev`，访问 `http://localhost:3000`。
5. 仅在**已经实际核验监护人同意**之后，设置环境变量 `CONSENT_RECORD_ID`、`CONSENT_VERIFIED_BY`、`CONSENT_VERIFIED_AT`、`PROCESSING_RULES_VERSION`，执行 `npm run provision -- student001`。**注意**：脚本使用进程环境变量，不会自动加载 `.env.local`；应通过安全的环境注入工具提供这些变量。初始密码只显示一次。
6. 为模型识别，另起一后台 Worker 进程 `node scripts/poll-worker.mjs`，配置相同的 `APP_ORIGIN` 和 `WORKER_SECRET`。同样需要注入脚本环境变量。`/api/internal/process-job` 需要服务端专用密钥并应加网络层访问限制。

## 本轮环境验证范围

仅生成源码和文档；npm Registry 在当前容器网络中不可用，因此无法证明 `next build`、实际数据库连接、真实模型识别、浏览器 QA 已通过。见 `docs/QA_REPORT.md`。

## 推荐部署

真正面向中国大陆发布前，先完成 ICP / 公安备案要求、未成年人个人信息处理规则和监护人同意验证流程。不要将托管在海外的 Supabase 或海外模型 Endpoint 用于真实儿童数据而未做数据跨境评估。推荐在境内合规云基础设施中独立部署 Supabase 和 Next.js，模型工作区也在境内。详细见 `docs/ARCHITECTURE.md`。

## 第一次可验证的学习闭环

已确认监护人同意 -> 管理员发账号 -> 学生登录 -> 上传 -> worker 识别 -> 学生核对 -> 确认入库 -> 独立重做 -> 反馈 -> FSRS 排下次 -> 进度记录。
