# Golden-image protocol

Golden images are runtime truth captured from the native WeChat Mini Program. They are not sketches, browser substitutes, or screenshots fabricated from this documentation.

## Capture

1. Check out the generating commit with a clean worktree and use the fixed Scenario clock declared in `artifacts/ui/scenarios/`.
2. Build the development Mini Program and load the screen route and Scenario named by the screen manifest. Fixture responses come only from `artifacts/ui/fixtures/`; transport, native-capability, media, timing, and user-action behavior come from the Scenario.
3. Capture the rendered runtime at the manifest environment and logical width. Record the actual operating system, device pixel ratio, WeChat version, base-library version, and Developer Tools version used by that run.
4. Stabilize dynamic time with the Scenario clock. If a request ID or another unavoidable dynamic region is visible, define and review an explicit mask for that region before comparison; do not alter the runtime image afterward.
5. Save the PNG beside a metadata JSON document that validates against `metadata.schema.json`. Compute `sha256` from the final PNG bytes and record the exact generating Git commit.

No canonical PNG is included at this stage. Candidates must be captured later from the implemented runtime in the fixed environments, reviewed on the target devices, and explicitly accepted before promotion. A later visual change must provide both a difference image and a replacement candidate; canonical baselines must never be overwritten silently.
