# C2d 到场人工纠错 Development Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to execute this plan task-by-task.

**Goal:** 交付一套可操作的 C2d 设计 Artifact、隔离平台 Fixture 和隔离小程序 Fixture，在 `1440×900` 平台后台及代表性 iOS/Android 小程序 viewport 完成视觉决策，不接入生产数据。

**Architecture:** 平台 Artifact/预览与小程序 Artifact/预览各自使用确定性内存 store；平台通过完整报名 UUID 精确查询并在本地追加纠正 event，小程序以两张只读页面展示纠正后的队长/球员投影。两端 marker、route 与 source 都由现有 production build/audit 明确排除。

**Tech Stack:** HTML/CSS/vanilla JavaScript、微信小程序 TypeScript/WXML/WXSS、Node test、Jest、Playwright/现有截图工具、官方微信开发者工具。

---

状态：`PREVIEW_IMPLEMENTED_PLATFORM_PASS_NATIVE_PENDING`。

截至 2026-08-31 的门禁矩阵：

- 平台 `1440 × 900` Artifact/Fixture：`DELEGATED_VISUAL_PASS`，独立审核 Critical 0 / Important 0；
- 移动浏览器 Artifact（iOS/Android 尺寸）：`DELEGATED_VISUAL_PASS`，但不属于微信原生证据；
- 微信开发者工具 iOS：`PENDING`（Computer Use 重试后仍为 `cgWindowNotFound`）；
- 微信开发者工具 Android：`PENDING`（同上）；
- 用户真机：`PENDING`；
- development/production package isolation：`PASS`，production audit 为 0 forbidden paths/tokens；
- 生产契约、迁移、后端与真实平台/小程序接入：`NOT_STARTED`，本计划不授权；
- merge / deploy / experience upload：`BLOCKED_BY_NATIVE_AND_PRODUCTION_GATES`。

基线：`cd8ac51bb4c19a2627d60a9417ea590331e245c1`。

设计：[C2d 平台到场人工纠错设计](../specs/2026-08-31-attendance-correction-design.md)。

## 硬边界

本计划只实现：

- desktop 与 mobile reference Artifact；
- development-only 平台 Fixture；
- development-only 小程序 Fixture 与场景页；
- 聚焦行为/隔离测试；
- 平台 `1440×900`、小程序 iOS `390×844` 与 Android `411×731` 的代表视觉证据及独立 agent 决策。

本计划不得修改 `contracts/openapi.yaml`、backend model/router/service、数据库 migration、production 平台 API/client 或 production 小程序业务页；不得合并、部署或上传体验版。视觉通过后另写生产实施计划。

## Task 1：冻结桌面与移动 Artifact

**Files:**

- Create: `artifacts/ui/reference/platform-attendance-correction/index.html`
- Create: `artifacts/ui/references/attendance-correction-readback.html`
- Create: `artifacts/ui/references/attendance-correction-readback.css`
- Create: `artifacts/ui/references/attendance-correction-readback.data.js`
- Create: `artifacts/ui/screen-manifest/attendance-correction-readback.yaml`
- Create: `artifacts/ui/flows/attendance-correction-readback.md`
- Create: `tests/attendance-correction-artifact.test.mjs`

### 1.1 先写失败测试

测试固定：

- desktop reference 支持 `?case=ready|confirm`，目标 viewport `1440×900`；
- mobile reference 支持 `?screen=captain|player`，可在 `390×844` 与 `411×731` 捕获；
- desktop 只按完整报名 UUID 查询，不出现姓名、手机号或 OpenID 搜索；
- 原始队长记录、当前有效状态和纠正历史分开展示；
- mobile 不出现 reason、principal、完整历史、电话、用户 ID、报名备注或支付字段；
- 所有 `<button>` 有真实 handler/表单行为；dialog 有初始焦点、Escape 关闭、焦点恢复和背景不可交互；
- mobile 复制编号动作及可见成功/失败反馈存在；
- manifest 只列 platform `ready/confirm` 与 mobile `captain/player` 四个代表画面，不制造全状态矩阵。

Run:

```bash
node --test tests/attendance-correction-artifact.test.mjs
```

Expected: RED because artifacts do not exist.

### 1.2 实现最小 Artifact

平台沿用现有 platform onboarding 的 shell、字体、颜色、panel、button 与 focus pattern；mobile 沿用 C2c 的自定义导航、卡片、状态徽标、滚动和 safe area。拒绝 UI/UX 查询中与现有产品冲突的夸张大标题、展示字体和营销布局，不新增设计 token 文件。

desktop reference 的 store 必须真实完成：known/unknown ID 查询、清除、理由校验、打开/取消 dialog、确认后 append event + current status flip + version increment、unknown-result 权威刷新、logout/login 与模块切换。mobile reference 的复制按钮使用本地 Clipboard API 或确定性 adapter 并显示成功/失败结果。

### 1.3 验证并提交

```bash
node --test tests/attendance-correction-artifact.test.mjs
git diff --check
git add artifacts/ui/reference/platform-attendance-correction \
  artifacts/ui/references/attendance-correction-readback.html \
  artifacts/ui/references/attendance-correction-readback.css \
  artifacts/ui/references/attendance-correction-readback.data.js \
  artifacts/ui/screen-manifest/attendance-correction-readback.yaml \
  artifacts/ui/flows/attendance-correction-readback.md \
  tests/attendance-correction-artifact.test.mjs
git commit -m "design(c2d): add attendance correction artifacts"
```

## Task 2：实现隔离的平台后台 Fixture

**Files:**

- Create: `platform-admin/dev-attendance-correction/index.html`
- Create: `platform-admin/dev-attendance-correction/styles.css`
- Create: `platform-admin/dev-attendance-correction/fixture.js`
- Create: `platform-admin/dev-attendance-correction/app.js`
- Create: `tests/attendance-correction-preview.test.mjs`

### 2.1 先写 store 与 DOM 失败测试

冻结唯一 marker：

```js
const ATTENDANCE_CORRECTION_FIXTURE_MARKER = "ATTENDANCE_CORRECTION_FIXTURE";
```

覆盖：

- 默认 principal 只有 `PLATFORM_ADMIN`；切成 `ONBOARDING_REVIEWER` 时模块不可见且 store 拒绝查询/纠正；
- 只接受完整 UUID；known ID 返回一条，unknown ID 返回诚实空态，UNMARKED ID 返回不可纠正；
- `PRESENT ↔ NO_SHOW`，理由 trim 后必填；
- cancel 不写；confirm 追加不可变 event、更新 current、version `+1`，原始记录字段 byte-equivalent；
- 二次纠正继续 append，不更新/删除旧 event；
- unknown result 锁定表单，refresh 后显示确定性权威状态；
- login/logout、查询、清除、模块导航、提交、取消、确认与刷新按钮均绑定真实行为；
- preview 不调用 fetch/XHR/WebSocket，不使用 localStorage/sessionStorage；
- 不包含电话、OpenID、user ID、报名备注、成年/风险同意、支付退款字段；
- dialog 有 focus trap、Escape 关闭和 trigger focus restore。

Run:

```bash
node --test tests/attendance-correction-preview.test.mjs
```

Expected: RED because preview files do not exist.

### 2.2 实现自包含预览

`platform-admin/dev-attendance-correction/` 不 import `platform-admin/src/**`，也不改变已由源码与历史截图哈希冻结的 `platform-admin/dev/` onboarding Fixture。其模块导航“入驻审核”真实跳转 `../dev/index.html?case=pending`，“到场纠错”使用不可点击的 `aria-current` 当前状态；退出进入本地 login state，任意非空预览 token 返回 Fixture console。

支持 URL case：`ready`、`confirm`、`not-found`、`unmarked`、`unknown-result`、`success`。只有 `ready/confirm` 进入完整视觉比较，其余用于功能点检。

### 2.3 验证并提交

```bash
node --test \
  tests/attendance-correction-preview.test.mjs \
  tests/attendance-correction-artifact.test.mjs
npm run build:platform-admin
git diff --check
git add platform-admin/dev-attendance-correction \
  tests/attendance-correction-preview.test.mjs
git commit -m "feat(c2d): preview platform attendance correction"
```

## Task 3：实现隔离的小程序队长/球员回读

**Files:**

- Create: `miniprogram/dev/c2d-attendance-correction-fixture.ts`
- Create: `miniprogram/dev/c2d-attendance-correction-fixture.test.ts`
- Create: `miniprogram/dev/c2d-attendance-correction-pages.json`
- Create: `miniprogram/dev/pages/c2d-attendance-correction-scenario/index.ts`
- Create: `miniprogram/dev/pages/c2d-attendance-correction-scenario/index.json`
- Create: `miniprogram/dev/pages/c2d-attendance-correction-scenario/index.wxml`
- Create: `miniprogram/dev/pages/c2d-attendance-correction-scenario/index.wxss`
- Create: `miniprogram/dev/pages/c2d-attendance-correction-scenario/index.test.ts`
- Create: `miniprogram/dev/pages/c2d-captain-roster/index.ts`
- Create: `miniprogram/dev/pages/c2d-captain-roster/index.json`
- Create: `miniprogram/dev/pages/c2d-captain-roster/index.wxml`
- Create: `miniprogram/dev/pages/c2d-captain-roster/index.wxss`
- Create: `miniprogram/dev/pages/c2d-captain-roster/index.test.ts`
- Create: `miniprogram/dev/pages/c2d-player-result/index.ts`
- Create: `miniprogram/dev/pages/c2d-player-result/index.json`
- Create: `miniprogram/dev/pages/c2d-player-result/index.wxml`
- Create: `miniprogram/dev/pages/c2d-player-result/index.wxss`
- Create: `miniprogram/dev/pages/c2d-player-result/index.test.ts`

### 3.1 先写 Fixture 与页面失败测试

冻结：

```ts
export const C2D_ATTENDANCE_CORRECTION_FIXTURE_MARKER = "C2D_ATTENDANCE_CORRECTION_FIXTURE";
```

覆盖：

- inventory 只声明 scenario、captain readback、player readback 三条 custom-navigation dev route；
- 场景页明确写“C2d 开发预览 · 模拟数据”，两个按钮真实 `navigateTo`；
- captain row 与 player self detail 显示同一 current status、latest corrected time 和 registration ID；
- 原始 recorded time 可显示，但 reason、principal、历史和用户身份字段不进入投影；
- “复制报名编号”调用真实 `wx.setClipboardData`；success/fail callback 更新内联反馈，失败可重试；
- 返回按钮有历史时 `navigateBack`，无历史时回到 scenario；页面不可分享；
- 44pt/48dp 触控、显式 flex 双轴居中、custom header、滚动容器和 safe area 规则存在；
- 长本场称呼不推挤徽标/按钮，队长重复行状态列对齐。

Run:

```bash
npx jest --runInBand \
  miniprogram/dev/c2d-attendance-correction-fixture.test.ts \
  miniprogram/dev/pages/c2d-attendance-correction-scenario/index.test.ts \
  miniprogram/dev/pages/c2d-captain-roster/index.test.ts \
  miniprogram/dev/pages/c2d-player-result/index.test.ts
```

Expected: RED because modules do not exist.

### 3.2 最小实现

只做两张只读回读页面，不复制整套 C2c 生产旅程。共享一份确定性 Fixture projection 和 clipboard adapter；不抽象通用状态管理，不 import production HTTP source，不持久化数据。

### 3.3 验证并提交

```bash
npx jest --runInBand \
  miniprogram/dev/c2d-attendance-correction-fixture.test.ts \
  miniprogram/dev/pages/c2d-attendance-correction-scenario/index.test.ts \
  miniprogram/dev/pages/c2d-captain-roster/index.test.ts \
  miniprogram/dev/pages/c2d-player-result/index.test.ts
npm run typecheck
npx eslint \
  miniprogram/dev/c2d-attendance-correction-fixture.ts \
  miniprogram/dev/pages/c2d-attendance-correction-scenario/index.ts \
  miniprogram/dev/pages/c2d-captain-roster/index.ts \
  miniprogram/dev/pages/c2d-player-result/index.ts
git diff --check
git add miniprogram/dev/c2d-attendance-correction-fixture.ts \
  miniprogram/dev/c2d-attendance-correction-fixture.test.ts \
  miniprogram/dev/c2d-attendance-correction-pages.json \
  miniprogram/dev/pages/c2d-attendance-correction-scenario \
  miniprogram/dev/pages/c2d-captain-roster \
  miniprogram/dev/pages/c2d-player-result
git commit -m "feat(c2d): preview corrected attendance readback"
```

## Task 4：证明 production isolation

**Files:**

- Create: `tests/attendance-correction-native-preview.test.mjs`
- Modify: `tests/build-platform-admin.test.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`

### 4.1 先写隔离失败测试

production deny-list 精确加入：

- `ATTENDANCE_CORRECTION_FIXTURE`；
- `C2D_ATTENDANCE_CORRECTION_FIXTURE`；
- `platform-admin/dev-attendance-correction`；
- `c2d-attendance-correction-fixture` 与 `c2d-attendance-correction-pages.json`；
- 三条 `dev/pages/c2d-...` route；
- development-only truth label、合成 registration UUID 和合成球局名称。

`build-platform-admin.test.mjs` 证明 fresh platform dist 仍只有 approved API-backed assets，不含 nested dev directory/marker。native preview test 证明 fresh development mini build 包含三条 route，fresh production build 不含 marker、route、合成值或 source。

### 4.2 只扩展现有隔离审计

不得把 C2d preview 放入 `package.json` production composition，也不得修改 production route。只扩展现有禁止 token/path 测试与审计列表。

Run:

```bash
node --test \
  tests/attendance-correction-native-preview.test.mjs \
  tests/build-platform-admin.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npm run build:platform-admin
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
MINIPROGRAM_PAYMENT_PROVIDER=disabled \
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all commands exit 0; production outputs contain zero C2d preview marker/path/token.

### 4.3 提交隔离证明

```bash
git diff --check
git add tests/attendance-correction-native-preview.test.mjs \
  tests/build-platform-admin.test.mjs \
  scripts/audit-production-package.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
git commit -m "test(c2d): isolate attendance correction previews"
```

## Task 5：代表视觉捕获与自审

**Files:**

- Create: `artifacts/ui/reviews/platform-attendance-correction/README.md`
- Create: `artifacts/ui/reviews/platform-attendance-correction/review-board.html`
- Create: `artifacts/ui/reviews/attendance-correction-readback/README.md`
- Create: `artifacts/ui/reviews/attendance-correction-readback/review-board.html`
- Create: generated PNG evidence under the two review directories

### 5.1 平台 `1440×900`

从相同 clean build 捕获 `ready` 与 `confirm`：

```text
reference-1440x900
implementation-1440x900
side-by-side
overlay-50
difference
```

人工点一次查询、理由校验、取消、确认、二次查询、unknown refresh、模块切换、logout/login；只给 `ready/confirm` 生成完整五类证据。检查表单列线、按钮文字双轴居中、dialog focus/Escape/restore、状态/版本/历史事实、无横纵向裁切。

### 5.2 微信开发者工具 iOS / Android

构建并打开 development package：

```bash
npm run build:miniprogram:development
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
  --project "$PWD" --auto-port 9431 --trust-project
```

在官方工具分别选择：

- iPhone 12/13 Pro，`390×844`；
- Nexus 5X，`411×731`。

每个平台只捕获 captain corrected readback 与 player corrected readback 两张代表画面，并为每张生成 reference/implementation/side-by-side/overlay/difference。人工点复制成功一次、强制 adapter 失败并重试一次、检查自然返回；检查文字双轴居中、状态徽标对齐、箭头完整、长文案、滚动和 safe area。

若 Computer Use/DevTools 失败，只重试一次。仍不可用则对应门写 `PENDING` 并停止工具链排障；不得用静态 HTML、另一设备或历史截图代替。

### 5.3 自审后聚焦回归

```bash
node --test \
  tests/attendance-correction-artifact.test.mjs \
  tests/attendance-correction-preview.test.mjs \
  tests/attendance-correction-native-preview.test.mjs \
  tests/build-platform-admin.test.mjs
npx jest --runInBand \
  miniprogram/dev/c2d-attendance-correction-fixture.test.ts \
  miniprogram/dev/pages/c2d-attendance-correction-scenario/index.test.ts \
  miniprogram/dev/pages/c2d-captain-roster/index.test.ts \
  miniprogram/dev/pages/c2d-player-result/index.test.ts
npm run typecheck
git diff --check
```

只修复受影响画面的 Critical/Important；不要因低风险细节扩张为全状态重拍。

## Task 6：独立 agent 视觉决策与预览收口

### 6.1 独立审核

派一个未参与实现的 agent 只读检查 Task 5 的 Artifact、真实实现截图、side-by-side、overlay、difference 与交互记录。审核范围严格为：

- platform `ready/confirm`；
- iOS captain/player；
- Android captain/player；
- 按钮真实性、focus/touch、safe area、状态事实与隐私。

用户已明确授权其睡眠期间由独立 agent 决策。没有 Critical/Important 才能在两个 README 写 `DELEGATED_VISUAL_PASS`；任一真实运行时缺证据即写 `PENDING`。该决定不批准生产后端、契约、迁移、合并、部署或体验版上传。

### 6.2 最终验证

```bash
git status --short --branch
git diff --check cd8ac51bb4c19a2627d60a9417ea590331e245c1..HEAD
node --test \
  tests/attendance-correction-artifact.test.mjs \
  tests/attendance-correction-preview.test.mjs \
  tests/attendance-correction-native-preview.test.mjs \
  tests/build-platform-admin.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npx jest --runInBand \
  miniprogram/dev/c2d-attendance-correction-fixture.test.ts \
  miniprogram/dev/pages/c2d-attendance-correction-scenario/index.test.ts \
  miniprogram/dev/pages/c2d-captain-roster/index.test.ts \
  miniprogram/dev/pages/c2d-player-result/index.test.ts
npm run typecheck
npm run build:platform-admin
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
MINIPROGRAM_PAYMENT_PROVIDER=disabled \
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all focused checks exit 0, both production outputs contain no C2d preview assets, and gate matrix separately reports platform/iOS/Android/independent-agent/user/production status.

### 6.3 Fixture 删除条件与下一阶段

本预览通过后 Fixture 仍保留。只有另行生产计划完成静态/运行时契约、`0022`、后端、平台 client、小程序 player/captain integration、真实本地 admin→player HTTP journey、staging 纠正与纠回、production audit 及物理 iOS/Android 用户验收后，才删除 Fixture 或将其继续保留为严格 development-only 资产。

最终只提交/推送独立 feature branch 作为技术备份；不得在本计划内追 main、merge、deploy 或 upload。
