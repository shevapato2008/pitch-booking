# C2c-P 队长赛后到场记录生产接入实施计划

> **For agentic workers:** use subagent-driven development for bounded tasks, test-driven development for every behavior, and verification-before-completion before any release claim.

**Goal:** 在已通过双平台原生预览的 C2c 基础上，接通真实 `Order.COMPLETED → 队长逐人记录 → 玩家本人权威回读`，同时保持报名状态、候补历史、容量、订单与公开隐私边界不变。

**Design:** `docs/superpowers/specs/2026-08-30-attendance-recording-foundation-design.md`

**Base:** `db48dc003b894de7cf8e8e7022235579039f0a38`（C2c preview freeze）。

**Hard boundary:** 本计划只实现 attendance foundation。不得增加批量标记、队长改判、评分、信用、处罚、举报、通知、固定队员到场或公开名单。误记录纠错属于后续 C2d；C2d、C2b 通知外部门、物理双端和多账号 staging 未通过前，不得宣称 C2c 生产完成，不得合并、部署或上传统一体验版。

## Task 0：冻结预览与执行基线

**Files:**

- `miniprogram/dev/c2c-attendance-fixture.ts`
- `miniprogram/dev/c2c-attendance-fixture.test.ts`
- `miniprogram/dev/pages/c2c-attendance/index.ts`
- `miniprogram/dev/pages/c2c-attendance/index.wxml`
- `miniprogram/dev/pages/c2c-attendance/index.wxss`
- `miniprogram/dev/pages/c2c-attendance/index.test.ts`
- `miniprogram/dev/pages/c2c-attendance-scenario/index.wxml`
- `miniprogram/dev/pages/c2c-attendance-scenario/index.test.ts`
- `tests/attendance-native-preview.test.mjs`
- `docs/superpowers/specs/2026-08-30-attendance-recording-foundation-design.md`
- `docs/superpowers/plans/2026-08-31-attendance-recording-production.md`

- [x] 修复最终评审的 chronology、Mini Program ARIA、modal 可聚焦入口和主按钮对比度。
- [x] 跑 3 个 C2c Jest、typecheck、变更文件 ESLint、fresh dev/prod isolation 和 diff-check。
- [x] 在官方微信开发者工具复核 iPhone 12/13 Pro `390×844` 与 Nexus 5X `411×731` 的受影响状态；preview SHA 为 `db48dc003b894de7cf8e8e7022235579039f0a38`。
- [x] 独立 spec 与 quality review 不留 Critical/Important；提交并推送 feature branch。

## Task 1：0021 attendance storage

**Files:**

- `backend/app/models.py`
- `backend/migrations/versions/0021_open_game_attendance.py`
- `backend/tests/test_open_game_attendance_migration.py`
- `backend/tests/test_open_game_registration_schema.py`

- [ ] RED：锁定 migration head `0021`、enum `UNMARKED | PRESENT | NO_SHOW`、默认值、FK 和两条 check constraint。
- [ ] RED：锁定完整等价矩阵：`UNMARKED` 必须且只能配两个 `NULL`；`PRESENT|NO_SHOW` 必须且只能配两个非空审计字段；拒绝 `UNMARKED+完整审计`、终态+双空、任意单边审计；非 `JOINED` 必须为 `UNMARKED`。
- [ ] RED：历史 attendance 数据存在时拒绝无声 downgrade。
- [ ] 实现 `attendance_status`、`attendance_recorded_at`、`attendance_recorded_by_user_id`；继续复用 registration `version`，不新增索引或第二个版本列。
- [ ] GREEN：运行并预期 `PASS / exit 0`：

```bash
uv run pytest -q \
  backend/tests/test_open_game_attendance_migration.py \
  backend/tests/test_open_game_registration_schema.py
uv run ruff check backend/app/models.py \
  backend/migrations/versions/0021_open_game_attendance.py \
  backend/tests/test_open_game_attendance_migration.py \
  backend/tests/test_open_game_registration_schema.py
git diff --check
```

- [ ] 提交 `feat(c2c): persist attendance records`。

## Task 2：冻结静态与运行时契约

**Files:**

- `contracts/openapi.yaml`
- `contracts/examples/open-game-attendance-roster-ready.json`
- `contracts/examples/open-game-attendance-roster-empty.json`
- `contracts/examples/open-game-attendance-mark-present.json`
- `contracts/examples/open-game-attendance-mark-no-show.json`
- `contracts/examples/error-attendance-state-changed.json`
- `contracts/examples/open-game-owner-draft.json`
- `contracts/examples/open-game-owner-published.json`
- `contracts/examples/open-game-owner-suspended.json`
- `contracts/examples/open-game-owner-cancelled.json`
- `contracts/examples/open-game-registration-context-apply-ready.json`
- `contracts/examples/open-game-registration-context-applied.json`
- `contracts/examples/open-game-registration-context-waitlisted.json`
- `contracts/examples/open-game-registration-context-joined.json`
- `contracts/examples/open-game-registration-context-rejected.json`
- `contracts/examples/open-game-registration-context-withdrawn-application.json`
- `contracts/examples/open-game-registration-context-withdrawn-waitlist.json`
- `contracts/examples/open-game-registration-context-withdrawn-game-exit.json`
- `contracts/examples/open-game-registration-context-cancelled.json`
- `contracts/examples/my-open-game-applications-ready.json`
- `scripts/validate-contract.mjs`
- `backend/app/modules/open_games/dto.py`
- `backend/app/modules/open_games/lifecycle.py`
- `backend/app/modules/open_games/service.py`
- `backend/app/modules/open_game_registrations/dto.py`
- `backend/app/modules/open_game_registrations/privacy.py`
- `backend/app/modules/open_game_registrations/router.py`
- `backend/app/modules/open_game_registrations/service.py`
- `backend/tests/test_openapi_conformance.py`
- `backend/tests/test_my_open_game_applications_contract.py`
- `backend/tests/test_open_game_service.py`
- `backend/tests/test_open_game_registration_service.py`

- [ ] RED：新增 roster GET、mark POST、`Idempotency-Key`、closed request/result、401/404/409/422/503 与成功 examples。
- [ ] RED：owner actions 必含服务端 `can_manage_attendance`；self DTO 必含 nullable attendance 字段。
- [ ] RED：历史 owner replay 只升级“恰好缺少 `can_manage_attendance`”的旧 `OpenGameOwner`；`RegistrationContext` 保留当前全部受信的 C1a/C2a/C2b 精确历史白名单，并在各自升级结果补 `attendance_status=null`、`attendance_recorded_at=null`；另接受当前形状恰好只缺这两字段；近似旧形状或任意额外字段继续拒绝。
- [ ] RED：roster whitelist 禁止 `note`、用户 ID、记录者 ID、成年/风险同意与无关审计字段；公开 DTO 不出现个人 attendance。
- [ ] 实现静态 schema、runtime DTO/OpenAPI aligner 和严格 projector；`can_manage_attendance` 仅在有效状态精确为 `COMPLETED` 时为真。
- [ ] GREEN：运行并预期 `PASS / exit 0`：

```bash
npm run contract:validate
uv run pytest -q \
  backend/tests/test_openapi_conformance.py \
  backend/tests/test_my_open_game_applications_contract.py \
  backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_registration_service.py
uv run ruff check backend/app/modules/open_games \
  backend/app/modules/open_game_registrations
git diff --check
```

- [ ] 提交 `feat(c2c): freeze attendance contract`。

## Task 3：后端权威名单与幂等单人写入

**Files:**

- `backend/app/modules/open_game_registrations/repository.py`
- `backend/app/modules/open_game_registrations/service.py`
- `backend/app/modules/open_game_registrations/router.py`
- `backend/app/modules/open_game_registrations/privacy.py`
- `backend/app/modules/open_game_registrations/dto.py`
- `backend/tests/test_open_game_attendance_service.py`
- `backend/tests/test_open_game_attendance_api.py`
- `backend/tests/test_open_game_attendance_concurrency.py`
- `backend/tests/test_open_game_attendance_http_journey.py`

- [ ] RED：只有订单 owner 可读最小 JOINED 名单；其他用户统一 404；稳定排序为 `applied_at, id`；空名单 `attendance_complete=true`。
- [ ] RED：写入锁序固定为 `Order → OpenGame → Registration`，锁内重验 owner、有效 `COMPLETED`、`JOINED`、`UNMARKED` 与 expected version。
- [ ] RED：`MARK_OPEN_GAME_ATTENDANCE` digest 精确包含 operation、game ID、registration ID、目标 attendance status 与 expected version；同 key+同 digest 等价重放，上述任一项变化时同 key 必须冲突。
- [ ] RED：成功原子写结果、记录时间/人和 `version+1`，失败不留半个审计字段。
- [ ] RED：两个相反标记并发只有一个成功；订单/球局 authority 变化与写入串行且无死锁；409 返回 `ATTENDANCE_STATE_CHANGED`。
- [ ] 实现 roster read、mark mutation、digest/replay 与 HTTP journey；不改变 registration status、候补顺位、open spots 或订单字段。
- [ ] GREEN：运行并预期 `PASS / exit 0`：

```bash
uv run pytest -q \
  backend/tests/test_open_game_attendance_service.py \
  backend/tests/test_open_game_attendance_api.py \
  backend/tests/test_open_game_attendance_concurrency.py \
  backend/tests/test_open_game_attendance_http_journey.py \
  backend/tests/test_open_game_registration_service.py \
  backend/tests/test_open_game_service.py
uv run ruff check backend/app/modules/open_game_registrations \
  backend/tests/test_open_game_attendance_service.py \
  backend/tests/test_open_game_attendance_api.py \
  backend/tests/test_open_game_attendance_concurrency.py \
  backend/tests/test_open_game_attendance_http_journey.py
git diff --check
```

- [ ] 提交 `feat(c2c): record attendance authoritatively`。

## Task 4：严格客户端、HTTP 与未知结果恢复

**Files:**

- `miniprogram/domain/open-game.ts`
- `miniprogram/domain/open-game-decoder.ts`
- `miniprogram/domain/open-game-decoder.test.ts`
- `miniprogram/domain/open-game-registration.ts`
- `miniprogram/domain/open-game-registration-decoder.ts`
- `miniprogram/domain/open-game-registration-decoder.test.ts`
- `miniprogram/services/open-game-registration.ts`
- `miniprogram/services/open-game-registration.test.ts`
- `miniprogram/services/http-open-game-registration.ts`
- `miniprogram/services/http-open-game-registration.test.ts`
- `miniprogram/services/open-game-registration-attempt-store.ts`
- `miniprogram/services/open-game-registration-attempt-store.test.ts`

- [ ] RED：严格 roster/result decoder 验证 exact keys、enum、UUID、RFC3339、safe integer、计数和 attendance 不变量；畸形 2xx 必须拒绝。
- [ ] RED：HTTP 使用精确 path/body/Bearer/original key；401/404/409/422 为确定失败，网络、超时、5xx、畸形成功为未知结果。
- [ ] RED：持久 attendance attempt 隔离账号、game、registration、结果、version 与 key；同 mutation 重用原 key，其他 mutation 不覆盖。
- [ ] RED：恢复先读 roster：`expected+1 + 同结果` 接受并清除；原 version+UNMARKED 仅重放原 key；其他 authority 清除 attempt 并展示权威结果。
- [ ] 最小扩展现有 registration source/store/composition，不建立第二套会话或 transport。
- [ ] GREEN：运行并预期 `5 suites / PASS`、typecheck/ESLint/diff `exit 0`：

```bash
npx jest --runInBand \
  miniprogram/domain/open-game-decoder.test.ts \
  miniprogram/domain/open-game-registration-decoder.test.ts \
  miniprogram/services/open-game-registration.test.ts \
  miniprogram/services/http-open-game-registration.test.ts \
  miniprogram/services/open-game-registration-attempt-store.test.ts
npm run typecheck
npx eslint \
  miniprogram/domain/open-game.ts \
  miniprogram/domain/open-game-decoder.ts \
  miniprogram/domain/open-game-registration.ts \
  miniprogram/domain/open-game-registration-decoder.ts \
  miniprogram/services/open-game-registration.ts \
  miniprogram/services/http-open-game-registration.ts \
  miniprogram/services/open-game-registration-attempt-store.ts
git diff --check
```

- [ ] 提交 `feat(c2c): connect attendance transport`。

## Task 5：队长真实到场记录旅程

**Files:**

- `miniprogram/pages/captain-game-manage/index.ts`
- `miniprogram/pages/captain-game-manage/index.wxml`
- `miniprogram/pages/captain-game-manage/index.test.ts`
- `miniprogram/pages/captain-game-attendance/index.ts`
- `miniprogram/pages/captain-game-attendance/index.wxml`
- `miniprogram/pages/captain-game-attendance/index.wxss`
- `miniprogram/pages/captain-game-attendance/index.json`
- `miniprogram/pages/captain-game-attendance/index.test.ts`
- `miniprogram/app.json`
- `scripts/build-miniprogram.mjs`
- `tests/attendance-native-preview.test.mjs`
- `tests/development-http-build.test.mjs`
- `tests/audit-production-package.test.mjs`
- `tests/production-package-booking-audit.test.mjs`

- [ ] RED：manage 页只按服务端 `can_manage_attendance` 显示真实入口；前端不得按时间或状态字符串猜权限。
- [ ] RED：真实 roster loading/error/retry、逐人确认、marked row inert、conflict authority refresh、unknown-result recovery、完成与空名单状态。
- [ ] 从已审核 preview 迁移最小 WXML/WXSS/交互骨架，替换 Fixture store 为真实 HTTP source/attempt；所有按钮连接真实 handler。
- [ ] 生产页不 import dev fixture/marker；production route/audit exact list 同步更新，fresh production 只排除 dev source 而包含真实 attendance page/source。
- [ ] GREEN：运行并预期 `PASS / exit 0`：

```bash
npx jest --runInBand \
  miniprogram/pages/captain-game-manage/index.test.ts \
  miniprogram/pages/captain-game-attendance/index.test.ts \
  miniprogram/services/open-game-registration.test.ts
node --test \
  tests/attendance-native-preview.test.mjs \
  tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npm run typecheck
npx eslint miniprogram/pages/captain-game-manage/index.ts \
  miniprogram/pages/captain-game-attendance/index.ts
npm run build:miniprogram:production
npm run audit:miniprogram-package
git diff --check
```

- [ ] 提交 `feat(c2c): manage attendance in mini program`。

## Task 6：玩家本人权威回读与公开隐私

**Files:**

- `miniprogram/presentation/my-game-registrations.ts`
- `miniprogram/presentation/my-game-registrations.test.ts`
- `miniprogram/pages/my-game-registrations/index.ts`
- `miniprogram/pages/my-game-registrations/index.wxml`
- `miniprogram/pages/my-game-registrations/index.test.ts`
- `miniprogram/pages/captain-game-public/index.ts`
- `miniprogram/pages/captain-game-public/index.wxml`
- `miniprogram/pages/captain-game-public/index.test.ts`
- `miniprogram/domain/open-game-registration-decoder.test.ts`
- `backend/tests/test_my_open_game_applications_contract.py`
- `backend/tests/test_open_game_public_api.py`

- [ ] RED：只有本人 self DTO 非 null 时显示 `待队长记录 / 已到场 / 未到场` 与允许的记录时间；非 JOINED 或未进入赛后语境为 null。
- [ ] RED：列表/详情按 registration ID 定点回写，不破坏顺序、cursor、count、scroll 或其他报名状态。
- [ ] RED：匿名、其他玩家与公开共享详情永远看不到名单、个人 attendance、记录者或审计字段。
- [ ] 实现本人列表与共享详情的只读 presentation；不增加改判、申诉或通知入口。
- [ ] GREEN：运行并预期 `PASS / exit 0`：

```bash
npx jest --runInBand \
  miniprogram/presentation/my-game-registrations.test.ts \
  miniprogram/pages/my-game-registrations/index.test.ts \
  miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/domain/open-game-registration-decoder.test.ts
uv run pytest -q \
  backend/tests/test_my_open_game_applications_contract.py \
  backend/tests/test_open_game_public_api.py
npm run typecheck
npx eslint \
  miniprogram/presentation/my-game-registrations.ts \
  miniprogram/pages/my-game-registrations/index.ts \
  miniprogram/pages/captain-game-public/index.ts
git diff --check
```

- [ ] 提交 `feat(c2c): show attendance to the player`。

## Task 7：集成、生产隔离与 staging 准备

**Files:**

- `tests/attendance-native-preview.test.mjs`
- `scripts/audit-production-package.mjs`
- `tests/audit-production-package.test.mjs`
- `tests/production-package-booking-audit.test.mjs`
- `tests/development-http-build.test.mjs`
- `scripts/verify_open_game_attendance_staging.py`
- `deploy/README.md`（仅当命令/环境事实改变）

- [ ] 在 disposable PostgreSQL 运行 `0020→0021`、后端聚焦与真实本地 HTTP captain/player journey。
- [ ] 跑一次最终门并预期全部 `PASS / exit 0`：

```bash
npm run contract:validate
uv run pytest -q \
  backend/tests/test_open_game_attendance_migration.py \
  backend/tests/test_open_game_attendance_service.py \
  backend/tests/test_open_game_attendance_api.py \
  backend/tests/test_open_game_attendance_concurrency.py \
  backend/tests/test_open_game_attendance_http_journey.py
uv run mypy backend
npm test
npm run typecheck
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
git diff --check
```
- [ ] 官方微信开发者工具 iOS/Android 代表检查真实生产页的混合名单、一个确认层、完成与空态；人工检查对齐、箭头/X、裁切、滚动、安全区、文案与权威数据。
- [ ] 准备有明确 captain/player bearer、game/registration ID 的 staging 脚本；必须通过真实订单 check-in/complete 权威路径，不可直接改数据库伪造完成。
- [ ] 独立 spec/quality review 不留 Critical/Important；提交并推送 feature branch。

## Task 8：后续门与发布边界

- [ ] C2d 平台人工纠错单独完成设计、预览、契约、后端、管理端与玩家权威回读。
- [ ] C2b 真实订阅模板、授权 UI、生产 Provider、FIFO 通知、多账号和消息送达门解除。
- [ ] C2c captain/player 多账号 staging 与物理 iOS/Android 通过；记录 exact deploy SHA、migration revision、payment-disabled truth。
- [ ] 所有共享门通过后才追上 `main`、解决冲突、复跑受影响门、合并、推送、部署并统一上传一次新的体验版。
