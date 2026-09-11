# 夜场追光：恢复检查点

更新时间：2026-09-11。

## 当前状态

- 9 月 11 日 12:54 左右：组件一致性修正已上传 **0.2.3 体验版**，官方显示“代码上传成功”，再次打开上传入口确认最新提交仍已关联体验版，随后取消。三个模块同款小房子回目的首页，23 个二级页面共用返回样式并保留原处理函数；主次/危险/禁用按钮、关闭 X、选择项和徽标统一。搜索取消宽度、报名箭头间距、已选禁用状态、搜索面板被快捷入口遮挡一并修正。
- 本轮 32 套件 548 项聚焦 Jest、2 项一致性检查、typecheck、相关文件 lint、production 构建和两份包审计通过。微信原生 iPhone 390×844 检查三模块往返、我的报名返回、库存编辑层关闭/取消和代表按钮组、搜索取消与结果层级；不执行业务保存或交易。组件样式改用官方支持的 class 选择器，最终地图/导航未再出现本轮组件选择器警告；工具仍有既有灰度基础库、地图 free-data / null 属性提示和 LazyCodeLoading 未启用提示。
- 当前上传包：259 文件、1,569,272 bytes，production/live-preview 内容一致，SHA-256 `d24b814bb8c03ef0f63225287abc9bf0ed1b72a9b5c21f2577ff6c822950c35f`。后端、运行配置和业务开关保持上一体验版值；未正式提审/公开发布，未提交/合并/推送 Git。手机验收看 0.2.3 与新版指南。以下 0.2.2 等条目均为历史记录。
- 本轮两段 ENFILE logs-only 监测共 527 次、3,329,687 bytes 新日志，ENFILE/EMFILE 与 worktree 提及均 0，已停止；详情见 release-result。系统文件总数未采样。
- 9 月 11 日 07:42 左右重试成功：CUA 恢复隔离项目窗口，原生首页正常；官方界面显示 0.2.2“代码上传成功”。上传前确认覆盖体验版，上传后重新打开入口仍提示最新提交已选为体验版，随后取消，未重复上传。两份包审计复核通过、候选指纹仍为 98f21cf0。支付/通知/员工授权及后端不变；未正式发布，源码未提交/合并/推送。手机当前测试版本更新为 0.2.2，指南与 release-result 已同步。
- 本次重试日志监测 07:38:18–07:42:26：125 次、387682 bytes 新日志，ENFILE/EMFILE 和 worktree 提及均 0，已停止；未采样系统文件总数。启动控制台有工具侧 simulator launch failed，但随后正常渲染，未阻止上传。以下首次失败和此前交付均为历史记录，以本节这两条最新状态为准。
- 9 月 11 日 02:31 起续作：用户确认继续，准备上传前端修复候选 0.2.2，仍保持支付/通知/员工授权关闭。两份包审计通过，3 组 58 项关键测试复跑通过，production 与 live-preview 指纹同为 98f21cf0（完整记录见 release-result）。CUA 打开隔离项目后 noWindowsAvailable/cgWindowNotFound，重连和会话重置仍失败；应用清单显示运行，但无法取得项目窗口。本轮未执行上传提交，体验版仍 0.2.1；需本机恢复项目窗口后继续，不重复实现已完成的修复。
- 9 月 11 日只读状态修复候选（尚未上传）：用户手机反馈绿色“可订”不可点。当前体验包 `ONLINE_BOOKING_ENABLED=false`，本地部署配置的支付 provider 也为 disabled；8 月 19 日提交 85fb00e 已存在对应预订拦截，不是本次主题改造删掉点击或支付逻辑。与改版前 7154368 比较，backend/contracts/deploy/build 脚本/services/domain/runtime 无差异；没有核验远端服务当前进程配置，不把本地配置冒充远端事实。
- 本轮仅展示修复：时段页改名“场地时段”，关闭预订时 AVAILABLE 显示暗色“空闲 · 只读”，提示不能选择或下单；地图卡片读取现有发布开关，关闭时显示“时段仅展示”，筛选和浏览入口用中性文案；库存固定时间移除下拉箭头、说明时间不可修改，写入冻结时不再提示可编辑。库存卡片的普通 `role` 改为微信支持的 `aria-role` 并补齐读屏标签，原生辅助点击可打开原有编辑层。所有下单、支付、库存编辑判断及后端逻辑、开关保持不变。
- 原生复核（iPhone 390×844，隔离 production 预览）：首页→地图→详情→时段，9 月 12 日空闲/已订/未开放、日期切换、只读点击不进入确认页；库存可编辑项打开编辑层并取消，已售出项仍不能编辑。检查了文本/价格/状态、同组对齐、按钮居中、箭头、固定底栏和安全区；未进行任何真实交易或保存库存。截图仅保留于 CUA 会话，没有新增截图导出链路。11 套件 178 项聚焦回归、类型检查、变更文件 lint 和 production 构建/包审计已通过；最终重建后再次复核这些结果。
- ENFILE logs-only 监测 01:45:41–01:55:41，共 301 次、376155 bytes 新日志，ENFILE/EMFILE 和 worktree 提及均 0；系统文件总数未采样。后续编辑层检查不计入此监测区间。原生检查结束后关闭项目，清理临时函数监测；清理时自动输入曾触发一条控制台语法错误，属于诊断输入而非产品异常。体验版仍是上一轮 0.2.1；本轮未上传、未合并/提交、未正式发布。
- 22:06 最新交付：`0.2.1` 已通过官方界面上传成功；上传后再次打开上传入口，仍提示最新提交已关联体验版，随即取消，未重复上传。27 页新版主题和代表性原生检查已覆盖，已交付手机验收候选，不等于全状态/线上写入/真机 E2E 全部验收。8 套件 140 项 Jest、1 项结构检查、变更文件 lint、development/production 构建、包审计及 diff 检查通过；最后 production 首页→真实球局空态导航已复核。当前分支未提交（.git 只读），备注如实标明基线 6ac4470 + 本地前端改动（待合并）、包指纹 26b0158c。不能说本轮已合并 main；后续源码归档需要允许 .git 写入的会话。
- 当前用户交付入口：`output/experience-release/2026-09-10/release-result.md` 的 0.2.2 节与 `docs/acceptance/night-glow-manual-test.md`。前端代表状态已完成，真实授权/媒体/键盘/设备差异与测试数据写入由用户手机验收；没有正式审核或公开发布。后文均为按时间累积的历史恢复记录，以本节最新状态为准。
- 持续目标已按“前端实现、必要原生检查与手机体验候选交付”标记 complete；累计执行约 1 小时 53 分钟。没有仍运行的监测或构建任务。该阶段完成不等同于本轮源码已合并或所有手机真实业务已验收。
- 21:35 续作：用户要求全部完成后再上传。当前分支 `feature/night-glow-detail-preview`（基于 main 6ac4470），没有新增 worktree；持续目标最新为 active。当前终端 workspace-write、网络受限且 .git 只读，未提交/合并/上传本轮改动。原生 CUA 已完成下文多数剩余页面，21:33 起报 noWindowsAvailable/cgWindowNotFound；应用清单仍显示运行，不能据此断言 ENFILE 复发。继续能独立完成的源码/对比/验证工作，尚未完成目标。
- 用户已选 A，授权自主继续前端开发，明早手动验收。
- 本轮源分支 `feature/night-glow-ui`，起点 7154368，已合入 main；当前 HEAD 为 6ac4470。用户已授权上传手机测试候选，结果见本文末尾。整体前端验收仍未完成。9 月 10 日 19 时用户再次提高权限后，CUA 原生操作、sysctl 文件数读取和 .git 可写访问检查成功；没有执行 Git 写操作来验证提交/推送。持续目标最新查询为 paused，本轮按用户重试要求继续检查，未擅自改成 complete 或 blocked。
- 已迁移 27 个生产页面/11 个组件、全局样式和原生导航配色；已新增共享球场光影模板、短动效，首页/找球局/详情 WXML 已接入。
- 独立 WXSS 检查已修正 19 个文件的 CTA 前景、照片徽标、危险/禁用语义及按钮双轴居中；无业务 TS 或后端改动。
- 参考样板：`artifacts/ui/style-samples/2026-09-08/`。原生工程 `native/`，对比页 `review-board.html`。
- 计划：`docs/superpowers/plans/2026-09-08-night-glow-ui.md`。
- 首页/找球局/详情 CSS 精修已写入；此前 typecheck 和 development build 通过。首页、找球局/报名空态、地图、场馆详情、时段、场馆入口及库存代表状态已有原生证据；不能据此宣称所有页面或业务状态已验收。
- 上一轮全量 Node 测试 653 通过/183 失败，随后系统明确报 `Too many open files in system (os error 23)`，失败原因尚未逐项定位。CUA 启动失败，9432 自动化连接超时。恢复时改为聚焦串行检查，不再并发全量构建。
- 当前终端已恢复；`/private/tmp/pitch-night-preview.cjs` 临时脚本已不存在，不能假设旧自动化会话仍在。
- 恢复后聚焦测试已完成：前端 30 套件/524 项通过；typecheck、变更文件 lint、`git diff --check` 通过。6 个旧主题断言已同步；未删行为测试。全仓 lint 因范围过大主动终止，改为变更文件 lint，不宣称全仓 lint 通过。
- 新 production build + package audit 通过（0 forbidden paths/tokens），已生成 `dist/miniprogram-live-preview`；新包含夜场模板，支付/通知/员工授权仍关闭。0.2.0 开发版本已于 9 月 10 日上传成功，体验版选择尚未确认。
- 手动指南已完成：`docs/acceptance/night-glow-manual-test.md`。内容标明未验收/未发布，覆盖三个目的、地图、报名、队长、场馆工作台及真实数据操作边界。
- 9 月 10 日白天的原生复核及上传监测未复现 ENFILE/EMFILE；晚间 sysctl 曾被权限拒绝，19 时重试已恢复，并完成新一轮 10 分钟监测，未复现。继续仅打开独立 dist 工程，不打开仓库根目录。
- `0.2.0` 上传已完成。当前推进找球局 → 详情/报名 → 我的报名的有数据视觉验收；之后处理其他队长/场馆表单及 A 参考同尺寸对比。不得在线创建假数据来填满页面。

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
- 实际结果：`e1b21f0` 已快进合入 main 并推送 origin/main；合并后 225 项聚焦测试及 production build/audit 再次通过。iPhone 390×844 原生首页再次人工复核。14:10:52 +08:00 官方 CLI 确认 `0.2.0` 上传成功，包大小 1,244,227 bytes；体验版切换仍需用户在平台确认，未提交审核/公开发布。
- 上传期间另监测约 2 分 58 秒，90 次采样，新 ENFILE/EMFILE 为 0，峰值 10,332 / 491,520；监测已停止。详细交付与手机打开步骤：`output/experience-release/2026-09-10/release-result.md`。

## 2026-09-10 晚间续作：隔离原生验收入口

- 上一轮梳理获得了影响下一步的证据：当前共享详情的 onApply 直接打开资料弹层，生产代码仅在 app.json 注册独立 player-game-application 路由，没有发现跳转引用。该旧页不删除、不重复优先设计；优先补当前资料弹层。
- 官方 SDK connect 到原有 9432 失败；当前终端网络受限，不反复重启自动化。CUA 仍能正常读取和操作原生开发者工具，使用这一已获准入口继续。
- `MINIPROGRAM_DEV_BOOKING_SOURCE=fixture npm run build:miniprogram:development` 已通过。本轮仅重建 development，不改 production/live-preview，不写业务数据；不重新上传。
- 已导入 `dist/miniprogram-development`，工程名 `night-glow-native-fixture-DO-NOT-UPLOAD`，不使用云服务；已关闭此前只读 production 窗口，避免同时运行多个工程。导入后曾停在首次“信任并运行”，当时未点击并请求用户确认；19 时新观测中提示已消失，工程已运行，不能再将此提示当作当前阻塞。
- 项目配置模板：`artifacts/ui/night-glow/2026-09-10/fixture-project.config.json`。development 重建会清掉生成目录的配置；需要时把此模板复制至 `dist/miniprogram-development/project.config.json` 再导入，不能将该 Fixture 工程上传。
- A1 编译条件打开生产 `pages/game-discovery/index`，复用现有开发目录数据源；其卡片详情链接仍指向旧 dev 示例详情，只用于验证新版生产列表，不把点击后的旧页作为新版详情证据。
- A2/A3/A4 复用 `dev/pages/c2b-production-composition/index`，查询分别为 `scenario=WAITLISTED_FIRST&target=LIST`、`scenario=WAITLISTED_FIRST&target=DETAIL`、`scenario=FULL_REVIEW&target=CAPTAIN`；通过既有 Fixture 数据源打开实际生产报名列表/共享详情/审核页。数据日期固定在 2026-09-05/06，仅供可重复布局核对，不代表当前真实供给。
- 既有 C2b Fixture 缺少 getPublicProfile/savePublicProfile 等当前资料弹层能力，且申请动作不可用；不可把候补详情检查当作当前报名资料层已验证。后续应最小扩展隔离预览适配，不改生产接口或向线上造数据。
- sysctl 监测脚本本次启动即因权限退出（日志 `enfile-monitor-1789037249650.jsonl` 只有启动记录，不能作成功监测证据）。改为对既有 60 个应用日志建立偏移基线并检查新增内容；18:48:02–18:49:42 读取 26,914 bytes，新增文件表错误为 0，系统文件数未知。
- 此阶段 .git 曾只读，未创建分支、提交或推送。产品源码/后端/契约没有改动；仅增加本地预览配置与恢复记录。19 时重试结果见下节；后续产品实现仍需先建立续作分支。
- 本轮聚焦检查完成：现有 C2b 生产组合数据源/入口 2 套件 11 项 Jest 通过；现存 production 包 audit 仍为 0 forbidden paths/tokens。4 个编译条件所需路由均包含在 development 构建中；配置 JSON 与 diff 检查通过。这些检查不替代首次运行后的人工视觉审核。

## 2026-09-10 19 时提权重试：原生操作与监测恢复

- 本轮 CUA 确认隔离工程已运行，并在 iPhone 12/13 (Pro) 模拟器直接操作实际生产页面；未重开根工程、未新建 worktree、未修改后端或业务源码、未重新构建/上传。
- 找球局：3 张 Fixture 卡片正常渲染，“仅看有名额”由 3 场变成 2 场；日期筛选、名额徽标、箭头及卡片文字未见明显裁切/错位。人制选择器能够打开，为微信原生浅色选择器；本轮没有完成选项确认，不能记为整条筛选旅程通过。
- 我的报名：原生菜单没有列出模板里的 4 个编译条件，于开发者工具“添加编译模式”建立了 A2，实际保存于生成目录的 project.private.config.json。启动页为 dev/pages/c2b-production-composition/index，参数 scenario=WAITLISTED_FIRST&target=LIST；运行后两张候补/已加入卡片的标签、箭头、层级已人工检查。点击候补卡片进入生产 pages/captain-game-public/index，不是旧 dev 详情。
- 共享详情：检查了既有候补状态与底栏；“退出候补”打开确认层，点击“继续候补”关闭且候补状态保留。确认层双按钮居中、边界和底部安全区未见明显问题；没有提交退出。
- 验收数据缺口：旧 C2b source 没有提供 joinedCount/waitlistCount/joinedMembers/waitlistedMembers，生产兼容回退显示“正式 4 人但名单为空”“本人候补第 1 位但候补 0 人”。不能将该状态交付为新版详情通过；下一步先最小补齐隔离 Fixture 的一致名单和资料弹层能力，再做新版详情/报名核对，不修改生产权威人数或后端来迎合模拟数据。
- 以上只做了真实运行时人工观察，没有保存新的独立模拟器 PNG，也没有完成同尺寸参考并排/叠加对比；A4 审核页和当前资料弹层仍待检查。最后调试器显示 Errors 0、Warnings 6，包含基础库灰度、预加载、热重载和 worker 不支持警告，不宣称控制台无警告。
- 19:01:56–19:11:56（上海）监测 301 次，系统文件数 18,024–18,274 / 491,520，读取 108,458 bytes 新日志，ENFILE/EMFILE、.worktrees 路径提及、监测错误均为 0。原始记录 enfile-monitor-1789038116024.jsonl；已正常到期停止，不是持续后台监控，也不证明历史故障永久修复。

## 2026-09-10 21 时续作：详情名单与报名资料

- 隔离 C2b source 已补公开名单/计数、固定名额与公开名额的一致性、临时公开资料读写及头像本地路径映射；修改昵称会更新本人在两场球局的名单，reset 清空修改。没有网络上传或生产数据写入。
- 新增开发场景 SIGNUP_FULL：通过原有 composition 的 target=DETAIL 打开真实生产详情，无本人报名；勾选后提交会进入既有内存候补队列，并返回真实的 Fixture 排位，而非 Toast 假成功。原有 C2b 场景和旧 apply 不改为默认可报名。A5 参数见本地配置模板。删除条件：完成对应真实后端/手机验收后移除本轮临时预览扩展；所有 dev 文件仍禁止进入 production 包。
- 先观察新增数据检查失败，再实现；2 套件 17 项通过。原生观察到未勾选时提交按钮被微信默认灰底覆盖，新增一条现有页面样式回归检查后最小修正其禁用背景/前景/边框；随后 3 套件 102 项通过，变更文件 lint 通过。仅生产 WXSS 一条规则变化，生产业务 TS/WXML、后端和契约均未改。
- development 构建通过（含小程序 TypeScript 校验），保留/恢复生成目录两份项目配置。后续单条 WXSS 更新直接复制到开发生成目录用于热重载；最终上传前仍需重新 production build/audit，不能上传当前 Fixture 包。
- CUA 两次连接超时（第二次 20 秒后内核重置）；不继续重试。已通过官方 miniprogram-automator 启动同一独立 dist 工程，端口 9432，随后 connect 成功。SDK 临时兼容 RC 空版本的进程级 checkVersion 跳过与此前相同，不改 SDK 文件。不能将 CUA 超时记成 ENFILE。
- 原生 iPhone 390×844 已人工核对：4 人正式名单、2 人候补名单/第 1 位；资料弹层；修改昵称并保存回名单；新报名确认层未勾选禁用、勾选后启用、提交后候补从 1 人变 2 人且本人第 2 位。按钮双轴居中、重复头像/徽标对齐、边界及安全区已检查。头像本机选择/真实上传仍留待手机验收；不把隔离动作宣称成线上 E2E。
- 新证据均在 artifacts/ui/night-glow/2026-09-10/：detail-fixture-roster-top.png、detail-fixture-profile.png、detail-fixture-rosters.png、detail-fixture-signup-disabled-fixed.png、detail-fixture-signup-ready.png、detail-fixture-signup-result.png。detail-fixture-signup-unchecked.png 为修复前灰底，不是通过版；detail-fixture-reconnected.png 实际是报名列表，不能当作详情截图。尚未完成 A 参考的同 viewport 并排/叠加。
- 20:54:33–21:04:33 监测 301 次，文件数 17,849–20,144 / 491,520，新增日志 2,335,864 bytes；ENFILE/EMFILE 与 .worktrees 日志提及均 0。监测 enfile-monitor-1789044873312.jsonl 已正常到期停止。
- 当前仍需：其他队长/场馆/订单页面代表场景，首页/列表/详情 A 对比，最终聚焦验证、真实后端 production 构建/审计/原生复核及上传。两个只读子任务正在梳理剩余已有预览源，不操作共享原生工具。

## 2026-09-10 21:15–21:35：剩余页面真实运行时检查

- CUA 已恢复，并继续使用原有单一 development 工程。官方 SDK 连接仍被当前受限终端阻止；没有重启根工程或新建 worktree。截图为 CUA 会话内真实原生窗口，逻辑设备仍为 iPhone 390×844，均先人工检查再记录；本段未导出单独模拟器 PNG。
- 新增 dev/night-glow-captain-sources、dev/night-glow-venue-sources 和 dev/pages/night-glow-production-preview。真实生产页面复用现有控制器，名单/出勤/举报和场馆内容只从内存读；预览菜单明确标注开发数据，attempt store 使用内存。未支持的媒体、退款、员工授权等写入明确拒绝，不冒充线上成功。完成对应手机真实验收后可删除该临时入口及这两组 source/test；production 构建必须排除整个 dev 目录。
- 新源测试：队长 6 项、场馆 5 项、入口 3 项通过；各文件 lint 通过。一次 development 构建通过；构建清空生成项目配置后，已恢复本目录 fixture-project.config.json 模板，现有 A1–A6/B 编译模式可直接从原生菜单选择。之后新增 APPLICATIONS/LEGACY_APPLICATION 两个菜单项和日期显示修正尚待下一次构建。
- 原生已复核：预订确认禁用底栏；创建球局长表单→保存本地草稿→管理页→发布确认→本地招募中；成员卡片/移除确认及取消；出勤 2/3→确认到场→3/3；举报表单及必填提示；场馆资料图片/设施，9→10 项选择→本地保存；履约三种状态及签到原生确认框取消；球场配置列表与编辑层；库存可售/已订/停售及价格编辑层；入驻邀请→本地接受→认领材料表单；新建场馆字段/本地 POI 回填/四组材料；申请退回；员工列表/编辑权限表单；员工邀请说明。没有真实下单、退款、授予员工权限、上传材料或向线上写示例数据。
- 修复：order-submit-bar 使用纯 class 组合提高禁用规则优先级，先失败后通过既有结构检查，原生底栏确认变为暗色。成员移除确认再次暴露微信默认浅灰禁用背景；共享 night-glow.wxss 增加匹配原生优先级的暗色禁用规则，先失败后通过，成员确认层原生复核通过。公共详情/成员 2 套件 95 项通过（传入 home 路径不存在，不能记成 3 套件）。
- 申请退回时间原本直出 ISO，现最小复用既有上海时间格式为“9月10日 周四 14:30”，仅展示标签；venue-create 9 项测试/lint 通过，原生新标签待复核。
- logs-only 监测 21:18:12–21:28:12：301 次、新日志 3,722,178 bytes，ENFILE/EMFILE 与 .worktrees 提及 0。系统文件总数未知（不把未采样 max=0 当作系统文件数）。21:32:50 启动第二轮有界日志监测 enfile-monitor-1789047170248.jsonl，结果待到期读取。
- 已使用既有 create_visual_review.py 生成并人工查看同尺寸参考/实现并排、50% 叠加和差异文件（734×1588、同一逻辑 390×844）：detail-before-alignment、signup-comparison、discovery-empty-comparison。详情对比暴露 A 样板的大时间数字/环形背景尚未落实，正在补齐 hero 展示；不能将 before-alignment 标记为最终视觉通过。报名层保留真实昵称/确认项及双按钮，不照搬样板假报名按钮。列表当前对比使用真实空态，只覆盖 hero/筛选/层级，不能替代有数据卡片截图对比；有数据列表已有先前 CUA 人工观察。
- 下一步：完成详情 hero 的原生复核及新对比、审核页/旧链接表单代表检查、格式化时间复核；最终聚焦测试和 production build/audit/live-preview。当前所有页的基础新主题已实现，但这些待验收项未完成，尚不能上传或宣称全部完成。

## 2026-09-10 21:49–22:06：代表验收收口与体验版更新

- 新 development 构建完成后，原生曾报 venue-access/index.wxml 缺失；终端确认文件存在。仅通过官方菜单重新打开同一隔离项目后恢复，不改业务文件、不扫描仓库根目录。该瞬时编译缓存/窗口问题不当作 ENFILE。随后每次切换场景正常，最后调试器 Errors 0；基础库灰度、预加载、worker/热重载等警告保留，不伪称零警告。
- 新详情显示 18:00/20:00、大时间数字、日期/组织者、右侧静态环线与海蓝→青绿渐变；时间仍来自既有格式化权威数据，未改报名/人数/AA/底栏动作。iPhone 390×844 人工复核了内容、边界、徽标、按钮居中和底部安全区。
- 原生追加检查：报名审核满员卡片→加入候补确认→本地处理→最新列表为空；旧链接报名表单的各位置按钮、年龄/风险勾选及禁用提交；退回申请显示“9月10日 周四 14:30”。没有真实申请/权限/举报等线上写入。新 CUA 图保留在会话内，未额外导出独立 PNG；本目录已有并排/叠加的旧 hero 图明确为 before，不冒充当前图。遵循局部修正一个代表预览的轻量验证，不追加全页重拍。
- 验证：8 套件 140 项 Jest、1 项既有结构检查、全部本轮 TS/test 的聚焦 lint、development 与 production 构建通过。生产包审计 0 forbidden paths/tokens，27 路由且 dev 路由 0，三个敏感功能开关均保持关闭。导入 `dist/miniprogram-live-preview` 前先关闭 development 项目；production 首页及真实 0 场公开球局导航正常。
- 21:32:50–21:42:50、21:49:51–21:59:51 的 logs-only 监测均 301 次，新增日志分别 1,740/962,088 bytes，ENFILE/EMFILE/worktree 提及 0。上传后半段 22:00:50–22:04:23 共 108 次、11,912 bytes，新文件表错误和 worktree 提及仍 0，监测已停止。系统文件总数未采样，不把日志 summary 的 max=0 当作文件数，也不宣称覆盖上传最初几十秒。
- 官方上传弹窗指出上次提交已选为体验版，会覆盖体验版；按用户授权上传 0.2.1，22:01 左右显示代码上传成功，随后只读复查体验关联并取消再次上传。当前前端实现及手机体验候选交付完成，未正式发布。
- 后续不混淆：本轮 .git 只读，源码改动仍在 `feature/night-glow-detail-preview` 的工作区，未提交/合并/推送。上传备注明确该事实，构建指纹记录于 release-result。用户未跟踪资料、截图/日志和清理备份均保留，不上传 Git；没有新建 worktree。
