# 开发任务清单 / 当前状态

状态说明：`IMPLEMENTED` 仅表示源代码已经编写；`CHECKED` 表示进行了当前环境能够执行的静态验证；`BLOCKED` 表示缺少外部环境，未通过集成测试；`TODO` 表示尚未开发。

| ID | 任务 | 状态 | 进入下一阶段的验证证据 |
|---|---|---|---|
| P0-01 | 中国大陆/小学-初中/学生账户需求冻结 | IMPLEMENTED | docs/PRODUCT_SPEC.md |
| P0-02 | 题目、图片、识别任务、复习、尝试数据契约 | IMPLEMENTED | docs/API_CONTRACTS.md；数据库迁移 |
| P0-03 | 完成监护人同意和未成年人数据规则 | BLOCKED | 实际监护人核验流程、法律/隐私文本签核 |
| P1-01 | Next.js 移动端登录/退出 | IMPLEMENTED | 需浏览器连到 Auth 服务 |
| P1-02 | 学生私有图片上传和任务排队 | IMPLEMENTED | 需真实 RLS/Storage/限额并发验证 |
| P1-03 | AI 异步任务识别/校验/重试 | IMPLEMENTED | 需境内模型 key 与 100 张图片回归集 |
| P1-04 | 图片/可编辑题目/公式并排校对 | IMPLEMENTED | 需 iOS/Android 实机 UI QA |
| P1-05 | Confirm 入库+复习状态初始化 | IMPLEMENTED | 需数据库 migration 与并发验证 |
| P2-01 | FSRS 独立复习流程 | IMPLEMENTED | 需安装 ts-fsrs，验证学习步长与日志 |
| P2-02 | 事件去重/并发版本控制 | IMPLEMENTED | 需数据库 RPC 并行提交集成测试 |
| P2-03 | 今日复习和学习进度 | IMPLEMENTED | 需真实学生测试数据与端到端 QA |
| P2-04 | 版本化题目内容和删除脚本 | IMPLEMENTED | 需数据删除/备份/存储回收验证 |
| QA-01 | 语法和静态契约检查 | CHECKED | 5/5 静态测试；22 文件无语法错误 |
| QA-02 | npm install / next build / TypeScript 全量类型检查 | BLOCKED | 当前执行环境 npm 网络访问失败 |
| QA-03 | 真机浏览器 QA / 安全渗透测试 | BLOCKED | 待预览部署与测试账号 |
| OPS-01 | 境内服务器/DB/对象存储/视觉模型连接 | BLOCKED | 需要云账户与 API 密钥 |
| OPS-02 | ICP + 公安备案 / 上线合规 | BLOCKED | 需要运营主体、域名与备案审核 |
| OPS-03 | 登录集中式风控 + WAF / 监控 / 备份 | TODO | 公共发布前阻断项 |
| OPS-04 | 关闭 Supabase 公共注册，设计初始密码修改/重置 | TODO | 公共发布前阻断项 |
| L2-01 | 知识点规范化与知识迁移实验 | TODO | 积累真实答题序列后 |
| L2-02 | 变式题生成及独立质量校验 | TODO | 先有人工评分数据集 |

## 上线 Gate

在所有公共发布阻断项通过前，不得通过公网向未成年人开放服务；可在受控的测试环境使用合成数据检查 UI 与 API。
