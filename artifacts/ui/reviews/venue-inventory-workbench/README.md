# 场馆库存工作台 · Artifact review

## 状态

- Target viewport: 375 × 812。
- 产品与交互方案 approved；Reference Artifact complete。
- Reference Artifact visual approval: approved on 2026-08-10。
- Native Fixture implementation and same-viewport evidence: complete。
- Native Fixture visual approval: pending。
- 2026-08-10 首轮 Native evidence 因按钮原生默认样式覆盖、文字未居中、箭头越界和面板安全区留白过大被用户退回；本目录现有 implementation 与对比图均为修复后重新采集，已取代首轮证据。
- Production disabled；当前页面仅从开发分包深链进入，未创建生产路由、契约、membership 或后端写入。
- Fixture deletion condition: `delete after real inventory backend integration`。

## Capture provenance

- Reference runtime: repository Playwright Chromium，来源为 `artifacts/ui/references/venue-inventory-workbench.html?state=...`。
- Native runtime: WeChat DevTools Stable 2.01.2510290，base library 3.17.0，开发路由 `dev/pages/venue-inventory/index?state=...`。
- Native target: iPhone X，页面逻辑尺寸 375 × 812；从 DevTools 原生模拟器的设备边界裁取可见 surface，再按设备逻辑尺寸归一化为 375 × 812 PNG。
- Capture boundary: 原生 implementation 包含模拟器实际状态栏、刘海、微信胶囊和 Home Indicator；页面内容按真实 safe area 排布，因此这些系统区域也保留在证据中。
- Safe-area smoke: DevTools 可用设备列表中的 iPhone 14 Pro Max（430 × 932）已检查，标题与右上操作避开 Dynamic Island/胶囊，无横向裁切；随后恢复 iPhone X 完成正式取证。

## Same-viewport evidence

| State | Reference | Native implementation | Side by side | Overlay 50% | Difference |
| --- | --- | --- | --- | --- | --- |
| `day-ready` | `day-ready-reference-375x812.png` | `day-ready-implementation-375x812.png` | `day-ready-375x812-side-by-side.png` | `day-ready-375x812-overlay-50.png` | `day-ready-375x812-difference.png` |
| `create-slot-open` | `create-slot-open-reference-375x812.png` | `create-slot-open-implementation-375x812.png` | `create-slot-open-375x812-side-by-side.png` | `create-slot-open-375x812-overlay-50.png` | `create-slot-open-375x812-difference.png` |
| `edit-slot-open` | `edit-slot-open-reference-375x812.png` | `edit-slot-open-implementation-375x812.png` | `edit-slot-open-375x812-side-by-side.png` | `edit-slot-open-375x812-overlay-50.png` | `edit-slot-open-375x812-difference.png` |
| `save-result-unknown` | `save-result-unknown-reference-375x812.png` | `save-result-unknown-implementation-375x812.png` | `save-result-unknown-375x812-side-by-side.png` | `save-result-unknown-375x812-overlay-50.png` | `save-result-unknown-375x812-difference.png` |
| `create-slot-overlap` | `create-slot-overlap-reference-375x812.png` | `create-slot-overlap-implementation-375x812.png` | `create-slot-overlap-375x812-side-by-side.png` | `create-slot-overlap-375x812-overlay-50.png` | `create-slot-overlap-375x812-difference.png` |

## 视觉观察

- **composition:** 核心构图一致：场馆身份与新增入口、日期、物理场地、单日摘要和时段列表形成单向任务；面板态仍保留当天上下文。原生 implementation 同时保留模拟器系统 UI 与页面 safe area，明确展示微信运行时约束。
- **geometry/spacing:** 375 × 812 下无横向溢出或内容裁切。顶部操作恢复 Reference 的实心/描边材料、内边距和标签居中；原生 header 仍为微信胶囊保留右侧安全行，因此日历区整体约比 Reference 低 20px。面板底部重复安全区留白已移除，面板顶部差缩小到约 18–21px；操作按钮与 Home Indicator 之间保留紧凑且可用的安全间距。
- **component hierarchy:** 日期、场地、摘要、时段及面板内标题、上下文、字段、反馈、操作区顺序与 Reference 一致；`LOCKED`、`BOOKED` 和已开始时段维持只读层级。
- **typography/color/material:** 系统字体、浅灰背景、白色表面、海军蓝正文、信任蓝与可用绿保持一致；按钮文字已通过 flex 在原生运行时居中，顶部“新增时段”和“更多日期”不再被原生 button 默认背景、颜色、字号和 padding 覆盖。原生文字栅格化略深、略重，未改变信息层级或状态辨识。
- **icon assets:** 使用 CSS 原生 outline 图标，无 emoji、远程图片或额外视觉资产；列表与字段 chevron 现由 32rpx 裁切盒包住 16rpx 内箭头，右边界完整可见。
- **copy:** 场馆、日期、场地、时段、只读、保存结果未知和重叠错误文案与 Reference 对齐；Fixture 数据始终明确为预览数据。
- **state semantics:** `OPEN`、`LOCKED`、`CLOSED`、`BOOKED` 均同时使用文字与颜色。新增面板保留字段和双操作；编辑面板时间只读；结果未知时保留输入、禁用关闭/确认并显示处理中；重叠时保留输入并就地显示红色错误。

## Native functional checks

- `day-ready`、`create-slot-open`、`edit-slot-open`、`save-result-unknown`、`create-slot-overlap` 五个 query 状态均在真实微信小程序运行时打开并核对。
- 新增按钮、时段行与关闭/保存动作具备至少 44px 的触控目标；只读与禁用状态不依赖颜色单独表达。
- 结果未知状态不会重复提交；重叠状态保留用户输入；本阶段 Fixture 不调用真实库存接口，也不伪装为真实库存。
- 开发构建包含 `dev/pages/venue-inventory/index`；生产构建继续排除开发分包与 Fixture。
- 自动化布局检查通过不替代视觉确认；本轮仍停在 Native Fixture visual approval 闸门。

## Frozen hashes

| State | Reference SHA-256 | Native implementation SHA-256 |
| --- | --- | --- |
| `day-ready` | `f5877076d9d856c411218083e67a1947744cd3acd90e929884af66ea33427424` | `944a489215b6badd79aec5e3535179f0477a7a1993c6e0e8b35ded0e57113117` |
| `create-slot-open` | `4b4caa2ca369f022b8a0824210c56f7daf250caf571a3f1562861933856f2bc7` | `44a96dd6ada8ea04f88d0980a45cfd14262c86f03a0296b6d854dcac1275d5fd` |
| `edit-slot-open` | `1f6a32c44ce6b98ac2f20cb713fa0ee9d9f1bd2dc16529bf8b9d9b6b8e8f776c` | `5364812f47a26e86679578358e9a8dd6b6179d41acfe33544b31d5a48ec7b089` |
| `save-result-unknown` | `3da6eeaf3fc7f4d9988c06bf1dbd5f8332b0f51e4d0291fe88e5fbd82eeb190c` | `390a3ff2beded1e098c9c0d2e185d7a30473b8908894bf1128b79b3bf2d817b4` |
| `create-slot-overlap` | `362d9161f34e54c8f9811af50e413fd1109fd9de8cd77c2093e005014afe115f` | `1383f9ef863635541830009f1e760f863ff16564fa13450572607bb12f71a261` |

Reference 与原生 Fixture 的证据均已冻结。必须取得用户对本轮 Native Fixture 的明确视觉确认，之后才可冻结契约并进入后端实现。
