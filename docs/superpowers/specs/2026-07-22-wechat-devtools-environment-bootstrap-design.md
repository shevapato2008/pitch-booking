# WeChat Developer Tools Environment Bootstrap Design

**Date:** 2026-07-22  
**Status:** Written-spec review approved; pending user review
**Scope:** Developer-environment documentation and the existing venue-browsing implementation plan

## Problem

The project LLM Wiki describes the WeChat Developer Tools development loop and names `miniprogram-automator`, but it does not tell a new developer how to install, initialize, authenticate, locate, or verify the Developer Tools CLI. The venue-browsing plan first treats the CLI as a hard dependency in Task 10, after native visual work is already scheduled. That permits Tasks 6–9 to proceed without proving that their runtime truth source is available.

The current Mac is Apple Silicon. As machine-local evidence—not a portable or timeless default—WeChat Developer Tools `2.01.2510290` is now installed from the Homebrew cask that points to the official WeChat download page. Its executable CLI on this Mac is:

```text
/Applications/wechatwebdevtools.app/Contents/MacOS/cli
```

The remaining machine-local prerequisites are first GUI launch, WeChat QR-code login, automation service enablement, and importing this repository's development build.

## Decision

Add a focused `WX-ENV` topic to the existing LLM Wiki and make a verified Developer Tools environment a hard gate before Task 6.

This is preferable to adding a few commands to the existing testing article because installation and machine initialization have a distinct lifecycle from test design. It is also preferable to a broad operations manual because this slice needs only the local native-preview and automation path.

## Wiki Changes

Create `docs/llm-wiki/wechat-miniprogram/environment-setup.md` with stable, searchable knowledge IDs covering:

- `WX-ENV-001`: supported macOS installation path and official-source verification;
- `WX-ENV-002`: first launch, WeChat QR-code login, and the boundary between automatable checks and required human authentication;
- `WX-ENV-003`: CLI discovery, `WECHAT_DEVTOOLS_CLI` as the authoritative per-machine absolute-path configuration, help/smoke checks, and version capture from the application bundle;
- `WX-ENV-004`: Developer Tools automation service/port, its boundary with the later `miniprogram-automator` client, and the rule that automation must fail rather than silently skip;
- `WX-ENV-005`: importing/building this repository, including development versus production output boundaries;
- `WX-ENV-006`: troubleshooting permissions, a closed/mismatched port, login state, nonstandard install paths, and Developer Tools versus physical-device limitations.

Update the Wiki index to route installation and CLI questions to this topic. Add the official Developer Tools download and CLI/automation references to the source index. Keep `testing-release.md` focused on the development/test/release loop and link it to the environment prerequisite instead of duplicating commands.

Document the official-download and Homebrew installation options separately. Machine-specific facts such as an installed version, application path, or login state must be recorded as verification evidence, not presented as timeless official rules. Commands must resolve `WECHAT_DEVTOOLS_CLI` to an absolute executable file; the project must not assume every Mac uses the Homebrew application path.

## Plan Changes

Amend the existing venue-browsing plan without renumbering its fifteen implementation tasks:

1. Add a pre-Task-6 environment gate with executable pass/fail checks defined below.
2. Move a minimal design-preview Gallery shell into Task 6 before component visual decisions. Mount each component and its Fixture states there as it is designed, inspect it at 375px and 390px through the separate intra-Task-6 design gate below, and require a clean native compile/render before the Task 6 commit. Task 7 then expands that shell into the complete manifest-driven Gallery and Scenario Runner; it is not the first component preview.
3. State that failure of any gate blocks native visual design and Task 6 completion; browser renderings cannot substitute for the WeChat runtime.
4. Make Tasks 6–7 consume the verified CLI path from `WECHAT_DEVTOOLS_CLI` and retain native inspection evidence.
5. Keep Task 10's `miniprogram-automator` installation and Node client journey checks. The preflight proves only that the Developer Tools CLI can start its automation service on the selected port; Node client connectivity remains a Task 10 acceptance criterion.

### Executable Pre-Task-6 Gate

The plan must require a `scripts/check-wechat-devtools.mjs` preflight (or commands with exactly equivalent behavior) that exits non-zero with a stable, redacted error code on every failure and verifies all of the following:

1. `WECHAT_DEVTOOLS_CLI` is set, absolute, a regular file, and executable. Its enclosing application bundle yields a non-empty `CFBundleShortVersionString`; the report records that version but does not infer it from the CLI help text.
2. `project.private.config.json` exists, `git check-ignore -q project.private.config.json` succeeds, and its parsed `appid` is a non-empty string. The preflight prints only `APPID_CONFIGURED`, never the value.
3. Checked-in `project.config.json` has `miniprogramRoot: "dist/miniprogram-development/"`. The repository root—not the output directory—is passed to `open --project`, preserving the private configuration boundary.
4. `npm run build:miniprogram:development` succeeds before Developer Tools is opened.
5. `"$WECHAT_DEVTOOLS_CLI" islogin --project "$repo_root" --port "$port"` exits successfully and reports an authenticated session. QR-code login remains a human action; an unauthenticated result fails as `WECHAT_LOGIN_REQUIRED`.
6. `"$WECHAT_DEVTOOLS_CLI" open --project "$repo_root" --port "$port"` succeeds, followed by `auto --project "$repo_root" --port "$port" --trust-project`. The selected positive integer port is machine-local input, is not committed, and must be reused consistently.
7. A human records a redacted run-evidence result confirming that the existing scaffold page compiled and rendered in Developer Tools with no WXML/WXSS/Console errors. This proves the environment before Task 6; it does not claim that the not-yet-created component Gallery has been inspected. This evidence stays in the ignored run-evidence directory.

If the IDE is already serving another port, the preflight must fail as `WECHAT_PORT_MISMATCH`, print the safe remediation “quit Developer Tools, then rerun with one port,” and must not kill or reconfigure the user's IDE automatically. Other required preflight failures are `WECHAT_CLI_INVALID`, `WECHAT_VERSION_UNAVAILABLE`, `WECHAT_APPID_REQUIRED`, `WECHAT_BUILD_FAILED`, `WECHAT_LOGIN_REQUIRED`, `WECHAT_OPEN_FAILED`, and `WECHAT_AUTOMATION_FAILED`.

The preflight must not store credentials, AppID values, QR codes, session material, user-specific absolute paths, selected ports, or generated run evidence in Git.

Implement the preflight with an injected command runner and add `scripts/check-wechat-devtools.test.mjs`. Its isolated temporary-config tests must exercise every stable failure-code mapping, prove that `open` and `auto` receive the repository root rather than the build-output path, prove that one selected port is reused consistently, and assert that captured output never includes injected AppID, CLI-path, repository-path, or session sentinel values. These tests do not replace the separate live Developer Tools smoke check.

### Intra-Task-6 Native Design Gate

After Task 6 creates the minimal Gallery shell, but before it chooses final component-local visual values or commits, Developer Tools must render the component/Fixture states at 375px and 390px. A human must confirm text wrapping, capsule safe area, image fallbacks, interaction targets, and absence of WXML/WXSS/Console errors. Missing redacted evidence fails as `WECHAT_NATIVE_INSPECTION_REQUIRED`. Task 7 subsequently expands coverage to every manifest state and Scenario; it does not postpone the first component inspection.

## Validation

The documentation change is complete when:

- a new `tests/llm-wiki.test.mjs` verifies `WX-ENV-001` through `WX-ENV-006` each occur exactly once as headings in the new topic, the README routes environment/CLI questions there, `testing-release.md` links the prerequisite without duplicating it, and `sources.md` contains the official download and CLI/automation sources;
- that test resolves every relative Markdown link under `docs/llm-wiki/wechat-miniprogram` and fails on a missing local target;
- every claimed external fact has an official WeChat or Homebrew source;
- the plan contains the exact stable preflight failures, an explicit environment gate before Task 6, and the separate `WECHAT_NATIVE_INSPECTION_REQUIRED` design gate inside Task 6; it no longer defers first CLI discovery or first component preview to Tasks 7–10;
- `node --test tests/llm-wiki.test.mjs tests/artifacts.test.mjs scripts/check-wechat-devtools.test.mjs`, `npm run contract:validate`, `npm run lint`, `npm run typecheck`, and `npm test` all pass.

## Out of Scope

- Automating WeChat QR-code authentication;
- committing machine-local Developer Tools settings;
- treating Developer Tools as a replacement for iOS and Android device acceptance;
- changing the approved venue-browsing product scope or API contract.
