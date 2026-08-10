# 场馆库存工作台 · Artifact review

## 状态

- Target viewport: 375 × 812。
- 产品与交互方案 approved；Reference Artifact complete。
- Reference Artifact visual approval: approved on 2026-08-10。
- Native Fixture implementation and same-viewport evidence: complete。
- Native Fixture visual approval: pending。
- Production disabled；当前页面仅从开发分包深链进入，未创建生产路由、契约、membership 或后端写入。
- Fixture deletion condition: `delete after real inventory backend integration`。

## Capture provenance

- Reference runtime: repository Playwright Chromium，来源为 `artifacts/ui/references/venue-inventory-workbench.html?state=...`。
- Native runtime: WeChat DevTools Stable 2.01.2510290，base library 3.17.0，开发路由 `dev/pages/venue-inventory/index?state=...`。
- Native target: iPhone X，页面逻辑尺寸 375 × 812；使用页面 webview 的 `captureVisibleRegion` 读取 750 × 1624 guest surface，再等比归一化为 375 × 812 PNG。
- Capture boundary: 原生 implementation 只包含小程序 guest surface，不包含 DevTools 模拟器拥有的时间、刘海、胶囊和 Home Indicator；页面仍按运行时 safe area 留白。
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

- **composition:** 核心构图一致：场馆身份与新增入口、日期、物理场地、单日摘要和时段列表形成单向任务；面板态仍保留当天上下文。原生 guest 截图顶部不含模拟器系统 UI，但页面保留安全区。
- **geometry/spacing:** 375 × 812 下无横向溢出或内容裁切。原生 header 为避开胶囊，将文字操作放在独立的右侧安全行，底边约比 Reference 低 21px；原生底部面板因 `env(safe-area-inset-bottom)` 为 Home Indicator 预留空间，顶部约比 Reference 提前 34–37px。这两项是运行时安全区适配，不作为回归缺陷。
- **component hierarchy:** 日期、场地、摘要、时段及面板内标题、上下文、字段、反馈、操作区顺序与 Reference 一致；`LOCKED`、`BOOKED` 和已开始时段维持只读层级。
- **typography/color/material:** 系统字体、浅灰背景、白色表面、海军蓝正文、信任蓝与可用绿保持一致；原生文字栅格化略深、略重，未改变信息层级或状态辨识。
- **icon assets:** 使用 CSS 原生 outline 图标，无 emoji、远程图片或额外视觉资产。
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
| `day-ready` | `f5877076d9d856c411218083e67a1947744cd3acd90e929884af66ea33427424` | `746bfe99182481c0887b73fc9dc652e8330efde05bcc099119b23fea0e2f70eb` |
| `create-slot-open` | `4b4caa2ca369f022b8a0824210c56f7daf250caf571a3f1562861933856f2bc7` | `ddef77ed6f080b5d73f31ed471d95848358f0ca71c4ecc9b81259cc1b04d1714` |
| `edit-slot-open` | `1f6a32c44ce6b98ac2f20cb713fa0ee9d9f1bd2dc16529bf8b9d9b6b8e8f776c` | `c6d224ebae4ae84a66228ccf7fe9baf947c672c7c38bb5bb62b5e4eef70e2778` |
| `save-result-unknown` | `3da6eeaf3fc7f4d9988c06bf1dbd5f8332b0f51e4d0291fe88e5fbd82eeb190c` | `e0c6ed65f032ecfde380e675e974702a1a9a43710a272ba6973d1b1e96f6021b` |
| `create-slot-overlap` | `362d9161f34e54c8f9811af50e413fd1109fd9de8cd77c2093e005014afe115f` | `29b9670a3c30cfdf0234c92c91f8a12dd78fd4220cdfb2eb7b561b0164a2b258` |

Reference 与原生 Fixture 的证据均已冻结。必须取得用户对本轮 Native Fixture 的明确视觉确认，之后才可冻结契约并进入后端实现。
