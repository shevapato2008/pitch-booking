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
