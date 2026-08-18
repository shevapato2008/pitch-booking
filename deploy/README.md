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

After public staging is authorized, first create a second OSS bucket dedicated to onboarding
evidence. It must be private and different from the public venue-media bucket. Generate the two
ignored, mode-`0600` input files from the local OSS configuration, shell `DASHSCOPE_API_KEY`, and
WeChat project AppID. On first setup the command also reads `ONBOARDING_OSS_BUCKET` from the shell or
prompts without echo, then securely prompts for a reviewer access token of at least 32 characters.
Only the token's SHA-256 digest is written. The raw token is never printed or stored in either
generated file. `PLATFORM_CSRF_SECRET` is generated from 32 random bytes automatically.

The ordinary WeChat values are still read from the shell or prompted without echo:
`WECHAT_APP_SECRET` and `MINIPROGRAM_TENCENT_MAP_KEY`.

When `PAYMENT_PROVIDER=wechat`, the generator also reads the WeChat Pay API v3 merchant ID,
merchant certificate serial, merchant private key, platform public-key ID and PEM, API v3 key, and
the payment/refund notification URLs from the operator environment or prompts without echo. Supply
both PEM files as canonical, single-line Base64 rather than raw multiline PEM. The API v3 key must
be exactly 32 ASCII bytes. Valid existing payment values are preserved on reruns.

The default callbacks are:

- `https://pitch-api-staging.modelstella.com/api/v1/payments/wechat/notify`
- `https://pitch-api-staging.modelstella.com/api/v1/refunds/wechat/notify`

Store these values only in the ignored `deploy/.env.live.local` or a secret manager. The preflight
parses both RSA keys and validates the callback origins without printing any supplied value.

```bash
uv run python -m scripts.prepare_live_deploy \
  --oss-env backend/.env.local \
  --project-config project.private.config.json
uv run python -m scripts.preflight_deploy --env-file deploy/.env.live.local
docker compose --env-file deploy/.env.live.local config --quiet
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; npm run build:miniprogram:production'
npm run audit:miniprogram-package
npm run prepare:miniprogram:live-preview
```

Keep the reviewer token in a password manager. It is the credential used to open
`https://pitch-api-staging.modelstella.com/platform-admin`; losing it requires deliberately
replacing `PLATFORM_STAFF_PRINCIPALS_JSON` with the SHA-256 of a new token. Rerunning the generator
preserves an existing valid onboarding bucket, staff-principal JSON and CSRF secret, so it does not
prompt for the reviewer token again.

For the physical-device QR, open `dist/miniprogram-live-preview` as the WeChat DevTools project.
That generated, ignored project contains only the audited production package. Do not generate the
acceptance QR from the repository root because its checked-in `project.config.json` intentionally
targets the development Fixture build.

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

Rerunning the generator also preserves the PostgreSQL password, phone encryption key, and generated
bootstrap moderation reviewer UUID. That UUID only initializes the moderation reviewer allowlist;
it does not create reviewer user membership.

The generator prints the exact origins to configure in the WeChat console. Register them under the
matching domain category (the categories are not interchangeable):

- `request`: `https://pitch-api-staging.modelstella.com`, the printed venue-media OSS origin, and
  `https://apis.map.qq.com`
- `uploadFile`: the printed dedicated onboarding-evidence OSS origin
- `downloadFile`: `https://media.modelstella.com`

In particular, adding the onboarding OSS origin only to `request` does not authorize
`wx.uploadFile`; it must be present in `uploadFile` before testing onboarding-evidence uploads on a
physical iPhone. The venue-media PUT path uses `wx.request`, so its OSS origin remains in `request`.

Do not add `https://api.mch.weixin.qq.com` to the Mini Program legal-domain list. The Mini Program
calls this application's API and invokes native `wx.requestPayment`; only the server-side Provider
calls the WeChat Pay API.

## WeChat Pay smoke gate

Run the offline preflight and tests before requesting any real payment:

```bash
uv run python -m scripts.preflight_deploy --env-file deploy/.env.live.local
```

The external smoke is deliberately limited to one smallest practical JSAPI payment and one full
refund from a real iPhone/OpenID. Do not run it unless the merchant ID, merchant certificate/private
key, platform public key, API v3 key, and callback reachability have all been confirmed by the
merchant operator. Never substitute generated test keys or repeat charge/refund loops.
