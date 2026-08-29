# C2a-P 报名撤回与退出生产候选实施计划

> **For agentic workers:** use subagent-driven development for disjoint backend/client files, test-driven development for every behavior, and verification-before-completion before release claims.

**Goal:** 在 C1c 候选上接通真实 APPLIED 撤回和 JOINED 退出，生成统一 staging/体验候选，同时保留真实账号与手机完成门。

**Design:** `docs/superpowers/specs/2026-08-30-registration-withdrawal-production-design.md`

**Base:** `d696f7d0078cdc83167d5f59212a28d16a389cb2`（C1c `eb75889` + C2a preview）。

**Hard boundary:** 不实现候补/FIFO、通知、队长移除、到场/爽约、举报、信用、处罚、支付、退款或新取消逻辑；不删除任何 Fixture；不在真实手机验收前合并最终 `main`。

## Task 0: 记录 delegated visual gate 与冻结设计

- [x] iPhone X 375×812 与 Nexus 5X 411×731 原生视觉/交互自审通过。
- [x] 独立复审无阻塞，Reference/implementation/side-by-side/overlay/difference 证据已入库。
- [x] 将用户“由代理验证双平台视觉、通过后继续”的授权诚实记录为 `DELEGATED_PASS`，真实手机门保持 `PENDING`。
- [x] 冻结显式 action、6 小时边界、SUSPENDED、取消投影、不可重报、审计字段、锁序、未知结果和 rollback 边界。

## Task 1: 0018 与只读兼容点

**Backend/contract files:**

- `backend/app/models.py`
- `backend/migrations/versions/0018_open_game_registration_withdrawals.py`
- `backend/app/modules/open_game_registrations/{dto,lifecycle,privacy,service,router}.py`
- `contracts/openapi.yaml`, affected/new context examples
- migration/schema/lifecycle/contract tests and migration-head assertions

- [ ] RED：0017↔0018 空库往返、旧行不变、约束矩阵、WITHDRAWN 行拒绝 downgrade。
- [ ] RED：持久/有效 WITHDRAWN、取消覆盖、viewer 新字段、C1c 列表和 context 严格契约。
- [ ] 实现 enum 重建、三个审计字段与封闭投影；compatibility 阶段 `available_withdrawal_action=null`。
- [ ] 跑 migration/schema/lifecycle/contract/C1a/C1c 聚焦门，记录并提交 `feat(c2a): read withdrawn registrations`；该 SHA 是首笔写入后的唯一安全回滚基线。

## Task 2: self-only 幂等后端 mutation

**Files:**

- `backend/app/modules/open_game_registrations/{dto,lifecycle,repository,service,router}.py`
- `contracts/openapi.yaml` and withdrawal examples/errors
- focused contract/service/API/HTTP/concurrency tests

- [ ] RED：显式 action + expected_version、self-only 404、状态/版本竞争、SUSPENDED、取消/完成/开场、精确 6 小时边界。
- [ ] RED：APPLIED 容量不变、JOINED 只释放一次、同键等价重放、异请求同键冲突、rollback 不留半成品。
- [ ] RED：APPLIED 撤回与 captain ACCEPT 竞争只有一个基于 v1 成功；两个不同退出 key 只有一个成功。
- [ ] 实现 `POST /api/v1/open-game-applications/{application_id}/withdraw`，保持 Order → OpenGame → Registration 锁序；不写 open_spots。
- [ ] 跑后端聚焦、OpenAPI conformance、contract validate、ruff/mypy/diff-check，提交 `feat(c2a): withdraw open game registrations`。

## Task 3: 严格客户端、HTTP 与 attempt 恢复

**Files:**

- `miniprogram/domain/open-game-registration{,-decoder}.ts` and tests
- `miniprogram/services/open-game-registration.ts`
- `miniprogram/services/http-open-game-registration.ts` and tests
- `miniprogram/services/open-game-registration-attempt-store.ts` and tests
- affected canonical fixture consumers

- [ ] RED：WITHDRAWN、新 viewer 字段、action/late/terminal 不变量和畸形 2xx 拒绝。
- [ ] RED：withdraw 精确 path/body/Bearer/key，401/404/409/422、网络/5xx/畸形成功均保持未知。
- [ ] RED：attempt 防御复制、同 mutation 复用 key、动作/版本/资源/账号冲突、精确权威恢复分类。
- [ ] 实现同一 domain/source/store 的最小扩展，不建第二套栈；跑聚焦 Jest、typecheck、ESLint、diff-check。

## Task 4: 真实详情动作与列表定点回写

**Files:**

- `miniprogram/pages/captain-game-public/index.{ts,wxml,wxss,test.ts}`
- `miniprogram/pages/my-game-registrations/index.{ts,wxml,wxss,test.ts}`
- `miniprogram/presentation/my-game-registrations.ts` and tests

- [ ] RED：APPLIED/JOINED CTA、确认层、保留报名不写、提交单飞、服务端 late 文案、终态无重报。
- [ ] RED：未知结果只接受匹配 WITHDRAWN 或重放原 key；状态/动作变化不得自动升级。
- [ ] RED：账号/generation 隔离和上一页按 ID 定点更新，保持 items 顺序、cursor、count、scroll。
- [ ] 移植已通过的 C2a 视觉到共享详情；每个可见按钮连接真实 handler/后端能力。
- [ ] 跑详情/列表/C1a apply/C1c/C1b 回归、typecheck、ESLint、fresh builds/audit；提交 `feat(c2a): ship registration withdrawal journey`。

## Task 5: 集成、双平台运行时与独立复审

- [ ] 启动 disposable PostgreSQL，运行相关 Python/Node 聚焦集和一条真实本地 HTTP 旅程，完成后停止数据库。
- [ ] 运行 full backend、`npm test`、typecheck、contract validate、fresh development/production build 与 package audit。
- [ ] 在官方微信开发者工具对 production journey 做一次 iOS 与 Android 代表检查：APPLIED 保留/撤回、JOINED 保留/退出、late 文案、未知结果、详情返回列表。
- [ ] 人工检查按钮双轴居中、重复列线、箭头/X、裁切、滚动、底栏安全区和权威数据；只修阻塞问题。
- [ ] 独立代码复审无 Important/Critical；verification-before-completion 对 exact SHA 通过。

## Task 6: 统一候选发布

- [ ] fetch origin；若 main 前进则 merge 一次、不 rebase，复跑受影响门。
- [ ] 先部署 Task 1 compatibility SHA 并升级到 0018，记录 checksum/revision/payment-disabled truth；再部署 exact feature SHA。
- [ ] 推送 feature branch，构建同 SHA production 包，确认下一个未使用版本并上传一版体验候选。
- [ ] 记录诚实状态：自动化、staging、DevTools 双平台通过；C1c 三账号/双手机与 C2a 物理手机验收仍 pending。
- [ ] 用户验收通过后再独立删除 C1c/C2a Fixtures、合并 main、推送并重新部署/上传最终版本。
