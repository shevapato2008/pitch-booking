# 可扩展地图场馆目录视觉证据

状态：参考图已采集；微信开发者工具实现图、对比图、视觉结论和用户确认均待完成。

## 参考图采集元数据

- 日期：2026-08-06（Asia/Shanghai）
- 来源：`artifacts/ui/references/venue-map-scalable-<state>.html`
- 来源基线：`3fe13813d1f97db30339842dd2fd2e0e828efce2`
- 浏览器：Google Chrome 150.0.7871.187
- 操作系统：macOS 26.5.2（25F84）
- 捕获方式：Chrome CDP `Emulation.setDeviceMetricsOverride` 后直接调用 `Page.captureScreenshot`
- 逻辑 viewport：375×812、390×844
- DPR：1
- 后处理：无裁剪、无缩放

## 参考图清单

| 状态 | viewport | SHA-256 |
| --- | --- | --- |
| city | 375×812 | `25556013bb9fcf670f67eecd0a18cc015dc107633333968e41c8d874cef936ee` |
| city | 390×844 | `8458cb3488e7601b753daf8b8e63ee5586b3841442063225f5d90d280157afb1` |
| nearby | 375×812 | `aac2d5f110338cdbf18cf0f020aa1724ed952a4df38fbb020002ba03d2f0e788` |
| nearby | 390×844 | `a5f0abc112b31ed06e4ae0658bc5a47e1a58a07a01a9d75a5b9befb7f4290cd3` |
| poi | 375×812 | `a8f02df76f4d1e5a468197002c3f4922bf60939fc1bcb6abf67186de6fddf1b5` |
| poi | 390×844 | `f216e3a0fc637ccea61589b5fec5a28b5996406ff53b10a0a4f557552d3027bb` |
| long-content | 375×812 | `35c15b0a51c9b2eb681a65ade86c8d9611e712df9700d2f87a82175c588c700c` |
| long-content | 390×844 | `50e0f1c5480397542f8f3229d1305affe46a451f7302c2dff65e73507c8710c3` |

## 微信开发者工具实现图元数据

待真实运行时采集后填写：微信开发者工具版本、基础库版本、操作系统、DPR、页面路由、Fixture 模式和生成提交。此处不预填或推断。

## 逐项视觉核对

待实现图采集后，按同一 viewport 核对以下项目：

- 构图
- 几何与间距
- 组件层级
- 字体、颜色与材质
- 图标素材
- 文案
- 状态语义

布局自动化测试通过不代表视觉通过；在两组 viewport 的真实微信小程序截图获得用户明确确认前，本视觉门禁保持未通过。
