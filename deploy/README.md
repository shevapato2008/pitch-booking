# Local staging

> Delivery status: `modelstella.com` ICP filing was confirmed active on 2026-08-14
> (`京ICP备2026047949号-1`). Public HTTPS staging and physical-device acceptance may proceed through
> the gates below.

The first venue-browsing slice uses a staging-shaped local stack before any remote deployment:

- PostgreSQL 17 stores venue and availability data in the `postgres_data` volume.
- FastAPI migrates the database before starting and exposes its immutable revision header.
- Caddy exposes only `/api/*` at `http://127.0.0.1:8080`.
- The API image explicitly packages only `deploy/venue-directory.json` and
  `deploy/venue-directory.schema.json` under `/app/deploy`; environment and approval files are not
  copied into the image. Preflight tests pin the checked-in SHA-256 values.

Copy `deploy/.env.example` to an ignored file and replace every validation sentinel. For a local run,
`PUBLIC_API_BASE_URL=http://127.0.0.1:8080` is allowed; non-loopback environments must use HTTPS.
`PUBLIC_IMAGE_HOSTS` uses Pydantic's JSON-array environment format, for example
`PUBLIC_IMAGE_HOSTS=["assets.example.com"]`.

```bash
uv run python -m scripts.preflight_deploy --env-file deploy/.env.local
docker compose --env-file deploy/.env.local config --quiet
docker compose --env-file deploy/.env.local up -d --build
docker compose --env-file deploy/.env.local exec api uv run python -m scripts.seed_demo --anchor-date today --days 31
docker compose --env-file deploy/.env.local exec api uv run python scripts/load_venue_directory.py \
  --manifest /app/deploy/venue-directory.json --schema /app/deploy/venue-directory.schema.json \
  --environment development
curl -fsS http://127.0.0.1:8080/api/v1/health
uv run python -m scripts.verify_staging \
  --base-url http://127.0.0.1:8080 \
  --expected-revision "$(git rev-parse HEAD)" \
  --output /tmp/pitch-booking-staging-report.json
```

Build the production Mini Program against this real API without changing checked-in configuration:

```bash
MINIPROGRAM_API_BASE_URL=http://127.0.0.1:8080 npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Stop containers without deleting the persistent database:

```bash
docker compose --env-file deploy/.env.local down
```

Remote Alibaba Cloud deployment, DNS/TLS, partner-approved content and physical-device acceptance are
outside this local checkpoint.

## Prepare live-staging inputs

After public staging is authorized, generate the two ignored, mode-`0600` input files from the local
OSS configuration, shell `DASHSCOPE_API_KEY`, and WeChat project AppID. The command prompts without
echo for only `WECHAT_APP_SECRET` and `MINIPROGRAM_TENCENT_MAP_KEY`:

```bash
uv run python -m scripts.prepare_live_deploy \
  --oss-env backend/.env.local \
  --project-config project.private.config.json
uv run python -m scripts.preflight_deploy --env-file deploy/.env.live.local
docker compose --env-file deploy/.env.live.local config --quiet
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; npm run build:miniprogram:production'
npm run audit:miniprogram-package
```

The ordinary preflight above permits API deployment before ICP filing. It does not permit a physical
device acceptance QR. After the API domain has an active ICP filing record, set
`MINIPROGRAM_ICP_FILING_CONFIRMED=true` in the ignored `deploy/.env.live.local`, then require the
device gate before generating any QR code:

```bash
uv run python -m scripts.preflight_deploy \
  --env-file deploy/.env.live.local \
  --require-miniprogram-acceptance
```

Do not generate a device acceptance QR when this command fails. The generator defaults this flag to
`false` and preserves an existing valid value on reruns.

Rerunning the generator preserves the PostgreSQL password, phone encryption key, and generated
bootstrap moderation reviewer UUID. That UUID only initializes the reviewer allowlist; it does not
create reviewer user membership. The command also reports the derived OSS upload request origin to
register alongside `https://pitch-api-staging.modelstella.com`; register
`https://media.modelstella.com` as the download origin.
