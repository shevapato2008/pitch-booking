# C2e 队长移除已加入成员生产设计

日期：2026-09-01

状态：`DELEGATED_APPROVED_FOR_CANDIDATE`。用户已授权睡眠期间按冻结边界自主完成剩余模块，并要求需要视觉验证时交给独立代理审核；本文件把该边界落成最小可部署垂直切片。独立视觉代理的通过不替代次日用户集中验收，验收前不合并 `main`。

上游：

- [C1a 散客申请与队长审核生产设计](./2026-08-24-player-game-application-production-design.md)
- [C2a-P 报名撤回与退出生产候选设计](./2026-08-30-registration-withdrawal-production-design.md)
- [C2b 候补 FIFO 与递补通知基础设计](./2026-08-30-waitlist-fifo-foundation-design.md)
- [C2c 到场记录基础设计](./2026-08-30-attendance-recording-foundation-design.md)

## 1. 目标与明确边界

闭环一个真实队长旅程：

```text
订单 owner 打开已发布球局的成员管理
→ 读取当前 JOINED 散客名单及服务端可移除状态
→ 选择成员并填写 1..120 字原因
→ 二次确认后幂等提交
→ 服务端在统一锁序中写 REMOVED 与不可篡改审计
→ 若移除前正式成员恰好满员，则同事务 FIFO 递补首位 WAITLISTED
→ 队长权威回读最新名单；被移除者详情/我的报名显示“已被移出”
```

严格限制为：

- 只有球局对应真实订场订单的 owner 可以读取成员管理和执行移除；他人看到与不存在相同的 `404 OPEN_GAME_NOT_FOUND` 或 `404 APPLICATION_NOT_FOUND`，不泄露成员归属；
- 只允许在服务端当前时间早于开场、持久球局为 `PUBLISHED`、有效球局为 `PUBLISHED`、订单权威健康时移除；
- 目标必须是同一球局内 `JOINED + attendance_status=UNMARKED` 的报名；`APPLIED`、`WAITLISTED`、`REJECTED`、`WITHDRAWN`、`REMOVED`、已记到场结果均不可移除；
- 原因服务端 trim 后必须为 1..120 个 Unicode code point，并复用报名可见文本的手机号、微信号、证件号与 URL 防泄露检查；客户端计数仅用于即时反馈，服务端始终重新验证；
- 新增真实 `REMOVED` 终态，不删除或复用报名行；本场仍不可重新申请；
- 只有移除前 `joined_count == open_spots` 时才尝试 FIFO 递补一人。移除前未满员时，即使存在历史候补也不补位；
- 递补复用既有 `WAITLIST_PROMOTED` durable outbox，但本切片不创建、发送或承诺任何“成员被移除”微信通知；
- 不支持移除 `WAITLISTED`、批量移除、撤销移除、修改原因、成员申诉、信用分、封禁、退款、支付或订单变更。

## 2. 方案选择与界面边界

评估过三种实现：

1. **独立“成员管理”页（采用）**：从现有“管理球局”进入，读取专用 owner-only roster。它使待审核、赛前成员变更和赛后考勤各有单一职责，契约与权限也最清楚。
2. 扩展“报名审核”页：少一条路由，但会把一次只处理一条 `APPLIED` 的审核状态机与完整 `JOINED` 名单、原因表单和未知结果恢复耦合，页面与响应语义会失焦。
3. 复用“散客到场记录”页：视觉复用最多，但该页只在 `COMPLETED` 开放；把赛前移除塞入同一路由会破坏既有服务端权威门和用户心智。

因此新增生产路由 `pages/captain-game-members/index`。现有“管理球局”仅在 owner 的权威状态为 `PUBLISHED` 时显示“成员管理”，不修改开放球局 owner DTO 的通用动作矩阵；真正可移除性仍完全由成员接口返回并由写操作锁内复核。

页面采用现有小程序设计语言，而不引入另一个调色板或字体：白色卡片、浅灰背景、深蓝正文、蓝色主操作、红色破坏性确认、共享自定义导航。成员卡按服务端顺序显示名称、位置、加入来源（直接加入/候补递补）与状态；不显示手机号、微信号、用户 UUID、订单支付、考勤历史或候补私密信息。

选择“移除”后打开底部确认层：显示被冻结的成员名称、不可恢复说明、带可见标签的多行原因输入、`0/120` 字数和就地错误。取消只关闭；确认按钮在空白、超长、提交中时真实 disabled。按钮用 flex 双轴居中，触控区至少 88rpx；滚动区给固定底栏和安全区留足空间。

## 3. 状态、投影与对用户可见语义

持久状态加入：

```text
JOINED + UNMARKED --OWNER_REMOVE--> REMOVED
```

`REMOVED` 是不可逆终态：保留原 `decided_at/decided_by_user_id` 与可能存在的 `waitlist_seq/waitlisted_at/promoted_at`，写入 `removed_at/removed_by_user_id`，版本恰好 `+1`。withdrawal 字段保持空，attendance 始终 `UNMARKED`。

球局后来取消时，既有统一投影仍可把自有报名的 `effective_status` 显示为 `CANCELLED`；持久 `REMOVED` 与审计不被改写。未取消时，被移除者在共享详情与“我的报名”看到 `REMOVED`，文案为“已被队长移出”，不再显示退出或申请按钮。移除原因默认不向普通参与者下发：原因属于 owner/platform 审计资料，避免把队长输入的潜在敏感信息扩散到公开或自有详情；未来若要向成员说明，应另做内容治理与通知设计。

owner roster 的每行含服务端 `can_remove` 与严格 blocker：`GAME_NOT_PUBLISHED | GAME_SUSPENDED | GAME_CANCELLED | GAME_COMPLETED | GAME_STARTED | ORDER_AUTHORITY_UNHEALTHY | ATTENDANCE_RECORDED`。列表只含当前 `JOINED`，因此不会产生“非 JOINED 行看起来可点”的歧义。整个球局被阻塞时仍可只读名单，页面展示服务端说明且不渲染无效按钮。

## 4. 数据与不可篡改审计

新增迁移 `0023_open_game_member_removals.py`，不改写历史迁移：

- `open_game_registration_status` 增加 `REMOVED`，以可往返重建方式更新 PostgreSQL enum；
- `open_game_registrations` 新增 nullable `removed_at TIMESTAMPTZ`、`removed_by_user_id UUID`，外键 `users(id)`；
- 更新决定、withdrawal、waitlist、attendance 与 removal 矩阵：只有 `REMOVED` 具有成对 removal 字段，必须保留 JOINED 的决定/候补历史，withdrawal 为空、late=false、attendance=UNMARKED，且 `removed_at` 不早于 `decided_at/promoted_at`；
- 新增 `open_game_member_removals` append-only 审计表：`id`、唯一 `registration_id`、`game_id`、`order_id`、`removed_by_user_id`、trim 后原因、`removed_at`、移除报名的 before/after version、nullable promoted registration ID 及其 before/after version、幂等 key 与 request SHA-256；
- 审计表以复合外键绑定 registration/game/applicant 身份和真实 order/game，数据库触发器拒绝任何 UPDATE/DELETE；原因、版本、promotion 配对和 digest 均有 check constraint；
- downgrade 仅在不存在 `REMOVED` 行且审计表为空时允许，否则明确拒绝，不能丢审计或伪装状态。

不新增可漂移容量列。名单、`joined_count`、`remaining_spots` 始终从 `JOINED` 实时投影。

## 5. 事务、FIFO、幂等与竞争

写操作固定锁序：

```text
非锁定定位 game/order
→ Order FOR UPDATE
→ OpenGame FOR UPDATE
→ target Registration FOR UPDATE
→（仅移除前满员时）FIFO 首位 WAITLISTED Registration FOR UPDATE
```

锁内流程：

1. 隐私安全地重新确认 owner、game 和 target 归属；
2. digest 覆盖 operation、game ID、registration ID、trim 后 reason、expected version 与协议版本，claim 通用幂等记录；
3. 同键同请求字节等价重放；同键异请求返回 `IDEMPOTENCY_KEY_REUSED`；
4. 锁订单 authority，读取一次服务端 `now`，投影真实球局状态；
5. 校验 `PUBLISHED`、健康 authority、`now < starts_at`、目标 `JOINED + UNMARKED` 与精确版本；
6. 记录移除前 `joined_count`，写 `REMOVED`、removal 字段、版本和 append-only audit；
7. 仅当移除前满员时锁 FIFO 首位候补并转为 `JOINED`，版本 `+1`、写 `promoted_at`，创建唯一 `WAITLIST_PROMOTED` outbox；否则不触碰候补；
8. flush 后重算 joined/waitlist，生成响应，完成幂等记录并一起提交。

同一成员不同 key 并发只有一笔成功；移除与本人退出、队长审核、球局取消、容量编辑继续由相同 Order 起始锁串行。任何审计或 outbox 写入失败均回滚移除和递补。通知 worker 的成败不反转业务状态。

## 6. 封闭 HTTP 契约与隐私

新增：

```http
GET /api/v1/games/{game_id}/members
Authorization: Bearer <owner session>

POST /api/v1/games/{game_id}/members/{registration_id}/remove
Authorization: Bearer <owner session>
Idempotency-Key: <16–128 chars>
Content-Type: application/json

{"expected_version": 2, "reason": "临时阵容调整"}
```

GET 返回封闭的 `OpenGameMemberRoster`：最小 game 摘要、`joined_count`、`remaining_spots`、`waitlist_count` 与按 `applied_at,id` 稳定排序的 `members`。成员字段只包含 registration ID、场内名称、位置、加入时间、是否候补递补、version、`can_remove` 和 blocker。

POST 返回封闭的 `OpenGameMemberRemovalResult`：被移除报名 ID/名称、`REMOVED`、新版本、`removed_at`、最新计数及 nullable `promoted_member`。不返回原因、用户 ID、联系方式、订单付款或通知状态。成功及同键重放为 `200`。

错误复用 `401 AUTH_REQUIRED`、`404 OPEN_GAME_NOT_FOUND | APPLICATION_NOT_FOUND`、`409 APPLICATION_STATE_CHANGED | IDEMPOTENCY_KEY_REUSED`、`422 INVALID_ARGUMENT`、`503 SERVICE_UNAVAILABLE`；对非 owner 不区分存在与否。静态 OpenAPI、运行时 aligner/Pydantic、JSON examples、TypeScript 类型与严格 decoder 同步，拒绝未知字段和未知枚举。

## 7. 小程序真实交互与未知结果恢复

生产 Source 和共享持久 attempt store 新增 `remove-member` attempt：包含 originating user、game/registration、trim 后 reason、expected version 与 idempotency key。提交前先 `begin`；同账号其他操作、外账号遗留操作沿用现有显式恢复页，不静默覆盖。

- 明确成功：清 attempt，显示“已移除 X”；若发生递补，补充“候补第 1 位 Y 已加入”，随后 GET roster 权威回读；不声称微信通知已送达。
- `APPLICATION_STATE_CHANGED`：清 attempt、回读名单并提示状态已变化，不依据旧界面继续移除。
- 登录丢失：保留 attempt，重新登录后比较账号；只有原账号可继续。
- 网络/超时导致结果未知：锁定新移除操作，展示“确认原移除结果”；按钮只用原 idempotency key 重放原请求。重放成功后再 GET；可确认的 404/409 清理并回读；仍未知则继续保留。不得生成新 key 或猜测成功。
- 页面隐藏/卸载使用 generation guard，迟到响应不能覆盖另一球局或另一账号状态。

“管理球局”中的“成员管理”、名单行“移除”、确认层“取消/确认”、重试、重新登录、确认原结果、返回等所有按钮均连接真实导航、HTTP、状态恢复或关闭行为，不允许只 Toast 或空 handler。

## 8. 开发预览、测试与发布门

development-only `C2E_MEMBER_REMOVAL_FIXTURE` 提供：

1. 可移除的已加入成员；
2. 原因为空/超长的本地校验；
3. 移除前满员并 FIFO 递补；
4. 移除前未满员且不递补；
5. 已开场/authority 异常只读 blocker；
6. 结果未知后用同一 key 恢复。

预览按钮必须真实改变 Fixture store；唯一 marker 与页面清单只进入 development build，生产 build/audit 排除全部 Fixture、dev route 与模拟名称。

聚焦自动化覆盖 lifecycle、DTO/隐私、迁移约束与 append-only trigger、service 幂等/并发/FIFO 原子性、router 错误封装、严格 decoder、attempt 恢复、页面按钮与 stale guard，以及真实 Uvicorn HTTP journey：owner 读取→满员移除→首位候补转正→owner 回读→被移除者自有详情/列表回读，同时证明订单/支付不变、无 removed-member outbox、只有既有 promotion outbox。

视觉自查与独立代理审核分别在微信开发者工具 iOS 390×844 和 Android 411×731 检查代表性名单、输入确认、成功递补和 blocker：按钮双轴居中、同行动作对齐、长名称/原因计数无裁切、键盘与滚动可达、固定确认层/安全区不遮挡、返回图标一致。此聚焦移动端变更不扩张为无关全应用视觉重拍。

本切片达到候选门需：聚焦与相关回归通过、迁移可升降且有数据时 fail-closed、HTTP journey 通过、fresh production build/audit 无 Fixture、独立视觉审核通过。它不部署、不合并 `main`；由根任务统一发布体验版并留待次日用户验收。
