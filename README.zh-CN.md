# Graph Native Workbench

**把企业 SOP 变成可执行、可检查的工作图，再把证据、决策和交付物沉淀为组织上下文。**

[English](README.md) · Pre-alpha · MIT

Graph Native Workbench 是一个面向复杂行业工作的开源 Graph-native
Workbench。它把 Agent 执行图与组织上下文图连接起来，使企业能够把自己的
SOP、角色、工具、知识、质量标准和交付物封装成可安装的 Industry Pack。

## 核心模型

- 执行图负责 Agent、函数、工具、路由、人工审批和质量门。
- 上下文图保存来源、证据、决策、版本和交付物。
- Industry Pack 定义行业对象、角色、工具、工作流和评估标准。
- 内核提供通用执行与治理机制，不包含特定行业语义。

## 快速体验

需要 Node.js 24+ 和 pnpm，不需要账号、数据库或模型密钥：

```bash
pnpm install
pnpm demo
```

Demo 会并行运行两条证据分支，在 Join 节点汇合，通过质量检查和人工审批，
生成最终交付物，并将结果投影成 7 个上下文对象和 9 条带来源关系。

测试人工暂停：

```bash
pnpm demo:pause
```

## 使用 Workbench 界面

```bash
pnpm workbench
```

然后打开 `http://127.0.0.1:4311`。界面可以编辑项目目标、场地背景、约束和带
定位的来源证据，运行真实的 Architecture Pack，在人工评审节点批准或退回，
并预览中文概念设计简报及其“来源—研判—方向—交付物”追溯链。

## 创建 Industry Pack

```bash
pnpm graphwork pack init customer_success
pnpm graphwork pack validate packs/customer_success/src/index.ts
pnpm graphwork pack inspect packs/customer_success/src/index.ts
pnpm graphwork pack test packs/customer_success/src/index.ts
pnpm graphwork pack run packs/customer_success/src/index.ts --set "topic=renewal risk"
```

生成的 Pack 可以立即运行，不需要修改内核。详细内容见
[产品宪章](docs/PRODUCT_CHARTER.md)、[Pack 开发指南](docs/PACK_AUTHORING.md)和
[路线图](ROADMAP.md)。

体验首个深度行业 Pack 及其两组零密钥黄金样例：

```bash
pnpm graphwork pack inspect packs/architecture/src/index.ts
pnpm graphwork pack test packs/architecture/src/index.ts
pnpm demo:architecture
```

Architecture Pack 会把项目目标、场地条件、约束和来源证据推进为两套概念方向，
经过质量检查与人工评审后生成带来源清单的概念设计简报。

需要保存并恢复人工审批流程时：

```bash
pnpm graphwork pack run packs/research/src/index.ts --set "goal=Evaluate a workflow" --database runs.sqlite
pnpm graphwork pack resume packs/research/src/index.ts --run <run-id> --database runs.sqlite --decision approval=true
```

本项目采用 [MIT License](LICENSE)。
