# Golden-image protocol

Golden images are runtime truth captured from the native WeChat Mini Program. They are not sketches, browser substitutes, or screenshots fabricated from this documentation.

## Identity and paths

The canonical identity is `<screen-id>/<golden-id>`. Screen qualification prevents the repeated `ios-ready` and `android-ready` golden IDs from colliding. Screen and golden path segments must be lowercase safe IDs from the screen manifest, and `<commit>` must be the full lowercase 40-character generating commit.

Capture candidates are immutable, commit-qualified files:

- `artifacts/ui/golden/candidates/<commit>/<screen-id>/<golden-id>.png`
- `artifacts/ui/golden/candidates/<commit>/<screen-id>/<golden-id>.metadata.json`

Accepted canonical baselines use a separate namespace:

- `artifacts/ui/golden/canonical/<screen-id>/<golden-id>.png`
- `artifacts/ui/golden/canonical/<screen-id>/<golden-id>.metadata.json`

Capture writes only to the candidate namespace and fails if either candidate path already exists. Capture never writes to or overwrites the canonical namespace.

## Closed capture matrix

The table below is the capture authority. Every manifest golden appears exactly once. “Actual target device” means that capture records the real logical width, DPR, and device model; the device model is encoded with the OS details in `operating_system`. No physical model or dimensions are fixed before the target device is chosen.

| Identity | Route | Scenario | Runtime/environment | Logical width | DPR/device identity source |
| --- | --- | --- | --- | --- | --- |
| `venue-home/devtools-375-ready` | `pages/venue/index` | `venue-ready` | WeChat Developer Tools | 375 | Active profile DPR and exact Developer Tools version |
| `venue-home/devtools-390-ready` | `pages/venue/index` | `venue-ready` | WeChat Developer Tools | 390 | Active profile DPR and exact Developer Tools version |
| `venue-home/ios-ready` | `pages/venue/index` | `venue-ready` | iOS WeChat Mini Program | actual target device | Actual width/DPR/model recorded in `operating_system` |
| `venue-home/android-ready` | `pages/venue/index` | `venue-ready` | Android WeChat Mini Program | actual target device | Actual width/DPR/model recorded in `operating_system` |
| `availability/devtools-375-ready` | `pages/availability/index` | `slots-ready` | WeChat Developer Tools | 375 | Active profile DPR and exact Developer Tools version |
| `availability/devtools-390-empty` | `pages/availability/index` | `slots-empty` | WeChat Developer Tools | 390 | Active profile DPR and exact Developer Tools version |
| `availability/ios-ready` | `pages/availability/index` | `slots-ready` | iOS WeChat Mini Program | actual target device | Actual width/DPR/model recorded in `operating_system` |
| `availability/android-ready` | `pages/availability/index` | `slots-ready` | Android WeChat Mini Program | actual target device | Actual width/DPR/model recorded in `operating_system` |

## Capture

1. Check out the generating commit with a clean worktree and select the exact identity, route, Scenario, runtime, and width source from the closed capture matrix above. Use the fixed Scenario clock declared in `artifacts/ui/scenarios/`.
2. Build the development Mini Program and load that route and Scenario. Fixture responses come only from `artifacts/ui/fixtures/`; transport, native-capability, media, timing, and user-action behavior come from the Scenario.
3. Capture the rendered runtime in the matrix environment. For a Developer Tools row, use its stated 375px or 390px logical-width profile and record the active profile DPR. For a physical row, record the actual target device logical width, DPR, and model rather than inventing them.
4. Record the actual operating system and device model together in `operating_system`, plus the WeChat, base-library, and Developer Tools versions used by the run. For physical captures where Developer Tools does not render the screen, record the exact Developer Tools version used to build and launch that run.
5. Stabilize dynamic time with the Scenario clock. If a request ID or another unavoidable dynamic region is visible, define and review an explicit mask for that region before comparison; do not alter the runtime image afterward.
6. Save the files only at the commit-qualified candidate paths above. Validate the JSON against `metadata.schema.json`, compute `sha256` from the final PNG bytes, and record the exact generating Git commit. Do not create or modify a canonical path during capture.

## Promotion

Promotion is a separate operation after capture. It requires explicit acceptance naming the exact candidate identity, commit, and hash. Before copying anything, promotion must:

1. validate candidate metadata against `metadata.schema.json`;
2. recompute the candidate PNG SHA-256 and prove that the PNG SHA-256 equals metadata `sha256`;
3. prove the metadata commit equals the candidate namespace commit and that it is a clean and reviewed generating commit and visual diff; and
4. verify that both candidate files are regular, non-symlink files at the expected collision-safe paths.

Only after every check succeeds may promotion copy into the canonical namespace. It writes each canonical file to a same-filesystem temporary sibling, flushes and closes it, and completes it with an atomic rename. If any validation, staging write, or rename fails, promotion aborts without treating a partial pair as accepted and preserves the previous canonical pair. Canonical replacement is therefore an explicit promotion result, never a side effect of capture.

No canonical PNG is included at this stage. Candidates must be captured later from the implemented runtime in the fixed environments, reviewed on the target devices, and explicitly accepted before promotion. A later visual change must provide both a difference image and a replacement candidate; canonical baselines must never be overwritten silently.
