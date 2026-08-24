# C1a 散客申请与队长审核生产集成设计

日期：2026-08-24

状态：`APPROVED_FOR_PLANNING`。用户已逐段确认架构、数据与权限、API 与页面数据流、验证与发布顺序。

上游文档：

- [三类用户与开放球局产品设计](./2026-08-09-three-sided-football-product-design.md)
- [队长开放球局设计](./2026-08-18-captain-open-game-design.md)
- [C1a 散客申请与队长审核预览设计](./2026-08-24-player-game-application-preview-design.md)
- [C1a 散客申请与队长审核预览实施计划](../plans/2026-08-24-player-game-application-preview.md)

## 1. 目标与完成边界

C1a 只闭环一条私域分享旅程：

```text
分享链接球局详情
→ 登录
→ 填写并提交申请
→ 队长从管理球局进入报名审核
→ 队长接受或婉拒
→ 申请人回到同一分享详情读取结果
```

完成时必须同时满足：

- 申请、审核和结果回读使用真实 FastAPI、PostgreSQL、微信会话与生产小程序 HTTP source；
- `APPLIED → JOINED | REJECTED` 由服务端权威状态驱动；
- 接受申请只占用开放球局名额，不修改订单、支付、退款、场地库存或线上收付款能力；
- 所有可见按钮都有真实行为，未知结果不会显示假成功；
- production build 不含 C1a Fixture、开发路由、模拟身份或合成业务数据；
- 候选体验版通过队长与申请人双账号验收后，删除 C1a development Fixture，再合并、推送、部署并上传最终体验版。

本切片不启用“我要找球踢”，也不实现公开球局目录、候补、退出、重新申请、我的报名、审核历史、通知、聊天、评分或线上 AA。

## 2. 方案选择

采用独立报名聚合。数据库新增报名表，后端新增边界清晰的报名模块，API 使用 `applications` 产品语义；现有 B2 球局继续负责球局、分享令牌、订单权威和生命周期。

不把报名数组或报名计数加入已封闭的 `OpenGamePublic` / `OpenGameOwner`，避免破坏体验版旧契约。不复用订单参与者或支付模型，因为申请不是预订、支付或库存记录。

共享能力只复用当前已经存在的实现：

- B2 `OpenGame`、分享令牌、owner 权限和生命周期投影；
- bearer 微信会话；
- 通用 `idempotency_records` 及现有 claim / complete 模式；
- 小程序 session store、HTTP transport 和 production bootstrap。

不为 C1a 建设通用工作流框架、事件总线、聚合计数缓存或第二套幂等基础设施。

## 3. 组件边界

### 3.1 后端报名模块

报名模块负责：

- 报名 DTO 与封闭响应；
- 报名生命周期和 `allowed_actions` / blocker 投影；
- 申请人隐私过滤；
- 报名持久化、owner 查询和并发接受；
- 四个报名 API。

它依赖 B2 的球局与订单权威，但不得改变 B2 公开 DTO 的字段集合。B2 取消球局不批量改写报名；报名模块根据球局和订单事实投影有效取消状态。

### 3.2 小程序报名域

新增报名专属 domain、严格 decoder、HTTP source 和持久 mutation-attempt store。它们与现有 open-game sibling 模块并列，不扩大 B2 decoder 或把申请逻辑塞进订单服务。

生产页面包括：

- 修改现有 `pages/captain-game-public` 的 shared 模式；
- 新增申请表页；
- 新增队长报名审核页；
- 修改现有 `pages/captain-game-manage`，增加真实“报名审核”入口。

队长 owner preview 继续读取现有 B2 owner 数据，不通过分享报名上下文冒充 owner 权威。

## 4. 持久数据模型

迁移 `0016` 新增 `open_game_registrations`，不改变 `open_games.open_spots` 的“配置开放容量”语义。

每条报名包含：

- `id: UUID`；
- `game_id: UUID`，外键指向 `open_games`；
- `applicant_user_id: UUID`，外键指向 `users`；
- `display_name: varchar(24)`；
- `position: GOALKEEPER | DEFENDER | MIDFIELDER | FORWARD | ANY`；
- `note: varchar(120) | null`；
- `status: APPLIED | JOINED | REJECTED`；
- `version >= 1`；
- `consent_version`，由服务端固定写入 `c1a-2026-08-24`；
- `adult_confirmed_at` 与 `risk_confirmed_at`；
- `applied_at`；
- `decided_at | null` 与 `decided_by_user_id | null`；
- `created_at` 与 `updated_at`。

约束：

- 唯一键 `(game_id, applicant_user_id)`，终态后不能重新申请；
- `APPLIED` 必须没有决定时间和决定人；
- `JOINED` / `REJECTED` 必须同时具有决定时间和决定人；
- `decided_at >= applied_at`；
- 待审核查询索引为 `(game_id, status, applied_at, id)`；
- 不增加持久 `NONE` 或 `CANCELLED`，两者只存在于响应投影；
- 不增加删除、退出、候补、到场、评分或通知字段。

服务端验证并规范化：

- 称呼 trim 后为 2–24 个可见字符；
- 位置必须是五个封闭值之一；
- 备注 trim 后为空时存 `null`，否则最多 120 个字符；
- 称呼和备注拒绝手机号、微信号、URL 与中国大陆身份证号；
- 成年与风险确认必须都为 `true`，确认时间与固定条款版本 `c1a-2026-08-24` 由服务端生成，不能信任客户端时间或版本。

队长不能申请自己组织的球局；该约束由服务端根据 `OpenGame → Order.user_id` 判断。

## 5. 生命周期、容量与并发

持久转换只有：

```text
APPLIED --ACCEPT--> JOINED
APPLIED --REJECT--> REJECTED
```

`APPLIED` 不占名额，`JOINED` 才占名额。服务端每次投影：

```text
remaining_spots = max(open_spots - JOINED_count, 0)
```

不新增可漂移的聚合计数列。

### 5.1 申请动作

仅在以下条件全部成立时 `can_apply = true`：

- 分享令牌对应有效球局；
- viewer 已登录且不是队长本人；
- 持久球局为 `PUBLISHED`，订单权威健康；
- 当前时间早于报名截止和开场时间；
- `remaining_spots > 0`；
- viewer 对本球局尚无报名。

匿名读取返回登录阻塞原因；无效或过期 bearer 不降级成匿名，而是返回 401。

### 5.2 审核动作

报名截止只阻止新申请。队长可在截止后、开场前继续处理已有 `APPLIED`。

`can_accept` 要求：

- viewer 是 `Order.user_id`；
- 报名仍为 `APPLIED` 且版本匹配；
- 球局仍可审核，订单不处于暂停、取消、退款异常或完成状态；
- 当前时间早于开场；
- 锁内重算后仍有名额。

`can_reject` 使用相同身份、状态和开场边界，但不要求仍有名额。

所有会同时接触 B1/B2/C1a 的写操作保持 `Order → OpenGame → Registration` 锁顺序。接受操作锁定权威行和目标报名，在同一事务内统计 `JOINED` 后决定。若最后一个名额已被其他请求占用，返回容量冲突，目标报名保持 `APPLIED`，不自动候补或婉拒。

### 5.3 取消投影

球局或其权威订单取消时，申请人上下文把有效报名结果投影为 `CANCELLED`，并禁用报名和审核动作。数据库保留原始 `APPLIED` / `JOINED` / `REJECTED` 以供一致性与审计，不修改订单、支付、退款或库存。

## 6. API 契约

所有新 schema 都封闭额外字段，并加入 OpenAPI 示例与契约校验。新 child routes 必须注册在现有 `GET /api/v1/shared-games/{share_token:path}` catch-all 之前，防止分享详情路由吞掉报名路径。

### 6.1 报名上下文

`GET /api/v1/shared-games/{share_token}/registration-context`

- 无 Authorization 时允许匿名读取；
- 有有效 bearer 时返回本人报名；
- 响应嵌套现有、字段不变的 `OpenGamePublic`；
- 同时返回 `remaining_spots`、viewer 是否登录、本人报名或 `null`、`can_apply` 和一个封闭 `apply_blocked_reason | null`。

本人报名只返回本人的称呼、位置、备注、持久/有效状态、申请时间和决定时间。匿名响应不泄露任何申请人信息。

### 6.2 提交申请

`POST /api/v1/shared-games/{share_token}/applications`

- 必须 bearer；
- 必须 `Idempotency-Key`；
- body 只含称呼、位置、备注、成年确认和风险确认；
- 成功为 201，并返回最新报名上下文；
- 使用不同 key 重复申请返回确定的“已经申请”冲突，客户端随后读取权威上下文；
- 同 key、同请求重放原响应；同 key、不同请求返回幂等 key 复用冲突。

### 6.3 队长待审核队列

`GET /api/v1/games/{game_id}/applications`

- 必须 bearer 且仅 owner 可读；
- 越权与不存在统一 404；
- 返回全部 `APPLIED`，按 `(applied_at, id)` 升序，不分页、不静默截断；
- 返回 `remaining_spots`、`pending_count` 和每条申请的版本与服务端允许动作；
- 每条申请只含 `id`、称呼、位置、备注、申请时间、版本、`can_accept`、`can_reject` 与 blocker；
- 不返回 applicant user ID、手机号、微信身份、头像、订单、支付、履约或评分。

队长小程序显示真实总数，但一次只呈现最早一条的已批准卡片构图；处理后从同一权威队列显示下一条。

### 6.4 接受或婉拒

`POST /api/v1/games/{game_id}/applications/{application_id}/decision`

- 必须 bearer 与 `Idempotency-Key`；
- body 为 `decision: ACCEPT | REJECT` 和 `expected_version`；
- 成功返回该报名的最新状态、版本、决定时间、`remaining_spots` 与最新允许动作；
- 接受容量冲突返回确定错误并附最新剩余名额，报名保持 `APPLIED`；
- 已处理、版本不符、球局状态改变或开场返回确定的状态冲突。

### 6.5 错误语义

新端点沿用仓库错误 envelope，至少区分：

- `AUTH_REQUIRED`；
- `OPEN_GAME_NOT_FOUND` / `APPLICATION_NOT_FOUND`，同时承担统一 404；
- `INVALID_ARGUMENT`；
- `APPLICATION_ALREADY_EXISTS`；
- `APPLICATION_NOT_ALLOWED` 与封闭 blocker；
- `APPLICATION_STATE_CHANGED`；
- `APPLICATION_CAPACITY_CHANGED`；
- `IDEMPOTENCY_KEY_REUSED`；
- `SERVICE_UNAVAILABLE`；
- 客户端本地 `APPLICATION_RESULT_UNKNOWN`，用于网络超时、5xx 或 malformed success。

服务端是 `allowed_actions` 和 blocker 的唯一权威；客户端只用本地状态防重复点击，不自行放宽权限。

## 7. 幂等与未知结果恢复

申请和审核复用现有 `idempotency_records`，operation 名称与 request digest 包含目标资源和封闭请求内容。数据库响应记录保存可重放的成功结果，不新增第二套 attempt 表。

小程序持久化一条报名 mutation attempt：

- 申请 attempt 绑定 share token、表单快照和 key；
- 审核 attempt 绑定 game ID、application ID、decision、expected version 和 key；
- 页面卸载、重新登录或应用重启都不生成新 key；
- 有未确认的 foreign attempt 时，必须先解决它，再允许新写操作。

申请未知时先重新读取报名上下文：若报名已经存在则接受权威结果并清除 attempt，否则以同 key 重放。审核未知时以同 key 重放以取得服务端保存的决定响应；若收到确定状态冲突，再刷新待审核队列。任何未知、401、409 或 503 都不得提前显示 `JOINED` / `REJECTED`。

## 8. 小程序页面行为

### 8.1 分享详情

- shared 模式读取报名上下文；owner preview 模式保持现有 B2 owner source；
- 匿名可看公开详情，底部为真实“登录并继续”；
- 登录完成后重新读取同一 share token，再决定是否显示“申请加入”；
- `APPLIED`、`JOINED`、`REJECTED` 和有效 `CANCELLED` 都在同一详情显示；
- 满员、暂停、取消和结束只显示服务端 blocker，不提供候补或假动作；
- `APPLIED` 的“刷新结果”真实重读上下文。

### 8.2 申请表

- production route 只接受合法 share token；
- 字段、校验、确认和固定底栏复用已批准构图；
- 返回/取消不写报名；
- 提交中禁止重复操作；
- 401 保留 draft 和 attempt，重新登录后继续；
- 确定的满员或状态改变丢弃未提交 attempt，返回最新详情；
- 未知结果提供“确认申请结果”，不显示假成功。

### 8.3 队长审核

- 管理页仅在 owner 有效状态为 `PUBLISHED` 时显示“报名审核”入口；真实权限仍由后端列表端点裁决；
- 页面显示待审核总数与最早申请，接受/婉拒都先打开确认层；
- 关闭确认层不改状态；
- 处理成功后从权威列表显示下一条或空状态；
- 满员后仍可婉拒，接受按钮由服务端动作关闭；
- 容量冲突保留申请并提供真实刷新；
- 401、404、加载失败和未知结果使用已批准的内联恢复动作。

## 9. 聚焦验证

### 9.1 后端与契约

采用 TDD，覆盖：

- `0015 → 0016 → 0015 → 0016` 迁移循环、数据库 check/unique/FK/index 与模型一致性；
- 服务层申请、重复申请、owner self-apply、截止、满员、终态、取消投影、版本和幂等；
- API 匿名/登录/owner/non-owner、统一 404、字段过滤、严格请求与错误矩阵；
- OpenAPI schema、examples 和生成 Fixture 一致性；
- PostgreSQL 两线程竞争最后名额，恰好一个 `JOINED`，另一个保持 `APPLIED`；
- 真实 Uvicorn/PostgreSQL 双身份 HTTP 旅程；
- 旅程前后 Order、Slot、Payment、RefundCase 等 B1 权威数据不变。

### 9.2 小程序

聚焦覆盖：

- closed exact-object decoder；
- 精确 path/body/header、401、409、timeout、5xx 与 malformed success；
- attempt 持久化、重启恢复、同 key 重放和 foreign attempt；
- 页面 stale response、加载/错误/恢复和每个可见按钮 handler；
- manage → review、shared detail → application、提交 → 回详情的真实导航；
- development / production 组合与 production package audit；
- TypeScript、聚焦 ESLint、相关 Jest/Node 测试以及 development/production build。

不以仓库外既有 lint 错误扩大本切片。既有检查足以证明行为时，不新增重复测试层。

### 9.3 原生与视觉

在官方 WeChat DevTools、iPhone X `375×812` 对 production 页面做一次代表性人工视觉自审，并运行接受、婉拒和容量变化交互。检查按钮双轴居中、重复控件列线、图标完整、裁切、固定底栏和安全区。已批准的六帧不重复全量拍摄。

## 10. Fixture 清理、部署与体验版

仓库当前接受记录只证明 B2 Task 9 本地 HTTP 与小程序自动化，B2 shared staging / 真机 Task 10 仍是显式门禁。C1a 候选发布同时回归 B2 创建、管理、分享以及 C1a 申请、审核、结果回读，不用旧 production build 或 Fixture 结果替代。

顺序：

1. 在功能分支完成契约、后端、小程序和本地聚焦验证；
2. 构建并审计候选 production 包；
3. 部署功能分支候选后端到 shared staging，确认迁移 head、revision、health 和真实 API smoke；
4. 以上传时微信后台的实际版本为基线，上传下一候选体验版；
5. 由不同的队长与申请人体验账号完成真实设备申请、接受、婉拒和结果回读，同时回归 B2 创建/管理/分享；
6. 验收通过后删除 C1a Fixture store、dev C1a 页面、场景启动器和专属开发路由；保留 Artifact、参考图、比较图与验收记录；
7. 重新运行 production audit，合并到 `main`、推送、部署最终 SHA，并上传下一最终体验版。

迁移 `0016` 是纯新增，旧应用在迁移后仍能运行。应用回滚时保留新增表，不对已有报名数据执行线上 downgrade；恢复后再继续使用。部署和构建不得打印 ignored live 配置或 secret。

## 11. 完成定义

C1a 只有在以下全部成立时才完成：

- 用户批准的申请与审核页面连接真实生产契约；
- 接受、婉拒、未知结果、最后名额并发、越权与取消投影通过聚焦自动化；
- shared staging 和双账号设备旅程通过；
- C1a development Fixture 已删除，production audit 为零泄漏；
- 最终代码已合并 `main` 并推送；
- 最终后端 SHA 已部署，最终体验版已上传并记录版本与 revision；
- 没有把 B2 Task 10、支付、退款、库存、公开发现或后续 C1b/C1c 能力误报为已完成。
