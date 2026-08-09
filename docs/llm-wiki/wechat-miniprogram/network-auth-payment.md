---
title: 网络、登录与支付
tags: [WX-NET, WX-AUTH, WX-PAY, HTTPS, AppID, notify_url]
updated: 2026-07-22
---

# 网络、登录与支付

## WX-NET-001：服务器域名

小程序只能与已配置的通讯域名通信。生产/体验环境的 `wx.request`、上传和下载使用 HTTPS，WebSocket 使用 WSS。域名不能使用公网 IP 或 localhost，且必须完成 ICP 备案。AppSecret 只能保存在后端，不得放入小程序代码。

开发者工具和手机调试模式可临时开启“不校验请求域名、TLS 版本及 HTTPS 证书”，但服务器域名配置完成后应关闭该选项，在各平台复测。

来源：[网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)

## WX-NET-002：Mac 本地 API

基础库允许与局域网 IP 通信，但不允许访问设备自身 IP。手机中的 `localhost` 指向手机，不是 Mac。

项目策略：

- 开发者工具可连接 Mac 本地 FastAPI。
- 手机临时调试可连接同一局域网中的 Mac IP。
- 稳定体验版统一连接阿里云测试 HTTPS 域名，避免局域网、防火墙和证书差异。

来源：[网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)

## WX-NET-003：腾讯地点搜索发布前置条件

发布前必须在腾讯位置服务控制台创建客户端 Key，并将该 Key 限制为本小程序可使用的应用；在微信公众平台将 `https://apis.map.qq.com` 添加到小程序 `request` 合法域名；同时发布与地点关键词及搜索结果用途相匹配的隐私保护说明。

若没有相应账号或控制台权限，这三项均为外部发布阻塞项，不得回退到开发预览数据。

## WX-AUTH-001：登录边界

小程序调用微信登录 API 获取临时凭证，发送到 FastAPI；FastAPI 使用服务端保存的 AppSecret 与微信接口交换用户标识，再签发项目自己的会话。客户端不得持有 AppSecret，也不能直接调用需要 AppSecret 的微信服务端接口。

官方入口：[小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)、[code2Session](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)

## WX-PAY-001：支付开发模式

支付能力通过统一接口隔离：

- `MockPaymentProvider`：用于无资质阶段和自动化测试，覆盖成功、失败、取消、超时、重复通知和退款状态。
- `WeChatPaymentProvider`：使用微信支付 API v3，在资质、商户号、AppID 绑定和密钥就绪后启用。

开发者工具支持调试支付，但实际交互需扫码后在手机完成，因此支付闭环仍需真机验证。

来源：[工具与客户端差异](https://developers.weixin.qq.com/miniprogram/dev/devtools/different.html)、[小程序支付接入](https://pay.wechatpay.cn/static/applyment_guide/applyment_detail_miniapp.shtml)

## WX-PAY-002：回调地址

支付和退款通知地址必须是公网可访问的 HTTPS 完整路径，不允许 localhost、127.0.0.1 或局域网地址，也不能携带查询参数。通知可能重复发送，后端必须验签、解密并幂等处理，同时通过主动查单兜底。

来源：[微信支付回调通知注意事项](https://pay.wechatpay.cn/doc/v3/merchant/4012075420)、[小程序支付通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791897)
