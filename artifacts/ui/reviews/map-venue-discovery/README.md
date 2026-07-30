# 地图场馆发现视觉验收

本目录冻结 375 × 812 的七态视觉验收结构。当前 Task 2 只交付浏览器可打开的参考 HTML 和 review-board shell；微信小程序真实实现、同尺寸截图、并排图、50% 叠加图、差异图与逐态 observations 在 Task 4 生成，因此本阶段不放置或伪造 35 张 PNG 证据。

## 七个状态

| State | Reference | 验收重点 |
| --- | --- | --- |
| ready | `venue-map-ready.html` | 五标记、默认 peek sheet、定位为 opt-in |
| online | `venue-map-online.html` | 蓝色异形标记与“可预订”文字、唯一 booking action |
| directory | `venue-map-directory.html` | 中性标记与目录标签、无 booking action、仅核验交通 |
| detail-map-button | `venue-detail-map-button.html` | 每个详情的“在地图中查看”入口 |
| focused | `venue-map-focused.html` | 深链聚焦、不自动请求位置、可返回详情 |
| location-denied | `venue-map-location-denied.html` | 拒绝说明、设置恢复与继续浏览 |
| error | `venue-map-error.html` | pure-list fallback、重试 remount、场馆语义不降级 |

## Task 4 证据约定

每态在 `review-board.html` 中预留六个命名槽：`reference`、`implementation`、`side-by-side`、`overlay-50`、`difference`、`observations`。所有图像须使用相同 375 × 812 logical viewport；observations 逐项记录构图、几何间距、组件层级、字体色彩材质、图标素材、文案和状态语义差异。自动化布局通过不等于视觉通过，用户明确确认前不进入本切片后端阶段。

参考页中的底图是原创示意构图，不包含第三方地图瓦片。页面显示字段由测试与 `deploy/venue-directory.json` 逐字段比对。
