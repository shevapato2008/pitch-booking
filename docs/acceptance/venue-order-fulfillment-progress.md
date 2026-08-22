# 场馆订单履约验收进度

更新时间：2026-08-22

## 已部署

- staging API：`https://pitch-api-staging.modelstella.com`
- 场馆履约实现基线：`53be6978558b45a74cb8ffdeae0d3d56c781a878`
- 当前 staging 版本：`87da5d50cfdb70e954ec067dfb93c64a36718e5e`
- 共享生命周期基础：`f2587b6`
- Provider 收敛与部署安全边界：`9984505`
- 数据库：Alembic `0014`
- 场馆工作人员可以读取授权场馆的今日订单，并按服务端状态执行签到和完成。
- 生产小程序使用真实 HTTP 数据源和持久化写入尝试记录；生产包审计未发现 Fixture 或开发回退。
- 普通场馆履约路由已发布；未登录请求返回 `401`，不再是未实现的 `404`。

## 当前诚实边界

- 体验版 `0.1.3` 已在受控 staging 启用真实微信支付，并完成一次最小金额支付与 owner 全额退款验收；这不是正式审核或公开发布。
- 正常支付/owner refund 终态证据记录在 `docs/acceptance/wechat-pay-v3-smoke.md`；人工重复回调与强制 recovery 仍未执行。
- 场馆退款路由已在真实 WeChat Provider 配置完整时启用；服务端只对符合条件的订单投影
  `can_refund=true`。disabled、mock 或 Provider 未构造时仍保持路由未发布、`can_refund=false`。
- 体验版 `0.1.3` 已使用一笔独立的 CNY 0.01 真实支付完成场馆原因全额退款验收；这次验收不包含
  人工重复回调或强制主动查询/worker recovery。

## 发布后只读验证

- `/api/v1/health` 返回 `200`，`X-App-Revision` 与实现版本一致。
- `/platform-admin` 返回 `200`。
- 场馆履约列表与场馆退款路由无 Bearer 时均返回 `401`；退款路由由部署前的 `404` 变为已挂载且受鉴权保护。
- API 健康、worker 运行，二者使用同一真实 WeChat Provider 配置；Mock Provider 保持关闭。
- Compose 项目和 PostgreSQL 数据卷保持不变，API/worker 重启计数为 0，启动日志未发现 traceback。
- 2026-08-19 初次履约部署后保留 2 个场馆、3 条场馆管理关系和 1 条入驻申请；当时订单数为 0。
- 本次激活发布前备份：服务器 `/opt/pitch-booking/backups/pitch-before-87da5d50-20260822T081539Z.dump`。

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

九项验收结束后，受控 staging 零金额验收图先通过完整回滚演练，再按同一组断言原子清理：
仅删除 1 条临时订单、1 条合成零额 Payment、2 条签到/完成幂等记录和 1 个临时时段。
提交后 marker 零残留检查通过；既有用户、场馆、场地和成员关系均保留，清理前备份仍可恢复。

## 真实 iPhone 场馆原因退款：PASS

2026-08-22，授权场馆工作人员使用体验版 `0.1.3`，对一笔独立的 CNY 0.01 真实支付完成以下检查：

1. 支付后服务端收敛为 `Payment.SUCCESS / Order.CONFIRMED / Slot.BOOKED`，且退款记录为 0；
2. 场馆“今日订单”将目标订单显示为“待履约”，并仅在符合条件时显示“取消并退款”；
3. 工作人员填写非敏感场馆原因并只提交一次，页面进入“退款处理中”；
4. 微信原支付零钱账户收到完整 CNY 0.01 退款；
5. 服务端终态为 `Order.REFUNDED / Slot.CLOSED`，时段无残留锁；
6. 只有 1 条 applied successful Payment、1 个全额 `ORDER_CANCELLATION / VENUE_CANCELLED`
   RefundCase 和 1 次 successful RefundAttempt，无活动、失败、重复或 claimed 资金工作；
7. 场馆订单、租客订单详情和库存页刷新后分别显示“已退款 / 订单已结束”、“退款已完成”和“已关闭”。

真实资金账本保留；专用时段保持 `CLOSED`，未自动或人工重新开放。验收记录不包含订单号、手机号、
OpenID、商户交易号、退款单号、回调密文或任何密钥。

## 尚待完成

- [x] 单独完成一次受控小额支付、真实通知收敛和 owner 全额退款到账 smoke；
- [ ] 补做人工重复回调与强制主动查询/worker recovery；
- [x] 在凭据与资金 smoke 通过后，以 staging revision `87da5d50` 启用场馆退款路由与服务端动作投影；
- [x] 使用一笔真实、符合条件的已支付订单完成场馆原因全额退款，并核验退款到账、订单终态与场地库存语义；
- [x] 独立 B1 轨道已完成无资金 owner 取消和 paid refund terminal acceptance 的真实 iPhone 验收。

因此，场馆今日订单、签到/完成、无资金 owner 取消、真实支付、owner paid refund terminal acceptance
及场馆原因退款正常路径均已收口。人工重复回调与强制 recovery 仍是明确的韧性演练债，但不再阻塞
B1 正常路径验收或后续非资金 MVP 开发。
