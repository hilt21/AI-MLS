# M1 发布配置与隔离 Preview 验证

日期：2026-10-18。范围：发布配置、工具链升级及一套串行测试 D1/R2；生产服务与配置保持原样，Sites 冻结继续阻塞。

## 结果与证据

代码分支 `codex/m1-isolated-preview`，最终提交 `d023eefeabaa3e92a5a11d80489ef1cd21688740`，已推送；远端 main 仍为 `ebc287a71823836b2711b1ff47ac0cd0a8b381a0`，未合并、未创建 PR。

[隔离 Preview](https://codex-m1-isolated-preview-ai-mls.hanyuelt.workers.dev/) 是原生分支 Preview；测试 D1 名 `ai-mls-preview-db`、R2 名 `ai-mls-preview-images`，其绑定与生产分别比较，UUID 和桶名均不同。R2 公开访问关闭。新 D1 只按现有迁移初始化三张业务表，没有建立迁移执行账本；后续迁移机制须显式处理这份测试基线。

最终 Cloudflare 构建 `1fe5bcf5-cf6e-44fe-b561-9803cfb0457e` 成功，分支 Check `Workers Builds: ai-mls` 对应最终提交且结论 success。Preview 部署 `79d21013-aad2-4d06-8596-623c39312cff` 使用兼容日期 `2026-05-15`，绑定仅包含测试 DB、测试 BUCKET 与现有 Access 参数，无 MODEL_API_KEY。

通过 GET 元数据前后比较：生产 Worker settings、生产 deployments、Builds production_settings、Access applications 均相同。未向生产发出业务写入、迁移或发布操作；此比较不等于逐字节校验所有生产数据。

## 仓库变更与复现

六个已提交文件：package.json、pnpm-lock.yaml、vite.config.ts、deployments/cloudflare.json、scripts/prepare-worker-config.mjs、tests/release-config.test.mjs。业务逻辑没有改动。

- Wrangler 固定 4.135.0；匹配 @cloudflare/vite-plugin 1.56.0、workers-types 5.20260918.1。Vite、Vinext 和业务直接依赖保持原版本。
- 仅升级 Wrangler 时，原插件因 `unstable_getWorkerNameFromProject` 接口不兼容而构建失败；匹配插件版本后通过。新插件默认日期发生变化，已显式固定原日期，最终云端部署核实一致。
- 发布模板使用环境变量占位符。脚本校验缺失参数、零值 UUID、生产与测试共享 DB/R2、Access 参数及意外变量；失败即停止。
- 输出 `dist/server/wrangler.release.json` 与生成文件同目录，保留 main/assets 相对路径；使用 `--ignore-base-config` 防止再次合并基础绑定。

Node 24.22.0 / pnpm 11.25.0 下：`pnpm test:config` 8/8，`pnpm test` 19/19，`pnpm typecheck`、`pnpm build:release`、Wrangler dry-run、新增脚本 lint 均通过。构建最终又由 Cloudflare 原生流水线通过。全库 lint 仍为 21 errors / 10 warnings，规范化诊断与原始里程碑一致；未扩大范围修复。代码审查未发现新增缺陷；JS 审查因全库既有 lint 失败未给出无条件批准。

本地临时执行记录：`/private/tmp/ai-mls-m1-evidence/`，包含各命令退出码、耗时及首次失败日志；临时文件不作为长期备份。持久摘要见 [结构化证据](evidence/m1-2026-10-18.json)。本地审计文档和截图尚未提交；含账户元数据的历史审计材料须脱敏后再公开。

### Preview 构建配置

仅修改 Preview 基础设置：

```sh
# Build
pnpm test:config && pnpm test && pnpm typecheck && pnpm build:release
# Deploy
pnpm preview:deploy
```

Preview 构建变量需设置：`CLOUDFLARE_ACCOUNT_ID`、`AI_MLS_PRODUCTION_D1_ID`、`AI_MLS_PREVIEW_D1_ID`、`AI_MLS_PRODUCTION_R2_BUCKET`、`AI_MLS_PREVIEW_R2_BUCKET`、`CLOUDFLARE_ACCESS_ISSUER`、`CLOUDFLARE_ACCESS_AUD`。生产资源参数仅用于生成模板和差异校验；最终 Preview 绑定核实为测试资源。构建变量及最终绑定是两层不同配置。当前生产构建命令没有调整，未来切换新脚本前还须单独准备生产侧变量并审批。

公开推送真实账户、资源和 Access 元数据的首次操作被自动审批审查拒绝，未执行提交或推送；已改为公开占位模板、Cloudflare 构建变量注入后完成推送。未读取或复制模型密钥。

## 真实浏览器验收

匿名请求 `/api/auth/me` 及伪造平台身份头请求 `/api/questions` 均返回 Access 302。现有获授权身份可正常登录，无 Access 策略变更。

在隔离 Preview 上传本地生成的 160×96 合成 PNG，模型缺少配置时显示人工草稿；原图接口成功加载（自然尺寸 160×96）。填写 `[M1 隔离验收] 合成测试题`、确认后显示入库 1 / 待复习 1，刷新后题目与图片仍在。记录仅含 `1 + 1` 合成内容，无学生数据。该记录和图片暂保留作验收证据；删除确认已取消，未执行不可恢复清理。

截图与原始运行证据保存在本地受限目录；公开摘要不包含图片或个人元数据。

范围限制：未调用真实模型、未完成跨账户隔离、复习提交或自动化手机端 E2E。这里只证明 M1 发布与真实存储链路；M2 仍需模拟模型闭环、按范围真实集成、串行占用及强制合并门禁。

## 回退与未决项

生产维持原部署，M1 无需生产回滚。若 Preview 工具链失败，可停止该分支构建并回退上述两个提交；先确认测试资源无人使用，再另行清理。保留现有资源、Secrets 和构建集成，避免影响生产。不要把原始里程碑直接部署到隔离环境，其生成配置仍含生产桶名与占位 DB。

Sites 后端映射仍未核实，因此冻结保持阻塞。main 保护、最小权限、备份告警和恢复演练分别留 M2–M4；本次不宣称持续维护闭环全部完成。
