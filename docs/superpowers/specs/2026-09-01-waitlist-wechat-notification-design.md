# C2b 候补转正微信订阅消息生产能力设计

日期：2026-09-01

状态：`CODE_CAPABILITY_WITH_EXTERNAL_ACCEPTANCE_GATE`。本设计补齐 C2b 已有 FIFO/outbox 基础的真实微信订阅消息代码能力；当前 staging 继续关闭，且在运营方提供并核对真实模板、关键词和真机送达前，不得宣称通知已生产完成。

上游：

- [C2b 候补 FIFO 与递补通知基础设计](./2026-08-30-waitlist-fifo-foundation-design.md)
- [C2b 候补 FIFO 基础实施计划](../plans/2026-08-30-waitlist-fifo-foundation.md)

## 1. 目标与边界

本切片只补以下闭环：

```text
玩家在原始“提交申请”点击中请求一次候补转正订阅授权
→ 无论接受、拒绝、封禁、API 失败或超时，都继续同一次真实申请
→ 后续 FIFO 转正仍只写一条既有 durable outbox
→ worker 在开场前重新验证权威状态
→ 仅在显式启用且配置完整时，由真实微信 Provider 发送订阅消息
→ 微信拒绝/失败只收敛 outbox，不反转 JOINED
```

严格不做：不保存用户订阅回执或 access token；不新增通知偏好页；不在未知申请结果恢复、登录恢复或重放时再次索要订阅；不把订阅接受展示为“通知一定送达”；不在 staging 启用；不实际发送外部消息；不承诺 Provider 不支持的端到端恰好一次。

## 2. 方案选择

比较过三种客户端模板来源：硬编码、后端下发、构建时注入。硬编码会把运营模板与代码版本耦合；后端下发需要新增公开契约和运行时同步；构建时注入能沿用现有 `miniprogram/config/runtime.ts` 与发布生成器，并在未配置时自然关闭，因此采用构建时注入。

Provider token 可以与手机号 Provider 共用，也可以由通知 Provider 独立缓存。共用会让两个能力共享可变失效状态和生命周期；本切片采用独立实例缓存，但复用相同的严格 timeout、双重检查锁和日志降噪模式。

worker 可以注入一个“disabled provider”，也可以完全不组合通知扫描器。前者容易误把禁用当发送失败或成功；本切片保持现有 fail-closed 语义：`disabled` 时不构造 Provider、不组合通知扫描器、outbox 保持 `PENDING`。

## 3. 小程序授权交互

生产构建新增两个非敏感运行时值：

- `MINIPROGRAM_OPEN_GAME_NOTIFICATION_PROVIDER=disabled|wechat`，默认 `disabled`；
- `MINIPROGRAM_WAITLIST_PROMOTED_TEMPLATE_ID`，仅 provider 为 `wechat` 时必填并严格校验。

只有两者共同有效时，production composition 才注册 `WaitlistPromotionSubscriptionCapability`。申请页在 `READY` 状态显示一行辅助说明：“若进入候补，转正时可收到微信提醒；拒绝授权不影响申请。”原“提交申请”按钮仍是唯一主 CTA，尺寸、底栏与 safe area 不变。

`onSubmit` 先同步完成既有本地校验和账号/服务端权限校验，然后必须在原始 tap 调用栈内、任何 `await` 之前直接调用一次 `wx.requestSubscribeMessage({ tmplIds: [templateId] })`。能力把 `accept`、`acceptWithAlert`、`acceptWithAudio`、`acceptWithForcePush` 归为接受；其余成功结果归为拒绝；fail 与同步异常归为不可用。页面忽略这三类结果并继续创建原有 durable attempt 与真实 HTTP 申请。请求期间立即进入不可重复点击的提交态。

无 callback 与明确 fail 不同：8 秒 timeout 后不能假设原生授权层已经关闭，更不能在用户仍可能操作弹窗时悄悄后台提交。能力返回独立 `TIMED_OUT`，页面进入“提醒授权结果未返回，本次申请尚未提交”的锁定态，不创建 attempt、不调用申请 API；晚到 success/fail 由 single-settlement 与页面 generation guard 忽略。用户可返回并重新进入申请页，随后由一个新的真实 tap 重试。

订阅请求只存在于 fresh `onSubmit` 路径。`RESULT_UNKNOWN`、`onConfirmResult`、登录恢复与已有 attempt 的精确重放直接沿用原 attempt，绝不再次调用订阅 API。未配置 capability 时保持原申请行为和原视觉，不显示可能误导的提醒承诺。

## 4. 后端配置与 Provider

后端新增：

- `OPEN_GAME_NOTIFICATION_PROVIDER=disabled|wechat`，默认 `disabled`；
- `OPEN_GAME_NOTIFICATION_TEMPLATE_ID`；
- `OPEN_GAME_NOTIFICATION_KEYWORD_MAPPING_JSON`，必须是且只能是 `game_name`、`starts_at`、`venue_name` 三个键；值分别匹配 `thingN`、`timeN`、`thingN`，且互不重复；
- `OPEN_GAME_NOTIFICATION_MINIPROGRAM_STATE=formal|trial|developer`，默认 `formal`，供未来体验版验收显式选择，不随环境猜测。

`wechat` 仅在 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、模板 ID 和封闭关键词映射全部有效时可构建；不完整配置在启动时失败。`disabled` 即使残留完整凭据也不构建或消费 outbox。关键词映射以 `SecretStr` 读取并在设置 repr、校验异常和日志中隐藏，避免未来错误地把运营配置原文扩散到日志。

`WeChatOpenGameNotificationProvider` 使用独立 `httpx.Client` 和独立内存 access-token cache。token 请求和订阅发送均使用 connect/read/write/pool 的严格 timeout；token 只进入请求内存和 HTTPS query，不持久化、不进入 DTO/repr/异常或日志。完整 `send` 最多执行 token 获取、发送、一次 token 失效刷新与一次重发，仍低于现有 30 秒 Provider 合同。

Provider 只接受既有 `template_key=waitlist-promoted`、匹配配置 AppID 的 recipient 和封闭 payload。它把 `starts_at` 解析为带时区 ISO 时间并按 `Asia/Shanghai` 格式化；球局名和场馆名按微信 `thing` 字段限制安全截断。固定 deeplink 为 `pages/my-game-registrations/index`，让收件人进入权威报名列表，不依赖 outbox 中不存在的分享 token。

发送 body 只能包含：

```json
{
  "touser": "<openid>",
  "template_id": "<configured template>",
  "page": "pages/my-game-registrations/index",
  "miniprogram_state": "formal|trial|developer",
  "lang": "zh_CN",
  "data": {
    "<thingN>": {"value": "<game_name>"},
    "<timeN>": {"value": "<Asia/Shanghai starts_at>"},
    "<thingN>": {"value": "<venue_name>"}
  }
}
```

## 5. 安全错误码与重试分类

Provider 绝不把原始微信 body 或消息带回 worker，只返回既有 `NotificationAccepted` 或封闭 `NotificationRejected`：

- access token 过期/无效：清除本实例 cache 后最多刷新并重发一次；仍失败为 `WECHAT_TOKEN_REJECTED`，不可重试；
- token 网络、timeout、HTTP 5xx 或微信 `-1`：`WECHAT_TOKEN_UNAVAILABLE`，可重试；
- 发送网络、timeout、HTTP 5xx、微信 `-1` 或频控：`WECHAT_NOTIFICATION_TEMPORARY`，可重试；
- 用户未订阅/拒收：`RECIPIENT_UNSUBSCRIBED`，不可重试；
- 模板、关键词、页面或收件人被微信明确拒绝：分别收敛为 `TEMPLATE_INVALID`、`TEMPLATE_DATA_INVALID`、`PAGE_INVALID`、`RECIPIENT_INVALID`，不可重试；
- 未识别微信业务错误：`WECHAT_NOTIFICATION_REJECTED`，不可重试，避免无限重试未知永久错误；
- 内部 template key/AppID/payload 不匹配：在 Provider I/O 前返回安全不可重试错误。

worker 捕获任何未预期异常时仍只写既有 `PROVIDER_IO_FAILED`，不会记录异常正文。

## 6. 开场门禁与事务语义

`prepare_claim` 在既有 Order → OpenGame → Registration → Outbox 锁序中只读取一次权威 UTC `now`。除了当前 `JOINED + PUBLISHED + CONFIRMED + 无取消/控制退款` 条件，再要求 `now < game.starts_at`。`now >= starts_at` 返回 `SupersededOpenGameNotification`，提交 `SUPERSEDED` 后不调用 Provider。

send-start marker 仍先提交、后释放全部数据库锁、再进行外部 I/O。通知成功/失败只改变 outbox；报名状态、版本、球局和订单不受通知结果影响。Provider 已发送但 `SENT` 提交前崩溃的窗口仍是至少一次语义，真实微信接口没有本项目可控的幂等键时不得宣称恰好一次。

## 7. 测试、发布与外部门

采用逐项 RED→GREEN：

- Jest 覆盖未配置时原行为、原始点击在首个 `await` 前一次授权、接受/拒绝/fail/同步异常均继续申请、timeout 不提交且 late callback 无副作用、重复点击不重复授权、unknown recovery 不授权；
- Node 构建测试覆盖 provider/template 组合、非法 ID、production bootstrap 注册与 disabled 包；
- pytest 覆盖 settings 严格闭合与 secret redaction、HTTP 请求闭合/timeout/token cache/单次刷新、错误分类、close 生命周期；
- Postgres worker 测试覆盖 `now == starts_at` 和已开场事件 supersede 且零 Provider I/O；
- 根 worker 组合测试覆盖 disabled 不消费、wechat 配置完整才消费并关闭 owned client；
- fresh typecheck、聚焦 Jest/pytest、production build/package audit 与变更 lint。

可见改动仅为申请页一行条件式 helper，独立 reviewer 在真实微信开发者工具 iOS/Android 代表 viewport 检查：helper 不挤压字段/底栏、主按钮双轴居中、提交态不重复点击、safe area 和滚动正常。当前用户已授权独立 agent 代行此轮视觉节点；物理真机仍留到集中验收。

以下任一项未满足时，代码最多称“真实 Provider 能力已实现、外部配置关闭”：

1. 微信公众平台提供真实一次性订阅模板 ID 与经核对的三个关键词；
2. backend 与 mini 构建都显式切为 `wechat`，且 staging 选择 `trial`；
3. 微信后台订阅能力可用；
4. 物理 iOS 与 Android 都完成授权、候补转正、消息到达、deeplink 和权威回读；
5. 运营接受微信不提供本项目幂等键时的极端重复触达边界。

本切片不修改当前 staging 的 disabled 值，不部署、不上传、不合并 `main`，也不执行真实外部发送。
