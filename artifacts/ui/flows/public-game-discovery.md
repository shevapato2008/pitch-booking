# 公开球局发现 · Artifact flow

本 Artifact 是 `375 × 812`、`production-disabled` 的 C1b 开发预览，只使用合成目录，不创建生产入口、接口或业务数据。

`ready-list → filtered-nonempty`：日期、人制和仅看有名额使用 AND 即时组合。日期项直接更新自然日；人制控件在全部、五人制和七人制之间切换；名额控件只保留 `remainingSpots > 0` 的球局。默认目录仍包含已满球局并按开场时间升序。

`filtered-nonempty → filter-no-match`：合法筛选可以得到零条结果。页面明确显示 `filter-no-match`，点击“清除筛选”恢复全部日期、全部人制且关闭仅看有名额，不把筛选无结果伪装成资源为空。

`load-error → ready-list`：点击“重新加载”把同一内存目录从读取失败恢复为可浏览状态，不创建或修改球局。

`source-empty → 开发预览入口`：真正没有公开球局时显示独立自然空态，“返回选择目的”执行真实的 Fixture 导航，不复用筛选清除动作。

`卡片 → 对应只读详情`：整张卡片先保存自己的精确 ID，再通过浏览器 `history` 进入该条球局的详情。未知 ID 显示不存在状态，不回退第一条。

`对应只读详情 → 列表`：点击 header 返回或“返回球局列表”，返回列表并保留筛选；详情读取同一条目录记录，不维护另一份展示数据。

详情仅展示场馆、物理场地、日期时间、人制、强度、位置、人数、预计 AA、线下结算、截止、组织球队和到场说明，不提供申请操作。

`loading` 保持 header、说明和筛选稳定并显示两个等高 skeleton。该状态和 `source-empty`、详情、未知详情只做行为验证和一次聚焦人工检查，不进入四图参考矩阵。

四个正式视觉状态固定为 `ready-list`、`filtered-nonempty`、`filter-no-match` 和 `load-error`。所有可见按钮都通过 Fixture transition 改变内存状态或浏览器 history；卡片内部没有嵌套操作。
