# Captain Open Game Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不建设生产后端和散客申请假入口的前提下，为“队长从真实订单创建开放球局”完成 375×812 Artifact、development-only 原生 Fixture 和一次同尺寸视觉确认。

**Architecture:** 复用已确认的小程序设计系统，以一份集中 Fixture 驱动创建、草稿管理、已发布管理和脱敏公开详情。生产订单页、生产路由和真实数据源不在本计划修改范围；共享 B1 资格只以批准的 `starts_at > now + 2h` 规则作为 Fixture 输入，客户端不实现第二套资格逻辑。

**Tech Stack:** HTML/CSS reference Artifact、微信小程序 TypeScript/WXML/WXSS、Jest、现有 development build、WeChat DevTools。

**Design:** `docs/superpowers/specs/2026-08-18-captain-open-game-design.md`

**Prerequisite:** 共享生命周期设计已批准并冻结 B2 资格；本计划仍不得实现生产契约、数据库、API 或启用“我要找球踢”。

**Current status (2026-08-21 root integration):** Task 1 reference Artifact and Task 2 development-only native Fixture have been migrated onto the current baseline. The root integration registers the three preview routes only in the central development manifest. Task 3 native capture and visual decision remain pending; no visual approval or production readiness is claimed.

**Integration ownership:** 本切片只提交 slice-local 页面、Fixture、路由片段和聚焦测试。`miniprogram/dev/app-pages.json`、`miniprogram/dev/bootstrap.ts`、中央 build/audit manifests/tests 以及最终 Fixture 删除，由 root 集成协调任务在合并所有活动切片后串行完成；不得让本分支的旧中央清单覆盖其他切片路由。

---

## Task 1: Build four proportional reference frames

**Files:**

- Create: `artifacts/ui/references/captain-open-game.html`
- Create: `artifacts/ui/references/captain-open-game.css`
- Create: `artifacts/ui/references/captain-open-game-data.js`
- Create: `artifacts/ui/flows/captain-open-game.md`
- Create: `artifacts/ui/screen-manifest/captain-open-game.yaml`
- Create: `artifacts/ui/reviews/captain-open-game/README.md`
- Create: `artifacts/ui/reviews/captain-open-game/review-board.html`
- Create: `tests/captain-open-game-artifact.test.mjs`
- Modify: `artifacts/ui/README.md`

- [x] **Step 1: Write the Artifact RED test**

Require exactly four `375×812` reference states:

1. `create-ready`：真实订单摘要、人数/名额/强度/位置/AA/截止/可见范围和保存草稿；
2. `draft-manage`：私有草稿、预览/编辑/放弃和真实“发布球局”；
3. `published-manage`：已发布、分享/公开页/编辑/取消；
4. `public-readonly`：脱敏公开信息和非交互“申请加入即将开放”。

Also require the flow to state that every visible enabled button has a Fixture transition, cancellation never changes the booking, and no contact/order/payment fields appear publicly.

Run:

```bash
node --test tests/captain-open-game-artifact.test.mjs
```

Expected: RED because the files do not exist.

- [x] **Step 2: Implement the reference using existing tokens**

Use the product palette and 4/8px rhythm already listed in the design. Keep the create frame focused: one column, visible labels, compact steppers, immutable booking card and safe-area footer. Do not add chat, teams dashboard, applications, reports, animations or a new icon family.

- [x] **Step 3: Capture and self-review four reference PNGs**

Capture each state at exactly 375×812. Check composition, geometry, hierarchy, typography/color/material, icons, copy/status honesty, text wrapping, dual-axis button/stepper centering and safe-area clearance. Record only visible issues and their disposition.

- [x] **Step 4: Run the focused check and commit**

```bash
node --test tests/captain-open-game-artifact.test.mjs
git add artifacts/ui tests/captain-open-game-artifact.test.mjs
git diff --cached --check
git commit -m "design: define captain open game journey"
```

## Task 2: Implement an isolated native Fixture preview

**Files:**

- Create: `miniprogram/dev/captain-open-game-fixture.ts`
- Create: `miniprogram/dev/captain-open-game-fixture.test.ts`
- Create: `miniprogram/dev/pages/captain-game-form/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/dev/pages/captain-game-manage/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/dev/pages/captain-game-public/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/dev/pages/captain-game-form/index.test.ts`
- Create: `miniprogram/dev/pages/captain-game-manage/index.test.ts`
- Create: `miniprogram/dev/pages/captain-game-public/index.test.ts`
- Create: `miniprogram/dev/captain-open-game-pages.json`
- Create: `tests/captain-open-game-native-preview.test.mjs`

- [x] **Step 1: Write focused RED tests**

Cover:

- eligible order opens the form; ineligible deep link shows a reason and real return action;
- steppers enforce total/fixed/open relationships and display adjacent errors;
- save creates a private draft snapshot without publishing;
- publish, preview, edit, share-failure, cancel confirmation and return all produce deterministic Fixture state or navigation;
- published public detail is read-only and contains no application button;
- slice-local route fragment contains the three preview pages, and no dev route/token is present in the production manifest/build.

Run:

```bash
npx jest miniprogram/dev/captain-open-game-fixture.test.ts \
  miniprogram/dev/pages/captain-game-form/index.test.ts \
  miniprogram/dev/pages/captain-game-manage/index.test.ts \
  miniprogram/dev/pages/captain-game-public/index.test.ts --runInBand
node --test tests/captain-open-game-native-preview.test.mjs
```

Expected: RED because the Fixture/pages do not exist.

- [x] **Step 2: Implement the minimal immutable Fixture**

Use one unmistakable `CAPTAIN_OPEN_GAME_FIXTURE` token under `miniprogram/dev`. The state machine may cover `ELIGIBLE → DRAFT → PUBLISHED → CANCELLED` plus `INELIGIBLE`, `SUSPENDED`, `SAVE_UNKNOWN` and `LOAD_ERROR`, but only the four representative states require visual capture. All business success is local and visibly development-only; production modules must not import it.

- [x] **Step 3: Run native preview GREEN checks**

```bash
npx jest miniprogram/dev/captain-open-game-fixture.test.ts \
  miniprogram/dev/pages/captain-game-form/index.test.ts \
  miniprogram/dev/pages/captain-game-manage/index.test.ts \
  miniprogram/dev/pages/captain-game-public/index.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
node --test tests/captain-open-game-native-preview.test.mjs
```

The focused Node test must validate `miniprogram/dev/captain-open-game-pages.json` and production isolation without editing the shared app-page/build manifests. A root integration task will merge this fragment with other active slice fragments and run the shared build/audit suite once.

- [x] **Step 4: Commit the isolated preview**

```bash
git add miniprogram/dev tests/captain-open-game-native-preview.test.mjs
git diff --cached --check
git commit -m "feat: preview captain open game journey"
```

## Task 3: Perform one same-size visual gate

**Files:**

- Modify: `artifacts/ui/reviews/captain-open-game/README.md`
- Add: four native PNGs and their side-by-side/overlay/difference outputs under `artifacts/ui/reviews/captain-open-game/`

- [ ] **Step 1: Capture the four native states once**

Use WeChat DevTools iPhone X at exactly 375×812. If automation fails once, use the documented manual capture instead of repairing the toolchain. Do not crop manufactured screenshots.

- [ ] **Step 2: Generate the four comparison sets**

For each reference/native pair run the existing `scripts/create_visual_review.py`. Inspect reference, native, side-by-side, 50% overlay and diff at actual size.

- [ ] **Step 3: Verify every visible action once**

Click save, publish, preview, edit, share, cancel, back/close and public read-only navigation in the native Fixture. Confirm labels remain centered, steppers align, long copy wraps, keyboard/fixed footer do not cover fields, and destructive confirmation is honest.

- [ ] **Step 4: Record the decision and commit**

The visual gate may be approved by the user or by the independent reviewer the user explicitly authorized for unattended decisions. Record who decided, the exact viewport, visible differences and whether production contract work may start. If not approved, fix only recorded visual blockers and repeat this representative pass once.

```bash
git add artifacts/ui/reviews/captain-open-game
git diff --cached --check
git commit -m "design: approve captain open game preview"
```

Stop after this task. Do not modify or clean shared route/build manifests in this branch. After all active slices are merged, the root integration task must merge `captain-open-game-pages.json` into the central development registration, verify every other route remains present, verify production exclusion, and only then own any later Fixture cleanup. A separate plan must freeze the production game contract/model/API before any production page is added. Keep “我要找球踢” disabled until the C1 application journey is real.
