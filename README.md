# 错题进步簿 · AI-MLS

小学、初中数学错题学习系统。拍照上传、人工校对、间隔复习、学习反馈。

## 当前版本

根目录是 Sites 私有云端验证版：Vinext / React / TypeScript / D1 / R2 / ts-fsrs。平台登录用于开发者验证，不等同于正式学生账号。网站没有预置学生或模拟学习记录。

`deployments/mainland-nextjs/` 保留上一轮 Next.js + Supabase 境内部署工程。该目录尚未完成依赖构建、真实数据库与学生账号集成验证，不能直接视为生产版本。正式学生使用前需完成境内部署与账户集成。

## 本地开发

Node 24，pnpm。执行 `pnpm install --frozen-lockfile`，`pnpm test`，`pnpm typecheck`，`pnpm build`。开发命令为 `pnpm dev`。Sites 托管发布使用 Sites 工作流，避免直接部署覆盖平台配置。

D1 schema 位于 `db/schema.ts`，迁移位于 `drizzle/`。修改 schema 后运行 `pnpm db:generate`。本地数据库与线上数据库相互独立。

## 模型配置

通过 Sites 环境设置配置 `MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME`，所有密钥仅保存在服务端。接口为 OpenAI-compatible 多模态 chat/completions，选择符合部署地区要求的服务提供方。没有配置时上传会创建明确标注的待手动整理草稿。不会生成伪识别结果。

当前识别在上传请求内执行，55 秒超时，失败保留原图和草稿。持久异步队列、任务恢复和重试尚待实现。暂勿用于正式学生批量上传。

## 学习数据

确认题目后进入复习；FSRS 更新下一次到期时间。提示辅助或自评错误按 Again 记录。正确率来自学生自评，没有自动判分。事件包含输入、调度前后状态与算法版本。提交 ID 去重，SQLite 事务和版本检查防止并发重复更新。图片按用户隔离，访问接口检查所有权。

浏览器上传先重编码 JPEG，去除原图 EXIF 并压缩；服务端检查类型和大小。该处理不能替代正式试点的内容安全和隐私验证。

## 验证边界

见 `docs/CLOUD_QA.md` 和 `docs/CLOUD_ARCHITECTURE.md`。自动 API 测试使用真实内存 SQLite，模拟平台身份与 R2，不代表线上跨账号或真实模型测试通过。
