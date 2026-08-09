# 可扩展地图场馆目录视觉证据

状态：视觉已确认（2026-08-09）；真实行政区字段/腾讯 POI 代码集成及临时预览删除已完成（2026-08-10）。真实腾讯真机验收仍受外部配置阻塞。

## 2026-08-10 集成状态

- 地图筛选和行政区选项已直接读取解码后的 `districtCode` / `districtName`，不再依赖预览元数据 sidecar。
- Fixture 开发目录已回落到 checked-in `venue-map` 契约中的 5 家规范场馆；100 家临时生成器、预览 POI 源和预览元数据注册表均已删除。
- development-HTTP 继续注册真实腾讯 POI adapter；Fixture development 不注册伪造 POI 结果，保持无 key 的 unavailable 能力。
- 2026-08-10 已用一次性 PostgreSQL 17 将真实 API 迁移至 `0007`：接口按顺序返回 5 家场馆、唯一一家 `ONLINE`，且每项均带审核后的行政区字段；development-HTTP 构建成功。
- 本次未生成新的原生截图：微信开发者工具在渲染前出现内部 `path` / `MaxCodeSize` 编译错误，补齐忽略的本机私有配置后，官方 automator 仍在限定时间内无法连接。该环境阻塞不会被写成视觉或设备验收通过。
- 下方使用 100 家临时 Fixture 与预览 POI 的截图和哈希是已确认视觉基线的**历史证据**，不是当前运行数据或真实腾讯真机验收证据。
- 尚无真实受限腾讯 key、请求域名和微信隐私配置可用于本次提交的物理设备验收，因此不得将代码集成表述为真机验收完成。

## 用户确认与冻结边界

- 用户于 2026-08-09 确认继续开发，并明确当前前端无需重做；现有界面冻结为 Slice 0 视觉基线。
- `city`、`online-selected`、`directory-selected`、`long-content` 以最新 **390×753** 微信页面内容区证据冻结当前组件样式。
- `nearby`、`poi` 以既有 **375×812** 与 **390×844** 成对证据冻结搜索中心的构图和状态语义；它们采集于最新标记与卡片精修前，不据此回退现有组件样式。
- 本次确认不授权新布局、新控件或视觉改版。后续前端仅做真实字段读取、腾讯 POI 能力注册及临时 Fixture 删除所需的最小集成改动。
- 真实 API 行政区字段读取、腾讯 POI adapter 注册和临时 Fixture 删除已完成；开发者工具/物理设备上的真实腾讯验收仍待外部 key、域名和隐私配置就绪，不能由本视觉确认替代。

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

## 证据清单

| 状态 | viewport | 参考图 SHA-256 | 实现图 SHA-256 |
| --- | --- | --- | --- |
| city | 375×812 | `25556013bb9fcf670f67eecd0a18cc015dc107633333968e41c8d874cef936ee` | `387f86e1dac19eaeb0559a03fed17e6a9f1708506b26dbf8ec6e2965955a09e5` |
| city | 390×844 | `8458cb3488e7601b753daf8b8e63ee5586b3841442063225f5d90d280157afb1` | `9dfbac90b7e0a92daefeaa2be17c480298666855a15633c3308ce24f9a6d83a7` |
| nearby | 375×812 | `aac2d5f110338cdbf18cf0f020aa1724ed952a4df38fbb020002ba03d2f0e788` | `524326c16e00a8a7663f5436686e6e2c7582e3b1d47af30a9c5c29bc644739c1` |
| nearby | 390×844 | `a5f0abc112b31ed06e4ae0658bc5a47e1a58a07a01a9d75a5b9befb7f4290cd3` | `61da970a1adf17e783beb131f8ea7a7b4b978ab098d0782f5c3314b704e1ec5c` |
| poi | 375×812 | `a8f02df76f4d1e5a468197002c3f4922bf60939fc1bcb6abf67186de6fddf1b5` | `45034aaecc79273ab64e20385216767775b53976c247096cb51b630ca22a6378` |
| poi | 390×844 | `f216e3a0fc637ccea61589b5fec5a28b5996406ff53b10a0a4f557552d3027bb` | `efd7611b8e21db1a0aded5f57248ea19a32c0d432fe780b0a598c1d61e3594d0` |
| long-content | 375×812 | `35c15b0a51c9b2eb681a65ade86c8d9611e712df9700d2f87a82175c588c700c` | `374c3abbbef4b737b40860f9b7d13c6ce0e8dfe73891bc501a764e0fa9e221fc` |
| long-content | 390×844 | `50e0f1c5480397542f8f3229d1305affe46a451f7302c2dff65e73507c8710c3` | `d5e7cdb2279307f6484ea01a7a77166da85525292399f79c87d0edae93c58237` |

## 微信开发者工具实现图元数据

- 采集日期：2026-08-06（Asia/Shanghai）
- 微信开发者工具：Stable 2.01.2510290
- 基础库：3.17.0
- 操作系统：macOS 26.5.2（25F84）
- 页面路由：`pages/venue-map/index`
- 历史运行模式：development，当时使用 `DEV_ONLY_VENUE_MAP_PREVIEW_FIXTURE`（100 条）与 `DEV_ONLY_POI_SEARCH_PREVIEW`；两者现已删除
- 生成基线：`a6ea3abf3d288d07e2576b1f24f0dc84b214a844`
- 逻辑 viewport：375×812、390×844
- 开发者工具原始导出：固定 DPR 2（750×1624、780×1688）
- 对比归一化：仅按 50% 缩放到对应逻辑 viewport；无裁剪、无构图修改
- 状态驱动：全城、展开列表均通过页面按钮；附近态先走定位按钮，再用天津测试坐标替换开发者工具默认远端坐标；POI 态调用与点选“天津站”候选相同的 `onSearchPoiSelect` 处理器，以绕过自动化通道无法直接注入中文的问题
- PNG 总数：40（8 参考、8 实现、8 并排、8 半透明叠加、8 差异图）

## 逐项视觉核对

同一 viewport 核对结论：

- 构图：搜索工具、地图、中心说明、半屏/展开目录的纵向关系一致。
- 几何与间距：固定高度场馆卡片、筛选器、触控按钮和列表间距稳定；真实实现的信息密度略高。
- 组件层级：搜索层、地图层、场馆目录层和选中态层级一致。
- 字体、颜色与材质：蓝灰色视觉语言一致；真实腾讯地图瓦片比静态示意图更复杂。
- 图标素材：定位、搜索、中心点、场馆标记和右箭头语义一致；腾讯地图会按真实密度聚合标记。
- 文案：核心状态文案一致；实现使用 100 条开发 Fixture，因此数量与参考图的 58/116 条示意数不同。
- 状态语义：CITY、USER_LOCATION、POI 和长名称展开态均已在真实运行时呈现；仅展示平台收录场馆。

布局自动化测试通过不代表视觉通过；本次视觉门禁已由用户明确确认，后端阶段可按冻结边界启动。

## 2026-08-09 方案 A 精修复验（真实页面内容区）

- 微信开发者工具：Stable 2.01.2510290；基础库 3.17.1。
- 设备屏幕：390×844；开发者工具官方自动化截图只导出小程序页面内容区，因此实际对比 viewport 为 **390×753**。
- 实现图：官方 `miniprogram-automator` 截图原始 780×1506（DPR 2），仅按 50% 缩放；未裁剪、未重排。
- 参考图：已批准方案 A 的 390×844 参考图从顶部裁到同一 390×753 内容区；未缩放。
- 数据：development 的 100 家球场 Fixture。CITY 态使用微信地图原生数量聚合；选中态和第 100 家极限文案态均由真实页面方法驱动后截图。

| 状态 | 参考图 SHA-256 | 实现图 SHA-256 | 核对结论 |
| --- | --- | --- | --- |
| city | `91dab28d7038e4406b398a1d6b8304193e9cf7167fbd1498a847f270dccdd5f1` | `f8a64a0dc8a78f90a2560da0b4bd06d66bbb9cf2894ef9812aaba7b29ea26d60` | 搜索/定位同高，100 点形成数量聚合，列表三行固定 |
| online-selected | `f2d0883805a8da691da716377d27504d2af60d09bcecc2076351fc7079233e40` | `a84e4ac331ea4692ebef18acdf16b8a13a4e82ceac8771cdf6aaf00178bcd57d` | 蓝色在线标记与浅蓝选中卡语义一致 |
| directory-selected | `d7ae8644c30111c76780b549a75c7159055807ec4b9d40ec106a8d104801e16d` | `cccc5a349f6f24123ca304a483fc6ee869813849711bdd24c54a9862bdaf02e8` | 空心目录标记与目录卡选中语义一致 |
| long-content | `89a8633ca267912f2a5cf99f03a054ed9ed99c32263a83dc9ad7dac9b3cb9755` | `26bf35e260a47a262e2a3e905f4ec7dda0d09667d90ec4c71cc709de4e7e08c7` | 第 100 家长名称/地址保持固定 232rpx，不放大、不溢出 |

每个状态均生成 `reference`、`implementation`、`side-by-side`、`overlay-50`、`difference` 五类证据。视觉差异主要来自真实腾讯地图瓦片、100 家 Fixture 数量及原生聚合圆点；页面几何、组件层级、状态颜色、图标语义和三行卡片结构与方案 A 一致。
