# C2b 候补 FIFO · Artifact flow

本 Artifact 只冻结 `375 × 812` 的 development-only 候补旅程与内存 Fixture。唯一标记为 `C2B_WAITLIST_FIXTURE`，生产禁用；它不发送微信消息，也不声称已经通知用户。

`APPLIED → WAITLISTED`：满员球局仍可收到普通申请。队长审核页只提供“加入候补”和“婉拒”，不渲染可用的接受动作。打开确认层不会改变报名；取消后仍为 `APPLIED`，确认后分配该球局下一个不可复用 `waitlist_seq`，进入 `WAITLISTED`。

`WAITLISTED → WITHDRAWN`：候补者详情显示“候补中 · 当前第 N 位”和固定底栏“退出候补”。确认层明确本场不可再次申请；取消保留候补，确认写入 `WAITLIST_WITHDRAWAL`。退出不释放公开名额、不递补下一人，也不改写其他候补的持久序号；剩余候补的可见位置按当前有效队列压缩。

`WAITLISTED → JOINED`：代表帧直接展示服务端权威回读后的“已加入”，容量为 `14 / 14`、剩余 `0`，不存在短暂空位，也不显示“已通知”或“通知成功”。通知投递是独立外部门槛，不能替代报名状态。

`SUSPENDED`：暂停期间不自动递补，但未开场候补者仍可退出候补。取消、已开场和终态不渲染无效 CTA。所有按钮都产生真实 Fixture transition；底栏和确认层预留 safe-area，按钮至少 44px 且文字显式双轴居中。
