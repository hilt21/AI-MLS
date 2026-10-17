# 设计数据契约和接口 v0.1

### 隔离原则

除登录和服务端 Worker 外，所有请求必须在有效的 Supabase cookie Session 下执行。API 始终重新校验 `auth.getUser()`，再以 `owner_id` 查询。Supabase 表的学生访问由 RLS 仅授予 SELECT；带管理员密钥的写操作只在服务器完成。

### POST `/api/auth/login`

输入 `{username, password}`，username 只接受小写 3~30 位 `a-z0-9_-`；服务器连接所配置的 `STUDENT_LOGIN_DOMAIN`。输出 `{ok:true}`，设置 cookie；失败使用 401 且不透露用户名是否存在。

### POST `/api/upload`

`multipart/form-data`：`photo`，最大 6MB，验证真实图片 magic bytes，只允许 JPEG/PNG/WebP；最多每日 20 张；上传成功返回 HTTP 202：

```json
{"jobId":"<uuid>","questionId":"<uuid>","status":"queued"}
```

入口应经 CSRF 同源校验。与后台 `ingestion_jobs` 独立。持久化后，即使调用方离线，Worker 仍可重试任务。

### GET `/api/jobs` 和 GET `/api/questions`

仅返回本人最近的作业及题目。题目包括 `status=draft|confirmed`。原图不直接返回公开存储 URL。

### GET `/api/questions/{id}/image`

持会话用户若拥有该题，则从私有 Storage 下载原图，返回 `Cache-Control: private, no-store`。不存在或不属于自己的 ID 返回 404。

### PATCH `/api/questions/{id}`

输入字段：`title`、`question_markdown`、`solution_markdown`、`correct_answer`、`student_wrong_answer`、`stage` (`primary|junior`)、`grade`（小学 1–6 / 初中 7–9）、`knowledge_points`（最多 12 项）、`error_type`、`image_required`。

保存前校验 Zod。将 draft 改为 confirmed，首次创建 `review_states`。已确认题再次修改时保留已产生的作答/复习记录。数据库触发器追加 `question_versions` 快照。

### GET `/api/reviews`

获得已确认且 `due_at <= now()` 的到期项目，最多 30 个：`question_id,version,due_at,question`。

### POST `/api/reviews/submit`

```json
{
  "questionId":"<uuid>",
  "submissionId":"<uuid>",
  "rawAnswer":"x=2,3",
  "selfReportCorrect":true,
  "usedHint":false,
  "selfRating":"good"
}
```

- 只接受有权访问且已经 confirmed 的题目；不能提前复习。
- 映射：独立答错/用了提示 -> Again；独立答对按 Again/Hard/Good/Easy 自评。
- 服务端调用 `ts-fsrs`，数据库用单事务函数 `commit_student_review` 提交。
- `submissionId` 去重、旧 version 409；每次成功追加 `attempts` 日志，包括 `previous_card`、`next_card`、`algorithm_version`。
- 输出 `{ok:true,duplicate:boolean,due_at:ISO8601,version:integer}`。

### GET `/api/progress`

返回 `questionCount`,`confirmedCount`,`reviewCount`,`independentCount`,`dueCount`,`rateSource=self_report`。只统计近期最多 100 次记录，不声明客观知识点掌握率。

### POST `/api/internal/process-job`

仅在后台任务调度器携带 >=32 字符 `WORKER_SECRET` 的 Bearer 密钥时调用；Worker 原子领取任务，下载图片，调用已配置的 VLM，严格验证 JSON 并保存在 draft。

### 模型返回的核心 Schema

```json
{
 "title":"一元二次方程求解",
 "question_markdown":"求 $x^2-5x+6=0$ 的根。",
 "solution_markdown":"分解因式：$(x-2)(x-3)=0$。",
 "correct_answer":"x=2 或 x=3",
 "student_wrong_answer":"",
 "stage":"junior",
 "grade":8,
 "knowledge_points":["因式分解","一元二次方程"],
 "error_type":"unknown",
 "image_required":false,
 "recognition_notes":""
}
```

该 JSON 表示待核对的模型输出。AI 不得猜测学生真实错因。

### 任务状态

```text
queued -> processing -> done
                 |-> queued (recoverable failure, remaining attempts)
                 |-> failed (>=3 attempts)
```

10 分钟以上的 processing job 可被重新领取。所有任务状态是后台专有写入，学生仅查看本人状态。
