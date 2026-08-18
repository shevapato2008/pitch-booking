# 队长开放球局 · Artifact flow

本 Artifact 仅冻结 `375 × 812` 的浅色参考稿和 development-only Fixture transition，不创建原生页面、接口、契约或生产数据。

`create-ready → draft-manage`：点击“保存草稿”，以真实已确认订单摘要创建仅队长可见的私有草稿。

`draft-manage → public-readonly`：点击“预览公开详情”；公开页保持只读。

`draft-manage → create-ready`：点击“编辑球局”或“放弃草稿”；放弃草稿需二次确认，Fixture 返回可编辑创建页。

`draft-manage → published-manage`：点击“确认发布”，以 Fixture transition 展示已发布管理状态。

`published-manage → published-manage`：点击“分享球局”打开 Fixture 分享动作；点击“取消球局”打开确认意图。取消球局不改订单、不取消已预订场地、不发起退款。

`published-manage → public-readonly`：点击“查看公开页”。

`published-manage → create-ready`：点击“编辑球局”恢复可编辑 Fixture。

`public-readonly`：没有可用按钮；“当前仅供查看，申请加入即将开放”为非交互说明。

公开页只公开场馆、物理场地、日期时间、人数、强度、位置、AA、截止和到场说明；公开页不暴露联系、订单或支付字段。
