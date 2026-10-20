# Issue tracker: GitHub

任务与规格保存在 hilt21/AI-MLS 的 GitHub Issues，使用 gh CLI 操作。
操作前核实 git remote；在仓库外运行时显式指定 --repo hilt21/AI-MLS。

## 常用操作

- 读取：`gh issue view <number> --comments`
- 列表：`gh issue list --state open --json number,title,body,labels`
- 创建：`gh issue create --title "..." --body-file <file>`
- 评论：`gh issue comment <number> --body-file <file>`
- 标签：`gh issue edit <number> --add-label "<label>"`
- 移除标签：`gh issue edit <number> --remove-label "<label>"`
- 关闭：`gh issue close <number>`

多行正文写入临时文件，再通过 --body-file 提交。
读取任务时同时检查正文、标签和相关评论。

## 技能约定

技能要求“发布到 issue tracker”时，创建 GitHub Issue。
技能要求“读取相关 ticket”时，读取对应 Issue 及评论。
配置本文件不代表授权创建、评论、关闭 Issue 或修改标签；根据当前任务授权执行外部写入。

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub 的 Issue 与 PR 共用编号。编号类型不明确时，先解析实际类型，再使用对应命令。

## Wayfinding

使用 wayfinder 时，以带 `wayfinder:map` 标签的 Issue 保存决策、笔记和待查问题，任务使用关联子 Issue。
优先使用 GitHub 原生子 Issue 与依赖关系；不可用时，在 map 中使用任务列表，并在子任务正文记录 `Part of #<map>` 和 `Blocked by: #<number>`。
领取前检查阻塞任务与 assignee；按 map 顺序选择未被领取且无开放阻塞项的任务。领取时分配给执行者。
解决后，将结果与证据写入任务，关闭任务，并在 map 的决策记录中添加摘要及链接。
