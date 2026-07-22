---
title: 设计预览与真机一致性
tags: [WX-FIDELITY, artifacts, golden-screenshot, ui-preview, rpx]
updated: 2026-07-22
---

# 设计预览与真机一致性

## WX-FIDELITY-001：一致性的定义

不承诺“浏览器原型与微信完全一致”。项目承诺以下可验证目标：

- 同一份 WXML/WXSS/组件代码同时用于设计预览和最终前端。
- 同一组设计令牌同时驱动全部页面与组件。
- 同一组场景 fixture 可稳定重放正常、空态、加载、失败、禁用和权限状态。
- 开发者工具、指定 iOS 机型、指定 Android 机型均有基准截图与人工交互验收。

## WX-FIDELITY-002：artifact 三层结构

### 规范输入

- `artifacts/ui/design-system/`：颜色、字号、间距、圆角、阴影、图标、状态语义。
- `artifacts/ui/screen-manifest/`：页面、状态、角色、fixture 与验收点。
- `artifacts/ui/flows/`：页面地图和用户流程；允许用 HTML/图表表达，但不作为像素真值。

### 可执行预览

- 位于原生小程序项目中的 UI Gallery、Scenario Runner 和完整页面。
- 直接使用最终 WXML、WXSS 和自定义组件。
- 通过 Mock Service/fixtures 驱动，不依赖后端即可演示全部页面。

### 运行证据

- `artifacts/ui/golden/devtools/`
- `artifacts/ui/golden/ios/`
- `artifacts/ui/golden/android/`
- 每张截图带页面路径、场景 ID、机型、系统、微信版本、基础库版本和提交号。

## WX-FIDELITY-003：设计尺寸与适配

微信官方设计指南支持以 375px 固定布局基准或 390px 响应式基准进行设计；WXSS 使用 `750rpx` 屏宽模型。项目默认采用 375px/750rpx 基线，同时在 320px、375px、390px、428px 等宽度进行适配检查。

规则：

- 视觉令牌以 `rpx` 为主要布局单位，1px 边线等特殊情况单独处理。
- 不依赖本地网页字体；使用微信客户端所运行系统的字体栈。
- 为右上角微信官方菜单预留安全区域。
- 底部操作区考虑设备安全区，不把关键按钮贴到屏幕边缘。
- 点击热区遵循微信标准控件尺寸和约 7–9mm 的物理触控目标。

来源：[微信小程序设计指南](https://developers.weixin.qq.com/miniprogram/design/)、[WXSS](https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxss.html)

## WX-FIDELITY-004：视觉回归

微信官方云测支持以相同 AppID、机型、页面路径、截图名称和截图类型匹配基准图，并使用 SSIM 或视觉对比算法。项目先使用本地/CI 截图基线；具备云测条件后接入官方图片对比。

注意：操作系统与屏幕可能产生微小像素差异，不能机械要求 SSIM 等于 1。动态时间、头像、网络图片等区域应固定 fixture 或设置忽略区域。

来源：[微信云测图片对比](https://developers.weixin.qq.com/miniprogram/dev/devtools/minitest/image_diff.html)

## WX-FIDELITY-005：验收门槛

每个页面只有同时满足以下条件才算完成：

1. 对应 screen manifest 状态全部可重放。
2. 开发者工具无 WXML/WXSS/Console 错误。
3. iOS、Android 真机主流程可操作，无截断、遮挡和错位。
4. 基准截图经评审，后续改动无未解释差异。
5. 交互、文案、权限与 PRD/契约一致。
