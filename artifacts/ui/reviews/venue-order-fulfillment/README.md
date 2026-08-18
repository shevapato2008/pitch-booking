# 场馆订单履约 · 视觉审核

- Target viewport: 375 × 812
- Representative state: `refund-confirm`
- Native Fixture visual approval: approved
- Production enabled: no
- Visual gate conclusion: approved

## 证据

| Reference | Implementation | Side by side | Overlay 50% | Difference |
| --- | --- | --- | --- | --- |
| `refund-confirm-reference-375x812.png` | `refund-confirm-implementation-375x812.png` | `refund-confirm-side-by-side-750x812.png` | `refund-confirm-overlay-375x812.png` | `refund-confirm-difference-375x812.png` |

真实 WeChat DevTools 36.6.0 使用 iPhone 12/13 Pro 模拟器（运行时 viewport `390 × 844`）捕获 `refund-confirm-implementation-390x844.png`。自动化工具没有设备切换接口，因此保留该原始源图，并将其按近似相同比例规范化为 `375 × 812`，用于与同尺寸参考图进行并排、50% 叠加和 difference 检查；没有将 Chromium 图冒充原生实现。

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

## Capture hashes

- reference: `bff18ff743c8fa8e5aaa8500436c7c631bef9fd758031de18fc2f1d2f04d6ada`
- native source: `2017639e9ebb353af40967c260599485e1f73c31594167c227796ca60ba5f601`
- implementation 375×812: `e6cb956f7e230499e2794d56ffbef50aa37836be0d117c9542f99b7843f68102`
- side by side: `2be3973d6f88f46e71108636e92f19d1d389804c5800e01c9531ebf40c45ccee`
- overlay 50%: `2d70dda3499bd41bc924b284821348e4428d583e7a7f764931db7d0298137490`
- difference: `9694d17b4c7c72d8cd702782774d8e139f6c3f8edafc2898cc9ea5d483151fc7`

本结论仅批准隔离的原生 Fixture 视觉与交互，不启用生产路由，也不代表后端 Task 4 已开始。
