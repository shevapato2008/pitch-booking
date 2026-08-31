# C2d 平台到场纠错生产实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to execute this plan task-by-task, and follow strict TDD for every production behavior.

**Goal:** 让 `PLATFORM_ADMIN` 能够按报名 UUID 精确查询并将已完成球局的单个散客到场结果在 `PRESENT ↔ NO_SHOW` 之间纠正，保留不可变审计，并让队长和球员从生产 API 回读当前结果与最新纠错时间。

**Architecture:** 在现有 C2c 报名/到场领域上增加专用 append-only correction event 表和独立 platform-admin 模块。写事务继续使用 `Order → OpenGame → Registration` 锁顺序，原始队长记录永不改写。平台后台使用现有会话/CSRF/Origin 壳；小程序只扩展现有队长名册与本人报名投影，不暴露原因、principal 或历史。

**Tech stack:** FastAPI, synchronous SQLAlchemy Session, Alembic/PostgreSQL, OpenAPI 3.0, TypeScript/vanilla platform-admin, WeChat Mini Program TypeScript/WXML/WXSS, pytest, Node test, Jest.

**Baseline:** `112fcbd2cd2eda6cab6997d20badfda7ccd4d828` + preview commit cherry-picked as `b3a4168` on `feature/c2d-attendance-correction-production`.

**Design:** [C2d 平台到场人工纠错设计](../specs/2026-08-31-attendance-correction-design.md).

**Status:** `APPROVED_AFTER_INDEPENDENT_PLAN_REVIEW` (2026-09-01). 独立审阅发现的任务顺序、production build 和球员回读 IA 问题均已纳入本版。

## 硬边界

- 只有 `PLATFORM_ADMIN` 可查询与纠错；`ONBOARDING_REVIEWER` 对 UI 隐藏、对 API 返回 403。
- 只按完整报名 UUID 查询，不做姓名、手机号、OpenID 或模糊搜索。
- 只纠正已完成球局、`JOINED` 报名、原始到场审计完整且当前为终态的记录。
- 不增加工单、举报、通知、处罚、报表、通用搜索或通用 RBAC。
- 小程序不显示纠错理由、平台 principal 或完整历史；复制报名编号必须调用真实 `wx.setClipboardData`。
- 保留 development-only C2d Fixture 用于预览，但 production build/audit 必须持续排除 marker、route 和合成数据。
- 晨间用户验收前可提交、推送、部署 staging 并上传候选体验版，不合并入 `main`。

## Task 1：冻结静态 OpenAPI 契约

**Files:**

- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/platform-attendance-registration-detail.json`
- Create: `contracts/examples/platform-attendance-correction-event.json`
- Create: `tests/platform-attendance-correction-contract.test.mjs`

1. 先写失败静态契约测试，锁定 GET/POST 路径、operationId、`Idempotency-Key` 16..128、body 字段闭合、详情/event 最小隐私投影以及 401/403/404/409/422/503 语义。POST 新建与幂等重放均固定返回 `200`。
2. 增加静态 schema/example；对合法终态投影唯一相反 `target_status`，对不可纠错状态投影 `target_status: null` 与闭合 `blocked_reason`。
3. 本任务不要求尚未存在的运行时路由；先看 `node --test tests/platform-attendance-correction-contract.test.mjs` RED，实现后跑同命令及 `npm run contract:validate` GREEN 并提交。

## Task 2：实现 `0022` append-only 纠错审计

**Files:**

- Create: `backend/migrations/versions/0022_open_game_attendance_corrections.py`
- Modify: `backend/app/models.py`
- Create: `backend/tests/test_open_game_attendance_correction_migration.py`

1. 先写迁移 RED：表、FK `RESTRICT`、终态/理由/principal/version/hash check、两个 unique 约束，以及存在历史时 downgrade 明确拒绝。
2. 用 PostgreSQL `BEFORE UPDATE OR DELETE` trigger 拒绝任何已写 event 的更新/删除，并以聚焦迁移测试证明 append-only；这只保护本表，不抽象通用审计框架。
3. 增加最小 ORM model 和关系。
4. 对临时 PostgreSQL 跑 `pytest backend/tests/test_open_game_attendance_correction_migration.py -q` 及 `git diff --check`，然后提交。

## Task 3：实现平台查询、事务纠错与授权

**Files:**

- Create: `backend/app/modules/platform_attendance_corrections/__init__.py`
- Create: `backend/app/modules/platform_attendance_corrections/dto.py`
- Create: `backend/app/modules/platform_attendance_corrections/repository.py`
- Create: `backend/app/modules/platform_attendance_corrections/service.py`
- Create: `backend/app/modules/platform_attendance_corrections/router.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_openapi_conformance.py`
- Create: `backend/tests/test_platform_attendance_correction_service.py`
- Create: `backend/tests/test_platform_attendance_correction_api.py`
- Create: `backend/tests/test_platform_attendance_correction_concurrency.py`

1. 先写 service RED：精确查询、严格 eligibility、反向终态、理由 trim/Unicode 长度、原始审计不变、append event 和 version `+1`。
2. 写并发/幂等 RED：固定锁序，同 principal/key 同摘要必须在任何当前版本判定之前重放首次 event；不同摘要 409，不同 key 竞争同版本只有一次成功。
3. 写 API RED：GET 要求 platform session + `PLATFORM_ADMIN`；POST 另要求 Origin + CSRF。`ONBOARDING_REVIEWER` 统一 403，无效 UUID/header/body 为 422，不返回禁止的隐私字段。
4. 实现独立 module 并在 composition root 注册路由；将两个 operationId 纳入 `backend/tests/test_openapi_conformance.py` 的运行时对齐。
5. 跑 `pytest backend/tests/test_platform_attendance_correction_*.py backend/tests/test_openapi_conformance.py -q` 后提交。

## Task 4：接入真实 platform-admin 纠错模块

**Files:**

- Modify: `platform-admin/src/api.ts`
- Modify: `platform-admin/src/auth.ts`
- Modify: `platform-admin/src/main.ts`
- Create: `platform-admin/src/attendance-correction.ts`
- Modify: `platform-admin/index.html`
- Modify: `platform-admin/styles.css`
- Modify: `platform-admin/tsconfig.json`
- Modify: `scripts/build-platform-admin.mjs`
- Modify: `tests/build-platform-admin.test.mjs`
- Modify: `platform-admin/src/api.test.ts`
- Modify: `platform-admin/src/auth.test.ts`
- Modify: `platform-admin/src/main.test.ts`
- Create: `platform-admin/src/attendance-correction.test.ts`

1. 先写 API/controller/role 失败测试：完整 UUID 查询、清除、理由校验、确认 dialog、幂等键复用、unknown result 先 GET 和权限隐藏。
2. 复用现有平台壳与 API client，新建独立 `AttendanceCorrectionController`；不把功能塞入 onboarding `ReviewController`。
3. 对 `1440×900` 只做 `ready` 与 `confirm` 两个代表状态的真实运行时视觉审核；其他状态聚焦点检。
4. 构建器必须发布 `attendance-correction.js` 并为其浏览器 import 补 `.js`，同时保持 Fixture 排除断言。跑 `npx jest --runInBand platform-admin/src/*.test.ts`、`npm run build:platform-admin` 和 `node --test tests/build-platform-admin.test.mjs` 后提交。

## Task 5：接入队长与球员小程序权威回读

**Files:**

- Modify: `contracts/openapi.yaml`
- Modify: relevant C2c example JSON under `contracts/examples/`
- Modify: `miniprogram/domain/open-game-registration.ts`
- Modify: `miniprogram/domain/open-game-registration-decoder.ts`
- Modify: `miniprogram/domain/open-game-registration-decoder.test.ts`
- Modify: `miniprogram/services/http-open-game-registration.ts`
- Modify: `miniprogram/services/http-open-game-registration.test.ts`
- Modify: `miniprogram/pages/captain-game-attendance/index.ts`
- Modify: `miniprogram/pages/captain-game-attendance/index.wxml`
- Modify: `miniprogram/pages/captain-game-attendance/index.wxss`
- Modify: `miniprogram/pages/captain-game-attendance/index.test.ts`
- Modify: `miniprogram/pages/my-game-registrations/index.ts`
- Modify: `miniprogram/pages/my-game-registrations/index.wxml`
- Modify: `miniprogram/pages/my-game-registrations/index.wxss`
- Modify: `miniprogram/pages/my-game-registrations/index.test.ts`
- Modify: `miniprogram/presentation/my-game-registrations.ts`
- Modify: `miniprogram/presentation/my-game-registrations.test.ts`
- Modify: `miniprogram/pages/captain-game-public/index.ts`
- Modify: `miniprogram/pages/captain-game-public/index.wxml`
- Modify: `miniprogram/pages/captain-game-public/index.wxss`
- Modify: `miniprogram/pages/captain-game-public/index.test.ts`
- Modify: `backend/app/modules/open_game_registrations/{dto.py,privacy.py,repository.py,router.py,service.py}` as required by the frozen projections
- Modify: focused C2c backend tests as required

1. 先以契约/decoder/page 测试冻结对队长和球员唯一新增的 `attendance_corrected_at` 投影，并确保 reason/principal/history 不出现。
2. 采用独立 IA 裁决的最小方案：不新建私有详情页。“我的报名”卡片只增加紧凑的“平台已纠正 · 时间”摘要；现有 `captain-game-public` 依据 `viewerRegistration` 作为本人权威详情，显示当前结果、原始记录时间、纠错时间和“复制报名编号”。避免在整卡 `<button>` 内嵌套按钮。
3. 队长名册行同样显示当前状态、原始记录时间与“平台已纠正”时间；使用已有报名 UUID，不新建业务编号。
4. 复制按钮调用真实 `wx.setClipboardData`，success/fail 回调更新可见内联反馈，失败可重试。
5. 跑后端聚焦 pytest、decoder/service/page Jest、`npm run typecheck`、production package build/audit 后提交。

## Task 6：真实本地 HTTP 端到端闭环

**Files:**

- Create: `backend/tests/test_platform_attendance_correction_http_journey.py`
- Modify: existing build/audit/journey tests only where needed

1. 先写失败 journey：建立已完成球局和已记录到场的 `JOINED` 报名，平台管理员查询、纠正、重放同 key，队长/球员再回读同一当前状态和 corrected time。
2. 验证 reviewer 403、禁止隐私字段、原始 recorded audit 未改写、event 只追加一次。
3. 跑新 journey + 原 C2c attendance journeys，然后跑合同生成器、production build/audit 和 `git diff --check`，提交。

## Task 7：独立规格、代码与视觉审核

1. 由未参与实现的独立 agent 对照设计逐项检查 API、授权、并发/幂等、审计不可变性、隐私投影和所有按钮真实性。
2. 平台以真实 `1440×900` runtime 审核 `ready/confirm`；小程序以微信开发者工具的 iOS `390×844` 与 Android `411×731` 审核队长/球员两个页面。
3. 必查按钮双轴居中、重复控件对齐、箭头/X 完整、边界/裁切、滚动、safe area、键盘/焦点、长文案和状态数据。
4. 只修复 Critical/Important 问题；辅助 UI 通道失败时只合理重试一次，仍失败则记录设备门待用户晨间验证。

## Task 8：统一验证、staging 部署与体验版候选

1. 在干净分支上跑完整 Node/Jest/pytest/typecheck/build/production-audit 和 `git diff --check`；不用旧结果代替最终验证。
2. 推送 feature branch，对 staging 执行 `0022` 迁移与服务部署。
3. 选取专用 staging 报名，做一次 `PRESENT → NO_SHOW → PRESENT` 双向纠错并验证两条 append-only event、队长/球员回读与原始记录未改。
4. 构建并上传新版本小程序，项目备注写明 C2d 和当前支付关闭状态。若微信后台的“设为体验版”受站点安全限制，上传后在晨间清单中给用户一个最小手动步骤，不绕过限制。
5. 不合并 `main`；整理变更、审核结果、版本号、staging 证据和晨间手动验收步骤。

## 验收标准

- 平台只能精确查询并纠正合法终态，权限、幂等、竞争与 unknown-result 均返回诚实权威结果。
- 原始队长记录永不改写，每次纠错 append-only 且可按版本重建。
- 平台不泄露任务外隐私；队长/球员不获取 reason、principal 或历史。
- 小程序两个回读页显示同一当前结果，复制报名编号为真实可重试行为。
- 所有可见 product button 有对应真实业务行为；production build 不包含 C2d Fixture marker/route/data。
- 独立 agent 审核无 Critical/Important 遗留，或设备通道阻塞被诚实列入晨间手动门。
