# 足球场预订小程序：共享基础与场地浏览切片设计

日期：2026-07-22

状态：正式规格；已完成 5 轮独立审查，最终机械修订待用户确认
上游需求：[天津足球场预订小程序初版 PRD](../../../superpowers/tracks/overview-20260721/prd.md)

## 1. 目标与本次边界

项目采用“共享基础优先的用户旅程垂直切片开发”。本规格确定 MVP 的整体交付架构，但下一份实施计划只覆盖：

1. 满足首个切片所需的最小共享基础；
2. 第一条完整用户旅程：`打开小程序 → 浏览场馆 → 选择场地类型和日期 → 查看当天时段状态`；
3. 该旅程从真实运行时设计、临时 Fixture、API 契约、后端实现、集成到测试环境验收的完整闭环。

订单支付、球局报名、退款、场馆管理和平台交付只在本文中定义边界与顺序，不进入本次实施计划。每个后续切片开始前都要基于 PRD 编写自己的增量规格和计划。

首个切片成功的含义是：用户能在微信开发者工具、iOS 真机、Android 真机和阿里云测试环境中，看到服务端返回的真实场馆及未来 14 天时段；加载、空数据和错误状态均可验证；生产运行路径中没有模拟业务数据。

## 2. 已选方案与备选方案

### 2.1 选择：原生小程序 + FastAPI 模块化单体

- 前端使用微信原生 WXML、WXSS 和 TypeScript。
- 后端使用 FastAPI、SQLAlchemy 2、Alembic 和 PostgreSQL。
- API 使用 `/api/v1` 前缀，以 OpenAPI 作为前后端共同契约。
- 后续异步补偿使用独立 worker 进程，但与 API 共用业务模块和数据库。
- 阿里云测试环境使用 Docker Compose 和 HTTPS。

这是当前最小、最可控的方案。原生运行时能减少设计稿与真机之间的转换误差；模块化单体足以支撑单场馆 MVP，又保留未来按业务边界拆分的可能。

### 2.2 未选：跨端框架

Taro、uni-app 等方案有跨平台价值，但本期只交付微信小程序。引入额外编译层会增加运行时差异、调试链路和依赖升级成本，不能直接缩短当前 P0 闭环。

### 2.3 未选：微服务或微信云开发

微服务会过早引入服务发现、分布式事务和部署复杂度。微信云开发能减少服务器配置，但与已确定的 FastAPI、PostgreSQL和现有阿里云环境不一致，也不利于后续支付、退款和审计逻辑保持清晰的数据库事务边界。

## 3. 交付原则

### 3.1 最小共享基础

只建设首个切片已经需要的能力：

- 原生小程序工程与 TypeScript 编译；
- 设计令牌、基础组件和真实运行时 UI Gallery；
- 环境配置、HTTP 客户端、错误归一化和请求追踪标识；不建设登录、会话或权限框架；
- Fixture/HTTP 可替换的数据服务接口；
- FastAPI 应用、配置、健康检查、数据库连接和迁移；
- OpenAPI 契约及示例；
- 测试、代码质量和 Docker Compose 骨架。

不提前建设通用工作流引擎、Redis、消息队列、微服务、动态表单、复杂权限框架或 BI 系统。

### 3.2 单切片闭环

每个切片遵循：

`原生运行时 Artifact → 临时 Fixture 前端 → 契约确认 → 后端实现 → 前后端集成 → 自动化与设备/用户验收 → 移除生产 Fixture 路径`

共享状态未稳定时不同时铺开多个未完成切片。一个切片没有部署和验收完成，就不启动下一个切片。

### 3.3 权威边界

- 服务端是场馆配置、价格、日期范围和时段可订性的权威来源。
- 前端可以保存短期展示缓存，但不能用缓存或本地规则断言最终库存。
- 前端不能提交或推导权威价格、最终订单状态、支付状态或退款状态。
- 外部微信结果必须由后端通知或主动查询确认，不能信任小程序回调作为资金事实。

## 4. 真实运行时 Artifact

普通网页或静态图片不作为高保真 UI 依据。微信小程序的逻辑层、渲染层、组件和 WXSS 行为与浏览器不同，因此唯一像素级真源是可在微信开发者工具中运行的 WXML/WXSS/TypeScript。

Artifact 分为四类：

```text
artifacts/
  ui/design-system/       颜色、字号、间距、圆角和状态语义
  ui/screen-manifest/     页面、组件、状态与验收映射
  ui/flows/               用户旅程和信息架构，不承担像素真值
  ui/fixtures/            仅含由契约成功/空响应生成的数据 Fixture
  ui/scenarios/           时序、交互及故障注入场景
  ui/golden/              指定设备与场景的验收基线图
contracts/
  openapi.yaml            HTTP 契约真源
  examples/               成功与错误示例
miniprogram/
  dev/ui-gallery/         真机组件与状态展廊
  dev/scenario-runner/    开发场景入口
```

设计规则：

- 使用 750rpx 响应式基线，同时在 375px 和 390px 逻辑宽度检查布局；
- 保留右上角胶囊按钮安全区域；
- 交互目标不小于约 44×44px，并保持至少 8px 间距；
- 使用系统字体；主要色为可信蓝 `#0284C7`，辅助蓝 `#0EA5E9`，可订绿 `#059669`，白色卡片和深色正文；
- 组件只覆盖首切片实际出现的状态，具体清单由下文 Screen Manifest 约束；
- 浏览器图只用于流程、架构和差异对比，不能替代真机验收。

`artifacts/ui/screen-manifest/venue-browsing.yaml` 是首切片的设计索引，固定使用以下字段：

```yaml
screens:
  - id: venue-home
    route: pages/venue/index
    components: [venue-card, state-panel]
    states: [loading, ready, first-load-error, image-fallback, map-error, phone-error]
    fixtures: [venue-ready]
    scenarios: [venue-first-load-error, venue-image-failure, venue-map-error, venue-phone-error]
    goldens: [devtools-375-ready, devtools-390-ready, ios-ready, android-ready]
    acceptance: [VENUE-01, VENUE-02, VENUE-03]
  - id: availability
    route: pages/availability/index
    components: [date-strip, pitch-filter, slot-grid, state-panel]
    states: [loading, ready, selected, empty, first-load-error, refreshing, stale-error]
    fixtures: [slots-ready, slots-empty]
    scenarios: [slots-first-load-error, slots-refresh-error, slots-selected, slots-late-response]
    goldens: [devtools-375-ready, devtools-390-empty, ios-ready, android-ready]
    acceptance: [SLOT-01]
```

每个 golden 旁保存元数据 JSON：基线文件 SHA-256、页面路径、场景、逻辑宽度、像素比、操作系统、微信版本、基础库版本、开发者工具版本和生成提交。动态时间和请求编号必须使用固定测试时钟或明确遮罩区。首个基线由开发者在固定环境生成，并在阶段交付时由用户接受；后续变更必须同时提交差异图和新基线。

UI Gallery 和 Scenario Runner 是独立开发入口。Fixture 源文件保存在 `artifacts/ui/fixtures/`；开发构建按需生成到忽略版本控制的 `miniprogram/.dev-generated/`。生产构建只使用正式 `app.json` 和 HTTP 服务，不注册开发页面，并通过打包审计确保产物不含 `.dev-generated`、`dev/`、Fixture 响应或 Fixture 服务绑定。

OpenAPI Fixture 只描述数据响应。网络时序和微信原生 API 故障由 `artifacts/ui/scenarios/*.yaml` 描述，例如：

```yaml
id: slots-late-response
clock: 2026-07-22T10:30:00+08:00
http:
  - match: {date: 2026-07-22}
    fixture: slots-ready
    delay_ms: 1200
  - match: {date: 2026-07-23}
    fixture: slots-empty
    delay_ms: 100
native:
  open_location: success
  make_phone_call: success
media:
  fail_image_roles: []
```

小程序把 `Clock`、`Transport`、`NativeCapabilities` 和 `MediaSourceResolver` 作为四个窄接口注入页面服务：生产实现分别使用系统时间、`wx.request`、`wx.openLocation/wx.makePhoneCall`，并原样返回契约图片 URL；Scenario Runner 使用固定时钟、可控延迟/失败、原生能力 stub 和图片源重写。`venue-map-error`、`venue-phone-error` 通过 `NativeCapabilities` stub 触发，不伪造 HTTP 响应。`venue-image-failure` 通过 `MediaSourceResolver` 把 `COVER` 重写为仓库中保证不存在、并由测试预检确认不存在的本地路径 `/_scenario_missing_/venue-cover.png`，从而确定性触发小程序 `<image>` 的 `binderror`，不依赖外网 404。生产构建只绑定生产实现，并由包审计排除所有 Scenario stub。

## 5. 代码边界

建议目录如下：

```text
miniprogram/
  app.*
  components/
    venue-card/
    date-strip/
    pitch-filter/
    slot-grid/
    state-panel/
  pages/
    venue/
    availability/
  services/
    contracts.ts
    http/
  models/
  utils/
  dev/ui-gallery/          仅供开发构建引用，生产打包排除
  dev/scenario-runner/     仅供开发构建引用，生产打包排除
backend/
  app/
    main.py
    core/
    modules/
      venues/
      availability/
    infrastructure/
    providers/
  migrations/
  tests/
contracts/
artifacts/
deploy/
```

### 5.1 小程序组件

- `venue-card`：展示场馆主信息、场地类型、营业时间和卖点，不请求数据。
- `date-strip`：展示服务端允许的日期范围并产生日期选择事件。
- `pitch-filter`：只切换五人制或七人制；响应按物理场地分组展示，不在首切片提供具体场地筛选器。
- `slot-grid`：只根据输入状态渲染时段；不能自行认定时段可售。
- `state-panel`：统一承载空数据与可重试错误；权限状态不属于游客切片。
- 页面负责组合组件与页面级状态，不把 API 细节写进组件。
- `VenueService` 和 `AvailabilityService` 定义稳定接口；Fixture 与 HTTP 适配器实现相同接口。

每个组件必须能在 UI Gallery 中脱离业务页面查看 Screen Manifest 为它列出的状态，不为后续业务预建无用状态。

### 5.2 后端模块

- `venues`：负责场馆、设施、图片、地址、经纬度、客服电话、营业说明、退款规则摘要和物理场地的读取。
- `availability`：负责用户可查看的日期范围、场地筛选以及每个时段的展示状态。
- `core`：只放置跨模块且当前已需要的配置、数据库、统一错误、请求标识和时间工具。
- `infrastructure`：数据库会话和部署技术细节，不承载业务规则。

模块对外通过服务函数和 Pydantic DTO 暴露能力。路由不直接拼接复杂查询，ORM 模型不直接作为 API 响应。

## 6. 首个切片的数据与契约

### 6.1 页面流与日期边界

1. 用户以游客身份打开小程序，无需登录或手机号授权。
2. 首页请求唯一的 `GET /venues/primary` 启动端点。响应包含主场馆 ID、完整详情和可浏览日期窗口；单场馆 MVP 不提供未使用的列表接口。
3. 日期窗口按场馆时区 `Asia/Shanghai` 计算：`start_date` 是服务端当地今天，`end_date` 是今天加 13 天；两端都包含，共 14 个自然日。
4. 页面默认选择 `start_date`，默认场地类型为服务端 `pitch_types` 中 `sort_order` 最小的一项。
5. 页面以日期和场地类型请求当天时段。响应按物理场地分组，首切片不提供具体物理场地筛选。
6. 页面展示开始时间、结束时间、服务端价格和 PRD 规定的明确状态。只有 `AVAILABLE` 可选择。
7. 本切片点击可订时段后只显示“已选择，预订功能将在下一阶段开放”，不创建订单，也不表达为已锁定或预订成功。
8. 地图和拨号使用微信原生能力。阶段验收前必须录入并由合作场馆核对名称、价格优势说明、主图与实拍图、地址、坐标、电话、营业时间、停车、设施和退款摘要；任何“待配置”字段都是阻断项。
9. 应用从后台恢复时比较 `Asia/Shanghai` 当地日期；若已跨日，丢弃旧窗口并重新请求 `/venues/primary`。若 availability 返回 `DATE_OUT_OF_RANGE`，前端也清除窗口缓存、重取 primary、把日期重置为新 `start_date`、把类型重置为新列表第一项并只自动重试一次；再次失败则进入错误态，禁止循环。

选择态是 `READY` 内的页面子状态 `selected_slot_id: UUID | null`，不是服务端库存状态。页面始终单选：点击未选中的 `AVAILABLE` 会替换当前选择；再次点击同一时段会取消；不可用时段点击无效果。切换日期、切换类型、手动刷新、跨日恢复或离开页面时清空选择。自动刷新返回后，仅当同一 `slot_id` 仍是 `AVAILABLE` 才保留选择；否则清空并提示“该时段状态已变化，请重新选择”。刷新进行中禁用所有时段点击。

### 6.2 端点、DTO 与错误信封

本切片端点：

- `GET /api/v1/health`
- `GET /api/v1/venues/primary`
- `GET /api/v1/venues/{venue_id}/availability?date=YYYY-MM-DD&pitch_type=FIVE_A_SIDE`

所有成功响应在 HTTP header 返回 `X-Request-Id`。错误响应统一为：

```json
{
  "error": {
    "code": "DATE_OUT_OF_RANGE",
    "message": "所选日期不在可查询范围内",
    "request_id": "01J...",
    "details": {"start_date": "2026-07-22", "end_date": "2026-08-04"}
  }
}
```

`message` 可直接展示且不含内部信息；`details` 始终为对象，可为空。`request_id` 与 header 相同。

健康检查固定返回 `200 {"status":"ok"}`；它不查询微信服务，但必须检查应用进程和数据库连通性，数据库不可用时返回 `503`。

主场馆 DTO：

```json
{
  "id": "uuid",
  "name": "西青示范足球场",
  "description": "场馆介绍",
  "price_advantage_text": "同等场地规格价格更具竞争力",
  "timezone": "Asia/Shanghai",
  "business_hours_text": "09:00—23:00",
  "address": "string",
  "latitude": 39.000000,
  "longitude": 117.000000,
  "parking_text": "string",
  "phone": "02212345678",
  "refund_policy_summary": "string",
  "images": [{"url": "https://cdn.example.cn/venues/cover.jpg", "alt": "七人制场地主图", "role": "COVER", "sort_order": 0}],
  "facilities": [{"code": "LIGHTING", "name": "照明", "sort_order": 0}],
  "pitch_types": [{"code": "FIVE_A_SIDE", "name": "五人制", "sort_order": 0}],
  "availability_window": {"start_date": "2026-07-22", "end_date": "2026-08-04"},
  "generated_at": "2026-07-22T10:30:00+08:00"
}
```

DTO 中列出的字段全部必填；只有 `description` 允许为空字符串，其他字符串非空，数组至少一项。每个场馆必须恰有一张 `role=COVER` 主图，其余为 `GALLERY`；图片和设施按 `sort_order` 升序、相同序号再按稳定主键升序。经纬度统一存储并输出 GCJ-02，直接传给 `wx.openLocation`，不在客户端二次转换；用真机落点验收防止录入了 WGS-84 坐标。图片存储在项目控制的 HTTPS 对象存储/CDN 域名，该域名必须加入小程序下载合法域名。

可用性 DTO：

```json
{
  "venue_id": "uuid",
  "timezone": "Asia/Shanghai",
  "date": "2026-07-22",
  "pitch_type": "FIVE_A_SIDE",
  "availability_window": {"start_date": "2026-07-22", "end_date": "2026-08-04"},
  "pitches": [{
    "id": "uuid",
    "name": "五人制 1 号场",
    "pitch_type": "FIVE_A_SIDE",
    "sort_order": 0,
    "slots": [{
      "id": "uuid",
      "starts_at": "2026-07-22T18:00:00+08:00",
      "ends_at": "2026-07-22T20:00:00+08:00",
      "price_cents": 30000,
      "status": "AVAILABLE",
      "unavailable_reason": null
    }]
  }],
  "generated_at": "2026-07-22T10:30:00+08:00"
}
```

可用性 DTO 中列出的字段全部必填；仅 `unavailable_reason` 可为 `null`。`price_cents` 是非负整数人民币分。`unavailable_reason` 在 `AVAILABLE` 时必须为 `null`；其他状态分别使用 `HELD_FOR_PAYMENT`、`ALREADY_BOOKED`、`VENUE_CLOSED`、`TIME_PASSED`，与五种展示状态一一对应。`pitches` 和 `slots` 可为空；合法日期无数据返回 `200` 和空数组，不返回 `404`。

查询语义：

- 非法日期格式或非法 `pitch_type`：`422 INVALID_ARGUMENT`；
- `pitch_type` 是合法枚举但当前场馆不支持：`422 PITCH_TYPE_NOT_SUPPORTED`；
- 日期早于 `start_date` 或晚于 `end_date`：`422 DATE_OUT_OF_RANGE`，并返回当前边界；
- 场馆不存在：`404 VENUE_NOT_FOUND`；
- 请求超时或服务不可用：`503 SERVICE_UNAVAILABLE`；
- 未分类服务端异常：`500 INTERNAL_ERROR`，遵循同一错误信封并记录请求编号；
- 无权限、会话失效和业务冲突不属于首切片，不为它们预建页面状态。

OpenAPI 中上述对象必须声明 `additionalProperties: false`，逐字段标记 `required`、格式、长度、枚举和 nullable。`contracts/examples/` 使用可通过 schema 校验的固定 UUID、完整 HTTPS URL 和完整业务值，不把本文的说明性值直接当作 Fixture。

### 6.3 状态投影、时间和数据库约束

为保持与 PRD 一致，用户端状态为：

- `AVAILABLE`：可订；
- `TEMPORARILY_LOCKED`：暂时锁定，对应持久 `LOCKED`；
- `BOOKED`：已订，对应持久 `BOOKED`；
- `CLOSED`：不可用，对应持久 `CLOSED`；
- `EXPIRED`：已过期，是查询投影，不持久化。

投影优先级：若 `now >= starts_at`，无论原持久状态如何都输出 `EXPIRED`；否则按上述持久状态一对一映射。`LOCKED` 即使超过本地 `locked_until` 也继续显示 `TEMPORARILY_LOCKED`，直到后续订单 worker 根据微信权威结果安全释放；查询接口绝不擅自释放库存。

时间范围统一为半开区间 `[starts_at, ends_at)`：结束时刻可作为下一时段开始；`starts_at < ends_at`。P0 不允许跨越场馆当地午夜，时段归属其当地开始日期。数据库统一存 UTC，API 输出带 `+08:00` 偏移；业务日计算固定使用 IANA 时区 `Asia/Shanghai`。中国当前无夏令时，但测试必须证明代码使用命名时区而非硬编码字符串拼接。

本切片最小表及完整性边界：

- `venues`：UUID 主键；`slug` 唯一且非空；`is_primary`、`is_active` 非空；建立 `WHERE is_primary AND is_active` 的唯一部分索引保证最多一个启用主场馆；`name`、`price_advantage_text`、`timezone`、营业时间文案、地址、停车、电话、退款摘要均非空；`description` 非空但可为空字符串；经纬度非空并有合法范围检查。`/venues/primary` 查询必须恰好得到一个启用主场馆，否则返回 `500 PRIMARY_VENUE_MISCONFIGURED`；该错误不阻止进程启动或健康检查，但 staging 发布验证失败。
- `venue_images`：UUID 主键；`venue_id` 外键 `ON DELETE CASCADE`；HTTPS `url`、非空 `alt`、`role` 枚举 `COVER|GALLERY`、`sort_order >= 0`；每个场馆用部分唯一索引保证最多一个 `COVER`，服务和 seed 校验至少一个且恰好一个主图。
- `venue_facilities`：UUID 主键；`venue_id` 外键 `ON DELETE CASCADE`；`code` 枚举 `LIGHTING|CHANGING_ROOM|DRINKING_WATER|PARKING`，`name` 非空，`sort_order >= 0`，`UNIQUE(venue_id, code)`。
- `pitches`：UUID 主键；`venue_id` 外键 `ON DELETE RESTRICT`；`code`、`name` 非空；`pitch_type` 枚举 `FIVE_A_SIDE|SEVEN_A_SIDE`；`sort_order >= 0`；`UNIQUE(venue_id, code)`。
- `slots`：UUID 主键；`pitch_id` 外键 `ON DELETE RESTRICT`；`status` 枚举 `AVAILABLE|LOCKED|BOOKED|CLOSED`；`price_cents >= 0`；时间约束见下。`LOCKED` 时 `locked_until` 与 `locked_by_order_id` 必须非空，其他状态两者必须为空；订单切片创建 orders 表时再把 `locked_by_order_id` 加为外键。

`slots` 使用 PostgreSQL `tstzrange(starts_at, ends_at, '[)')` 对同一 `pitch_id` 建排斥约束，禁止任何重叠；另设 `UNIQUE(pitch_id, starts_at, ends_at)` 提供确定的重复错误。所有外键列建立索引，场地和时段分别按 `sort_order/starts_at` 稳定排序。删除行为选择保护已有库存；场馆已通过 `is_active` 软停用，场地的软停用字段由后续管理切片增加，二者都不物理删除历史库存。

订单模块尚未实现，因此首切片 HTTP 集成环境不制造活跃 `LOCKED`。`TEMPORARILY_LOCKED` 在 UI Gallery 和自动化组件场景中验证；`BOOKED`、`CLOSED` 可以作为测试数据库中的已知库存状态，用于验证真实数据库投影。

### 6.4 测试环境数据与 Fixture 生命周期

临时数据 Fixture 只从 `contracts/examples/` 中通过 schema 校验的成功或空响应生成，对应 `venue-ready`、`slots-ready` 和 `slots-empty`，并覆盖契约允许的各时段状态。首屏错误、刷新错误、延迟响应、选择交互和图片加载失败不属于数据 Fixture，统一由 `artifacts/ui/scenarios/` 中的 Scenario 组合 `Clock`、`Transport`、`NativeCapabilities`、`MediaSourceResolver` 与用户动作确定性触发。Fixture 只用于后端完成前的 UI 对齐。

测试数据库使用显式命令 `uv run python -m scripts.seed_demo --anchor-date today --days 31`。规则为：

- 仅允许 `APP_ENV=local|test|staging`，在 `production` 下硬失败；
- 以稳定业务键幂等 upsert 场馆、场地及从 anchor 起 31 天的时段；重复运行不产生重叠；
- staging 每次部署后以及每次阶段性交付前运行一次；它只补齐新的未来日期，不覆盖已存在时段的价格或状态。本切片不建设常驻定时任务或告警系统；若超过数据覆盖期，测试环境允许变为空，下一次交付或部署前必须重新 seed；
- seed 数据在后台管理切片交付前由部署流程负责刷新，此后改由管理员真实维护；
- 测试环境顶栏明确标识“测试环境”，避免把演示库存误认为真实可售库存。

场馆内容不是随机构造：名称、图片、地址、坐标、电话、营业时间、停车、设施和退款摘要必须在联调前由合作场馆提供并核对。若尚未取得，则该切片可继续开发但不能完成阶段验收。

后端联通后，业务页面永久切换为 HTTP 适配器。Fixture 源只留在 `artifacts/ui/fixtures` 和测试目录；删除临时生成目录及生产源码中的 Fixture 适配器。生产构建审计必须同时证明：

1. 正式 `app.json` 未注册 `dev/` 页面；
2. 上传产物清单不含 `dev/`、`.dev-generated/`、`fixture` 路径或 `FIXTURE_MODE` 标识；
3. 生产配置只有 HTTPS API base URL，不存在运行时 Fixture 开关；
4. 自动化在 HTTP 服务不可达时显示错误，而不是静默回退模拟数据。

## 7. 页面状态与降级规则

首切片页面状态机：

```text
INITIAL → LOADING → READY | EMPTY | FIRST_LOAD_ERROR
READY/EMPTY → REFRESHING → READY | EMPTY | STALE_ERROR
STALE_ERROR → REFRESHING → READY | EMPTY | STALE_ERROR
READY(selected_slot_id=null) → READY(selected_slot_id=slot_id): 点击 AVAILABLE
READY(selected_slot_id=slot_id) → READY(selected_slot_id=null): 再点同一时段或上下文切换
READY(selected_slot_id=old_id) → READY(selected_slot_id=new_id): 点击另一个 AVAILABLE
```

选择态的清除、保留和库存变化行为以 §6.1 的单选生命周期为准；不可用时段和 `REFRESHING/STALE_ERROR` 不接受选择事件。

- 首次加载超时、断网、`5xx` 或响应不可解析：进入 `FIRST_LOAD_ERROR`，显示重试和短请求编号；没有请求编号时显示本地错误编号。
- 页面内存缓存 TTL 为 60 秒，不写持久缓存。TTL 内返回页面可先显示缓存并后台刷新；超过 TTL 仍可在刷新时暂时保留，但必须显示“数据可能已更新”。
- 已有内容刷新失败：进入 `STALE_ERROR`，保留内容、禁用时段选择，直到刷新成功或用户离开页面；不能把陈旧库存继续标成可操作。
- 用户切换日期或场地类型时，以递增请求序号忽略迟到响应；超时为 8 秒。
- 合法日期无场地或无时段：进入 `EMPTY`，展示“当天暂无可订时段”，不是错误。
- 场馆 `404`：展示“场馆暂不可用”并停止可用性请求；非法枚举是开发错误，测试必须失败，用户侧显示通用错误。
- 单张图片加载失败：使用本地品牌占位图并保留 `alt` 文案；所有图片失败也不阻断文字信息和时段查询。
- 地图调用失败：保留可复制地址并提示重试；拨号失败：保留可复制电话号码。坐标或电话缺失在验收环境是配置错误，写结构化错误日志并使 staging 发布验证失败，不作为正常 UI 状态。
- 响应缺少必填字段、金额非整数、结束不晚于开始或出现未知状态：整次可用性响应视为损坏，不部分渲染，进入错误/陈旧错误并记录请求编号。
- API 错误码稳定，前端不展示堆栈或原始异常；后端日志不记录微信密钥、会话令牌、完整分享令牌或敏感个人信息。

## 8. 测试、追踪与阶段验收

### 8.1 可执行质量门槛

实施计划必须提供并让 CI 执行这些稳定入口：

```text
npm run lint
npm run typecheck
npm test
npm run build:miniprogram:production
npm run audit:miniprogram-package
uv run ruff check backend
uv run mypy backend
uv run pytest
uv run python -m scripts.verify_staging
docker compose config --quiet
```

任一命令非零即阻断交付。`pytest` 必须使用真实 PostgreSQL，覆盖日期两端、越界、半开区间、跨午夜拒绝、金额、排序、错误信封、重叠排斥、primary 缺失/重复保护、缺少 COVER 图和 seed 幂等。`verify_staging` 检查恰有一个启用主场馆、恰有一张 COVER、必填内容与坐标/电话完整、今天起 14 天时段覆盖以及 HTTPS 图片/API 域名；失败即阻断发布。API 普通读请求在 staging 预热后进行至少 100 次采样，P95 小于 500ms，错误率为 0。

微信自动化覆盖：打开首页、默认日期、14 天边界、跨午夜恢复、切换类型、空数据、首次失败重试、刷新失败禁用选择、图片失败、地图/拨号失败以及迟到响应。它还必须逐一点击五种时段：只有 `AVAILABLE` 产生页面 `selected` 状态，且文案明确为“已选择，预订功能将在下一阶段开放”；其余四种状态不产生选择态，所有点击都不得发出创建订单或锁库存请求。固定环境图像比较使用 SSIM 不低于 `0.99` 且非遮罩区域变化像素不超过 `0.5%`；超过任一阈值即阻断，除非提交差异图并由用户接受新基线。

### 8.2 设备和内容验收

至少验证微信开发者工具 375px 与 390px、一台 iOS 微信真机、一台 Android 微信真机。每次证据记录设备型号、OS、微信版本、基础库版本、开发者工具版本、提交 SHA、环境 URL、时间和场景。

内容验收清单必须由合作场馆确认：名称、价格优势说明、主图和全部实拍图、场地类型和物理场地、营业时间、详细地址、地图落点、停车说明、设施、客服电话、退款摘要。任一缺失或地图落点错误都阻断切片完成。

### 8.3 需求追踪表

| 需求/风险 | 端点或组件 | 场景 | 自动化 | 验收证据 |
| --- | --- | --- | --- | --- |
| VENUE-01 场馆展示 | primary venue / venue-card | ready、image-failure | DTO 契约、组件、E2E | 四端截图、内容确认单 |
| VENUE-02 地图 | primary venue / `wx.openLocation` | success、failure | 参数与失败降级 | iOS/Android 地图落点录屏或截图 |
| VENUE-03 电话 | primary venue / `wx.makePhoneCall` | success、failure | 参数与失败降级 | iOS/Android 拨号截图 |
| SLOT-01 日期和类型 | availability / date-strip、pitch-filter | 默认、两端、越界 | API、E2E | 14 天滚动截图 |
| SLOT-01 HTTP 状态 | availability / slot-grid | available、booked、closed、expired、empty | 投影、组件、HTTP E2E | 真实 HTTP 截图 |
| SLOT-01 临时锁定 | slot-grid | temporarily-locked | Fixture schema、UI Gallery 自动化 | UI Gallery 截图；订单切片再补 HTTP E2E |
| SLOT-01 选择语义 | slot-grid | 五状态点击、selected | 仅 available 可选、无写请求 | 自动化日志与 selected 截图 |
| 网络与陈旧数据 | HTTP adapter / state-panel | first-error、stale-error | 超时、迟到响应、重试 | 自动化日志与截图 |
| 午夜跨日 | primary venue、availability | app resume、旧边界 422 | 重取窗口且只重试一次 | 自动化日志 |
| Fixture 清除 | production build | API 不可达 | package audit、禁止 fallback | 产物清单和审计日志 |
| 数据库安全 | slots migration | 重复、相邻、重叠 | PostgreSQL integration | pytest 报告 |

### 8.4 阶段性交付物与完成定义

首个切片完成时暂停开发，并交给用户：

- 可导入微信开发者工具的工程；
- 阿里云 staging API 与体验版二维码；
- 按追踪表组织的一页验收步骤；
- iOS、Android 和开发者工具的基线及版本元数据；
- 全部质量门槛日志、staging P95 报告、生产包审计结果；
- 已知限制以及对 PRD 的已完成/未完成范围。

工程完成条件是：所有自动化门槛通过、`verify_staging` 通过、staging 部署健康、HTTP 集成无 Fixture 回退、生产包审计通过、场馆内容核对完成、设备矩阵通过。满足工程条件后暂停并请用户查看效果；用户的反馈决定该切片是否接受、修改或继续，但不能替代上述客观门槛。

## 9. 后续纵向切片顺序

1. 预订与 Mock 支付：联系人、10 分钟占位、订单、Mock Provider、超时关闭和安全释放。
2. 球局协作：创建、私域分享、报名、候补、退出及字段级隐私。
3. 取消退款：24 小时规则、全额退款、幂等、未知状态和异常收敛。
4. 场馆管理：31 天内生成时段、价格、关闭/开放、到场和订单退款操作。
5. 平台与交付：平台角色、异常处理、审计、监控、备份和灰度发布。

真实微信支付接入依赖平台主体、小程序 AppID、微信支付商户号、API v3 证书/密钥和合法域名。资质未完成时，预订切片使用明确标识的 Mock Payment Provider；Provider 接口保持不变，Mock 不能进入正式生产配置。

## 10. 开源参考与复用策略

没有发现可直接替代本项目的高匹配开源成品。相似预约项目通常使用微信云开发、Spring Boot/MySQL 或 uni-app，而且支付、并发库存和退款规则与本 PRD 不一致。

允许优先参考或复用：

- [WeUI MiniProgram](https://github.com/wechat-miniprogram/weui-miniprogram)：微信团队的 MIT 组件库，可用于通用弹窗、提示、表单等基础交互；项目视觉令牌仍由本项目控制。
- [WeUI WXSS](https://github.com/Tencent/weui-wxss)：微信官方设计团队的 MIT 样式参考，用于核对微信原生体验。
- [微信小程序官方示例](https://github.com/wechat-miniprogram/miniprogram-demo)：用于 API、组件和真机行为参考。
- [Fastro / FastAPI Boilerplate](https://github.com/benavlabs/FastAPI-boilerplate)：MIT，当前仍有维护，可借鉴 FastAPI、SQLAlchemy、Alembic、模块化切片和 Docker 组织方式；不整套引入 Redis、缓存、管理后台和任务队列。
- [StudyAppt](https://github.com/zxwangbingbing/StudyAppt)：可观察预约页面和多角色流程，但它使用微信云开发，仓库页面未展示明确开源许可证，不能复制其代码或素材。

任何第三方代码进入仓库前必须记录来源、固定版本、许可证和实际用途。无许可证、仅“源码下载”、毕业设计售卖或无法确认权属的项目只能作为产品观察，不能复制代码、图片或文案。订单防超卖、支付通知、主动查单、退款与权限必须按本 PRD 自行实现和测试。

## 11. 明确不在本次计划内

- 微信登录、手机号授权、会话和权限框架；这些留到首次出现受保护操作的切片再设计；
- 创建订单、占位、支付、支付回调和 worker 补偿；
- 球局、分享、报名、候补和订阅消息；
- 取消、退款和管理员操作；
- 复杂缓存、队列、微服务、跨端框架、原生 Android/iOS App；
- P1 统计和推荐能力。

这些能力不得以占位页面或虚假成功状态混入首个切片。
