# WeChat Developer Tools Environment Bootstrap Design

**Date:** 2026-07-22  
**Status:** Approved in conversation; pending written-spec review  
**Scope:** Developer-environment documentation and the existing venue-browsing implementation plan

## Problem

The project LLM Wiki describes the WeChat Developer Tools development loop and names `miniprogram-automator`, but it does not tell a new developer how to install, initialize, authenticate, locate, or verify the Developer Tools CLI. The venue-browsing plan first treats the CLI as a hard dependency in Task 10, after native visual work is already scheduled. That permits Tasks 6–9 to proceed without proving that their runtime truth source is available.

The current Mac is Apple Silicon. WeChat Developer Tools `2.01.2510290` is now installed from the Homebrew cask that points to the official WeChat download page. Its executable CLI is:

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
- `WX-ENV-003`: CLI discovery, absolute-path configuration, help/smoke checks, and version capture from the application bundle;
- `WX-ENV-004`: Developer Tools automation service/port, `miniprogram-automator`, and the rule that automation must fail rather than silently skip;
- `WX-ENV-005`: importing/building this repository, including development versus production output boundaries;
- `WX-ENV-006`: troubleshooting permissions, a closed/mismatched port, login state, nonstandard install paths, and Developer Tools versus physical-device limitations.

Update the Wiki index to route installation and CLI questions to this topic. Add the official Developer Tools download and CLI/automation references to the source index. Keep `testing-release.md` focused on the development/test/release loop and link it to the environment prerequisite instead of duplicating commands.

Machine-specific facts such as an installed version or login state must be recorded as verification evidence, not presented as timeless official rules. Commands must use an explicit CLI path or `WECHAT_DEVTOOLS_CLI`; the project must not assume every Mac uses the Homebrew application path.

## Plan Changes

Amend the existing venue-browsing plan without renumbering its fifteen implementation tasks:

1. Add a pre-Task-6 environment gate that checks the app and executable CLI, captures the installed version, confirms login/automation readiness, builds the development package, and proves the project can be opened.
2. State that failure of any gate blocks native visual design and Task 6 completion; browser renderings cannot substitute for the WeChat runtime.
3. Make Task 7 consume the verified CLI path from `WECHAT_DEVTOOLS_CLI` and retain its 375px/390px native inspection evidence.
4. Keep Task 10's automation checks, but treat them as journey verification rather than first-time environment discovery.

The preflight must not store credentials, QR codes, session material, user-specific absolute paths, or generated run evidence in Git.

## Validation

The documentation change is complete when:

- `rg "WX-ENV" docs/llm-wiki/wechat-miniprogram` finds the new routed topic and its stable IDs;
- every claimed external fact has an official WeChat or Homebrew source;
- the plan contains an explicit hard gate before Task 6 and no longer defers first CLI discovery to Task 10;
- Markdown links resolve locally;
- the existing Artifact, contract, lint, typecheck, and test interfaces remain green because the change does not alter runtime code.

## Out of Scope

- Automating WeChat QR-code authentication;
- committing machine-local Developer Tools settings;
- treating Developer Tools as a replacement for iOS and Android device acceptance;
- changing the approved venue-browsing product scope or API contract.
