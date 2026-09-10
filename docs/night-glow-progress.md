# 夜场追光：恢复检查点

更新时间：2026-09-10。

## 当前状态

- 用户已选 A，授权自主继续前端开发，明早手动验收。
- 本轮源分支 `feature/night-glow-ui`，起点 7154368。用户于 2026-09-10 授权将本轮前端改造合入 main 并上传手机测试候选；提交/上传结果见本文末尾的交付记录。权限已恢复，并已完成一轮代表页面原生检查；整体前端验收仍未完成。持续目标工具当前状态为 paused，不能把本轮进展写成目标已完成。
- 已迁移 27 个生产页面/11 个组件、全局样式和原生导航配色；已新增共享球场光影模板、短动效，首页/找球局/详情 WXML 已接入。
- 独立 WXSS 检查已修正 19 个文件的 CTA 前景、照片徽标、危险/禁用语义及按钮双轴居中；无业务 TS 或后端改动。
- 参考样板：`artifacts/ui/style-samples/2026-09-08/`。原生工程 `native/`，对比页 `review-board.html`。
- 计划：`docs/superpowers/plans/2026-09-08-night-glow-ui.md`。
- 首页/找球局/详情 CSS 精修已写入；此前 typecheck 和 development build 通过。首页、找球局/报名空态、地图、场馆详情、时段、场馆入口及库存代表状态已有原生证据；不能据此宣称所有页面或业务状态已验收。
- 上一轮全量 Node 测试 653 通过/183 失败，随后系统明确报 `Too many open files in system (os error 23)`，失败原因尚未逐项定位。CUA 启动失败，9432 自动化连接超时。恢复时改为聚焦串行检查，不再并发全量构建。
- 当前终端已恢复；`/private/tmp/pitch-night-preview.cjs` 临时脚本已不存在，不能假设旧自动化会话仍在。
- 恢复后聚焦测试已完成：前端 30 套件/524 项通过；typecheck、变更文件 lint、`git diff --check` 通过。6 个旧主题断言已同步；未删行为测试。全仓 lint 因范围过大主动终止，改为变更文件 lint，不宣称全仓 lint 通过。
- 新 production build + package audit 通过（0 forbidden paths/tokens），已生成 `dist/miniprogram-live-preview`；新包含夜场模板，支付/通知/员工授权仍关闭。没有上传。
- 手动指南已完成：`docs/acceptance/night-glow-manual-test.md`。内容标明未验收/未发布，覆盖三个目的、地图、报名、队长、场馆工作台及真实数据操作边界。
- 旧的权限阻塞已解除。2026-09-10 两轮累计约 19 分 50 秒监测未出现新增 ENFILE/EMFILE；仅打开 `dist/miniprogram-live-preview`，不再打开仓库根目录。
- 当前交付顺序按用户最新要求调整为：聚焦验证 → 合并本轮前端改造至 main → 上传手机测试候选。后续仍需补足有真实数据或隔离 Fixture 的球局卡片、共享详情/报名层，以及其他队长/场馆表单代表状态和 A 参考的同尺寸对比；不得在线创建假数据来填满页面。

## 必须保留的约束

后端、契约、支付/通知/员工授权开关不改。用户未跟踪文件 `output/imagegen/` 和 `scripts/save-live-venue-profile.py` 不归本任务修改。

## 已知环境

- 微信 CLI：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`。
- 原生样板自动化端口 9431；`miniprogram-automator` 可从 `/Users/fan/.npm/_npx/cf54c79a0524a233/node_modules/miniprogram-automator` 使用。
- DevTools RC 启动 SDK 可能读到空版本；若已启动则连接 9431，可仅跳过 SDK 自身 `checkVersion` 一次，不改项目或 SDK 文件。
- 样板对比页 HTTP 8767 的旧服务已主动停止，不要假设仍在运行。
- 实际 live 后端为 3010f04、迁移0029；与当前前端基线兼容。本地 deploy env 的 APP_REVISION 是旧值，不能据此断言线上旧版本。
- production 环境文件 `deploy/miniprogram.live.local` 已有，禁止打印凭证；live-preview 只能从 audited production 包生成。
- `mp.weixin.qq.com` 被 browser site-safety policy 阻止；不能绕过。设置体验版需用户在平台操作。

## 恢复顺序

1. 读取此文件和计划，检查当前分支及 dirty worktree。
2. 检查计划中已完成项的实际文件，保留前次成果和用户修改。
3. 接着完成首个未完成项；有 API/工具问题做一次合理修复或简单替代，继续可独立工作。
4. 每完成一个阶段更新此文件和计划。

## 用户调整权限后的复查

恢复运行已连续复查三轮：先遇到 `ENFILE / Too many open files in system`；最新一轮普通 `pwd` 已成功，但官方 SDK 仍返回 `listen EPERM: operation not permitted 0.0.0.0`，CUA 仍报 `Sky Computer Use native pipe startup failed`。当前实际会话配置仍为 workspace-write、网络受限、不可提权。原生验收仍未执行；不应把普通终端恢复等同于自动化权限恢复。重新标记目标 blocked，等待当前会话权限/原生控制服务实际恢复后续作；不重复构建或上传。

## 2026-09-09 恢复与动效修正

- 最新原生探测仍为 `listen EPERM`，未生成新截图。
- 源码检查发现共享 `.ng-enter` 的 `both` 最终帧会继续占用透明度/位移，压住卡片 hover-class；已改为 `backwards`，保留原时长与 reduced-motion 回退。
- 在既有首页测试中增加一条声明回归检查，确认先失败后通过；核心首页/发现/详情 3 套件 105 项通过，变更文件 lint 通过。此项不是原生视觉证据。
- 因本次实际样式修改，已重新构建 production、通过 package audit（0 forbidden paths/tokens）、刷新 live-preview，并确认新包包含 `backwards` 声明。
- 截图脚本现在打开隔离的 audited live-preview 工程，避免误用根目录 development Fixture 包。
- 下一步仍是恢复原生权限、检查页面及按压反馈。没有业务逻辑改动、提交或上传。
- 最新两轮 CUA 已明确返回 `Computer Use was not approved to use Wechat Devtools`；与官方 SDK 的本地监听 EPERM 一起构成原生验收阻塞。需要在产品中实际授予 computer-use 对微信开发者工具的访问权限，不能用终端权限变更代替，也不能绕过应用授权。连续三轮仍无法完成原生检查，目标再次 blocked，等待外部授权变化。

## 2026-09-10 worktree 清理后原生复核

- 已获用户确认并移除 31 个已被当前提交包含、无普通未提交改动的 linked worktree；剩余 18 个及主工作区保留，分支/提交未删除，本地配置已备份。`.worktrees/iphone-live-acceptance` 有独立提交/未跟踪文件，未删除。
- 开发者工具实际打开 `/Users/fan/Repositories/startups/pitch-booking/dist/miniprogram-live-preview`。窗口名 `iphone-live-acceptance-production` 只是工程名，并非打开旧 worktree。
- 11:58:18–12:08:18、12:10:16–12:20:06（上海）两轮监测共读取约 2.84 MB 新日志，新增 ENFILE/EMFILE 和 `.worktrees` 日志路径均为 0。系统文件数峰值 9,594，上限 491,520。一次进程快照为 24 个 DevTools 进程、697 个数字文件描述符，未见打开的 `.worktrees` 路径。这只能说明本次路径未复现，不证明历史问题只有一个原因或永久修复。
- 在 Nexus 5X 411×731 和 iPhone 12/13 Pro 390×844 的真实模拟器检查代表布局。真实服务返回 0 场公开球局、空报名记录、2 个已收录/授权测试场馆；未注入 Fixture，未提交业务写入。
- 修复 3 处原生禁用样式覆盖：城市层“其他城市”；时段卡片（并把价格/状态容器改为 view，使两端布局生效）；库存周条/日历过去日期。库存只读卡片不再以整体低透明度压暗文字和状态。没有修改业务 TS、后端或功能开关。
- 聚焦验证：39 项 Jest 测试、2 项既有 native-preview 检查通过；新增的首页/时段声明检查均观察到先失败再通过。变更测试 lint、diff 检查通过。最后一次 production 构建、package audit（0 forbidden paths/tokens）、live-preview 生成均通过。
- 原生截图已人工检查按钮对齐、状态标签、图标、胶囊避让与底部安全区；证据及边界见 `artifacts/ui/night-glow/2026-09-10/README.md`。仍未完成球局有数据状态/共享详情的新版视觉验收，也未上传体验版。
- 工具恢复注意：首次 SDK 冷启动在页面就绪前读取 currentPage 曾报 rawPath 元信息为空，页面实际加载后 connect 成功；后段 CUA 曾出现 cgWindowNotFound，官方 SDK 连接仍可完成原生截图。不要将这些单独的工具错误写成 ENFILE 或反复重开仓库根工程。

## 2026-09-10 合并与手机测试交付

- 合并范围仅为本轮夜场追光前端改造、相关测试/文档/隔离样板和已验证的根工程 watcher 忽略项。剩余 18 个历史 linked worktree 不在本轮合并范围；未跟踪的用户图片及资料脚本继续保留。
- `git fetch origin` 后确认 main 与 origin/main 均为 7154368；本轮未发现远端新增提交。
- 合并前重新运行：9 套件 225 项聚焦 Jest、2 项既有原生结构检查、typecheck、变更测试文件 lint 及 diff 检查全部通过。不声称全仓回归通过。
- 独立有界代码审核未发现 Critical/Important 问题；4 个改动 WXML 的业务绑定保持一致，无生产 TS/JS 或后端改动。审核通过仅代表可合并为手机测试候选，不代表逐页视觉验收完成。
- 计划微信版本 `0.2.0`，从合并后的 main 构建并审计，再通过官方 CLI 上传独立 production 工程。不提交审核、不公开发布。上传与体验版选择须分别记录实际结果。
