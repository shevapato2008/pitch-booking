# Pitch Booking

Native WeChat Mini Program workspace for browsing and booking sports pitches.

## Setup

1. Run `npm install`.
2. Copy `project.private.config.json.example` to `project.private.config.json` and add the local WeChat AppID.
3. Run `npm run build:miniprogram:development`.
4. Open the repository root in WeChat DevTools. The checked-in project config points DevTools at `dist/miniprogram-development/`.

Production packages are assembled separately with `npm run build:miniprogram:production` and checked with `npm run audit:miniprogram-package`.

The checked-in runtime URL is a non-secret staging placeholder. Replace it with the provisioned HTTPS domain before staging verification.
