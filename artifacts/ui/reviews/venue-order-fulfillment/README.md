# 场馆订单履约 · 视觉审核

- Target viewport: 375 × 812
- Representative state: `refund-confirm`
- Native Fixture visual approval: approved
- Historical Fixture visual evidence: retained
- Production list/check-in/complete: enabled and device accepted
- Payment/refund: disabled; refund route unpublished
- Visual gate conclusion: approved for the recorded Fixture comparison and real-iPhone operational smoke

## 证据

| Reference | Implementation | Side by side | Overlay 50% | Difference |
| --- | --- | --- | --- | --- |
| `refund-confirm-reference-375x812.png` | `refund-confirm-implementation-375x812.png` | `refund-confirm-side-by-side-750x812.png` | `refund-confirm-overlay-375x812.png` | `refund-confirm-difference-375x812.png` |

真实 WeChat DevTools 36.6.0 使用 iPhone 12/13 Pro 模拟器（运行时 viewport `390 × 844`）捕获 `refund-confirm-implementation-390x844.png`。自动化工具没有设备切换接口，因此保留该原始源图，并将其按近似相同比例规范化为 `375 × 812`，用于与同尺寸参考图进行并排、50% 叠加和 difference 检查；没有将 Chromium 图冒充原生实现。

## 真实 iPhone 生产旅程

2026-08-20，体验成员使用已成功上传的体验版 `0.1.1`，在受控 staging
零金额订单上完成 9 项 PASS：“我的订单”刷新；打开已过期订单且无支付动作；进入授权场馆“今日订单”；无取消/退款按钮；确认签到；完成服务；场馆列表刷新后仍为“已完成”；“我的订单”刷新后为“已完成”且详情无操作；按钮、滚动、底部安全区和返回正常。

该次验收时 `ONLINE_BOOKING_ENABLED=false`，`MINIPROGRAM_PAYMENT_PROVIDER=disabled`，场馆退款路由保持未发布。因而设备 PASS 只覆盖今日订单、签到、完成及相邻订单状态回读，不覆盖真实支付、退款或 owner 取消。

## 视觉结论

- **composition / hierarchy**：场馆标题、工作人员语境、日期选择、三种履约动作和退款确认层的层级与参考一致；底部 Sheet 只覆盖当前退款决策区域。
- **geometry / spacing**：三列日期、订单卡片和操作按钮保持对齐，无水平溢出或裁切。首张原生图暴露的额外 Fixture 提示条已移除；微信 `textarea` 默认高度已用显式 `height` 对齐参考构图。
- **typography / controls**：文字均清晰，按钮使用显式 flex 双轴居中；所有操作控件保持至少 `88rpx`，没有旧式按钮文字偏移。
- **colors / materials / semantics**：深蓝、可信蓝、语义绿/橙/红和遮罩透明度与参考相符；状态同时有文本，不依赖颜色单独传义。
- **safe area / native variance**：真实微信状态栏、胶囊和 iPhone 底部 Home Indicator 是参考 Chromium 中不存在的预期差异；实现为它们保留安全区，所以原生 Sheet 的按钮区相对参考上移约一个底部安全区高度。
- **difference review**：其余可见差异主要来自微信原生字体栅格化、真实系统控件和 390→375 规范化；未发现影响可用性的层级、触控、文案或状态语义偏差。

## 真实交互验证

WeChat DevTools 自动化实际点击并读取 Page data：

- 退款原因输入成功，`refundReasonValid=true`；取消后 `sheetOpen=false`、`visualState=ready`。
- “确认签到”后订单由“待签到”变为“已签到”，下一权威动作变为 `COMPLETE`。
- “完成服务”后订单变为“已完成”，动作清空。
- 再次打开退款、编辑原因并确认后，订单变为“退款处理中”，动作清空。
- `read-error` 的“重新读取”恢复 `refund-confirm`；真实点击期间发现安全区布局值被 Fixture 重置，已通过 TDD 修复并在运行时复验 `headerTopPx=47`、`headerRightInsetPx=102`。
- 返回按钮实际跳转至 `pages/venue-profile/index`。

## TDD 与验证

初始 RED：Fixture/page 尚不存在；真实视觉 RED：额外提示条、微信原生 textarea 高度过大、重试后安全区 layout 被重置。修复后 GREEN：

```text
npx jest miniprogram/dev/pages/venue-fulfillment/index.test.ts --runInBand
1 suite passed, 5 tests passed

node --test tests/venue-order-fulfillment-native-preview.test.mjs
2 tests passed

npm run typecheck
passed

npm run build:miniprogram:development
passed; dev/pages/venue-fulfillment/index discovered without editing a central manifest
```

以上命令记录的是历史 preview 阶段。真机生产旅程通过后，删除门禁先在旧资产仍存在时得到预期 RED，再删除临时 Fixture、dev page 与 route fragment；随后门禁 GREEN，同时继续保护生产 route、真实 HTTP data source 与持久化 attempt store。

## Capture hashes

- reference: `bff18ff743c8fa8e5aaa8500436c7c631bef9fd758031de18fc2f1d2f04d6ada`
- native source: `2017639e9ebb353af40967c260599485e1f73c31594167c227796ca60ba5f601`
- implementation 375×812: `e6cb956f7e230499e2794d56ffbef50aa37836be0d117c9542f99b7843f68102`
- side by side: `2be3973d6f88f46e71108636e92f19d1d389804c5800e01c9531ebf40c45ccee`
- overlay 50%: `2d70dda3499bd41bc924b284821348e4428d583e7a7f764931db7d0298137490`
- difference: `9694d17b4c7c72d8cd702782774d8e139f6c3f8edafc2898cc9ea5d483151fc7`

历史 Fixture 证据继续保留，但临时 Fixture 源已在真机验收后删除。生产今日订单、签到和完成使用真实 HTTP 并已通过设备 smoke；真实支付/退款仍等待外部商户凭据与资金 smoke，场馆退款路由继续保持未发布，整个 B1 未标记完成。
