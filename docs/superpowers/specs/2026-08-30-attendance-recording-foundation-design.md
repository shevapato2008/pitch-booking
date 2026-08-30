# C2c 队长赛后到场记录基础设计

日期：2026-08-30

状态：`DELEGATED_APPROVED_FOR_PREVIEW`。用户已明确授权其休息期间由独立 agent 处理产品决策；独立决策仅批准本文件与 development-only 原生预览，不批准后端实现、合并、部署或体验版上传。用户视觉复核、C2b 外部门及本文件第 8 节的生产门仍然有效。

基线：`e8529557e06308c69a93ffe9e5c6f90d0e5e348b`（C2b exact candidate）。

上游：

- [三类用户与开放球局产品设计](./2026-08-09-three-sided-football-product-design.md)
- [队长开放球局设计](./2026-08-18-captain-open-game-design.md)
- [C2b 候补 FIFO 与递补通知基础设计](./2026-08-30-waitlist-fifo-foundation-design.md)

## 1. 目标与严格边界

本切片只闭合一个赛后事实记录旅程：

```text
场馆完成真实订单履约
→ OpenGame 权威投影为 COMPLETED
→ 队长打开仍为 JOINED 的散客名单
→ 对每位散客分别确认“到场”或“未到场”
→ 服务端保存独立 attendance 结果与审计字段
→ 球员在“我的报名”或本人详情权威回读结果
```

到场结果必须与申请/候补/加入/退出状态分离。不得把 `JOINED` 改写成 `PRESENT` 或 `NO_SHOW`，也不得修改候补顺位、退出历史、容量或订单状态。

本切片刻意不做：

- 批量标记、全部到场、最终提交、撤销或队长自行改判；
- 星级、信用分、自动封禁、评价、举报、私聊或通知；
- 固定队员到场记录；
- 场馆对单个散客作判断；
- 公开访客查看名单或个人结果；
- 把订单 `COMPLETED` 重新定义为“个人到场均已记录”。

误记录的人工纠错属于后续 C2d 平台治理。C2d 未落地前，本切片只能称 attendance foundation；确认层必须明确“确认后本页不能自行修改”。

## 2. 现有权威与状态模型

场馆履约服务只有在订单已签到且当前时间不早于场次结束时间时，才能将订单写为 `COMPLETED`。OpenGame 不持久化第二个 `COMPLETED` 字段，而是从关联订单状态投影有效状态。因此，只有有效 OpenGame 状态精确为 `COMPLETED` 时才开放赛后名单。

报名继续使用既有业务状态：

```text
APPLIED | WAITLISTED | JOINED | REJECTED | WITHDRAWN
```

新增独立到场状态：

```text
UNMARKED --MARK_PRESENT--> PRESENT
UNMARKED --MARK_NO_SHOW--> NO_SHOW
```

- 只有持久报名状态仍为 `JOINED` 的记录可被标记；
- `PRESENT` 和 `NO_SHOW` 均为当前队长端不可逆终态；
- `UNMARKED` 绝不自动推断为 `NO_SHOW`；必须由队长明确操作；
- `attendance_complete` 仅是“当前 JOINED 散客均非 UNMARKED”的派生值；空名单为 `true`，但页面显示真实空态而非虚构完成数量；
- OpenGame 的有效 `COMPLETED` 仍表示真实订单/活动已结束，不等待个人到场记录，也不因记录完成而再次迁移。

## 3. 方案选择

### 方案 A：独立名单页，逐人确认（采用）

从已结束球局管理页进入“散客到场记录”。名单逐行显示球员和独立结果；未记录行提供两个等宽操作，点击后通过确认层执行一次写入。

优点是职责清楚、误触有保护、能复用报名审核页的卡片和未知结果恢复模式，而且不把赛前审核状态机继续膨胀。

### 方案 B：复用报名审核页的赛后模式

页面数量少，但会把申请、候补和赛后事实混入同一复杂页面，并可能重新暴露赛前备注，因此不采用。

### 方案 C：逐人向导加最终提交

可以提醒漏记，但会引入本地草稿、批量提交、恢复和最终确认；当前最多 30 人的简单名单不值得增加这套状态，因此不采用。

## 4. 页面与交互

沿用现有小程序蓝灰设计系统，不采用新主题或新字体。目标 viewport 为 iOS `390 × 844` 与 Android Nexus 5X `411 × 731`；页面结构为：

1. 与现有页面一致的自定义导航和自然返回按钮，标题“到场记录”；
2. “本场已结束”摘要卡，显示球局名称、场馆、物理场地和时间；
3. 进度行“已记录 X / Y”，不把固定队员计入 Y；
4. 按 `applied_at, id` 稳定排序的 JOINED 散客名单；
5. 无固定底部 CTA，名单自然滚动并预留底部安全区。

每行只展示当前任务必需信息：申请人填写的本场称呼、意向位置和到场结果。不得返回或展示手机号、微信号、applicant user ID、成年确认时间、风险确认时间、报名备注或历史报名摘要，也不得把本场称呼描述为微信昵称或实名。

未记录行提供同宽、同高的“到场”“未到场”按钮，均采用显式 flex 双轴居中，iOS 触控区不少于 44pt、Android 不少于 48dp。点击任一按钮先打开底部确认层：

- 标题分别为“确认已到场？”或“确认未到场？”；
- 正文包含球员的本场称呼和“确认后本页不能自行修改”；
- “返回名单”关闭确认层；
- 主按钮执行真实 Fixture transition，生产接入后执行真实服务端写入。

已记录行不再显示按钮，只显示 `已到场` 或 `未到场` 徽标和记录时间。全部完成时显示绿色完成提示；没有 JOINED 散客时显示“本场没有需要记录的散客”。颜色不是唯一状态提示，所有徽标均包含文字。

加载失败显示“重新加载”；409 权威变化显示最新名单和内联说明；未知写结果显示“确认记录结果”，先权威回读再决定是否重放。所有可见按钮必须产生真实行为，不得仅 Toast 或静态跳转。

已结束球局管理页增加服务端投影控制的“散客到场记录”入口。玩家本人在“我的报名”和本人共享详情看到 `待队长记录 / 已到场 / 未到场`；公开访客永远看不到个人结果。

## 5. 数据与事务

生产接入时新增线性迁移 `0021`，`down_revision = "0020"`，扩展 `open_game_registrations`：

- `attendance_status`：数据库枚举 `UNMARKED | PRESENT | NO_SHOW`，非空，默认 `UNMARKED`；
- `attendance_recorded_at`：nullable timestamptz；
- `attendance_recorded_by_user_id`：nullable FK → `users.id`；
- 复用现有 registration `version`，成功记录后加一；不新增第二套版本列。

数据库约束必须保证：

- `UNMARKED` 时记录时间和记录人同时为空；
- `PRESENT | NO_SHOW` 时记录时间和记录人同时非空；
- 只有 `JOINED` 行可以具有非 `UNMARKED` 结果。

名册上限由球局人数约束限制，当前不新增索引。固定锁序保持：

```text
Order FOR UPDATE → OpenGame FOR UPDATE → Registration FOR UPDATE
```

写入事务在锁内重新验证：当前用户是订单 owner、有效球局精确为 `COMPLETED`、目标报名仍为 `JOINED`、结果仍为 `UNMARKED`、`version == expected_version`。任何失败都不得写部分审计字段。

幂等操作为 `MARK_OPEN_GAME_ATTENDANCE`。请求摘要包含 game ID、registration ID、目标结果与 expected version。同键同请求返回首次响应，同键不同请求返回 409。

## 6. 封闭契约与隐私

后续生产计划必须同步静态 OpenAPI、运行时 DTO、示例、严格 decoder 和隐私白名单：

- `GET /api/v1/games/{game_id}/attendance-roster`：仅队长；返回最小球局摘要、计数、`attendance_complete` 和 JOINED 名单；
- `POST /api/v1/games/{game_id}/registrations/{registration_id}/attendance`：body 只含 `attendance_status = PRESENT | NO_SHOW` 与 `expected_version`，必填 `Idempotency-Key`；
- owner allowed actions 增加服务端投影 `can_manage_attendance`，仅在有效 `COMPLETED` 为真；客户端不能自行用时间或字符串猜权限；
- 本人报名投影增加 nullable `attendance_status`、`attendance_recorded_at`；非 JOINED 或尚未进入赛后展示语境时返回 `null`，且不返回记录者 ID；
- 队长名册不返回报名备注、真实用户 ID 或无关身份字段。

错误语义：

- 401：未登录；
- 404：不存在或越权，统一隐藏资源；
- 409 `ATTENDANCE_STATE_CHANGED`：版本、报名状态、球局状态或到场结果已变化；
- 422：请求字段错误；
- 503：无法确认的基础设施错误。

未知写结果必须按账号保存 attempt。权威回读若精确到达 `expected_version + 1` 且结果一致，则接受并清除；仍是原版本 `UNMARKED` 时只重放原 idempotency key；已由其他写入改变时清除 attempt、显示权威结果，绝不自动改判。

## 7. Development-only Fixture 与视觉门

预览使用唯一 marker 和隔离 store，只注册进 development build，至少覆盖：

1. 三人混合名单：待记录、已到场、未到场；
2. 到场确认层及真实 Fixture transition；
3. 未到场确认层及真实 Fixture transition；
4. 全部记录完成；
5. 空名单；
6. 加载失败、状态冲突和未知写结果确认。

代表性视觉自审只需覆盖混合名单、一个确认层、全部完成和空名单；其余状态以聚焦功能测试覆盖，避免重复截图。自审在官方微信开发者工具分别使用 iOS 与 Android 目标设备，检查：

- 按钮文字水平和垂直居中；
- 同组按钮、名单列和状态徽标对齐；
- 返回箭头和关闭 X 完整；
- 较长的本场称呼、滚动、卡片边界与裁切；
- 底部安全区没有遮挡；
- 文案与状态事实一致。

任一设备无法真实切换或截图时，必须保留未通过门，不能用另一设备或自动化布局测试冒充。用户明早仍需复核可见结果。

Fixture 删除条件：真实 HTTP、attempt recovery 和后端写入接通，fresh production build/audit 证明没有 fixture marker、dev route 或 dev source 后，才能删除或保留为严格 development-only 资产。

## 8. 实施、发布与完成门

今晚已批准的最大范围：

- 从 exact C2b candidate 建立独立 C2c worktree；
- 提交本设计、实现计划和 development-only 原生预览；
- 运行聚焦测试与可实现的 iOS/Android 微信开发者工具视觉自审。

只有在视觉门通过后，才另行开始契约、`0021`、后端和生产客户端。C2c 只有同时满足以下条件才可称完成：

- 队长与球员两个账号完成真实 `Order.COMPLETED → 逐人记录 → 玩家权威回读`；
- 权限、锁序、幂等、版本冲突、未知结果恢复和数据库约束均有聚焦覆盖；
- OpenAPI、运行时 DTO、示例、decoder 与隐私白名单一致；
- production build/audit 不含 Fixture；
- 官方微信开发者工具与物理 iOS/Android 均通过；
- 后续 C2d 平台人工纠错能力已真实落地，并通过误记录纠正与玩家权威回读的聚焦验收；
- C2b 尚未解除的真实模板、订阅授权、Provider、多账号通知和双端门不再阻塞集成链。

在这些门满足前，不得合并 `main`、部署、上传统一体验版，也不得将本切片描述为生产完成。
