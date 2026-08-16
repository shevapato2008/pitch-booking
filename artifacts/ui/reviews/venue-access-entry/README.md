# 场馆权限入口原生预览

- 微信开发者工具：Stable `2.01.2510290`
- 基础库：`3.17.0`
- 设备：iPhone X，逻辑 viewport `375 × 812`
- 截图：开发者工具原生小程序运行时导出，原始像素 `750 × 1624`
- 组合：development，隔离 Fixture；生产 `app.json` 未注册该路由

## 多场馆

- 路由：`/dev/pages/venue-access/index?case=multiple`
- 截图：`multiple-375x812-implementation.png`
- 检查重点：标题与胶囊安全距离、两张场馆卡片的文字居中与层级、行政区/地址、右箭头、卡片触控面积。

## 无管理权限

- 路由：`/dev/pages/venue-access/index?case=empty`
- 截图：`empty-375x812-implementation.png`
- 检查重点：权限说明不暗示微信登录等于场馆授权；平台核验提示清楚；“返回入口”文字居中且避开底部安全区；不提供尚未实现的申请按钮。

这两个状态没有既有参考稿；原生实现截图本身作为本轮候选视觉 Artifact，等待用户确认后再进入生产 API 与路由实现。
