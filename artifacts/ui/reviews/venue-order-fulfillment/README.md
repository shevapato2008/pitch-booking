# 场馆订单履约 · 视觉审核

- Target viewport: 375 × 812
- Representative state: `refund-confirm`
- Native Fixture visual approval: pending
- Production enabled: no

## 证据

| Reference | Implementation | Side by side | Overlay 50% | Difference |
| --- | --- | --- | --- | --- |
| `refund-confirm-reference-375x812.png` | pending | pending | pending | pending |

## 参考图自检

真实 Chromium 在 `375 × 812` CSS viewport、device scale 1 下捕获参考图；PNG 已独立验证为 375 × 812。

- **composition / hierarchy**：胶囊安全的场馆标题与工作人员语境固定在顶部；日期和三类订单动作形成单列工作层级；退款确认层只遮挡当前需要决策的下半屏。
- **geometry/spacing**：三列日期按钮、订单状态/编号列和右侧动作列保持对齐；所有可见按钮至少 44px，文本均使用显式 flex 双轴居中；无水平溢出。
- **typography/colors/materials**：沿用既有系统字体、深蓝文字、可信蓝、白色卡片和语义绿/橙/红；状态同时使用文字，不只依赖颜色。
- **icons / copy / state meaning**：返回、关闭、提示均为一致的描边 SVG，无 emoji；手机号遮罩，退款明确为整单全额、原因必填并说明原路退回金额。
- **safe area**：底部操作区使用 `env(safe-area-inset-bottom)`，主按钮未贴近手势区；关闭按钮和全部动作控件边界完整、未裁切。
- **interaction pass**：日期切换、确认签到、完成服务、打开/取消退款层、确认退款和返回均产生可见、确定的参考状态；没有无效按钮或假成功 Toast。

原生实现、并排图、叠加图、差异图与独立视觉结论必须由真实 WeChat DevTools 运行时产生；本切片不得自批。

## Capture hash

`refund-confirm-reference-375x812.png`: `bff18ff743c8fa8e5aaa8500436c7c631bef9fd758031de18fc2f1d2f04d6ada`

## Native Fixture source verification

TDD RED was observed before the Fixture and page existed:

```text
Jest: Cannot find module '../../venue-fulfillment-fixture'
Node: missing miniprogram/dev/venue-fulfillment-fixture.ts
```

The minimal slice-local implementation then passed:

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

The covered behavior is deterministic local Fixture state only: check-in, completion, refund-sheet open/cancel, required reason editing, full-refund confirmation, date-driven empty/read-error states, retry, native back fallback, and every visible button binding. No action uses a Toast as fake production success.

## Native capture blocker

One proportional WeChat DevTools attempt reached a healthy real environment on 2026-08-19:

```text
WeChat DevTools 36.6.0
APPID_CONFIGURED, PROJECT_CONFIGURED, BUILD_COMPLETED,
LOGIN_CONFIRMED, PROJECT_OPENED, AUTOMATION_ENABLED
```

The first simulator screenshot tool session then stopped at the tool's required user-authorization task (`auth_26ca59dc8b41007aec2a394b6a920cddaf9cbee5316a492d`). Because the user was unavailable and the plan forbids expanding a visual slice into toolchain repair, no second capture workaround was attempted. There is no implementation PNG, side-by-side, overlay, difference, or native approval. Root integration must consume the route fragment and complete this visual gate in an authorized WeChat DevTools session.
