# 我的订单验收进度

状态：`STAGING_DEPLOYED_DEVICE_ACCEPTED_FIXTURE_REMOVED`

## 已交付到 staging

2026-08-18 已将“我的订单”生产切片部署至：

- API：`https://pitch-api-staging.modelstella.com`
- revision：`2551ca5f9110f432a0ecf91636dd49bb6a99ea99`
- 小程序入口：首页“我要租赁场地” → 地图第二行“我的订单”

发布后最小检查通过：

- `GET /api/v1/health` 返回 `200`，响应头 revision 与本次部署一致；
- 未登录 `GET /api/v1/orders` 返回闭合 `401 AUTH_REQUIRED`，证明新路由已在线且仍受身份保护；
- `/platform-admin` 返回 `200`，既有审核后台未受影响；
- API、Worker、Caddy 与 PostgreSQL 容器健康；
- Alembic 当时为 `0012 (head)`，本切片没有新增迁移；
- live production build 成功，生产包审计为 `0 forbidden paths/tokens`。

## 自动化证据

- 真实 PostgreSQL 的订单列表、订单详情、过期与 OpenAPI 聚焦测试：60 passed；
- 小程序订单 domain、HTTP、presentation、页面与地图入口：202 passed；
- development bootstrap：3 passed；
- TypeScript typecheck、78 个契约示例、Node 契约测试、development/production build 通过；
- 生产包不含本切片 development Fixture。

## 真实 iPhone 验收：PASS

2026-08-20，体验成员使用已成功上传的体验版 `0.1.1`，在受控 staging
零金额订单上完成了 B1“我的订单 → 场馆今日订单 → 签到 → 完成”联合旅程。
与“我的订单”直接相关的结果为：

1. “我的订单”下拉刷新正常；
2. 已过期订单可以打开，详情没有支付动作；
3. 场馆完成服务后，“我的订单”再次刷新显示“已完成”，详情没有可执行动作；
4. 全程按钮、滚动、底部安全区和返回路径正常。

本次没有人为制造网络失败。受控账号的列表已显示“已经到底了”，因此没有可见的“加载更多”按钮可点。现有页面自动化已经覆盖首屏失败与重试、刷新失败、分页、加载更多失败与同 cursor 重试；结合本次真实数据下的刷新、详情和终态检查，按改动风险与验收价值比例接受，不额外制造 staging 故障或数据。

此前 DevTools SDK 握手问题导致的 375 × 812 原生同尺寸像素对比仍未补造；历史 Artifact 证据保留。本次真实 iPhone 已完成当前范围内的按钮居中、滚动、安全区、返回和关键状态文案人工检查，不把缺少自动化截图写成虚假像素证据。

## Fixture 清理

真机验收通过后，已删除 `miniprogram/dev/my-orders-fixture.ts` 及
`dev/pages/my-orders-map/index`、`dev/pages/my-orders/index` 两套临时页面，并从
development manifest 移除两条 route。生产 `pages/my-orders/index`、真实 HTTP composition
和历史视觉证据保留；删除门禁已完成 RED → GREEN。

九项验收结束后，受控 staging 零金额验收图先通过完整回滚演练，再按同一组断言原子清理：
仅删除 1 条临时订单、1 条合成零额 Payment、2 条签到/完成幂等记录和 1 个临时时段。
提交后 marker 零残留检查通过；既有用户、场馆、场地和成员关系均保留，清理前备份仍可恢复。

## 仍不在本次完成范围

- `ONLINE_BOOKING_ENABLED=false`，`MINIPROGRAM_PAYMENT_PROVIDER=disabled`；本次没有真实支付、退款或资金 smoke；
- owner 取消/退款尚未完成，不得把“我的订单”设备验收等同于整个 B1 完成；
- 场馆今日订单、签到和完成的本次联合验收结果记录在对应进度文档；场馆退款路由仍未发布；
- A3 CREATE 新场馆的真实提交、批准及数据库不变量核对继续按用户决定延期。
