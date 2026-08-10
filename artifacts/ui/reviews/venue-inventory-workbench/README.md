# 场馆库存工作台 · Artifact review

## 状态

- Target viewport: 375 × 812。
- 产品与交互方案 approved；Reference Artifact complete。
- Reference Artifact visual approval: approved on 2026-08-10。
- Native Fixture visual approval: pending。
- 当前仅有浏览器 reference，不得把它描述为微信原生实现证据。
- Production disabled；未创建库存 Fixture、生产路由、契约、membership 或后端写入。
- Planned Fixture deletion condition: `delete after real inventory backend integration`。

## Reference capture

- Runtime: Playwright Chromium through the repository Playwright CLI wrapper。
- Source: `artifacts/ui/references/venue-inventory-workbench.html`。
- Logical viewport: 375 × 812 CSS pixels；未使用高分辨率设备像素放大。
- Reference files are captured from the exact `?state=` values in the screen manifest。

| State | Meaning | Reference |
| --- | --- | --- |
| `day-ready` | 单日库存就绪，混合可编辑与只读状态 | `day-ready-reference-375x812.png` |
| `create-slot-open` | 新增 09:30–11:00 时段面板 | `create-slot-open-reference-375x812.png` |
| `edit-slot-open` | 编辑已有时段，时间只读 | `edit-slot-open-reference-375x812.png` |
| `save-result-unknown` | 写入结果未知，保留输入并阻止重复提交 | `save-result-unknown-reference-375x812.png` |
| `create-slot-overlap` | 新增重叠，保留输入并显示明确错误 | `create-slot-overlap-reference-375x812.png` |

## 视觉观察

- **composition:** 头部只保留场馆身份和“新增时段”；日期、物理场地、单日摘要和时段列表形成单向纵向任务。四个面板态仍露出日期、场地与至少一个权威列表项，不把用户带离当天上下文。
- **geometry/spacing:** 375×812 下无横向溢出；可见按钮最小边长 44px；日期单元 47×62px，时段行 347×76px；新增面板高 404px 且无内部裁切。主要间距沿用 4/8px 节奏。
- **component hierarchy:** 日期选择高于物理场地选择，场地选择高于时段列表；底部面板标题、上下文、显式字段、状态反馈和双操作区顺序稳定。
- **typography/color/material:** 沿用系统字体、`#F8FAFC` 背景、白色表面、海军蓝正文、信任蓝和可用绿。正常文字组合均达到至少 4.5:1；选中日期使用 `#0369A1` 与白字，实测 5.93:1。
- **icon assets:** 所有功能图标均为同一 1.8px outline SVG 语汇；未使用 emoji、远程图片或品牌装饰。
- **copy:** 不把 Artifact 数据称为真实库存；新增明确“保存后立即开放”，编辑明确“已有时段不修改时间”，结果未知明确“正在确认保存结果”。
- **state semantics:** `OPEN`、`LOCKED`、`CLOSED`、`BOOKED` 同时使用文字和颜色；只读行使用锁/确认图标与只读文案；重叠错误使用图标、红色容器和就地文字；确认中按钮禁用并保留输入。

## UI 自检

- Playwright 页面 console: 0 errors, 0 warnings。
- 视口与 Artifact 均为 375×812；所有五张 PNG 已验证为 375×812。
- `day-ready` 无横向溢出，所有可见按钮最小边长 44px；`create-slot-open` 面板无内部裁切。
- 表单字段均有可见 label；图标按钮有 `aria-label`；错误使用 `role=alert`，状态反馈使用 `aria-live=polite`。
- 无外部资源、渐变、装饰动画或无限动画；保留 `prefers-reduced-motion` 兜底。
- 本轮只冻结用户指定的 375×812 浅色 Reference Artifact。横屏、暗色、Dynamic Type、大屏与 iPhone 14 Pro 安全区属于后续微信原生 Fixture Demo 的运行时烟雾检查，不伪装为已完成证据。

## Frozen reference hashes

| State | SHA-256 |
| --- | --- |
| `day-ready` | `f5877076d9d856c411218083e67a1947744cd3acd90e929884af66ea33427424` |
| `create-slot-open` | `4b4caa2ca369f022b8a0824210c56f7daf250caf571a3f1562861933856f2bc7` |
| `edit-slot-open` | `1f6a32c44ce6b98ac2f20cb713fa0ee9d9f1bd2dc16529bf8b9d9b6b8e8f776c` |
| `save-result-unknown` | `3da6eeaf3fc7f4d9988c06bf1dbd5f8332b0f51e4d0291fe88e5fbd82eeb190c` |
| `create-slot-overlap` | `362d9161f34e54c8f9811af50e413fd1109fd9de8cd77c2093e005014afe115f` |

Reference Artifact 已获用户明确确认。下一步仅进入原生 Fixture Demo 与同尺寸 implementation/side-by-side/overlay/difference 证据；在原生视觉再次获批前不得进入契约或后端。
