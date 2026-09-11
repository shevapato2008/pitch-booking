# 夜场追光：原生复核与 ENFILE 监测

日期：2026-09-10。开发者工具 RC 2.02.2608031，基础库 3.17.0。

实际工程：`/Users/fan/Repositories/startups/pitch-booking/dist/miniprogram-live-preview`，不是仓库根目录，也不是 `.worktrees/iphone-live-acceptance`。窗口中的 `iphone-live-acceptance-production` 只是工程名称。

## 文件资源观察

| 监测 | 上海时间 | 文件数范围 | 新日志 | ENFILE/EMFILE |
| --- | --- | --- | --- | --- |
| 启动与基础浏览 | 11:58:18–12:08:18 | 8,799–9,594 | 910,184 bytes | 0 |
| 重编译及后续复核 | 12:10:16–12:20:06 | 9,431–9,586 | 1,928,385 bytes | 0 |

系统上限 491,520。每 2 秒采样，两个观察区间都未发现新增日志中的 `.worktrees/` 路径。一次 lsof 快照显示 24 个 DevTools 进程共 697 个数字文件描述符，其中没有 `.worktrees` 路径。日志监测已结束，没有留下永久轮询任务。

原始指标：`enfile-monitor-1789012698310.jsonl`、`enfile-monitor-1789013416304.jsonl`。监测只从启动时文件偏移量向后读取，未把 9 月 8 日历史错误算作本次复现。不保证未来其他工程/工具组合不再触发，也未通过人为耗尽文件表做压力测试。

## 已人工查看的原生结果

以下 iPhone 12/13 (Pro) 截图采用 390×844 逻辑尺寸，实际 PNG 为 734×1588。圆角边缘偶有开发者工具背景透出，属于模拟器截图边框，并非页面内元素。

| 文件 | 本轮结论与边界 |
| --- | --- |
| `home-iphone.png` | 首页三入口、图标、文案、胶囊避让和底部区域可读；不是业务全部完成证明。 |
| `home-city-fixed-iphone.png` | 城市层禁用项保持深色且文字可读；开闭、点击禁用项不触发选择已检查。 |
| `discovery-live-iphone.png` | 真实接口 READY、0 场；空态/返回入口和我的报名入口正常。没有验证有数据的卡片。 |
| `registrations-live-iphone.png` | 真实账号 READY、无报名记录；刷新及去找球局按钮的布局正常，未进行报名写入。 |
| `venue-map-loaded-iphone.png` | 真实地图底图已加载，搜索/定位/我的订单/抽屉可见，2 个测试场馆。未主动申请定位权限。 |
| `venue-detail-live-iphone.png` | 场馆图片、设施、价格、文字层次和底部双按钮可读；从地图实际进入，再进入时段页。 |
| `availability-fixed-iphone.png` | 已结束时段保持深色、价格与状态两端分列；在线预订关闭提示仍在，无提交订单行为。 |
| `venue-access-final-iphone.png` | 两个真实授权测试场馆及对应库存入口；员工授权关闭提示保留。 |
| `venue-inventory-fixed-iphone.png` | 周条过去日期不再白底；三个只读时段的状态徽标与文字可读、底栏安全区正常。 |
| `venue-inventory-calendar-iphone.png` | 日历过去日期、当前选择、确认/关闭按钮布局正常；只打开后取消，没有保存库存。 |

`home.png` 为修复前 Nexus 5X 首页；`home-city.png`、`availability-live-iphone.png`、`venue-inventory-live-iphone.png` 保留修复前问题证据，不是通过版本。`venue-map-live-iphone.png` 捕获于底图未完成时，以 loaded 文件为准。`venue-access-live-iphone.png` 为加载中状态；`venue-access-settled-iphone.png` 实际仍是首页（自动化导航未完成），不作为场馆页证据。以表内文件作为本轮审核入口。

## 改动与验证

1. 城市弹层覆盖微信默认禁用浅色背景，保持禁用语义。
2. slot-grid 使用自定义组件允许的纯 class 组合保留各状态色；价格/状态由 text 容器改为 view，恢复 flex 分列。
3. 库存周条/日历禁用日期保持深色，只读时段不再以整体低透明度压暗正文及状态。

39 项聚焦 Jest、2 项既有 native-preview 检查、变更测试 lint、diff 检查通过。最后一次 production 构建、包审计（0 forbidden paths/tokens）与 live-preview 生成通过。未改业务 TS、后端、API 契约或配置开关，未提交真实业务写入、上传体验版或正式发布。

`ui-ux-pro-max` 用于本轮对比度、触控控件、状态辨识和安全区取舍；没有引入新设计系统、字体或动画库。

## 未完成项

真实公开球局当前为空，因此有数据的球局卡片、共享详情/报名层尚未完成本版原生验证，也未完成这些场景与 A 参考的并排/叠加对比。其余队长/场馆表单和 iOS/Android 真机交互仍按手动指南继续。此记录不代表 27 页全部验收通过。
# 证据存储说明

本目录的原生 PNG 截图和监测 JSONL 保留于当前机器，不随源码提交推送，避免将真实服务画面和本机运行记录传播到远端；下文截图引用用于本地人工验收。设计样板位于独立的 `artifacts/ui/style-samples/2026-09-08/`，只有虚构设计数据。

## 晚间续作补充（22:00）

上述未完成项为白天检查点。晚间已经补齐隔离 Fixture，并通过 CUA 人工检查其余队长、场馆和旧链接表单，27 页代表状态已覆盖；详细操作、未支持的预览写入和测试结果见 `docs/night-glow-progress.md`。新 hero、报名审核、旧报名表单、格式化申请时间以及最终 production 首页/真实列表也已复核。本阶段 CUA 截图在会话内，未保存独立 PNG；本地并排/叠加对比的适用范围见 `comparison-review.md`。

21:32:50–21:42:50、21:49:51–21:59:51 两轮 logs-only 监测均 301 次，新增日志分别 1,740 和 962,088 bytes，ENFILE/EMFILE、worktree 路径提及均 0；未读取系统文件总数。窗口暂时不可用和重建时的文件缓存错误不归因为 ENFILE。22:00:50–22:04:23 上传后半段补充监测共 108 次、11,912 bytes，文件表错误及 worktree 提及均 0，已正常停止，不涵盖上传最初几十秒。

0.2.1 已于 22:01 左右在官方界面显示“代码上传成功”；上传前与上传后只读复查均确认最近提交关联体验版。本轮源码尚未合并（.git 只读），版本号、备注与构建指纹见 `output/experience-release/2026-09-10/release-result.md`。
