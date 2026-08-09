# 足球场预订小程序：地图找球场与多场馆目录切片设计

**日期：** 2026-07-30  
**状态：** 用户已确认书面规格；独立规格审查已通过
**依赖：** 支付确认切片 `feature/payment-confirmation`  
**交付约束：** `modelstella.com` ICP 完成前不做阿里云公开 HTTPS、真机生产定位或最终上线交付

## 1. 目标

把小程序默认首页从单一合作场馆详情改为“地图找球场”，用真实天津地图展示五家场馆：一家合作场馆支持现有在线预订，四家公共目录场馆只展示已核验的公开资料。用户可按需显示自己的位置、点击地图标记查看场馆卡片、进入每家场馆主页，并从场馆主页通过“在地图中查看”返回地图且自动定位、高亮该场馆。

首期验证的不是完整的贝壳式地图搜索平台，而是三个产品判断：

1. 用户能否通过地图快速理解场馆分布与交通便利度；
2. “可预订”与“暂不可预订”场馆能否在同一目录中保持状态诚实；
3. 现有单场馆预订旅程能否在多场馆入口下继续工作且不发生身份混淆。

## 2. 已确认决定

- 默认首页为地图页，采用“全地图 + 可拖动底部场馆卡片”布局。
- 首批使用混合数据：一家合作场馆可预订，四家真实天津场馆仅作目录展示。
- 用户进入地图时不自动请求定位；只有点击“定位到我”才申请位置权限。
- 首期只展示场馆周边最近地铁站、公交站和距离，不计算用户到场馆的公交路线或预计时间，不提供地铁线路筛选。
- 场馆和交通站点由平台人工核验并保存到 PostgreSQL；运行时不实时查询第三方 POI。
- 用户位置只在小程序页面内存中使用，不上传、不持久化、不写日志。
- 每家场馆均有自己的详情页和“在地图中查看”按钮。
- 地图组件使用 GCJ-02 坐标。微信官方文档说明 `<map>` 使用火星坐标系，`wx.getLocation` 应指定 `gcj02`；同层渲染自基础库 2.8.0 支持。[微信 `<map>` 官方文档](https://developers.weixin.qq.com/miniprogram/dev/component/map.html)

## 3. 首批场馆

| 场馆 | 区域 | 预订状态 | 公开资料基准 |
| --- | --- | --- | --- |
| 渤海元丰足球场 | 西青区利达路 | `ONLINE` | 用户提供的腾讯地图落点“天津市渤海元丰科技有限公司-南门”；展示名经用户确认 |
| 天津奥林匹克中心五人制足球场 | 南开区宾水西道 1 号 | `DIRECTORY_ONLY` | 天津市体育局社会足球场地名录 |
| 天津火车头体育场 | 河北区中山北路增 1 号 | `DIRECTORY_ONLY` | 天津市体育局社会足球场地名录 |
| 天津市人民体育馆足球场 | 和平区贵州路 33 号 | `DIRECTORY_ONLY` | 天津市体育局公共体育场馆开放资料 |
| 东丽体育中心足球场 | 东丽区先锋东路 3 号 | `DIRECTORY_ONLY` | 天津市体育局公共体育场馆开放资料 |

实施前必须逐项核验 GCJ-02 场馆坐标、导航落点、最近地铁站、最多三个公交站、站点坐标、线路和距离。公开目录场馆不得展示未再次核验的价格、库存、联系电话、营业时间或可预订承诺。天津市体育局资料仅作为场馆存在与地址的初始依据：

- [天津市社会足球场地开放运营情况明细表](https://ty.tj.gov.cn/jmty/ggzq/tzgg2/202109/W020210907653765607943.pdf)
- [公共体育场馆开放信息](https://ty.tj.gov.cn/sy2/gabsycs/qmjsgh/202402/t20240207_6534402.html)

## 4. 范围与非目标

### 4.1 首期范围

- 地图默认首页与五个场馆标记；
- 标记、选中态、底部卡片和地图视野联动；
- 场馆列表摘要与单场馆详情；
- 用户按需定位；
- 用户与场馆的端内近似直线距离；
- 场馆周边已核验地铁/公交信息；
- 目录场馆与在线场馆的清晰状态区分；
- 场馆主页到地图的定点深链；
- 地图异常时的列表和地址降级；
- 本地 FastAPI、PostgreSQL、微信开发者工具集成验收。

### 4.2 非目标

- 地图移动后“搜索此区域”；
- 标记聚合；
- 地铁线路、价格、时间或距离筛选；
- 实时公交/地铁路线与预计到达时间；
- 第三方 POI 实时查询或定期同步任务；
- 商家自主入驻；
- 为目录场馆创建库存、价格、联系人或订单；
- 后台场馆内容管理界面；
- 阿里云公开部署、生产隐私指引提交和真机最终交付。

## 5. 用户旅程与页面

### 5.1 地图默认首页 `pages/venue-map/index`

1. 页面请求地图目录；加载成功后用全部五个场馆计算合适视野。
2. 地图上在线场馆使用品牌蓝标记和“可订”语义，目录场馆使用中性标记；不能只靠颜色区分。
3. 初始底部卡片显示目录数量和当前推荐场馆；点击标记或横向切换卡片时，双方选中态同步。
4. 点击“场馆详情”进入相应场馆主页。
5. 在线场馆卡片显示“查看可订时段”；目录场馆显示“暂未接入在线预订”，不渲染不可用的预订按钮。
6. 点击“定位到我”后申请定位。成功则显示当前位置并可在卡片中显示“距你约 X km”；失败或拒绝不改变目录可用性。
7. 用户拖动、缩放地图只改变视野；首期不因视野变化重新请求或过滤场馆。

底部卡片采用同层渲染的普通视图覆盖地图，默认停在约 43% 高度，并提供收起、默认、展开三个吸附位置。只有把手与卡片标题区响应垂直拖动；卡片内容保留横向切换，卡片外地图区域保留平移和缩放，避免手势争抢。展开态最高不覆盖系统导航栏与安全区，收起态仍显示选中场馆名称、状态和主动作。

首期视觉与交互基准固定为已安装的微信开发者工具 Stable `2.01.2510290`、基础库 `3.17.0` 和 WebView 渲染；`project.config.json` 必须显式记录基础库版本，不能依赖 `latest`。真机回归证明首次 `bindupdated` 并不是可靠的地图健康信号：地图可用时也可能没有在任意固定时限内回调。因此运行时不得用计时器或缺失的 `bindupdated` 推断地图失败，也不得因此卸载仍可继续渲染的 `<map>`；目录卡片始终保持可用。历史 `map-render-failure` 只保留为设计过程证据，不进入开发或生产运行时。

### 5.2 场馆主页 `pages/venue/index`

- 页面通过 `venueId` 加载任意场馆详情；旧的无参数入口只保留兼容行为，解析到合作主场馆。
- “位置与交通”区域显示地址、最近地铁/公交和“在地图中查看”。
- 点击该按钮导航到 `/pages/venue-map/index?venueId=<id>`。
- 在线场馆继续展示当前完整内容和“查看可订时段”。
- 目录场馆只显示已核验公开资料、地图和导航入口；显著标记“暂未接入在线预订”。
- 从地图进入详情后返回，恢复地图视野、选中场馆与底部卡片位置；不重新请求定位。

### 5.3 定点打开地图

地图页收到 `venueId` 后：

1. 先加载完整地图目录；
2. 找到场馆则以该坐标居中、高亮标记并展开其卡片；
3. 不自动申请用户定位；
4. 找不到场馆则显示全部场馆视野并轻提示“该场馆暂不可用”；
5. 返回操作回到来源场馆主页。

## 6. 前端结构

新增窄边界：

- `VenueDirectoryDataSource`：读取地图目录和任意场馆详情；
- `LocationCapability`：封装 `wx.getLocation({type: "gcj02"})`、权限拒绝和设置跳转；
- `MapViewportController`：纯函数计算全部场馆、选中场馆和用户位置对应的中心与缩放范围；
- `VenueMapPresentation`：把契约数据转为标记、卡片、交通标签和状态文案；
- `DistanceCalculator`：仅在端内计算用户到场馆的近似直线距离，不接触 Transport。

生产实现只使用 HTTP 数据源和微信原生能力。Fixture 只用于 Artifact 与视觉对齐，并放在开发目录；HTTP 集成完成后，页面生产路径不得导入地图业务 Fixture，生产包审计增加对应禁止项。

## 7. API 契约

保留现有 `GET /api/v1/venues/primary`，避免破坏已经完成的预订旅程。新增：

### 7.1 `GET /api/v1/venues/map`

返回所有启用且可公开展示的场馆，按 `sort_order`、名称、ID 稳定排序：

```json
{
  "coordinate_system": "GCJ02",
  "venues": [
    {
      "id": "uuid",
      "name": "渤海元丰足球场",
      "address": "天津市西青区利达路",
      "latitude": 39.0,
      "longitude": 117.0,
      "booking_mode": "ONLINE",
      "pitch_types": ["FIVE_A_SIDE", "SEVEN_A_SIDE"],
      "cover_image": null,
      "nearest_transit": [
        {
          "kind": "BUS",
          "name": "站点名称",
          "lines": ["线路"],
          "distance_meters": 420,
          "distance_basis": "MAP_VERIFIED"
        }
      ],
      "content_verified_at": "2026-07-30T00:00:00+08:00"
    }
  ]
}
```

`cover_image` 只允许已授权的 HTTPS URL 或 `null`；包内占位图属于客户端 presentation，不出现在 HTTP 契约。目录场馆没有授权图片时返回 `null`，前端使用统一的品牌足球场占位视觉，不抓取第三方图片。

### 7.2 `GET /api/v1/venues/{venue_id}`

OpenAPI 使用以 `booking_mode` 为判别字段的封闭 `oneOf`，两种变体均拒绝额外字段。共同必填字段为：

- `id`、`slug`、`name`、`description`、`address`；
- 场馆标记 `latitude`、`longitude` 和固定 `coordinate_system: GCJ02`；
- `navigation_poi_name`、`navigation_latitude`、`navigation_longitude`；
- `booking_mode`、`pitch_types`、`cover_image`、完整 `nearest_transit`；
- `content_verified_at`。

`OnlineVenueDetail` 额外要求 `price_advantage_text`、`timezone`、`business_hours_text`、`parking_text`、`phone`、`refund_policy_summary`、非空 `images`、非空 `facilities`、非空 `pitch_types` 和 `availability_window`，字段语义与现有 `PrimaryVenueResponse` 一致。`DirectoryVenueDetail` 不包含价格、库存、联系电话、退款规则或 availability window；其公开展示字段按下一段使用统一的 required-nullable/required-array 规则，不能用“待定”字符串伪装数据。

为消除可选/空值歧义，`DirectoryVenueDetail` 的 `business_hours_text`、`parking_text` 必须存在且类型为 `string | null`；`images`、`facilities` 必须存在且类型为数组，无数据时返回空数组；`pitch_types` 必须存在且可为空。`cover_image` 必须存在且为 HTTPS URL 或 `null`。状态文案不由服务器下发，客户端只根据 `booking_mode` 映射固定文案“可预订”或“暂未接入在线预订”。

`GET /api/v1/venues/primary` 的路径、状态码、schema、字段集合、必填性和语义保持兼容，不增加目录字段。兼容测试比较规范化 golden response：除按类型验证的动态 `generated_at` 外，字段和值与现有 golden 一致。FastAPI 必须先注册字面量 `/venues/primary` 和 `/venues/map`，再注册 `/venues/{venue_id}`；路由表测试直接请求两个字面量路径，证明未被 UUID 参数路由遮蔽。

### 7.3 错误

- 未知或未启用场馆：`404 VENUE_NOT_FOUND`；
- 地图目录没有任何可展示场馆或在线主场馆约束损坏：`500 VENUE_DIRECTORY_MISCONFIGURED`；
- 数据库不可用：沿用统一 `503`/内部错误边界和请求 ID；
- 响应字段或坐标不合法：小程序严格解码失败，进入目录加载错误，不渲染部分假数据。

API 不接收用户经纬度，也不提供按用户位置排序的服务端参数。

### 7.4 预订边界

`booking_mode = ONLINE` 是服务端业务门槛，而不只是 UI 状态。`/venues/primary`、availability、checkout、创建订单和创建支付入口都必须在读取关联场馆后校验 `ONLINE`；直接构造目录场馆 URL 一律返回不泄露库存细节的 `404 VENUE_NOT_FOUND`。数据库约束保证 `is_primary => booking_mode = ONLINE`。存在 pitch、slot、order 或 payment 历史的场馆不得从 `ONLINE` 改为 `DIRECTORY_ONLY`，内容装载必须在事务提交前拒绝该变更。

订单详情继续使用订单创建时已经确定的在线场馆边界；本切片不把目录场馆的可空电话或其他可变资料引入订单快照。availability 使用目录 venue ID 可直接验证拒绝。checkout、order 和 payment 是 slot/order 定址，测试在隔离事务中绕过内容装载器，刻意构造 `DIRECTORY_ONLY venue → pitch → slot → order → payment` 的不一致防御性图，再直接请求各入口并断言服务层 mode guard 拒绝；事务随后回滚。该 fixture 只证明纵深防御，不允许出现在 seed、内容清单或运行时 Fixture。

## 8. PostgreSQL 模型

在现有 `venues` 上增加：

- `booking_mode` 枚举：`ONLINE | DIRECTORY_ONLY`，非空；
- `navigation_poi_name`，非空；
- `navigation_latitude`、`navigation_longitude`，合法范围且非空；
- `sort_order >= 0`，非空；
- `content_verified_at`，非空；
- `is_listed`，非空；
- 将只属于在线预订的展示字段改为可空，并增加条件检查：`booking_mode = ONLINE` 时必须完整且非空。

`latitude/longitude` 表示地图标记使用的场馆中心点；`navigation_latitude/navigation_longitude` 表示 `wx.openLocation` 使用的已核验入口，二者不得混用。现有合作场馆保持 `is_primary = true` 和 `booking_mode = ONLINE`。目录场馆不得拥有 pitch/slot 数据；服务层和部署验证共同检查这一条件。现有“最多一个启用主场馆”约束不变，并新增 `is_primary => booking_mode = ONLINE` 检查。

新增 `venue_transit_stops`：

- UUID 主键、`venue_id` 外键 `ON DELETE CASCADE`；
- `kind` 枚举 `SUBWAY | BUS`；
- 非空 `name`；
- `lines` 为 JSON 字符串数组，元素去空白、去重且稳定排序；
- 合法 GCJ-02 `latitude`、`longitude`；
- `distance_meters >= 0`；
- `distance_basis`：`STRAIGHT_LINE | MAP_VERIFIED`；
- 非空 `source_name`、可选 `source_url`、非空 `verified_at`；
- `sort_order >= 0`；
- `UNIQUE(venue_id, kind, name)`，并建立 `venue_id` 索引。

公开 API 不返回内部来源 URL，但部署内容校验必须检查来源和核验时间。首期不建设空间数据库、PostGIS 或半径查询。

### 8.1 迁移策略

迁移必须兼容已经存在主场馆、库存、订单和支付的数据库：

1. 先增加允许为空的新列；`booking_mode`、`is_listed`、`sort_order` 使用只用于迁移的安全默认值；
2. 使用受版本控制的 legacy UUID/slug 映射覆盖数据库中的每一条既有 venue，并回填 mode、导航入口、排序和核验时间，不按可变名称匹配；主场馆映射为 `ONLINE`，其他记录必须有明确映射决定，否则整个事务在施加最终约束前回滚；
3. 更新非生产 demo seed，使其显式写入全部新字段；
4. 对回填数据和现有订单链路做完整验证；
5. 最后移除临时默认值并施加非空、条件字段、主场馆模式检查约束；
6. 目录数据由迁移后的独立内容装载步骤创建，不写死在 Alembic 迁移中。

降级不得把目录场馆伪装成在线场馆、补造字段或静默删除历史。如果存在 `DIRECTORY_ONLY` 或其他不能满足旧 schema 非空约束的记录，downgrade 必须在任何 DDL 前原子拒绝，并提示先运行显式目录卸载；只有目录内容已卸载且现有在线场馆满足旧 schema 时才允许降级。迁移测试必须覆盖包含主场馆、pitch、slot、order 和 payment 的 legacy 数据库、额外 inactive/non-primary legacy venue 的完整映射、未映射 legacy venue 的原子失败，以及目录装载后的安全拒绝、卸载后的 downgrade、再次 upgrade。

## 9. 内容装载与权威边界

新增受版本控制的场馆目录内容文件和显式装载命令。每个场馆使用清单中固定、不可复用的 UUID 和唯一 slug 作为幂等身份；后续更名或地址修正不能改变 UUID/slug，任何 UUID/slug 交叉指向现有其他场馆都必须失败。装载在单一事务内完成 schema 校验、引用校验、全部差异计算和约束预检，全部通过后才提交；失败不得产生部分场馆或交通站点。

地图目录和任意场馆详情的公开谓词统一为 `is_active AND is_listed`。`is_active` 表示业务实体仍有效，`is_listed` 只控制公共目录展示。内容清单移除一条记录时，装载器只把对应记录 `is_listed` 设为 false，不删除、改 UUID、改 slug、改 `booking_mode` 或改变现有主场馆身份；恢复展示继续使用同一身份。`/venues/primary` 仍使用原有 active-primary 规则并额外要求 `ONLINE`，不依赖 `is_listed`，避免一次目录下架破坏已有订单入口。

命令支持 dry-run，输出新增、更新、下架和拒绝差异，但不能改订单、库存或支付数据。生产模式必须要求显式审批文件，开发/测试可装载明确标记的测试内容。

距离语义必须诚实：

- `STRAIGHT_LINE` 表示根据两个已核验坐标计算的近似直线距离；
- `MAP_VERIFIED` 表示人工在地图路线或测距结果中核验；
- UI 统一显示“距场馆约 Xm”，不暗示步行时间；
- 未核验时不创建站点记录，页面显示“交通信息待核验”。

清单中的每个场馆中心点、导航入口和站点坐标都必须显式标注 `coordinate_system: GCJ02`；其他坐标系或缺失标注直接拒绝。装载器除通用经纬度范围外，还使用覆盖天津市及合理缓冲区的边界盒做防错校验，并保存来源名称、来源链接或内部证据编号、核验人和核验时间。边界盒只用于发现录入错误，不声称能够从数值证明坐标系真实性；GCJ-02 真实性由证据和人工核验负责。

## 10. 隐私与权限

- 页面不在首次加载时调用定位；
- 只有用户点击明确的“定位到我”按钮后才触发隐私授权和系统权限；
- 使用位置的目的文案为“在地图中显示你的位置并估算你与球场的距离”；
- 坐标只存在于页面内存，不进入请求、缓存、埋点、日志或数据库；
- `<map show-location>` 初始为 false，只有 `wx.getLocation({type: "gcj02"})` 成功后才设为 true，避免地图组件自行触发首次授权；
- 本地开发阶段即在 `app.json` 声明 `permission.scope.userLocation.desc = "在地图中显示你的位置并估算你与球场的距离"` 和 `requiredPrivateInfos: ["getLocation"]`，不能因 ICP 暂缓；
- `LocationCapability` 区分：小程序隐私同意被拒绝、`scope.userLocation` 权限拒绝、系统定位服务关闭、超时和其他失败。只有 `scope.userLocation` 权限拒绝显示“前往设置”并调用 `wx.openSetting`；其他失败给出对应非阻断说明；
- 从设置返回后不在 `onShow` 自动重新定位，用户必须再次点击“定位到我”；成功前不得保留上一次失败的坐标；
- 用户拒绝、系统定位关闭或接口失败时，目录和预订功能保持可用；
- 正式提审前仍需在微信公众平台更新用户隐私保护指引，并在 iOS、Android 真机验证授权、拒绝和再次开启流程；只有平台提交和真机生产证据因 ICP 约束暂缓，代码包配置和开发者工具测试不暂缓。

## 11. 状态与恢复

| 状态 | 用户界面 | 恢复 |
| --- | --- | --- |
| 首次加载 | 地图骨架与卡片骨架，不显示假标记 | 请求成功后一次替换 |
| 目录加载失败 | 错误说明与“重新加载” | 用户主动重试 |
| 地图渲染较慢 | 保持地图和场馆卡片挂载，不根据时间或缺失的 `bindupdated` 宣告失败 | 原生地图继续渲染；场馆卡片始终可用 |
| 定位进行中 | 定位按钮显示加载反馈，防重复点击 | 成功显示位置，失败恢复按钮 |
| 小程序隐私拒绝 | 非阻断隐私说明，不打开系统设置 | 用户再次点击后重新走隐私同意 |
| 位置权限拒绝 | 非阻断说明和“前往设置” | 返回后用户再次点击，不在 `onShow` 自动获取 |
| 系统定位关闭 | 提示开启系统定位服务，不调用 `openSetting` | 开启后用户再次点击 |
| 定位超时/其他失败 | 短提示并恢复定位按钮 | 用户主动重试 |
| 深链 ID 无效 | 全部场馆视野 + 轻提示 | 可正常选择其他场馆 |
| 交通无记录 | “交通信息待核验” | 内容重新装载后自然恢复 |
| 目录场馆 | “暂未接入在线预订” | 不显示库存和预订 CTA |

任何晚到的目录或定位响应都必须用请求世代/页面存活检查丢弃，不能覆盖用户已经选中的场馆或已卸载页面。

## 12. 测试与验收

### 12.1 轻量自动化

- OpenAPI 示例和严格解码器覆盖在线、目录、无图片、无交通和错误响应；
- PostgreSQL 迁移升级/降级/升级、条件字段约束、场馆状态和交通唯一性；
- API 排序、目录详情、404、空目录错误和在线主场馆兼容；
- `/primary`、`/map` 字面量路由不被 `/{venue_id}` 遮蔽；在线/目录详情判别联合约束完整；
- 地图 presentation、标记选择、卡片联动、深链回退、距离格式化；
- 缺失 `bindupdated` 时不启动计时器、不切换错误页，场馆卡片保持可用；
- 小程序隐私拒绝、位置权限拒绝、系统定位关闭、超时、其他失败、从设置返回后的显式重试、重复点击、页面卸载晚响应；
- 初次 `onLoad`/`onShow` 不调用定位，只有成功后启用 `show-location`；
- 直接 API 请求证明目录场馆不能进入 availability、checkout、order、payment；在线场馆仍完成现有预订入口；
- 生产包不包含地图 Fixture、开发坐标或模拟定位能力。

不为首期 UI 扩张恶意输入模糊测试、地图性能基础设施或通用空间索引。

### 12.2 视觉确认

目标 viewport 为 375×812。必须同时提供参考图、微信开发者工具实现截图、并排图、50% 叠加图和差异图，至少覆盖：

- 全部五家场馆默认视野；
- 在线场馆选中；
- 目录场馆选中；
- 场馆主页“在地图中查看”；
- 定点打开地图；
- 拒绝定位；
- 场馆名称/地址搜索、无结果提示和主动定位后的最近场馆选中。

核对构图、地图与底卡比例、标记层级、字体色彩、44×44 最小触控目标、8px 最小交互间距、状态文案和安全区。固定在 DevTools Stable `2.01.2510290`、基础库 `3.17.0` 验证普通 view 叠层、三个底卡吸附位置、底卡横向切换、地图平移/缩放、手势边界和失败重试；验收记录必须写明实际版本。自动布局测试不能替代视觉确认。

### 12.3 本地真实旅程

1. 本地 PostgreSQL 装载五家已核验场馆；
2. FastAPI 返回真实目录和详情；
3. 微信开发者工具打开默认地图首页；
4. 选择五个标记并验证卡片；
5. 从渤海元丰进入时段页，证明现有预订旅程仍可达；
6. 从目录场馆确认没有预订入口；
7. 从每个场馆主页定点返回地图；
8. 模拟定位成功、隐私拒绝、位置权限拒绝、系统定位关闭和设置返回后的显式重试；
9. 查询 PostgreSQL 证明目录场馆没有 pitch、slot、order 或 payment 数据。

## 13. Fixture 删除条件与完成定义

地图 Fixture 只用于 Artifact 和视觉阶段。HTTP 集成完成后必须删除地图专用 fixture 数据文件、fixture transport 注册、默认 fixture bootstrap 分支、模拟定位实现和全部业务模拟入口；历史 `map-render-failure` 截图可作为已弃用方案的设计记录保留，但对应控制器不得进入 development-HTTP 或 production 依赖图。现有预订/支付切片的独立测试 Fixture 不在本切片删除范围内。

完成条件：

- OpenAPI 契约冻结；
- PostgreSQL 已装载五家核验数据；
- 地图和详情页从真实 HTTP 获得业务状态；
- 微信开发者工具本地真实旅程通过；
- development-HTTP 与 production 两套编译依赖图均不包含地图业务 Fixture 或模拟定位；
- 包审计搜索已知 mock venue UUID、测试坐标、fixture bootstrap 符号和 simulated-location 符号均为零匹配；
- 生产包审计证明没有地图 Fixture、模拟场馆或模拟定位。

本切片的“本地开发完成”要求设计确认、契约、后端、前端、真实 HTTP/PostgreSQL 集成和开发者工具验收全部通过。阿里云部署、公开 HTTPS、生产隐私配置、iOS/Android 真机定位和最终上线证据按用户要求作为最后一步保留，ICP备案完成后执行；在此之前不得宣称生产交付完成。
