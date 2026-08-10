# 目的入口视觉基础 · review board

## 状态

- Target viewport: 375 × 812。
- 产品/IA approved；visual evidence complete；用户视觉批准 approved。
- 用户于 2026-08-10 明确确认三态视觉通过。
- 三个状态均为 production disabled 的独立 visual Artifact。
- reference/implementation same logical viewport；自动化布局检查不能替代用户视觉确认。
- Fixture deletion condition: `delete before production intent home integration`。
- 当前不授权 inventory/backend；不得在本切片引入场馆库存、后端或契约改动。
- user-supplied full-window DevTools screenshot is diagnostic evidence of safe-area bug only, not same-viewport implementation evidence。

## 运行时与取证来源

- WeChat DevTools Stable 2.01.2510290；base library 3.17.0。
- Device: iPhone X，375 × 812 logical viewport，DPR 3。
- 微信认证后已完整重启 DevTools；项目、AppID、路由与 automation attach 均正常。
- 重启后 GUI `Actions → Screenshot` 仍不写文件，官方 App.captureScreenshot timeout（15 秒）。
- 经用户明确同意，采用 user-approved fallback：从真实 detached simulator window 的 375 × 898 截图中精确提取 `x=0, y=59, width=375, height=812`；不使用浏览器 HTML、不重组页面内容。

| State | Exact route | Reference | Implementation | Side-by-side | Overlay | Difference |
| --- | --- | --- | --- | --- | --- | --- |
| first-entry | `dev/pages/intent-entry/index` | `first-entry-reference-375x812.png` | `first-entry-implementation-375x812.png` | `first-entry-side-by-side.png` | `first-entry-overlay-50.png` | `first-entry-difference.png` |
| city-picker-open | `dev/pages/intent-entry/index?cityPicker=open` | `city-picker-open-reference-375x812.png` | `city-picker-open-implementation-375x812.png` | `city-picker-open-side-by-side.png` | `city-picker-open-overlay-50.png` | `city-picker-open-difference.png` |
| returning-home | `dev/pages/intent-home/index?intent=BOOK` | `returning-home-reference-375x812.png` | `returning-home-implementation-375x812.png` | `returning-home-side-by-side.png` | `returning-home-overlay-50.png` | `returning-home-difference.png` |

## 视觉观察

| Category | first-entry | city-picker-open | returning-home |
| --- | --- | --- | --- |
| composition | 三个入口保持等权纵向结构；implementation 额外呈现真实系统状态栏、胶囊和 Home indicator。 | 背景层级与底部面板结构一致；implementation 面板顶边比 reference 高约 20px。 | 问候、三入口、继续上次、待处理顺序一致；implementation 呈现真实系统栏。 |
| geometry/spacing | 卡片外框和页面左右边距接近；implementation 的图标—文案间距更紧，标题起点更靠左。 | implementation 将城市状态置于名称下方，reference 置于右侧，因此面板更高。 | 主体间距接近；implementation 的 BOOK 选中态边框/底色会增强该入口面积感。 |
| component hierarchy | 标题、说明、入口卡片和身份提示层级一致。 | scrim、sheet、标题、关闭、当前城市和禁用城市层级一致。 | 问候为主标题，快捷入口其次，继续上次与待处理为后续任务层。 |
| typography/color/material | implementation 字体抗锯齿与 reference 浏览器渲染略有差异；海军蓝、浅灰和白卡材质一致。 | implementation scrim 略深；白色圆角面板和禁用灰阶一致。 | 色彩基线一致；implementation 的租赁场地选中态采用浅绿底和蓝色边框，reference 未强调选中态。 |
| icon assets | 图标语义一致，但 reference 为较紧凑的实心/细线 SVG，implementation 为较大的线性场地、日历和球形图标。 | 关闭与勾选图标语义一致；implementation 使用真实小程序线性图标。 | “我的”在 implementation 中为线性用户图标；其余卡片无额外装饰图标。 |
| copy | 三个入口标题、说明与“不是永久身份”一致。 | “选择城市”“当前 · 已开放”“其他城市”“敬请期待”一致。 | 主要业务文案一致；implementation 明确写为 `development visual Fixture data`，reference 少 `development`。 |
| state semantics | 天津为可切换的当前城市；三个目的保持同一账号下的当下选择。 | 天津可选并关闭面板，其他城市禁用且敬请期待，未触发定位或导航。 | `intent=BOOK` 在 implementation 中被结构化显示为租赁场地选中态；页面仍是 development Fixture，production disabled。 |

三个入口仍遵循既定映射：租赁场地可进入现有 venue-map；出租场地和找球踢仅显示 preview-only notice。直到所有入口有真实 destination，页面保持 production disabled。
