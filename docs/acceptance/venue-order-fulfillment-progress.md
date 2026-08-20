# 场馆订单履约验收进度

更新时间：2026-08-20

## 已部署

- staging API：`https://pitch-api-staging.modelstella.com`
- 实现版本：`53be6978558b45a74cb8ffdeae0d3d56c781a878`
- 共享生命周期基础：`f2587b6`
- Provider 收敛与部署安全边界：`9984505`
- 数据库：Alembic `0013`
- 场馆工作人员可以读取授权场馆的今日订单，并按服务端状态执行签到和完成。
- 生产小程序使用真实 HTTP 数据源和持久化写入尝试记录；生产包审计未发现 Fixture 或开发回退。
- 普通场馆履约路由已发布；未登录请求返回 `401`，不再是未实现的 `404`。

## 当前诚实边界

- staging 固化 `ONLINE_BOOKING_ENABLED=false`，`MINIPROGRAM_PAYMENT_PROVIDER=disabled`；场馆、时段和已有订单仍可查看，但不能创建新订单或发起支付。
- 真实微信支付/退款 Provider 代码和 worker 已集成，但商户凭据与真实资金 smoke 尚未完成，不能声称真实支付或退款可用。
- 场馆退款路由保持未发布，服务端 `can_refund=false`，生产页面不会显示取消/退款按钮。

## 发布后只读验证

- `/api/v1/health` 返回 `200`，`X-App-Revision` 与实现版本一致。
- `/platform-admin` 返回 `200`。
- 场馆履约列表无 Bearer 时返回 `401`；退款路由返回 `404`。
- API 与 worker 在 disabled 模式下正常启动；即使环境残留旧微信商户变量，也不会初始化真实 Provider。
- 数据库迁移后保留 2 个场馆、3 条场馆管理关系和 1 条入驻申请；发布时订单数为 0，不存在待收敛真实支付或退款。
- 发布前备份：服务器 `/opt/pitch-booking/backups/pitch-before-53be697-20260819.dump`。

## 真实 iPhone 联合验收：9 项 PASS

2026-08-20，体验成员使用已成功上传的体验版 `0.1.1`，在受控 staging
零金额订单上完成以下检查：

1. “我的订单”刷新正常；
2. 打开已过期订单，详情没有支付动作；
3. 进入有权限场馆的“今日订单”；
4. 页面没有取消/退款按钮；
5. “确认签到”成功；
6. “完成服务”成功；
7. 场馆列表刷新后订单仍为“已完成”；
8. “我的订单”刷新后仍为“已完成”，详情没有可执行动作；
9. 全程按钮、滚动、底部安全区和返回路径正常。

这组证据完成的是场馆今日订单、签到和完成，以及相邻“我的订单”权威状态回读；不包含支付、退款或 owner 取消。

## Fixture 清理

真机验收通过后，已删除场馆履约临时 Fixture、`dev/pages/venue-fulfillment/index`
页面及 `route-fragments/venue-fulfillment.json`。生产页面、真实 HTTP source、持久化 attempt store、
生产 route、历史视觉证据和 audit deny rules 均保留；删除门禁已完成 RED → GREEN。

## 尚待完成

- [ ] 获得真实微信商户凭据后，单独完成受控小额支付、通知、关单和退款 smoke；
- [ ] 在凭据与资金 smoke 通过的发布中再启用场馆退款路由与动作；当前退款路由继续保持未发布；
- [ ] owner 取消/退款由独立 B1 轨道完成。

因此，场馆今日订单、签到和完成的真机验收已收口，但真实支付、退款、owner 取消及整个 B1 均未标记完成。
