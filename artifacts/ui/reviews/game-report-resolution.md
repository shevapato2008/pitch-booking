# C2f 结构化举报与平台处置 · 生产终审记录

## 当前结论

- 生产实现已复用冻结的浅色蓝灰设计系统和预览页面几何；小程序生产页已改接真实 `GET/POST`、持久 attempt 与结果恢复，平台页已改接真实管理员列表、详情与处置 API。
- 代码级自审未发现 Critical/Important：主按钮和弹层按钮均使用双轴布局居中；重复 radio、状态徽标与详情字段沿统一列线；返回箭头、关闭按钮与破坏性确认文案完整；长事实与 500 字计数可换行；小程序滚动区为固定底栏及 `safe-area-inset-bottom` 预留空间。
- 状态语义保持诚实：只显示驳回、成立记录、成立并取消球局三种结论；没有暗示处罚、封禁、信用、退款、自动审核或通知；用户投影不含内部处置说明、principal、用户 ID、手机号、OpenID、订单、支付或退款字段。

## 代表视口门禁

| 运行时 / 状态 | 目标 viewport | 状态 |
| --- | --- | --- |
| 平台 `pending-detail` | `1440 × 900` | `DELEGATED_VISUAL_PASS`：Critical 0 / Important 0，console 0 |
| 平台 `cancel-confirm` | `1440 × 900` | `DELEGATED_VISUAL_PASS`：Critical 0 / Important 0，console 0 |
| 小程序 `report-form` | iOS `390 × 844`、Android `411 × 731` | 独立真实运行时审核待完成 |
| 小程序 `resolved-cancelled` | iOS `390 × 844`、Android `411 × 731` | 独立真实运行时审核待完成 |

未参与 C2f 实现的 reviewer 已在真实浏览器运行时完成两个平台代表状态审核；小程序双端仍保持待验收。本记录不把静态代码检查、浏览器 Artifact 或历史截图冒充真实微信开发者工具/设备审核；用户手机验收仍是其后的独立门禁。

## 已自动证明的交互边界

- 小程序：返回、类别选择、事实输入/计数、提交、取消确认、确认提交、加载重试、登录重试、未知结果确认/原 key 重放均有行为测试；本人报名详情入口携带 `game_id`，公开分享访客不显示入口。
- 平台：筛选、刷新、分页、选择、退出、处置选择、取消确认、确认处置、Escape 与 dialog focus trap 均接真实 controller/API；仅 `PLATFORM_ADMIN` 可见且服务端再次鉴权。
- 生产包：举报生产 route/source/持久 attempt 注册必须存在，C2f Fixture marker、dev route、Fixture 文件与模拟文案必须缺席。

## 外部门禁

1. 未参与实现的独立 agent 在微信开发者工具完成小程序双端两个代表状态审核。
2. staging 执行 `0024`，准备举报者、平台管理员与非本人三类账号/数据。
3. 用户在 iOS 与 Android 验证滚动、安全区、唯一举报、平台三种结论、非本人不可读以及平台取消不改变订单/支付/退款。
4. 以上通过前不合并 `main`、不部署、不上传体验版，也不宣称 C2f 已完成用户验收。
