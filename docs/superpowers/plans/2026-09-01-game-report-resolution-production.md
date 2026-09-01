# C2f Game Report Resolution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to execute this plan task-by-task, and follow strict TDD for every behavior.

**Goal:** 让真实报名者能够在球局结束后 30 天内对本场球局及组织者提交一条结构化举报，并让 `PLATFORM_ADMIN` 以不可变审计完成驳回、成立记录或符合条件时真实取消公开球局。

**Architecture:** 先用完全隔离的内存 Fixture 冻结小程序举报页和平台处置台；收到 C2e 最终 HEAD 后，再以不可变 `open_game_reports` + 一对一 append-only resolution 实现生产闭环。写事务统一遵守 `Order → OpenGame → Registration/Report` 锁序；平台取消只改变 OpenGame，不改变订单、支付或退款，并冻结同订单替代球局。

**Tech Stack:** FastAPI、同步 SQLAlchemy Session、Alembic/PostgreSQL、OpenAPI 3.0、TypeScript/vanilla platform-admin、微信小程序 TypeScript/WXML/WXSS、pytest、Node test、Jest、官方微信开发者工具。

---

**Design:** [C2f 结构化举报与平台人工处置设计](../specs/2026-09-01-game-report-resolution-design.md)

**Preview baseline:** `3f361c92` + C2f design commits `3606289`、`96efd38`。

**Status:** `DESIGN_APPROVED_PREVIEW_AUTHORIZED_PRODUCTION_BLOCKED_ON_C2E_HEAD`。

## 硬边界与阶段门

- 阶段 A 只能新增 development-only preview、Fixture、聚焦测试和视觉清单；不得修改 production contract、migration、backend、platform-admin production UI 或小程序 production route。
- 所有 preview source 必须带唯一 marker，不能发起网络请求、写浏览器/小程序持久存储或导入 production service。
- 阶段 B 必须等根任务提供包含 C2e `0023` 的最终 HEAD，再把 C2d 基线修复 `db9387a` 一并纳入并重新验证；`0024` 严格依赖 `0023`。
- 举报对象固定为 game + organizer；类别严格五值，平台结论严格三值，不增加通用工单、处罚、封禁、自动信用、退款或 `SUSPENDED`。
- reporter 必须存在该 game 的报名；一名用户同一 game 只能有一条不可修改举报。
- 平台取消只在未开场、持久/有效 `PUBLISHED`、订单 `CONFIRMED` 且健康时可选；它不改变订单、场次、支付或退款数据。
- `PLATFORM_REPORT` 取消后，同一 order 的 create/publish 替代球局必须拒绝；`CAPTAIN` 取消保留既有重建语义。
- 用户验收前不合并 `main`、不部署、不上传体验版；最终视觉结论必须由未参与实现的独立 agent 给出。

# 阶段 A：隔离视觉预览

## Task 1：以 TDD 冻结平台 Fixture store 与页面壳

**Files:**

- Create: `platform-admin/dev-game-report-resolution/fixture.js`
- Create: `platform-admin/dev-game-report-resolution/app.js`
- Create: `platform-admin/dev-game-report-resolution/index.html`
- Create: `platform-admin/dev-game-report-resolution/styles.css`
- Create: `tests/game-report-resolution-platform-preview.test.mjs`

### 1.1 先写失败测试

冻结 marker：

```js
const GAME_REPORT_RESOLUTION_FIXTURE_MARKER = "GAME_REPORT_RESOLUTION_FIXTURE";
```

测试覆盖：

- 默认 principal 为 `PLATFORM_ADMIN`；切换 `ONBOARDING_REVIEWER` 后模块隐藏且 store 拒绝队列、详情和处置；
- 待处理/已结案筛选、稳定分页、刷新、选择行都读取真实内存 authority；
- 详情只含任务内字段，不含 user ID、手机、OpenID、报名备注、订单号、支付或退款信息；
- 五种类别与三种结果文案一一映射，未知值 fail closed；
- 处置说明标准化后为 `1..500` code points，拒绝 URL、邮箱、手机号、座机和明确联系账号；
- 只有 Fixture 服务端给出的 `allowedOutcomes` 能选择；取消资格消失时确认返回诚实冲突并刷新；
- cancel 不写，confirm 只追加一条 resolution；取消结果仅改变 Fixture game status/version/source；
- Fixture order/slot/payment/refund snapshot 在取消前后 byte-equivalent；
- unknown result 锁定筛选、选择和二次提交，先读权威详情，仍 pending 才以原 key/body 重放；
- dialog 的关闭、Escape、Tab/Shift+Tab focus trap、焦点恢复、退出登录、分页和刷新都有真实行为；
- source 不出现 fetch/XHR/WebSocket/sendBeacon/localStorage/sessionStorage。

Run:

```bash
node --test tests/game-report-resolution-platform-preview.test.mjs
```

Expected: RED，因为 preview 尚不存在。

### 1.2 最小实现

复用现有平台壳的视觉语言，不创建新 design-token 层。`fixture.js` 提供确定性 authority/store；`app.js` 只负责 DOM 绑定、dialog/focus 和 URL case 初始化。支持：

```text
?case=pending-detail
?case=cancel-confirm
?case=resolved-recorded
?case=resolved-dismissed
?case=resolved-cancelled
?case=state-changed
?case=unknown-result
```

页面始终可见写明“Development-only Fixture / 模拟数据，不会提交或修改生产数据”。只有前两个 case 进入代表性截图矩阵，其余只做行为点检。

### 1.3 GREEN 并提交

```bash
node --test tests/game-report-resolution-platform-preview.test.mjs
git diff --check
git add platform-admin/dev-game-report-resolution \
  tests/game-report-resolution-platform-preview.test.mjs
git commit -m "feat(c2f): preview platform report resolution"
```

## Task 2：以 TDD 实现隔离的小程序举报 Fixture

**Files:**

- Create: `miniprogram/dev/c2f-game-report-fixture.ts`
- Create: `miniprogram/dev/c2f-game-report-fixture.test.ts`
- Create: `miniprogram/dev/c2f-game-report-pages.json`
- Create: `miniprogram/dev/pages/c2f-game-report-scenario/index.ts`
- Create: `miniprogram/dev/pages/c2f-game-report-scenario/index.json`
- Create: `miniprogram/dev/pages/c2f-game-report-scenario/index.wxml`
- Create: `miniprogram/dev/pages/c2f-game-report-scenario/index.wxss`
- Create: `miniprogram/dev/pages/c2f-game-report-scenario/index.test.ts`
- Create: `miniprogram/dev/pages/c2f-game-report/index.ts`
- Create: `miniprogram/dev/pages/c2f-game-report/index.json`
- Create: `miniprogram/dev/pages/c2f-game-report/index.wxml`
- Create: `miniprogram/dev/pages/c2f-game-report/index.wxss`
- Create: `miniprogram/dev/pages/c2f-game-report/index.test.ts`

### 2.1 先写 Fixture RED

冻结 marker：

```ts
export const C2F_GAME_REPORT_FIXTURE_MARKER = "C2F_GAME_REPORT_FIXTURE";
```

测试覆盖：

- inventory 只声明 scenario/report 两条 custom-navigation dev route；
- reporter context 有真实报名快照，陌生用户返回 `REPORT_CONTEXT_NOT_FOUND`；
- 五个类别严格闭合；facts 标准化、code-point 计数、`1..500` 与敏感内容向量和平台一致；
- 一名用户/一场一条，首次 submit、同 key/body replay、同 key 异 body、不同 key 二次提交语义准确；
- 截止为权威 endsAt + 30 天且相等时关闭；已有举报过期后仍可读取；
- confirm cancel 不写，confirm submit 写入一条 pending report；
- unknown result 先 GET，已存在则恢复；不存在且仍开放才以原 key/body 重放；
- 三种结论只显示准确结果，不声称处罚、封禁、退款或通知；
- Fixture 不调用 production service、不发网络、不写 storage。

Run:

```bash
npx jest --runInBand miniprogram/dev/c2f-game-report-fixture.test.ts
```

Expected: RED，因为 Fixture 尚不存在。

### 2.2 实现最小 authority/store

Fixture 只保存在模块内存中，scenario 每次重置。共享纯函数负责 normalization、code-point count、敏感内容检测、digest/replay 语义和用户结果投影，不抽象成通用举报框架。

### 2.3 GREEN 并提交

```bash
npx jest --runInBand miniprogram/dev/c2f-game-report-fixture.test.ts
npx eslint miniprogram/dev/c2f-game-report-fixture.ts
git diff --check
git add miniprogram/dev/c2f-game-report-fixture.ts \
  miniprogram/dev/c2f-game-report-fixture.test.ts \
  miniprogram/dev/c2f-game-report-pages.json
git commit -m "feat(c2f): model report preview authority"
```

## Task 3：以 TDD 完成小程序 scenario 与举报页

### 3.1 先写页面 RED

覆盖：

- scenario 明确写“C2f 开发预览 · 模拟数据”，每个状态按钮真实 navigateTo；
- report 页显示球局、组织球队、场地、时间和“对象为本场球局及组织者”；
- 五个 radio 有完整文字、稳定尺寸与选中态；textarea 有可见 label、`0/500` code-point 计数、隐私提示和内联错误；
- 提交先打开确认层，取消回到表单，确认才调用 Fixture submit；
- pending、三种 resolved、expired、PII error、unknown-result recovery 都有诚实页面；
- 返回有历史时 `navigateBack`，无历史时回 scenario；所有页面不可分享；
- 重新加载、确认原结果与同 key 重放按钮调用真实 Fixture 行为；
- 按钮显式 flex 双轴居中，触控区至少 48rpx 对应目标设备要求；滚动内容为固定底栏和 safe area 留空间；
- 长中文/英文事实、500 字计数、错误和状态不裁切。

Run:

```bash
npx jest --runInBand \
  miniprogram/dev/pages/c2f-game-report-scenario/index.test.ts \
  miniprogram/dev/pages/c2f-game-report/index.test.ts
```

Expected: RED，因为页面尚不存在。

### 3.2 最小页面实现

scenario 支持 `form|pending|resolved-dismissed|resolved-recorded|resolved-cancelled|expired|unknown`。report 页只依赖 Fixture adapter；不复制 production HTTP client，不写 storage，不在 dev 之外注册 route。

### 3.3 GREEN 并提交

```bash
npx jest --runInBand \
  miniprogram/dev/c2f-game-report-fixture.test.ts \
  miniprogram/dev/pages/c2f-game-report-scenario/index.test.ts \
  miniprogram/dev/pages/c2f-game-report/index.test.ts
npm run typecheck
npx eslint \
  miniprogram/dev/c2f-game-report-fixture.ts \
  miniprogram/dev/pages/c2f-game-report-scenario/index.ts \
  miniprogram/dev/pages/c2f-game-report/index.ts
git diff --check
git add miniprogram/dev/pages/c2f-game-report-scenario \
  miniprogram/dev/pages/c2f-game-report
git commit -m "feat(c2f): preview player game report journey"
```

## Task 4：证明隔离并完成独立视觉门

**Files:**

- Create: `tests/game-report-resolution-preview-isolation.test.mjs`
- Create: `artifacts/ui/screen-manifest/game-report-resolution.yaml`
- Create: `artifacts/ui/flows/game-report-resolution.md`

### 4.1 先写 isolation RED

测试 fresh development mini build 包含两条 C2f route；fresh production mini build 和 fresh platform build 均不含两个 marker、dev route、模拟 UUID/球局名或 dev source。只在新聚焦测试内检查，不修改共享 audit 脚本。

```bash
node --test tests/game-report-resolution-preview-isolation.test.mjs
```

### 4.2 实现清单与构建证明

manifest 只列四组代表画面：

- platform `pending-detail`、`cancel-confirm`，`1440×900`；
- mini `report-form`、`resolved-cancelled`，iOS `390×844` 与 Android `411×731`。

flow 记录所有可见按钮对应的真实 Fixture 行为、生产接入条件和 Fixture 删除条件。

### 4.3 自审、独立审核并提交 checkpoint

先由实现者在目标 runtime 检查按钮双轴居中、重复控件对齐、箭头/X、裁切、长文案、滚动、fixed footer/safe area、dialog focus/Escape。再由未参与实现的独立 agent 审核四组代表画面；只有 Critical 0 / Important 0 才记录 `DELEGATED_VISUAL_PASS`。

```bash
node --test \
  tests/game-report-resolution-platform-preview.test.mjs \
  tests/game-report-resolution-preview-isolation.test.mjs
npx jest --runInBand \
  miniprogram/dev/c2f-game-report-fixture.test.ts \
  miniprogram/dev/pages/c2f-game-report-scenario/index.test.ts \
  miniprogram/dev/pages/c2f-game-report/index.test.ts
npm run typecheck
git diff --check
git add tests/game-report-resolution-preview-isolation.test.mjs \
  artifacts/ui/screen-manifest/game-report-resolution.yaml \
  artifacts/ui/flows/game-report-resolution.md
git commit -m "test(c2f): verify report preview isolation"
```

到这里向根任务发送 preview checkpoint，等待 C2e 最终 HEAD。不得提前进入以下阶段。

# 阶段 B：生产闭环（收到 C2e 最终 HEAD 后）

## Task 5：接入最终基线并重新确认架构

1. 取得根任务明确提供的 C2e 完成 SHA，确认包含 migration `0023` 和 C2d 测试修复 `db9387a`；不要吸收其他漂移。
2. 在本 feature branch 上按根任务指定方式 rebase/cherry-pick，并解决共享 contract/model/UI 冲突；保留 C2f preview commits。
3. 运行 `npm test`、backend full pytest、ruff/diff-check；任何新失败先用 systematic-debugging 判断是否为基线或 C2f。
4. 重新读取 C2e 最终报名状态/复合键、球局取消/重建路径和 OpenAPI head；如与已审设计不一致，先修订设计/计划再写 production code。

## Task 6：以 TDD 冻结封闭 OpenAPI 与跨语言文本向量

**Files:**

- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/open-game-report-context.json`
- Create: `contracts/examples/open-game-report-submitted.json`
- Create: `contracts/examples/platform-game-report-list.json`
- Create: `contracts/examples/platform-game-report-detail.json`
- Create: `contracts/examples/platform-game-report-resolved.json`
- Create: `contracts/examples/game-report-text-vectors.json`
- Create: `tests/game-report-resolution-contract.test.mjs`

先写 RED，锁定两条 user 路径、三条 platform 路径、严格枚举/closed object、`Idempotency-Key`、状态码、最小隐私投影、allowed outcomes 和共享文本向量。实现后运行聚焦测试与 `npm run contract:validate`，提交 `feat(c2f): freeze game report contract`。

## Task 7：实现 `0024` 不可变举报/处置与取消来源

**Files:**

- Create: `backend/migrations/versions/0024_open_game_reports.py`
- Modify: `backend/app/models.py`
- Create: `backend/tests/test_open_game_report_migration.py`
- Modify: existing migration-head/cycle assertions required by the new head

TDD 必查：严格五类别/三结论、复合 reporter registration FK、两个唯一约束、append-only triggers、resolution 版本 pair、所有非 CANCELLED source/time 均为空、历史 CANCELLED 回填 CAPTAIN、存在审计或 PLATFORM_REPORT 时 downgrade fail-closed。migration 必须 `down_revision = "0023"`。聚焦 PostgreSQL migration GREEN 后提交。

## Task 8：实现用户本人举报服务与 API

**Files:**

- Create: `backend/app/modules/open_game_reports/__init__.py`
- Create: `backend/app/modules/open_game_reports/dto.py`
- Create: `backend/app/modules/open_game_reports/text_policy.py`
- Create: `backend/app/modules/open_game_reports/repository.py`
- Create: `backend/app/modules/open_game_reports/service.py`
- Create: `backend/app/modules/open_game_reports/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_open_game_report_service.py`
- Create: `backend/tests/test_open_game_report_api.py`
- Create: `backend/tests/test_open_game_report_concurrency.py`
- Modify: `backend/tests/test_openapi_conformance.py`

先写 service/API/concurrency RED：报名资格覆盖所有真实持久报名状态、陌生用户 404、endsAt+30d 边界、文本向量、Order→OpenGame→Registration 锁序、organizer snapshot、唯一/幂等/竞争、本人只读结果和隐私闭合。实现最小 module 和 composition-root 注册，聚焦 GREEN 后提交。

## Task 9：实现平台队列、详情与真实处置事务

**Files:**

- Create: `backend/app/modules/platform_game_reports/__init__.py`
- Create: `backend/app/modules/platform_game_reports/dto.py`
- Create: `backend/app/modules/platform_game_reports/repository.py`
- Create: `backend/app/modules/platform_game_reports/service.py`
- Create: `backend/app/modules/platform_game_reports/router.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/modules/open_games/service.py`
- Modify: `backend/app/modules/open_games/lifecycle.py`
- Create: `backend/tests/test_platform_game_report_service.py`
- Create: `backend/tests/test_platform_game_report_api.py`
- Create: `backend/tests/test_platform_game_report_concurrency.py`

先写 RED：仅 PLATFORM_ADMIN、opaque cursor、详情隐私、三结论、动态 allowed outcomes、Order→OpenGame→Report/Resolution 锁序、state-changed 409、idempotency、append-only audit。取消用 before/after 快照证明 Order/Slot/Payment/RefundCase/RefundAttempt 全字段不变，只更新 game status/time/source/version 和失效通知 outbox。另写 create/publish 回归：同 order 存在 PLATFORM_REPORT 取消则拒绝，CAPTAIN 取消不受影响。聚焦 GREEN 后提交。

## Task 10：接入真实 platform-admin 举报处置模块

**Files:**

- Modify: `platform-admin/src/api.ts`
- Modify: `platform-admin/src/auth.ts`
- Modify: `platform-admin/src/main.ts`
- Create: `platform-admin/src/game-report-resolution.ts`
- Modify: `platform-admin/index.html`
- Modify: `platform-admin/styles.css`
- Modify: `platform-admin/tsconfig.json`
- Modify: `scripts/build-platform-admin.mjs`
- Modify: `backend/app/modules/platform_web.py`
- Modify/Create: focused platform source/build/web tests

先写 API/controller/role/dialog/unknown-result RED，再复用现有 shell 接入真实 API。所有筛选、刷新、分页、选择、退出、取消、确认、Escape/Tab 都有真实行为；不沿用 Fixture store。构建必须发布新 JS asset 且 backend 静态路由可读，production build 仍排除 dev marker。GREEN 后提交。

## Task 11：接入真实小程序举报页

**Files:**

- Create: `miniprogram/domain/open-game-report.ts`
- Create: `miniprogram/domain/open-game-report-decoder.ts`
- Create: `miniprogram/domain/open-game-report-decoder.test.ts`
- Create: `miniprogram/services/http-open-game-report.ts`
- Create: `miniprogram/services/http-open-game-report.test.ts`
- Create: `miniprogram/pages/open-game-report/index.ts`
- Create: `miniprogram/pages/open-game-report/index.json`
- Create: `miniprogram/pages/open-game-report/index.wxml`
- Create: `miniprogram/pages/open-game-report/index.wxss`
- Create: `miniprogram/pages/open-game-report/index.test.ts`
- Modify: `miniprogram/app.json`
- Modify: the existing self-registration detail entry point identified after C2e integration
- Modify/Create: focused presentation/source tests

先写 strict decoder、HTTP、attempt recovery、page state 与入口 RED。生产 attempt 按账号/game 持久化；unknown result 必须 GET 恢复或原 key/body 重放。Fixture 不进入 production imports，所有按钮接真实导航/HTTP/state。iOS/Android 代表 viewport 自审通过后提交。

## Task 12：真实 HTTP journey、全量验证与独立终审

**Files:**

- Create: `backend/tests/test_game_report_resolution_http_journey.py`
- Modify: `scripts/audit-production-package.mjs` and focused audit tests only if existing deny-list cannot prove C2f exclusion
- Create/Update: `artifacts/ui/reviews/game-report-resolution.md`

真实 journey 建立已报名球员，提交/重放举报，管理员读取并三路处置；取消路径证明 game cancelled、source/version/audit 准确且订单/支付/退款不变，用户回读准确。另测 role/CSRF/Origin、窗口关闭、PII、state change、替代球局冻结和 CAPTAIN 重建回归。

最后在干净树运行 contract、Node/Jest、typecheck、backend full pytest、ruff、platform/mini production build/audit、`git diff --check`。由未参与实现的独立 agent 做代码与目标 runtime 视觉终审，只修 Critical/Important。

## Task 13：用户验收 checkpoint

- 推送 feature branch，整理可复现的管理员/举报者/其他用户验收账号与数据；不得合并 `main`。
- 只在根任务明确授权后部署 staging、执行 `0024` 和上传候选体验版。
- 用户验收必须验证：本人唯一举报、平台三结论、平台取消不动订单/退款、非本人不可读、Android/iOS 滚动与 safe area、所有按钮真实。
- 用户明确通过后，才使用 finishing-a-development-branch 流程决定合并、推送和发布。

## 验收标准

- 只有真实报名者能在截止前对 game+organizer 提交一条结构化举报；服务端权威、PII/URL 过滤和幂等边界准确。
- 普通用户只看到自己的事实与固定结果；平台读取/处置仅 PLATFORM_ADMIN，resolution 不可变可审计。
- 平台取消只在严格资格下持久化 `CANCELLED/PLATFORM_REPORT`，冻结同订单替代球局，且订单/支付/退款 byte-equivalent。
- 小程序与平台所有可见按钮均有真实端到端行为；production build 不含 Fixture marker、route 或模拟数据。
- 独立 agent 审核无 Critical/Important 遗留；用户验收前不合 main、不部署、不上传体验版。
