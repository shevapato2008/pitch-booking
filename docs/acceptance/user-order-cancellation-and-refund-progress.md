# 用户订单取消与退款验收进度

状态：`STAGING_DEPLOYED_NO_PAYMENT_DEVICE_ACCEPTED_FIXTURE_REMOVED`

更新时间：2026-08-20

## 已完成的实现

- owner-only `POST /api/v1/orders/{order_id}/cancel` 已接通，保持无请求体、Bearer 鉴权和稳定幂等键边界。
- 待支付且不存在可能资金的订单可在同一事务中取消，并且只释放由该订单持有的 `LOCKED` 时段。
- 已确认且存在唯一 applied `SUCCESS` 主付款的订单只创建 durable
  `ORDER_CANCELLATION + USER_CANCELLED` case/attempt，返回 `REFUND_PENDING`；命令不调用 Provider、不写退款终态。
- 只有同一用户取消 case 的最新 `FAILED` attempt 可显示并执行“重试退款”；场馆取消和库存冲突退款失败不会暴露无效按钮。
- 生产小程序使用严格 decoder 和真实 HTTP adapter；列表只显示服务端状态，取消动作仅出现在详情页并完全服从服务端 `allowed_actions`。

相关提交：

- `b7d0503`：无资金取消 API；
- `86e4c22`：冻结错误矩阵与原子回滚；
- `aaf725e`、`cb7e084`：durable 退款入队、重试和终态幂等重放；
- `9129f8c`：生产小程序 HTTP owner action；
- `d714cda`：只暴露确实可执行的 owner 退款重试。

## 自动化与本地真实 HTTP 证据

聚焦门禁结果：

- 真实 PostgreSQL 的取消、生命周期、退款仓储、详情、列表和 OpenAPI：159 passed；
- Mini Program decoder、HTTP、详情/列表 presentation 与页面：295 passed；
- TypeScript typecheck：PASS；
- OpenAPI 契约示例：89 个全部通过；
- Ruff 与 `git diff --check`：PASS。

随后使用唯一 disposable PostgreSQL、真实本机 Uvicorn 网络和
`PAYMENT_PROVIDER=disabled` 完成一次非 TestClient 的受控贯通：

1. 无支付订单返回 `200 / CANCELLED`，仅目标 slot 释放，对照 slot 仍为 `LOCKED`；
2. applied `SUCCESS` 的已确认订单返回 `202 / REFUND_PENDING`，只生成 1 个 durable case 和 attempt，slot 保持 `BOOKED`；
3. 将 Provider-owned attempt 置为 `FAILED` 后，详情投影允许真实重试；新请求在同一 case 创建 attempt 2，序列为 `FAILED → CREATING`；
4. 全程 6 次匿名化 HTTP 调用，Provider 调用 0 次，`SUCCESS` 退款终态写入 0 条。

临时 Uvicorn 与隔离数据库均已清理，临时数据库残留计数为 0；未记录 bearer、用户标识、手机号、订单号、数据库地址、密钥或二维码。

## staging 部署证据

- 计算主机：`ucloud-v100`；阿里云继续承载域名侧服务、OSS 和 DashScope，不是本次 ECS 部署入口。
- 已按不可变发布流程部署 `d905b72`，发布前数据库与共享环境备份均已生成并验证；相对旧版本无 migration/model 变化。
- API、worker、PostgreSQL 和 Caddy 均运行，API/PostgreSQL 健康；Alembic 保持 `0014`。
- 公网 health 返回 `200` 且 revision 为 `d905b72`；平台后台返回 `200`；无 Bearer 的订单读取与取消写入均返回 `401`。
- `PAYMENT_PROVIDER=disabled`、Mock Provider 关闭；部署后五分钟 API/worker 日志未命中 Traceback、CRITICAL 或未处理异常。
- 体验版 `0.1.2` 已在用户明确确认后上传，并由体验成员通过既有体验二维码进入；没有提交正式审核或公开发布。

## 真实 iPhone 验收：9/9 PASS

2026-08-20，体验成员使用体验版 `0.1.2` 和真实 staging API 完成一笔受控、零金额且从未进入支付流程的待支付订单取消：

1. “我要租赁场地 → 我的订单”进入与下拉刷新正常；
2. 受控订单显示“待支付”；
3. 详情页显示服务端权威“待支付”；
4. 底部显示“取消订单”，且没有“立即支付”；
5. 点击取消后显示真实确认框；
6. 确认后详情变为“订单已取消”；
7. 返回列表并刷新后显示“已取消”；
8. 再次进入详情仍为“订单已取消”，且没有取消或支付按钮；
9. 375×812 代表性检查中，按钮居中、状态徽标和箭头完整，内容无裁切，底部安全区正常。

验收后服务端匿名化权威核验为：订单 `CANCELLED`、目标 slot `AVAILABLE`，并且
`Payment / RefundCase / RefundAttempt = 0`。随后仅删除本次受控验收产生的 Order、Slot 和取消幂等记录；用户、membership、场馆和场地身份图未改变。未记录订单号、用户标识、手机号、Token、数据库地址、密钥或二维码。

## Fixture 清理

真机 PASS 后已删除 `order-cancellation` Fixture、route fragment 及其测试，并移除 development bootstrap 和构建选择器中的临时 source 分支。生产 `pages/order-detail/index`、`pages/my-orders/index`、真实 HTTP source、生产路由以及 production audit deny rules 均保留；清理门禁完成 RED → GREEN，production build、支付关闭检查和 package audit 重新通过。

## 当前诚实边界

- owner 无资金取消已部署到共享 staging，并完成真实 iPhone 的取消、详情重开、列表刷新和时段回收验收。
- 当前体验版仍保持在线预订、支付和真实退款入口关闭。
- `MINIPROGRAM_PAYMENT_PROVIDER=disabled`，未启用真实微信支付或退款。
- 已确认此前删除的 my-orders 和 venue-fulfillment 临时资产仍保持缺席；本次清理没有移除任何生产 route/token。
- paid refund terminal acceptance：`BLOCKED_BY_WECHAT_PROVIDER_INTEGRATION`。只有微信 Provider 轨道获得完整商户凭据并完成一次受控小额支付/退款后，才能验收通知或主动查询收敛及最终 `REFUNDED`。
- durable paid-refund enqueue/retry 的实现与本地 HTTP 证据不等于退款到账，也不等于整个 B1 完成。

## 待完成

- [x] 在保持在线预订、支付与真实退款关闭的前提下，将本切片 backend 部署到共享 staging；
- [x] 用受控无资金待支付订单完成真实 iPhone 取消、详情重开、列表刷新和同一 slot 可用性回读；
- [x] 在 375×812 完成一次 HTTP-backed 详情/列表人工视觉自审，覆盖按钮居中、徽标、箭头、裁切、底部安全区和真实状态；
- [x] 按完整 route/token union 串行删除 `order-cancellation` 临时 Fixture/route fragment，证明非目标 route/token 未丢失，并重跑 production build、disabled-payment 检查和 package audit；
- [ ] paid refund terminal acceptance 保持 `BLOCKED_BY_WECHAT_PROVIDER_INTEGRATION`；
- [x] 体验版 `0.1.2` 上传前取得用户明确确认；未提交正式审核、未公开发布。
