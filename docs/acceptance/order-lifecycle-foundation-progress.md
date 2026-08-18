# 订单生命周期共享基础交接进度

状态：`SHARED_FOUNDATION_ACCEPTED_RUNTIME_TRACKS_OPEN`

## 本次完成边界

本阶段只关闭可供并行旅程消费的共享基础，不表示取消、退款、核销、完成或真实微信支付已经上线：

- PostgreSQL revision `0013` 冻结订单取消/退款时间、付款应用权威、退款 case/attempt 及其幂等和租约字段；
- 共享生命周期纯策略冻结 owner、场馆履约和 B2 发布资格使用的动作与阻塞原因；
- `PaymentProvider`、`RefundProvider` 及其闭合 result enums、权威金额/身份校验边界已经冻结；
- `RefundRepository` 冻结锁顺序、case/attempt identity、purpose 与库存归还所有权证明；
- owner-only 订单列表/详情 runtime 投影已经包含闭合的 `allowed_actions`、付款/退款状态与资金风险提示；
- 静态 OpenAPI 已冻结 owner cancel、场馆履约和微信通知的请求、响应、鉴权与错误矩阵，供后续实现按契约接线。

## 尚不存在的生产 runtime

下列静态契约路径尚未注册到 FastAPI runtime，不得把它们描述为可用按钮或已部署能力：

- `POST /api/v1/orders/{order_id}/cancel`；
- `GET /api/v1/venues/{venue_id}/fulfillment/orders`；
- `POST /api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in`；
- `POST /api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete`；
- `POST /api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund`；
- `POST /api/v1/payments/wechat/notify`；
- `POST /api/v1/refunds/wechat/notify`。

三条后续轨道分别负责真实微信支付/退款 Provider、owner 取消退款和场馆履约。中央 route/composition 注册、production build/audit 汇总、真实部署和 Fixture 删除仍须在三条轨道集成后串行完成。

## 并行文件边界

后续轨道可以消费但不得修改以下共享权威：

- `backend/app/models.py`；
- `backend/migrations/versions/0013_order_lifecycle.py`；
- 共享 `PaymentProvider` / `RefundProvider` result enums；
- 已冻结的公共 OpenAPI lifecycle/refund schemas 与 canonical examples。

若后续实现发现缺少共享枚举、字段、错误码或公共 schema，应停止该轨道并返回集成协调者，不得创建局部影子类型或自行修改上述权威。

## 比例回归证据

2026-08-18 在独立 PostgreSQL 测试库和当前 worktree 执行 Task 5 的共享回归：

- 生命周期 migration/policy、退款 Provider/repository、owner list/detail、支付创建/收敛和 OpenAPI 合集：`150 passed, 14 failed`；14 条失败均在晚间动态测试数据把 UTC `now + 24h`/`+2h` 推过上海自然日后触发既有 `ck_slots_same_local_day`，失败发生在 seed insert，未进入本次生命周期实现；该既有 fixture 基线按范围约束记录，不在本交接中扩修；
- 排除上述动态时钟 payment fixtures 后，migration/policy、退款 Provider/repository、owner list/detail 与 OpenAPI 聚焦集合：`149 passed`；
- Ruff 聚焦共享模块与测试：通过；
- `npm run contract:validate`：89 个 JSON examples 全部通过；
- `node --test tests/contract.test.mjs`：64 passed；
- `git diff --check`：通过。

仓库另有两条 staging/production payment provider 配置测试会先被既有 OSS 配置校验拦截，不能作为真实 Provider 可用证据；本交接未改变或掩盖该基线。

## 外部 release gate 与既有验收债

- 没有微信商户号、Mini Program AppID 绑定、商户私钥/证书序列号、API v3 key 和微信平台验签材料时，只能完成离线 Provider 实现与验证，不得声称真实支付、退款或通知链路可用；
- A3 CREATE 的真实 iPhone 提交—平台批准—数据库不变量核对仍按用户决定延期；
- B1 “我的订单”真实 iPhone 列表/空态、刷新、卡片详情和可见按钮验收仍未完成；
- 上述两项验收债均未因共享基础冻结而自动通过，也不应被后续文档改写为已完成。
