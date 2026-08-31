# C1a 散客申请与队长审核预览实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Follow superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before each completion claim.

**Goal:** 在不修改 B2、生产路由、后端和体验版的前提下，完成“分享详情 → 申请 → 队长接受/婉拒 → 申请人回同一详情看结果”的 375×812 development-only 可操作预览。

**Architecture:** 一份带明确标记的内存 Fixture store 是申请人页、申请表、队长审核页和场景启动器的唯一权威。HTML Artifact 与小程序页面复用同一套状态语义，但不共享生产代码。development build 自动发现新增 dev 页面；slice-local route fragment 只供聚焦测试和后续 root 集成，不编辑中央 `dev/app-pages.json` 或 bootstrap。production build 不复制 `miniprogram/dev`，聚焦隔离测试再验证 C1a marker/route 不泄漏。

**Tech Stack:** HTML/CSS/ES modules、微信小程序 TypeScript/WXML/WXSS、Node test runner、Jest/ts-jest、YAML、现有 development/production build、Playwright reference capture、WeChat DevTools、Pillow visual comparison。

**Design:** `docs/superpowers/specs/2026-08-24-player-game-application-preview-design.md`

**Current baseline:** `main@3de95bc`. `npm run typecheck` 和 `npm run build:miniprogram:development` 通过。既有 `tests/captain-open-game-native-preview.test.mjs` 有一个与本切片无关的过期断言：它仍禁止 production `captain-game-*`，但这些页面已由 B2 commit `64f32de` 正式上线。本计划不修改该旧测试，C1a 完成验证不以它为门槛。

**Hard boundary:** 只新增 C1a 专属 Artifact、dev-only 源码、聚焦测试和评审资料。不得修改 `.worktrees/b2-captain-staging-acceptance/**`、`backend/**`、OpenAPI/迁移、`miniprogram/app.json`、`app.ts`、runtime/config、production 或 dev `captain-game-*`、open-game domain/services、`miniprogram/dev/bootstrap.ts`、`miniprogram/dev/app-pages.json`、现有 B2 Fixture/route fragment、中央 build/audit 脚本、Task 10 验收记录、deploy/live 配置、体验版或用户未跟踪文件。

---

## Task 1: 用测试冻结六个 375×812 参考帧

**Files:**

- Create: `tests/player-game-application-artifact.test.mjs`
- Create: `artifacts/ui/references/player-game-application.html`
- Create: `artifacts/ui/references/player-game-application.css`
- Create: `artifacts/ui/references/player-game-application-data.js`
- Create: `artifacts/ui/flows/player-game-application.md`
- Create: `artifacts/ui/screen-manifest/player-game-application.yaml`
- Create: `artifacts/ui/reviews/player-game-application/README.md`
- Create: `artifacts/ui/reviews/player-game-application/review-board.html`
- Add: six `*-reference-375x812.png` files under `artifacts/ui/reviews/player-game-application/`

- [ ] **Step 1: 写 Artifact RED 测试**

测试精确要求以下六个状态，viewport 为 `375 × 812`，`production_enabled: false`，review slots 为 reference / implementation / side-by-side / overlay-50 / difference / observations：

```text
anonymous-detail
application-ready
applied-detail
captain-pending
joined-detail
rejected-detail
```

同时断言：

- 页面使用既有 `#F8FAFC/#FFFFFF/#10243E/#0284C7/#047857`；
- 所有按钮至少 44px 且显式 flex 双轴居中，固定底栏包含安全区；
- 组织者只使用 `team_name` 形态的“津门周末队”；申请人显示“本场称呼”及“不是微信昵称或实名”；
- 公开内容无手机号、微信号、订单 ID、支付字段、头像、履约统计、候补和通知承诺；
- HTML 内部按钮能够产生 `NONE → APPLIED → JOINED|REJECTED` 的 Fixture transition，关闭确认层不改状态；
- README 预留六组同尺寸比较证据且 gate 保持 `pending-user-visual-approval`。

Run:

```bash
node --test tests/player-game-application-artifact.test.mjs
```

Expected: RED，因为文件尚不存在。

- [ ] **Step 2: 实现最小 HTML/CSS/data Artifact**

每次只渲染 query string `?state=<id>` 对应的一个 375×812 phone surface，不生成大而不可比的拼板截图。六帧复用详情卡、状态区、表单字段和按钮组件；`captain-pending` 同页提供接受 / 婉拒确认层行为，但 reference 捕获默认关闭。

Artifact 的可见动作必须更新内存状态或浏览器 history：登录并继续、申请加入、取消、提交、刷新、接受、婉拒、确认、关闭和返回都不得仅 Toast。设计说明和 review board 可以汇总六帧，但不能充当运行时结果。

- [ ] **Step 3: 在真实 Chromium 以 375×812 捕获六张 reference**

使用项目 Playwright 流程启动本地静态服务，一次打开六个 `?state=` URL。每张截图前人工检查 console、水平溢出、裁切、文案、图标、按钮双轴居中、同组控件列线和底部安全区；只修可见阻塞问题一次。所有 PNG 必须直接是 375×812，不裁剪、拼接或后制制造页面。

- [ ] **Step 4: 跑 GREEN 并提交 Artifact**

```bash
node --test tests/player-game-application-artifact.test.mjs
git diff --check
git add artifacts/ui tests/player-game-application-artifact.test.mjs
git commit -m "design: preview player application journey"
```

## Task 2: TDD 实现唯一的隔离 Fixture store

**Files:**

- Create: `miniprogram/dev/c1a-player-application-fixture.ts`
- Create: `miniprogram/dev/c1a-player-application-fixture.test.ts`

- [ ] **Step 1: 写 Fixture RED 测试**

测试从 `createC1aPlayerApplicationStore()` 的全新实例驱动，不依赖页面：

- marker 为 `C1A_PLAYER_APPLICATION_FIXTURE`，合成球局引用现有 B2 形状并使用 `teamName`，删除条件明确；
- reset 为未登录申请人和 `NONE`；登录只改变隔离身份；
- `displayName` 2–24、位置必选、备注 ≤120 且拒绝手机号 / 微信号 / URL、成年与风险必须分别确认；
- 取消表单不写报名；有效提交以一个 attempt 原子进入 `APPLIED`，重复提交不能产生第二条；
- `SUBMIT_UNKNOWN` 只允许以原 attempt 确认结果；认证恢复后也复用该 attempt；
- 队长接受 / 婉拒都必须先打开确认层，关闭不改状态，确认分别进入 `JOINED` / `REJECTED`；
- `MUTATION_UNKNOWN` 只确认原决策 attempt；容量变化保持 `APPLIED`；
- 申请人重新读取同一 store 能看到 `APPLIED/JOINED/REJECTED`，只有 `JOINED` 减少剩余名额；
- `JOINED/REJECTED` 不可重复审核或重申请；满员没有候补 transition；
- load/auth/not-found/state-changed 恢复动作不创建业务结果。

Run:

```bash
npx jest miniprogram/dev/c1a-player-application-fixture.test.ts --runInBand
```

Expected: RED，因为模块尚不存在。

- [ ] **Step 2: 实现最小 immutable store**

只实现测试需要的值对象、校验纯函数和同步内存 store。模块同时导出便于测试隔离的 `createC1aPlayerApplicationStore()` 工厂，以及四页共同引用的唯一模块级 `c1aPlayerApplicationStore` singleton。store 返回冻结快照；页面只能调用 singleton 的方法，不直接修改 `registrationStatus`。attempt key 在 reset 时确定性生成，预览中不引入通用 repository、事件总线、持久化或生产接口抽象。

- [ ] **Step 3: 跑 GREEN 并提交 store**

```bash
npx jest miniprogram/dev/c1a-player-application-fixture.test.ts --runInBand
npm run typecheck
git diff --check
git add miniprogram/dev/c1a-player-application-fixture.ts miniprogram/dev/c1a-player-application-fixture.test.ts
git commit -m "feat: model player application preview state"
```

## Task 3: TDD 接通四个原生 development-only 页面

**Files:**

- Create: `miniprogram/dev/pages/c1a-scenario/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/dev/pages/c1a-scenario/index.test.ts`
- Create: `miniprogram/dev/pages/c1a-game-public/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/dev/pages/c1a-game-public/index.test.ts`
- Create: `miniprogram/dev/pages/c1a-game-application/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/dev/pages/c1a-game-application/index.test.ts`
- Create: `miniprogram/dev/pages/c1a-captain-applications/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/dev/pages/c1a-captain-applications/index.test.ts`
- Create: `miniprogram/dev/c1a-player-application-pages.json`
- Create: `tests/player-game-application-native-preview.test.mjs`

- [ ] **Step 1: 写页面和隔离 RED 测试**

四组 Jest 测试使用已有 Page/wx stub 模式，覆盖：

- 场景启动器真实 reset 接受 / 婉拒分支、切换申请人 / 队长，并导航对应页面；
- 详情页未登录登录后留在同页、进入申请表、刷新同一 store、终态不渲染假动作；
- 申请页更新四类输入、即时邻接校验、取消不写报名、提交中防重、结果未知复用 attempt；
- 审核页接受 / 婉拒确认、关闭不写状态、确认后空状态、容量变化刷新和结果未知确认；
- 页面 `onShow` 总是重读 store，保证队长处理后申请人回同一详情能看到权威结果；
- 四页源码与页面测试直接证明它们引用同一个模块级 `c1aPlayerApplicationStore`，不得各自调用工厂创建第二份权威；
- 深链没有上一页时返回 `c1a-scenario`，所有错误态动作有真实导航或 store recovery。

Node 隔离测试断言：

- route fragment 精确列出四个 `dev/pages/c1a-*` 页面；
- 每页四个原生文件存在且 `navigationStyle: custom`；
- WXML 明确显示“开发预览”，所有可见成功按钮都有 bindtap；
- 固定 CTA、选项、返回 / 关闭按钮至少 88rpx 并显式 flex 双轴居中，底栏包含安全区；
- `miniprogram/app.json`、production 页面 / domain / services 不含 C1a 专属 `dev/pages/c1a-*` route 或 `C1A_PLAYER_APPLICATION_FIXTURE` marker；
- production build 后 `dist/miniprogram-production` 不含 C1a 专属 route、页面或 marker。扫描不得使用 `captain-game`、`open-game`、`apply`、`join` 等会误伤已上线 B2 的宽泛模式。

Run:

```bash
npx jest miniprogram/dev/pages/c1a-scenario/index.test.ts \
  miniprogram/dev/pages/c1a-game-public/index.test.ts \
  miniprogram/dev/pages/c1a-game-application/index.test.ts \
  miniprogram/dev/pages/c1a-captain-applications/index.test.ts --runInBand
node --test tests/player-game-application-native-preview.test.mjs
```

Expected: RED，因为页面与 fragment 尚不存在。

- [ ] **Step 2: 实现页面及一份共享样式节奏**

页面只能 import C1a Fixture 与已有只读 header-layout helper；不要 import B2 dev/production composition。为避免中央文件和跨切片争用，四页可以各自保留小范围 WXSS，公共视觉值保持一致但不提前新增通用组件系统。

详情页复用 B2 的信息层级而不是源文件；申请表底栏、审核确认层和启动器均显示 development-only 提示。使用文字或本地 CSS 线条图标，不用 emoji/远程图。处理完成后审核页显示真实空状态，并提供切换到申请人视角的开发动作。

- [ ] **Step 3: 运行原生 GREEN 检查**

```bash
npx jest miniprogram/dev/c1a-player-application-fixture.test.ts \
  miniprogram/dev/pages/c1a-scenario/index.test.ts \
  miniprogram/dev/pages/c1a-game-public/index.test.ts \
  miniprogram/dev/pages/c1a-game-application/index.test.ts \
  miniprogram/dev/pages/c1a-captain-applications/index.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production
node --test tests/player-game-application-native-preview.test.mjs
npm run audit:miniprogram-package
```

这里的腾讯地图 key 是仓库现有测试使用的格式有效合成值，只用于构建隔离检查，不复制或读取 live secret，也绝不用于部署。必须先 fresh production build，再让 Node 隔离测试扫描新生成的 `dist`，避免旧输出造成假阴性 / 假阳性。检查 development manifest 自动包含四页，production manifest 仍是基线 17 routes。不要为通过测试编辑中央 manifest/build/audit 文件；若旧 B2 测试仍以已记录原因失败，只记录，不纳入 C1a 变更。

- [ ] **Step 4: 提交隔离原生预览**

```bash
git diff --check
git add miniprogram/dev/c1a-player-application-fixture.ts \
  miniprogram/dev/c1a-player-application-fixture.test.ts \
  miniprogram/dev/c1a-player-application-pages.json \
  miniprogram/dev/pages/c1a-* \
  tests/player-game-application-native-preview.test.mjs
git commit -m "feat: preview player application review journey"
```

## Task 4: 做一次真实运行时视觉自审，留待用户明天确认

**Files:**

- Modify: `artifacts/ui/reviews/player-game-application/README.md`
- Modify: `artifacts/ui/reviews/player-game-application/review-board.html`
- Add: six `*-implementation-375x812.png`
- Add: six each of `*-side-by-side.png`, `*-overlay-50.png`, `*-difference.png`

- [ ] **Step 1: 构建并在 WeChat DevTools 打开四个 dev 页面**

使用 development build 和 iPhone X 逻辑 viewport `375 × 812`。先从场景启动器重置，完成接受分支：未登录详情 → 登录 → 申请表 → APPLIED → 队长确认接受 → 申请人详情 JOINED；再重置完成婉拒分支。每个可见按钮至少实际点击一次。

若 DevTools 自动化因非产品原因失败一次，改用已有的简单手工 capture 路径；不投入新的工具链修复。原始导出若为相同比例的 750×1624 或等比例 simulator surface，只允许一次严格等比 resize 到 375×812，不裁剪、补边或重构内容，并在 README 记录原始尺寸。

- [ ] **Step 2: 捕获六个代表状态**

捕获 `anonymous-detail`、`application-ready`、`applied-detail`、`captain-pending`、`joined-detail`、`rejected-detail`。启动器和接受确认层人工检查但不增加截图矩阵；婉拒确认复用同一组件并由行为测试覆盖。

- [ ] **Step 3: 生成同尺寸比较证据**

对每个 reference / implementation pair 运行：

```bash
uv run python scripts/create_visual_review.py \
  artifacts/ui/reviews/player-game-application/<state>-reference-375x812.png \
  artifacts/ui/reviews/player-game-application/<state>-implementation-375x812.png \
  artifacts/ui/reviews/player-game-application/<state>
```

得到 750×812 并排图以及 375×812 的 50% 叠加图和差异图。用 `sips` 或现有 PNG helper 验证全部输入尺寸。

- [ ] **Step 4: 人工视觉自审并只修最小阻塞**

逐组查看 reference、implementation、side-by-side、overlay、difference，记录：构图、几何间距、组件层级、字体色彩材质、图标完整性、关键文案与状态语义、按钮文字双轴居中、同组控件尺寸/列线、元素边界与裁切、固定底栏和安全区。检查申请表真实输入/滚动时底栏不遮挡内容。

发现一眼可见问题时只修受影响页面并重跑相应聚焦测试与代表捕获一次。非阻塞的原生字体和微信 chrome 差异只记录。不要因为工具或低风险展示差异扩大全状态回归。

- [ ] **Step 5: 记录为待用户确认并做最终验证**

README 必须写明 `Implementation self-review: PASS`（只有自审真的通过时）和 `User visual gate: PENDING`。独立 Agent 可审阅自审是否遗漏，但不得替用户把生产契约门标为通过。

```bash
node --test tests/player-game-application-artifact.test.mjs
npx jest miniprogram/dev/c1a-player-application-fixture.test.ts \
  miniprogram/dev/pages/c1a-scenario/index.test.ts \
  miniprogram/dev/pages/c1a-game-public/index.test.ts \
  miniprogram/dev/pages/c1a-game-application/index.test.ts \
  miniprogram/dev/pages/c1a-captain-applications/index.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production
node --test tests/player-game-application-native-preview.test.mjs
npm run audit:miniprogram-package
git diff --check
git status --short
```

- [ ] **Step 6: 提交视觉证据并停止**

```bash
git add artifacts/ui/reviews/player-game-application miniprogram/dev/pages/c1a-* tests/player-game-application-*.test.mjs
git commit -m "design: record player application visual review"
```

停止在“可供用户明天预览和测试”。不要合并 main、推送、部署、上传体验版、实现后端、启用 PLAY 入口或清理 B2/C1a Fixture。用户确认后另写生产契约与集成计划；真实生产 E2E 必须使用不同的队长与申请人账号。
