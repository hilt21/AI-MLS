# AI-MLS

## 开始任务

先读 [README](README.md)，确认当前版本、开发环境和验证边界。

- 修改云端业务、认证或数据访问前，读[云端架构](docs/CLOUD_ARCHITECTURE.md)，区分当前契约、产品目标和历史方案。
- 涉及构建、发布、环境绑定、迁移或恢复时，读[持续开发与维护](docs/DEVELOPMENT.md)，遵循当前阶段的授权与验证条件。
- 涉及正式学生上线时，同时核对[产品规格](docs/PRODUCT_SPEC.md)中的账户、部署地区和上线验收要求。
- 报告验证结论前，读[云端 QA](docs/CLOUD_QA.md)，区分历史记录、模拟测试和线上证据。

## 开发与验证

先明确可检查的验收条件，再检查相关实现、接口和测试。保持改动范围与任务一致，复用现有模式。
从 package.json 获取命令，从 README 获取环境准备步骤；按改动运行相关验证。
修复 bug 时，优先用适合现有测试体系的回归测试复现问题。
完成时报告改动、验证结果和剩余限制；只有对应证据支持时才声称通过。

## Agent skills

### Issue tracker

任务与规格使用 hilt21/AI-MLS 的 GitHub Issues。见[操作约定](docs/agents/issue-tracker.md)。

### Triage labels

使用五个默认 triage 标签。见[角色映射](docs/agents/triage-labels.md)。

### Domain docs

采用 single-context。探索领域术语或架构决策前，按[读取规则](docs/agents/domain.md)读取相关文档。
