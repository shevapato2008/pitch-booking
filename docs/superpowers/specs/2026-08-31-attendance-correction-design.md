# C2d 平台到场人工纠错设计

日期：2026-08-31

状态：`APPROVED_FOR_PRODUCTION_IMPLEMENTATION`。用户已于 2026-09-01 明确授权继续完成小程序剩余模块，并将视觉决策委托给未参与实现的独立 agent。本设计的产品与数据边界保持不变，从今日起允许按独立生产计划实现契约、迁移、后端、平台管理端和小程序真实回读；在用户次日集中验收前不合并入 `main`。

设计起点：`cd8ac51bb4c19a2627d60a9417ea590331e245c1`。实际生产实施基线已追至最新 C2c candidate `112fcbd2cd2eda6cab6997d20badfda7ccd4d828`。

上游：

- [三类用户平台整体切片路线图](../plans/2026-08-16-overall-slice-roadmap.md)
- [C2c 队长赛后到场记录基础设计](./2026-08-30-attendance-recording-foundation-design.md)
- [C2c 队长赛后到场记录生产接入计划](../plans/2026-08-31-attendance-recording-production.md)
- [C2d Development Preview 实施计划](../plans/2026-08-31-attendance-correction-preview.md)

## 1. 目标与严格边界

C2d 只闭合一个低频、受控的平台纠错旅程：队长已经把一位 `JOINED` 散客记录为 `PRESENT` 或 `NO_SHOW` 后，平台管理员根据线下核实结果，将当前有效到场状态纠正为另一个终态，并保留原始记录与每次纠正的不可变审计。

```text
队长或球员复制报名编号
→ 通过现有平台外客服渠道提交核实请求
→ PLATFORM_ADMIN 在平台运营台精确查询报名编号
→ 核对球局、场馆、时间、球员本场称呼、原记录、当前状态与纠正历史
→ 填写必填理由并确认 PRESENT ↔ NO_SHOW
→ 服务端原子追加纠正审计并更新当前有效状态
→ 队长与球员权威回读“平台已纠正”的当前结果
```

本切片不新增客服工单或申诉入口。用户端只增加“复制报名编号”，继续使用现有平台外客服渠道；这是当前最小可闭环方案，不提前建设工单队列、消息中心或通用运营搜索。

明确非目标：

- 平台把 `UNMARKED` 直接标为到场或未到场；
- 队长撤销、自行改判、批量标记或“全部到场”；
- 模糊搜索、手机号/OpenID 查询、纠纷工单、举报、通知或聊天；
- 评分、信用分、处罚、封禁、赔付或统计报表；
- 固定队员、公开访客、订单参与方以外的人查看个人到场结果；
- 修改报名状态、候补顺位、容量、订单、球局生命周期或支付退款；
- 建设通用 RBAC、通用审计框架或移动端平台后台。

## 2. 方案裁决

### 方案 A：按报名 UUID 精确查询，单人纠正（采用）

平台管理员输入完整报名 UUID，只得到一条最小详情；终态记录允许纠正到相反终态。该方案披露面最小、目标确定、无需分页和复杂搜索，也能把每次人工操作绑定到明确版本。

### 方案 B：按分享令牌打开整场名单

操作较快，但会向客服或管理员暴露整场人员，并把公开分享语义与平台治理混合，因此不采用。

### 方案 C：建设通用客服工单与跨字段搜索

可支持未来争议处理，但会引入工单生命周期、分派、通知、检索与更多隐私面，超出当前到场纠错价值，因此不采用。

报名 UUID 已存在于队长名册和球员本人投影。C2d 只让两端以“报名编号”文案复制它，不暴露用户 ID，也不新增第二个业务编号。

## 3. 权限与平台复用

平台后台继续复用现有 `/platform-admin` 的登录、8 小时会话、CSRF、Origin 校验、`no-store`、CSP 和 API client；不新建登录体系。

- 只有 `PLATFORM_ADMIN` 可以看到“到场纠错”模块并调用查询/纠正 API；
- `ONBOARDING_REVIEWER` 不显示该模块，直接请求统一返回 403；
- 普通小程序用户、场馆管理员和队长均不能调用平台纠错 API；
- 后续实现使用独立 `AttendanceCorrectionController`，不得把到场治理塞入现有 onboarding `ReviewController`；
- 平台顶栏使用中性的“平台运营台”，模块导航只需“入驻审核 / 到场纠错”，不创建新的后台壳。

## 4. 权威状态与原记录保留

报名状态继续是 `APPLIED | WAITLISTED | JOINED | REJECTED | WITHDRAWN`；到场状态继续是：

```text
UNMARKED | PRESENT | NO_SHOW
```

C2d 只能执行：

```text
PRESENT --PLATFORM_CORRECT--> NO_SHOW
NO_SHOW --PLATFORM_CORRECT--> PRESENT
```

必须保留原始队长记录和纠正审计，不能只覆盖一列：

- `open_game_registrations.attendance_status` 表示当前有效状态；
- 现有 `attendance_recorded_at` 与 `attendance_recorded_by_user_id` 永远保留首次队长记录，不因平台纠正而改写；
- 每次纠正追加一条不可更新、不可删除的 event，包含 `from_status → to_status`、原因、平台 principal、时间和前后版本；
- 第一条 event 的 `from_status` 即原始队长结果，后续 event 串起完整变化；
- 允许再次纠正，但每次只能从当前终态切到相反终态；不得覆盖、折叠或删除历史。

选择“当前值 + append-only event”是最小实现：现有读路径继续读取 `attendance_status`，同时审计可以重建原记录和完整纠正链，不增加第二套“有效状态”投影。

## 5. 后续生产数据与迁移边界

本节冻结未来生产语义，但不在预览计划中实现。后续生产计划使用线性迁移 `0022`，`down_revision = "0021"`，新增 `open_game_attendance_corrections`：

- `id UUID PK`；
- `registration_id UUID FK → open_game_registrations.id ON DELETE RESTRICT`；
- `from_status`、`to_status`：只允许 `PRESENT | NO_SHOW` 且必须不同；
- `reason VARCHAR(1000)`：去首尾空白后 1..1000 字符；
- `corrected_by_principal_id VARCHAR(128)`：1..128 字符；
- `corrected_at TIMESTAMPTZ`；
- `registration_version_before`、`registration_version_after`，且 `after = before + 1`；
- `idempotency_key VARCHAR(128)`；
- `request_sha256 VARCHAR(64)`，只允许小写十六进制摘要。

最小唯一约束：

- `(registration_id, registration_version_after)`，保证一版报名最多一个纠正事件；
- `(corrected_by_principal_id, idempotency_key)`，保证同一平台 principal 的幂等键唯一。

存在纠正历史时，`0022` downgrade 必须拒绝无声丢弃审计。当前数据量不要求额外搜索索引；精确主键查询和注册外键足够。

## 6. 后续生产 API、事务与幂等

本节同样只定义下一阶段边界：

```text
GET  /platform-admin/api/v1/attendance/registrations/{registration_id}
POST /platform-admin/api/v1/attendance/registrations/{registration_id}/corrections
```

GET 返回最小详情、当前版本、原始记录、当前有效状态、纠正历史以及服务端投影的 allowed correction。POST 必须携带 `Idempotency-Key`（16..128 字符），body 只含：

```json
{
  "attendance_status": "NO_SHOW",
  "expected_version": 7,
  "reason": "已核对现场签到记录，原到场结果录入错误。"
}
```

写事务保持领域锁序：

```text
Order FOR UPDATE → OpenGame FOR UPDATE → Registration FOR UPDATE
```

锁内重新验证：目标存在、球局有效状态精确为 `COMPLETED`、报名仍为 `JOINED`、原始到场审计完整、当前状态为终态、目标正好是相反终态、`version == expected_version`。然后在同一事务追加 event、更新当前 `attendance_status` 并令版本加一；原始记录时间/人保持不变。

请求摘要至少包含 operation、registration ID、锁内解析出的 game ID、目标状态、expected version、标准化理由和 schema version：

- 同 principal + 同 key + 同摘要：返回首次 event；
- 同 principal + 同 key + 不同摘要：409；
- 不同 key 并发纠正同一版本：只有一个成功，另一个得到 authority/version conflict；
- 网络超时或畸形成功属于 unknown result：表单锁定并先 GET；仍是原版本时只重放原 key，已变化时显示权威状态，不生成新 key 猜测写入。

POST 返回不可变纠正 event；客户端随后 GET 刷新完整权威详情，不在前端本地拼接生产历史。

## 7. 隐私投影

平台查询只返回当前任务需要的字段：

- 报名 UUID；
- 球局名称、场馆、物理场地、开场/结束时间；
- 球员本场称呼和意向位置；
- 报名状态、原始到场状态/时间、当前有效状态/版本；
- 平台纠正 event 的状态变化、原因、principal 和时间。

平台接口不得返回手机号、OpenID、applicant/captain user ID、报名备注、成年/风险同意、支付或退款信息。

队长与球员只回读当前有效状态、原始记录时间和最新 `attendance_corrected_at`；UI 可显示“平台已纠正”，但不得显示纠正原因、平台 principal 或完整历史。公开球局、其他球员和匿名访问永远不出现到场或纠正字段。

## 8. 平台桌面页面

目标 viewport 为 `1440 × 900`。沿用现有平台后台的 Inter/system/PingFang、蓝灰底色、白色面板、细边框、蓝色主动作及绿/红/黄语义色；不采用新字体、夸张大标题、营销式布局或动画库。

页面结构：

1. 平台运营台顶栏：品牌、模块导航、当前 `PLATFORM_ADMIN` 和退出；
2. 精确查询区：一个“报名编号”输入框、“查询”和“清除”；明确提示不支持姓名/手机号搜索；
3. 结果详情：球局、场馆、时间、球员本场称呼/位置、原始记录、当前有效状态和版本；
4. 纠正历史：按时间正序展示不可变 event；无历史时诚实显示“暂无平台纠正”；
5. 纠正面板：唯一可选目标为当前终态的相反值，理由必填；
6. 确认 dialog：重复显示 `from → to`、报名编号和“将留下不可删除审计”，取消与确认均可操作。

完整视觉比较只冻结：

- `ready`：已查到终态记录、详情/历史/纠正表单完整；
- `confirm`：确认 dialog 打开、背景不可交互、焦点受控。

`lookup-empty`、`not-found`、`unmarked/ineligible`、`unknown-result`、`success` 只做聚焦行为测试和一次人工点检；除非发现可见问题，不扩张为全状态截图矩阵。

## 9. 小程序回读页面

小程序继续复用 C2c 的自定义导航、蓝灰卡片、状态徽标、滚动与安全区规则，代表 viewport 为 iOS `390 × 844` 与 Android Nexus 5X `411 × 731`。预览只覆盖两个受纠正结果影响的画面：

1. 队长“到场记录”：目标散客行展示当前有效状态、原始记录时间及“平台已纠正 · 时间”；提供“复制报名编号”；
2. 球员本人报名详情/回读：展示当前有效状态、“平台已纠正于 …”与“复制报名编号”。

按钮文字必须显式 flex 双轴居中，触控区 iOS 不小于 44pt、Android 不小于 48dp；返回箭头、卡片边界、长本场称呼、滚动和底部 safe area 不得裁切。复制使用真实 `wx.setClipboardData`，成功/失败回调更新可见内联反馈；不得只显示假 Toast。

## 10. Development-only Fixture 与按钮真实性

预览使用隔离的内存 store，不发起 fetch/XHR/WebSocket，不读写 local/session storage，也不 import 生产服务。唯一 marker：

- 平台：`ATTENDANCE_CORRECTION_FIXTURE`；
- 小程序：`C2D_ATTENDANCE_CORRECTION_FIXTURE`。

所有可见按钮必须有真实本地行为：

- 平台登录、退出、模块切换、查询、清除、提交、取消、确认、刷新权威状态；
- 小程序场景导航、返回、复制报名编号和复制失败后的重试；
- 确认后 Fixture 必须追加 event、更新当前状态并令本地版本加一；取消不得写入；
- unknown result 的“刷新权威状态”必须从确定性权威 Fixture 恢复，不可直接宣告成功。

Fixture 文案始终显示“Development-only Fixture / 模拟数据，不会修改生产数据”。生产构建必须排除 marker、路由、合成 ID、合成名称和 dev source。

## 11. 视觉决策门

同一目标 viewport 下必须分别保存 reference、implementation、side-by-side、50% overlay 和 difference；自动 diff 只能辅助定位，不能替代人工审核。

自审后安排一个未参与实现的独立 agent，只读检查：

- 平台 `ready`、`confirm` 的 `1440 × 900` 五类证据；
- 队长/球员两个回读画面在 iOS `390 × 844` 与 Android `411 × 731` 的五类证据；
- 按钮双轴居中、重复控件对齐、箭头/X 完整、边界/裁切、滚动/safe area、焦点/键盘、触控与复制反馈；
- 文案、状态、人数/时间和隐私投影没有事实错误。

用户已授权睡眠期间由该独立 agent 作视觉决策。只有没有 Critical/Important 问题时，才可记录 `DELEGATED_VISUAL_PASS`；这不等于用户真机验收，也不能批准生产实现、合并、部署或体验版上传。

若 Computer Use 或微信开发者工具原生通道不可用，只做一次合理重试；仍失败则保持对应设备门 `PENDING`，不长时间排障，也不以静态 HTML、另一设备或历史截图冒充真实运行时证据。

## 12. 预览验收、生产门与 Fixture 删除条件

本预览验收标准：

- 平台按完整报名 UUID 精确查询；未知、未记录和可纠正状态语义诚实；
- 纠正原因必填，确认前后状态与版本正确，原始记录不被 Fixture 覆盖；
- 平台 Fixture 的角色和隐私字段符合本设计；
- 队长与球员只看到当前结果、最新纠正时间与可复制报名编号；
- 所有预览按钮产生真实本地行为；
- fresh production platform/mini build 与审计均不含两个 marker、dev route、合成数据或 dev source；
- 代表视觉证据完成自审和独立 agent 审核。

通过预览门后，必须另写生产实施计划，依次完成静态/运行时契约、`0022`、后端事务、平台 API/client、小程序真实回读、真实本地 admin→player HTTP journey、staging 纠正再纠回、production audit 和物理 iOS/Android 验收。

Fixture 只能在以上生产链路与用户验收全部通过后删除，或保留为严格 development-only 资产；无论哪种选择，production isolation 必须持续通过。在此之前不得把 C2d 描述为生产完成，也不得合并、部署或上传统一体验版。
