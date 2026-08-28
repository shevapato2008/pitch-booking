# C1c-1“我的报名”开发预览设计

日期：2026-08-29

状态：`DELEGATED_APPROVED_FOR_PREVIEW`。用户已授权其休息期间由独立 agent 代做产品决策；方案 A 于 2026-08-29 获得批准。生产契约与后端实现仍受 B2/C1a/C1b 联合真机验收门约束。

上游文档：

- [三类用户平台整体切片路线图](../plans/2026-08-16-overall-slice-roadmap.md)
- [三类用户与开放球局产品设计](./2026-08-09-three-sided-football-product-design.md)
- [C1a 散客申请与队长审核生产集成设计](./2026-08-24-player-game-application-production-design.md)
- [C1b 公开球局发现生产设计](./2026-08-26-public-game-discovery-production-design.md)

## 1. 目标与完成边界

C1c-1 只补齐申请人的稳定找回旅程：

```text
找球局
→ 我的报名
→ 查看自己最近的报名及权威状态
→ 点击卡片进入与该报名对应的球局详情
→ 返回后保留列表位置
```

本阶段只交付 reference Artifact、隔离 Fixture 和 development-only 微信原生预览。它不修改当前 `0.1.10` 候选、不进入 production build、不写数据库，也不启用新的生产 API。

明确不做：候补、退出、重新申请、订阅消息、到场/爽约、举报、平台纠错、聊天、评分、线上 AA 或全局“我的”信息架构。

## 2. 方案选择

采用方案 A：独立“我的报名”列表页，并从找球局可滚动内容顶部进入。

- 独立页让匿名公开目录与登录个人历史各自拥有清晰的加载、认证、空态和错误状态；
- 入口位于 C1b 内容区、筛选区之前，触控区至少 44pt，不进入自定义标题栏右侧，避免与微信胶囊冲突；
- 卡片只承担进入详情的一个动作，不放嵌套按钮；
- 页面复用 C1b 的 header/back 几何、`my-orders` 的列表/分页语言和现有蓝绿 token。

不采用：

- 在 C1b 同页切换“公开 / 我的”，因为会耦合匿名目录和登录历史两套状态，并容易丢失筛选与滚动位置；
- 在三目的首页增加第四个入口，因为“我的报名”不是新的当下目的；
- 现在先做通知或候补，因为通知需要外部模板/outbox，候补又缺少成员退出后的自然释放旅程。

## 3. 分支与隔离

预览分支从当前联合候选的冻结提交创建：

- base：`113d603d34e5d4f49956aeea333a6f4b3356d7b6`；
- worktree：`.worktrees/c1c-my-registrations-preview`；
- branch：`feature/c1c-my-registrations-preview`。

所有预览实现仅位于 C1c 专属 Artifact、`miniprogram/dev/**`、聚焦测试和本设计/计划。不得修改：

- 当前 C1b production 页面、后端、OpenAPI、迁移或部署；
- C1a/C1b Fixture 的既有状态和完成门；
- `miniprogram/app.json` 或 production composition；
- B2/C1a/C1b 验收记录与当前精确候选 SHA。

development build 自动发现 dev page 四件套；production build 必须完全排除 C1c marker、合成数据与路由。

## 4. 页面与交互

### 4.1 场景入口

development-only 场景页明确标注“C1c 开发预览 · 模拟数据”，提供：

- 找球局入口位置；
- 报名列表 ready；
- 空列表；
- 首次加载失败。

这些按钮只切换同一隔离 Fixture 并导航，不冒充生产用户可以注入异常状态。

### 4.2 找球局入口预览

入口预览沿用 C1b 标题、城市说明、日期和筛选控件的已批准结构，只增加一行 88rpx 的“我的报名”入口，放在城市说明之后、筛选区之前。入口使用白色表面、现有边框和蓝色文案，文字与箭头显式双轴居中；点击进入 C1c 列表。

它只验证入口几何与返回后状态保留，不复制或改变 C1b 的生产查询逻辑。

### 4.3 我的报名列表

页面标题为“我的报名”。内容顺序：

1. 弱说明“状态以服务端为准”；
2. 显式刷新动作；
3. 单列报名卡片；
4. 首次加载、空列表、首次失败、刷新失败和续页失败状态；
5. 有下一页时的真实“加载更多”。

每张卡片只显示：报名状态、球局名称、日期/时间、场馆、物理场地和人制。它不显示申请称呼、备注、决定人、其他申请人、联系方式、订单、支付或成员名单。整卡点击进入该项 `detailPath`；返回列表后不重置已有列表与滚动位置。

状态文案冻结为：

| 有效状态 | 文案 | 色彩语义 |
| --- | --- | --- |
| `APPLIED` | 待队长审核 | 交互蓝 |
| `JOINED` | 已加入 | 可用绿 |
| `REJECTED` | 未通过 | 中性灰 |
| `CANCELLED` | 球局已取消 | 中性灰 |

预览详情从同一 Fixture 按 registration ID 精确读取。未知 ID 显示“不存在或已失效”，不得回退第一条。生产接入时，服务端将返回既有真实分享详情路径；预览不把 development 路径写成未来契约。

### 4.4 返回与登录边界

- 入口使用 `navigateTo`，返回后保留 C1b 筛选/滚动状态；
- 列表或详情有历史时使用 `navigateBack`；独立深链没有历史时回找球局；
- production 设计中，401 必须在原页提供真实微信登录 CTA，登录成功后原页重载；
- 账号变化或会话失效时先清空旧用户列表，再发起新读取，禁止跨账号残留；
- 本 development preview 不模拟真实微信身份，只以明确文案展示该生产边界。

## 5. Fixture 与未来只读契约

Fixture 唯一 marker 为 `C1C_MY_GAME_REGISTRATIONS_FIXTURE`。单一 store 保存四条合成报名、加载状态、分页和选中项；返回不可变快照。

四条数据覆盖：

- `APPLIED / JOINED / REJECTED / CANCELLED`；
- `PUBLIC / LINK_ONLY`；
- 未来与历史球局；
- 两页稳定分页。

默认按 `(appliedAt DESC, registrationId DESC)` 排序；Fixture 使用稳定游标模拟 `limit + 1` 分页，页面按 registration ID 去重。首次失败替换首屏内容；刷新或续页失败保留已显示卡片。重试/刷新只重读，不创建或修改报名。

未来生产 API 采用 self-only 语义：

```text
GET /api/v1/me/game-registrations?limit=20&cursor=<opaque>
```

- 只允许 `applicant_user_id == authenticated user.id`，队长不能读取他人；
- 200 空 `items`，不是 404；
- 封闭返回 `items + next_cursor`，默认 limit 20、范围 1–50；
- cursor 是包含 `(applied_at, id)` 的版本化不透明值，严格字典序 `<`；
- 非法 cursor/limit 为 422；
- 列表包含 PUBLIC、LINK_ONLY、未来和历史报名，不能复用 C1b 公开目录查询；
- 有效状态复用 C1a 服务端取消投影，不新增持久 `CANCELLED`；
- 权威订单/球局/场地关系缺失或不一致时整页 503，不静默漏项。

每项未来最小字段为 `registration_id, game_name, starts_at, ends_at, time_zone, venue_name, pitch_name, pitch_specification, effective_status, detail_path`。`detail_path` 必须是严格编码的既有真实分享详情路径。

## 6. 视觉规则

沿用现有 design tokens，不采用 UI Pro Max 检索得到的新字体或新配色：

- 背景 `#F8FAFC`、表面 `#FFFFFF`、主文字 `#10243E`；
- 次文字 `#526479/#64748B`、边框 `#DBE5EC`；
- 交互蓝 `#0369A1/#0284C7`、成功绿 `#047857`；
- 系统字体、单列卡片、轻边框、无渐变、无重阴影、无 emoji。

所有按钮至少 88rpx，显式 flex 双轴居中并有 pressed feedback。header 避让胶囊；完整 CSS 返回箭头与 chevron 不裁切。页面采用 `height: 100vh` 的 flex shell，纵向 `scroll-view` 使用 `flex: 1; height: 0; min-height: 0`，底部内容预留 safe area，不设置固定 CTA。

## 7. 代表视觉门

视觉证据按比例只冻结一个 `ready-list` 代表状态：

- reference `375×812`；
- 微信原生 implementation `375×812`；
- 同尺寸 side-by-side、50% overlay 与 difference；
- 一次找球局入口和一张详情的人工运行时检查。

空态、首次错误、刷新失败、续页失败和四种状态由聚焦自动化覆盖，并在场景页各点一次，不重复拍全矩阵。人工审核必须检查标题与返回、入口位置、卡片状态列线、箭头完整、按钮双轴居中、滚动、底部安全区、关键文案和隐私字段。

用户明早确认前只能标记“实现自审通过 / 用户视觉门待确认”，不得进入 C1c 生产实现。

## 8. 聚焦验收

自动化只覆盖本次最可能的回归点：

- 四种有效状态、PUBLIC + LINK_ONLY、未来与历史排序；
- 两页无重漏、刷新和续页失败保留数据、空态与首次重试；
- 未知详情不回退第一条；
- 每个可见按钮有真实 handler，入口和卡片导航路径正确；
- 88rpx 触控、双轴居中、header/scroll/safe-area 规则存在；
- reference / native 实现同为 375×812；
- fresh development build 包含 C1c 页面；fresh production build 与 audit 不含 marker、合成数据或 dev routes；
- 既有 C1a/C1b 聚焦测试与 TypeScript 继续通过。

近期 C1b 曾出现 Android `Intl` 兼容问题，因此未来生产验收额外保留一次 Android 登录/列表/详情 smoke；预览阶段不扩张为全状态多设备测试。

## 9. 生产接入门与删除条件

C1c production 设计与实现开始前必须：

1. 使用当前精确 C1 候选完成 B2/C1a/C1b 联合真机验收；
2. 退役 B2/C1a/C1b development Fixtures；
3. 合并并推送 final `main`，部署与体验版 truth checks 通过；
4. 用户确认本预览的入口和列表视觉；
5. 基于 final `main` 另行冻结 self-only API、后端查询和 production composition。

生产真机通过后删除 C1c scenario、Fixture、入口预览、列表预览、临时详情和 dev route inventory；保留 Artifact、视觉证据、设计/计划及真实 production 页面。
