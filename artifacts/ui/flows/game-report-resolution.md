# C2f 举报与平台处置预览交互清单

状态：`IMPLEMENTED_FIXTURE_VISUAL_REVIEW_PENDING`。

本清单只描述隔离的 Development-only Fixture。它不连接后端、生产账号或生产数据；真正契约、`0024`、后端和 production UI 必须等 C2e 最终 HEAD 后再实施。

## 平台端按钮与行为

| 可见动作 | Fixture 中的真实行为 | 生产接入条件 |
| --- | --- | --- |
| 待处理/已结案筛选 | 从内存权威队列重新计算列表并选择首条 | GET queue + opaque cursor |
| 刷新 | 重新读取内存 authority，不伪造新结果 | GET queue/detail |
| 加载更多分页 | 扩大当前状态的稳定结果窗口 | GET next cursor |
| 选择举报 | 读取选中 report 的封闭详情投影 | GET detail |
| 选择结论 | 仅接受详情 `allowedOutcomes` | 服务端动态 allowed outcomes |
| 处置说明输入 | NFC、1..500 code points、联系方式/链接就地校验 | 客户端提示 + 服务端独立重算 |
| 返回检查/关闭 X/Escape | 关闭确认层，不写 resolution，恢复触发焦点 | 无写请求 |
| 确认并写入审计 | append 一条内存 resolution；取消结论只改 Fixture game | POST resolution + idempotency |
| 确认原处置结果 | unknown result 时先读取 authority，确认已生效才解锁 | GET detail，必要时原 key/body 重放 |
| 退出 | 清空本地 console state，进入预览登录页 | POST/logout + session clear |

平台取消的 Fixture 在操作前后对 order、slot、payment、refundCase、refundAttempt 做完整快照比较；只有 game status/version/source 改变。状态变化时返回冲突并刷新可选结论，不静默降级。

## 小程序按钮与行为

| 可见动作 | Fixture 中的真实行为 | 生产接入条件 |
| --- | --- | --- |
| 场景选择 | `navigateTo` 对应 scenario query | development only，production 删除 |
| 选择举报原因 | 写入五值严格枚举中的一个 | 本地表单状态 |
| 事实说明输入 | 实时 code-point 计数和敏感内容提示 | 本地提示 + 服务端独立重算 |
| 提交举报 | 先校验并打开确认层，不立即写入 | 无写请求 |
| 返回检查/遮罩关闭 | 关闭确认层，保留表单且不写入 | 无写请求 |
| 确认提交 | 以固定 attempt key/body 写入一条内存举报 | POST report + idempotency |
| 确认原提交结果 | unknown result 先 GET 内存 authority；没有结果才原 key/body 重放 | GET my-report + original replay |
| 重新读取结果/状态 | 读取本人权威 context/report | GET my-report |
| 返回 | 有页面历史时 `navigateBack`，否则回 C2f scenario | production 回本人球局详情 |

## 视觉检查

- 平台只审核 `pending-detail`、`cancel-confirm` 的 `1440x900`；检查列表/详情层级、同组控件对齐、dialog X、Tab/Escape、长事实和按钮双轴居中。
- 小程序只审核 `report-form`、`resolved-cancelled` 的 iOS `390x844` 与 Android `411x731`；检查自定义返回箭头、radio 对齐、textarea/计数、滚动、键盘、固定底栏和 safe area。
- 其他状态只做聚焦行为测试与一次人工点检，不制造全状态截图矩阵。

## Fixture 删除条件

production API、真实 platform-admin 和 `pages/open-game-report/index` 集成通过后：

1. production imports 继续不得引用 `platform-admin/dev-game-report-resolution/**` 或 `miniprogram/dev/c2f-*`；
2. production build/audit 必须保持两个 marker、dev route、模拟 UUID 和模拟球局名为零；
3. 用户验收完成、准备合并前，可保留 dev source 作为显式开发预览，但不得进入任何发布包；若项目决定删除预览，则连同本清单和聚焦 preview 测试一起删除，不能只删 marker 绕过审计。
