# C1b 公开球局发现开发预览实施计划

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents are available) or `superpowers:executing-plans`. Follow `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before each completion claim.

**Goal:** 在不修改 C1a、生产路由、后端和体验版的前提下，完成“浏览公开球局 → 日期/人制/名额筛选 → 每张卡片进入自身只读详情 → 返回列表”的 375×812 development-only 可操作预览。

**Architecture:** 一份带明确标记的内存 catalog/store 是场景入口、目录和只读详情的唯一权威。三个页面全部位于 `miniprogram/dev/pages/c1b-*`，development build 自动发现，production build 排除。HTML Artifact 复用同一 presentation 语义；临时详情不依赖尚待验收的 C1a，且不显示申请动作。

**Tech Stack:** HTML/CSS/ES modules、微信小程序 TypeScript/WXML/WXSS、Node test runner、Jest/ts-jest、YAML、现有 development/production build、Chromium 参考图和 WeChat DevTools 原生预览。

**Design:** `docs/superpowers/specs/2026-08-26-public-game-discovery-preview-design.md`

**Current baseline:** `main@3de95bc`. `npm run typecheck`、development build、fresh production build 和 production package audit 通过。既有 `tests/captain-open-game-native-preview.test.mjs` 有一个与本切片无关的过期断言：它仍禁止正式 `captain-game-*` 路由，但这些页面已由 `64f32de` 正式上线；`tests/build-miniprogram.test.mjs` 的权威双构建隔离检查通过。本计划保持 add-only，不修改该旧测试。

**Hard boundary:** `git diff --name-status main...HEAD` 只允许 C1b 专属新增文件，全部状态必须为 `A`。不得修改中央 manifest/bootstrap/build/audit、production pages/domain/services、backend/contracts/migrations/deploy、C1a/B2 文件或 Task 18 验收资料。

---

## Task 1: 用测试冻结四个 375×812 参考状态

**Files:**

- Create: `tests/public-game-discovery-artifact.test.mjs`
- Create: `artifacts/ui/references/public-game-discovery.html`
- Create: `artifacts/ui/references/public-game-discovery.css`
- Create: `artifacts/ui/references/public-game-discovery-data.js`
- Create: `artifacts/ui/flows/public-game-discovery.md`
- Create: `artifacts/ui/screen-manifest/public-game-discovery.yaml`
- Create: `artifacts/ui/reviews/public-game-discovery/README.md`
- Create: `artifacts/ui/reviews/public-game-discovery/review-board.html`
- Add: four `*-reference-375x812.png` files under the review directory

- [ ] **Step 1: 写 Artifact RED 测试**

测试精确冻结 `ready-list`、`filtered-nonempty`、`filter-no-match`、`load-error`，viewport 为 `375 × 812`，`production_enabled: false`。同时断言：

- 使用既有蓝绿视觉 token，按钮至少 44px 且显式 flex 双轴居中；
- ready 列表含三条按时间排序的数据、两条有名额和一条已满；
- 筛选、清除、重试、卡片进入详情和返回都改变内存状态或浏览器 history；
- 卡片和详情没有申请按钮、手机号、微信号、订单号、成员名单或支付字段；
- review slots 为 reference / implementation / side-by-side / overlay-50 / difference / observations，用户门保持 pending。

Run：

```bash
node --test tests/public-game-discovery-artifact.test.mjs
```

Expected: RED，因为文件尚不存在。

- [ ] **Step 2: 实现最小可交互 Artifact**

每个 `?state=` 只渲染一个 375×812 phone surface。目录支持日期、人制和仅看有名额的 AND 筛选、清除和错误重试；点击卡片以该卡 ID 渲染精确详情，返回保留筛选。详情、加载 skeleton 和自然空态存在但不扩张截图矩阵。

- [ ] **Step 3: 捕获四张 reference 并人工看一遍**

在 Chromium 375×812 打开四个 state URL。检查横向溢出、裁切、header、筛选列线、卡片信息层级、按钮双轴居中和底部安全区；只修一次明显问题。

- [ ] **Step 4: 跑 GREEN 并提交 Artifact**

```bash
node --test tests/public-game-discovery-artifact.test.mjs
git diff --check
git add artifacts/ui tests/public-game-discovery-artifact.test.mjs
git commit -m "design: preview public game discovery"
```

## Task 2: TDD 实现唯一的 C1b catalog/store

**Files:**

- Create: `miniprogram/dev/c1b-game-discovery-fixture.ts`
- Create: `miniprogram/dev/c1b-game-discovery-fixture.test.ts`

- [ ] **Step 1: 写 Fixture RED 测试**

从 `createC1bGameDiscoveryStore()` 的全新实例驱动：

- marker 为 `C1B_GAME_DISCOVERY_FIXTURE`，固定上海参考时钟和三条合成球局；
- 只投影 `PUBLIC + PUBLISHED + future + deadline open`，默认包含已满球局；
- 按 `startsAt, id` 稳定升序；
- 日期、人制和仅看有名额使用 AND，清除恢复默认；
- source-empty 与 filter-no-match 可区分；
- `LOAD_ERROR → retry → READY` 不创建或修改 catalog；
- `selectGame(id)` 只接受存在 ID，detail 精确对应；未知 ID 返回 not-found，不回退第一条；
- 选择详情和返回不清除筛选；所有 snapshot 深冻结。

Run：

```bash
npx jest miniprogram/dev/c1b-game-discovery-fixture.test.ts --runInBand
```

Expected: RED，因为模块尚不存在。

- [ ] **Step 2: 实现最小 immutable store**

只实现 presentation interfaces、纯筛选/排序函数、store 工厂和三个页面共享的 singleton。页面只能调用 store 方法，不直接写状态；不新增 repository、事件总线、持久化或生产接口抽象。

- [ ] **Step 3: 跑 GREEN 并提交 store**

```bash
npx jest miniprogram/dev/c1b-game-discovery-fixture.test.ts --runInBand
npm run typecheck
git diff --check
git add miniprogram/dev/c1b-game-discovery-fixture.ts miniprogram/dev/c1b-game-discovery-fixture.test.ts
git commit -m "feat: model public game discovery preview"
```

## Task 3: TDD 接通三个 development-only 原生页面

**Files:**

- Create: `miniprogram/dev/pages/c1b-scenario/index.{ts,wxml,wxss,json,test.ts}`
- Create: `miniprogram/dev/pages/c1b-game-discovery/index.{ts,wxml,wxss,json,test.ts}`
- Create: `miniprogram/dev/pages/c1b-game-detail/index.{ts,wxml,wxss,json,test.ts}`
- Create: `miniprogram/dev/c1b-game-discovery-pages.json`
- Create: `tests/public-game-discovery-native-preview.test.mjs`

- [ ] **Step 1: 写页面和隔离 RED 测试**

三组 Jest 页面测试覆盖：

- 场景入口真实 reset 并导航 ready/filtered/no-match/error/selected-detail；另提供 loading 和 natural-empty 的可重复运行时触发，供一次人工检查；
- 目录 `onShow` 重读 singleton，日期、人制、名额、清除和重试均更新投影；
- 整卡点击先保存 ID，再导航到编码后的相同 ID；
- detail `onLoad` 校验 query，`onShow` 重读同一记录，未知 ID 不回退；
- 返回优先 `navigateBack`，深链回 slice launcher/list，筛选留在 singleton；
- 自然空态进入现有 `pages/intent-entry/index`；
- 页面没有申请动作，所有可见按钮都有真实 handler。

Node 隔离测试断言：

- route fragment 精确列出三个 `dev/pages/c1b-*` 页面，四件套存在且 custom navigation；
- header CSS 箭头完整，触控至少 88rpx，按钮显式 flex 双轴居中；
- shell/scroll 使用 `100vh + height:0 + min-height:0`，底部包含 safe-area；
- fresh development build 包含三页；fresh production build/manifest/source 不含 marker、route 或三条合成球局；
- `git diff --name-status main...HEAD` 只有批准目录下新增文件。

Run：

```bash
npx jest miniprogram/dev/pages/c1b-scenario/index.test.ts \
  miniprogram/dev/pages/c1b-game-discovery/index.test.ts \
  miniprogram/dev/pages/c1b-game-detail/index.test.ts --runInBand
node --test tests/public-game-discovery-native-preview.test.mjs
```

Expected: RED，因为页面与 route fragment 尚不存在。

- [ ] **Step 2: 实现三个页面**

复用 `readIntentHeaderLayout()` 和已通过真机的 header/scroll 几何，不 import 或修改 C1a。目录无固定 footer；详情只有普通只读说明。返回箭头和 chevron 使用 CSS，不使用 unicode `‹` 或 emoji。

- [ ] **Step 3: 跑聚焦 GREEN**

```bash
npx jest miniprogram/dev/c1b-game-discovery-fixture.test.ts \
  miniprogram/dev/pages/c1b-scenario/index.test.ts \
  miniprogram/dev/pages/c1b-game-discovery/index.test.ts \
  miniprogram/dev/pages/c1b-game-detail/index.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production
node --test tests/public-game-discovery-native-preview.test.mjs
npm run audit:miniprogram-package
```

合成地图 key 只用于本地 production 隔离构建，不读取 live secret，不部署。

- [ ] **Step 4: 提交原生预览**

```bash
git diff --check
git add miniprogram/dev/c1b-game-discovery-* miniprogram/dev/pages/c1b-* tests/public-game-discovery-native-preview.test.mjs
git commit -m "feat: preview public game discovery journey"
```

## Task 4: 一次真实运行时视觉自审并准备明早测试

**Files:**

- Modify: `artifacts/ui/reviews/public-game-discovery/README.md`
- Modify: `artifacts/ui/reviews/public-game-discovery/review-board.html`
- Add: four each of `*-implementation-375x812.png`, `*-side-by-side.png`, `*-overlay-50.png`, `*-difference.png`

- [ ] **Step 1: 在微信开发者工具打开 development build**

使用 iPhone X 逻辑 viewport 375×812，从 C1b 场景入口实际点击四个代表状态；另人工检查 selected-detail、loading 和 natural-empty。若 DevTools 自动化因非产品原因失败一次，改用现有简单手工 capture 路径，不扩张工具链排障。

- [ ] **Step 2: 实测所有可见动作**

至少实际点击一次：返回、日期、人制 picker、仅看有名额、一张代表卡片、详情返回、清除筛选、重新加载、自然空态返回目的选择。人工确认该代表卡字段一致且返回保留筛选；三张卡逐一映射、未知 ID 和筛选保留由 Jest 覆盖，不扩张人工矩阵。

- [ ] **Step 3: 捕获并生成四组同尺寸证据**

捕获 `ready-list`、`filtered-nonempty`、`filter-no-match`、`load-error`。对每组 reference / implementation 运行现有 `scripts/create_visual_review.py`，生成同尺寸并排、50% overlay 和 difference。`selected-detail` 只保留一次 375×812 真实运行时人工检查记录，不扩张成第五套比较证据。

- [ ] **Step 4: 人工视觉自审并最小修复**

逐组检查构图、几何间距、组件层级、字体色彩材质、箭头/chevron 完整性、关键文案和数据、按钮双轴居中、重复控件尺寸/列线、裁切、纵向滚动和底部安全区。明显问题只修受影响状态并复核一次；README 只有在自审通过时写 `Implementation self-review: PASS`，始终保留 `User visual gate: PENDING`。

- [ ] **Step 5: 最终验证、allowlist gate、提交并推送预览分支**

```bash
node --test tests/public-game-discovery-artifact.test.mjs
npx jest miniprogram/dev/c1b-game-discovery-fixture.test.ts \
  miniprogram/dev/pages/c1b-scenario/index.test.ts \
  miniprogram/dev/pages/c1b-game-discovery/index.test.ts \
  miniprogram/dev/pages/c1b-game-detail/index.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production
node --test tests/public-game-discovery-native-preview.test.mjs
npm run audit:miniprogram-package
git diff --check
```

```bash
git add artifacts/ui/reviews/public-game-discovery miniprogram/dev/pages/c1b-* tests/public-game-discovery-*.test.mjs
git diff --cached --name-status main
git diff --name-status main...HEAD
git commit -m "design: record public game discovery review"
git diff --name-status main...HEAD
git status --short --branch
git push -u origin feature/c1b-game-discovery-preview
```

提交前以 `main` 为基线的 cached diff 必须只含批准路径且状态全为 `A`；它会同时覆盖此前已提交文件和当前暂存内容，`git status` 则覆盖尚未跟踪或未暂存文件。提交后再次检查完整分支 diff 和 clean status，任何 `M/D/R` 或越界路径都停止。

停止在“可供用户明早视觉确认和交互测试”。不要合并 `main`、部署、上传体验版、启用生产入口或实现后端；这不是完成的大模块，用户确认后才进入生产契约和真实集成。
