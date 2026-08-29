# C2a 报名撤回与退出开发预览设计

日期：2026-08-30

状态：`DELEGATED_APPROVED_FOR_PREVIEW`。用户已授权其休息期间由独立 agent 代做必要产品决策；本文件只批准 development-only 视觉预览，不批准生产契约、数据库或部署改动。

上游文档：

- [三类用户与开放球局产品设计](./2026-08-09-three-sided-football-product-design.md)
- [C1a 散客申请与队长审核生产设计](./2026-08-24-player-game-application-production-design.md)
- [C1c 我的报名生产设计](./2026-08-30-my-game-registrations-production-design.md)

## 1. 目标与边界

C2a 只验证一个最小申请人旅程：

```text
我的报名 → 球局详情 → 撤回待审核申请 / 退出已加入球局
→ 确认后返回列表并回读“已退出”终态 → 不允许再次申请
```

本阶段交付同尺寸 Artifact、隔离 Fixture 和 development-only 微信原生预览。生产构建继续排除全部 C2a 代码；不修改后端、OpenAPI、迁移、生产页面、staging 或 `0.1.10` 候选。

明确不做：候补与递补、队长移除、到场/爽约、举报、通知、信用分、自动封禁、扣款、支付或订单取消联动。

## 2. 规则冻结

- `APPLIED` 在开场前可“撤回申请”；不占名额，成功后剩余名额不变。
- `JOINED` 在开场前可“退出球局”；成功后释放一个公开名额。
- 距开场至少 6 小时退出，不记录临时退出。
- 距开场不足 6 小时退出，记录“临时退出”；首期不自动封禁或扣款。
- 已开场或 `REJECTED | WITHDRAWN | REMOVED | CANCELLED` 不提供退出动作。
- 一条报名进入 `WITHDRAWN` 后不可再次申请同一球局；预览和未来生产都不能出现重新申请按钮。
- 确认动作必须幂等；重复确认不得重复释放名额。

候补尚未实现，因此本切片只释放名额，不伪造自动递补。未来候补切片再把同一释放事务与 FIFO 转正连接。

## 3. 页面方案

采用“共享详情页底部动作 + 确认层”，不在列表卡片内放退出按钮：

- 列表卡片仍只有进入详情一个点击目标；
- 详情先展示真实场地、人数/费用/截止、报名状态和规则；
- 可操作时底部显示单一动作：`撤回申请` 或 `退出球局`；
- 点击后打开底部确认层，`保留报名` 关闭且不改状态，确认按钮执行真实 Fixture transition；
- 成功后详情原位回读 `已退出`，按钮消失，并说明“本场不可再次申请”；返回独立 C2a 列表时，同一条报名显示 `已退出`，并恢复退出前的列表滚动位置。

预览使用一张独立、只服务于 C2a 的薄列表，不修改已完成视觉确认的 C1c Fixture。这样既验证写操作后的跨页回读，也不把 C1c 的只读旅程扩成可变流程。

场景启动器提供待审核、已加入且提前退出、已加入且临时退出、已退出终态，以及一个内部“退出结果待确认”入口。它明确标注“C2a 开发预览 · 模拟数据”，不冒充生产用户可以选择业务状态。

模拟 operation 状态为 `IDLE | CONFIRMING | SUBMITTING | RESULT_UNKNOWN | ERROR`。失败时保留原权威报名状态；结果未知时只允许“确认退出结果”，禁止再次提交退出。预览中的结果确认收敛到 `WITHDRAWN`，用来约束未来生产实现不得把超时当作成功或重复发起写操作。

## 4. 文案与视觉

沿用当前小程序设计系统：背景 `#F8FAFC`、表面 `#FFFFFF`、主文字 `#10243E`、次文字 `#526479`、边框 `#DBE5EC`、交互蓝 `#0369A1`、成功绿 `#047857`。退出确认使用克制的危险红 `#B42318` 与浅红背景，不使用大面积高饱和警示。

确认文案：

| 状态 | 标题 | 说明 | 确认按钮 |
| --- | --- | --- | --- |
| `APPLIED` | 确认撤回申请？ | 撤回后本次不可再次申请，已开放名额不变。 | 确认撤回 |
| `JOINED`，至少 6 小时 | 确认退出球局？ | 确认后会释放 1 个公开名额，本次不可再次申请。 | 确认退出 |
| `JOINED`，不足 6 小时 | 确认退出球局？ | 确认后会释放 1 个公开名额，本次不可再次申请；另示“会记录临时退出，首期不自动封禁或扣款”。 | 确认退出 |

所有按钮至少 88rpx，文字显式 flex 双轴居中；标题栏避让微信胶囊；详情使用 `100vh` flex shell 和可滚动内容，固定动作栏预留 safe area，不遮挡末尾规则。

## 5. Fixture 与隔离

唯一 marker：`C2A_REGISTRATION_WITHDRAWAL_FIXTURE`。

Fixture 只保存：当前场景、报名状态、剩余名额、开场时间、权威参考时间、确认层开关、是否记录临时退出。所有读取返回不可变快照。

页面只位于：

- `miniprogram/dev/c2a-registration-withdrawal-fixture.ts`
- `miniprogram/dev/pages/c2a-withdrawal-scenario/**`
- `miniprogram/dev/pages/c2a-my-registrations/**`
- `miniprogram/dev/pages/c2a-registration-detail/**`

development build 自动发现三页；production build、`miniprogram/app.json`、production composition 和生产审计不得包含 marker、路由或合成文案。

## 6. 代表视觉门

按比例只冻结一个 `joined-late-confirm` 代表帧，目标 viewport `375 × 812`。它同时覆盖详情层级、固定底栏、危险动作、确认层、6 小时规则和安全区。

人工自审检查：

- 按钮文字水平/垂直居中；
- 状态徽标、指标列和卡片边界对齐；
- 返回箭头、chevron/关闭图标完整；
- 滚动内容未被固定底栏或确认层遮挡；
- “记录临时退出，但不封禁/扣款”与“不可再次申请”语义准确；
- Android/iOS 代表设备没有裁切或安全区问题。

用户确认前 gate 保持 `PENDING`，不得进入生产契约和后端阶段。

## 7. 聚焦验收

- 五场景投影正确；
- `保留报名` 不改状态；确认动作原子进入 `WITHDRAWN`；
- APPLIED 不改名额，JOINED 只释放一次；
- 6 小时边界严格以 `starts_at - now < 6h` 判定临时退出；
- `RESULT_UNKNOWN` 只能确认结果，不能二次发起退出；
- 成功返回列表后同一报名显示 `WITHDRAWN`，并保留滚动位置；
- 已开场/终态无 CTA，WITHDRAWN 无重新申请；
- 每个可见按钮有真实 handler；
- fresh development build 包含三页，fresh production build/audit 排除 C2a；
- 代表性微信原生视觉自审通过，用户视觉门仍待确认。

## 8. 未来生产门

只有在用户确认本预览后，才另行冻结：持久状态/审计字段、幂等 endpoint、锁顺序、容量释放并发、未知结果恢复、与球局取消及未来候补的边界。生产端到端通过前不删除 Fixture、不合并 `main`、不称 C2a 完成。
