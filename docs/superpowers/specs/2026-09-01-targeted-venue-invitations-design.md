# D1a 定向招商邀请设计

**目标：** 平台工作人员可以为一个尚无管理人的目录场馆生成一次性、短期有效的邀请；收到邀请的微信用户只能为自己绑定邀请并继续提交既有 A3 `CLAIM` 申请，接受邀请本身不授予任何场馆权限。

## 范围

本切片只覆盖“平台选定已有场馆 → 生成邀请 → 微信用户接受 → 补充认领材料 → 进入既有人工审核”这一条旅程。

纳入：

- 平台运营台创建、查看、复制和在申请提交前撤销邀请；
- 微信用户查看邀请、显式接受并进入锁定目标场馆的认领表单；
- 邀请与现有 A3 `CLAIM` 申请建立不可变关联；
- 申请仍由既有平台入驻审核批准或驳回；
- 过期、撤销、跨用户使用和并发提交的真实错误状态。

不纳入：

- 通过邀请创建新场馆；
- 接受邀请后直接创建 membership；
- 自动批准、批量邀请、短信或微信模板消息发送；
- 场馆员工邀请与分级授权（D1b）；
- 改造 A3 的证明材料类型和审核规则。

## 关键决策

### 1. 邀请只指向可招商的已有目录场馆

创建时服务端锁定目标 `venues` 行，并要求：

- `is_active=true`；
- `is_listed=true`；
- `booking_mode=DIRECTORY_ONLY`；
- 不存在任何 active `venue_memberships`。

因此邀请不能覆盖已有负责人、不能把未公开场馆暴露给收件人，也不能把在线经营场馆重新走一遍认领。

### 2. 令牌只返回一次，数据库只保存摘要

平台创建邀请后只在该响应中得到一次原始令牌与小程序路径；数据库持久化 `SHA-256` 摘要，不保存可重放原文。令牌使用密码学安全随机值，默认七天过期。

同一场馆同时只允许一个未终结邀请。创建事务先锁场馆，再将已过期邀请收敛为 `EXPIRED`，最后检查 `ACTIVE | CLAIMED`，避免并发生成多条有效邀请。

### 3. 第一次显式接受绑定唯一微信用户

查看邀请是只读操作；用户点击“接受邀请并继续认领”后，服务端才在事务中把 `ACTIVE` 邀请绑定到当前登录用户并写为 `CLAIMED`。同一用户重放返回同一结果，其他用户之后使用同一令牌统一返回不可用，不泄露已绑定用户身份。

绑定不创建申请、不创建 membership，也不代表场馆方已通过核验。

### 4. 认领提交仍复用 A3 权威边界

绑定用户在邀请页进入现有认领材料表单。邀请式提交使用专用命令：

`POST /api/v1/venue-invitations/{token}/claims`

请求只包含 `contact_name` 与既有两项 `CLAIM` evidence；`venue_id` 由邀请权威确定，客户端无法替换。服务层复用 A3 的手机号快照、证据归属/类型/完成态检查、重复 SUBMITTED 申请约束和幂等记录。

成功后在同一事务内：

1. 创建普通 `VenueOnboardingApplication(kind=CLAIM, status=SUBMITTED)`；
2. 将邀请写为 `SUBMITTED`；
3. 记录唯一 `application_id`。

后续仍由 A3 审核。批准时才由既有逻辑创建或激活 membership。

### 5. 撤销只发生在提交申请以前

平台可撤销 `ACTIVE` 或 `CLAIMED` 邀请，并记录操作者、时间和 1—120 字原因。`SUBMITTED` 邀请不可撤销；此时应处理关联申请。撤销不会删除用户、证据或申请。

## 数据模型

新增 `venue_recruitment_invitations`（迁移预留 `0025`，最终接在 C2f `0024` 后）：

- `id`, `venue_id`；
- `token_sha256`（unique）；
- `status`: `ACTIVE | CLAIMED | SUBMITTED | REVOKED | EXPIRED`；
- `contact_label`（平台内部备注，1—40 字，不收手机号）；
- `expires_at`, `created_at`, `created_by_principal_id`；
- `claimed_by_user_id`, `claimed_at`；
- `application_id`（nullable unique）；
- `revoked_at`, `revoked_by_principal_id`, `revocation_reason`；
- `version`。

数据库约束保证每个状态所需字段成组出现。邀请与申请保留审计记录，不做物理删除。

## API

平台端（`PLATFORM_ADMIN | ONBOARDING_REVIEWER`，mutation 继续要求平台 CSRF 会话）：

- `GET /platform-admin/api/v1/recruitment-invitations/eligible-venues?q=`
- `GET /platform-admin/api/v1/recruitment-invitations?status=&cursor=`
- `POST /platform-admin/api/v1/recruitment-invitations`
- `POST /platform-admin/api/v1/recruitment-invitations/{id}/revoke`

普通微信端（必须登录）：

- `GET /api/v1/venue-invitations/{token}`
- `POST /api/v1/venue-invitations/{token}/accept`
- `POST /api/v1/venue-invitations/{token}/claims`

所有 mutation 都要求 `Idempotency-Key`。平台列表绝不返回令牌；创建响应之外只能看到状态、目标场馆、内部备注、到期时间和绑定/申请是否存在。

## 页面与交互

### 平台运营台

新增“招商邀请”模块，沿用现有平台设计系统：

- 左栏展示邀请及状态筛选；
- 右栏顶部选择可招商场馆并填写内部称呼；
- 创建成功后显示一次性路径与“复制邀请路径”；
- `ACTIVE | CLAIMED` 显示“撤销邀请”，必须填写原因并二次确认；
- `SUBMITTED` 显示“查看关联申请”，跳回既有入驻审核；
- 复制失败、创建结果不确定、撤销结果不确定均给真实恢复动作。

### 微信小程序

新增 `pages/venue-invitation/index`：

- 顶部使用现有原生导航与安全区；
- 明确显示“平台招商邀请”、场馆名称、区域、地址和有效期；
- 未接受时主按钮为“接受邀请并继续认领”；
- 已绑定当前用户时主按钮为“补充认领资料”；
- 已提交时展示“认领申请待审核”并可进入“我的场馆申请”；
- 过期、撤销或已被其他用户绑定时展示不可用状态，不暴露原因中的用户信息；
- 认领表单锁定场馆身份，仅允许填写联系人和上传既有两项材料。

## 状态与失败恢复

- 创建/接受/提交/撤销均先记录可恢复的本次 attempt；同 key 同请求重放原响应，不同请求返回 `IDEMPOTENCY_KEY_REUSED`。
- 客户端在超时后不显示成功，刷新邀请或平台列表读取权威状态。
- 邀请到期以服务端 UTC 时间为准；读取和 mutation 都会收敛过期状态。
- 邀请提交与普通 A3 CLAIM 共享“同用户同场馆最多一个 SUBMITTED”约束；冲突时不消耗邀请和材料。
- 批准时仍重新检查场馆 active 状态及 membership，不能依赖七天前的创建资格。

## 预览与完成定义

视觉预览使用显式 `D1a 开发预览 · 模拟数据`，生产构建禁止 Fixture。独立 agent 至少审核：

- 平台 1440×900 的创建成功与撤销确认；
- 小程序 iOS 390×844 的可接受状态；
- Android 411×731 的已绑定/继续认领状态；
- 按钮文字双向居中、重复状态徽标对齐、导航/图标完整、长地址不裁切、滚动和安全区。

切片只有在真实 PostgreSQL、真实身份、真实 A3 申请与审核链路接通，所有可见按钮有后端行为，Fixture 从生产构建移除，独立审核与聚焦回归通过后才算实现完成。用户真机集中验收保留到统一体验版。
