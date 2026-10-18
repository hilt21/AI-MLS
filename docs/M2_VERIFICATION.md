# M2 浏览器闭环与 PR 门禁

日期：2026-10-18。PR：[hilt21/AI-MLS #1](https://github.com/hilt21/AI-MLS/pull/1)。最终 head：`566322e00ac0f78040be709bab6b724326665ace`；包含未合并的 M1 配置与本轮测试。main 仍为生产里程碑提交，合并未获授权、未执行。

## 浏览器验证

`pnpm test:browser` 对真实 build 产物运行手机 Pixel 7 与桌面 Chromium，2/2 通过（本地 7.9 秒）。测试专用 Worker 入口在导入应用前挂载模拟模型和测试身份；配置只含本地临时 D1/R2，移除调用者 MODEL_* 环境，不引用生产发布配置。测试模块在 finally 清理，成功后确认生成目录不存在 m2-test-worker.mjs / m2-model.mjs。

闭环：合成 PNG 上传 → 非法模型响应显式失败且禁止入库 → 同一原图重试成功 → 人工修改标题 → 确认入库 → 填写答案/自评/提示使用 → 复习提交 → 刷新后题目和一条学习记录仍在 → 第二身份无法列出、修改、删除题目或读取图片 → API 清理题目、复习事件与图片。删除覆盖是 API 验证，不是浏览器删除按钮。

原图接口实际加载；上传经过真实浏览器重编码。数据和模型响应均为合成，不代表真实模型或线上多账号认证验收。19 条 API 回归、typecheck、新增 JS lint 均通过。全库既有 lint 错误仍未整改；代码审查无阻塞发现，JS 正式审查因既有 lint 门禁未给出无条件批准。

本地原始证据在 [browser log](evidence/m2-2026-10-18/local-browser.log)、[JSON](evidence/m2-2026-10-18/local-results.json)。失败时输出 trace/截图，正式命令不自动重试。初期夹具错误及模块路径/加载顺序错误均以失败结束，修正后重跑通过。

截图与原始运行证据保存在本地受限目录；公开摘要不包含图片或个人元数据。

## 原生 Cloudflare 构建

Preview 构建命令（生产命令保持原样）：

```sh
pnpm test:config && pnpm test && pnpm typecheck && pnpm build:release
```

首次云端构建 `a93f802f-f002-4a30-b457-f8bec0577309`，head `8986a44`：frozen lockfile 安装、API/typecheck/build 通过，浏览器因构建镜像缺少 `libatk-1.0.so.0` 失败；没有部署。基础模板加入官方 `--with-deps` 后，已有 Preview 仍保留创建时的独立设置，构建 `1249339c-c597-4c4d-8191-e5684d7b4756` 仍使用旧命令并失败。随后同步更新分支配置，重试同一 head 的构建 `491fdf94-1bf5-49d5-a074-f2e3ead53c32`。更新基础模板后必须复核已创建 Preview 的实际命令。此重试实际使用 with-deps 后，日志显示 `Switching to root user`、`su: Authentication failure`，原生容器无法满足浏览器依赖。按已确认架构例外，仅浏览器 CI 转到 GitHub Actions；没有增加第二条部署链。Preview 基础与分支恢复上述原生命令。最终结果与真实集成见下方增补，不以本地通过替代云端通过。

## main 合并门禁

GitHub main 分支保护已启用：

- 必需 `Workers Builds: ai-mls`，固定 Cloudflare App ID 85455；含配置/API/typecheck/build 检查。
- 必需 GitHub Actions `Browser acceptance`，固定 App ID 15368，执行 API/typecheck/build 与手机/桌面闭环，附件保留 7 天；工作流无 Cloudflare 凭据和部署步骤。
- 必需 `AI-MLS / integration acceptance`，在线验收者根据 [范围规则](PR_ACCEPTANCE.md)完成真实集成/不适用说明后，在相同 head 写 commit status，并附 PR 证据。它是有写权限身份的人工状态，不能冒充独立可信 CI。
- strict=true，要求分支与 main 同步；要求 PR、解决讨论；强推与删除关闭，管理员也受保护。
- 独立批准人数量为 0：仓库仅一个管理员、PR 作者与用户同身份，不能自审。用户已接受强制检查/PR + 会话中批准具体 head 的方式。规则管理权限保留为应急通道，日常不绕过。GitHub 无法区分同一凭据下的人与 Agent，因此用户批准仍是执行边界，而非独立身份技术门禁。

已验证：缺少 integration acceptance 且云端检查未完成时，PR mergeStateStatus=BLOCKED；首次云端失败也不能满足必需检查。未通过实际合并或生产推送探测门禁。

## 范围、串行与生产保护

本轮只改测试、发布工具和 PR 文档；业务代码、识别请求、schema、认证与数据访问逻辑没有变化。真实集成范围取工具发布链路：最新 Preview 部署关联、隔离绑定、现有 Access、合成记录/图片读取与生产状态比对。真实模型调用及两个实际账号验证不属于本轮变更范围，未运行，不能声称已有通过结果。

共享云端测试资源仅本轮验收占用；本地自动测试每次新建独立状态。已有 M1 合成 fixture 保留且不改写，不触及学生记录；验收结束记录释放。其他 PR 写入验收须按 PR_ACCEPTANCE.md 登记并串行执行。

## 回退

本阶段无需生产回滚。Preview 检查异常时保留失败门禁，回退测试改动或修复后在新 head 重验。原 Preview 构建命令记录在 M1 报告；不要为通过检查而删除必需项。main 规则变更先保存当前 JSON，经用户批准后恢复相应字段。生产迁移、恢复、Access 变更及发布切换仍单独授权；M3/M4 未执行，Sites 冻结继续阻塞。

参考：[Cloudflare 构建镜像](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)、[GitHub 受保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)。实际能力以本轮执行结果为准。

## 最终结果与真实集成

最终 head `566322e00ac0f78040be709bab6b724326665ace` 的 Cloudflare 构建 `33d269fb-a0bc-4793-a2d0-eab9f2cb3d14` 成功，Preview 部署 `207d08f0-502a-49e3-9009-bdc4151dcb59` 标签匹配 head；运行日期与入口维持原样，DB/R2 为独立测试资源，无模型密钥。

[GitHub 浏览器 run 39096000490](https://github.com/hilt21/AI-MLS/actions/runs/39096000490) 成功，官方系统依赖安装、API/typecheck/build 和手机/桌面闭环均成功；head 命名附件已下载到本地证据目录。先前提交的 run 即使测试步骤成功，也已因新 head 取消，不作为最终通过依据。

[真实 Preview](https://codex-m2-pr-gates-ai-mls.hanyuelt.workers.dev/) 最终部署刷新后，授权身份仍能读取 M1 留存的合成题，私有原图实际加载尺寸 160×96；匿名 auth/me 和伪造身份头 questions 均为 Access 302。此为工具发布范围的只读集成验收，不含真实模型、跨真实账户或新增线上复习写入。

验收占用：PR #1 / 最终 head / root Agent，2026-10-18 04:08–04:10 UTC；仓库只有此开放 PR，未向共享云端测试资源写入新数据，M1 fixture 原样保留，验收后已释放。每次本地/CI 自动测试独立初始化并清理本地状态。

生产 Worker settings、deployments、production Build settings、Access apps 的前后 JSON 比对全部相同；远端 main 仍为原里程碑。这里证明配置未变及没有本轮生产写操作，不声称逐字节审计生产数据。

[PR 证据评论](https://github.com/hilt21/AI-MLS/pull/1#issuecomment-6245515506)保存上述范围与限制。当前 head 的 integration acceptance 已标 success；三项必需检查均通过。没有把验收状态等同于用户合并批准，PR 维持 open / unmerged。

截图与原始运行证据保存在本地受限目录；公开摘要不包含图片或个人元数据。

M2 实施完成。M3 备份/恢复与 M4 生产发布验收尚未执行，不能因技术门禁变绿而直接发布。仓库中的 PR_ACCEPTANCE.md、模板、测试及 workflow 已推送；本地初始化文档、报告与原始证据仍未提交，公开前须审查历史审计中的账户元数据。AGENTS.md 未扩写。

最终门禁复核：自动审查对 Preview 不继承模型配置的讨论已按当前无模型验收范围回复，未来模型变更按专用 Preview 凭据及真实调用单独验收；保留 ignore-base-config 的隔离约束。讨论解决后，GitHub 显示 mergeStateStatus=CLEAN、三项检查成功、PR OPEN / mergedAt=null。CLEAN 只表示技术条件满足，不表示获得用户合并批准。
