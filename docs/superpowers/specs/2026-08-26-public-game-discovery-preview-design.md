# C1b 公开球局发现开发预览设计

日期：2026-08-26

状态：独立产品、视觉和隔离裁决已批准 development-only Artifact 与原生 Fixture；等待用户视觉确认后再设计生产契约

上游文档：

- [三类用户与开放球局产品设计](./2026-08-09-three-sided-football-product-design.md)
- [三类用户与开放球局关键决策](./2026-08-09-three-sided-football-decisions.md)
- 当前基线 `main@3de95bc299aa689d0f7505c7f62cded1f852e0f2`

## 1. 目标与边界

C1b 只预览一条公开发现旅程：

```text
C1b 开发预览入口
→ 浏览公开球局
→ 使用日期、人制和有名额筛选
→ 点击卡片
→ 查看该卡片对应的 C1b 只读详情
→ 返回列表并保留筛选
```

列表浏览不要求登录。今晚只交付 development-only 的参考 Artifact、合成 Fixture 和原生小程序预览，不提交申请、不改变球局或报名状态，也不启用生产“我要找球踢”入口。

## 2. 方案选择

采用“单列公开列表 + C1b 自有只读详情”。

当前 C1a 候选仍待 Task 18 三账号真机验收，C1b 必须从 `main` 独立分叉，不能依赖 C1a 分支、Fixture 或页面。临时只读详情保证每张卡片都能诚实进入与自身一致的信息，同时不伪造尚未接入的申请能力。

不采用：

- 从 C1a 候选分叉或导入 C1a Fixture；
- 卡片统一进入一个与卡片数据无关的固定详情；
- 在临时详情中放置没有真实后端支撑的“申请加入”按钮；
- 同时建设候补、我的报名、通知或生产入口。

## 3. 分支与隔离边界

从 `main@3de95bc299aa689d0f7505c7f62cded1f852e0f2` 创建：

- worktree：`.worktrees/c1b-game-discovery-preview`
- branch：`feature/c1b-game-discovery-preview`

本切片只允许新增 C1b 专属设计、计划、Artifact、development Fixture、页面、路由清单、聚焦测试和视觉评审资料。`git diff --name-status main...HEAD` 必须全部为 `A`。

明确禁止修改：

- `miniprogram/app.json`、`miniprogram/dev/app-pages.json`、`miniprogram/dev/bootstrap.ts`；
- 中央构建、审计脚本及其既有测试；
- `miniprogram/pages/**`、`miniprogram/domain/**`、`miniprogram/services/**`；
- `backend/**`、`contracts/**`、迁移和 `deploy/**`；
- 任何 C1a/B2 文件、验收资料或 Task 18 临时记录。

现有 development 构建会自动发现 `miniprogram/dev/pages/**` 下具备四件套的页面；production 构建整体排除 `miniprogram/dev`，因此不需要修改中央 manifest。

## 4. 页面

### 4.1 场景入口

development-only 场景页明确显示“C1b 开发预览 / 以下为模拟球局”，可进入代表状态。它只重置同一 Fixture 并导航，不模仿生产入口，也不代表生产用户可以切换异常场景。

### 4.2 公开球局列表

页面结构：

1. 标准自定义导航，标题“找球局”严格居中；
2. 弱提示“C1b 开发预览 · 模拟数据”；
3. “天津 · 仅展示真实订场已确认的公开球局”；
4. 横向日期条；
5. 人制 picker chip 与“仅看有名额”toggle chip；
6. “按开场时间排序 · X 场”摘要；
7. 单列球局卡片；
8. 加载、空状态或错误恢复内容。

整张卡片是唯一点击目标，不在卡内增加申请或其他嵌套按钮。

### 4.3 C1b 自有只读详情

详情从 query 读取 `gameId`，再从同一 C1b catalog 精确查找；未知 ID 不得回退展示第一条。

详情显示：

- 真实订场确认语义；
- 球局名称、日期、时间、场馆和物理场地；
- 人制、对抗强度和所需位置；
- 当前人数与剩余名额；
- 预计 AA 和“到场线下结算”；
- 球队组织者、报名截止及到场说明。

页面底部只显示普通说明：“C1b 开发预览仅验证发现与只读详情，不提供申请操作。”该说明不是按钮；页面不得出现“申请加入”、登录、候补、刷新申请结果或审核动作。

未知 `gameId` 显示真实“不存在或已失效”状态和“返回球局列表”按钮。

## 5. Fixture 权威状态

唯一标记为 `C1B_GAME_DISCOVERY_FIXTURE`。单一 store 保存：

- 三条合成的 `PUBLIC + PUBLISHED` 球局；
- 日期、人制和“仅看有名额”筛选；
- `LOADING | READY | LOAD_ERROR`；
- source-empty 与 filter-no-match；
- `selectedGameId`。

三条数据覆盖五人制和七人制、三个不同日期、两场有名额与一场已满，并具有可区分的名称、时间、物理场地、人数和金额。目录资格必须同时满足：

```text
visibility == PUBLIC
AND effectiveState == PUBLISHED
AND startsAt > authoritativeNow
AND registrationDeadline > authoritativeNow
```

时间比较均为严格大于；`PUBLISHED` 在未来生产实现中必须来自服务端“订场已确认”的权威投影，客户端不得自行推断。`LINK_ONLY | DRAFT | SUSPENDED | CANCELLED | COMPLETED`、已开场或已过报名截止的球局都不进入目录。满员球局仍进入默认目录并可查看详情，“仅看有名额”才额外要求 `remainingSpots > 0`。最终按 `startsAt, id` 稳定升序。Fixture 使用固定的上海时区参考时钟，避免日期随运行时间漂移。

Store 返回不可变快照。重试只恢复读取，不创建球局；选择详情只能接受 catalog 中存在的 ID。这些字段只是 presentation model，不冻结未来 API。

## 6. 筛选规则

- 日期：`全部`以及 catalog 中实际存在的上海自然日；
- 人制：`全部 / 五人制 / 七人制`；
- 仅看有名额：默认关闭，开启后要求 `remainingSpots > 0`；
- 三项使用 AND 组合；
- 切换筛选立即重新投影列表；
- 默认始终按开场时间升序，不提供排序选项；
- 必须区分“没有任何公开球局”和“当前筛选无匹配结果”。

本预览不增加地图、区域、POI、关键词搜索、推荐或分页。

## 7. 卡片信息层级与隐私

卡片依次显示：

1. 左侧“真实订场已确认”，右侧“剩 N 个名额”或“已满”；
2. 球局名称；
3. 日期和起止时间；
4. 场馆、物理场地；
5. 人制、对抗强度、所需位置；
6. 当前/计划人数、预计 AA/线下结算、报名截止三组指标；
7. 球队名称与“组织”；
8. 进入详情的完整 CSS chevron。

卡片和详情不得显示订单号、手机号、微信号、用户 ID、成员名单、报名记录、头像或支付字段。

## 8. 代表状态

视觉证据严格限定为四个状态：

1. `ready-list`：默认筛选与三张按时间排序的卡片；
2. `filtered-nonempty`：日期、人制和仅看有名额组合后仍有结果；
3. `filter-no-match`：有效筛选组合没有结果，显示真实“清除筛选”；
4. `load-error`：首次加载失败，显示真实“重新加载”。

`LOADING` 仍实现两个等高 skeleton，并保持 header 和筛选区稳定，但只做聚焦行为测试和一次人工检查，不增加第五组视觉证据。自然 source-empty 复用空状态组件，由测试覆盖。

临时 `selected-detail` 不进入正式对比矩阵，但必须在 375×812 微信真实运行时人工检查一次，并由自动化逐卡证明字段映射、未知 ID、返回后筛选保留和无申请/隐私字段。它是为了与未验收 C1a 隔离而存在的临时页，增加第五套完整证据与其生命周期不相称。

## 9. 所有可见控件的真实行为

| 控件 | Fixture 行为 |
| --- | --- |
| 场景入口按钮 | 重置同一 Fixture 到指定状态并进入列表或详情 |
| 列表返回 | 返回真实上一页；无历史时返回开发预览入口 |
| 日期项 | 更新日期筛选并重新计算列表 |
| 人制 chip | 打开原生 picker；确认后更新人制筛选 |
| 仅看有名额 | 切换布尔筛选并重新计算列表 |
| 球局卡片 | 先选择该卡 ID，再导航到带同一编码 ID 的 C1b 详情 |
| 清除筛选 | 恢复全部日期、全部人制并关闭仅看有名额 |
| 重新加载 | 清除注入的加载失败并重新读取 catalog |
| 详情返回 | 返回列表并保留筛选条件 |
| 未知详情返回列表 | 导航回列表，不创建或替换资源 |
| 自然空态返回选择目的 | 进入现有真实目的选择页 |

任何成功状态都不能只由 Toast 表达。所有可见交互必须有真实 `bindtap` 或 picker 行为、至少 88rpx 触控区和明确 pressed feedback；非交互的徽标、摘要和开发提示不得伪装成按钮。

## 10. 视觉规则

继续使用现有设计系统：背景 `#F8FAFC`、表面 `#FFFFFF`、主文字 `#10243E`、次文字 `#64748B/#526479`、边框 `#DBE5EC`、交互蓝 `#0284C7`、订场确认和可用名额绿 `#047857`。不采用橙色主题、渐变、重阴影、营销 hero、emoji 或底部三入口导航。

具体约束：

- header 使用 `readIntentHeaderLayout()`，左右各 88rpx，标题避让微信胶囊并严格居中；返回箭头用完整 CSS glyph，业务提示不进入导航行；
- 日期项和筛选 chip 高度至少 88rpx，相邻触控区间距至少 16rpx；
- 卡片白底、1rpx 边框、28rpx 圆角、24rpx 内边距、20rpx 卡间距；
- 整卡按压只改变透明度或背景，不移动边界；
- shell 为 `height: 100vh; overflow: hidden`，纵向 `scroll-view` 使用 `flex: 1; height: 0; min-height: 0`；
- 列表底部预留 `32rpx + env(safe-area-inset-bottom)`，不设置固定底部 CTA；
- 按钮文字和图标显式 flex 双轴居中，同组重复控件尺寸与列线一致。

## 11. 375×812 视觉门

明早在微信真实运行时对四个代表状态各生成参考图、原生截图、并排图、50% 叠加图和差异图。一轮人工审核至少确认：

- header 标题居中，返回按钮自然且不与胶囊冲突；
- 日期条和两个筛选控件不裁切、不误触；
- 首屏能看到约 1.7–2 张卡片，重复徽标、指标和 chevron 对齐；
- 可申请与已满不会混淆；
- 清除筛选和重新加载真实恢复页面；
- 每张卡片进入与自身一致的详情；
- 列表可完整滚动，末张卡片不被安全区遮挡；
- 详情没有申请按钮、隐私字段或虚假承诺。

发现明显问题时只做最小修复并重新检查受影响状态，不扩张成全状态重复评审。用户确认前只标记“实现自审通过 / 用户视觉门待确认”，不进入生产阶段。

## 12. 自动化与隔离验收

聚焦测试必须证明：

- catalog 只公开 `PUBLIC + PUBLISHED`，排序和三个筛选正确；
- 已开场、已过报名截止及 `LINK_ONLY | DRAFT | SUSPENDED | CANCELLED | COMPLETED` 均被排除；
- source-empty、filter-no-match、error → retry 正确；
- 每个卡片 ID 精确映射自己的详情，未知 ID 不回退第一条；
- store 快照不可变；
- 每个可见按钮均绑定真实行为；
- 88rpx 触控、滚动区和安全区规则存在；
- 页面源码不含申请操作；
- slice-local inventory 只包含三个 C1b dev 页面；
- fresh development build 包含三个页面；
- fresh production build、production manifest 和 production 源码不含 `C1B_GAME_DISCOVERY_FIXTURE`、`dev/pages/c1b-` 或 C1b 合成数据；
- 现有 production package audit 通过；
- `main...HEAD` 只存在批准路径下的新增文件。

## 13. 删除与生产接入条件

视觉确认后仍不得把 C1b Fixture 当作生产实现。生产接入必须等待：

1. C1a Task 18 真机验收通过；
2. C1a/B2 Fixture 按 Task 19 清理；
3. C1a Task 20 合并并形成新的 final `main`；
4. C1b 分支同步该 final `main`；
5. 公开目录契约、后端查询和生产页面另行评审并实现；
6. 生产列表卡直接进入服务端给出的真实 C1a 公开详情目标；
7. “我要找球踢”入口、列表、详情与申请形成真实链路并通过设备验收。

届时删除 C1b scenario、Fixture/store、development 列表页、临时只读详情页和 slice-local route inventory；保留批准后的 Artifact、视觉证据、设计/计划及后续真实生产列表实现。

在以上条件全部满足前，production“我要找球踢”继续保持“即将开放”。

## 14. 明确不做

- 散客申请或队长审核的新实现；
- 候补、FIFO 转正、我的报名或订阅消息；
- 退出、移除、到场、举报或信用体系；
- 地图、区域、POI、搜索、推荐、多场馆筛选、复杂排序或分页；
- 三入口底栏重构；
- 后端、OpenAPI、迁移、生产路由、部署或体验版上传；
- 任何依赖未验收 C1a 候选的代码。
