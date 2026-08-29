# C2a-P 报名撤回与退出生产候选设计

日期：2026-08-30

状态：`DELEGATED_APPROVED_FOR_CANDIDATE`。用户明确委托代理完成 iOS/Android 微信开发者工具视觉验证，通过后继续开发并统一生成体验候选；C2a 预览 `d696f7d` 已完成该验证与独立复审。真实三账号、物理 iOS/Android 和最终手机视觉验收仍为完成门。

上游：

- [C2a 开发预览设计](./2026-08-30-registration-withdrawal-preview-design.md)
- [C1a 散客申请与队长审核生产设计](./2026-08-24-player-game-application-production-design.md)
- [C1c 我的报名生产候选设计](./2026-08-30-my-game-registrations-production-design.md)
- [三类用户与开放球局产品设计](./2026-08-09-three-sided-football-product-design.md)

## 1. 目标与边界

闭环一个已有申请人的真实旅程：

```text
我的报名 / 共享球局详情
→ APPLIED 撤回申请 / JOINED 退出球局
→ 明确确认
→ 服务端幂等写入 WITHDRAWN
→ 详情与已加载列表权威回读
→ 本场不可再次申请
```

本切片复用 C1a/C1c 后端聚合、共享详情、我的报名列表、微信会话、HTTP Source 与单一报名 attempt store。不得新建第二套详情、列表、登录栈或容量账本。

明确排除：候补/FIFO、自动递补、队长移除、到场/爽约、举报、通知、信用分、封禁、扣款、支付、退款、订单修改以及新的取消联动。球局取消继续复用既有有效状态投影。

## 2. 状态、动作与时间规则

持久状态新增终态 `WITHDRAWN`：

```text
APPLIED --WITHDRAW_APPLICATION--> WITHDRAWN
JOINED  --LEAVE_GAME-----------> WITHDRAWN
```

- 请求必须同时携带明确 `action` 与 `expected_version`。
- `WITHDRAW_APPLICATION` 只匹配锁内 `APPLIED`；`LEAVE_GAME` 只匹配锁内 `JOINED`。
- 服务器不得依据锁内最新状态自动升级动作。若队长先把 `APPLIED v1` 接受为 `JOINED v2`，旧撤回请求返回 `APPLICATION_STATE_CHANGED`；用户刷新后必须重新确认“退出球局”。
- `(game_id, applicant_user_id)` 唯一约束保留；不删除、不复用、不另建报名行，因此本场不能再次申请。
- `APPLIED → WITHDRAWN` 不改变容量；`JOINED → WITHDRAWN` 因 JOINED 计数减一而自然释放恰好一个名额，不写 `open_games.open_spots`。

时间只由服务端在取得业务锁后读取一次：

- `now == starts_at - 6h`：正常退出，`late_exit_recorded=false`；
- `starts_at - 6h < now < starts_at`：记录临时退出；
- `now >= starts_at`：禁止写入；
- APPLIED 撤回永远不记录临时退出。

`SUSPENDED` 且未开场时允许本人退出；暂停阻止新增申请和审核，不应困住已有参与者。`CANCELLED`、`COMPLETED` 或已开场无退出动作。

球局取消继续覆盖有效状态：持久 `WITHDRAWN` 的球局后来取消时，`effective_status=CANCELLED`，但撤回审计字段保留。不得批量把报名持久状态改成 CANCELLED。

## 3. 持久化与迁移

新增 `0018_open_game_registration_withdrawals.py`，不修改 `0016/0017`：

- `open_game_registration_status` 增加 `WITHDRAWN`；
- 新枚举 `open_game_registration_withdrawal_kind`：`APPLICATION_WITHDRAWAL | GAME_EXIT`；
- `withdrawn_at TIMESTAMPTZ NULL`；
- `withdrawal_kind ... NULL`；
- `late_exit_recorded BOOLEAN NOT NULL DEFAULT FALSE`。

不增加审计表、`withdrawn_by_user_id`、原因、处罚、释放名额或历史计数列。本人就是既有 `applicant_user_id`，终态只发生一次，`version/updated_at` 与通用幂等记录足够。

约束矩阵：

- APPLIED：决定字段和撤回字段为空，late=false；
- JOINED/REJECTED：决定字段完整，撤回字段为空，late=false；
- WITHDRAWN + APPLICATION_WITHDRAWAL：决定字段为空，撤回时间/kind 完整，late=false；
- WITHDRAWN + GAME_EXIT：保留原决定字段，撤回时间/kind 完整，late 可真或假；
- `withdrawn_at >= applied_at`；GAME_EXIT 时 `withdrawn_at >= decided_at`。

PostgreSQL 状态枚举使用可往返重建，不使用不可逆的简单 `ALTER TYPE ADD VALUE`。无 WITHDRAWN 行时允许严格 downgrade 到 0017；存在 WITHDRAWN 行时 downgrade 必须明确拒绝，不能丢数据或伪装成其他状态。

## 4. 封闭契约

新增：

```http
POST /api/v1/open-game-applications/{application_id}/withdraw
Authorization: Bearer <session>
Idempotency-Key: <16–128 chars>

{
  "action": "WITHDRAW_APPLICATION" | "LEAVE_GAME",
  "expected_version": 1
}
```

只允许当前登录用户操作自己的 application；不存在和他人 application 均返回 `404 APPLICATION_NOT_FOUND`。成功和同键重放均返回 `200 OpenGameRegistrationContext`。复用 `401 AUTH_REQUIRED`、`409 APPLICATION_STATE_CHANGED | IDEMPOTENCY_KEY_REUSED`、`422 INVALID_ARGUMENT`、`503 SERVICE_UNAVAILABLE`，不新增宽泛错误体系。

`viewer_registration` 新增必填自有字段：

- `id`, `version`；
- nullable `withdrawn_at`, nullable `withdrawal_kind`, boolean `late_exit_recorded`；
- nullable `available_withdrawal_action`；
- boolean `late_exit_will_be_recorded`。

`available_withdrawal_action` 和预告只由服务端投影。预告仅在 action 为 `LEAVE_GAME` 且锁外读取的当前权威上下文处于不足 6 小时窗口时为真；真正写入仍在锁后重新判断。持久与有效状态枚举加入 `WITHDRAWN`；C1c 列表 item 不增加其他字段。

所有现有 context examples 同步新增字段；新增 APPLIED/JOINED/WITHDRAWN 代表例。静态 OpenAPI、运行时 aligner、Pydantic DTO 与 TypeScript 严格 decoder 必须一致。

## 5. 后端事务与竞争

`withdraw()` 固定使用：

1. self-only 非锁定定位 application 对应 game/order；
2. `Order FOR UPDATE`；
3. `OpenGame FOR UPDATE`；
4. `OpenGameRegistration FOR UPDATE`，重新核对 application/game/applicant；
5. digest 包含 operation、application ID、resolved game ID、action、expected version、协议版本；claim 通用幂等记录；
6. 同请求已完成则字节等价重放；同键异请求拒绝；
7. 锁 order authority，取得一次 `now`，投影球局时态；
8. 校验 action/status/version、取消/完成/开场边界；
9. 写 WITHDRAWN、`version += 1` 和审计字段；
10. flush 后重新统计 JOINED，投影完整 context；
11. 幂等响应与业务写入同事务提交。

同一 JOINED 的不同 key 只能一个成功；同 key 双请求必须返回等价 200 且只增一次版本。撤回与队长接受、球局取消或容量编辑均由相同 Order 起始锁串行。

## 6. 真实小程序

复用 `pages/captain-game-public`：

- APPLIED 显示“撤回申请”；JOINED 显示“退出球局”；
- 点击只打开确认层；“保留报名”只关闭；确认后保存 attempt 再单飞提交；
- `late_exit_will_be_recorded` 为真时显示临时退出说明；客户端不使用 `Date.now()` 判断；
- WITHDRAWN/取消/已开场/其他终态无 CTA，无重新申请入口；
- 固定底栏、确认层与安全区沿用已通过的 C2a 视觉。

同一报名 attempt store 增加：

```text
kind=withdraw, originatingUserId, shareToken, applicationId,
action, expectedVersion, idempotencyKey
```

网络、5xx、畸形 2xx 或权威不匹配均保留 attempt 并显示结果待确认。恢复时先 GET context：

- 同 application 已精确变为匹配 kind 的 WITHDRAWN v(expected+1)：接受权威并清 attempt；
- 原 application/status/version/action 均未变化：只重放原 key；
- 权威已变为其他状态或版本：清旧 attempt、接受权威，绝不自动改成另一种退出动作；
- 读取失败或账号不一致：保留 attempt，不写。

共享详情的读写都绑定 `{originatingUserId, generation}`；账号变化、隐藏、卸载或晚响应不得写入另一账号页面。

成功后只在上一页确为 `pages/my-game-registrations/index` 且账号一致时，按 registration ID 将目标卡片定点更新为服务端 effective status。数组顺序、已加载页、cursor、resultCount 与 scrollTop 保持不变；找不到目标安全 no-op。球局后来取消时下一次权威读取仍可把卡片更新为 CANCELLED。

## 7. 兼容发布与回滚

先冻结一个 `compatibility_sha`：包含 0018、WITHDRAWN 读取/投影、严格契约与客户端 decoder，但 mutation 不可用且 `available_withdrawal_action=null`。部署该 SHA 完成迁移后，再部署功能候选并上传新体验版。

首笔 WITHDRAWN 写入后，不得回滚到 `eb75889` 或执行破坏性 downgrade；只能回到 compatibility SHA，使既有退出记录继续可读且不再提供写动作，再向前修复。staging 当前无线上发布版，兼容与功能部署应连续完成，减少旧体验候选遇到扩展 context 的窗口。

## 8. 完成门

候选上传前必须通过：

- 迁移、约束、lifecycle、self-only、幂等、并发和 rollback 聚焦测试；
- OpenAPI/运行时 schema/示例严格一致；
- 既有 C1a/C1b/C1c 与订单权威回归；
- 客户端 decoder/source/attempt/page/list 回写与账号隔离；
- fresh development/production build、production audit，生产包无 C2a Fixture；
- 微信开发者工具 iOS 与 Android 真实 production journey 代表检查；
- 独立代码复审与 exact-SHA staging truth check；payment 保持 disabled。

真实三个账号、物理 iOS/Android、申请/审核竞争、取消投影和 C2a 撤回/退出手机验收通过前，保留 C1/C2a Fixtures，不合并最终 `main`，不称 C1c 或 C2a 完成。

## 9. 文档优先级

本设计明确取代旧 PRD 中“退出后可重新排队”和“退出立即自动递补”的表述。当前冻结规则是 WITHDRAWN 后本场不可再申请；候补与 FIFO 自动递补属于后续 C2b。
