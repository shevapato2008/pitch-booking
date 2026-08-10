# 目的入口视觉基础 · 初始 review board

## 状态

- Target viewport: 375 × 812。
- 产品/IA approved，但 native visual not approved。
- 三个状态均为 production disabled 的独立 visual Artifact。
- reference/implementation same logical viewport，之后必须在同一逻辑 viewport 对照。
- Fixture deletion condition: `delete before production intent home integration`。
- 当前不授权 inventory/backend；不得在本切片引入场馆库存、后端或契约改动。
- user-supplied full-window DevTools screenshot is diagnostic evidence of safe-area bug only, not same-viewport implementation evidence。

## 参考状态与边界

| State | Reference | Development route | 说明 |
| --- | --- | --- | --- |
| first-entry | `../../references/intent-entry-first.html` | `dev/pages/intent-entry/index` | 首次启动的目的选择预览。 |
| city-picker-open | `../../references/intent-entry-city-open.html` | `dev/pages/intent-entry/index?cityPicker=open` | 首次或返回首页点击天津后的城市选择层；天津当前且已开放，其他城市敬请期待。 |
| returning-home | `../../references/intent-home-returning.html` | `dev/pages/intent-home/index` | 下次启动的独立预览，非首次选择中间页。 |

三个入口均遵循既定映射：租赁场地可进入现有 venue-map；出租场地和找球踢仅显示 preview-only notice。直到所有入口有真实 destination，页面保持 production disabled。

## 预留视觉取证

完成前，针对每个 state 在同一 375 × 812 logical viewport 保存 reference、implementation、side-by-side、overlay-50 与 difference，并在下表记录观察。自动化布局检查不能替代 native visual approval。

| Category | first-entry | city-picker-open | returning-home |
| --- | --- | --- | --- |
| composition | 待取证 | 待取证 | 待取证 |
| geometry/spacing | 待取证 | 待取证 | 待取证 |
| component hierarchy | 待取证 | 待取证 | 待取证 |
| typography/color/material | 待取证 | 待取证 | 待取证 |
| icon assets | 待取证 | 待取证 | 待取证 |
| copy | 待取证 | 待取证 | 待取证 |
| state semantics | 待取证 | 待取证 | 待取证 |
