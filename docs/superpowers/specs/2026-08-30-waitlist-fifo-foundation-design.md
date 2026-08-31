# C2b 候补 FIFO 与递补通知基础设计

日期：2026-08-30

状态：`FOUNDATION_DESIGN_ONLY`。本文件冻结 C2b 的最小用户旅程和生产边界，供后续独立计划、Fixture 视觉确认与实现使用；不授权在 C2a 的候选上直接加入候补写入，也不替代 C1/C2a 尚待完成的真实手机验收。

上游：

- [C2a-P 报名撤回与退出生产候选设计](./2026-08-30-registration-withdrawal-production-design.md)
- [C1a 散客申请与队长审核生产集成设计](./2026-08-24-player-game-application-production-design.md)
- [三类用户与开放球局产品设计](./2026-08-09-three-sided-football-product-design.md)

## 1. 目标与严格边界

本切片只补齐一个真实的空位递补旅程：

```text
队长把已审核的 APPLIED 放入候补
→ 候补者看见自己的顺位并可退出候补
→ JOINED 本人退出，释放一个公开名额
→ 同一事务按 FIFO 将一名候补者转为 JOINED
→ 持久 outbox 记录“候补转正”待发送通知
→ 客户端权威回读，不把通知发送结果伪装为报名结果
```

复用 C1a/C1c/C2a 的 `OpenGameRegistration`、订单/球局权威投影、会话、幂等记录、共享详情和“我的报名”。不得建立第二份容量计数、第二张报名表、轮询式前端递补器或客户端 FIFO。

最小范围刻意限制为：

- 仅队长对已存在的 `APPLIED` 作明确 `WAITLIST` 决定；球局满员时仍允许申请人沿用 C1a 创建普通 `APPLIED`，但申请人不能绕过审核直接创建 `WAITLISTED`；
- 仅 `JOINED → WITHDRAWN` 的本人退出触发自动递补，且一次退出至多递补一人；
- 候补者可本人退出候补；队长移除候补、改顺位、批量递补、容量编辑触发递补、重新申请、到场/爽约、信用分、支付、退款和聊天仍不在本切片；
- 没有真实微信订阅消息模板、用户订阅授权和生产 Provider 时，只能完成可验证的 outbox/本地 fake，不得称 C2b 生产完成或对用户承诺已通知。

为避免“已有候补但容量编辑产生多个空位”的隐含补偿任务，本切片在存在有效候补时禁止把 `open_spots` 改大或改小；既有容量编辑约束照常适用。候补队列为空后，B2 编辑行为不变。

## 2. 状态机与权威规则

持久状态在 C2a 的基础上加入 `WAITLISTED`：

```text
APPLIED    --WAITLIST--------------> WAITLISTED
WAITLISTED --PROMOTE_FROM_WAITLIST--> JOINED
WAITLISTED --WITHDRAW_WAITLIST------> WITHDRAWN
APPLIED    --WITHDRAW_APPLICATION---> WITHDRAWN
JOINED     --LEAVE_GAME-------------> WITHDRAWN
APPLIED    --REJECT-----------------> REJECTED
```

- `WAITLIST` 是队长的显式、版本受控决定；仅在该球局已满、未开场、可审核且订单权威健康时允许。容量可用时，队长必须选择既有 `ACCEPT`，不得把申请人留在候补。
- `WAITLISTED` 不占用公开名额；只有 `JOINED` 参与 `joined_count`，因此仍有 `remaining_spots = max(open_spots - joined_count, 0)`，不引入可漂移计数列。
- 每个候补行在转入 `WAITLISTED` 时取得不可变的、每球局严格递增 `waitlist_seq`。顺位仅按此字段，不按时间戳、UUID、前端到达顺序或通知送达顺序。
- 转正只在退出前满员、退出后恰有一个空位、球局仍 `PUBLISHED`、订单权威健康且 `now < starts_at` 时发生。`SUSPENDED`、`CANCELLED`、`COMPLETED` 或已开场均不得递补；报名截止继续只阻止新申请，不撤销或阻止处理已有候补。
- 转正保留原候补的 `decided_at/decided_by_user_id`，写入 `promoted_at` 并使版本递增一次。候补退出使用新的明确动作 `WITHDRAW_WAITLIST`，写入 `WITHDRAWN`、`WAITLIST_WITHDRAWAL`、`withdrawn_at`；不会递补下一人，因为没有释放已加入席位。
- `SUSPENDED` 只暂停新决定和自动递补，不得困住参与者：尚未开场的候补者仍可执行 `WITHDRAW_WAITLIST`，已加入者仍可执行既有 `LEAVE_GAME`，但这两类退出在暂停期间都不触发递补。当前系统不提供 `SUSPENDED → PUBLISHED` 恢复；未来若增加恢复能力，必须先在同一 `Order → OpenGame` 锁内补齐按现有空位执行 FIFO fill 的恢复 hook，不能让队列永久滞留。
- 球局后来取消时，所有候补和已加入记录继续通过既有有效状态投影显示 `CANCELLED`，持久状态、候补序号、撤回/转正审计不被批量改写。`WITHDRAWN` 后仍不可重新申请同一球局。

## 3. 数据、FIFO 与事务边界

迁移必须从 C2a 的 `0018` 向前演进，而不是修改已发布迁移：

- 扩展 `open_game_registration_status` 以读取/写入 `WAITLISTED`；
- 在 `open_game_registrations` 新增 nullable `waitlist_seq BIGINT`、`waitlisted_at TIMESTAMPTZ`、`promoted_at TIMESTAMPTZ`；候补顺位在转正和候补退出后仍保留，作为可审计的不可复用序列；
- 增加 `WAITLIST_WITHDRAWAL` withdrawal kind；以约束矩阵精确限制 `APPLIED`、`WAITLISTED`、直接 `JOINED`、候补转正后的 `JOINED`、`REJECTED` 和三种 `WITHDRAWN` 的时间/决定/顺位字段组合；
- 对 `(game_id, waitlist_seq)` 建立唯一约束（`waitlist_seq IS NULL` 时不冲突），并以索引 `(game_id, status, waitlist_seq)` 支撑首位候补的锁定读取；
- 新增最小 `open_game_notification_outbox`。它只保存事件 id、唯一去重键、game/registration/recipient ID、事件种类、模板语义键、创建/可见/租约/尝试/完成或失败状态和经过审查的 payload；不保存手机号、微信号、access token 或原始订阅回执。

在同一球局内，分配新序号时必须已经锁定 `OpenGame`，读取该球局已有最大 `waitlist_seq` 后写入 `max + 1`。报名行从不删除且序号保留，因此顺位不会重用；这就是显式的 per-game FIFO，而不是依赖应用时刻碰巧稳定。

所有涉及容量、候补或报名状态的写操作固定锁序：

```text
Order FOR UPDATE → OpenGame FOR UPDATE → target Registration FOR UPDATE
→（需要时）FIFO 首位 WAITLISTED Registration FOR UPDATE
```

退出且可递补时，在同一事务内按以下顺序完成：锁并校验退出者、claim 幂等记录、读取一次权威 `now`、写入退出、重算 `JOINED`、锁 `waitlist_seq` 最小的有效候补、将其转正、插入唯一 outbox 事件、投影响应、完成幂等记录并提交。任何校验、锁冲突或 outbox 写入失败都回滚报名与递补；通知发送失败发生在提交后，绝不能反转 `JOINED`。

同键重放返回字节等价的原响应；不同 key 并发退出只能造成一次状态改变和最多一条转正事件。队长审核、本人退出、球局取消和容量编辑都使用同一 `Order → OpenGame` 起始锁，不能把最后一个席位授予两人。

## 4. 封闭契约与通知边界

后续契约计划必须同时更新静态 OpenAPI、运行时 DTO、示例、严格 decoder 与 C1c 列表投影，且拒绝未知枚举/字段。

- 队长决定请求的 `decision` 扩展为 `ACCEPT | REJECT | WAITLIST`；响应状态可为 `WAITLISTED`。
- `viewer_registration` 与 C1c item 能权威表示 `WAITLISTED`，并仅为本人返回 `waitlist_position`（正整数或 `null`）、`waitlisted_at`、`promoted_at` 和明确的 `available_withdrawal_action`。顺位由服务端按持久 FIFO 投影，不从客户端列表推算。
- C2a 撤回请求动作扩展为 `WITHDRAW_WAITLIST`；它只匹配锁内 `WAITLISTED` 和精确版本。旧 `WITHDRAW_APPLICATION`、`LEAVE_GAME` 的语义绝不因状态变化自动升级。
- 未知写入结果沿用 C2a attempt recovery：先读取权威 context；只有报名已精确到达对应终态/版本才完成，否则仅重放原 idempotency key 或接受冲突后的权威状态，绝不自动转正、重新退出或声称已通知。

outbox 只表达已经发生的领域事实，例如 `WAITLIST_PROMOTED`，去重键至少包含 registration ID、转正后的 version 和事件类型。worker 使用可租约的 claim/complete/retry，不直接从 HTTP 请求发微信。它保证同一转正只创建一条领域事件、有效租约内不会并发发送；如果 Provider 已实际发送但进程在写入 `SENT` 前崩溃，而 Provider 又不支持幂等键或送达查询，租约恢复后的重试可能造成重复触达。只有真实 Provider 提供并落实去重能力后才能承诺端到端不重复通知。Provider 接口接收最小化的 recipient、模板语义和已审查 data；开发 fake 可记录调用用于测试，但 production/staging 不得回退到 fake 或把 provider 异常当成功。

真实发送需要用户在尚有交互上下文时通过 `wx.requestSubscribeMessage` 明确订阅相关模板，并由配置的真实模板 ID 与凭据驱动 Provider。拒绝订阅、模板失效、网络失败或触达失败只更新 outbox 投递事实，不改变候补或转正状态，也不向页面显示“已通知”。

## 5. 视觉与交互状态

先在 development-only Fixture 中验证以下可见状态，再接入生产 HTTP；Fixture 必须有唯一 marker、只在 development build 注册，并在生产审计中被排除：

1. 队长审核满员申请：明确显示“加入候补”与“婉拒”，不把“接受”伪装成可用。
2. 候补者详情：`候补中`、本人“当前候补第 N 位”、自动递补说明和固定底栏“退出候补”。
3. `JOINED` 退出后首位候补转正：原退出者显示已退出；候补者的权威回读显示已加入，而非“通知已发送”。
4. 候补退出确认：说明本场不可再次申请，确认后 CTA 消失且不改写其他候补的 `waitlist_seq`；其余有效候补的可见 `waitlist_position` 由服务端按当前队列重新压缩投影。
5. 暂停、取消、已开场和终态：准确显示服务端 blocker 或有效取消状态；`SUSPENDED` 且未开场的候补者仍可退出候补，但不触发递补，其余不可退出状态不显示 CTA。

沿用现有小程序设计系统和共享详情结构；所有按钮必须有真实 Fixture transition，随后必须连接到真实后端，不能以 toast、静态跳转或虚假通知交付。固定底栏与确认层必须为安全区预留空间，按钮文字用显式 flex 双轴居中；同组顺位/徽标/操作按钮保持同列同尺寸。

在官方微信开发者工具分别以 iOS 与 Android 目标设备检查上述代表状态；检查按钮双轴居中、顺位/状态徽标对齐、图标与箭头完整、长文案裁切、滚动与固定底栏安全区、以及“候补中”和“已加入”没有同时出现。自动化布局通过不替代该人工核对。

## 6. 发布、回滚与生产完成门

像 C2a 一样先部署 compatibility SHA：它能迁移和严格读取 `WAITLISTED`/outbox 相关数据，但不暴露 `WAITLIST`、`WITHDRAW_WAITLIST` 或自动递补写入。迁移后再部署功能候选；第一次候补或转正写入后，只能回退到能读取这些数据的 compatibility SHA，绝不执行破坏性 downgrade 或回到不认识新枚举的旧版本。

C2b 只有同时满足以下条件才可称生产完成：

- 迁移约束、FIFO 顺序、锁序、幂等、并发、退出-递补原子性、取消/暂停/开场边界和兼容回滚均有聚焦自动化覆盖；
- 每次转正恰好一条 durable outbox 领域事件；重复 worker 不并发发送，租约恢复、provider 失败和重复回执不改变报名状态；真实 Provider 已验证支持幂等去重前，极端“已发送但未记账”崩溃窗口仅承诺至少一次触达；
- OpenAPI/运行时 schema/示例/decoder/C1c 与共享详情完全一致，fresh production build/audit 不含 Fixture 或 fake provider；
- 实际微信订阅模板已配置，真实 Provider 发送得到可审计结果，申请人已在真实交互中完成订阅授权；
- 微信开发者工具 iOS/Android 与物理 iOS/Android 的队长、退出者、候补者多账号旅程均通过，包含通知实际到达后的权威回读；
- 仍保留 C1/C2a Fixture 和不合并 `main` 的既有真机验收门，直到相关真实体验者验收全部完成。

在上述门满足前，本切片最多可称“C2b foundation / development preview”，不能把 local fake、outbox 入队或开发工具截图表述为已向用户送达候补转正通知。
