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
pnpm dlx graphwork
```

该命令会启动本地 Workbench、自动打开浏览器，并把工作区保存在当前目录的
`.graphwork` 下。如果希望直接在终端体验完整的零密钥工作流：

```bash
pnpm dlx graphwork demo
```

从源码参与开发：

```bash
pnpm install
pnpm demo
```

Demo 会并行运行两条证据分支，在 Join 节点汇合，通过质量检查和人工审批，
生成最终交付物，并将结果投影成 7 个上下文对象和 9 条带来源关系。

测试人工暂停：

```bash
pnpm dlx graphwork demo --pause
```

## 使用 Workbench 界面

```bash
pnpm workbench
```

然后打开 `http://127.0.0.1:4311`。界面可以编辑项目目标、场地背景、约束和带
定位的来源证据，也可以直接编辑工作流本身：

1. 在 **Packs** 中安装并打开内置的 Industry Pack。
2. 从左侧节点库拖入节点，在画布上移动、连线或删除节点。
3. 在右侧检查器修改节点名称、处理器、状态读写范围、配置和执行策略。
4. 在 **Input** 中载入 Pack 样例或编辑输入，然后运行经过保存和验证的真实执行图。
5. 在人工节点批准或退回，并在底部查看事件、状态、Markdown 交付物和上下文摘要。
6. 在 **Runs** 中回看历史运行，在 **Context** 中检查对象、关系和完整来源信息。
7. 在 **Packs** 中选择 **Import .gpack**，检查兼容范围、权限和 SHA-256 指纹后，
   显式信任并安装制品。

图草稿、已安装 Pack、当前 Pack、运行记录和人工检查点会持久化到本地
`.graphwork/workbench.json`。Architecture 与 Research 是内置 Pack；可信的
`.gpack` 可以直接从 Packs 页面导入，也可以通过 CLI 安装，并保存在
`.graphwork/packs`。

## 创建 Industry Pack

```bash
pnpm graphwork pack init customer_success
pnpm graphwork pack validate packs/customer_success/src/index.ts
pnpm graphwork pack inspect packs/customer_success/src/index.ts
pnpm graphwork pack test packs/customer_success/src/index.ts
pnpm graphwork pack run packs/customer_success/src/index.ts --set "topic=renewal risk"
```

把同一个 Pack 打包、安装并按 ID 运行：

```bash
pnpm graphwork pack build packs/customer_success/src/index.ts --output customer_success-0.1.0.gpack
pnpm graphwork pack inspect customer_success-0.1.0.gpack
pnpm graphwork pack install customer_success-0.1.0.gpack --trust
pnpm graphwork pack run customer_success --installed --set "topic=renewal risk"
```

不同版本会并排保存，并支持激活、回滚和卸载。完整协议与安全边界见
[`.gpack` 格式说明](docs/PACK_FORMAT.md)。

组织也可以通过 Ed25519 签名的 HTTPS Registry 发布 Pack。发布者公钥由使用方
独立配置，签名索引会在下载前绑定 Pack 身份、校验和、兼容范围与权限：

```bash
pnpm graphwork pack registry verify https://packs.example.com/registry.json \
  --key acme.release=registry-public.pem
pnpm graphwork pack registry install customer_success@0.1.0 \
  --registry https://packs.example.com/registry.json \
  --key acme.release=registry-public.pem
```

安装的第三方 Pack 处理器和上下文投影器会在受限制的子进程 Worker 中执行，
不会加载进 Workbench 主进程。详细边界见
[Registry 信任与 Worker 隔离](docs/TRUST_AND_ISOLATION.md)。

如需在界面中浏览已验签的目录，请在 `.graphwork/trust.json` 配置 Registry 地址
和发布者公钥路径，重启 Workbench 后打开 **Packs → Signed Registries**。具体格式见
[Workbench Registry 配置](docs/TRUST_AND_ISOLATION.md#workbench-registry-catalog)。
参考 Registry 的 Pack 构建、签名、验签与 GitHub Pages 发布流程见
[Registry 发布指南](docs/REGISTRY_PUBLISHING.md)。

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

零安装 npm 分发包的构建、完整烟测和发布门禁见
[npm 分发指南](docs/NPM_DISTRIBUTION.md)。

本项目采用 [MIT License](LICENSE)。
