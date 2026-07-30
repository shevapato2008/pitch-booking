# Map venue discovery delivery progress

Last updated: 2026-07-30 (Asia/Shanghai)

## Current checkpoint

Task 1 freezes the five public directory identities and the strongest presently supportable
location evidence. The content gate is automated, but this is not final production content
approval and it does not authorize starting the backend phase before the fixture UI is visually
accepted.

## Frozen identities

| Order | UUID | Slug | Display name | Mode |
| --- | --- | --- | --- | --- |
| 0 | `7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f` | `bohai-yuanfeng-football-pitch` | 渤海元丰足球场 | `ONLINE` |
| 1 | `e03d801d-1254-5c62-9a16-9a8800280162` | `tianjin-olympic-center-five-a-side-football-pitch` | 天津奥林匹克中心五人制足球场 | `DIRECTORY_ONLY` |
| 2 | `2a9640a5-f625-5ad8-9cb9-3440acb70967` | `tianjin-locomotive-stadium` | 天津火车头体育场 | `DIRECTORY_ONLY` |
| 3 | `80532433-8038-5ee5-9963-3e6282aa4abd` | `tianjin-peoples-gymnasium-football-pitch` | 天津市人民体育馆足球场 | `DIRECTORY_ONLY` |
| 4 | `c0372328-6fa4-585a-b951-3324925763d6` | `dongli-sports-center-football-pitch` | 东丽体育中心足球场 | `DIRECTORY_ONLY` |

The online venue keeps the canonical primary UUID. Migration must perform the one-time slug
mapping `test-xingyue-football-park` → `bohai-yuanfeng-football-pitch` on that row; it must not
insert a second online or primary venue.

## Verification record

All stored runtime coordinates are GCJ-02. `AUTHORITATIVE_SOURCE` means a government directory or
venue page directly establishes the public name/address. `DIRECT_POI` means a map provider exposed
a China-map POI coordinate directly. `SOURCE_CONVERSION` means the source coordinate was converted
with a deterministic WGS84→GCJ-02 or BD09MC→BD09→GCJ-02 transform and is not represented as a
surveyed entrance. `MANUAL_MAP_MATCH` is deliberately weaker and is called out below.

| Venue | Name/address source | Marker | Navigation POI | Transit retained |
| --- | --- | --- | --- | --- |
| 渤海元丰足球场 | User-confirmed screenshot `user-map-screenshot-2026-07-30` | Baidu company POI ([direct share](https://j.map.baidu.com/t/v9i23t)), converted to `39.000867, 117.212396` | `天津市渤海元丰科技有限公司-南门`; screenshot plus manual match `39.000157, 117.212208` | None |
| 天津奥林匹克中心五人制足球场 | [Tianjin Sports Bureau directory](https://ty.tj.gov.cn/sy2/gabsycs/tzgggh/202109/W020210907653765607943.pdf) | [OpenStreetMap-derived venue area](https://mapcarta.com/W1231719534), converted to `39.074524, 117.176641` | [Amap 天津奥林匹克中心体育馆](https://ditu.amap.com/place/B001605232), `39.077539, 117.178054` | 体育中心站, line 5, 420 m; [station evidence](https://mapcarta.com/N4699184873) converted to GCJ-02 |
| 天津火车头体育场 | [Tianjin Sports Bureau directory](https://ty.tj.gov.cn/sy2/gabsycs/tzgggh/202109/W020210907653765607943.pdf) | [Published stadium coordinate](https://latitude.to/map/cn/china/cities/tianjin/articles/347242/tianjin-locomotive-stadium), converted to `39.170330, 117.210679` | Venue-level `火车头体育场` at the same converted point | None |
| 天津市人民体育馆足球场 | [Tianjin Sports Bureau venue page](https://ty.tj.gov.cn/zwgk_51582/jgxx/zsdw/202401/t20240110_6505553.html) and [football-area report](https://ty.tj.gov.cn/sy2/gabsycs/sjdtgh/202108/t20210810_5529631.html) | [Amap 天津市人民体育馆](https://ditu.amap.com/place/B0016054AF), `39.108701, 117.194873` | Same direct venue POI | None |
| 东丽体育中心足球场 | [Tianjin Sports Bureau directory](https://ty.tj.gov.cn/jmty/ggzq/tzgg2/202109/W020210907653765607943.pdf) | [Amap 东丽体育中心](https://ditu.amap.com/place/B0FFF5UMOU), `39.083772, 117.324276` | Same direct sports-center POI | None |

Each field-level evidence object in `deploy/venue-directory.json` also records its verifier,
timestamp, method, confidence, and any precision note. It keeps exactly one primary locator
(`source_url` or `internal_reference`); when a method relies on additional public sources, their
deduplicated HTTPS URLs are retained in `supporting_source_urls` so the deployable manifest is
self-auditing without relying on this progress document.

## Explicit evidence gaps and limitations

- The partner south-gate name is user-confirmed, but no numeric coordinate or Tencent share URL
  was present in the screenshot. Its coordinate is a manual match against the Baidu company POI
  and a [Xiqing government environmental PDF](https://www.tjxq.gov.cn/zwgk/zfxxgk/zfgbm/zwfwbgs/fdzdgk/zdmsxx/hjbh/202405/P020240528627695842473.pdf)
  that locates the immediately adjacent southern industrial site and states that 渤海元丰 is to
  its north. The PDF does **not** independently prove the gate point. Reconfirm the entrance with
  a direct Tencent/Amap share coordinate before production approval.
- The Olympic navigation target is the direct sports-complex POI, not an independently verified
  football-pitch gate. The Locomotive, People’s Gymnasium, and Dongli navigation targets are also
  venue-level POIs because non-CAPTCHA public sources did not expose separate entrance points.
- No source-supported nearby transit record was found for the partner, Locomotive, People’s
  Gymnasium, or Dongli venues within this verification timebox. Their transit arrays are empty.
  No bus stops were retained for any venue. Empty arrays mean “not verified for this manifest,”
  not “no transit exists.”
- The sole retained transit entry, 体育中心站, is source-converted rather than a direct Amap
  stop coordinate. Its 420 m value is a map-distance statement, not walking-route distance.
- Directory venues intentionally contain no prices, phone numbers, hours, inventory,
  availability window, refund policy, or booking promise. Photos, facilities, parking and other
  unsupported optional content remain `null` or empty arrays. Historical source pages may display
  those facts; they were not copied into this manifest.
- The online partner’s pitch types, photos, hours, parking, phone and other booking content are not
  reasserted by this discovery manifest. Later loading must preserve separately approved online
  business content and inventory rather than replace it with empty discovery fields.

## Next gate

Use this manifest only for the temporary fixture-backed 375×812 map Artifact and front-end demo.
Do not begin the backend slice until reference and implementation screenshots, side-by-side,
overlay and difference views have been reviewed at the same viewport and the user explicitly
accepts the visual result.
