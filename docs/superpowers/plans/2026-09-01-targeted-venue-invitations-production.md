# D1a 定向招商邀请实现计划

**目标：** 交付平台生成一次性邀请、微信用户绑定并提交 A3 认领、平台继续人工审核的真实闭环。

**依赖：** 视觉预览可基于 C2d 工作树并行；生产迁移号固定为 `0025`，必须在 C2e `0023` 与 C2f `0024` 集成后落地。

## Task 1：隔离视觉预览

- 为平台运营台添加独立 `dev-recruitment-invitations` 预览，覆盖创建成功与撤销确认。
- 为小程序添加 D1a 场景选择页和邀请落地预览，覆盖可接受、已绑定、已提交、不可用。
- 将 dev route/fixture 纳入 production build deny-list。
- 运行聚焦结构测试、TypeScript、开发构建，并由非实现者 agent 在 1440×900、390×844、411×731 审核。

## Task 2：冻结契约

- 先写 RED contract tests，再增加平台与微信端 schema、examples、错误码和路径。
- 明确创建响应是唯一一次返回原始 token/path；列表与日志不含 token。
- 覆盖关闭模型、身份权限、幂等、过期/撤销/跨用户和关联申请投影。

## Task 3：持久化与生命周期

- 在最终集成基线上新增 `0025_venue_recruitment_invitations.py`。
- 添加模型枚举、状态字段组约束、token/application 唯一约束和查询索引。
- 以 TDD 覆盖 upgrade/downgrade、过期收敛、单用户绑定、撤销边界及并发创建。

## Task 4：平台邀请 API

- 实现 eligible venue 搜索、邀请列表、创建与撤销 repository/service/router。
- 沿用平台角色、CSRF 与数据库错误封装。
- 覆盖只返回一次 token、场馆锁与资格重检、同场馆并发以及结果不确定后的 readback。

## Task 5：微信邀请与 A3 CLAIM 集成

- 实现安全 token 解析、详情、接受和邀请式 claim 命令。
- 抽取并复用现有 A3 CLAIM 的手机号、证据、去重及 application 创建边界；不得复制成第二套审核状态机。
- 覆盖同用户重放、其他用户隐藏、过期/撤销、证据失败不消耗邀请，以及批准前无 membership。

## Task 6：生产页面

- 将已审核视觉移入平台运营台真实 controller/api 与小程序生产页。
- 平台复制、撤销、跳转关联申请；小程序接受、继续材料、提交、查看申请全部接真实服务。
- 删除/隔离 Fixture，补充 build/audit/route 测试和按钮行为测试。

## Task 7：集成与验证

- 基于包含 `0023`、`0024` 的候选分支重放 D1a commits，解决模型、OpenAPI、平台导航和构建清单冲突。
- 运行聚焦 PostgreSQL/HTTP 旅程、contract、mini Jest/typecheck/build/audit、platform tests/build。
- 由非实现者 agent 完成代码审查和最终真实运行时视觉审核；修复 Critical/Important。
- 推送 feature branch，纳入统一 staging/体验版；用户集中验收前不合并 `main`。
