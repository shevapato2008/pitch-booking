---
title: 开发、测试与发布流程
tags: [WX-TEST, WX-RELEASE, devtools, preview, remote-debug, automation]
updated: 2026-07-22
---

# 开发、测试与发布流程

## WX-TEST-001：Mac 开发循环

先完成[environment-setup.md](environment-setup.md)中的安装、人工登录、CLI 与端口前置条件。

1. 使用 AppID 在微信开发者工具中导入原生小程序项目。
2. 编译，在模拟器检查页面结构、样式、数据和网络请求。
3. 使用 WXML、Console、Network、AppData、Storage 面板定位问题。
4. 点击预览生成二维码，在手机微信中检查真实表现。
5. 使用真机调试，通过开发者工具连接手机查看日志、Storage 和源码。

来源：[开始](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/getstart.html)、[调试](https://developers.weixin.qq.com/miniprogram/dev/devtools/debug.html)、[真机远程调试](https://developers.weixin.qq.com/miniprogram/dev/devtools/remote-debug.html)

## WX-TEST-002：测试金字塔

- 纯函数单元测试：格式化、状态转换、权限判断、数据映射。
- 组件测试：组件 props、事件、状态和样式类。
- 小程序自动化：使用官方 `miniprogram-automator` 驱动页面、查找元素、点击和断言。
- API 契约测试：Mock Service 与 FastAPI 使用相同响应 schema。
- 真机冒烟：iOS 与 Android 覆盖登录、预订、支付模拟、球局报名、退款和后台操作。
- 视觉回归：稳定页面/组件使用截图基线；动态区域固定或忽略。

来源：[小程序自动化快速入门](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html)、[微信云测图片对比](https://developers.weixin.qq.com/miniprogram/dev/devtools/minitest/image_diff.html)

## WX-TEST-003：开发者工具不等于真机

开发者工具对部分 API 采用模拟行为。支付会显示二维码并在手机完成；分享、扫码、场景值等也可能采用模拟流程。接口输入输出可以保持一致，但交互路径不同，因此对应能力必须真机复验。

来源：[工具与客户端差异](https://developers.weixin.qq.com/miniprogram/dev/devtools/different.html)

## WX-RELEASE-001：版本链路

官方流程为：预览 → 上传代码 → 设置体验版/提交审核 → 审核通过 → 发布。小程序包含开发版、体验版、审核中版本和线上版本。

本项目在代码层完成阶段止于“稳定体验版 + 阿里云测试环境”：

- 体验成员扫描体验版小程序码。
- 体验版连接测试 API 和隔离的测试数据。
- 默认使用 Mock 支付；资质齐备后启用真实支付测试开关。
- 只有体验版回归通过后才进入正式审核和灰度发布。

来源：[小程序协同工作和发布](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html)
