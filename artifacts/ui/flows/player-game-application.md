# 散客申请与队长审核 · Artifact flow

本 Artifact 仅冻结 `375 × 812` 的 development-only 参考稿和内存 Fixture transition；不创建生产入口、接口、契约或数据。

`anonymous-detail`：分享详情公开真实场馆、场地、时间、球队名 `津门周末队`、剩余名额、预计 AA、报名截止和到场说明。“登录并继续”只写入隔离登录态并停留在当前详情，随后出现“申请加入”。

`anonymous-detail → application-ready`：点击“申请加入”通过浏览器 history 打开申请表。表单要求“本场称呼”、意向位置、可选备注、成年确认和运动风险确认；辅助文案明确本场称呼不是微信昵称或实名。

`application-ready → anonymous-detail`：点击“取消”返回详情，取消不写报名。标题栏“返回”使用真实浏览器 history；没有可返回页面时回到预览初始详情。

`NONE → APPLIED → JOINED`：点击“提交申请”以 Fixture transition 写入唯一 `APPLIED` 结果；队长点击“接受加入”先打开确认层，只有“确认接受”才写入 `JOINED`。

`NONE → APPLIED → REJECTED`：同一申请进入审核后，队长点击“婉拒”先打开确认层，只有“确认婉拒”才写入 `REJECTED`。

关闭确认层不改状态：“关闭确认层”或“返回审核”仅清除可见确认层，报名保持 `APPLIED`。接受与婉拒共用同一确认层结构。

`applied-detail`、`joined-detail`、`rejected-detail`：申请人始终回到同一分享详情；“刷新结果”重新读取当前 Fixture 状态，不制造第二条申请或其他结果。

所有可见动作——登录并继续、申请加入、位置与确认项、取消、提交、刷新结果、接受、婉拒、确认、关闭和返回——都更新内存状态或浏览器 history，不以 Toast 或静态跳转冒充业务成功。

公开详情不暴露联系信息、订单标识、结算流水、完整名单或个人画像；队长页只展示申请人主动提交的本场称呼、位置、备注和申请时间。本预览不承诺候补、通知、退出或平台内收费能力。
