# 夜场追光 A：0.2.0 手机测试候选交付

- 上传时间：2026-09-10 14:10:52 +08:00（官方 CLI 输出记录时间）。
- 微信版本号：`0.2.0`；AppID：`wxc6b988ca75ad753c`。
- 源提交：`e1b21f083c124532ec16c4915e876b454bb457a0`，已从 `feature/night-glow-ui` 快进合入 `main` 并推送 `origin/main`。
- 上传工程：`dist/miniprogram-live-preview`，`miniprogramRoot=miniprogram/`；来自本次重新构建并审计的 production 包，不是根工程的 development Fixture 包。
- 官方 CLI：退出码 0、`✔ upload`；代码包 1,244,227 bytes（工具显示 1.2 MB）。本地大小记录为 `dist/night-glow-upload-0.2.0.json`。
- 上传备注：`夜场追光A；27页主题适配；staging；预订/通知/员工授权关闭；main e1b21f0；手机验收候选`。
- 状态：**开发版本上传成功；是否已选为体验版尚未确认**。微信公众平台此前被站点访问策略阻止，未绕过该限制。
- 未提交正式审核，未公开发布，未部署后端或修改业务/权限逻辑。

## 手机打开前的最后一步

1. 用户登录微信公众平台，在“管理 → 版本管理”找到 `0.2.0`，核对备注中的 `main e1b21f0`。
2. 将该开发版本“选为体验版/设为体验版”；若界面已显示该版本为体验版，核对即可。没有平台读回证据前，不把上传成功当成体验版已切换。
3. 使用平台显示的体验版二维码，以已有体验权限的微信打开；确认首页是深蓝/青柠、“今天，为热爱上场。”。不要扫描设计样板或旧开发预览码。
4. 按 `docs/acceptance/night-glow-manual-test.md` 检查，先完成首页、地图、场馆详情、找球局和我的报名。写操作仅使用专用测试数据。

官方流程依据：[命令行上传](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli)、[小程序版本与发布](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release)。

## 范围与验证

- 27/27 生产页面与 11 个共享组件已统一基础主题；首页、找球局、共享详情 3 页进一步改造布局。其余 24 页以主题适配为主，不宣称全部重新设计完成。
- 8 个生产路由及代表弹层已完成原生检查；合并后另外复核 iPhone 390×844 首页，无明显裁切、遮挡或图标残缺。截图仅本机保留：`artifacts/ui/night-glow/2026-09-10/home-main-candidate-iphone.png`。
- 合并前后聚焦 9 套件 / 225 项 Jest 均通过；2 项原生结构检查、typecheck、变更测试 lint、diff 检查通过。独立有界代码审核没有 Critical/Important 问题。
- production 构建、package audit（0 forbidden paths/tokens）、隔离工程生成通过。不声称历史全仓 Node 回归全部通过。
- 本轮构建/核对/上传监测为 14:08:24–14:11:22，90 次采样，系统文件数峰值 10,332 / 491,520；读取约 491 KB 新日志，新增 ENFILE/EMFILE 和 worktree 路径提及均为 0。监测已停止；仅代表本轮未复现。

## 保留的边界

- API：既有 `https://pitch-api-staging.modelstella.com`。
- `ONLINE_BOOKING_ENABLED=false`；通知 provider 为 `disabled`；`VENUE_STAFF_AUTHORIZATION_ENABLED=false`。不因 UI 测试而开启。
- 有数据的球局卡片、共享详情、报名资料层及其他深度表单、真实 iOS/Android 兼容性仍待验证；当前真实公开球局列表为空，不注入线上假数据填充。
- 只合入本轮前端改造及 watcher 排除配置，没有合并其余历史 worktree。用户未跟踪资料、清理备份及本机运行截图/日志未上传 Git。
