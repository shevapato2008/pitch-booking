# Local staging

The first venue-browsing slice uses a staging-shaped local stack before any remote deployment:

- PostgreSQL 17 stores venue and availability data in the `postgres_data` volume.
- FastAPI migrates the database before starting and exposes its immutable revision header.
- Caddy exposes only `/api/*` at `http://127.0.0.1:8080`.

Copy `deploy/.env.example` to an ignored file and replace every validation sentinel. For a local run,
`PUBLIC_API_BASE_URL=http://127.0.0.1:8080` is allowed; non-loopback environments must use HTTPS.
`PUBLIC_IMAGE_HOSTS` uses Pydantic's JSON-array environment format, for example
`PUBLIC_IMAGE_HOSTS=["assets.example.com"]`.

```bash
uv run python -m scripts.preflight_deploy --env-file deploy/.env.local
docker compose --env-file deploy/.env.local config --quiet
docker compose --env-file deploy/.env.local up -d --build
docker compose --env-file deploy/.env.local exec api uv run python -m scripts.seed_demo --anchor-date today --days 31
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
