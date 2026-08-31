# D1b 场馆员工与分级权限设计

**目标：** 已经由平台核验的场馆负责人可以通过一次性邀请增加员工，并按资料、场地、库存和订单履约四个范围授权；服务端在每次操作时重新校验 membership，邀请或前端展示本身不扩大权限。

## 范围

本切片覆盖：

- 场馆负责人查看员工、待接受邀请和审计摘要；
- 创建七天有效的一次性员工邀请，选择权限并复制小程序路径；
- 当前微信用户显式接受邀请后获得该场馆 `STAFF` membership；
- 负责人修改员工权限、停用员工、撤销待接受邀请；
- 平台管理员在异常恢复时转移唯一负责人；
- 生产部署在历史 membership 负责人映射未完成时保持关闭。

不纳入：

- 短信、通讯录搜索或代替员工登录；
- 多级角色模板、自定义角色、跨场馆权限组；
- 员工再次邀请员工；
- 自动负责人转移、负责人自助退出或删除审计记录。

## 权威模型

### 唯一负责人

每个可管理场馆必须恰有一个 active `OWNER`。数据库部分唯一索引保证同一场馆至多一个 active owner；业务事务和部署检查保证至少一个。负责人拥有全部四项能力，不能在普通员工页面取消权限、移除自己或转移负责人。

负责人转移仅允许 `PLATFORM_ADMIN`，事务按 `Venue → source membership → target membership` 固定顺序锁行，将原负责人降为拥有全部能力的 `STAFF`、目标员工升为 `OWNER`，并写不可变审计事件。目标必须是同一场馆的 active staff。

### 四项闭合权限

- `MANAGE_PROFILE`：编辑资料、图片和内容审核重试；
- `MANAGE_PITCHES`：维护物理场地配置；
- `MANAGE_INVENTORY`：读取及维护可售库存；
- `FULFILL_ORDERS`：读取今日订单并签到、完成或按既有规则退款。

权限没有继承或通配字符串。`OWNER` 服务端恒等于全部四项；`STAFF` 至少一项、至多四项。现有模块分别改用对应能力，不能继续用 `can_manage_inventory` 代表所有管理权。

### 安全邀请

负责人创建邀请时服务端锁定场馆和自己的 membership，并再次确认 active owner。令牌使用 32 字节密码学安全随机值；只有首次创建的 `201` 响应返回一次原始 token/path，数据库仅保存 SHA-256。相同幂等键的 `200` 重放只返回不含 secret 的邀请元数据；若首次响应丢失，负责人必须从列表确认状态、撤销并重新创建，服务端不能恢复原始 token。邀请默认七天有效，状态为：

`ACTIVE | ACCEPTED | REVOKED | EXPIRED`

小程序 deep link 的 query 只用于把 secret 交给落地页；落地页不得记录、上报或持久化原文。请求服务端时 secret 不进入 URL，而是放入明确列入日志脱敏规则的 `X-Venue-Staff-Invitation-Token` header。读取邀请不产生 membership；点击接受才在同一事务中绑定当前用户、创建或重新激活唯一 `(venue_id, user_id)` membership，并写审计。inactive `STAFF` 重激活时必须用邀请的精确权限集合完整覆盖旧权限，禁止合并或保留旧权限。已有 active `STAFF` 接受时也原子消费邀请并以邀请权限完整覆盖当前权限；已有 active `OWNER` 接受员工邀请返回冲突且不消费邀请，避免隐式降级负责人。已由其他用户接受、撤销或过期统一返回不可用，不披露身份。

邀请权限在创建后不可编辑；需要调整时撤销并重建。负责人可以同时邀请多人，但原始路径不能从列表或日志恢复。

## 数据与迁移

最终迁移号预留 `0026`，接 D1a `0025`：

- `venue_memberships` 新增 `role`、`can_manage_profile`、`can_manage_pitches`、`can_fulfill_orders`、`version`、`revoked_at`；保留 `can_manage_inventory` 作为真实库存能力；
- `venue_staff_invitations` 保存 token 摘要、四项权限、创建/接受/撤销权威字段和版本；
- `venue_membership_audit_events` 保存 actor、target、action、权限前后值、原因和时间，只追加不更新。

历史 membership 无法仅凭 `can_manage_inventory=true` 判断谁是法律/运营负责人。迁移先安全映射为 `STAFF` 并保持原库存能力；生产 D1b 必须由运维提供每个已有管理场馆唯一 owner membership 映射，运行校验/回填命令并通过“每场馆恰一 active OWNER”门禁后才可启用。禁止按最早创建、最小 UUID 或账号活跃度猜测负责人。

## API

场馆负责人端（Bearer，所有 mutation 要求 `Idempotency-Key`）：

- `GET /api/v1/admin/venues/{venue_id}/staff`
- `POST /api/v1/admin/venues/{venue_id}/staff-invitations`
- `POST /api/v1/admin/venues/{venue_id}/staff-invitations/{invitation_id}/revoke`
- `PUT /api/v1/admin/venues/{venue_id}/staff/{membership_id}`
- `POST /api/v1/admin/venues/{venue_id}/staff/{membership_id}/remove`

员工邀请端（Bearer；secret 仅通过脱敏 header 传递，不进入 URL）：

- `GET /api/v1/venue-staff-invitations/current`
- `POST /api/v1/venue-staff-invitations/current/accept`

平台异常恢复（platform session + CSRF，仅 `PLATFORM_ADMIN`）：

- `POST /platform-admin/api/v1/venues/{venue_id}/owner-transfers`

列表不返回手机号、OpenID、UnionID 或 token；员工只显示主动设置的昵称/头像安全投影，缺失时使用“场馆员工”。负责人看不到员工订单、付款或其他场馆信息。

## 页面与状态

小程序新增：

- `pages/venue-staff/index`：员工、权限、待接受邀请；只有 owner 显示创建/编辑/移除；
- `pages/venue-staff-invitation/index`：场馆、邀请权限、有效期和接受动作；
- 创建邀请 sheet、权限编辑 sheet、移除二次确认；所有超时都回读服务端，不展示假成功。

工作台增加“员工与权限”入口。普通 staff 能看到自己的权限说明，但不能进入成员管理。负责人转移不做普通端按钮，页面明确提示“请联系平台处理”。

待接受邀请区只展示 `ACTIVE`；撤销必须二次确认，完成后从待接受区移除，并在同页审计摘要显示最近的邀请、权限和成员变更。

## 完成定义

- PostgreSQL 约束、并发接受/撤销、权限变更与负责人转移通过；
- 四个现有管理模块分别执行真实能力检查；
- 所有生产按钮接真实 API，Fixture 仅存在于开发构建；
- 独立 agent 审核 iOS/Android 员工列表、邀请落地和三个确认 sheet；
- 历史 owner 映射门未满足时生产能力保持关闭并给出明确运维诊断；
- 统一体验版交给用户真机验收前不合并 `main`。
