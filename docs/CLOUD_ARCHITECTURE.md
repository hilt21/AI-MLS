# 云端架构

## M2 增量 · 2026-10-18

模拟模型完整闭环、Cloudflare 原生检查及 main 门禁见 [M2 验证报告](M2_VERIFICATION.md)；按改动范围选择真实集成见 [PR 验收规则](PR_ACCEPTANCE.md)。本轮不修改生产配置，Sites 冻结继续阻塞。

## M1 增量 · 2026-10-18

M1 已建立 Cloudflare 原生分支 Preview，绑定独立测试 D1/R2，并复用现有 Access 身份验证；生产配置和服务保持原样。生产 Builds 仍用原控制台补写命令，新发布脚本仅用于 Preview。 详见 [M1 验证报告](M1_VERIFICATION.md)。以下历史记录保留原时间语境。

## 适用范围与依据

根目录是 Vinext / React / TypeScript / D1 / R2 云端试点工程，同时保留 Sites 构建集成。
当前独立 Cloudflare 部署与 Sites 托管版本是两个发布目标，不能因源码共享而视为同一环境。
本页说明运行架构；发布关系、资源快照、证据和改造顺序见[持续开发与维护](DEVELOPMENT.md)。

当前业务试点为 [milestone-2026-10-20](https://github.com/hilt21/AI-MLS/releases/tag/milestone-2026-10-20)，
已发布源码提交 `d95d56d898510670be0cda86f641aa2d9bbad87d`，入口为 https://mls.embrake.dev/。
现有运行架构和生产配置保持原样；发布关联、验收边界、业务 CPU 风险、生产备份未启用及 Sites 冻结阻塞见[当前发布状态](DEVELOPMENT.md#当前发布状态--2026-10-20)。
2026-10-17 里程碑及下方 M0–M2 描述保留历史语境，不代表当前尚未发布。

## 当前运行路径

独立部署：浏览器 → Cloudflare Access 邮箱白名单 → Worker 的 JWT 验证 → Vinext 页面/API → D1 / 私有 R2。
Sites 托管：浏览器 → Sites 身份网关 → 同一套应用 API → 平台提供的存储绑定。

- `build/sites-worker.ts` 在配置 `CLOUDFLARE_ACCESS_AUD` 时验证 JWT 的签名、issuer、audience 和必要 claims，替换传入身份头。
- `app/chatgpt-auth.ts` 消费身份头；`app/api/[...path]/route.ts` 按用户 ID 检查数据所有权，并对写请求检查 Origin。
- 独立部署的身份 ID 使用 `cloudflare:` 前缀；Sites 身份与其不是同一命名空间。切换身份提供方不能假设原有学习记录自动归属于同一用户。
- Sites 身份路径依赖可信平台网关；独立部署依赖 Access 配置和 Worker 验证。当前邮箱白名单用于受控试点，不等于正式学生账号生命周期已完成。

数据流：上传 → 浏览器重编码 → 私有原图和草稿 → 可选视觉模型 → 人工校对确认 → FSRS 到期任务 → 自评 → 事务保存事件与排期。

- 图片识别仍在请求内执行；失败保留原图，可在符合条件时手动重试。尚无持久异步队列与自动重试。
- 占位草稿不能确认入库或参与复习；模型输出经过结构校验。
- FSRS 在服务端调度；提示辅助或自评错误按 Again 记录。自评不是客观判分。
- D1 使用事务批处理、提交 ID 和版本检查保护复习提交；R2 经应用接口校验所有权后读取。
- 数据表与迁移以 `db/schema.ts`、`drizzle/` 为准；API 行为以当前实现和 `tests/api.test.mjs` 为准。

## 文档契约边界

| 文档或目录 | 使用范围 |
| --- | --- |
| 本页 | 当前云端运行架构 |
| DEVELOPMENT.md | 持续开发、发布、环境隔离与恢复方案 |
| CLOUD_QA.md | 分日期的验证证据与限制 |
| PRODUCT_SPEC.md | 产品目标和正式上线条件；其中后台识别、账号发放等不是当前实现完成声明 |
| ARCHITECTURE.md、API_CONTRACTS.md、TASKS.md、QA_REPORT.md | 保留的 v0.1 历史方案/记录；其中 Supabase Session、RLS、RPC 等不能套用于当前 D1 API |
| deployments/mainland-nextjs/ | 保留的 Next.js + Supabase 境内部署工程；仅在明确涉及该方案的任务中修改 |

正式学生上线仍须核对产品规格中的账户、监护人流程、部署地区和验收条件。
当前云端试点与境内部署要求的差距尚未消除；持续开发架构不自动修改产品要求，也不要求现在同时维护两套生产应用。

## 保留与演进

保留现有前端、D1/R2、FSRS、API 测试与 Sites 集成，避免因发布治理重写业务。
按实际瓶颈演进异步识别、正式学生认证和算法回归；环境隔离、发布门禁、数据恢复按 DEVELOPMENT.md 的阶段实施。
