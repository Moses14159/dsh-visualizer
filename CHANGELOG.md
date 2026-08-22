# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-08-22

### 新增
- `visualize` 工具，接受 `spec`（ChartSpec）或 `widget`（WidgetSpec）两种载荷。
- `conversation.chat.node` 的 `visualizer-chart` 节点：ChartSpec → echarts 渲染。
- `conversation.chat.node` 的 `visualizer-widget` 节点：SVG/HTML Widget → 沙箱 iframe 渲染。
- 流式 Widget：模型正文 ```svg / ```html 围栏经 `assistant/chunk` 事件逐 token 增量渲染。
- 双端校验（host `execute` + 客户端折叠），纯函数契约在 host / client / 测试三方共享。
- SVG 自适应高度（`svg-geometry`）、缩放控件（适应 / 1.5× / 2×）、状态徽标（生成中 / 已截断 / 完成）。
- 沙箱安全边界：iframe `sandbox=""` + CSP `default-src 'none'`，代码原样插入。
- 97 个纯函数单测。

### 修复
- 无（首个公开版本）。

## [0.2.0] - 2026-08-21

### 新增
- 建立 host 半边工具注册与客户端折叠的骨架。
- 拆分纯函数模块：`chartspec` / `widget` / `to-echarts` / `to-iframe` / `svg-geometry`。
- 补齐多端渲染与流式扫描。

## [0.1.0] - 2026-08-21

### 新增
- 插件骨架与构建管线（tsdown，host + 两渠道 client bundle）。
- 初始化 `visualize` 工具定义与基础渲染路径。
