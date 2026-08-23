# 微信小程序体验版发布实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 按任务逐项执行；每个任务完成后记录结果。涉及上传、体验成员和版本切换的外部操作必须保留人工确认点。

**目标：** 2026-08-20 将“逐光约场”以体验版交付给合伙人，使用真实 staging API，但保持在线预订、支付和退款入口关闭。

**发布策略：** 从最新、已完成真机验收修复的集成提交构建生产包；只把审计后的生产包复制到隔离的微信开发者工具项目，不上传 development Fixture 包。体验版仅供已添加的体验成员访问，不提交正式审核、不公开发布。

**候选版本：** `feature/order-wave-integration`，固定提交 `40a1285e0c78df28fd1990940989c452fc187161`

**关键开关：** `MINIPROGRAM_PAYMENT_PROVIDER=disabled`，生成包中的 `ONLINE_BOOKING_ENABLED` 必须为 `false`。

---

## 与现有计划的关系

- 现有长期路线图保持原样，不在本次发布中修改：
  `/Users/fan/Repositories/startups/pitch-booking/docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`
- 本计划是一次独立的发布操作，不代表长期路线图中的支付、退款、备案、公开审核或后续功能已经完成。
- 本次不合并功能分支、不补新功能、不修改数据库、不启用微信支付。

## 今天不做的事情

- 不提交微信正式审核，不发布正式版。
- 不等待小程序备案完成；备案留给正式发布阶段。
- 不开通或配置真实 JSAPI 支付，不写入微信支付商户私钥/API v3 密钥。
- 不开放新下单、支付或退款按钮。
- 不把开发 Fixture、开发路由或本地测试数据上传到体验版。

---

### Task 1：冻结体验版源代码

**工作目录：**
`/Users/fan/Repositories/startups/pitch-booking/.worktrees/order-wave-integration`

**Step 1：确认分支和工作树**

Run:

```bash
git status --short --branch
git rev-parse HEAD
```

Expected:

- 分支为 `feature/order-wave-integration`。
- HEAD 为 `40a1285e0c78df28fd1990940989c452fc187161`。
- 工作树无未提交改动。

**Step 2：记录发布标识**

- 微信上传版本号：`0.1.0`
- 项目备注：`2026-08-20 合伙人体验版；staging 真实链路；在线预订与支付关闭；source 40a1285`

如果 HEAD 发生变化，停止执行并重新确认候选提交，不在脏工作树上上传。

---

### Task 2：最小发布前检查

**Step 1：确认现有 staging 构建输入可用但不输出秘密**

复用已存在、权限为 `0600` 的本地输入：

```text
/Users/fan/Repositories/startups/pitch-booking/.worktrees/iphone-live-acceptance/deploy/miniprogram.live.local
```

只检查文件存在、权限正确、包含以下键名；不得打印值：

- `MINIPROGRAM_API_BASE_URL`
- `MINIPROGRAM_TENCENT_MAP_KEY`

**Step 2：运行与本次发布直接相关的检查**

Run:

```bash
npm run typecheck
```

Expected: PASS。

不默认运行全仓测试；生产构建与生产包审计是本次体验版的主要门禁。

---

### Task 3：构建并审计支付关闭的生产包

**Step 1：从忽略的本地输入构建**

Run from the candidate worktree:

```bash
bash -c '
  set -a
  source "$1"
  set +a
  export MINIPROGRAM_PAYMENT_PROVIDER=disabled
  npm run build:miniprogram:production
' bash /Users/fan/Repositories/startups/pitch-booking/.worktrees/iphone-live-acceptance/deploy/miniprogram.live.local
```

Expected: 生成 `dist/miniprogram-production`。

**Step 2：确认支付开关确实关闭**

Run:

```bash
rg 'ONLINE_BOOKING_ENABLED.*false' dist/miniprogram-production/config/runtime.js
```

Expected: 命中生成配置中的 `false`。未命中则停止，禁止上传。

**Step 3：审计生产包隔离**

Run:

```bash
npm run audit:miniprogram-package
```

Expected: PASS，且无 Fixture、dev route、测试 token 或开发 bootstrap 泄漏。

**Step 4：生成隔离上传项目**

Run:

```bash
npm run prepare:miniprogram:live-preview
```

Expected: 生成 `dist/miniprogram-live-preview`，其中：

- `project.config.json` 的 AppID 是 `wxc6b988ca75ad753c`；
- `miniprogramRoot` 是 `miniprogram/`；
- 内容只来自已审计的 production package。

禁止从仓库根目录上传，因为根目录的 `project.config.json` 有意指向 development build。

---

### Task 4：在微信开发者工具上传代码

**Step 1：打开正确项目**

在微信开发者工具中导入：

```text
/Users/fan/Repositories/startups/pitch-booking/.worktrees/order-wave-integration/dist/miniprogram-live-preview
```

确认项目显示名称“逐光约场”，AppID 为 `wxc6b988ca75ad753c`。

**Step 2：代表性本地预览**

只检查一个代表性页面和控制台：

- 首页可打开；
- 控制台无启动错误；
- 可订时段显示“在线预订暂未开放”；
- 页面无可用“确认下单”或“立即支付”按钮。

**Step 3：上传**

点击开发者工具右上角“上传”，填写：

- 版本号：`0.1.0`
- 项目备注：`2026-08-20 合伙人体验版；staging 真实链路；在线预订与支付关闭；source 40a1285`

上传属于外部版本变更；提交前由用户确认一次。

---

### Task 5：设置体验版并添加合伙人

**Step 1：添加体验成员**

进入微信公众平台：

`管理 → 成员管理 → 体验成员`

按合伙人的微信号添加体验成员。若平台要求对方确认，等待确认后继续。

**Step 2：设为体验版**

进入：

`管理 → 版本管理 → 开发版本`

找到刚上传的 `0.1.0`，执行“选为体验版/设为体验版”。

**Step 3：获取体验二维码**

在体验版区域打开二维码，让已添加的体验成员扫码。二维码只在私下分享，不提交到 Git，也不公开上传。

---

### Task 6：合伙人体验验收

使用真实 iPhone 和体验成员微信完成以下最小旅程：

1. 打开“逐光约场”，首页和地图能够加载。
2. 查看场馆和可订时段；页面明确显示“在线预订暂未开放”，没有可用下单/支付动作。
3. 打开“我的订单”；空态或已有已过期订单状态与服务端一致，已过期订单没有支付按钮。
4. 打开“我的场馆”中的已授权场馆；场馆资料、配置场地、库存时段和今日订单入口可访问。
5. 未配置物理场地时，库存页显示“尚未配置物理场地，请先添加场地，再设置库存时段”，而不是通用加载失败。
6. 返回路径正常，页面无白屏、无持续 loading、无明显控制台错误。

验收失败时不启用支付、不提交正式审核；修复后上传新版本号 `0.1.1`，不要覆盖结果记录。

---

### Task 7：记录体验版结果

在本地创建但不提交敏感二维码：

```text
output/experience-release/2026-08-20/
```

记录：

- Git SHA；
- 微信版本号和上传时间；
- 体验成员是否成功加入；
- 六项验收结果；
- 已知限制：支付关闭、退款关闭、未正式审核、未公开发布；
- 如失败，记录阻塞和下一版本号。

最终完成标准：合伙人作为体验成员能够扫码打开 `0.1.0`，真实 staging 浏览链路可用，且所有新下单、支付、退款入口保持关闭。
