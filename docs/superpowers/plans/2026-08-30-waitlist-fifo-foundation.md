# C2b 候补 FIFO 基础实施计划

日期：2026-08-30

目标：从 C2a exact candidate `310180617d847d5d18da4496a81de5071b846ad6` 的隔离分支完成 C2b 可验证基础：先交付 development-only 原生候补旅程并完成 iOS/Android 自审，再实现封闭契约、`0019`、原子 FIFO 递补与 durable outbox。真实微信模板、订阅授权和物理多账号通知仍是生产完成门。

严格边界：不修改已部署 C2a staging/体验候选，不合并 `main`，不把本地 fake 称为通知成功，不实现手工改顺位、批量递补、重新申请、聊天、支付、到场或信用功能。存在有效候补时暂时禁止修改开放名额，避免另引入容量补偿流程。

## Task 1：冻结设计与隔离分支

- [x] 从 C2a candidate 建立 `feature/c2b-waitlist-foundation` worktree。
- [x] 冻结显式 `WAITLIST`、每球局单调 `waitlist_seq`、`WITHDRAW_WAITLIST`、原子单人递补、outbox 和 compatibility rollback 边界。
- [ ] 独立复核设计与计划；修正文档歧义后提交一次。

## Task 2：Artifact 与 development-only 原生预览

- [ ] 先写 Artifact/Fixture 聚焦 RED：`FULL_REVIEW`、`WAITLISTED_FIRST`、`PROMOTED`、退出确认、代表性阻塞态。
- [ ] 新增四个 dev-only 原生页面：场景入口、队长审核、我的报名、报名详情；所有按钮必须产生真实 Fixture transition。
- [ ] 复用现有颜色、字体、卡片、标题栏、确认层和 safe-area 底栏；候补使用暖色语义且同时显示文字/顺位。
- [ ] fresh development build；官方微信开发者工具 iPhone 12/13 Pro 与 Nexus 5X 真实点击和人工视觉自审。
- [ ] fresh production build/audit，证明 `C2B_WAITLIST_FIXTURE`、C2b routes 与 fake notification 均未进入生产包。

## Task 3：封闭契约与 compatibility 读基础

- [ ] TDD 扩展静态 OpenAPI、Pydantic DTO、examples、TS domain/decoder：`WAITLISTED`、`WAITLIST`、`WITHDRAW_WAITLIST`、本人 `waitlist_position/waitlisted_at/promoted_at`。
- [ ] 队长队列加入只读 FIFO 候补区和显式互斥 allowed actions；移除既有 `GAME_FULL` 申请 blocker，使满员时仍可创建普通 `APPLIED`，但绝不直接创建 `WAITLISTED`。

## Task 4：`0019` 数据约束与 outbox

- [ ] TDD 新增 `WAITLISTED`、`WAITLIST_WITHDRAWAL`、不可复用 `waitlist_seq`、候补时间字段、FIFO 索引和全生命周期约束。
- [ ] 新增窄域 `open_game_notification_outbox`，仅承载候补转正领域事实；唯一去重键、租约、重试和安全 payload 必须持久化。
- [ ] 覆盖 0018→0019、空数据 downgrade；任意候补序号/时间历史或 outbox 存在时拒绝 downgrade，不能只检查当前 `WAITLISTED`。
- [ ] 完成 `0019`、模型和严格只读兼容后再提交 compatibility SHA；它不暴露候补/退出候补写操作或自动递补。

## Task 5：队长候补决定与本人退出候补

- [ ] RED 后实现 `APPLIED → WAITLISTED`：Order→OpenGame→Registration 锁序、满员互斥动作、版本与幂等恢复。
- [ ] RED 后实现 `WAITLISTED → WITHDRAWN`：只匹配 `WITHDRAW_WAITLIST`，不释放容量、不递补、不可重报；`SUSPENDED` 且未开场仍允许退出候补。
- [ ] 队长候补只读列表按 `waitlist_seq`；本人可见顺位由当前有效队列重新投影。

## Task 6：JOINED 退出的原子 FIFO 递补

- [ ] RED 覆盖单退出单递补、无候补、暂停/取消/开场、同键重放、不同键竞争、两名同时退出和候补自退竞争。
- [ ] 在 C2a 退出事务内锁定 FIFO 首位，写 `WITHDRAWN + JOINED + outbox + idempotency` 一次提交；失败全部回滚。
- [ ] 存在有效候补时拒绝 B2 开放名额编辑；队列为空保持既有编辑行为。
- [ ] 明确当前无 `SUSPENDED → PUBLISHED` 恢复；未来增加恢复前必须先实现同锁序的按空位 FIFO fill hook。

## Task 7：worker 与本地 Provider

- [ ] RED 后实现 claim/lease/complete/retry；Provider IO 必须发生在领域事务提交后且不持有报名锁。
- [ ] 本地 fake 只记录调用供测试；生产组合缺少真实模板/Provider 时 fail closed，不得回退 fake。
- [ ] 重复 worker 不并发发送；租约过期、Provider 失败和取消 supersede 不改变报名状态。无 Provider 幂等能力时，明确测试并记录“已发送但未记账”崩溃窗口可能至少一次重复触达。

## Task 8：生产客户端集成与验证

- [ ] 视觉确认后把已批准状态接入真实 production pages/source/attempt store；删除重复 Fixture 逻辑前保持 production audit 隔离。
- [ ] 聚焦后端、契约、Node/Jest、typecheck、fresh builds、package audit 通过；变更文件 lint 通过。
- [ ] 独立 code review 无未解决 Important/Critical；冻结 exact candidate，但不部署/上传真实 C2b 候选。

## 外部完成门

- [ ] 微信订阅模板 ID、用户 `wx.requestSubscribeMessage` 授权与真实 Provider 已配置。
- [ ] staging 队长 + 退出者 + 至少两名候补的 FIFO/通知旅程通过。
- [ ] 物理 iOS/Android 多账号、通知到达和权威回读通过。
- [ ] C1/C2a 既有真机门通过后，才可删除 Fixtures、合并 `main`、双阶段部署并上传新的统一体验版。
