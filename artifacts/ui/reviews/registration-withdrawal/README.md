# C2a 撤回报名 · visual review

## Status

- Target viewport: `375 × 812` CSS pixels.
- Reference Artifact: development-only; `production_enabled: false`.
- Representative state: `joined-confirm`（距开场不足 6 小时）。
- Internal non-capture state: `result-unknown`.
- Reference self-review: `PASS`.
- iOS native self-review: `PASS`（iPhone X，`375 × 812`，DPR 3）。
- Android native self-review: `PASS`（Nexus 5X，`411 × 731`，DPR 2.625）。
- Implementation self-review: `PASS`.
- Delegated visual gate: `PASS`（用户明确委托代理在 iOS 与 Android 开发者工具自审通过后继续）。
- User physical candidate gate: `PENDING`.
- Review board: [review-board.html](review-board.html).

## Proportional evidence plan

本切片只冻结一张 `joined-confirm` 代表帧，用于核对危险操作确认层、临时退出说明和底部安全区。`applied-detail / applied-confirm / applied-withdrawn / joined-detail / joined-withdrawn` 由同一交互稿、原生点击流程与聚焦状态测试覆盖；`result-unknown` 只验证交互语义，不扩张截图矩阵。

## Evidence

- `joined-confirm-reference-375x812.png`
- `joined-confirm-implementation-ios-375x812.png`
- `joined-confirm-side-by-side-ios-375x812.png`
- `joined-confirm-overlay-50-ios-375x812.png`
- `joined-confirm-difference-ios-375x812.png`
- `joined-confirm-implementation-android-411x731.png`

iOS 原生流程已实际点击：场景 → 列表 → 详情 → 打开确认层 → 保留报名 → 再次打开 → 确认退出 → 返回列表 → 结果待确认。退出前为 `10 / 14`、剩余 `4`，退出后为 `9 / 14`、剩余 `5`；运行时状态与 `scroll-top` 回读均恢复为 `146px`。代表薄列表只有一张卡、内容不足以产生肉眼可见滚动，因此这里不宣称完成了物理滚动验证。确认层两个按钮均为 `157.5 × 44px`，同高、同列线、文字双轴居中。

Android 使用同一代表流程复核；确认层完整位于 `411 × 731` 可视区内，两个按钮均为 `173.5 × 48px`，固定底栏和安全区无裁切。两端最终复跑均无页面异常或控制台错误。

同尺寸并排、50% 叠加与差异图已人工检查。剩余差异仅为开发者工具系统状态栏/胶囊与原生字体栅格化，不存在产品构图、关键文案、按钮对齐或状态语义差异。Reference、iOS 和 Android 自审均通过；按用户“由代理完成双平台视觉验证、通过后继续”的明确授权，delegated visual gate 为 `PASS`。真实体验版手机验收仍为 `PENDING`，在通过前不删除 Fixture、不合并最终 `main`、不称 C2a 完成。
