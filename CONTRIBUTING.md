# Contributing

感谢你愿意为 `dsh-visualizer` 贡献代码。本插件是一个**不改动 DSH 源码**的外部插件，所有改动都应遵守下述约定。

## 前置

- Node `>= 20`，`pnpm`。
- 一次性安装并构建：
  ```sh
  pnpm install
  pnpm build
  ```

## 本地校验

提交前请确保以下全绿：

```sh
pnpm test        # 纯函数单测（vitest）
pnpm typecheck   # 类型检查（tsc --noEmit）
pnpm build       # tsdown：host + replay + 两渠道 client bundle
```

`pnpm test` 只覆盖**纯模块**（`charspec` / `widget` / `to-echarts` / `to-iframe` / `svg-geometry` / 两个 fold / 工具校验）。这些模块**不 import DSH、不触达 DOM**，因此能在 Node 里独立测试。

## 结构约定

- **纯函数模块**（`chartspec.ts` / `widget.ts` / `to-echarts.ts` / `to-iframe.ts` / `svg-geometry.ts`）：
  - 不 import `@deepseek-ai/*`（类型可以，运行时不 import）；
  - 不触达 DOM；
  - 输入是**不受信**载荷，任何读取先过 `parse*` 校验，字段超限即拒绝（不忽略）；
  - 一份契约在 host 校验、客户端折叠、单测三方复用。
- **host 半边**（`src/index.ts`、`src/visualize-tool.ts`）：只负责注册 `visualize` 工具。
- **client 半边**（`src/client/`）：把插件事件折叠成 `visualizer-chart` / `visualizer-widget` 节点，并注册进 `conversation.chat.node` 槽位。组件只吃 props 的 share，**不碰 `ctx`**。
- **安全边界**：Widget 代码永远**原样**插入 iframe（`sandbox=""` + CSP），不做 mark-up 校验；任何校验/渲染失败都要**降级**，绝不出现空白或抛错中断对话。

## 新增一种可视化产物

1. 在 `src/` 加一个纯模块（校验 + 映射），并补上对应单测。
2. host 半边：要么扩展 `visualize` 工具，要么新增工具。
3. client 半边：新增一个 `ConversationNodeDefinition` + 一个 `conversation.chat.node` 的 keyed renderer。
4. 更新 `README`、`CHANGELOG`。

## 提交信息与文档

- 遵循仓库现有的英文注释 + 中文产品文案风格。
- 非平凡改动请在 `CHANGELOG.md` 记录；文档与代码同步更新。
