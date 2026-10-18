# M0：干净构建复现与配置、权限核查

2026-10-18（Asia/Shanghai）执行。用户已确认完整方案并仅授权 M0；本报告不代表 M1–M4 已启动。

## 结论

**当前里程碑可从 GitHub 干净克隆，在 Node 24 环境独立安装、通过 19 条 API 测试、类型检查并构建。**
构建过程无需 Sites 私有开发环境或生产凭据，锁文件和跟踪源码保持不变。
但生成配置不是可直接发布的生产配置，也不是可直接使用的隔离 Preview 配置：D1 为占位 ID、Access 参数缺失、R2 桶名与生产相同。
生产仍依赖 Builds 控制台补写配置；构建 token 权限明显宽于当前项目已知需求，main 尚无合并门禁。

[结构化证据](evidence/m0-2026-10-18.json)保存每步命令、退出码、完整去除 ANSI 的输出、产物哈希及脱敏只读核查摘要。
原始逐步日志和 JSON 位于 `/private/tmp/ai-mls-m0-20261018-evidence/`；临时目录可能被系统清理，仓库证据文件为持久记录。

## 复现方法与结果

- 直接从 `https://github.com/hilt21/AI-MLS.git` 克隆到全新目录 `/private/tmp/ai-mls-m0-20261018-source`，未复制本地未提交文档、node_modules、环境文件或执行配置。
- 干净克隆 HEAD、远端 main 与 `milestone-2026-10-17` 均为 `ebc287a71823836b2711b1ff47ac0cd0a8b381a0`。
- 本机 Darwin arm64，使用临时工具目录的官方 Node **24.22.0** 和项目固定 pnpm **11.25.0**；Node 下载与官方 SHA-256 清单一致，没有替换系统 Node。
- Cloudflare 原成功构建日志使用 Node **24.21.0** / pnpm **11.25.0**。本轮验证了 Node 24 另一补丁版本上的可构建性，没有宣称相同 OS、相同 Node 补丁版本或产物逐字节一致。
- 子进程采用白名单环境，未传入 MODEL、Cloudflare 或 GitHub 凭据；无 `.sites-runtime/execution-profile.json`，使用默认 portable 路径。
- 按仓库既有策略正常安装，未放宽依赖发布时间策略、跳过构建脚本或改写锁文件。

| 命令 | 开始时间（Asia/Shanghai） | 退出码 | 耗时 | 结果 |
| --- | --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 11:15:18 | 0 | 42.03 s | 锁文件一致，pnpm 11.25.0 |
| `pnpm test` | 11:16:12 | 0 | 0.57 s | 19 条 API 测试通过 |
| `pnpm typecheck` | 11:16:13 | 0 | 3.91 s | `tsc --noEmit` 通过 |
| `pnpm run build` | 11:16:17 | 0 | 4.69 s | Vinext 五阶段构建完成，生成 Worker 与客户端产物 |

API 测试使用内存 SQLite、模拟身份/R2/模型边界；测试中的识别失败日志是预期负例，不是真实模型调用失败。
构建提示根页面无法静态分类，这是已输出的 Vinext 限制，未造成失败；本轮未扩展为浏览器运行验收。

锁文件构建前后 SHA-256 均为：

```text
df173af1cdc75eebc8585b429e5aeb68708312d515d763dbc84f1d4c3df9147b
```

构建后 `git status --porcelain` 为空；`dist/server/index.js` 存在。产物 SHA-256 只用于标识本轮产物，不是线上包一致性证明。

## 生成配置与实际发布差异

| 项目 | 干净构建产物 | 当前线上 / 控制台 | 判断 |
| --- | --- | --- | --- |
| Worker / 入口 | ai-mls / index.js，入口存在 | ai-mls，带 assets | 构建目标名称一致；仍须运行验收 |
| Compatibility | 2026-05-15、nodejs_compat | 相同 | 已匹配 |
| D1 | DB → site-creator-d1，UUID 为 `00000000-0000-4000-8000-000000000000` | DB → ai-mls-db / `<production-d1-id>` | 控制台部署命令补写；仓库不能独立复现完整发布配置 |
| R2 | BUCKET → site-creator-r2 | 同名生产桶 | 生成配置不具备测试数据隔离；不可直接用于远程 Preview 写入 |
| Access | vars 为空 | issuer、audience 存在，控制台部署命令补写 | 缺失运行配置，不能直接作为独立生产身份入口 |
| 模型 | 无模型变量或密钥 | MODEL_API_KEY secret 及 BASE_URL、NAME 存在 | 保留服务端配置；未读取密钥值 |
| 变量保留 | 未显式设置 keep_vars=true | 控制台补写 keep_vars=true | 需要纳入后续发布配置契约核对 |
| 日志 | observability.enabled=true | 持久日志启用，query string 自动脱敏关闭 | 启用日志不等于完成脱敏 |
| Preview | 未声明隔离配置 | Preview 基础命令为 build 后运行 wrangler preview | 当前配置尚未验收；项目 Wrangler 仍为 4.92.0 |

没有执行 `wrangler deploy`、`wrangler preview`、生产迁移、数据库查询或图片写入。
M1 应把最小非秘密发布配置纳入版本管理并区分生产/测试目标，保留已有业务和 Sites 构建集成。

## 权限核查

### GitHub

只读 API 确认当前会话对 hilt21/AI-MLS 有 ADMIN 权限；OAuth 响应头 scope 为 `gist, read:org, repo, workflow`。
main 的 protected=false，rulesets=[]；现有成功 Builds Check 尚不是强制 PR 门禁。
这说明当前审计会话有宽权限，不应把它作为日常 Agent 的最小权限模板；本轮未修改凭据或远端规则。

### Cloudflare 构建 token

Builds API 将 ai-mls 的构建设置关联到用户所有的 `ai-mls-cloudflare-build`。
用户 token 详情 API 返回错误 9109（Unauthorized）；随后通过现有 Chrome 登录会话的“API 令牌 → 查看摘要”只读核实权限，未查看密钥、编辑、轮转或创建 token。

- 状态 Active，权限条目 27，资源范围为一个账户、所有区域及用户读取范围（UI 标注“所有用户”，不据此推断可访问他人账户）；列表过期时间显示 `-`，本轮没有确定实际到期策略。
- 包括 Workers Scripts、D1、R2 的编辑权限，也包含 Artifacts、AI Search、Containers、Secrets Store、Browser Rendering、AI Gateway、Queues、Vectorize、Hyperdrive、KV 等编辑权限。
- 所有区域范围还包括 Email Routing Rules、Workers Routes、SSL and Certificates 编辑；另有 Account Settings、Memberships 和 User Details 读取。
- 当前项目已知使用范围不能解释全部这些权限，结论为**权限偏宽，尚未完成最小化**。具体可删权限须结合 M1 实际部署命令验证，不在 M0 贸然撤销。

完整权限名称的脱敏转录见结构化证据；没有保存 token 值、邮箱白名单或模型密钥。
日常开发、构建部署与应急恢复应分别评估权限；本轮只核查，不改变角色和授权。

## 日志与通知核查

- Worker 持久 invocation logs 已启用，采样率 1，query string 自动脱敏为 false。
- Notification Policies 当前只有两条已启用的 billing_budget_alert，阈值分别为 10 USD、0.01 USD，各有一个邮件目标；没有保存实际收件地址。
- 邮件机制 eligible=true、ready=true；这不是测试邮件送达证明，收件地址仍须实施前确认。
- 可用告警类型目录列出 Workers Observability 的 Real-Time Issue 和 Alert Policy，可作为 M3 原生能力候选，尚未验证其覆盖范围与配置。
- ai-mls 的 issue automations 为空，Worker cron schedules 为空；这些结果不能排除账户外的其他调度或备份。
- 当前没有从这些只读配置证明应用故障及配套备份超龄已被监控。费用告警不是应用可用性告警，也不是费用硬上限。

## M0 验收与后续边界

| M0 项目 | 状态 |
| --- | --- |
| GitHub 干净克隆、固定版本工具、锁文件安装、测试、typecheck、build | 通过 |
| 产物与实际部署配置差异 | 已核清并记录，完整发布配置尚不能仅凭源码重建 |
| GitHub/构建 token 当前权限与门禁 | 已核查；宽权限和无门禁是明确缺口，未整改 |
| 日志、原生通知目录及现有告警 | 已核查；送达、脱敏与目标故障覆盖尚未验收 |
| Sites 资源关系及冻结 | 继续阻塞，未改变 |

M0 的调查与构建复现完成，**不代表最小权限、隔离 Preview、合并门禁、备份恢复或生产切换完成**。
M1–M4 尚未启动；业务代码、依赖、生产配置、凭据和远端权限未改动，也未提交、推送或部署。
