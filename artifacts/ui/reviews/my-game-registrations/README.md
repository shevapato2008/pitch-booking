# C1c-1 我的报名 · visual review

## Status

- Target viewport: `375 × 812` CSS pixels.
- Reference Artifact: development-only; `production_enabled: false`.
- Reference capture: [ready-list-reference-375x812.png](ready-list-reference-375x812.png).
- Native capture: [ready-list-implementation-375x812.png](ready-list-implementation-375x812.png).
- Comparison evidence: [side-by-side](ready-list-side-by-side.png) · [overlay 50%](ready-list-overlay-50.png) · [difference](ready-list-difference.png).
- Reference self-review: `PASS`.
- Native implementation self-review: `PASS`.
- User visual gate: `PASS`.
- Review board: [review-board.html](review-board.html).

## Proportional evidence

本切片按比例只冻结一个 `ready-list` 代表帧。`entry / empty / load-error` 由同一交互稿、聚焦自动化及用户逐场景检查覆盖，不扩张为重复截图矩阵。Reference 和微信开发者工具原生实现均按 `375 × 812` 归一化，并生成并排、叠加和差异图；原生证据不以浏览器 Reference 替代。

## Reference self-review

在 Chromium 的 `375 × 812` viewport 打开 `?state=ready-list` 后人工检查：

- 标题居中，返回箭头完整，并与 44px 触控区对齐；
- “刷新”和“加载更多”文字水平、垂直居中，按压反馈不改变布局；
- 两张卡片、状态徽标、人制徽标和右侧 chevron 沿统一列线对齐；
- 卡片没有裁切，纵向列表可滚动，底部预留 safe-area；
- 关键文案为“我的报名 / 最近的报名 / 状态以服务端为准”；
- 卡片只显示状态、球局、时间、场馆、物理场地和人制，没有隐私禁止项。

Reference self-review 因上述项目通过而标记 `PASS`。

规格审查修正后又在同一 viewport 检查了 `entry`：入口为单行 44px，文字和 chevron 完整，公开球局卡片保持左对齐；独立详情深链的标题栏返回会进入找球局。重新捕获 `ready-list` 后与已提交 PNG 的 SHA-256 完全一致，因此保留原代表帧。

## Native implementation and user gate · 2026-08-29

Task 1–3 的聚焦测试、类型检查、development / production fresh build 和生产包隔离审计均已通过。用户随后在微信开发者工具的 iPhone X 目标运行时完成既定场景检查并明确确认没有问题；提供的完整开发者工具截图被裁取为同尺寸原生代表帧，没有重绘或伪造页面内容。

原生人工复核覆盖标题与返回、刷新和加载更多按钮双轴居中、两张卡片及状态/人制徽标列线、完整 chevron、页面边界、底部安全区、关键文案和隐私字段。Reference 与实现的垂直差异来自原生状态栏、开发预览标记和真实系统导航几何，不影响已冻结的信息层级与交互语义。入口筛选与返回恢复、列表刷新/加载更多、详情返回、空态和首次错误重试由用户按既定顺序完成，因此 Native implementation self-review 与 User visual gate 均标记 `PASS`。
