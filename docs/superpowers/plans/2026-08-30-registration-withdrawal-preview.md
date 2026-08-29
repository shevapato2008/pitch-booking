# C2a 报名撤回与退出开发预览实施计划

> **For agentic workers:** REQUIRED: use subagent-driven development when independent files can be assigned safely. Follow RED → GREEN and keep production untouched.

**Goal:** 交付可供用户明早视觉确认的 C2a development-only Artifact 与微信原生预览。

**Design:** `docs/superpowers/specs/2026-08-30-registration-withdrawal-preview-design.md`

**Base:** `eb75889cbd1ee5f3921829d4ce3ebd1a985cfa3b`；branch `feature/c2a-registration-withdrawal-preview`。

**Hard boundary:** 只新增 C2a docs、Artifact、`miniprogram/dev/c2a-*`、对应 dev pages 和聚焦测试。不得修改 production page、backend、contracts、migration、deploy、`miniprogram/app.json` 或现有 C1 Fixture。

## Task 1: 交互 Artifact

**Files:**

- `tests/registration-withdrawal-artifact.test.mjs`
- `artifacts/ui/references/registration-withdrawal.{html,css,data.js}`
- `artifacts/ui/flows/registration-withdrawal.md`
- `artifacts/ui/screen-manifest/registration-withdrawal.yaml`
- `artifacts/ui/reviews/registration-withdrawal/{README.md,review-board.html}`

- [x] 先写 RED，覆盖五场景、确认/取消、名额释放一次、6 小时规则、终态无重新申请、375×812 与 `PENDING` gate。
- [x] 实现最小交互 Artifact；只有 `joined-confirm` 是代表截图状态。
- [x] 运行 `node --test tests/registration-withdrawal-artifact.test.mjs` 和 `git diff --check`。

## Task 2: 隔离 Fixture

**Files:**

- `miniprogram/dev/c2a-registration-withdrawal-fixture.ts`
- `miniprogram/dev/c2a-registration-withdrawal-fixture.test.ts`

- [x] RED 覆盖 `APPLIED | JOINED_EARLY | JOINED_LATE | WITHDRAWN | RESULT_UNKNOWN`、不可变快照、确认层、取消不写、幂等确认、严格 6 小时边界。
- [x] 实现 `C2A_REGISTRATION_WITHDRAWAL_FIXTURE` 和单一 store；不得伪装 HTTP 或写生产状态。
- [x] 运行聚焦 Jest 与 typecheck。

## Task 3: 三个 development-only 原生页

**Files:**

- `miniprogram/dev/c2a-registration-withdrawal-pages.json`
- `miniprogram/dev/pages/c2a-withdrawal-scenario/index.{ts,wxml,wxss,json,test.ts}`
- `miniprogram/dev/pages/c2a-my-registrations/index.{ts,wxml,wxss,json,test.ts}`
- `miniprogram/dev/pages/c2a-registration-detail/index.{ts,wxml,wxss,json,test.ts}`
- `tests/registration-withdrawal-native-preview.test.mjs`

- [x] RED 覆盖场景启动、列表进详情、精确详情投影、确认/取消、终态跨页回读、滚动位置恢复、结果待确认、返回、每个可见按钮 handler、scroll/safe-area/双轴居中与 production 隔离。
- [x] 实现三页；详情必须可以滚动，固定动作栏不遮挡内容，确认层动作真实连接 Fixture；独立薄列表不得修改 C1c Fixture。
- [x] fresh development build 包含三页；fresh production build/audit 不含 C2a marker、路由和合成文案。

## Task 4: 一次代表性微信视觉自审

- [x] 在官方微信开发者工具 iPhone X `375×812` 打开 `joined-confirm`，并以 Nexus 5X `411×731` 复核 Android。
- [x] 实际点击场景、退出、保留报名、再次退出、确认、返回；每个可见按钮至少一次。
- [x] 捕获 reference、iOS 与 Android native implementation，生成 side-by-side、overlay、difference。
- [x] 人工检查按钮居中、重复元素列线、图标、裁切、滚动、固定底栏、安全区和关键文案；只修复一眼可见的问题。
- [x] 运行 Artifact + fixture + 三页 + isolation 的聚焦门、typecheck、fresh development/production build、package audit 和 diff-check。
- [x] 独立代码复审通过；记录 `Implementation self-review: PASS`、`User visual gate: PENDING`。

停止在用户视觉确认门。不要实现生产 API、部署或上传 C2a。
