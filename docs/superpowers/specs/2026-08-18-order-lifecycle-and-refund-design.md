# 订单取消、退款与场馆履约共享设计

日期：2026-08-18

状态：独立产品决策与规格审查已通过

上游路线图：[整体切片路线图](../plans/2026-08-16-overall-slice-roadmap.md)

相关切片：[我的订单](./2026-08-18-my-orders-design.md)、[支付确认](./2026-07-28-payment-confirmation-and-confirmed-order-design.md)

## 1. 目标

在已经部署的“我的订单”基础上，冻结 B1 后续并行开发必须共享的权威状态和数据边界：

- 用户可以在规则允许时取消订单，并看到真实退款进度；
- 场馆工作人员可以查看本场馆今日订单、核销到场和完成履约；
- 真实微信支付与退款适配器可以接入现有支付收敛逻辑；
- 后续队长创建公开球局时，只依赖明确可用的已支付订单。

本规格采用“完整状态语义、分阶段交付”：先一次性冻结状态、迁移、锁顺序和接口投影，再把用户取消退款、场馆履约、微信支付适配器和队长前端 Artifact 分配给互不修改共享模型的并行任务。

## 2. 本期范围与非目标

包含：

- 订单取消和全额退款；
- 退款申请、主动查单和回调收敛；
- 场馆今日订单、到场核销和完成；
- 服务器权威的 `allowed_actions`；
- 微信支付 API v3 的窄 Provider、通知验签解密和 worker 接线；
- 为 B2 冻结订单资格，不实现 B2 生产后端。

不包含：

- 部分退款、50% 退款、优惠券或平台分账；
- 用户在开场前不足 24 小时时自助取消；
- 自动完成、爽约、评价、综合信用分；
- 场馆经营报表或客服工单后台；
- 在缺少微信商户凭证时声称真实扣款或退款已验收。

现有页面中“开场前不足 24 小时收取 50%”的文案与本期能力不一致，必须改成真实规则，不得保留不可执行承诺。

## 3. 订单权威状态

保留现有：

- `PENDING_PAYMENT`
- `CONFIRMED`
- `EXPIRED`
- `PAYMENT_EXCEPTION`

新增：

- `CANCELLED`：订单已取消，且没有待处理的成功付款退款；
- `REFUND_PENDING`：已受理退款，但尚无权威成功或失败结果；
- `REFUND_FAILED`：本次退款已明确失败，可由有权限方按同一退款业务重试；
- `REFUNDED`：全额退款已权威成功；
- `COMPLETED`：已核销且场次结束后由场馆完成履约。

不增加 `CANCEL_REQUESTED` 和 `CHECKED_IN` 状态，避免把流程事件误建模为互斥订单状态。使用时间戳表达：

- `cancel_requested_at`
- `cancelled_at`
- `checked_in_at`
- `checked_in_by_user_id`
- `completed_at`
- `completed_by_user_id`

数据库约束保证状态与时间戳一致；所有时间使用带时区 UTC 存储。

## 4. 退款模型

每条权威成功支付最多一条 `refund_cases`，表达该笔资金的全额退款业务；一个订单可能因迟到支付或重复扣款拥有多条成功 payment，因此也可能拥有多条 case。每个 case 可以有多次顺序执行的 `refund_attempts`，用于超时恢复或明确失败后的重试。

成功支付增加 nullable `applied_to_order_at`。只有真正把该订单和 slot 收敛为 `CONFIRMED + BOOKED` 的 payment 才写入该字段；每个订单最多一条非空记录。迟到成功、重复扣款和支付—库存冲突的 payment 保持 null。该字段一经写入不可变，用来区分“预订主付款”和“必须退回的额外资金”。

### 4.1 refund_cases

最小字段：

- `id`
- `order_id`；
- `payment_id`，必须引用该订单的一条 `SUCCESS` payment，且全表唯一；
- `purpose`：闭合枚举 `ORDER_CANCELLATION | DUPLICATE_CHARGE | PAYMENT_INVENTORY_CONFLICT`；
- `reason`：闭合枚举 `USER_CANCELLED | VENUE_CANCELLED | AUTOMATIC_RECOVERY`；
- `requested_by_user_id`，用户或场馆工作人员；系统自动恢复时 nullable；
- `amount_cents`、`currency`，必须等于所引用成功 payment 的全额；
- `created_at`、`updated_at`。

`ORDER_CANCELLATION` 必须引用 `applied_to_order_at IS NOT NULL` 的主付款；`DUPLICATE_CHARGE` 必须引用非主付款且订单仍有另一条主付款；`PAYMENT_INVENTORY_CONFLICT` 必须引用非主付款且订单没有可履约的主付款。这些跨表条件由锁内 service 校验，并以真实 PostgreSQL 竞态测试冻结。

### 4.2 refund_attempts

最小字段：

- `id`
- `refund_case_id`
- `provider`
- `merchant_refund_no`，稳定且最长 32 字符；
- `provider_refund_no`，nullable；
- `status`：`CREATING | PROCESSING | SUCCESS | FAILED | UNKNOWN`；
- `attempt_no`，从 1 递增；
- `failure_code`，只存安全错误码；
- `next_reconcile_at`、租约 token/时间、`created_at`、`updated_at`、`refunded_at`。

约束：

- `(provider, merchant_refund_no)` 唯一；
- `refund_cases.payment_id` 唯一，不以 `order_id` 唯一；
- 每个 case 最多一个 `CREATING | PROCESSING | UNKNOWN` 活跃 attempt；
- `SUCCESS` 必须有 `refunded_at`；
- `UNKNOWN` 不允许创建第二个 attempt，只能用同一 `merchant_refund_no` 查单；
- 外部微信调用不得在数据库事务或行锁内执行。

## 5. 取消规则和竞态

### 5.1 待支付订单

没有任何可能已付款的支付记录时：

1. 依次锁定 `Slot → Order → Payment`；
2. 把订单改为 `CANCELLED`、写 `cancelled_at`；
3. 只释放该订单仍持有的原 `LOCKED` slot；
4. 同事务提交。

存在 `CREATING | PREPAY_CREATED | CONFIRMING | UNKNOWN | SUCCESS` 支付记录时：

- 只写 `cancel_requested_at`；
- 订单暂时保持 `PENDING_PAYMENT`，slot 保持 `LOCKED`；
- 页面投影显示“正在确认取消”，禁止重复取消和重新支付；
- worker 用原商户订单号查单，不能直接释放库存。

若微信权威结果为未支付且已关闭，则转 `CANCELLED` 并释放原锁。若支付先成功，则先转 `CONFIRMED`；距离开场不少于 24 小时自动进入全额退款，少于 24 小时保持 `CONFIRMED` 并提示联系客服，不自动退款或释放库存。

### 5.2 已确认订单

- 订单所有者仅在 `starts_at - now >= 24h` 时可以自助全额退款；
- 不足 24 小时不提供线上取消按钮；
- 有效且 `can_manage_inventory=true` 的场馆 membership 可以因场馆原因或协商例外发起全额退款，必须填写非空原因；
- 已核销订单本期不提供退款入口；平台异常退款留给后续独立运营切片；
- `COMPLETED` 不可退款；
- `ONBOARDING_REVIEWER` 没有订单或退款权限。

### 5.3 退款与库存

| 场景 | 退款处理中/失败/未知 | 退款成功 |
| --- | --- | --- |
| 用户原因的主付款取消 | slot 保持 `BOOKED` | 仅确认该订单仍独占预订时 slot → `AVAILABLE` |
| 场馆原因的主付款取消 | 仅确认该订单仍独占预订时 slot → `CLOSED` | slot 保持 `CLOSED` |
| 迟到/重复扣款 | 不修改 slot | 不修改 slot，订单继续保留正常主付款所对应的预订 |
| 支付—库存冲突 | 不修改 slot | 不修改 slot，防止关闭或释放其他订单、场馆关闭或新库存 |

库存归属证明必须在持锁事务中成立：当前 slot 与退款订单关联，且不存在另一条拥有 `CONFIRMED | REFUND_PENDING | REFUND_FAILED | COMPLETED` 预订权的订单。没有证明时只更新退款资金状态，不修改 slot。任何 `PAYMENT_EXCEPTION`、退款 `UNKNOWN` 或数据库异常都不得释放库存。

订单状态仅由 `ORDER_CANCELLATION` 或 `PAYMENT_INVENTORY_CONFLICT` case 推进到 `REFUND_PENDING | REFUND_FAILED | REFUNDED`。`DUPLICATE_CHARGE` case 的进度作为资金告警投影，不覆盖正常订单的 `CONFIRMED` 或 `COMPLETED` 状态。

### 5.4 精确状态—时间戳矩阵

- `EXPIRED` 当且仅当 `expired_at` 非空；其他状态的 `expired_at` 必须为空；
- `CANCELLED | REFUND_PENDING | REFUND_FAILED | REFUNDED` 必须同时具有 `cancel_requested_at` 和 `cancelled_at`；
- 取消请求在支付竞态中胜出时写两者；支付在不足 24 小时窗口内胜出时只保留 `cancel_requested_at` 作为审计，`cancelled_at` 为空、订单保持 `CONFIRMED`；
- `checked_in_at` 与 `checked_in_by_user_id` 必须同时为空或同时非空，只允许出现在 `CONFIRMED | COMPLETED`；
- `COMPLETED` 必须具有 checked-in pair、`completed_at` 和 `completed_by_user_id`；非 `COMPLETED` 的 completed pair 必须为空；
- `REFUND_PENDING` 对应控制订单状态的 case 最新 attempt 为 `CREATING | PROCESSING | UNKNOWN`；`REFUND_FAILED` 对应 `FAILED`；`REFUNDED` 对应经过权威校验的 `SUCCESS`；
- `DUPLICATE_CHARGE` case 不参与上述订单状态约束。

当支付在取消竞态中胜出但距开场不足 24 小时时，`cancel_requested_at` 保留，订单为 `CONFIRMED`，`allowed_actions` 全部禁止取消/退款并返回 `CANCELLATION_REQUIRES_SUPPORT`。本期不提供伪造的自动客服处理。

## 6. 场馆履约

场馆工作人员权限必须同时满足：

- active venue；
- active membership；
- `can_manage_inventory=true`。

`ONBOARDING_REVIEWER` 不具有履约权限。

### 6.1 今日订单

按场馆、上海自然日查询，返回订单号、场地、时间、脱敏联系人、状态、核销时间和 `allowed_actions`。默认只加载今天；前端可选择相邻日期，但不做报表或全文搜索。

### 6.2 到场核销

- 仅 `CONFIRMED`；
- 从开场前 2 小时起允许，开场后仍可核销；
- 写 `checked_in_at` 和 `checked_in_by_user_id`；
- 重复请求幂等地返回同一结果；
- 不改变 slot 的 `BOOKED` 历史归属。

### 6.3 完成履约

- 仅 `CONFIRMED`；
- 必须已经核销；
- 服务端 `now >= ends_at`；
- 写 `COMPLETED`、`completed_at`、`completed_by_user_id`；
- 重复请求幂等；
- 不自动完成，不释放或复用历史 slot。

锁顺序统一为：`Slot → Order → Payment/RefundCase → RefundAttempt`。

## 7. 服务器权威动作投影

订单详情、我的订单列表和场馆今日订单都返回闭合的 `allowed_actions`，客户端不得用本地时钟或角色猜测按钮：

```json
{
  "can_pay": false,
  "can_cancel": true,
  "can_check_in": false,
  "can_complete": false,
  "can_refund": false,
  "blocked_reason": null
}
```

`blocked_reason` 只返回安全、可展示的闭合原因，例如：

- `PAYMENT_RESULT_PENDING`
- `CANCELLATION_WINDOW_CLOSED`
- `REFUND_IN_PROGRESS`
- `CHECK_IN_TOO_EARLY`
- `CHECK_IN_REQUIRED`
- `SESSION_NOT_ENDED`
- `ORDER_TERMINAL`
- `CANCELLATION_REQUIRES_SUPPORT`

按钮仅在对应 `can_*` 为 true 时渲染；非交互状态使用普通 view，不使用空点击 button。

## 8. 最小 API 边界

用户：

- `POST /api/v1/orders/{order_id}/cancel`
- 现有 `GET /api/v1/orders` 和 `GET /api/v1/orders/{order_id}` 扩展状态、时间戳和 `allowed_actions`

场馆：

- `GET /api/v1/venues/{venue_id}/fulfillment/orders?service_date=YYYY-MM-DD&limit=&cursor=`
- `POST /api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in`
- `POST /api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete`
- `POST /api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund`

支付与退款通知：

- `POST /api/v1/payments/wechat/notify`
- `POST /api/v1/refunds/wechat/notify`

用户取消、场馆核销、完成和退款 mutation 都要求 `Idempotency-Key`：同一操作者、operation、资源和请求体重放首次业务结果；同键不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。check-in/complete 在业务层本身也幂等，响应丢失后读取或重放不得产生第二次状态变化。支付/退款通知以 provider、商户单号和 provider 单号唯一性幂等；worker 以原 payment/refund attempt 和租约恢复，不创建新业务单。资源不存在和越权都返回同一 404，数据库或 Provider 不可用返回 503；状态冲突返回闭合 409 错误码。

## 9. 微信支付 Provider 边界

现有 `PaymentProvider` 继续作为窄接口，新增：

- `CreatePrepayRequest.time_expire`，来自订单 `expires_at`；
- 长度不超过 32 的稳定唯一 `merchant_order_no`；
- `RefundProvider.create_refund/query_refund`；
- 支付和退款通知的原始 body 验签、AEAD_AES_256_GCM 解密边界。

退款 Provider 的成功结果必须返回闭合 `AuthoritativeRefundFacts`：

- `provider`
- `merchant_id`
- `merchant_refund_no`
- `provider_refund_no`
- `merchant_order_no`
- `provider_transaction_no`
- `amount_cents`
- `currency = CNY`
- `refunded_at`

收敛服务在写 `SUCCESS` 前必须同时核对：provider、商户主体、商户退款单号、所引用成功 payment 的商户订单号与微信交易号、全额金额和币种。任一不匹配进入安全失败/异常记录，不得把订单改为 `REFUNDED`，不得修改库存。只有验签、解密且业务字段全部匹配的权威成功才能触发退款终态。

生产配置最小包括：

- 微信支付商户号 `mchid`；
- 商户 API 证书序列号和私钥；
- 微信支付公钥 ID 和 PEM；
- 32 字节 API v3 密钥；
- 与商户号绑定的当前小程序 AppID；
- 无查询参数的公网 HTTPS 支付、退款回调 URL。

服务端调用 `api.mch.weixin.qq.com`，不加入小程序 request 合法域名；小程序继续使用现有 `wx.requestPayment`。没有真实商户配置时，staging 必须诚实返回 `503 PAYMENT_PROVIDER_UNAVAILABLE`，不得把 Mock 作为生产降级。

可在无商户凭证时完成和测试：配置校验、RSA 请求签名/应答验签、回调验签、AES-GCM 解密、注入式 HTTP transport、通知幂等、worker 接线。真实扣款、通知、关单和退款只在用户提供商户配置后各做一次受控小额真机验收。

## 10. B2 订单资格

后续队长创建球局只接受：

- 订单 `status = CONFIRMED`；
- `cancel_requested_at IS NULL`；
- 没有 `ORDER_CANCELLATION | PAYMENT_INVENTORY_CONFLICT` refund case；
- 开场时间严格晚于服务端当前时间 2 小时；恰好 2 小时或更近时不可新建球局；
- 每个订单最多一条未取消球局。

已有球局进入开场前 2 小时窗口时不自动取消，只停止新申请。

`DUPLICATE_CHARGE` 只处理额外资金，不改变已经由主付款获得的预订权；无论该额外退款处于处理中、失败还是成功，都不阻止创建或继续球局，但用户订单页必须继续诚实显示资金告警。

`REFUND_PENDING`、`REFUND_FAILED`、`PAYMENT_EXCEPTION` 暂停已发布球局；`CANCELLED`、`REFUNDED` 取消球局；`COMPLETED` 只允许赛后到场记录，不再新建球局。

## 11. 分阶段和并行边界

### 串行共享基础

先由一个任务独占修改：

1. 订单/退款状态图和迁移；
2. refund 表、约束、锁顺序和 repository 接口；
3. OpenAPI 的共享 schema、动作投影和错误码；
4. Provider request/result 协议；
5. B2 资格纯函数。

### 基础稳定后并行

- 用户取消退款：小程序订单详情/列表 + 用户取消服务；
- 场馆履约：今日订单、核销、完成、场馆退款；
- 微信 Provider：支付/退款 HTTP adapter、通知和 worker；
- B2 队长组局：只做 Artifact、development Fixture 和闭合契约，不写依赖未稳定状态的生产后端。

并行任务不得再次修改共享枚举、迁移或同一 OpenAPI schema；需要变化时回到集成协调任务串行处理。

## 12. 最小验收

- PostgreSQL 迁移可升级/降级，约束覆盖状态—时间戳、每条成功 payment 最多一个 refund case、每个订单最多一个主付款和单活跃 attempt；
- 用户看不到他人订单，场馆人员看不到未授权场馆订单；
- 取消与支付竞态、重复扣款、支付—库存冲突、退款 UNKNOWN 和无归属证明时库存不变均有真实 PostgreSQL 聚焦测试；
- 核销窗口、幂等核销、结束前不可完成有聚焦测试；
- 前端每个可见按钮都有真实 API 行为，非可用动作不渲染假按钮；
- production 包不含支付 Mock 或 development Fixture；
- 缺少微信商户配置时不宣称支付完成，返回明确可重试错误；
- 只进行一笔真实小额支付和一笔退款验收，避免重复真实资金调用。
