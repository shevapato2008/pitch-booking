# 逐光约场 · 三款前端设计样板

状态：用户于 2026-09-08 明确选择 **A 夜场追光**，随后授权夜间自主推进后续前端设计与实现。B/C 留作探索记录。此目录仍仅为设计参考，不能上传为生产体验版。

打开 `review-board.html` 并排比较。交互预览：用微信开发者工具导入本目录下的 `native/`，入口 `pages/sample/index`。底部 A/B/C 可即时切换；列表卡片可打开对应详情，详情底部可打开报名面板。

| 样板 | 视觉方向 | 设计重点 |
| --- | --- | --- |
| A 夜场追光 | 深海蓝 `#0B1727`、荧光青柠 `#CEFF80` | 聚光球场、深色层次、大号开场时间、短促入场 |
| B 晴空竞技 | 冰川白 `#F2F6FC`、电光蓝 `#2563EB` | 明亮层次、非对称大圆角、轻阴影、清晰的信息卡片 |
| C 复古球票 | 奶油白 `#F5F0E5`、朱砂橙 `#B9472B` | 球票票根、虚线齿孔、衬线数字、俱乐部式排版 |

三套用同一组示例球局，覆盖列表、日期筛选、有名额筛选、真实空态、详情、成员、费用说明和报名确认面板。场馆、成员、费用均为设计数据，不代表真实供给。报名面板只演示布局和开闭；说明清楚且不提交任何操作。

## 实现范围

- 纯 WXML/WXSS/JavaScript，使用当前 WebView 渲染器。
- 系统中文字体；数字使用设备已有字体及回退字体，不下载字体或使用未授权字体素材。
- 渐变、阴影、几何球场；入场 300ms、卡片按压 160ms、弹层 260ms，使用 `transform` / `opacity`。
- 原生微信胶囊保留，导航按 `getWindowInfo` 和 `getMenuButtonBoundingClientRect` 避让；底栏预留安全区。
- 提供“动效开/关”，同时给支持的渲染环境提供 `prefers-reduced-motion` 回退；无持续装饰动画和逐帧 `setData`。
- 不引入 Skyline、Worklet、外部动画库、网络图片、网络字体或后台定时器。
- 所有内容均在 `artifacts/ui/style-samples/2026-09-08/`。正式 `miniprogram/`、后端、契约、构建和发布配置未改动；生产构建从 `miniprogram/` 取源，不含这些样板。

## 预览检查

微信开发者工具 RC 2.02.2608031，基础库 3.17.0，iPhone 12/13 (Pro) 模拟器，逻辑尺寸 390 × 844。截图像素尺寸由开发者工具截图接口和模拟器缩放决定，三套使用同一设置。

核对列表和详情中的按钮水平/垂直居中、卡片与徽标对齐、文字与图标完整性、胶囊避让和底栏安全区。交互检查包括三套样板切换、日期筛选、有名额筛选、空态恢复、卡片详情一致性、返回、弹层开闭和动效开关。此轮是设计样板检查，不代表 iOS/Android 真机兼容性验收。

`ui-ux-pro-max` 用于约束字体层级、触控尺寸、短动效和对比度；按现有足球产品取舍数据库建议，未机械引入网页字体、GSAP 或营销模块。

官方文档依据：[动画](https://developers.weixin.qq.com/miniprogram/dev/framework/view/animation)、[窗口信息](https://developers.weixin.qq.com/miniprogram/dev/api/base/system/wx.getWindowInfo.html)、[胶囊布局](https://developers.weixin.qq.com/miniprogram/dev/api/ui/menu/wx.getMenuButtonBoundingClientRect.html)、[页面配置](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/page)。

## 风格确定后

选定样板后，再设计其他页面并逐页接回已有前端业务逻辑；不要求修改后端。样板目录保持设计参考身份，任何示例业务数据都不迁入生产代码。最终实现按选定风格做同尺寸参考/实现对比。
