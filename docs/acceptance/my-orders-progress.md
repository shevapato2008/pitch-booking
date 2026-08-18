# 我的订单验收进度

状态：`STAGING_DEPLOYED_DEVICE_ACCEPTANCE_PENDING`

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
- Alembic 当前为 `0012 (head)`，本切片没有新增迁移；
- live production build 成功，生产包审计为 `0 forbidden paths/tokens`。

## 自动化证据

- 真实 PostgreSQL 的订单列表、订单详情、过期与 OpenAPI 聚焦测试：60 passed；
- 小程序订单 domain、HTTP、presentation、页面与地图入口：202 passed；
- development bootstrap：3 passed；
- TypeScript typecheck、78 个契约示例、Node 契约测试、development/production build 通过；
- 生产包不含本切片 development Fixture。

## 真机验收待办

本次生成了 production preview 二维码，但二维码短期有效，不作为长期证据。仍需在真实 iPhone 完成一次：

1. 首页进入“我要租赁场地”；
2. 地图点击“我的订单”；
3. 检查真实列表或真实空态；
4. 若有订单，点击卡片返回现有订单详情；
5. 下拉刷新，并在有分页数据时点击加载更多；
6. 每个可见按钮至少操作一次，确认无假按钮、遮挡或错误返回。

在上述真机旅程通过之前，不删除 development Fixture，不把 B1 标记为完成。此前因 DevTools SDK 握手缺失而未取得的 375 × 812 原生像素对比也继续作为验收债记录，不伪造通过。

## 明确不在本次重复验收的内容

- A3 CREATE 新场馆的真实提交、批准及数据库不变量核对继续按用户决定延期；
- 本次没有真实支付、退款或模型调用；
- 取消退款、场馆到场和完成状态属于 B1 后续切片。
