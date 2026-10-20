# Domain docs

采用 single-context：根目录 GLOSSARY.md 保存领域术语，docs/adr/ 保存架构决策。

## 读取规则

探索代码前，若 GLOSSARY.md 存在，先读取它；再读取 docs/adr/ 中与当前任务有关的决策。
若以后存在 GLOSSARY-MAP.md，先按其指引读取与任务相关的上下文词汇表与 ADR。
文件不存在时继续任务，不预先创建空文件。领域术语或决策得到明确结论后，再按需通过 domain-modeling 技能记录。

## 使用规则

Issue、实现、测试和文档使用词汇表定义的术语。
新方案与既有 ADR 冲突时，明确指出冲突并提出处理建议，经确认后更新决策。
