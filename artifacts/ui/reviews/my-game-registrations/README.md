# C1c-1 我的报名 · Artifact visual review

## Status

- Target viewport: `375 × 812` CSS pixels.
- Reference Artifact: development-only; `production_enabled: false`.
- Representative capture: [ready-list-reference-375x812.png](ready-list-reference-375x812.png).
- Reference self-review: `PASS`.
- Native implementation self-review: `PENDING`.
- User visual gate: `PENDING`.
- Review board: [review-board.html](review-board.html).

## Proportional evidence

本切片只冻结一个 `ready-list` 代表帧。`entry / empty / load-error` 由同一交互稿与聚焦自动化覆盖，不扩张为重复截图矩阵。原生预览完成后再补 implementation、side-by-side、overlay 和 difference；当前不把浏览器 Reference 冒充微信原生实现。

## Reference self-review

在 Chromium 的 `375 × 812` viewport 打开 `?state=ready-list` 后人工检查：

- 标题居中，返回箭头完整，并与 44px 触控区对齐；
- “刷新”和“加载更多”文字水平、垂直居中，按压反馈不改变布局；
- 两张卡片、状态徽标、人制徽标和右侧 chevron 沿统一列线对齐；
- 卡片没有裁切，纵向列表可滚动，底部预留 safe-area；
- 关键文案为“我的报名 / 最近的报名 / 状态以服务端为准”；
- 卡片只显示状态、球局、时间、场馆、物理场地和人制，没有隐私禁止项。

Reference self-review 因上述项目通过而标记 `PASS`；原生实现和用户视觉确认仍为 `PENDING`。

规格审查修正后又在同一 viewport 检查了 `entry`：入口为单行 44px，文字和 chevron 完整，公开球局卡片保持左对齐；独立详情深链的标题栏返回会进入找球局。重新捕获 `ready-list` 后与已提交 PNG 的 SHA-256 完全一致，因此保留原代表帧。

## Native checkpoint · 2026-08-29

Task 1–3 的聚焦测试、类型检查、development / production fresh build 和生产包隔离审计均已通过。微信开发者工具真实运行时审核仍未完成：`computer-use` 本机通道无法启动，官方自动化客户端又遇到当前 IDE 未返回 `SDKVersion`、后续请求超时。两条链路重复失败后按项目比例原则停止工具排障，不生成替代截图，也不把浏览器 Reference 当作原生证据。

恢复时只需：登录微信开发者工具，打开 C1c 场景页，在 iPhone X 逻辑 `375 × 812` 下执行 entry 筛选与返回保留、列表刷新/加载更多、详情返回、empty/retry，然后捕获同尺寸 `ready-list` 并完成 side-by-side / overlay / difference 检查。在这之前，Native implementation self-review 与 User visual gate 均保持 `PENDING`。
