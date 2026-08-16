# Graph Workbench 全面评审报告

评审日期：2026-08-15 · 评审对象：`main` @ `794905f` · 版本 0.5.0
实施状态更新：2026-08-16

---

## 实施进度

方向已定：**收缩到软件交付一个行业做深**（§9、§10）。以下为已落地项，均通过 lint / typecheck / 184 单测 / 5 项浏览器 E2E。

| 编号 | 项目 | 状态 |
| --- | --- | --- |
| P1.1 | GitHub 连接器（5 个工具接通真实 API、真幂等、失败分类、限流处理） | ✅ 已完成 |
| P1.5 | Pack 触达程度诚实标注（README / ROADMAP） | ✅ 已完成 |
| P2.1 | 字号体系重建（消除全部 ≤10px）、暗色模式、CSS token 分层 | ✅ 已完成 |
| P2.3 | ESLint 类型感知规则接入 CI 与 `release:check` | ✅ 已完成 |
| — | 工具密钥边界接线（此前 `SecretProvider` 从未被提供） | ✅ 已完成 |
| — | 修复 Workbench HTTP 处理器的未捕获 rejection（会终止进程） | ✅ 已完成 |
| P1.3 | Workbench 运行持久化迁移到 SQLite（workspace 文档降为 formatVersion 4 元数据） | ✅ 已完成 |
| P1.4 | 首跑埋点 / 反馈通道 | ⬜ 未开始 |
| P3.1 | 身份绑定 GitHub OAuth、角色映射 CODEOWNERS | ⬜ 未开始 |
| — | 签名校验的 webhook 入口（构建提交交付请求 → 同一批人工门） | ✅ 已完成 |

**关于 P1.3 的实现说明**：没有复用内核的 `SQLiteRunStore`——它只建模 `RunStore` 接口那部分，而 `StoredRunSession` 还持有 `packId`、图定义、产物和上下文快照。因此新增了应用层的 `run-session-store.ts`（一行一个会话），workspace 文档降级为 `formatVersion 4` 的纯元数据，旧文档里的会话在首次打开时一次性搬运（搬运前备份原文档）。回归护栏是一条直接测量写放大的用例：**跑完 4 次运行后 `workbench.json` 的字节数与跑完 1 次时完全相同**。

---

## 0. 核验基线（本报告的事实来源）

所有结论建立在实际执行与逐文件阅读之上，而非仅读 README：

| 核验项 | 命令 / 方法 | 结果 |
| --- | --- | --- |
| 依赖安装 | `pnpm install --frozen-lockfile` | 通过 |
| 类型检查 | `pnpm typecheck` | 0 error |
| 单元/集成测试 | `pnpm test` | 28 个文件 / 161 个用例全部通过（17.5s） |
| 代码规模 | `git ls-files` + `wc -l` | 248 个受控文件；TS/TSX/CSS 共 25,116 行；Markdown 3,154 行 |
| 开发历史 | `git log` | 30 次提交，2026-08-04 → 2026-08-15（12 天），实为单人开发（`AngryKarl` 与未配置身份的 `你的名字` 为同一人）+ dependabot |

> 未执行：`pnpm test:e2e`（Playwright，需下载浏览器）、`pnpm dist:pack`、PostgreSQL 相关用例的真实数据库路径。这些在 CI 中有对应 job，但本次未本地复现，相关结论以「CI 声明」而非「已验证」标注。

---

## 1. 总评

**一句话结论：这是一个概念清晰、工程素养明显高于同龄开源项目的「治理运行时」，但它目前证明的是「机制完备」，还没有证明「有人用它完成过真实工作」。**

| 维度 | 评分 | 一句话 |
| --- | --- | --- |
| A1 技术栈 | A− | 现代、克制、依赖极少；缺 lint 层 |
| A2 内核架构 | A− | 双图分离是真实差异化；持久化层是明显短板 |
| A3 实用性 | C+ | 全部连接器均为硬编码桩，零真实系统集成 |
| A4 北极星目标 | B− | 叙事收敛，但成功标准不可证伪、无度量 |
| A5 UI/UX | C+ | 信息架构好，可读性与可访问性差 |
| A6 工程与治理 | B | CI 强于同龄项目；文档承诺远超已验证证据 |

---

## 2. A1 技术栈

### A1.1 值得肯定

- **TypeScript 配置是我见过的开源项目里最严的档位之一**：`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 同时开启（[tsconfig.json](tsconfig.json)）。后两个选项绝大多数项目不敢开，代码却能零 error 通过——这是真实的质量信号，不是配置摆设。
- **运行时依赖极度克制**：`contracts` 只依赖 `zod`；`core` 只依赖 `pg` + `pg-boss`；没有 Express、没有 ORM、没有状态管理库。持久化用 Node 24 内置的 `node:sqlite`（[sqlite-run-store.ts:1](packages/core/src/sqlite-run-store.ts:1)），队列直接复用 `pg-boss` 而不是自造租约协议——「不重复造轮子」这条执行得很好。
- **分层干净**：`contracts → core → pack-sdk → packs → apps`，依赖方向单一，没有回环。
- **分发方案务实**：esbuild 打成单文件 + `npx graph-workbench` 零安装入口（[apps/distribution](apps/distribution/package.json)）。

### A1.2 问题与建议

**A1.2.1 完全没有 lint / format 工具（高优先级）**
仓库中不存在任何 ESLint / Prettier / Biome 配置，CI 也没有 lint 步骤（[ci.yml](.github/workflows/ci.yml)）。当前唯一的风格约束是 `tsc`。单人开发时靠自律可以维持，一旦有第二个贡献者，代码风格与低级缺陷（未使用变量、`any` 逃逸、`floating promise`）会立刻失控。而 CONTRIBUTING 正在公开征集贡献者——这是时间敏感的缺口。

> 建议：接入 `typescript-eslint` 的 `strictTypeChecked` + `no-floating-promises`，CI 加 `pnpm lint`。

**A1.2.2 Node 24 门槛**
`engines: >=24`。这个要求有真实技术理由（`node:sqlite` 的 `DatabaseSync`、`--permission` 权限模型），不是随意抬高。但代价是把仍在 Node 20/22 的企业用户直接挡在门外，而这恰恰是「行业工作治理」的目标人群。

> 建议二选一：(a) 在 README 显著位置解释为什么必须 24（现在只有一行 "Requires Node.js 24+"，没有理由）；(b) 为 22 提供 `better-sqlite3` 回退适配器，把门槛降到 22。

**A1.2.3 手写 HTTP 路由已到复杂度上限**
[server.ts](apps/workbench/src/server.ts) 用 400 余行 `if (method && pathname.match(...))` 链条实现全部 API。目前还能读，但每加一个端点就线性变长，且路由与鉴权、错误处理耦合在同一函数里。不必引入 Express，但可以抽出一张 `[method, pattern, handler]` 路由表。

**A1.2.4 `@graph-workbench/core` 的 `exports` 直指 `./src/index.ts`**
包被标记 `"private": false` 却导出 TS 源码。若将来真的发布到 npm，消费者会拿到未编译的 `.ts`。目前只有 `apps/distribution` 实际发布，暂无影响，但属于待引爆的配置。

---

## 3. A2 内核架构

### A2.1 双图模型是真实的差异化

「执行图负责怎么做，上下文图负责什么是真的、为什么可信」这个切分不是包装话术——它在代码里是有边界的：投影器（projector）只在运行进入已批准状态后才把运行态转成带 run/node/actor 溯源的领域对象（[WHY_TWO_GRAPHS.md](docs/WHY_TWO_GRAPHS.md)、各 Pack 的 `projector.ts`）。「被拒绝的工作不会悄悄变成组织事实」这条设计约束，是多数 workflow 工具没有想清楚的地方。

同样值得肯定的内核细节：

- **并行写冲突显式报错**（[runtime.ts:278](packages/core/src/runtime.ts:278)）：同批次两个节点写同一字段直接抛错，而不是后写覆盖。这是「显式失败优于静默」的正确实现。
- **工具调用五重校验 + 审批与输入摘要绑定**（[runtime.ts:867-909](packages/core/src/runtime.ts:867)）：审批 ID 由 `runId + nodeId + roleId + toolId + SHA-256(input)` 派生，改了输入就得重新审批。这是真治理，不是弹窗确认。
- **容器隔离参数达到生产水准**（[isolation.ts:103-122](packages/pack-sdk/src/isolation.ts:103)）：`--read-only`、`--cap-drop=ALL`、`--no-new-privileges`、非 root uid、pids/memory/cpu 限制、`--network=none` 默认。并且代码里明确写着「Node 的权限模型不是恶意代码沙箱」——这种诚实很少见。

### A2.2 缺陷（按严重度排序）

**A2.2.1 Workbench 的持久化层会随使用量退化（严重）**

整个工作区——所有运行、每一条事件、所有产物、上下文快照——存在**单个 `workbench.json`**里，且每次变更**同步全量重写**：

```
apps/workbench/src/workspace-store.ts:236-242   // JSON.stringify(整个 state) → 写 .tmp → rename
apps/workbench/src/service.ts:745               // runs: { ...state.runs, [runId]: session }
```

三个后果：
1. **写放大**：第 100 次运行的第 1 条事件，会导致前 99 次运行的完整事件流被重新序列化写盘。成本随历史线性增长。
2. **内存常驻**：`snapshot()` 每次 `structuredClone` 全量状态。
3. **并发竞态**：临时文件名固定为 `${dataFile}.tmp`，两个写入交错会互相截断。

讽刺的是，内核**已经有** `SQLiteRunStore`（[sqlite-run-store.ts](packages/core/src/sqlite-run-store.ts)，CLI 在用），Workbench 却没接。

> 建议：Workbench 的 run/event 走 `SQLiteRunStore`，`workbench.json` 只保留工作区元数据（installedPacks、drafts、actors、modelProvider）。这是一次范围可控的重构，且已有 store 接口和测试。

**A2.2.2 内核对节点种类是硬编码的，与「Pack 是扩展边界」的宣称存在张力（中等）**

[runtime.ts](packages/core/src/runtime.ts) 1066 行里，`executeNode` / `invokeNode` 用一连串 `if (node.kind === ...)` 分派 12 种节点。新增节点类型必须改内核——而项目的核心主张是「不改内核即可扩展」。目前 12 种节点已经覆盖得不错，短期不痛；但这个文件同时承担调度、节点分派、工具治理、审批、检查点五件事，是全仓库最大的单文件。

> 建议：抽出 `NodeExecutor` 注册表（`kind → executor`），把工具治理（`invokeTool`，130 行）拆到 `tool-governance.ts`。这不改变行为，只降低后续每一次改动的风险面。

**A2.2.3 本地角色治理是装饰性的（中等，但直击价值主张）**

身份从顶栏下拉框选择（[App.tsx:481](apps/workbench/src/client/App.tsx:481)），无任何认证；且 `workspaceRole === 'owner'` 可绕过所有角色校验（[runtime.ts:1014](packages/core/src/runtime.ts:1014)）。文档在 [RUNTIME_ADAPTERS.md:135](docs/RUNTIME_ADAPTERS.md) 诚实地说明了这一点（"identity 是授权输入，不是认证机制"），Roadmap 也把「绑定生产认证」列为 1.0 前未完成项。

问题在于：**产品最核心的卖点是「可问责的人工门」**，而在唯一能开箱运行的形态（本地 Workbench）里，这个卖点是不可信的。任何人切换下拉框就能以任意角色批准。演示时很容易被一句「那我直接选 owner 呢」击穿。

> 建议：这是 P3 的第一件事——至少接一个 GitHub OAuth，或提供「审批需二次确认 + owner 绕过写入独立审计事件」的中间态。

**A2.2.4 `loop` / `map` 子图不能挂起（已知约束，但值得重新排期）**

文档明确写了：loop 和 map 的子图必须无挂起地完成（[PACK_AUTHORING.md:155](docs/PACK_AUTHORING.md)）。也就是**迭代过程中不能有人工门**。但「对 N 个条目逐条人工审批」恰恰是行业工作里最常见的形态之一（逐个分区批准回填、逐台机器人批准派单）。当前只能把等待挪到 map 之外，绕过而非解决。

---

## 4. A3 实用性（本报告最尖锐的一节）

### A3.1 现状：6 个行业 Pack，0 个真实连接器

全仓库除了模型调用（`model-providers.ts`）和 Registry 下载（`registry.ts`）之外，**没有任何出站网络请求**。所有 Pack 的工具适配器都是硬编码返回值。以旗舰 Pack 为例（[packs/software-delivery/src/tools.ts](packs/software-delivery/src/tools.ts)）：

```ts
repository_read:   commit_sha: '0000000000000000000000000000000000000000'
deployment_execute: { deployment_id: referenceId('deployment', key), status: 'accepted' }
```

`change_request_upsert` 返回的 URL 是 `reference://change-request/...`——一个不存在的协议。

README 对此是诚实的（"deterministic reference implementations... production teams replace them"）。但诚实不改变一个事实：**目前这个项目无法接管任何一件真实工作**。它是一个高保真的可执行样例集合，不是可采用的产品。

### A3.2 判断：广度投入与深度投入严重错配

12 天里产出了 6 个标准行业 Pack + 3 个示例 Pack，覆盖软件交付、MLOps、安全响应、量化金融、医疗诊断、机器人调度。每一个都有 manifest、handlers、projector、fixtures、README、gallery 截图和测试。

这是巨大的工作量，但它增加的是**叙事资产**（"看，六个行业都能建模"），而不是**采用资产**（"我今天就能用它管我的发布流程"）。一个潜在用户打开项目，跑完 60 秒演示，会得到一个正确的印象：**很完整，但和我的系统没有一根线连着。**

更实际的风险：六个行业各一个 stub，等于对六个领域各欠了一笔集成债。任何一个领域的真实用户来了，都会发现自己是第一个。

### A3.3 建议：砍广度，换一条真线

**如果只能做一件事，就是把 software-delivery 的 5 个 stub 工具换成真的。**

具体路径：

1. **官方 `@graph-workbench/connector-github`**：`work_item_read`（Issues API）、`repository_read`（真实 commit SHA）、`change_request_upsert`（创建 PR，用现有 `idempotency_key` 作幂等）、CI check 状态查询。带上真实 token 管理、速率限制、重试、错误分类。
2. **受治理的通用 `http_request` 工具**：允许列表 + SSRF 防护（禁私网段）+ 风险等级映射（GET→read，其他→write），让用户不写代码就能接自己的内部系统。这是把「零集成」变成「任意集成」的最短路径。
3. **把其余 5 个行业 Pack 明确降级标注**为 "reference model, no connector"，在 Pack Gallery 里用不同视觉区分「可接生产」与「仅供建模参考」。诚实的降级比含混的并列更能建立信任。

验收标准：**一个仓库外的人，用自己的真实 GitHub 仓库，跑完 issue → 并行检查 → 双人审批 → release，导出审计包。** 这一件事做成，比第七个行业 Pack 有价值一个数量级。

---

## 5. A4 北极星目标

### A4.1 现状诊断

Product Charter 的成功测试是定性的：「新用户能安装、无 key 运行、看到每个节点为什么运行、在人工门暂停、恢复、拿到可追溯产物」。Roadmap 的 0.2 / 0.4 / 0.5 / 0.6 里程碑几乎全部勾选。

但「1.0 之前」的 6 项里，5 项未完成，而这 5 项恰好**全是外部证据类**：

- [ ] 完成一次真实团队试点（共享 PostgreSQL）
- [ ] 工作区身份绑定生产认证授权
- [ ] 发布 Pack 契约的兼容性保证
- [ ] **度量首跑成功率与 Pack 编写完成时间**
- [ ] 独立安全审查

这暴露了真正的问题：**项目当前实际运行的北极星是「机制完备度」——一个可以由自己单方面推进、且永远推不完的指标。** 12 天从 0.2.0 走到 0.5.0，勾掉了 30 多个机制项，但外部证据仍然是零。

### A4.2 建议：换一个可证伪的北极星

**主指标建议：第 7 天仍在使用的工作区数（W1 workspace retention）。**

理由：它同时否决了三种自欺——「star 很多但没人跑」「跑了一次觉得好玩但没第二次」「文档很全但装不上」。对一个 0.5 alpha，这个数从 0 到 10 就是决定性进展。

早期还测不到留存时，用前置指标：**首跑到达 Outcome 的转化率**（打开 Workbench → 看到产物并点开 "Explore why" 的比例）。

**两条护栏指标：**
- `pack init` → `pack test` 通过的耗时中位数（Pack 作者体验，Roadmap 已列但未做）
- 首跑失败率（按错误分类）

**最小埋点方案**（不违背本地优先原则）：默认关闭、首次启动显式询问的匿名计数，只上报 4 个事件（首跑完成、审批完成、Pack 安装、第二次运行）。若不愿做遥测，退而求其次：CLI 加 `graph-workbench feedback` 命令 + Discussions 模板，把「主动收集」变成产品的一部分而非期待。

顺带：`FirstRunJourney` 承诺 "60-second guided run"，完成后应显示**实际耗时**——既兑现承诺，又天然是首跑指标的埋点。

### A4.3 定位收敛问题

12 天里品牌名改了两次：`graph-native workbench` → `Graphwork` → `Graph Workbench`。README 的主标语也从通用的「治理 AI 工作流」收敛到具体的「把一次软件变更从 issue 治理到 release」——**这次收敛是正确的**，具体的旗舰场景远好过抽象的平台叙事。

> 建议：冻结命名与这一句定位至少 90 天。定位反复变更对早期项目的伤害大于任何单个功能的缺失。

---

## 6. A5 UI/UX

### A5.1 做得好的部分

- **信息架构合理**：Editor / Runs / Context / Team / Models / Packs 六个视图，映射清晰。
- **首跑引导直击要害**：[FirstRunJourney.tsx](apps/workbench/src/client/FirstRunJourney.tsx) 的四步（样例就绪 → 运行 → 审阅决策 → 复用产出）状态随真实运行事件推进，不是静态装饰。
- **节点视觉语法有真实区分**：Agent / Human / Router / Wait / Loop / Map / Escalation / Compensation 各有形状、边框样式与配色（router 是旋转 45° 的菱形，wait 是虚线，恢复类节点用暖色虚线）。语义缩放（`zoom-compact` / `zoom-overview`）在大图时隐藏细节——这是专业级图形编辑器的做法。
- **保存状态机完整**：`saved / saving / dirty / invalid` + 900ms 防抖自动保存 + 50 步撤销重做 + 保存时的版本号竞态检查（[App.tsx:248-267](apps/workbench/src/client/App.tsx:248)）。

### A5.2 问题（全部可直接修）

**A5.2.1 字号系统性偏小（最影响第一印象）**
`styles.css` 中有 **55 处 `font-size ≤ 9px`**，其中 **10 处是 7px**（`.pack-graph-facts`、`.node-io`、`.pack-boundary-node small` 等）。7–9px 在 100% 缩放的 1080p 屏上接近不可读，也低于常规可访问性预期（正文 ≥12px、辅助信息 ≥11px）。

这会造成一个具体的商业后果：**截图在 README 和社交预览里看起来像「密密麻麻的仪表盘」而不是「清晰的治理工具」**，而截图是绝大多数人对本项目的第一次也是唯一一次接触。

> 建议：建立 5 级字阶（12/13/14/16/20px），全部改用 `rem`，最小值不低于 11px。信息密度可以通过间距和分组降低，不该靠缩字号。

**A5.2.2 无暗色模式**
`prefers-color-scheme` 出现 0 次。对开发者工具类产品，这是基本预期而非加分项。现有 CSS 变量（`--ink` / `--surface` / `--line` 等）已经具备条件，成本主要在那 **109 个散落在组件规则里的硬编码十六进制色值**（`#8eadeb`、`#dda654`、`#74bda5`……）。

**A5.2.3 CSS 可维护性已经触底**
238 行文件里，**最长单行 1575 字符**，多条规则压在一行。设计 token 与组件样式混在同一文件，没有分层。当前只有作者本人能安全修改。

> 建议：拆为 `tokens.css`（含亮/暗两套）+ 按组件切分；或直接上 CSS Modules。配合 A5.2.1/A5.2.2 一次做完。

**A5.2.4 键盘可达性不足**
全部客户端组件加起来只有 20 余处 aria 属性。画布节点选择、审批按钮、Pack 安装等关键路径缺少键盘操作路径。对一个强调「可问责审批」的工具，审批动作不可键盘完成是个不小的落差。

另：快捷键的 `useEffect` 没有依赖数组（[App.tsx:143](apps/workbench/src/client/App.tsx:143)），每次渲染都重新绑定/解绑事件。功能正确（这也是它闭包能拿到最新 `persist` 的原因），但属于隐式依赖，建议显式声明。

**A5.2.5 窄屏形态未真正可用**
820px 断点把 shell 改成上下布局，但编辑器仍是 `160px + minmax(280px,1fr) + 290px` 三栏。平板上基本不可用。

> 建议：不必强行做移动端。明确声明「最低 1280×800 的桌面工具」，在窄屏下显示引导提示，比给出一个半残的响应式布局更诚实。

---

## 7. A6 工程与协作治理

### A6.1 CI 强于同龄项目

[ci.yml](.github/workflows/ci.yml) 覆盖 typecheck / test / 性能基线 / build / demo 冒烟 / 分发校验，跨 Ubuntu + Windows 双平台，另有 Docker 构建 job 和 Playwright E2E job。性能基线（[performance-baseline.ts](scripts/performance-baseline.ts)）带明确的 p95 预算（编译 20ms / 确定性运行 150ms / 上下文投影 50ms）并在 CI 强制。`release:check` 串联 8 道闸门。这套东西在 12 天龄的项目里属于罕见的成熟度。

### A6.2 测试质量：验证意图而非行为

抽查 [tests/runtime.test.ts](tests/runtime.test.ts)，用例名是「并行取证分支、汇合、并发布已批准的工作」而非「test run()」；断言深入到产物的 evidence 溯源字段与摘要格式，还反向验证了「篡改内容后摘要校验必须失败」。这是正确的测试写法。

### A6.3 缺口

- **无覆盖率度量**。161 个用例 / 25k 行代码，密度中等，但没有任何覆盖率数据，也无法知道 `runtime.ts` 那 12 种节点分支的实际覆盖情况。建议对 `core` 和 `contracts` 设 ≥85% 阈值。
- **无依赖安全扫描**。有 dependabot，但 CI 无 `npm audit` / `osv-scanner`。对一个宣称安全边界的项目，这是叙事漏洞。
- **git 身份不统一**。29 次提交署名为 `你的名字`（Git 默认占位名）。这会让 GitHub 贡献图和「社区项目」的叙事出现割裂，也让 CONTRIBUTING 的邀请显得没有落点。建议统一并考虑 `.mailmap`。
- **文档承诺 > 已验证事实**。文档/代码行数比约 1:8，质量高，但大量陈述属于设计意图而非已验证行为。建议每个 docs 页顶部加一行状态标注：`已在 CI 验证` / `设计意图` / `未验证`。这条建议本身就体现项目宣称的「显式暴露不确定性」原则。
- **治理文件超配**。GOVERNANCE / SECURITY / CoC / SUPPORT / 4 类 issue 模板齐备——对单人项目是超前投入。不是坏事，但 SUPPORT.md 里的响应承诺需要能兑现，否则第一个提 issue 的人就会验证它是空的。

---

## 8. 改进路线图（P 编号）

### P1 — 证明它能用（建议 4 周，最高优先级）

| 任务 | 说明 | 验收标准 |
| --- | --- | --- |
| P1.1 | `connector-github`：真实 Issues / Repo / PR / Checks | 外部用户用自己的仓库跑完 issue→release 并导出审计包 |
| P1.2 | 受治理的通用 `http_request` 工具（允许列表 + SSRF 防护） | 不写代码即可接入任意内部 HTTP 系统 |
| P1.3 | Workbench 运行持久化切到 `SQLiteRunStore` | 500 次运行后写入延迟不随历史增长 |
| P1.4 | 首跑埋点 / `feedback` 命令 | 能回答「有多少人跑完了首跑」 |
| P1.5 | 其余 5 个行业 Pack 明确标注「仅建模参考」 | Gallery 中两类 Pack 视觉可区分 |

### P2 — 让它好用（建议随后 3 周）

| 任务 | 说明 | 验收标准 |
| --- | --- | --- |
| P2.1 | 字阶重建（最小 11px）+ CSS 分层 + 暗色模式 | Lighthouse 可访问性 ≥95 |
| P2.2 | 关键路径键盘可达（审批、节点选择、Pack 安装） | 全流程可纯键盘完成 |
| P2.3 | ESLint（`strictTypeChecked`）+ 覆盖率阈值 + 依赖扫描进 CI | CI 新增 3 道闸门 |
| P2.4 | Node 22 回退适配器或在 README 解释 24 的必要性 | 门槛清晰或降低 |

### P3 — 让治理是真的

- P3.1 工作区身份绑定 GitHub OAuth / OIDC
- P3.2 移除或改造 owner 万能绕过（至少：绕过时写入独立审计事件 + 二次确认）
- P3.3 完成一次真实团队试点（共享 PostgreSQL）

### P4 — 让内核可扩展

- P4.1 `NodeExecutor` 注册表 + `tool-governance.ts` 拆分
- P4.2 `loop` / `map` 内部支持挂起（迭代中的人工门）
- P4.3 独立安全审查（Pack 隔离与 Registry 信任边界）

---

## 9. 下一步

**方向已定（2026-08-15）：收缩到软件交付一个行业做深**，放弃「六行业广度」的叙事定位。其余 5 个行业 Pack 保留但降级标注为「仅建模参考」，停止投入。本节第 8 章的 P1–P4 即按这条路排列。

**立即启动 P1.1。** 把 `packs/software-delivery/src/tools.ts` 里 5 个返回硬编码值的工具换成真实的 GitHub 调用，是当前投入产出比最高的一件事——它同时解决实用性（A3）、北极星可度量性（A4）和演示可信度（A2.2.3）三个问题。

「做深」路线的关键约束见 §10。

---

## 10. 「软件交付做深」的关键约束（方向决定后补充）

### 10.1 好消息：契约层已经为真实连接器准备好了

`software_delivery` 的工具已经声明了完整的类型契约——`operation: query/command`、JSON Schema 输入输出、`idempotency: keyed` 加 `idempotencyKeyField`（[manifest.ts:329-405](packs/software-delivery/src/manifest.ts:329)）。也就是说**换成真实 GitHub 调用不需要改任何契约、图定义或治理逻辑**，改动收敛在 [tools.ts](packs/software-delivery/src/tools.ts) 这一个文件加上密钥注入。架构在这里是对的，欠的只是实现。

### 10.2 必须正面回答的问题：为什么不用 GitHub Actions + branch protection

这是做深软件交付**最大的战略风险**：目标用户已经拥有并行检查（Actions matrix）、必需审批（required reviewers）、角色归属（CODEOWNERS）、合并保护（rulesets）。这几乎覆盖了旗舰 Pack 主图的前四分之三。

站得住的差异点只有一个：**上下文图**——

- 跨 run 复用已批准的 release context（Run B 读 Run A 的 Release 对象，这个能力已经实现并有截图）；
- 可移植、带 SHA-256 完整性的审计包，能离开系统交给审计方；
- 「为什么批准」被结构化留存，而不是躺在 PR 评论里等着被检索。

branch protection 留下的是**记录**，Graph Workbench 留下的是**可复用的组织事实**。这个区别必须在产品第一屏就可见，否则做深也换不来采用。

> 推论：P1 的验收标准不应该只是「跑通 issue→release」，而应该是「**跑完第二次运行时，系统自动引用了第一次的批准结论**」。第二次运行才是价值证明点。

### 10.3 建议的切入人群：受审计约束的交付团队

通用开发团队换掉 branch protection 的动机很弱。真正有痛点的是**必须向外部证明「这次变更为什么被批准」的团队**——金融、医疗器械、汽车、以及任何走 SOC 2 / ISO 26262 / IEC 62304 的组织。那里「导出审计包」不是加分项，是每年都要做一次的苦差事。

这个切入点还有两个附带好处：他们本来就接受流程重量；他们愿意为可导出证据付出集成成本。

### 10.4 做深意味着还要补三件事（当前不在 P1）

1. **真实入口**：主图的 trigger 目前是 `{ type: 'manual' }`（[manifest.ts:570](packs/software-delivery/src/manifest.ts:570)），意味着必须有人打开 Workbench 点「Run」。做深要求 GitHub webhook（issue opened / PR opened）直接起 run——0.5 的 webhook trigger 机制已经具备，缺的是接线。
2. **身份天然可解**：一旦要连 GitHub，工作区身份就应该直接绑 GitHub 用户，角色映射到 CODEOWNERS 或 repo 权限。**A2.2.3 那个「下拉框选身份」的治理缺口，会被 P1.1 顺手解决**——这是做深路线的一个额外红利，值得排进同一个迭代。
3. **失败面变宽**：真实连接器带来限流、token 过期、网络抖动、GitHub 侧的部分失败。现有的 retry/timeout/compensation 机制是为此设计的，但从未在真实故障下验证过。

---

*报告基于 2026-08-15 的 `main` 分支状态。§9–§10 反映 2026-08-15 的方向决策。所有代码位置均可点击跳转。*
