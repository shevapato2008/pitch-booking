---
title: 微信小程序项目 LLM Wiki
updated: 2026-07-22
authority: 微信开放文档、微信支付官方文档、微信官方 GitHub
scope: pitch-booking 原生微信小程序
---

# 微信小程序项目 LLM Wiki

本目录是项目内的微信小程序知识入口。回答架构、UI、调试、网络、支付或发布问题前，先从本页路由到对应主题，再核对所列官方来源。

## LLM 快速路由

| 问题 | 首读文件 | 检索词 |
| --- | --- | --- |
| 小程序与网页有什么不同 | [development-model.md](development-model.md) | `WX-RUNTIME`、渲染层、逻辑层 |
| 设计 artifact 如何与真机一致 | [design-fidelity.md](design-fidelity.md) | `WX-FIDELITY`、golden、rpx |
| Mac 如何开发和真机调试 | [testing-release.md](testing-release.md) | `WX-TEST`、预览、真机调试 |
| 域名、HTTPS、本地 API 怎么处理 | [network-auth-payment.md](network-auth-payment.md) | `WX-NET`、合法域名、localhost |
| 微信登录与支付如何接入 | [network-auth-payment.md](network-auth-payment.md) | `WX-AUTH`、`WX-PAY`、notify_url |
| 从开发到体验版、审核、发布 | [testing-release.md](testing-release.md) | `WX-RELEASE`、体验版、审核 |
| 先前端后后端是否最高效 | [workflow-comparison.md](workflow-comparison.md) | `DEV-WORKFLOW`、纵向切片、契约先行 |
| 查所有官方资料 | [sources.md](sources.md) | URL、官方来源、更新时间 |

## 项目级结论

1. 使用原生小程序技术栈：WXML、WXSS、JavaScript/TypeScript、自定义组件。
2. HTML 原型不能作为视觉真值；高保真设计预览必须运行在微信开发者工具或微信客户端中。
3. UI artifact 是“规范输入 + 原生可执行预览 + 运行截图”，不是另一套 HTML UI。
4. 开发者工具、iOS 微信、Android 微信是不同运行环境，视觉验收至少覆盖三者。
5. 测试环境使用已备案 HTTPS 域名；开发工具可临时跳过校验，但发布前必须关闭跳过选项验证。
6. 真实支付回调必须使用公网可访问的 HTTPS 地址，不能使用 localhost 或局域网地址。

## Wiki 维护规则

- 事实与项目决策分开记录；事实必须链接官方来源。
- 涉及基础库、开发者工具、审核、网络、支付的规则，在实施前重新核对官方文档。
- 每个主题采用稳定知识 ID，便于 `rg "WX-FIDELITY" docs/llm-wiki` 快速召回。
- 若官方文档与本 Wiki 冲突，以官方最新文档为准，并更新 `updated` 日期。
