# Booking confirmation visual review

## Approval record

- Reference status: approved
- Implementation visual status: approved
- Source: `.superpowers/brainstorm/126-1785138762/booking-confirmation-options.html`
- Source SHA-256: `9bca7651cb55df21afcdc9c1cac5db0620d8887145ee0814ea0f322aeec916af`
- Frozen reference: `artifacts/ui/references/booking-confirmation-a.html`
- Frozen reference SHA-256: `8d37906245c08459885c52cf7e412691be6a245e82d558debba1e45272dbf3d8`
- Target viewport: 375 × 812
- Reviewer: user
- Review date: 2026-07-27 17:41:03 +0800 (Asia/Shanghai)
- Decision notes: 用户确认冻结参考稿，并要求继续按照 Artifact 实现真实前端页面；完整实现视觉仍须在 Task 5 通过同视口对比确认。

Before freezing, the selected A layout and hierarchy received an accessibility contrast revision: small action buttons use `#0369A1`, and simulated input text uses `#64748B`.

## Visual evidence

Record every image at the target viewport before changing the approval status.

| Evidence | Path | Review notes |
| --- | --- | --- |
| Reference screenshot | `reference-375x812.png` | 用户提供的 Chrome 750 × 1624 捕获，Lanczos 归一化到 375 × 812；SHA-256 `16454803fe43455ebd0a9237a496332d6ede867809e2f4e67069b9d008455934`。 |
| Implementation screenshot | `implementation-375x812.png` | 微信开发者工具 Stable 2.01.2510290、基础库 3.17.0、iPhone X 375 × 812、未授权基线；从 93% 模拟器全窗捕获裁出设备画面并归一化；SHA-256 `bbee59bf00344e142e02b22b8d9028288022c8b471ff52345bf84279388cd51c`。 |
| Side-by-side comparison | `side-by-side.png` | 左为参考，右为真实小程序；SHA-256 `d7329d5c1c03623b6f0f179b1140f48dceb2bf59ec1f4f9b9d5437094bb330ed`。 |
| 50% overlay | `overlay-50.png` | 用于核对主要边界、卡片位置和固定提交栏；SHA-256 `7524c3a75185d07e83c0122e222a270ff57844406b1fe1c52cbecdc769fbb569`。 |
| Absolute difference | `difference.png` | 像素差包含原生导航、系统字体、动态时间和归一化采样差异；SHA-256 `b92ff50c5842994266e6d2e730b5579547d386e5f6c7e3def48988349ee2c4d1`。 |

Capture date: 2026-07-27 20:06 +0800 (Asia/Shanghai).

## Implementation approval

- Status: approved
- User's exact approval response: `确认`
- Approval date: 2026-07-27 20:20:54 +0800 (Asia/Shanghai)
- Target viewport: 375 × 812
- WeChat Developer Tools: Stable 2.01.2510290; base library 3.17.0; iPhone X simulator
- Reference SHA-256: `16454803fe43455ebd0a9237a496332d6ede867809e2f4e67069b9d008455934`
- Implementation SHA-256: `bbee59bf00344e142e02b22b8d9028288022c8b471ff52345bf84279388cd51c`
- Side-by-side SHA-256: `d7329d5c1c03623b6f0f179b1140f48dceb2bf59ec1f4f9b9d5437094bb330ed`
- Overlay SHA-256: `7524c3a75185d07e83c0122e222a270ff57844406b1fe1c52cbecdc769fbb569`
- Difference SHA-256: `b92ff50c5842994266e6d2e730b5579547d386e5f6c7e3def48988349ee2c4d1`
- Implementation revision: `uncommitted` because repository Git metadata is read-only in this environment
- Workspace diff identifier at approval: `sha256:aecc51fce09da1be65f2429b0ad3e587a503ca2bdd72ed1241fcc96b677b0808`
- Decision: release the Task 5 visual hard gate and continue to Chunk 2 contract work. External final delivery remains deferred until `modelstella.com` ICP filing is complete.

## Difference record

| Area | Composition and geometry | Component hierarchy | Typography, color, and material | Icons and assets | Copy and state semantics |
| --- | --- | --- | --- | --- | --- |
| Booking confirmation | 主体采用同一顺序和相近边距：场次、联系人、须知；提交栏固定到底部并预留安全区。真实小程序原生状态栏和导航栏使首张卡片相对 HTML 模拟导航略下移。 | 页面内额外标题已删除；联系人可见标签已隐藏但输入框保留 `aria-label`；三张卡片和底栏层级与参考一致。 | 色彩、圆角、虚线联系人卡和字号层级一致。右图的轻微软化来自 93% 模拟器捕获后归一化；原生系统字体度量存在轻微差异。 | 真实运行时保留微信原生返回首页、胶囊菜单和 Home Indicator；HTML 参考未模拟这些系统资产。 | Fixture 和规则文案已逐项一致。参考稿在手机号和姓名为空时仍显示蓝色“确认下单”；真实实现按业务约束显示灰色禁用按钮“请先授权手机号”，属于有意保留的诚实状态差异。状态栏时间为动态系统值。 |

## Development-HTTP visual approval

- Status: approved
- User's exact approval response: `确认，快速推进`
- Approval date: 2026-07-28 (Asia/Shanghai)
- Target viewport: 375 × 812
- WeChat Developer Tools: Stable 2.01.2510290; base library 3.17.0; iPhone X simulator
- Runtime: development HTTP composition against `http://127.0.0.1:8001`
- Review board: `http-review-board.html`

| Evidence | Size | SHA-256 |
| --- | ---: | --- |
| `http-implementation-375x812.png` | 375 × 812 | `1c3657ba1f00574d7c072ee99313703887d51a077460f245dfbf3c676d0e14ff` |
| `http-side-by-side.png` | 750 × 812 | `44d0ca15ecfc70f6b668dd03688df542b519612ae06f26d8ae76864f052288d0` |
| `http-overlay-50.png` | 375 × 812 | `58b9274e4efab5610a1e8514f3c2c4b47885376ff88724b07ac9174fcba309b2` |
| `http-difference.png` | 375 × 812 | `dc5120f30a68d9c0c159b0169bcf27a0e02f58407e205364159767857bca0b8e` |

### HTTP difference record

The HTTP-backed screen preserves the approved composition, card geometry and spacing,
component hierarchy, fixed submit bar, typography hierarchy, colors, borders, radii,
and honest `phone-required` state. Native WeChat chrome and icons are unchanged. Expected
data-only differences are the real seeded venue/pitch name, 2026-07-29 date, 19:00–21:00
time, ¥320 price, and dynamic system time. The longer real venue name remains on one line;
no layout, style, or state-semantic regression was found. The user explicitly approved
these differences before the real order journey continued.
