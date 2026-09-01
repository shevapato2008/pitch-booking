# C2f 结构化举报与平台人工处置设计

日期：2026-09-01

状态：`DELEGATED_APPROVED_FOR_DEV_PREVIEW`。用户已授权睡眠期间继续完成剩余模块，并把所需视觉判断委托给未参与实现的独立 agent；根协调 agent 已确认采用本设计的 append-only 方案。当前只允许完成规格、TDD 计划和 development-only 预览。生产契约、迁移、后端与生产 UI 必须等待 C2e 的 `0023` 候选 HEAD 明确后再开始；次日用户集中验收前不合并 `main`、不部署、不上传体验版。

设计基线：`3f361c92d27508daacb999dcdd5f8a66bc4c0c43`。后续生产迁移预留 `0024`，`down_revision = "0023"`。

上游：

- [三类用户平台产品设计](./2026-08-09-three-sided-football-product-design.md)
- [散客旅程总体路线图](../plans/2026-08-16-overall-slice-roadmap.md)
- C2e 队长移除已加入成员设计 `docs/superpowers/specs/2026-09-01-captain-remove-member-production-design.md`（生产实施时从 C2e 候选带入）
- [C2d 平台到场人工纠错设计](./2026-08-31-attendance-correction-design.md)

## 1. 目标与严格边界

C2f 只闭合一个结构化治理旅程：一名在目标球局中已有报名记录的用户，对该球局及组织者提交一条结构化举报；平台管理员读取最小举报队列、核实并一次性结案。若举报核实时球局尚未开场且仍是健康真实订单支撑的有效 `PUBLISHED` 球局，平台可以真正取消球局；否则只能记录成立或驳回。

```text
报名者从本人球局详情进入举报页
→ 选择固定类别并填写 1..500 code points 的事实说明
→ 客户端提示隐私边界并做即时校验
→ 服务端重新验证报名资格、截止时间、唯一性与敏感信息
→ 幂等写入不可变举报事实
→ PLATFORM_ADMIN 在运营台读取队列与详情
→ 填写处置说明并确认唯一结论
→ 服务端追加不可变处置审计
→ 必要且仍合格时原子取消球局并记录 PLATFORM_REPORT 来源
→ 举报人回到同一页读取结果
```

唯一举报类别：

```text
FALSE_INFORMATION     虚假信息
EXTRA_CHARGE          临时加价
DANGEROUS_BEHAVIOR    危险行为
HARASSMENT            骚扰
ORGANIZER_NO_SHOW     组织者未到场
```

唯一平台结论：

```text
DISMISSED                    未确认违规，本次结案
CONFIRMED_RECORDED           举报成立，已记录处理
CONFIRMED_GAME_CANCELLED     举报成立，球局已由平台取消
```

明确排除：

- 举报单个球员、公开评论、陌生人私聊、图片/视频/录音证据上传；
- 通用客服工单、工单分派、SLA、标签、批量处置或跨业务搜索；
- `SUSPENDED`、信用分、自动处罚、自动封禁、黑名单或公开信誉档案；
- 自动退款、赔付、订单取消、支付/退款/库存变更或平台内 AA；
- 自动判断举报成立、按举报数自动取消或任何机器审核；
- 修改已提交的举报事实、修改已作出的结论、撤销结论或追加第二次结论；
- 微信通知、站内消息或“处理进度将主动提醒”的承诺。

## 2. 方案裁决

### 方案 A：不可变举报事实 + 一对一不可变处置事件（采用）

`open_game_reports` 只保存用户提交时的事实和目标快照；`open_game_report_resolutions` 只追加一次平台结论。两张表都禁止 UPDATE/DELETE。平台取消是同一处置事务中的真实球局状态变化。该方案的数据边界清楚，可以回答“谁在何时基于哪条原始举报作出什么结论”，同时没有引入通用工单引擎。

### 方案 B：在举报行上原地补齐结论字段

迁移较小，但举报事实与平台处置混在一个可更新行中，审计不可变性更弱，也难以用数据库约束证明只有一次结论，因此不采用。

### 方案 C：通用信任安全工单与处罚引擎

可以覆盖更多治理需求，但会提前引入分派、处罚、申诉、通知和策略系统，明显超出当前单场馆灰度价值，因此不采用。

UI/UX 检索给出的暗色与高红色方案不适合现有产品。C2f 继续复用项目既有浅色蓝灰体系，只把红色用于真实的“平台取消球局”破坏性确认；重点遵循可见标签、就地校验、明确提交反馈、44/48pt 触控区、键盘焦点和安全区规则。

## 3. 举报资格、窗口与唯一性

“报名者”按不可伪造的服务端事实定义：当前用户必须在目标 `game_id` 下有唯一 `open_game_registrations` 行。资格不因当前报名状态改变而丢失；`APPLIED | WAITLISTED | JOINED | REJECTED | WITHDRAWN | REMOVED` 均以实际存在的报名记录为准。这样既不允许路人举报，也不会让已退出或被移除的当事人在最需要治理入口时失去资格。客户端状态、分享 token 或页面来源都不能授予资格。

举报从报名记录存在起即可提交，不增加类别特有的“必须赛后”规则；统一截止为：

```text
report_deadline = authoritative slot.ends_at + 30 days
allowed when server_now < report_deadline
```

在截止时间相等或之后，GET 仍允许本人读取既有举报及结果，但新提交返回确定的 `REPORTING_WINDOW_CLOSED`。时间一律使用服务端 UTC 比较，展示使用场馆权威 `time_zone`。

同一用户对同一球局最多一条举报：

- 唯一约束 `(game_id, reporter_user_id)`；
- 第一次提交和同 key、同摘要重放都返回相同 `201` 响应；
- 同 key、不同摘要返回 `409 IDEMPOTENCY_KEY_REUSED`；
- 不同 key 再次提交返回 `409 REPORT_ALREADY_EXISTS`，不覆盖原举报；
- digest 覆盖 operation、game ID、锁内报名 ID、锁内组织者 ID、类别、标准化事实说明和 schema version。

举报提交使用与处置兼容的固定锁序，避免和 C2d/C2e 或平台取消交叉等待：

```text
非锁定定位 game → order → reporter registration
→ Order FOR UPDATE
→ OpenGame FOR UPDATE
→ Registration FOR UPDATE
→ Report identity/uniqueness check
```

事务锁内重新验证订单与球局仍匹配、报名三元组仍存在、截止时间、文本、幂等与唯一性，并从锁内订单 owner 生成 organizer 快照；客户端不能提交或覆盖报名 ID、组织者 ID。只有全部校验通过后才插入不可变 Report。

## 4. 文本校验与隐私防泄露

事实说明和平台处置说明都采用相同的确定性标准化函数：

1. `CRLF/CR` 统一为 `LF`；
2. Unicode NFC；
3. 去首尾空白，保留正文内换行；
4. 以 Unicode code point 计数，必须为 `1..500`；
5. 拒绝 NUL、DEL 与除换行/制表以外的 C0 控制字符；
6. 拒绝 URL/链接标记、电子邮箱、中国大陆手机号/座机以及明确标注的微信/QQ/其他联系账号。

客户端复用同一组公开测试向量做即时提示，服务端必须独立重算。稳定错误为 `SENSITIVE_CONTENT_NOT_ALLOWED`，字段指向 `facts` 或 `resolution_note`。检测只覆盖可确定的联系方式与链接，不声称能识别所有姓名或自然语言中的个人信息；页面同时明确提示“不要填写手机号、微信号、邮箱、链接或其他可识别个人的信息”。

举报事实只向举报人本人和 `PLATFORM_ADMIN` 返回。普通用户响应永远不含平台内部处置说明、平台 principal、组织者 user ID、报名备注、手机号、OpenID、支付或退款字段；公开球局与其他报名者不出现举报是否存在。

## 5. 生产数据与迁移 `0024`

生产阶段新增 `backend/migrations/versions/0024_open_game_reports.py`，严格 `down_revision = "0023"`。

### `open_game_reports`

- `id UUID PK`；
- `game_id UUID FK → open_games.id ON DELETE RESTRICT`；
- `reporter_registration_id UUID`、`reporter_user_id UUID`，通过现有 `(registration id, game id, applicant user id)` 复合唯一键绑定真实报名身份；
- `organizer_user_id UUID FK → users.id ON DELETE RESTRICT`，由锁内真实订单 owner 快照，不能由客户端提交；
- `category open_game_report_category`，严格五值；
- `facts VARCHAR(500)`，标准化后 1..500 code points；
- `submitted_at TIMESTAMPTZ`；
- `idempotency_key VARCHAR(128)`、`request_sha256 VARCHAR(64)`；
- 唯一 `(game_id, reporter_user_id)` 与 `(reporter_user_id, idempotency_key)`；
- `(submitted_at DESC, id DESC)` 队列索引；
- UPDATE/DELETE trigger 统一拒绝。

### `open_game_report_resolutions`

- `id UUID PK`；
- `report_id UUID UNIQUE FK → open_game_reports.id ON DELETE RESTRICT`；
- `outcome open_game_report_resolution_outcome`，严格三值；
- `resolution_note VARCHAR(500)`，必填且使用同一隐私校验；
- `resolved_by_principal_id VARCHAR(128)`、`resolved_at TIMESTAMPTZ`；
- `game_version_before`、`game_version_after` nullable pair：仅 `CONFIRMED_GAME_CANCELLED` 必填，且 after = before + 1；其他结论两者都为空；
- `idempotency_key VARCHAR(128)`、`request_sha256 VARCHAR(64)`；
- 唯一 `(resolved_by_principal_id, idempotency_key)`；
- UPDATE/DELETE trigger 统一拒绝。

`open_games` 新增 nullable `cancellation_source open_game_cancellation_source`：

```text
CAPTAIN | PLATFORM_REPORT
```

迁移把历史持久 `CANCELLED` 行回填为 `CAPTAIN`，并把时间约束升级为：所有非 `CANCELLED` 状态（包括现在或未来的 `DRAFT`、`PUBLISHED`、`SUSPENDED`、`COMPLETED`）的 `cancelled_at` 与 source 必须同时为空；只有 `CANCELLED` 的 `cancelled_at` 与 source 必须同时存在。既有队长取消路径显式写 `CAPTAIN`；C2f 只写 `PLATFORM_REPORT`。

存在任何举报、处置或 `PLATFORM_REPORT` 取消行时，`0024` downgrade 必须 fail-closed，不能丢失审计。空数据降级时先恢复历史 `CAPTAIN` 取消为原 schema，再删除新 enum/列/表/trigger。

## 6. 平台结论与真实取消事务

只有 `PLATFORM_ADMIN` 能读取举报队列、详情或提交结论；`ONBOARDING_REVIEWER` 不显示模块，直接访问统一返回 403。继续复用 8 小时 Secure 会话、Origin、CSRF、`no-store`、CSP 和现有 API client。

未结案详情的服务端 `allowed_outcomes` 至少包含：

```text
DISMISSED
CONFIRMED_RECORDED
```

只有锁内同时满足以下条件时才增加 `CONFIRMED_GAME_CANCELLED`：

- `server_now < starts_at`；
- 持久状态精确为 `PUBLISHED`；
- 有效状态精确为 `PUBLISHED`；
- 真实订单为 `CONFIRMED`；
- `cancel_requested_at IS NULL`；
- 没有控制中的订单取消或库存冲突退款 authority。

处置固定锁序：

```text
非锁定定位 report → game → order
→ Order FOR UPDATE
→ OpenGame FOR UPDATE
→ Report/Resolution identity check
→ lock order authority
```

事务锁内重新验证未结案、role、idempotency、文本、最新时间与取消资格。`DISMISSED` 和 `CONFIRMED_RECORDED` 只插入 resolution。`CONFIRMED_GAME_CANCELLED` 还会：

- 写 `game.status = CANCELLED`、`cancelled_at = now`、`cancellation_source = PLATFORM_REPORT`；
- `game.version += 1` 并把版本对写入 resolution；
- 复用现有逻辑 supersede 该球局未发送的通知 outbox，避免发送失效到场信息；
- 不改写报名持久状态，现有有效投影统一显示 `CANCELLED`。

一旦同一真实订单下存在 `cancellation_source = PLATFORM_REPORT` 的球局，后续创建或发布该订单的任何替代球局都必须稳定拒绝 `409 ORDER_GAME_PLATFORM_CANCELLED`。该检查在 create/publish 的既有订单锁内执行，不能只依赖客户端隐藏入口；它只冻结平台举报取消的订单，`CAPTAIN` 普通取消仍保留既有重建语义。

事务前后必须证明 `Order`、`Slot`、`Payment`、`RefundCase`、`RefundAttempt` 全字段不变。平台取消球局不等于取消订场订单，也不产生退款。若确认时资格已变化，返回 `409 REPORT_RESOLUTION_STATE_CHANGED`；服务端不得悄悄把“取消球局”降级为“仅记录”，客户端刷新后由管理员重新选择。

每条举报只能有一个 resolution。首次结论与同 key、同摘要重放返回同一个 `200`；同 key 异摘要返回 `IDEMPOTENCY_KEY_REUSED`；其他 key 再处置返回 `REPORT_ALREADY_RESOLVED`。

## 7. 封闭 HTTP 契约

### 小程序本人接口

```http
GET  /api/v1/games/{game_id}/my-report
POST /api/v1/games/{game_id}/reports
Authorization: Bearer <user session>
Idempotency-Key: <16..128 chars>   # POST only
```

GET 对“球局不存在”和“当前用户没有该球局报名”统一返回 `404 REPORT_CONTEXT_NOT_FOUND`。成功响应为封闭 `OpenGameReportContext`：最小游戏/组织者展示摘要、`report_deadline`、服务端 `submission_allowed`/nullable blocker，以及 nullable 本人举报。已有举报只包含 ID、类别、本人原始事实、提交时间、`PENDING | RESOLVED`、nullable outcome/结案时间和固定用户文案，不含内部处置说明或 principal。

POST body 只含：

```json
{
  "category": "FALSE_INFORMATION",
  "facts": "公开说明称费用已包含，但现场要求额外支付场地费。"
}
```

### 平台接口

```http
GET  /platform-admin/api/v1/game-reports?state=PENDING|RESOLVED&limit=20&cursor=...
GET  /platform-admin/api/v1/game-reports/{report_id}
POST /platform-admin/api/v1/game-reports/{report_id}/resolution
Cookie: Secure platform session
Origin / X-CSRF-Token / Idempotency-Key   # POST
```

队列按 `(submitted_at DESC, id DESC)` opaque cursor 分页，只返回类别、状态、球局名称、组织球队、场地、时间和提交时间。详情增加举报事实、举报人的本场称呼/当前报名状态、结论审计、球局当前状态/cancellation source 和服务端 `allowed_outcomes`；不返回任何 user ID、手机号、OpenID、报名备注、订单号、支付或退款资料。

POST body：

```json
{
  "outcome": "CONFIRMED_RECORDED",
  "resolution_note": "已核对场馆值班记录与双方陈述，记录本次成立结论。"
}
```

所有 JSON object `additionalProperties: false`，固定 enum 拒绝未知值。客户端使用严格 decoder，不把未知字段静默带入 UI。

## 8. 小程序真实交互

新增生产路由 `pages/open-game-report/index`，从现有本人球局详情的 `viewerRegistration` 区域进入。入口文案“举报本场球局”，是否能真正提交始终由 reporting GET/POST 的服务端权威决定；公开访客与其他球员看不到本人举报状态。

页面只有一个职责：提交或读取该场举报。

1. 顶部显示球局、组织球队、场地和时间，明确“举报对象为本场球局及组织者”；
2. 无举报且窗口开放时，显示五个完整文本 radio 选项、有可见 label 的事实 textarea、`0/500` code point 计数和隐私提示；
3. “提交举报”先打开确认层，重复类别与“提交后不可修改”；取消不写入，确认才调用真实 POST；
4. 已提交时同页显示类别、本人事实、提交时间与“待平台处理”；
5. 结案后显示准确固定结果：驳回、成立已记录或成立且平台已取消，不声称处罚、封禁或退款；
6. 截止但未举报时保留只读说明，不渲染无效提交按钮。

客户端把 submit attempt 按账号与 game 持久化。网络超时导致结果未知时锁定新提交，“确认提交结果”先 GET：若已存在本人举报则清 attempt 并展示；若权威仍无举报且窗口仍开，只用原 key/原 body 重放；不得生成新 key猜测成功。登录恢复、页面 hide/unload 和迟到响应继续使用现有 generation guard。

所有 radio、返回、提交、取消、确认、重新登录、重试和确认原结果按钮都必须有真实导航、状态或 HTTP 行为；不能只 Toast。按钮显式 flex 双轴居中，iOS 触控区不小于 44pt、Android 不小于 48dp，固定底栏必须给滚动内容和 safe area 留出空间。

## 9. 平台桌面交互

目标 viewport `1440 × 900`，复用现有平台运营台壳、字体、色彩、模块导航和会话。新增“举报处置”模块，不创建第二套后台。

- 左列：`待处理 / 已结案` 筛选、刷新、稳定分页列表；选择行读取真实详情；
- 主区：举报目标、类别、事实、报名上下文、球局/订单健康摘要、提交时间；已结案时显示唯一不可变结论；
- 未结案处置区：只显示服务端 `allowed_outcomes`，有可见 label 的处置说明和就地错误；
- 确认 dialog：重复球局、结论和不可撤销说明。取消球局结论额外明确“只取消公开球局，不修改订场订单或退款”；
- unknown result：锁定列表切换、筛选和第二次提交，先刷新同一 report 的权威详情；如仍未结案才以原 key 重放。

`CONFIRMED_GAME_CANCELLED` 只在服务端允许时显示，并使用克制的红色语义；`DISMISSED`/`CONFIRMED_RECORDED` 使用中性/蓝色。关闭/X、Escape、Tab/Shift+Tab focus trap、焦点恢复、退出登录、筛选、刷新、分页、选择、取消与确认都必须是真实行为。

## 10. Development-only 预览与 Fixture

生产接入前先完成严格隔离的预览：

- 平台 marker：`GAME_REPORT_RESOLUTION_FIXTURE`；
- 小程序 marker：`C2F_GAME_REPORT_FIXTURE`；
- 不 fetch/XHR/WebSocket/sendBeacon，不读写 local/session storage，不 import 生产 service；
- 文案固定显示“Development-only Fixture / 模拟数据，不会提交或修改生产数据”；
- production build/audit 必须排除 marker、路由、模拟 UUID、模拟球局名和全部 dev source。

Fixture 必须真实覆盖：

1. 小程序空白、类别、事实、隐私错误、确认取消、确认提交；
2. 待处理、三种结论、过期未提交；
3. 用户提交 unknown result 后 GET 恢复或同 key 重放；
4. 平台待处理/已结案筛选、行选择、刷新、分页；
5. 三种结论、取消资格消失、失败和 unknown result 权威恢复；
6. 取消结论只改变 Fixture game status/version/source，不触碰 Fixture order/payment/refund snapshot。

代表性视觉只冻结：

- 平台 `pending-detail` 与 `cancel-confirm`：`1440 × 900`；
- 小程序 `report-form` 与 `resolved-cancelled`：iOS `390 × 844`、Android `411 × 731`。

其余状态做聚焦行为测试和一次人工点检，不扩张为全状态截图矩阵。

## 11. 测试、视觉门与交付边界

生产 TDD 依次覆盖：封闭 OpenAPI/示例、跨语言文本向量、`0024` 迁移/trigger/downgrade、资格与截止投影、举报提交的 Order→OpenGame→Registration 固定锁序、唯一性/幂等/并发、平台 role/CSRF、三结论、取消锁序及订单全字段不变、`PLATFORM_REPORT` 取消后的同订单替代球局拒绝与 `CAPTAIN` 取消的既有重建语义、严格 TypeScript decoder、持久 attempt、页面所有按钮和 stale guard，以及真实 Uvicorn HTTP journey。

预览阶段先写失败测试，再实现最小 store/页面；每个按钮都要被行为测试证明。fresh development build 必须含 C2f 路由，fresh production build/audit 必须不含任何 C2f Fixture。

视觉自审后，由未参与 C2f 实现的独立 agent 在目标真实运行时检查代表状态：

- 按钮文字水平/垂直居中，同组 radio/列表/状态徽标对齐；
- 返回箭头、关闭 X、focus ring 与 dialog 焦点完整；
- 长事实、500 字计数、错误、状态和时间不裁切；
- 小程序键盘、滚动、固定底栏和 safe area；
- 平台 1440×900 的列表/详情层级、dialog、Tab/Escape；
- 文案不暗示处罚、退款、通知或自动结论，隐私字段不泄露。

只有没有 Critical/Important 问题时才能记 `DELEGATED_VISUAL_PASS`。它不替代用户次日真机验收，也不批准部署或合并。若 Computer Use/微信开发者工具原生通道失败，只做一次合理重试；仍失败则保持对应门 `PENDING`，不以静态 HTML或历史截图冒充。

当前指定 C2d 基线的 Node 套件为 741/741 + Jest 2076/2076 通过；后端有 8 个既有测试未随必填 nullable `attendance_corrected_at` 更新（其余 1831 通过）。该基线漂移由 C2d 轨独立修复，C2f 不修改或弱化相关断言。C2f 的 focused RED/GREEN 与最终回归证据必须单独记录。
