# 我的订单

场馆地图 `map-entry` → “我的订单” → `ready`

`ready` → 点击任一订单卡 → `/pages/order-detail/index?order_id=<order_id>`

`ready` → “加载更多” → `load-more-error` → “重试加载更多” → `ready`

首次进入 → `loading` → `ready` / `empty` / `error`

`error` → “重新加载” → `loading`

`empty` → “去选场地” → 前一页是地图时 `navigateBack`；否则 `reLaunch` 到 `/pages/venue-map/index`

下拉刷新保留当前列表，服务端第一页成功后替换为权威 `ready`；分页失败保留已有卡片。客户端不根据本地时间改写状态，状态投影优先级为 `PAYMENT_EXCEPTION` → 正在关闭 → 支付确认中 → 已确认 → 已过期 → 待支付。

本 Artifact 只冻结 `375 × 812` 的视觉、文案和预览状态转换。它不创建生产路由、Fixture、HTTP 契约或后端能力；原生 development-only Fixture 的真实导航、刷新和分页行为属于 Task 2，且必须在视觉确认后开始。
