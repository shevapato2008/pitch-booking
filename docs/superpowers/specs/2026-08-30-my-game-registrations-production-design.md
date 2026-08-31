# C1c “我的报名”生产候选设计

日期：2026-08-30

状态：`DELEGATED_APPROVED_FOR_CANDIDATE`。用户已确认 C1c 预览视觉，并明确授权休息期间继续开发、由独立 agent 处理必要决策、统一发布一版新的体验候选。该授权取代预览文档中“等待联合候选全部验收后才开始生产实现”的顺序门，但不取代明早真实账号与手机验收；通过前不得宣称 C1c 最终完成或退役 Fixture。

上游：

- [C1c 开发预览设计](./2026-08-29-my-game-registrations-preview-design.md)
- [C1a 散客申请生产设计](./2026-08-24-player-game-application-production-design.md)
- [C1b 公开球局发现生产设计](./2026-08-26-public-game-discovery-production-design.md)

## 1. 目标与范围

闭环一个只读找回旅程：

```text
找球局 → 我的报名 → 查看自己的最近报名与权威状态
→ 点击卡片进入既有共享球局详情 → 返回并保留列表/滚动位置
```

本切片只新增一个 self-only 列表 API、一个生产列表页和 C1b 入口。继续复用 C1a 的登录、状态投影及共享详情页。明确不做退出报名、重新申请、候补、通知、到场、聊天、评分、线上 AA 或新的全局“我的”导航。

## 2. 方案

采用“扩展现有报名模块/Source”：

- 后端扩展 `open_game_registrations`，避免复制身份、隐私和取消投影；
- 小程序扩展 `OpenGameRegistrationSource`，复用现有会话与 HTTP 错误分类；
- 新增 `/pages/my-game-registrations/index`，卡片跳服务端返回的既有 `/pages/captain-game-public/index?token=...`；
- C1b 城市说明之后、筛选之前增加“我的报名”入口。

不新建第二套报名模块，也不从公开目录拼接个人报名：后者无法覆盖 `LINK_ONLY`、历史及已取消球局，并会产生 N+1 请求。

## 3. API 与分页

```http
GET /api/v1/open-game-applications?limit=20&cursor=<opaque>
Authorization: Bearer <session>
```

- `limit` 默认 20，范围 1–50；
- 只从服务端会话读取申请人身份，不接受用户 ID 参数；
- `200` 返回列表或正常空列表；`401 AUTH_REQUIRED`；无效 limit/cursor 为 `422 INVALID_ARGUMENT`；数据库或权威投影异常为 `503 SERVICE_UNAVAILABLE`；
- 按 `(applied_at DESC, id DESC)` 做 `limit + 1` keyset 分页；cursor 是不透明的版本化 base64url `{v:1, applied_at, id}`；不返回 total count；
- 包含当前用户的 `PUBLIC`、`LINK_ONLY`、未来、历史及终态报名。

封闭响应：

```json
{
  "items": [
    {
      "id": "2bfdb296-68ea-4ad8-8184-fdd82dc01246",
      "effective_status": "APPLIED",
      "applied_at": "2026-08-29T01:30:00Z",
      "detail_path": "/pages/captain-game-public/index?token=0123456789abcdef0123456789abcdef",
      "game_name": "海河周六轻松局",
      "starts_at": "2026-09-05T01:00:00Z",
      "ends_at": "2026-09-05T02:30:00Z",
      "time_zone": "Asia/Shanghai",
      "venue_name": "天津河东体育中心",
      "pitch_name": "笼式五人制 2 号场",
      "pitch_specification": "5人制"
    }
  ],
  "next_cursor": null
}
```

有效状态复用既有 `project_open_game_state` 与 `project_effective_registration_status`，不新增持久 `CANCELLED`。列表根查询必须先限定 `applicant_user_id == current_user.id`；cursor 不携带也不能改变身份。若当前用户任一报名缺少订单/场次/场地/时区/share token 等权威关系，整页失败为 503，不静默漏项。

新增迁移 `0017`，仅增加 `(applicant_user_id, applied_at, id)` 索引，无字段、枚举或回填。

## 4. 隐私边界

响应只允许上述字段。禁止申请称呼、位置偏好、备注、同意记录、审核人/审核元数据、申请人或队长 user ID、其他申请人、联系方式、成员名单、球队详情、订单/支付/退款 ID 或金额。`detail_path` 是唯一 token 字段；拥有该报名的已登录用户可安全取得其既有共享详情路径。

账号 B 即使重用账号 A 的 cursor，也只能得到 B 自己的行。任一 401 都清空本地 session 与旧账号列表。

## 5. 小程序状态与并发

列表页沿用已确认的 C1c 结构并删除预览标签，支持：首次加载、ready、空列表、登录/登录失败、首次加载失败、刷新、刷新失败保留卡片、加载更多、加载更多失败保留卡片。

首次无 session 或任一 401 都进入 `AUTH_REQUIRED`，展示调用既有 `source.login()` 的真实“微信登录”按钮。登录成功后从第一页重新请求；登录失败保留可重试的登录态，不伪装成普通网络错误；401 先清 session、旧列表与 cursor、递增 generation，再停在登录态，不自动循环登录或请求。

每个请求捕获 `{userId, generation}`。账号变化或 401 时递增 generation 并清空 items、cursor、scrollTop、bound user；仅当页面仍活跃且 userId/generation 都一致时接收响应，阻止账号 A 的晚响应写入账号 B 页面。

- C1b → 我的报名使用 `navigateTo`；返回保留 C1b 筛选、结果与准确 scrollTop；
- 列表 → 共享详情使用服务端 `detail_path`；返回保留已加载页、cursor 与 scrollTop；
- 卡片是唯一详情入口，不嵌套按钮；刷新、加载更多、登录、重试、清筛选和返回均必须有真实行为。

## 6. 视觉与构建边界

复用已确认的 C1c 视觉、现有 token、header/back 几何、44px 触控和 safe area。代表性生产运行时只做一轮 iOS 与一轮 Android 宽度检查，重点检查文字双轴居中、状态徽标/卡片对齐、箭头完整、裁切、滚动和底部安全区；不重拍全状态矩阵。

C1c development Fixture 与场景页保留到明早真实账号验收。production build 必须排除 `C1C_MY_GAME_REGISTRATIONS_FIXTURE`、合成文案和全部 `dev/pages/c1c-*`，package audit 明确拒绝泄漏。Fixture 只在最终手机验收通过后的独立清理提交删除。

## 7. 候选完成门

统一候选版上传前必须通过：

1. 后端 self-only、隐私、四种有效状态、PUBLIC/LINK_ONLY、分页/cursor、401/422/503、迁移与本地 HTTP 旅程；
2. 小程序严格 decoder/HTTP、页面状态、刷新/续页保留、入口/详情返回、晚响应账号隔离；
3. 受影响 C1a/C1b 回归、typecheck、fresh development/production build 与 package audit；
4. 微信开发者工具代表性 iOS 与 Android 视觉/交互核对；
5. 精确 source SHA 部署 staging，健康、revision、迁移和 payment-disabled truth check；
6. 上传一个新的体验候选并确认版本/SHA。

明早仍需真实账号完成：self-only、账号切换、PUBLIC/LINK_ONLY 详情、申请/队长审核、容量竞争、取消投影与双平台手机验收。未通过前不合并 final `main`、不删除 Fixture、不称切片完成。
