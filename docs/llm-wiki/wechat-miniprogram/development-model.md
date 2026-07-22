---
title: 原生小程序开发模型
tags: [WX-RUNTIME, WXML, WXSS, components, lifecycle]
updated: 2026-07-22
---

# 原生小程序开发模型

## WX-RUNTIME-001：不是普通网页

小程序的逻辑层和渲染层分离。WXML/WXSS 在渲染层工作，JavaScript 在逻辑层运行；二者经微信客户端中转通信。小程序不能直接使用 DOM、BOM，浏览器库也不能默认认为可用。

项目影响：浏览器 HTML 只能表达流程或低保真布局，不能证明小程序的真实渲染结果。

来源：[小程序简介](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/)、[小程序宿主环境](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/framework.html)

## WX-RUNTIME-002：三种运行环境

官方列出的主要环境为：

| 环境 | 逻辑层 | 渲染层 |
| --- | --- | --- |
| iOS 微信 | JavaScriptCore | WKWebView |
| Android 微信 | V8 | Chromium 定制内核 |
| 微信开发者工具 | NWJS | Chrome WebView |

项目影响：开发者工具通过不等于真机通过；必须保留 iOS 和 Android 验收。

来源：[小程序简介](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/)

## WX-RUNTIME-003：文件结构

小程序根部由 `app.js`、`app.json`、可选 `app.wxss` 组成。每个页面通常由同路径同名的 `.js`、`.wxml`、`.json`、`.wxss` 文件组成。自定义组件同样由四类文件组成，并在 JSON 中声明 `component: true`。

项目影响：页面和组件的 artifact 应直接映射到真实页面目录及组件目录，避免再维护一套无法映射的 HTML 组件树。

来源：[目录结构](https://developers.weixin.qq.com/miniprogram/dev/framework/structure.html)、[自定义组件](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/)

## WX-RUNTIME-004：WXML 与 WXSS

- WXML 提供数据绑定、列表、条件、模板和事件。
- WXSS 支持 CSS 的大部分特性，并扩展 `rpx` 与样式导入。
- 规定屏幕宽度为 `750rpx`；官方文档以 375px 宽设备说明 `1rpx = 0.5px`。
- 静态样式应放入 class，动态样式才使用内联 style。
- 自定义组件样式存在额外限制，应优先使用 class 选择器。

来源：[WXML](https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxml/)、[WXSS](https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxss.html)、[自定义组件](https://developers.weixin.qq.com/miniprogram/dev/framework/custom-component/)

## WX-RUNTIME-005：组件策略

优先顺序：

1. 微信基础组件，如 `view`、`text`、`image`、`button`、`input`、`picker`、`scroll-view`。
2. 微信官方 WeUI 小程序组件，适合对话框、表单、反馈等通用控件。
3. 项目自定义组件，适合场地卡片、时段选择器、订单状态卡、球局成员列表。

来源：[基础组件列表](https://developers.weixin.qq.com/miniprogram/dev/component/)、[微信官方 WeUI MiniProgram](https://github.com/wechat-miniprogram/weui-miniprogram)
