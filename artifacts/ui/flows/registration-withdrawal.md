# C2a 撤回申请 / 退出球局 · Artifact flow

本 Artifact 仅冻结 `375 × 812` 的 development-only 交互参考稿和内存 Fixture；不创建小程序生产入口、接口、契约、后端写入或部署。隔离标记为 `C2A_REGISTRATION_WITHDRAWAL_FIXTURE`，生产始终禁用。

`APPLIED → applied-confirm → WITHDRAWN`：待队长审核时显示“撤回申请”。打开确认层只改变本地 `panel`；“保留报名”会关闭确认层并保留 `APPLIED`，文案明确报名仍被保留。“确认撤回”写入终态 `WITHDRAWN / APPLICATION_WITHDRAWN`，剩余名额保持 4 个，因为尚未加入的申请没有占用球员名额。

`JOINED → joined-confirm → WITHDRAWN`：已加入时显示“退出球局”。代表视觉帧是距离开场 5 小时的 `joined-confirm`；确认层明确“记录临时退出，但首期不封禁、不扣款”。“保留报名”关闭确认层并保留 `JOINED`；“确认退出”写入 `WITHDRAWN / GAME_EXITED`，剩余名额从 4 个增加为 5 个，仅释放 1 个名额。

`result-unknown → WITHDRAWN`：这是非代表 internal state。上次退出响应未知时显示“退出结果待确认”，唯一业务动作是“确认退出结果”；它读取 Fixture 中的权威结果并收敛到 `WITHDRAWN / GAME_EXITED`。该状态不得再次提交退出，也不进入截图矩阵。

两种 `WITHDRAWN` 都是终态：详情明确“本次报名已结束 / 不得再次申请本场球局”，不渲染退出或再次申请动作。标题栏返回使用浏览器 history；没有可返回页面时进入 development-only “我的报名”参考稿。确认层的取消和确认均真实改变内存状态，不用 Toast 或静态跳转冒充结果。

视觉沿用现有蓝绿层级、圆角、字体和 4/8px 间距；只在退出入口、确认按钮和不足 6 小时提示上使用克制的浅红危险语义。所有按钮至少 `44px`，文字显式 flex 双轴居中，底栏和确认层预留 safe-area。
