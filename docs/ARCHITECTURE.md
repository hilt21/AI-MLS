# 结构与依赖 | v0.1

```text
学生手机/浏览器
    └── Next.js 响应式 Web + API Route（仅学生）
         ├── Supabase Auth（自托管大陆实例；先线下核验、后台发放账号）
         ├── Postgres + RLS：questions、review_states、attempts、ingestion_jobs
         ├── Private Storage：<user_uuid>/<random_uuid>.jpg/png/webp
         ├── TS-FSRS：server-only update + submit_review 原子 RPC
         └── Worker-authenticated API：claim_ingestion_job 原子领取
               └── VLM Gateway：中国大陆受评估模型部署/接口
```

## 两个边界

### AI 识别边界

`ingestion_jobs: queued -> processing -> done` 或 `(retry queued) -> failed`。

原图按权限读取。模型仅输出数据，所有字段经 Zod 校验。草稿只在学生人工确认后升级为正式错题。模型没有数据库写权限，也不能直接修改 FSRS 状态。

### 学习状态边界

`review_states` 为当前状态；`attempts` 是不可覆写证据。

`submit`：校验学生身份及题目所属 -> 验证当前到期时间 -> 标准化自评 -> `fsrs.next(...)` -> `commit_student_review` RPC 在数据库单一事务写入 attempt 和 review_state。`submission_id` 防重复；`version` 防旧状态覆盖。

该版本的 `evidence_type` 固定为 `self_report`。多道题的知识点掌握概率尚未建模。

## 大陆部署

1. 申请合规的境内云账户和可备案资源，指定备案主体、域名及所需 ICP / 公安备案手续。
2. 境内 ECS / CVM 部署 Node.js 服务与独立后台任务进程；可先共机试点，但生产应隔离权限和备份。
3. 依据 Supabase 官方 Docker 自托管指南部署数据库、Auth、Storage；建议小型生产 >=8GB 内存。不要将 Supabase 本地 CLI 开发环境公开暴露。
4. 区分公开发布密钥与服务端 Secret；后者仅注入服务端进程。务必校对镜像下载、备份、TLS、日志审计、补丁维护。
5. 视觉模型优先采用阿里云 Model Studio 北京区域受支持的视觉模型；必须确认模型/工作区区域、数据策略和费用。模型名称使用控制台实际开通的型号。
6. 上线需网络层限制 `/api/internal/process-job` 和后台管理员功能访问、WAF 登录限流与安全日志脱敏；反向代理透传真实 TLS Origin。

## 未来演进

- S3-compatible OSS/COS 对象存储适配，不改变 `source_path` 的用户分区契约。
- 正式队列（pgmq/BullMQ）和独立 Worker，替换简单轮询 API，不改变作业状态。
- 将知识点从 `knowledge_points[]` 演进为 `skills` / `question_skills` 和 `skill_attempts`。
- 独立判分服务、变式题质量评估和人工内容审核。
- 真实大规模学习数据足够后引入 BKT；不把 FSRS Retrievability 解释为知识掌握率。

## 安全与技术债（上线前必须完成）

- 登录按账号及可信代理 IP 的集中式限流；强制初始密码更换和安全重置。
- 防范公开存储桶、公共外链和不可信 Markdown 图片链接；防止 AI 返回指令污染系统。
- 完整账号删除与文件 orphan 回收，包括异步 Worker 并发清理和备份策略。
- 批量任务和登录压测、CSRF/Origin 策略通过代理后的正确性验证、真实手机 QA。
- 监护人授权的真实性核验、儿童个人信息专门规则、服务协议、数据最小化及保留周期。
