# Map venue discovery delivery progress

Last updated: 2026-08-10 (Asia/Shanghai)

## Current checkpoint

The 375×812 visual gate was explicitly approved on 2026-07-30. The map/detail OpenAPI contract,
PostgreSQL revision `0006`, transactional directory loader, public HTTP APIs, strict Mini Program
HTTP source, native location boundary, and `ONLINE` booking guards are now implemented locally.
The executable map business Fixture has been removed. This
is not final production content approval: production loading requires a short-lived approval file
bound to the exact manifest bytes, literal `production` environment, and deployed app revision.

The scalable map UI now reads administrative filters directly from decoded map-contract district
fields. Fixture development uses the five canonical checked-in venues, and the temporary 100-venue
generator, preview POI source, and preview metadata registry are deleted. Development-HTTP remains
composed with the real Tencent adapter. Real Tencent physical-device acceptance is still externally
blocked pending a real restricted key plus matching request-domain and WeChat privacy configuration;
no new device evidence is claimed by this integration.

## Local integrated acceptance

On 2026-08-10 a fresh disposable PostgreSQL 17 instance was migrated through revision `0007` on
`127.0.0.1:55433` because `55432` was already owned by the unrelated `lobby-ranked-pg` container.
The standard seed plus reviewed directory load reported `created=4`, `updated=1`, `deleted=0`,
`unlisted=0`. The live `GET /api/v1/venues/map` response returned the five frozen venues in order,
exactly one `ONLINE` venue, and the reviewed `district_code` / `district_name` pair on every item.
The development-HTTP Mini Program build also completed against `http://127.0.0.1:8000` using a
format-valid test key solely to verify build-time composition; it is not Tencent runtime evidence.

No 2026-08-10 native screenshot is claimed. WeChat DevTools accepted and opened the project, but
its compiler reported internal `path`/`MaxCodeSize` errors before rendering; after the ignored local
private configuration was restored, the official automator connection still did not complete within
the bounded attempt. This local-tooling blocker is recorded without replacing evidence or weakening
the separate real-key, request-domain, privacy, and physical-device acceptance requirements.

On 2026-07-30 the isolated PostgreSQL 17 stack was migrated to `0006`, seeded with a 31-day online
inventory window, and loaded from the checked-in directory manifest. The loader reported
`created=4`, `updated=1`, `deleted=0`, `unlisted=0`. A host FastAPI process at
`http://127.0.0.1:8000` returned a healthy status, five ordered map entries, one `ONLINE` detail,
and four `DIRECTORY_ONLY` details. The actual development-HTTP Mini Program composition was built
against that process and exercised in WeChat DevTools 2.01.2510290 with base library 3.17.0.

The four directory identities each returned zero pitches, slots, orders, and payments in a joined
PostgreSQL audit. The production package audit reported zero forbidden paths/tokens. Integrated
375×812 evidence refreshes the default/online selection, directory selection, directory detail,
and focused deep-link states. The previously approved location-denial and map-fallback captures
remain clearly identified as pre-removal capture-only evidence; deterministic native/lifecycle
tests are the final authority for those no-longer-injectable failure states.

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

## Loader authority and rollback

- Development loading requires explicit `--environment development`; no environment defaults to
  production.
- Production loading additionally requires `--app-revision` and `--approval-file`. The approval
  binds the exact manifest SHA-256 and expires within 24 hours.
- Schema and whole-graph semantic validation complete before database access. Identity collisions,
  a second online venue, directory inventory, or unsafe mode changes abort the transaction.
- Normal reloads are idempotent. Missing directory identities are unlisted rather than deleted.
- `--unload-directory` deletes only history-free `DIRECTORY_ONLY` rows and their transit records;
  it never removes the canonical online venue. This explicit unload is required before migration
  downgrade.

Example local dry run:

```bash
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/python scripts/load_venue_directory.py \
  --manifest deploy/venue-directory.json --environment development --dry-run
```

## Deferred production boundary

Alibaba Cloud/PostgreSQL production deployment, public HTTPS/domain validation, WeChat production
privacy submission, iOS/Android physical-device positioning evidence, reconfirmation of the partner
south-gate coordinate, production content approval, and final release remain deferred until the ICP
boundary is cleared. This slice is locally complete, not production-delivered.
