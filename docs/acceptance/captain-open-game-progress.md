# 队长开放球局验收进度

更新时间：2026-08-24（Asia/Shanghai）

状态：`STAGING_DEPLOYED / EXPERIENCE_0.1.5_UPLOADED / IPHONE_PENDING`

本文件保留 2026-08-24 的历史验收记录，不代表当前部署或体验版状态；后续进展见 [夜场追光改造进度](../night-glow-progress.md)。

## 当前范围

- B2 队长侧三条生产页面路由已进入 development 与 production 构建清单。
- development Fixture 模式通过仅位于 `miniprogram/dev` 的 adapter 支撑生产页面代码；该 adapter 不是 HTTP 或 staging 证据。
- Fixture 视觉入口为 `/pages/captain-game-form/index?order_id=00000000-0000-4000-8000-000000000204`；订单时间保持 `8月23日 周日 14:00–16:00` 的批准视觉形状，并使用稳定未来年份保证 production form 可保存。
- development HTTP 与 production 组合使用真实 HTTP `OpenGameSource` 和持久化 mutation attempt store。
- production audit 保持既有 deny/composition 规则，并拒绝队长 Fixture 路径和样例业务字面量。
- C1 公开列表、散客申请/审核/候补仍未实现，“我要找球踢”继续关闭。
- B2 owner management 不依赖在线支付开关；关闭支付不代表 B2 被关闭，也不证明支付、退款或库存行为。
- Task 9 只证明本地真实 Uvicorn HTTP/PostgreSQL 后端旅程及 Mini Program unit/composition 自动化，不是完整的 Mini Program HTTP 旅程，也不代表 shared staging、production 或真机完成。

## 待完成门禁

- [x] Task 8 聚焦 Node composition/build/audit 自动化：148/148 passed
- [x] development adapter Jest 自动化：5/5 passed
- [x] TypeScript typecheck：PASS
- [x] `PRODUCTION_PAGE_FIXTURE_ADAPTER_VISUAL_PASS`：root 已在 WeChat DevTools iPhone X `375×812` 完成人工视觉自审
- [x] production live disabled-payment build/audit：使用已忽略的 live input 构建，17 条生产路由、`ONLINE_BOOKING_ENABLED=false`、真实 staging API、真实 HTTP open-game source 与持久化 attempt store 均已确认；audit 0 forbidden paths/tokens
- [x] 真实本地 HTTP/PostgreSQL 旅程（Task 9）：单旅程 1/1、后端聚焦集 194/194 passed
- [x] shared staging 部署：candidate `3de95bc299aa689d0f7505c7f62cded1f852e0f2`，Alembic `0015`
- [x] 隔离体验版上传：`0.1.5`，支付与在线预订关闭
- [ ] 真实 iPhone 完整旅程、B1 基线复核与 B2 精确清理

## Task 9 本地自动化证据

- 精确 runtime candidate/base：`c5a0ca553d7acca90fed43bb15b902657cc13f11`。没有用自引用的后续提交 SHA 替代这一本轮被测基线。
- RED 先由缺失本地监听器稳定产生 `httpx.ConnectError: [Errno 61] Connection refused`；补充仅位于测试内、动态端口且有界启停的 Uvicorn harness 后，同一命令 1/1 passed。后端指定聚焦集随后 194/194 passed；唯一提示为既有 FastAPI TestClient 依赖弃用 warning。
- 旅程使用 PostgreSQL 17 的唯一 disposable database 和真实 loopback HTTP socket；owner 与 non-owner 均经 development WeChat session HTTP 端点取得 bearer token，再覆盖 entry、DRAFT create/replay、owner/non-owner read、edit/replay、preview、publish/replay、公开 token read、cancel/replay、取消后公开 read、重新 CREATE 与第二个 DRAFT。
- published 与 post-cancel 两次公开读取均匹配 `PUBLIC_OPEN_GAME_FIELDS`，并递归拒绝 order/contact/payment/refund 等私有键及该订单、联系人和支付基线的敏感值；non-owner 两个私有读取均为 404。
- 数据基线是内部一致的 synthetic applied-success Payment + CONFIRMED Order/BOOKED Slot，没有调用 Provider，也不能称为真实支付订单。旅程前后 Order、Slot、唯一 Payment 的全字段 mapping 完全相同；Payment 保持恰好 1 条，RefundCase/RefundAttempt 始终为 0。cancel 后仅 B2 open-game domain authority 变化，B1 domain rows 未变；取消幂等记录允许按设计新增。
- Mini Program 结果仅为指定的 unit/composition 自动化：8 suites、206/206 tests passed；这不是 Mini Program 到本地后端的完整 HTTP 旅程。契约校验 101 examples passed，TypeScript typecheck PASS。
- 截至 Task 9，剩余门禁仍是 shared staging 与真实 iPhone/device 验收；当时未 deploy、未上传小程序、未开始 Task 10，也未删除现有 Fixture。下节记录后续 Task 10 进展。

## Task 10 shared staging 与体验版上传证据

- staging 当前 revision 与 source candidate 均为 `3de95bc299aa689d0f7505c7f62cded1f852e0f2`；上传前再次核对远端 current symlink 无漂移。
- 使用 Git 忽略、权限 `0600` 的 live input，强制 `MINIPROGRAM_PAYMENT_PROVIDER=disabled` 构建；生成结果为 `ONLINE_BOOKING_ENABLED=false`、17 条生产路由、真实 HTTP open-game source 与持久化 attempt store。production audit 为 0 forbidden paths/tokens。
- 只从已审计 production package 生成并导入 `dist/miniprogram-live-preview`；隔离工程与已审计包逐文件一致，package SHA-256 为 `9c4a22593d7e641431e45313124d641fc3525f4e5064c59a917780e2be56d44a`。
- 用户在上传前另行明确确认。微信开发者工具于 2026-08-24 01:45（Asia/Shanghai）返回“代码上传成功”；版本号 `0.1.5`，项目备注 `Task10队长约球真机验收；支付关闭；3de95bc`。上传前工具明确提示本次提交会覆盖既有体验版，因此本次成功上传已将 `0.1.5` 设为当前体验版。
- 本次没有提交正式审核、没有公开发布，也没有向非授权体验成员暴露二维码。真实 iPhone 旅程尚未执行，不能据此宣称 Task 10 或 B2 切片完成；现有 Fixture 继续保留。

## 代表性运行时视觉自审

- 环境：WeChat DevTools `36.6.0`，iPhone X `375×812`，portrait，基础库 `3.17.0`。
- 页面：三张生产页面中的创建表单代码，由 development-only adapter 提供数据；没有据此宣称 HTTP、staging 或真机通过。
- 顶部：自审发现并修复了状态栏安全区未生效的问题；修复后三张生产球局页复用既有 `readIntentHeaderLayout`，代表页实测 header `88px`、top inset `44px`，返回箭头、标题和右侧胶囊区完整且互不遮挡。
- 表单：真实场地、输入标签与关键文案正确；普通文字字段使用文本输入，AA 字段使用 `digit`；三组步进按钮等宽等高、沿列对齐，按钮文字在双轴居中。
- 交互：运行时事件验证 `ANY → 后卫 → ANY` 始终互斥；日期与时间 picker 分别更新为 `2099-08-22`、`11:30` 并可恢复为 `2099-08-23`、`12:00`。当前表单没有自定义 modal，因此 modal X 检查为 N/A。
- 底部：固定操作栏实测从 `710px` 到 `812px`，按钮和 Home Indicator 之间留有安全区；上下半页未见边界裁切、横向溢出或关键内容缺失。
- 截图仅用于本机临时人工复核，未加入仓库，也未扩张为全状态重拍。

production live disabled-payment build/audit 已于 2026-08-23 使用本机受限权限、Git 忽略的输入完成；构建与验证过程未打印或记录任何 secret。Task 9 已补齐真实本地 HTTP/PostgreSQL 后端证据，但不把既有 production package audit 升格为 shared staging 或真机通过。现有 Fixture 仅在 Task 10 真机 PASS 后按计划删除。
