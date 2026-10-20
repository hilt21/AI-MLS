# 错题进步簿 · AI-MLS

小学、初中数学错题学习系统。拍照上传、人工校对、间隔复习、学习反馈。

## 当前版本

根目录是 Vinext / React / TypeScript / D1 / R2 / ts-fsrs 云端试点工程，保留 Sites 集成。当前独立 Cloudflare 业务试点版本为 [milestone-2026-10-20](https://github.com/hilt21/AI-MLS/releases/tag/milestone-2026-10-20)（已发布提交 `d95d56d`），入口为 [错题进步簿](https://mls.embrake.dev/)，使用 Cloudflare Access 邮箱白名单。该试点身份不等同于完整的正式学生账号体系。

运行路径和历史方案边界见 [云端架构](docs/CLOUD_ARCHITECTURE.md)；现有 Workers Builds、Sites 发布目标、只读审计和最小改造方案见 [持续开发与维护](docs/DEVELOPMENT.md)。

`deployments/mainland-nextjs/` 保留上一轮 Next.js + Supabase 境内部署工程。该目录尚未完成依赖构建、真实数据库与学生账号集成验证，不能直接视为生产版本。正式学生使用前需完成境内部署与账户集成。

## 本地开发

Node 24，使用 package.json 固定的 pnpm 版本。执行 `pnpm install --frozen-lockfile`，`pnpm test`，`pnpm typecheck`，`pnpm build`。开发命令为 `pnpm dev`。这些是本地开发步骤，不会发布；独立 Cloudflare 目标已有 main 自动 Builds，推送或合并前须核对 [发布边界](docs/DEVELOPMENT.md)。Sites 托管目标仍使用其平台工作流，两个目标不可混用。

D1 schema 位于 `db/schema.ts`，迁移位于 `drizzle/`。修改 schema 后运行 `pnpm db:generate`。本地数据库与线上数据库相互独立。

## 模型配置

在实际部署目标的服务端环境配置 `MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME`：独立 Worker 使用 Cloudflare Variables & Secrets，Sites 托管目标使用 Sites 环境设置。接口为 OpenAI-compatible 多模态 chat/completions，选择符合部署地区要求的服务提供方。没有配置时上传会创建明确标注的待手动整理草稿。不会生成伪识别结果。

当前识别在上传请求内执行，55 秒超时，失败保留原图和草稿。持久异步队列、任务恢复和重试尚待实现。暂勿用于正式学生批量上传。

## 学习数据

确认题目后进入复习；FSRS 更新下一次到期时间。提示辅助或自评错误按 Again 记录。正确率来自学生自评，没有自动判分。事件包含输入、调度前后状态与算法版本。提交 ID 去重，SQLite 事务和版本检查防止并发重复更新。图片按用户隔离，访问接口检查所有权。

浏览器上传先重编码 JPEG，去除原图 EXIF 并压缩；服务端检查类型和大小。该处理不能替代正式试点的内容安全和隐私验证。

## 验证边界

见 `docs/CLOUD_QA.md` 和 `docs/CLOUD_ARCHITECTURE.md`。自动 API 测试使用真实内存 SQLite，模拟平台身份与 R2，不代表线上跨账号或真实模型测试通过。

干净克隆的构建复现、配置差异与权限核查结果见 [M0 验证报告](docs/M0_VERIFICATION.md)。

发布配置、Wrangler 升级与隔离 Preview 的使用及验证见 [M1 验证报告](docs/M1_VERIFICATION.md)。生产沿用既有 main → Workers Builds 入口，新仓库发布脚本尚未切换生产。

提交 PR 前按 [PR 验收规则](docs/PR_ACCEPTANCE.md)执行浏览器检查及对应真实集成；本轮证据见 [M2 验证报告](docs/M2_VERIFICATION.md)。

隔离备份、邮件告警、恢复和有限回滚的使用与证据见 [M3 验证报告](docs/M3_VERIFICATION.md)；生产备份接入尚未执行。

生产规模核查、独立容量与健康告警验证见 [M4-A 验收](docs/M4A_VERIFICATION.md)；当前 CPU 预算门槛未通过，生产备份未启用，发布入口未切换；业务试点已独立发布。

当前业务试点已获用户接受 CPU 风险并发布，仅供现有 Access 白名单少量账号试用；生产备份及告警接入未启用，Sites 资源映射与冻结继续阻塞。免费套餐、备份 CPU 可靠性及生产恢复目标缺口保留；不代表正式学生上线。

本次发布关联、Preview 完整闭环与生产只读验收、CPU 风险和有限代码回滚条件见[当前发布状态](docs/DEVELOPMENT.md#当前发布状态--2026-10-20)。学生使用与识别质量的剩余问题见[专项审计](docs/STUDENT_WORKFLOW_AUDIT.md)。
