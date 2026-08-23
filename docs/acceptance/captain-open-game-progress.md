# 队长开放球局验收进度

更新时间：2026-08-23（Asia/Shanghai）

状态：`TASK_8_COMPOSITION_AUTOMATION_PASS / PRODUCTION_PAGE_FIXTURE_ADAPTER_VISUAL_PASS / HTTP_PENDING`

## 当前范围

- B2 队长侧三条生产页面路由已进入 development 与 production 构建清单。
- development Fixture 模式通过仅位于 `miniprogram/dev` 的 adapter 支撑生产页面代码；该 adapter 不是 HTTP 或 staging 证据。
- Fixture 视觉入口为 `/pages/captain-game-form/index?order_id=00000000-0000-4000-8000-000000000204`；订单时间保持 `8月23日 周日 14:00–16:00` 的批准视觉形状，并使用稳定未来年份保证 production form 可保存。
- development HTTP 与 production 组合使用真实 HTTP `OpenGameSource` 和持久化 mutation attempt store。
- production audit 保持既有 deny/composition 规则，并拒绝队长 Fixture 路径和样例业务字面量。
- C1 公开列表、散客申请/审核/候补仍未实现，“我要找球踢”继续关闭。
- B2 owner management 不依赖在线支付开关；关闭支付不代表 B2 被关闭，也不证明支付、退款或库存行为。

## 待完成门禁

- [x] Task 8 聚焦 Node composition/build/audit 自动化：148/148 passed
- [x] development adapter Jest 自动化：5/5 passed
- [x] TypeScript typecheck：PASS
- [x] `PRODUCTION_PAGE_FIXTURE_ADAPTER_VISUAL_PASS`：root 已在 WeChat DevTools iPhone X `375×812` 完成人工视觉自审
- [x] production live disabled-payment build/audit：使用已忽略的 live input 构建，17 条生产路由、`ONLINE_BOOKING_ENABLED=false`、真实 staging API、真实 HTTP open-game source 与持久化 attempt store 均已确认；audit 0 forbidden paths/tokens
- [ ] 真实本地 HTTP/PostgreSQL 旅程（Task 9）
- [ ] shared staging 与真实 iPhone 验收（Task 10，需另行授权）

## 代表性运行时视觉自审

- 环境：WeChat DevTools `36.6.0`，iPhone X `375×812`，portrait，基础库 `3.17.0`。
- 页面：三张生产页面中的创建表单代码，由 development-only adapter 提供数据；没有据此宣称 HTTP、staging 或真机通过。
- 顶部：自审发现并修复了状态栏安全区未生效的问题；修复后三张生产球局页复用既有 `readIntentHeaderLayout`，代表页实测 header `88px`、top inset `44px`，返回箭头、标题和右侧胶囊区完整且互不遮挡。
- 表单：真实场地、输入标签与关键文案正确；普通文字字段使用文本输入，AA 字段使用 `digit`；三组步进按钮等宽等高、沿列对齐，按钮文字在双轴居中。
- 交互：运行时事件验证 `ANY → 后卫 → ANY` 始终互斥；日期与时间 picker 分别更新为 `2099-08-22`、`11:30` 并可恢复为 `2099-08-23`、`12:00`。当前表单没有自定义 modal，因此 modal X 检查为 N/A。
- 底部：固定操作栏实测从 `710px` 到 `812px`，按钮和 Home Indicator 之间留有安全区；上下半页未见边界裁切、横向溢出或关键内容缺失。
- 截图仅用于本机临时人工复核，未加入仓库，也未扩张为全状态重拍。

production live disabled-payment build/audit 已于 2026-08-23 使用本机受限权限、Git 忽略的输入完成；构建与验证过程未打印或记录任何 secret。`HTTP_PENDING` 仍表示尚未完成 Task 9 真实本地 HTTP/PostgreSQL 旅程，不代表本轮 production package audit 失败。现有 Fixture 仅在 Task 10 真机 PASS 后按计划删除。
