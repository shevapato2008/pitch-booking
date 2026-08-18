# 队长开放球局 · Artifact flow

本 Artifact 仅冻结 `375 × 812` 的浅色参考稿和 development-only Fixture transition，不创建原生页面、接口、契约或生产数据。

`create-ready → draft-manage`：点击“保存草稿”，以真实已确认订单摘要创建仅队长可见的私有草稿。

`draft-manage → public-readonly`：点击“预览公开详情”；来源写入浏览器 history，公开页点击“返回管理页”会确定性地返回 `draft-manage`。

`draft-manage → create-ready`：点击“编辑球局”或“放弃草稿”；放弃草稿需二次确认，Fixture 返回可编辑创建页。

`draft-manage → draft-manage`：点击主操作“发布球局”先展开一页内“发布前确认”，列出真实场地、开放名额、预计 AA、线下结算、报名截止和可见范围；“返回修改”关闭确认层。

`draft-manage → published-manage`：只有点击“确认发布”才以 Fixture transition 展示已发布管理状态。

`published-manage → published-manage`：点击“分享球局”打开 Fixture 分享动作；点击“取消球局”打开确认层，提供“继续保留”关闭动作。取消球局不改订单、不取消已预订场地、不发起退款。

`published-manage → cancelled-readonly`：只有点击“确认取消球局”才进入内部 `CANCELLED` 只读结果；该结果隐藏分享、编辑和取消操作，不增加第五张 reference 或 manifest 状态。

`published-manage → public-readonly`：点击“查看公开页”；公开页“返回管理页”确定性地返回 `published-manage`，并保留浏览器返回历史。

`published-manage → create-ready`：点击“编辑球局”恢复可编辑 Fixture。

`public-readonly`：“当前仅供查看，申请加入即将开放”为普通非交互说明文字，不使用 CTA 外观；仅“返回管理页”可用。

公开页只公开场馆、物理场地、日期时间、人数、强度、位置、AA、截止和到场说明；公开页不暴露联系、订单或支付字段。

Fixture 将 `UNSAVED`、`DRAFT`、`PUBLISHED` 和 `CANCELLED` 作为独立业务生命周期保存。保存草稿、确认发布、放弃草稿和确认取消以 `replaceState` 替换当前 history 条目；公开预览及编辑等纯导航才使用 `pushState`。因此浏览器 Back 命中旧的草稿或已发布 URL 时，`popstate` 先按当前生命周期解析：`PUBLISHED` 不会回退为 `DRAFT`，`CANCELLED` 不会重新显示分享、编辑或取消操作。

人数步进器始终即时约束 `固定队员 + 开放名额 ≤ 计划总人数`：减少计划人数会停在当前固定与开放人数之和，增加固定或开放人数会停在剩余容量。保存草稿时冻结当前表单快照；草稿、已发布管理、公开详情、发布确认和编辑预填都读取同一快照，而不是各自使用默认人数。

取消后生命周期优先于 history 路由：若 Back 落到旧的 `public-readonly` 或 `published-manage` URL，仍改渲染内部 `CANCELLED` 只读结果，不展示未取消公开详情或旧管理动作。
