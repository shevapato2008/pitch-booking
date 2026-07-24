# Venue browsing delivery progress

Last updated: 2026-07-24 (Asia/Shanghai)

## Current checkpoint

The venue-browsing vertical slice is paused before public HTTPS staging deployment while the owner applies for ICP filing for `modelstella.com`.

This pause is intentional. Do not start the next booking slice and do not mark venue browsing complete until the remaining real-HTTP deployment and device acceptance gates below pass.

## Completed

- The venue and 14-day availability Mini Program UI, API contract, FastAPI/PostgreSQL backend, production HTTP adapter, local staging stack, deployment preflight and staging verifier are implemented on `main`.
- The local staging real-HTTP journey and automated quality gates pass at commit `0b126d46f7d7f7ea7a78d2606d11bccf4195c717`.
- A usable Mini Program AppID is configured in the ignored local `project.private.config.json`; no AppSecret is stored or required for this checkpoint.
- The development Fixture build was previewed and accepted by the user on an iPhone 14 Pro Max on 2026-07-24.
- The production package audit confirms that production output contains no Fixture/Scenario business-data path.

The iPhone result above is Fixture frontend device acceptance. It is not evidence that the production build can reach the backend over a WeChat-approved public HTTPS request domain.

## External dependency and pause reason

- ICP filing for `modelstella.com`: **application in progress** (reported by the owner on 2026-07-24).
- Intended staging API hostname: `api-staging.modelstella.com` (confirm before creating DNS or deployment configuration).
- Public HTTPS staging deployment: not started.
- WeChat Mini Program request/download legal-domain configuration: not started.

No cloud deployment, DNS change or WeChat legal-domain change should be made from this checkpoint until the ICP filing is usable by the selected mainland hosting provider and the owner authorizes the target infrastructure.

## Resume checklist after ICP filing

1. Confirm the ICP filing is active for `modelstella.com`, the Alibaba Cloud staging host/account, and the exact staging hostname.
2. Create DNS for the staging API hostname and deploy the committed PostgreSQL/FastAPI/Caddy stack with trusted HTTPS.
3. Load approved staging venue content and images, then run deployment preflight, migrations, seed/content load and `scripts.verify_staging` against the exact deployed commit.
4. Add the HTTPS API hostname to the Mini Program request legal domains and every image hostname to the download legal domains.
5. Build the production Mini Program with `MINIPROGRAM_API_BASE_URL=https://api-staging.modelstella.com`, audit the package, and verify the real HTTP journey in WeChat DevTools.
6. Run production/experience-build acceptance on iOS and Android, including venue data, the 14-day window, empty/error states, map/phone behavior and confirmation that no Fixture fallback occurs.
7. Record the staging report and device evidence, obtain explicit user acceptance, and only then mark the venue-browsing slice complete or begin the next slice.

## Still required for slice completion

- Public HTTPS staging is healthy at the recorded implementation commit.
- Partner-approved venue content and production-accessible images are loaded.
- WeChat legal request/download domains are configured and validated with domain checking enabled.
- The production/experience build passes real-HTTP acceptance on at least one iOS and one Android device.
- Acceptance evidence and the user's final slice decision are recorded.
