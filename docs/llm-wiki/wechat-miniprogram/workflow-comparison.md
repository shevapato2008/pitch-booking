---
title: 跨端设计预览开发流程比较
tags: [DEV-WORKFLOW, preview-driven, contract-first, vertical-slice]
updated: 2026-07-22
---

# 跨端设计预览开发流程比较

## DEV-WORKFLOW-001：跨端通用性

“用真实 UI 代码和样例数据预览组件/页面”的模式在现代客户端开发中通用：

- 微信小程序：开发者工具编译预览、手机扫码预览、真机调试。
- Android：Jetpack Compose `@Preview` 可用不同屏幕、字体、深色模式和样例状态预览 Composable，并可运行到设备。
- iOS：Xcode/SwiftUI Preview 可实时、交互式预览 View，并切换设备与 traits。

来源：[微信编译预览](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/getstart.html)、[Android Compose Preview](https://developer.android.com/develop/ui/compose/tooling/previews)、[Xcode Previews](https://developer.apple.com/documentation/swiftui/previews-in-xcode)

## DEV-WORKFLOW-002：三种流程

### 严格先前端后后端

先用 Mock 完成全部页面，再统一提取需求并开发后端。

优点：很早获得完整可视展示，适合需求探索和向非技术成员演示。

风险：业务约束、权限、并发、支付、失败恢复发现较晚；API 集中联调形成集成悬崖；Mock 容易比真实业务过于理想化。

结论：适合低保真探索，不适合作为整个交易型产品的唯一实施方式。

### 后端先行

先完成数据库与 API，再开发页面。

优点：核心规则和数据能力较早稳定。

风险：交互反馈晚，可能实现未被页面需要的接口；非技术成员难以及早验收。

结论：适合协议稳定的基础设施，不适合当前 UI 与流程仍需共同确认的 MVP。

### 预览驱动 + 契约先行 + 纵向切片（项目推荐）

1. 先确定设计系统、页面地图和关键状态。
2. 用真实客户端 UI 代码 + fixtures 制作可执行预览。
3. 每完成一组页面，立即生成/更新 OpenAPI 契约、状态机和权限表。
4. 按完整用户旅程实现后端并替换 Mock，而不是等所有页面结束。
5. 每个旅程独立完成 UI、API、数据库、测试和测试环境演示。

优点：既能早看 UI，又能早验证真实约束；每个阶段都有可运行增量；三端都可以使用同一思想。

## DEV-WORKFLOW-003：平台对应关系

| 共同概念 | 微信小程序 | Android | iOS |
| --- | --- | --- | --- |
| 可执行 UI | WXML/WXSS 自定义组件 | Jetpack Compose | SwiftUI |
| 预览入口 | 开发者工具/UI Gallery | `@Preview` | `#Preview` |
| 样例数据 | Fixture Repository | Fake Repository/PreviewParameter | Mock Service/Preview data |
| 状态模型 | Page/Component data | UI State + UDF | View State/Observable model |
| 真实验证 | iOS/Android 微信真机 | 模拟器与设备 | Simulator 与设备 |
| 视觉回归 | 小程序云测/截图基线 | Screenshot tests | Snapshot tests |

## DEV-WORKFLOW-004：本项目的纵向切片

推荐依次交付：

1. 场馆浏览：场馆、场地、日期、时段和可用状态。
2. 预订交易：库存锁定、订单确认、模拟支付、订单结果。
3. 球局协作：创建球局、分享进入、报名、候补、退出。
4. 售后：取消、退款申请、退款结果与异常恢复。
5. 场馆管理：时段生成、停开、订单处理和退款处理。
6. 平台管理与测试环境：权限、审计、演示数据和部署。

每个切片先出现原生预览，随后冻结对应契约并完成全链路。后续切片可以继续做 UI 预览，但不会让已明确的后端工作无谓等待。

## DEV-WORKFLOW-005：架构共同原则

Android 官方建议 UI 层根据状态渲染、事件向上流动，并由 repository 隔离数据源；这也是本项目 Mock/Real Provider 可替换的依据。微信与 iOS 虽然 API 不同，也采用同样的端口与适配器思想：UI 依赖稳定接口，不直接依赖 HTTP、数据库或支付 SDK。

来源：[Android UI layer](https://developer.android.com/topic/architecture/ui-layer)、[Android data layer](https://developer.android.com/topic/architecture/data-layer)
