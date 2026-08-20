# 用户订单取消与退款验收进度

状态：`STAGING_BACKEND_DEPLOYED_DEVICE_PENDING`

更新时间：2026-08-20

## 已完成的实现

- owner-only `POST /api/v1/orders/{order_id}/cancel` 已接通，保持无请求体、Bearer 鉴权和稳定幂等键边界。
- 待支付且不存在可能资金的订单可在同一事务中取消，并且只释放由该订单持有的 `LOCKED` 时段。
- 已确认且存在唯一 applied `SUCCESS` 主付款的订单只创建 durable
  `ORDER_CANCELLATION + USER_CANCELLED` case/attempt，返回 `REFUND_PENDING`；命令不调用 Provider、不写退款终态。
- 只有同一用户取消 case 的最新 `FAILED` attempt 可显示并执行“重试退款”；场馆取消和库存冲突退款失败不会暴露无效按钮。
- 生产小程序使用严格 decoder 和真实 HTTP adapter；列表只显示服务端状态，取消动作仅出现在详情页并完全服从服务端 `allowed_actions`。

相关提交：

- `b7d0503`：无资金取消 API；
- `86e4c22`：冻结错误矩阵与原子回滚；
- `aaf725e`、`cb7e084`：durable 退款入队、重试和终态幂等重放；
- `9129f8c`：生产小程序 HTTP owner action；
- `d714cda`：只暴露确实可执行的 owner 退款重试。

## 自动化与本地真实 HTTP 证据

聚焦门禁结果：

- 真实 PostgreSQL 的取消、生命周期、退款仓储、详情、列表和 OpenAPI：159 passed；
- Mini Program decoder、HTTP、详情/列表 presentation 与页面：295 passed；
- TypeScript typecheck：PASS；
- OpenAPI 契约示例：89 个全部通过；
- Ruff 与 `git diff --check`：PASS。

随后使用唯一 disposable PostgreSQL、真实本机 Uvicorn 网络和
`PAYMENT_PROVIDER=disabled` 完成一次非 TestClient 的受控贯通：

1. 无支付订单返回 `200 / CANCELLED`，仅目标 slot 释放，对照 slot 仍为 `LOCKED`；
2. applied `SUCCESS` 的已确认订单返回 `202 / REFUND_PENDING`，只生成 1 个 durable case 和 attempt，slot 保持 `BOOKED`；
3. 将 Provider-owned attempt 置为 `FAILED` 后，详情投影允许真实重试；新请求在同一 case 创建 attempt 2，序列为 `FAILED → CREATING`；
4. 全程 6 次匿名化 HTTP 调用，Provider 调用 0 次，`SUCCESS` 退款终态写入 0 条。

临时 Uvicorn 与隔离数据库均已清理，临时数据库残留计数为 0；未记录 bearer、用户标识、手机号、订单号、数据库地址、密钥或二维码。

## staging 部署证据

- 计算主机：`ucloud-v100`；阿里云继续承载域名侧服务、OSS 和 DashScope，不是本次 ECS 部署入口。
- 已按不可变发布流程部署 `d905b72`，发布前数据库与共享环境备份均已生成并验证；相对旧版本无 migration/model 变化。
- API、worker、PostgreSQL 和 Caddy 均运行，API/PostgreSQL 健康；Alembic 保持 `0014`。
- 公网 health 返回 `200` 且 revision 为 `d905b72`；平台后台返回 `200`；无 Bearer 的订单读取与取消写入均返回 `401`。
- `PAYMENT_PROVIDER=disabled`、Mock Provider 关闭；部署后五分钟 API/worker 日志未命中 Traceback、CRITICAL 或未处理异常。
- 此次只部署 backend，没有上传、替换或设置新的微信体验版。

## 当前诚实边界

- backend 已部署到共享 staging；尚未完成真实 iPhone 的无资金取消、列表回读和时段回收验收。
- 当前体验版仍保持在线预订、支付和退款入口关闭；本切片不得直接替换体验版。
- `MINIPROGRAM_PAYMENT_PROVIDER=disabled`，未启用真实微信支付或退款。
- `order-cancellation` Fixture/route fragment 当前由 root 有意保留。本切片不得自行删除或改写中央注册；只有所有 active slice 已合并并接入真实 HTTP、root 先盘点并加法注册完整 route/token union、设备验收通过后，才能由 root 统一清理并证明没有非目标 route/token 丢失。
- paid refund terminal acceptance：`BLOCKED_BY_WECHAT_PROVIDER_INTEGRATION`。只有微信 Provider 轨道获得完整商户凭据并完成一次受控小额支付/退款后，才能验收通知或主动查询收敛及最终 `REFUNDED`。
- 本地 HTTP 验收不等于退款到账，也不等于整个 B1 完成。

## 待完成

- [x] 在保持在线预订、支付与真实退款关闭的前提下，将本切片 backend 部署到共享 staging；
- [ ] 用受控无资金待支付订单完成真实 iPhone 取消、详情重开、列表刷新和同一 slot 可用性回读；
- [ ] 在 375×812 做一次 HTTP-backed 详情/列表人工视觉自审，覆盖按钮居中、徽标、箭头、裁切、底部安全区和真实状态；
- [ ] 所有 active slice 合并、真实 HTTP 接通并完成真机 PASS 后，由 root 按完整 route/token union 串行删除 `order-cancellation` 临时 Fixture/route fragment，再证明非目标 route/token 未丢失，并重跑 production build、disabled-payment 检查和 package audit；
- [ ] 任何新体验版上传前暂停，并由用户明确确认；不提交正式审核、不公开发布。
