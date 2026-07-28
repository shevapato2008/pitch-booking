# 足球场预订小程序：支付确认与已确认订单切片设计

日期：2026-07-28

状态：已获用户设计确认；独立规格审查通过；待用户书面审阅

上游需求：[天津足球场预订小程序初版 PRD](../../../superpowers/tracks/overview-20260721/prd.md)

前序规格：[确认订单与待支付订单切片设计](./2026-07-27-booking-confirmation-and-pending-order-design.md)

## 1. 目标与用户旅程

本规格覆盖第三条用户旅程：

`待支付订单 → 创建预支付单 → 调起开发态收银台 → 支付确认中 → 服务端通知或主动查单确认 → 已确认订单`

本切片完成后，用户可以在待支付订单有效期内发起支付。客户端收银台的成功回调只把页面带入“支付确认中”；支付适配器的权威结果到达服务端后，服务端在同一事务内把支付改为成功、订单改为 `CONFIRMED`、场次改为 `BOOKED`。客户端轮询订单详情并收敛为真实的预订成功状态。

由于真实微信支付资质、商户配置、公网回调和真机支付条件尚未具备，本地开发使用明确隔离的 `MockPaymentProvider`。真实微信 API v3 Provider、通知验签解密、商户联调和最终交付保留到外部条件满足后的最后一步。

## 2. 本切片范围

包含：

- 待支付订单的“立即支付”入口；
- 创建或幂等重放同一个预支付业务结果；
- 开发态模拟收银台的成功、用户关闭和调起失败；
- 支付确认中状态；
- 服务端权威成功确认；
- 通知重复、支付重复点击和主动查单补偿；
- 预支付单存在时的安全超时、查单和关单；
- 权威状态未知时的持久化恢复与 `PAYMENT_EXCEPTION` 安全状态；
- 已确认订单详情；
- 本地真实 HTTP、PostgreSQL、微信开发者工具和自动化验收。

不包含：

- 用户主动取消订单入口与 `POST /orders/{id}/cancel`；该旅程属于下一切片；
- 退款、迟到支付后的自动退款和运营异常后台；
- 球局创建；已确认页只保留后续入口位置，不提供虚假可用按钮；
- 真实微信商户下单、真实通知回调、真机 `wx.requestPayment` 和生产发布。

“关闭微信收银台”不是取消订单。用户关闭开发态收银台后，订单仍为 `PENDING_PAYMENT`，在有效期内可以再次发起支付。

## 3. 已选页面方案

采用“订单详情页原地演进”，复用现有订单详情结构，不新增支付向导或独立结果页。

不采用：

- 独立支付结果页：支付结果未知时容易把客户端回调误表达为成功，并增加返回栈复杂度；
- 多步支付向导：只有一个支付动作，额外步骤没有用户价值；
- 底部弹层承载全部状态：确认中和异常恢复可能持续较久，弹层不适合成为权威订单状态容器。

目标视口固定为 375×812。Artifact 和真实小程序实现都必须在该视口生成参考图、实现图、并排图、50% 叠加图和差异图。

沿用现有设计系统：系统字体、背景 `#F8FAFC`、白色表面、正文 `#10243E`、次要文字 `#64748B`、边框 `#DBE5EC`、可信蓝 `#0284C7`、辅助蓝 `#0EA5E9`、可订绿 `#059669`。所有普通文字按实际背景重新验证至少 4.5:1 对比度，触控目标不小于 44px，间距遵循 4/8px 节奏，固定底栏尊重底部安全区域。

## 4. 三个核心视觉状态

### 4.1 待支付

- 顶部状态区显示“待支付”和服务端截止时间推导的倒计时；
- 主体继续展示订单编号、场馆、场地、日期时间、金额、联系人、导航、客服电话和取消规则；
- 固定底栏左侧显示合计金额，右侧主按钮为“立即支付”；
- 点击后立即进入提交态，按钮文案为“正在发起支付…”，并禁用重复点击；
- 页面不展示尚未实现的主动取消订单按钮。

### 4.2 支付确认中

- 保持订单详情空间结构稳定，避免回调后页面跳动；
- 顶部状态区显示中性加载图形、标题“正在确认支付”和说明“支付结果以服务端确认为准，请勿重复付款”；
- 底栏主按钮禁用并显示“支付确认中…”；
- 页面每 2 秒查询一次订单详情，前 30 秒保持主动确认；超过 30 秒后降低频率并提供“重新查询”按钮；
- 网络失败、客户端回调未知或 Provider 暂时不可达都不能显示支付成功。

### 4.3 预订成功

- 顶部使用可订绿的确认图标和“预订成功”，辅文显示订单已确认；
- 状态卡突出场馆、场地、日期时间和订单号，金额仍作为已支付快照展示；
- 主体保留联系人、导航、客服电话和取消规则；
- 底栏不再显示支付按钮，改为“查看预订详情”或无操作的稳定详情态；
- “创建球局”若尚未进入下一切片，只显示为说明性后续能力，不渲染可点击按钮。

`PAYMENT_EXCEPTION` 不是第四套主视觉稿。它复用“支付确认中”的空间结构，改为明确的异常说明、锁定保持语义和“重新查询”操作，不显示成功或场次已释放。

## 5. 页面状态机与权威边界

客户端页面状态：

```text
PENDING_READY
  → CREATING_PREPAY
  → CASHIER_OPEN
  → PAYMENT_CONFIRMING
  → CONFIRMED

CASHIER_OPEN → PENDING_READY          用户关闭收银台
CREATING_PREPAY → PENDING_READY       明确可重试失败
PAYMENT_CONFIRMING → PAYMENT_EXCEPTION 长时间无权威结果
```

服务端权威业务状态：

```text
Order:   PENDING_PAYMENT → CONFIRMED | EXPIRED | PAYMENT_EXCEPTION
Slot:    LOCKED          → BOOKED    | AVAILABLE
Payment: CREATING → PREPAY_CREATED → CONFIRMING | SUCCESS | CLOSED | UNKNOWN
```

权威边界：

- 客户端收银台回调不是支付成功依据；
- 只有支付 Provider 的已验证通知或主动查单成功结果可以确认订单；
- 服务端金额只来自 `orders.price_cents`，不接受客户端金额；
- 通知或查单结果必须同时核对订单号、金额、币种、AppID 和商户主体；
- 客户端倒计时只控制显示，不能释放场次；
- 一旦存在预支付单，本地超时必须先查单，确认未支付并成功关单或权威状态为 `CLOSED` 后才能释放原订单仍持有的锁；
- 未获得权威结果时保持场次 `LOCKED`，宁可进入异常恢复，也不能错误释放后被重复出售。

支付切片上线迁移后，是否存在未终结支付尝试以 `payments` 表为唯一权威。旧 `orders.wechat_prepay_id` 不再作为安全释放依据；迁移可以删除该字段，或在过渡期只把它作为兼容投影原子同步，但所有过期路径都必须检查 `payments`，任何 `CREATING/PREPAY_CREATED/CONFIRMING/UNKNOWN` 记录都禁止快速释放。

## 6. 小程序边界

在既有订单详情能力上增加窄接口：

```ts
interface PaymentDataSource {
  createPayment(orderId: string, idempotencyKey: string): Promise<
    | { outcome: "PREPAY_CREATED"; paymentId: string; launchParams: PaymentLaunchParams }
    | { outcome: "PAYMENT_CONFIRMING"; paymentId: string }
    | { outcome: "ALREADY_CONFIRMED"; order: OrderDetail }
  >;
  reconcilePayment(orderId: string, paymentId: string): Promise<
    | { outcome: "PAYMENT_CONFIRMING"; order: OrderDetail }
    | { outcome: "TERMINAL"; order: OrderDetail }
  >;
  getOrder(orderId: string): Promise<OrderDetail>;
}

interface PaymentCapability {
  requestPayment(params: PaymentLaunchParams): Promise<
    | { outcome: "cashier_success" }
    | { outcome: "user_cancelled" }
    | { outcome: "launch_failed"; message: string }
  >;
}
```

`PaymentCapability` 只包装平台收银台行为，不决定订单状态。真实入口最终绑定 `wx.requestPayment`；开发入口绑定显式模拟收银台。生产构建不得包含开发场景开关、固定支付结果或自动降级逻辑。

订单详情 presentation 层负责：

- 根据订单与支付投影生成三种核心状态；
- 使用同一幂等键重试同一次创建预支付请求；
- 客户端收银台成功后进入确认轮询；
- 用户关闭收银台后恢复待支付；
- 页面隐藏或后台时停止高频轮询，恢复前台后立即重新查询；
- 页面卸载时清理定时器，防止重复轮询。

## 7. HTTP 契约

### 7.1 创建或重放预支付

`POST /api/v1/orders/{order_id}/pay`

请求头必须包含 `Authorization` 和 `Idempotency-Key`。请求体为空或使用固定版本对象，不接收金额。

成功响应至少包含：

```json
{
  "order_id": "uuid",
  "payment_id": "uuid",
  "status": "PREPAY_CREATED",
  "launch_params": {
    "timeStamp": "...",
    "nonceStr": "...",
    "package": "prepay_id=...",
    "signType": "RSA",
    "paySign": "..."
  }
}
```

开发 Provider 返回结构相同但带内部开发标记；该标记只能存在于 development 运行时，不能进入正式包或正式响应。

同一用户、同一订单、同一幂等键和相同请求必须重放首次业务结果。重复点击不能创建多个有效支付记录或多个有效商户订单号。相同键用于不同订单返回 `IDEMPOTENCY_KEY_REUSED`。

即使用户关闭收银台后使用新的幂等键再次点击支付，服务端也必须复用该订单现有的未终结支付记录与预支付单，而不是创建新商户订单号。数据库使用部分唯一约束保证每个订单最多一个 `CREATING/PREPAY_CREATED/CONFIRMING/UNKNOWN` 支付记录；Provider 维度分别唯一约束 `(provider, merchant_order_no)` 和非空的 `(provider, provider_transaction_no)`。

预支付创建采用“本地门禁先落库、外部调用不持锁、结果再收敛”的三段流程：

1. 先生成唯一商户订单号，在短事务中按统一顺序锁定场次和订单，插入 `CREATING` 支付记录并提交；
2. 不持有任何数据库行锁调用 Provider `create_prepay`；
3. 在新短事务中按相同锁顺序重查并把结果写为 `PREPAY_CREATED`；若调用结果未知则写 `UNKNOWN`，保留商户订单号供 worker 主动查单。

因此 Provider 已受理但本地进程崩溃时，已提交的 `CREATING` 记录仍会阻止旧快速过期，并可用商户订单号恢复。Provider 明确拒绝且确认未创建预支付单时才把该尝试转 `CLOSED`，允许后续新尝试。

`CREATING` 恢复必须区分两个崩溃窗口：按商户订单号查到 Provider 订单时收敛为其权威状态；查无 Provider 订单且本地订单仍未到期时，使用同一商户订单号安全重试 `create_prepay`，不得创建第二个商户订单号。现有幂等记录扩展为可持久化 `PROCESSING`、关联 `payment_id` 及最终响应；同键重放或新键再次点击都加入该订单当前未终结支付尝试。尚未得到 launch params 时统一返回既定 `202 PAYMENT_CONFIRMING`，进程重启后仍可继续。

### 7.2 请求立即对账

`POST /api/v1/orders/{order_id}/payments/{payment_id}/reconcile`

客户端收银台返回成功后调用该接口。它只表达“请服务端立即查单”，不是支付成功声明。服务端把未终结支付推进为 `CONFIRMING`、令 `next_reconcile_at = now`，并可执行一次受超时限制的主动查单：已经权威成功时返回 `200` 和订单投影，仍无终态时返回 `202` 和确认中投影。重复调用幂等。

### 7.3 支付通知

`POST /api/v1/payments/wechat/notify`

真实 Provider 最终使用原始请求体验签并解密微信 API v3 通知。开发 Provider 使用单独的、仅 development 注册的模拟通知入口或内部测试驱动，不允许生产路由绕过验签。

通知处理必须幂等：以 Provider、商户订单号和交易号建立唯一性，锁定支付、订单和场次后重查状态。重复成功通知只返回相同成功确认，不重复修改订单、场次或触发后续动作。

### 7.4 订单详情投影

现有 `GET /api/v1/orders/{order_id}` 扩展：

- 订单状态支持 `CONFIRMED` 和 `PAYMENT_EXCEPTION`；
- 增加 `payment_state`、`payment_confirming`、`paid_at` 和可重试提示；
- `PENDING_PAYMENT` 且截止时间已过时调用统一支付收敛服务；
- 权威结果未知时返回真实的确认中或异常状态，不伪装为过期。

冻结 OpenAPI 时采用以下精确响应矩阵：

| 接口 | 情况 | HTTP | 结果 |
| --- | --- | ---: | --- |
| `POST /orders/{id}/pay` | 新建预支付成功 | 201 | `PREPAY_CREATED` 与 launch params |
| `POST /orders/{id}/pay` | 重放或复用未终结预支付 | 200 | 同一 payment 与 launch params |
| `POST /orders/{id}/pay` | 订单已经确认 | 200 | `ALREADY_CONFIRMED` 与订单投影，无 launch params |
| `POST /orders/{id}/pay` | Provider 结果未知 | 202 | `PAYMENT_CONFIRMING`，无可用 launch params |
| `POST /orders/{id}/pay` | 订单过期或支付异常 | 409 | 标准错误信封 |
| `POST /orders/{id}/pay` | 不存在或越权 | 404 | `ORDER_NOT_FOUND` |
| `POST /orders/{id}/payments/{payment_id}/reconcile` | 权威终态已获得 | 200 | 最新订单投影 |
| `POST /orders/{id}/payments/{payment_id}/reconcile` | 仍待权威结果 | 202 | 最新订单投影 |
| `GET /orders/{id}` | 任何可见订单状态 | 200 | 最新订单投影 |

订单投影使用封闭 schema。`status`、`payment_state`、`payment_confirming`、`closing_payment` 必填；没有支付记录时 `payment_state` 为 `null`。`paid_at` 必填但 nullable，只有权威到账后非空。组合优先级如下：

| 订单状态 | 支付状态 | `payment_confirming` | `closing_payment` | 页面语义 |
| --- | --- | --- | --- | --- |
| `PENDING_PAYMENT` | `null` | false | false | 待支付 |
| `PENDING_PAYMENT` | `CREATING/PREPAY_CREATED` | false | false | 待支付或收银台打开中；客户端本地成功可暂显确认中 |
| `PENDING_PAYMENT` | `CONFIRMING/UNKNOWN` | true | false | 支付确认中 |
| `PENDING_PAYMENT` | `CLOSED` 且未到期 | false | false | 待支付，允许创建新的支付尝试 |
| `PENDING_PAYMENT` | 任一未终结状态且已到期 | true | true | 正在查单/关单，禁止释放表达 |
| `CONFIRMED` | `SUCCESS` | false | false | 预订成功，`paid_at` 非空 |
| `EXPIRED` | `null/CLOSED` | false | false | 已过期，场次已安全释放 |
| `PAYMENT_EXCEPTION` | `SUCCESS` 或 `UNKNOWN` | false | false | 支付异常，场次不宣称可用 |

订单可能保留多个历史已终结支付尝试，但最多一个未终结尝试。订单详情的支付投影依次选择：任何 `SUCCESS` 记录；否则当前未终结记录；否则最新终结记录。`paid_at` 只来自被选中的 `SUCCESS` 记录。

普通用户仍只能访问自己的订单，越权与不存在统一返回 `404 ORDER_NOT_FOUND`。

## 8. 数据模型与事务

新增独立 `payments` 表，至少保存：

- `id`、`order_id`、Provider；
- 唯一商户订单号、nullable Provider 交易号；
- 金额与币种快照；
- `CREATING/PREPAY_CREATED/CONFIRMING/SUCCESS/CLOSED/UNKNOWN` 状态；
- Provider 预支付标识；
- `paid_at`、通知处理结果；
- `reconcile_attempts`、`next_reconcile_at`、`last_error_code`、`last_error_at`；
- 创建与更新时间。

订单状态约束扩展为 `PENDING_PAYMENT/CONFIRMED/EXPIRED/PAYMENT_EXCEPTION`。本切片不生成 `CANCELLED`。时段继续使用 `AVAILABLE/LOCKED/BOOKED/CLOSED`。

所有订单创建、支付创建、过期、通知和主动查单收敛统一使用“场次 → 订单 → 支付”的锁顺序。处理入口先无锁定位关联 ID，再按该顺序加锁并重查；不得在持有数据库行锁时调用 Provider 网络接口。现有过期服务必须同步升级到该顺序，不能保留相反锁序。

权威成功处理在一个 PostgreSQL 事务内：

1. 无锁定位支付、订单和时段 ID；
2. 依次锁定时段、订单和支付记录；
3. 再次校验 Provider 主体、商户订单号、金额和币种；
4. 若已成功则幂等返回；
5. 若时段仍由该订单锁定，则可以履约；若时段为 `AVAILABLE`、没有后续有效订单且未 `CLOSED`，也可以原子恢复归属后履约；
6. 可履约时支付转 `SUCCESS`，订单转 `CONFIRMED`，时段转 `BOOKED` 并清除临时锁截止字段；
7. 保存 Provider 交易号与支付时间并提交。

如果权威成功到达时场次已属于其他有效订单或已经 `CLOSED`，不得覆盖。资金事实仍必须记为支付 `SUCCESS` 并保存交易号与支付时间，只有订单转 `PAYMENT_EXCEPTION`；后续退款旅程处理资金。本切片通过测试保证正常超时流程不会提前释放，从源头降低该分支发生概率。

## 9. Provider 与恢复任务

后端定义窄接口：

```text
create_prepay(order) → launch params + provider identifiers
query_payment(payment) → SUCCESS | NOT_PAID | CLOSED | UNKNOWN
close_payment(payment) → CLOSED | SUCCESS | UNKNOWN
```

`MockPaymentProvider`：

- 仅在 `APP_ENV=development` 且显式启用时注册；
- 支持固定场景：成功、用户关闭、通知延迟、重复通知、查单成功、未知结果和关单失败后恢复；
- 所有结果仍通过真实服务、数据库事务和 HTTP 投影收敛；
- staging/production 检测到 Mock 配置时拒绝启动。

恢复 worker 复用现有 worker 框架，但支付收敛与订单过期保持独立服务边界：

- 每分钟扫描到期的 `CREATING/PREPAY_CREATED/CONFIRMING/UNKNOWN` 支付；预支付创建成功时即持久化首次 `next_reconcile_at`，通知丢失也不会等到订单十分钟到期才首次查单；
- 使用 1、2、5、10、30 分钟退避，随后每 30 分钟重试，并记录次数与最后错误；
- 自首次未知结果满 24 小时仍无权威终态时，把订单转 `PAYMENT_EXCEPTION`，支付保留真实的 `UNKNOWN`，此后每 6 小时继续查单直到 `SUCCESS/CLOSED`；
- 服务重启后从数据库继续；
- 待支付订单到期且存在预支付单时先查单；已支付则确认，未支付则关单；只有得到 `CLOSED` 才将订单转 `EXPIRED` 并释放仍属于它的场次；
- Provider 未知或不可达时保持锁定并安排重试。

异常恢复使用统一终态矩阵：

- `PAYMENT_EXCEPTION + SUCCESS`：按第 8 节到账成功规则重新判断可履约性；资金事实保持 `SUCCESS`，可履约则恢复 `CONFIRMED/BOOKED`，不可履约则保持订单异常等待后续退款；
- `PAYMENT_EXCEPTION + CLOSED` 或权威确认从未支付：在同一事务把支付转 `CLOSED`、订单转 `EXPIRED`，并且只释放仍由原订单持有的场次；
- `PAYMENT_EXCEPTION + UNKNOWN`：不释放场次，继续每 6 小时主动查单。

## 10. 错误处理

至少覆盖：

| 错误码 | HTTP | 前端语义 |
| --- | ---: | --- |
| `AUTH_REQUIRED` | 401 | 重新建立业务会话 |
| `ORDER_NOT_FOUND` | 404 | 订单不存在或不可访问 |
| `ORDER_EXPIRED` | 409 | 停止支付并返回重新选场 |
| `PAYMENT_ALREADY_CONFIRMED` | 200 | `POST /pay` 返回已确认投影，不能再次付款 |
| `PAYMENT_CREATE_FAILED` | 502/503 | 保持待支付，允许同键重试 |
| `PAYMENT_CONFIRMING` | 202 | `POST /pay` 或 reconcile 尚无权威终态，显示确认中 |
| `PAYMENT_EXCEPTION` | 409 | `POST /pay` 拒绝新支付；订单详情仍以 200 返回真实异常投影 |
| `IDEMPOTENCY_KEY_REUSED` | 409 | 丢弃错误键并记录开发错误 |

支付通知金额、币种、AppID、商户号或订单号不一致时拒绝确认，记录审计信息并进入人工可追踪的异常状态。日志不得包含商户私钥、API v3 密钥、完整签名材料、会话令牌或完整手机号。

## 11. Artifact、Fixture 与删除条件

先建立三份 375×812 Artifact 状态：

1. `payment-pending`；
2. `payment-confirming`；
3. `booking-confirmed`。

Fixture 使用固定订单、场馆、时间、金额和联系人，所有模拟支付状态放在开发场景目录并通过显式入口装配。视觉确认后，真实小程序开发入口可以暂时使用这些场景驱动页面；完成后端集成时，支付状态必须改由真实 HTTP 与 PostgreSQL 返回，生产代码不得读取业务 Fixture。

本地验收后可以保留开发支付测试工具，但必须满足：

- 生产构建不可引用 Fixture 或 `MockPaymentProvider`；
- staging/production 配置不能启用 Mock；
- 开发 UI 明确标记模拟收银台，不得让测试人员误认为真实扣款；
- 最终外部交付完成后删除运行路径中的支付 Fixture 绑定，测试夹具可以继续留在测试目录。

## 12. 测试与验收

### 12.1 视觉门

在 375×812 对三个核心状态分别生成参考图、微信开发者工具实现图、并排图、50% 叠加图和差异图。差异记录覆盖构图、几何间距、组件层级、字体色彩材质、图标素材、文案和状态语义。

自动布局测试通过不等于视觉通过。用户明确确认前，不得开始本切片 OpenAPI、数据库或后端实现。

### 12.2 前端

- 待支付、创建预支付、收银台成功、用户关闭、调起失败、确认中、确认成功和异常恢复；
- 同一操作复用幂等键，新的用户支付尝试才生成新键；
- 客户端成功回调不能直接生成 `CONFIRMED`；
- 页面隐藏、恢复和卸载时轮询行为正确；
- decoder 接受新增状态并拒绝未知状态；
- 生产包不含开发支付场景或模拟 Provider 绑定。

### 12.3 后端

- 金额只能来自订单快照；
- 重复点击只创建一个有效预支付业务结果；
- 重复通知只确认一次；
- 金额、币种或主体不一致不能确认；
- 权威成功原子完成 `Payment SUCCESS + Order CONFIRMED + Slot BOOKED`；
- 客户端回调不能修改服务端订单；
- 用户关闭收银台后订单仍可重试；
- 到期预支付单未确认关闭前绝不释放库存；
- worker 重启后从数据库恢复查单任务；
- Provider 暂时失败按持久化退避恢复；
- 越权订单与支付访问保持 404 隐藏语义；
- 日志与响应不泄露敏感支付配置。

### 12.4 本地旅程验收

本地验收链路必须使用真实小程序 HTTP adapter、真实 FastAPI 服务和真实 PostgreSQL：

`打开待支付订单 → 点击立即支付 → 开发态模拟收银台成功 → 页面显示支付确认中 → 模拟权威通知或 worker 查单 → 页面显示预订成功 → 数据库订单 CONFIRMED 且场次 BOOKED`

## 13. 最终交付暂留

因 ICP、微信认证与支付商户条件未完成，下列步骤保留为本模块最后一步：

- 小程序 AppID 与商户号绑定、经营类目及支付权限；
- 商户私钥、证书序列号、API v3 密钥和微信平台证书配置；
- 真实 `WeChatPaymentProvider` 与原始请求体验签、通知解密；
- 公网 HTTPS 通知地址与微信合法域名；
- 真机 `wx.requestPayment`；
- 至少 5 笔真实小额支付、通知、主动查单和关单联调；
- iOS/Android 真机验收；
- 删除运行路径中的模拟支付绑定并归档最终证据；
- 部署与正式交付。

完成本地验收后，本切片标记为“本地开发验收通过，最终外部交付待办”，不得声称真实微信支付已经上线。
