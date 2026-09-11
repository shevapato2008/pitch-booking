# 导航与重复控件一致性 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the bounded navigation task; preserve the user's proportionality rules. No new worktree or Git writes in this read-only Git session.

**Goal:** 三个模块用同款小房子回到目的首页，二级页保留返回语义；同类按钮、关闭图标与状态展示沿用统一夜场追光样式。

**Architecture:** 复用现有安全区计算，三个模块共用一个轻量导航组件；业务事件仍由页面处理。其他页面复用明确的控件样式，不改变权限、保存、支付、后端或禁用条件。

**Tech Stack:** 微信原生 WXML/WXSS/TypeScript，现有 Jest 与 production 构建。

用户已于 2026-09-11 确认：模块首页用小房子，二级页用返回箭头。沿用已选 A 风格，不重新设计页面。此次不包含 LazyCodeLoading 配置或正式发布。

## Task 1: 三大模块导航

- [x] 在导航组件及三个页面现有测试中覆盖同款首页入口、安全区和回首页行为，先观察失败。
- [x] 新增 `miniprogram/components/module-navigation/`，接入 `game-discovery`、`venue-access`、`venue-map`；地图改 custom navigation 并为地图内容保留正确高度。
- [x] 保留服务、权限、定位、列表、库存逻辑；导航点击回 `/pages/intent-entry/index`，不与原生胶囊重叠。
- [x] 运行组件与三个页面聚焦测试。

## Task 2: 重复控件样式

- [x] 检查 27 个生产页面和现有共享组件，按同一用途分类，不将主次/危险/禁用状态混为一种。
- [x] 在 `miniprogram/styles/controls.wxss` 收敛按钮尺寸/圆角/字号、返回/关闭图标及按压/禁用样式；仅向实际同类控件添加语义类或共享导入，保留布局及事件。
- [x] 现有结构测试增加小范围一致性断言；保留关闭/返回时未保存提醒和写入冻结。

## Task 3: 验证与交付

- [x] 聚焦测试、typecheck、变更文件 lint、production 构建和包审计。
- [x] 只打开 `dist/miniprogram-live-preview`，监测 ENFILE；在真实开发者工具中检查三个模块导航、一个二级返回、一个关闭弹层和代表按钮组。
- [x] 检查居中、图标完整、标题/胶囊和安全区；有明显问题先修复再交付。
- [x] 更新恢复记录和测试指南，如实标明本轮是否上传；不把源码未合并说成 main 已更新。

为控制本次前端修正成本，不新增截图工具链、不做无关全仓回归、不重复多轮文档审核。
