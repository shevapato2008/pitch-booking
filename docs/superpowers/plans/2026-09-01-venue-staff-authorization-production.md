# D1b 场馆员工与分级权限实现计划

**目标：** 在不猜测历史负责人的前提下，交付安全的一次性员工邀请、四项权限管理、移除和平台负责人转移。

**依赖：** 预览可并行；生产迁移固定 `0026`，最终接 D1a `0025`。历史 owner 映射是启用门，不阻塞代码和隔离体验版预览。

## Task 1：隔离视觉预览

- 建员工管理与邀请落地场景页，覆盖 owner 列表、创建邀请、权限编辑、移除确认、员工只读和邀请不可用。
- 加入 iOS 390×844、Android 411×731 目标 viewport，按钮双轴居中、底栏安全区和长场馆名滚动检查。
- 将 route、marker、token 和 Fixture 纳入 production package deny-list。

## Task 2：契约与权限矩阵

- 先写 RED contract tests，再冻结八个 API、闭合 schema、错误矩阵和示例。
- 明确 token 只在创建响应返回，列表与日志不含 token/微信身份。
- 为四个既有管理模块增加针对各自权限的回归测试。

## Task 3：迁移与历史门禁

- 在含 `0025` 的最终基线增加 `0026` 三组表/字段/枚举/索引/约束。
- 编写 owner mapping 校验和幂等回填命令；默认 disabled，映射缺失、重复、跨场馆或 inactive 时拒绝启用。
- 覆盖迁移循环、每场馆唯一 active owner、staff 至少一项权限和审计只追加。

## Task 4：邀请与成员生命周期

- 固定锁顺序实现 create/read/accept/revoke/update/remove/transfer。
- 接受邀请只给当前登录用户；并发接受仅一个用户成功，未知结果可按相同幂等 key 回读。
- owner 不能自助移除/降级；staff 更新与移除写不可变审计。

## Task 5：生产 API 与页面

- 组合 Bearer owner/member API 和 platform-admin owner-transfer API。
- 将审核后的预览迁入真实小程序页面、服务、持久 attempt 和生产路由。
- 工作台入口按服务端角色呈现；普通 staff 无法通过改 URL 扩权。

## Task 6：集成和验证

- 重放在最终候选分支，解决 `0026 → 0025`、模型和 OpenAPI 冲突。
- 跑 PostgreSQL/HTTP 并发旅程、contract、mini Jest/typecheck/build/audit、平台回归。
- 未实现者 agent 做代码与真实运行时视觉审核；修复 Critical/Important。
- 推送 feature 分支并进入统一体验版；用户集中验收前不合并 `main`。

