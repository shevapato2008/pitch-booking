# WeChat Developer Tools Environment Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a new developer a verified, secret-safe path from an unconfigured Mac to native WeChat preview readiness before the first component design is accepted.

**Architecture:** Add one routed `WX-ENV` Wiki topic, one deterministic documentation test, and one dependency-injected preflight CLI whose pure checks are fully automated while QR login and native rendering remain explicit live gates. Amend the existing venue-browsing plan so the scaffold environment smoke test occurs before Task 6, the component Gallery inspection occurs inside Task 6, and Task 10 remains responsible for Node automation journeys.

**Tech Stack:** Markdown, Node.js ESM, `node:test`, native WeChat Developer Tools CLI, Git ignored private project configuration.

**Approved spec:** `docs/superpowers/specs/2026-07-22-wechat-devtools-environment-bootstrap-design.md`

---

## File map

```text
docs/llm-wiki/wechat-miniprogram/
  environment-setup.md                  WX-ENV install/login/CLI/port/project guide
  README.md                             routes environment questions to WX-ENV
  testing-release.md                    declares WX-ENV as a prerequisite
  sources.md                            official download, CLI and automation sources
scripts/
  check-wechat-devtools.mjs             validated live environment preflight and CLI entry
  check-wechat-devtools.test.mjs        injected-runner failure/redaction/argument tests
tests/
  llm-wiki.test.mjs                     knowledge-ID, routing and local-link integrity
  implementation-plan.test.mjs          locks the two environment/design gates in the main plan
package.json                             stable environment-check script
docs/superpowers/plans/
  2026-07-22-foundation-and-venue-browsing.md  corrected Task 6/7/10 sequencing
```

## Chunk 1: Make the environment knowledge complete and executable

### Task 1: Add the routed `WX-ENV` Wiki topic

**Files:**
- Create: `tests/llm-wiki.test.mjs`
- Create: `docs/llm-wiki/wechat-miniprogram/environment-setup.md`
- Modify: `docs/llm-wiki/wechat-miniprogram/README.md`
- Modify: `docs/llm-wiki/wechat-miniprogram/testing-release.md`
- Modify: `docs/llm-wiki/wechat-miniprogram/sources.md`

- [ ] **Step 1: Write the failing Wiki integrity tests**

Create `tests/llm-wiki.test.mjs` with Node built-ins only. The first test reads `environment-setup.md` and requires each heading ID exactly once:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep as pathSeparator } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wiki = resolve(root, "docs/llm-wiki/wechat-miniprogram");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("WX-ENV has one heading for every stable knowledge ID", () => {
  const topic = read("docs/llm-wiki/wechat-miniprogram/environment-setup.md");
  for (let index = 1; index <= 6; index += 1) {
    const id = `WX-ENV-${String(index).padStart(3, "0")}`;
    assert.equal(topic.match(new RegExp(`^## ${id}：`, "gm"))?.length ?? 0, 1, id);
  }
});

test("the Wiki routes environment prerequisites without duplicating them", () => {
  const index = read("docs/llm-wiki/wechat-miniprogram/README.md");
  const testing = read("docs/llm-wiki/wechat-miniprogram/testing-release.md");
  const sources = read("docs/llm-wiki/wechat-miniprogram/sources.md");
  assert.match(index, /安装.*CLI.*environment-setup\.md/);
  const macLoop = testing.match(/## WX-TEST-001[^]*?(?=\n## |$)/)?.[0] ?? "";
  const firstParagraph = macLoop.split(/\n\s*\n/).slice(1).find((block) => block.trim()) ?? "";
  assert.match(firstParagraph, /\[[^\]]+\]\(environment-setup\.md\)/);
  assert.doesNotMatch(testing, /brew install|WECHAT_DEVTOOLS_CLI|cli (?:open|auto|islogin)|--port/);
  const destinations = new Set(
    [...sources.matchAll(/!?\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+[^)]*)?\)/g)]
      .map((match) => match[1])
  );
  for (const url of [
    "https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html",
    "https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html",
    "https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html"
  ]) assert.equal(destinations.has(url), true, url);
});
```

Add a third test with a recursive `readdirSync(..., { withFileTypes: true })` walk so future nested Wiki Markdown is covered. Extract destinations from both inline links/images and reference definitions:

```js
const inline = /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g;
const reference = /^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;

for (const sourceFile of markdownFiles) {
  const body = readFileSync(sourceFile, "utf8");
  const destinations = [inline, reference].flatMap((pattern) =>
    [...body.matchAll(pattern)].map((match) => match[1] ?? match[2])
  );
  for (const raw of destinations) {
    assert.doesNotMatch(raw, /^file:/i, `${sourceFile}: file URL is forbidden`);
    if (raw.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) continue;
    const withoutSuffix = raw.split(/[?#]/, 1)[0];
    const decoded = decodeURIComponent(withoutSuffix);
    assert.equal(isAbsolute(decoded), false, `${sourceFile}: absolute path is forbidden`);
    const target = resolve(dirname(sourceFile), decoded);
    const fromRoot = relative(root, target);
    assert.equal(fromRoot === ".." || fromRoot.startsWith(`..${pathSeparator}`) || isAbsolute(fromRoot), false,
      `${sourceFile}: target escapes repository`);
    assert.equal(existsSync(target), true, `${sourceFile}: ${raw}`);
  }
}
```

Reject `file://` before generic URI-scheme skipping. Query strings and fragments are removed only after classifying schemes; malformed percent encoding must fail the test rather than be ignored.
Import the platform `sep` as `pathSeparator`; repository-containment validation must occur before `existsSync`, so a traversal such as `../../../../etc/hosts` can never pass by finding a machine-local file.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/llm-wiki.test.mjs`

Expected: FAIL because `environment-setup.md` does not exist.

- [ ] **Step 3: Write the focused environment topic**

Create `environment-setup.md` with front matter (`title`, `tags`, `updated`) and exactly these six level-two headings:

```markdown
## WX-ENV-001：从官方来源安装
## WX-ENV-002：首次启动与人工登录
## WX-ENV-003：定位并配置 CLI
## WX-ENV-004：端口与自动化边界
## WX-ENV-005：导入并构建本项目
## WX-ENV-006：故障排查与真机边界
```

Required content:

- Link the official WeChat download page and the Homebrew cask definition; describe Homebrew as an optional installer, not as the authority for WeChat behavior.
- Show `brew install --cask wechatwebdevtools` and the official DMG alternative. Give copy-pastable discovery for `/Applications` and `$HOME/Applications`, require the developer to select one result when multiple exist, normalize it with `realpath`, and validate `test -f "$WECHAT_DEVTOOLS_CLI" && test -x "$WECHAT_DEVTOOLS_CLI"`. Export the resolved value only in the current shell or an ignored machine-local environment file; never place it in a tracked file. Do not declare one application path universal.
- State that QR-code login is human-only and that credentials, AppID, QR images, session data, ports and absolute paths must not be committed.
- Include `"$WECHAT_DEVTOOLS_CLI" --help` as the CLI smoke check and `/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' <resolved-app>/Contents/Info.plist` as bundle-version evidence; do not claim `--version` returns the app version.
- Explain that `cli auto` proves the Developer Tools automation service only; Task 10 installs and exercises `miniprogram-automator`. Document closed-port and mismatched-port symptoms, and the safe remediation of quitting Developer Tools and rerunning with one port without automatically killing the IDE.
- Require opening the repository root because checked-in `project.config.json` owns `miniprogramRoot` while ignored `project.private.config.json` owns the AppID. Explain that `dist/miniprogram-development/` contains native preview/Fixture/Scenario entries while `dist/miniprogram-production/` must exclude them and must never be used as the configured project root.
- Provide the project smoke command `npm run env:wechat:check -- --port <positive-integer>` and list every stable failure code from the approved spec.
- Map permissions, missing/non-executable/nonstandard CLI paths, logged-out state, closed/mismatched ports, build failure and automation failure to their safe remediation without embedding this Mac's observed version/path/port/AppID.
- Require redacted scaffold-render evidence under the already ignored `.superpowers/run-evidence/` directory, explicitly confirming no WXML/WXSS/Console errors. State that Developer Tools is a native design truth source but not a substitute for iOS and Android acceptance.
- Put an adjacent official WeChat citation on every external behavioral claim, including CLI syntax, QR login, Developer Tools automation and port behavior. Cite Homebrew only for cask packaging/install behavior. Label any observed application path, installed version, selected port or login state as machine-local evidence rather than authority.

Update `README.md` with a first-class route row for “Mac 从零安装、登录和配置 CLI”. Add one prerequisite sentence/link at the start of `WX-TEST-001` rather than copying commands. Add official download, CLI and automation URLs to `sources.md`.

- [ ] **Step 4: Run the Wiki tests and verify GREEN**

Run: `node --test tests/llm-wiki.test.mjs`

Expected: PASS; six unique IDs, all routes and sources present, every local link resolves.

- [ ] **Step 5: Commit the Wiki**

```bash
git add docs/llm-wiki/wechat-miniprogram/environment-setup.md docs/llm-wiki/wechat-miniprogram/README.md docs/llm-wiki/wechat-miniprogram/testing-release.md docs/llm-wiki/wechat-miniprogram/sources.md tests/llm-wiki.test.mjs
git commit -m "docs: add WeChat DevTools environment guide"
```

## Chunk 2: Build a deterministic, secret-safe preflight

### Task 2: Specify the preflight with failing tests

**Files:**
- Create: `scripts/check-wechat-devtools.mjs`
- Create: `scripts/check-wechat-devtools.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Characterize the installed official CLI without treating observations as authority**

Before encoding parsers, use the installed CLI help, official CLI documentation, and only the safely observable current IDE state to record in ignored `.superpowers/run-evidence/wechat-cli-characterization.md`:

- the exact currently observable `islogin` stdout/stderr/exit shape in default mode and, only if it does not change user state, `--lang zh` mode;
- any different-port output already safely observable without killing, quitting, logging out, changing preferences, or reconfiguring the user's IDE;
- the installed bundle version and observation date.

Never require logging out an existing user or changing the current IDE port merely to manufacture a fixture. Redact paths, AppID, ports, QR/session material and user identifiers. The official help statement that a different running port requires quitting the IDE is authority; exact observed strings are version-scoped parser fixtures only. Source an unavailable affirmative shape from official documentation or an already reviewed, sanitized and version-labelled fixture. If neither exists, implement fail-closed parsing and leave the live success gate blocked until the user logs in and a reviewed observation is available; do not invent an affirmative fixture and do not block isolated negative/error-path implementation.

- [ ] **Step 2: Write failing validation and failure-mapping tests**

Design `checkWechatDevTools(options)` as the exported boundary. Inject `runner`, `env`, `repoRoot`, `port`, `platform`, and an output collector; do not monkey-patch global process or filesystem APIs. The runner contract is:

```js
type RunnerOptions = {
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
};

type RunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal: string | null;
};

type Runner = (command: string, args: string[], options: RunnerOptions) =>
  Promise<RunnerResult>;

type SafeEvent = Readonly<{
  step: "validate" | "version" | "appid" | "build" | "login" | "open" | "automation";
  status: "passed" | "failed";
  code?: string;
  version?: string;
}>;
```

The default runner uses `execFile` with UTF-8, `cwd`, a 120-second build timeout, 30-second CLI timeout, and 1 MiB maximum output per stream. It normalizes callback/rejection errors, `ENOENT`, `EACCES`, non-zero exits, timeouts, signals and buffer overflow into `RunnerResult`; it never returns or attaches a raw Node error. `output(event)` accepts `SafeEvent` only.

Public contract:

- `checkWechatDevTools()` returns only a frozen `{ ok: true, version, checks: [...] }` containing safe fields.
- Every expected or unexpected failure throws `WeChatEnvironmentError` exposing `name`, `code`, and safe `message`; it has no `cause` and its stack is never printed by the entry point. Do not depend on JavaScript property enumerability.
- Unit tests use `assert.rejects()` and inspect only these safe fields.
- Separate entry-point tests verify failure JSON/exit `1` and success JSON/exit `0`.

Write table-driven tests for these exact failures:

```js
const failures = [
  "WECHAT_CLI_INVALID",
  "WECHAT_VERSION_UNAVAILABLE",
  "WECHAT_APPID_REQUIRED",
  "WECHAT_BUILD_FAILED",
  "WECHAT_LOGIN_REQUIRED",
  "WECHAT_OPEN_FAILED",
  "WECHAT_PORT_MISMATCH",
  "WECHAT_AUTOMATION_FAILED"
];
```

Use this cause-to-code ownership and precedence table so every failure has a deterministic code without expanding the approved public list:

| Cause/active phase | Stable code |
| --- | --- |
| unsupported platform; unset/relative/missing/non-file/non-executable CLI | `WECHAT_CLI_INVALID` |
| missing/unreadable/malformed bundle plist or blank version | `WECHAT_VERSION_UNAVAILABLE` |
| missing/malformed/not-ignored private config or blank/non-string AppID | `WECHAT_APPID_REQUIRED` |
| malformed/mismatched checked-in project config; build runner throw/timeout/signal/overflow/non-zero | `WECHAT_BUILD_FAILED` |
| missing/duplicate/extra/zero/negative/decimal/overflow/nonnumeric port argument | `WECHAT_AUTOMATION_FAILED` |
| unauthenticated/ambiguous login or login-phase runner failure | `WECHAT_LOGIN_REQUIRED` |
| open-phase runner failure | `WECHAT_OPEN_FAILED` |
| auto-phase runner failure | `WECHAT_AUTOMATION_FAILED` |
| characterized different-port signature from `islogin`, `open`, or `auto` | `WECHAT_PORT_MISMATCH` before phase-generic mapping, exact safe message “quit Developer Tools, then rerun with one port” |

An unexpected runner/filesystem/parser error maps to the stable code owned by the active phase. No raw error text crosses the boundary.

Each test supplies a temporary repository containing only the minimum `project.config.json`, ignored `project.private.config.json`, executable fake CLI, and `.app/Contents/Info.plist` fixture needed to reach the intended boundary. Use `assert.rejects()` to verify `name`, exact `code`, safe `message`, absent `cause`, and no fall-through to later commands. For port mismatch, require the exact remediation text and assert the complete trace contains no `kill`, `quit`, preference-write, port-reconfiguration, or later-stage command.

Assert the complete successful command trace, order and options:

```js
assert.deepEqual(trace.map(({ command, args }) => [command, args]), [
  ["git", ["check-ignore", "--quiet", privateConfigPath]],
  ["/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", infoPlistPath]],
  [npmExecutable, ["run", "build:miniprogram:development"]],
  [cliPath, ["islogin", "--project", repoRoot, "--port", "9420"]],
  [cliPath, ["open", "--project", repoRoot, "--port", "9420"]],
  [cliPath, ["auto", "--project", repoRoot, "--port", "9420", "--trust-project"]]
]);
assert.equal(trace.every((call) => call.options.cwd === repoRoot), true);
assert.deepEqual(openCall.args, ["open", "--project", repoRoot, "--port", "9420"]);
assert.deepEqual(autoCall.args, ["auto", "--project", repoRoot, "--port", "9420", "--trust-project"]);
assert.equal(allCalls.every((call) => !call.args.includes("dist/miniprogram-development")), true);
assert.equal(new Set(portArguments).size, 1);
```

Require `--trust-project` only on `auto`. Add runner-result, thrown-runner, timeout, signal and oversized-output cases at build/login/open/auto boundaries and assert no later command runs.

Build login parser fixtures only from Step 1's redacted characterization. Accept explicit structured boolean `true` shapes actually emitted by the installed official CLI; reject structured false, malformed JSON, empty output and every ambiguous token. Test both stdout/stderr locations and zero/non-zero exits. Build exact escaped port-mismatch fixtures from characterization and test precedence at all three CLI phases. Do not accept guessed strings such as arbitrary `yes`, `logged in`, or localized prose.

Inject unique sentinels for AppID, CLI path, repository path, selected port and session/raw child output. Inspect success reports, safe events, the explicit `name`/`code`/`message` error whitelist, captured stdout and stderr; none may contain any sentinel. Assert raw errors are never attached as `cause` and the success report contains only safe labels such as `APPID_CONFIGURED`, bundle version, and stable step names.

Add table-driven `parseArgs()` and entry-point tests for missing, duplicate, extra, zero, negative, decimal, overflow and nonnumeric `--port` values. The canonical output contract is one compact JSON object plus newline: success to stdout as `{ "ok": true, ...safeFields }` with exit `0`; failure to stderr as `{ "ok": false, "code": "...", "message": "..." }` with exit `1`; the unused channel stays empty. Add at least one real subprocess test for invalid arguments proving exit `1`, parseable safe stderr JSON, empty stdout and no stack.

- [ ] **Step 3: Run the preflight tests and verify RED**

Run: `node --test scripts/check-wechat-devtools.test.mjs`

Expected: FAIL because the preflight module does not exist.

- [ ] **Step 4: Implement pure validation and command orchestration**

Create `scripts/check-wechat-devtools.mjs` with:

```js
export class WeChatEnvironmentError extends Error {
  constructor(code, safeMessage) {
    super(safeMessage);
    this.name = "WeChatEnvironmentError";
    this.code = code;
  }
}

export async function checkWechatDevTools({ runner, env, repoRoot, port, platform, output }) {
  // 1. Validate positive integer port and absolute executable WECHAT_DEVTOOLS_CLI.
  // 2. Resolve the containing .app and read CFBundleShortVersionString.
  // 3. Verify project.private.config.json is ignored and has a non-empty appid without printing it.
  // 4. Verify checked-in miniprogramRoot exactly.
  // 5. Run npm build, CLI islogin, open, then auto with one port and repoRoot.
  // 6. Convert every raw failure to a stable safe code/message.
  // 7. Return a frozen safe report; never return raw command output.
}
```

Use `execFile` through the normalized default runner—never shell interpolation. Parse `Info.plist` using `/usr/libexec/PlistBuddy` on macOS. Implement only the characterized `islogin` affirmative shapes and exact different-port signatures. Check port mismatch against both stdout and stderr before mapping the active phase's generic error. Everything not explicitly affirmative is `WECHAT_LOGIN_REQUIRED`.

Export `parseArgs(argv)` and `main({ argv, env, cwd, runner, writeOut, writeErr })` for deterministic tests. When the module is the process entry point, call `main` with real adapters. Catch both known and unknown errors; convert unknown errors to the active phase's safe code, serialize failure through the explicit whitelist `{ ok: false, code: error.code, message: error.message }`, set `process.exitCode`, and never allow Node's default stack printer. Do not print raw child output unless a future redacted-debug design is approved.

- [ ] **Step 5: Add the stable package script**

Add to `package.json`:

```json
"env:wechat:check": "node scripts/check-wechat-devtools.mjs"
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --test scripts/check-wechat-devtools.test.mjs
npm run lint
```

Expected: every stable failure, complete command trace, runner normalization, login/mismatch fixture, argument, channel/exit and redaction test passes; ESLint reports no errors.

- [ ] **Step 7: Commit the tested preflight**

```bash
git add package.json scripts/check-wechat-devtools.mjs scripts/check-wechat-devtools.test.mjs
git commit -m "chore: verify WeChat DevTools environment"
```

## Chunk 3: Correct the frontend plan and prove the new gate

### Task 3: Amend Task 6/7/10 sequencing

**Files:**
- Create: `tests/implementation-plan.test.mjs`
- Modify: `docs/superpowers/plans/2026-07-22-foundation-and-venue-browsing.md`

- [ ] **Step 1: Write the failing plan-integrity test**

Create `tests/implementation-plan.test.mjs`. Read the plan and find the byte offsets of the pre-Task-6 gate, Task 6, Task 7 and Task 10 headings. Assert the strict order:

```js
assert.ok(environmentGate < task6);
assert.ok(task6 < task7);
assert.ok(task7 < task10);
```

Require:

- all eight preflight error codes occur in the pre-Task-6 section;
- `WECHAT_NATIVE_INSPECTION_REQUIRED` occurs inside Task 6, not in the preflight;
- the exact Task 6 and Task 7 section slices both reference `WECHAT_DEVTOOLS_CLI` and the verified environment gate;
- Task 6 creates the minimal `dev/ui-gallery` shell before invoking `@ui-ux-pro-max` visual decisions and inspects 375px/390px before commit;
- Task 6's human checklist contains text wrapping, capsule safe area, image fallbacks, interaction targets, no WXML/WXSS/Console errors, ignored redacted evidence, and `WECHAT_NATIVE_INSPECTION_REQUIRED`;
- Task 6 runs the development-Gallery existence check and production audit/no-`dev` check before its commit command;
- Task 6 labels inspection as engineering-only, keeps evidence ignored, creates no canonical candidate/baseline, does not introduce a user stage checkpoint, and leaves acceptance/promotion exclusively in Task 15;
- Task 7 modifies/expands the shell and moved Gallery test into the full manifest Gallery and Scenario Runner;
- Task 10 still installs `miniprogram-automator` and no longer frames missing Developer Tools as first discovery.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/implementation-plan.test.mjs`

Expected: FAIL because the plan has only a prose prerequisite, first creates the Gallery in Task 7, and first gates the CLI in Task 10.

- [ ] **Step 3: Insert the executable pre-Task-6 gate**

Immediately before `## Chunk 2`, add `### Environment Gate: Prove native runtime readiness before Task 6` with these steps:

1. Install/locate stable Developer Tools and set absolute `WECHAT_DEVTOOLS_CLI`.
2. Create ignored `project.private.config.json` with the development AppID without printing/committing it.
3. Run unit tests for the preflight.
4. Run `npm run build:miniprogram:development`.
5. Run `npm run env:wechat:check -- --port <machine-local-port>`.
6. Human-confirm the existing scaffold compiles/renders without WXML/WXSS/Console errors and save redacted ignored evidence.

List exact safe failures and state that any failure blocks Task 6. Document the different-port remediation and prohibit automatic IDE termination.

- [ ] **Step 4: Move the minimal Gallery shell and native design gate into Task 6**

Change Task 6's file list to include:

```text
Modify: scripts/build-miniprogram.mjs
Modify: miniprogram/dev/bootstrap.ts
Create: miniprogram/dev/ui-gallery/index.ts
Create: miniprogram/dev/ui-gallery/index.json
Create: miniprogram/dev/ui-gallery/index.wxml
Create: miniprogram/dev/ui-gallery/index.wxss
Create: miniprogram/dev/dev-entry.test.ts
```

Keep the five component/style/token files already listed. Reorder Task 6 into this exact RED→GREEN→native-proof sequence:

1. Write failing component tests plus `dev-entry.test.ts` tests for development-only route registration and the minimal Gallery render model.
2. Run both focused suites and prove they fail because components/Gallery do not exist.
3. Create/register the minimal development-only Gallery shell through `scripts/build-miniprogram.mjs` and `dev/bootstrap.ts`.
4. Invoke `@ui-ux-pro-max`, implement component-local tokens, the five components/styles, and incrementally mount their Fixture-backed states in the Gallery.
5. Run component/Gallery/Artifact/type checks to GREEN.
6. Using the already verified `WECHAT_DEVTOOLS_CLI`, build and inspect at 375px and 390px. The human checklist must cover text wrapping, capsule safe area, one/all image fallbacks, interaction targets, and absence of WXML/WXSS/Console errors. Save only redacted evidence under ignored `.superpowers/run-evidence/`; otherwise fail `WECHAT_NATIVE_INSPECTION_REQUIRED`.
7. Before commit, prove immediate production isolation:

   ```bash
   npm run build:miniprogram:development
   test -f dist/miniprogram-development/dev/ui-gallery/index.js
   npm run build:miniprogram:production
   npm run audit:miniprogram-package
   test ! -e dist/miniprogram-production/dev
   ```

8. State explicitly that this is a required human engineering inspection, not the user stage checkpoint; evidence stays ignored, no candidate is canonical, no baseline is promoted, and final user acceptance/promotion remains exclusively in Task 15.
9. Commit every Task 6 path:

   ```bash
   git add package.json package-lock.json artifacts/ui/design-system miniprogram/app.wxss miniprogram/styles miniprogram/components miniprogram/dev/bootstrap.ts miniprogram/dev/ui-gallery miniprogram/dev/dev-entry.test.ts scripts/build-miniprogram.mjs scripts/generate-wxss-tokens.mjs tests/artifacts.test.mjs
   git commit -m "feat: build venue browsing native components"
   ```

Task 7's file list must change the four Gallery files and `miniprogram/dev/dev-entry.test.ts` from `Create` to `Modify`; Scenario Runner files remain `Create`. Task 7 uses the verified `WECHAT_DEVTOOLS_CLI`, expands the existing shell/test into the full manifest Gallery and Scenario Runner, and retains/expands the development-versus-production gate. Task 10 keeps Node journey automation and changes its missing-environment wording to “preflight regression,” pointing back to the environment gate.

- [ ] **Step 5: Run the plan/Wiki tests and verify GREEN**

Run:

```bash
node --test tests/implementation-plan.test.mjs tests/llm-wiki.test.mjs
git diff --check
```

Expected: PASS; the environment gate precedes Task 6, the component design gate is inside Task 6, and no local Markdown link is broken.

- [ ] **Step 6: Commit the corrected plan**

```bash
git add docs/superpowers/plans/2026-07-22-foundation-and-venue-browsing.md tests/implementation-plan.test.mjs
git commit -m "docs: gate frontend work on WeChat runtime"
```

### Task 4: Run the complete documentation/environment quality interface

**Files:**
- Verify only; no new files expected

- [ ] **Step 1: Run all focused and repository checks**

Run:

```bash
node --test tests/llm-wiki.test.mjs tests/implementation-plan.test.mjs scripts/check-wechat-devtools.test.mjs tests/artifacts.test.mjs
npm run contract:validate
npm run lint
npm run typecheck
npm test
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all commands exit 0; production remains free of development/Fixture/Scenario material.

- [ ] **Step 2: Run the live preflight to the first honest machine-local boundary**

Run:

```bash
WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" \
  npm run env:wechat:check -- --port 9420
```

Expected on a configured machine: safe PASS report with version and `APPID_CONFIGURED`, followed by a human-confirmed scaffold render.

If QR login or a development AppID is missing, expected delivery is the precise stable failure (`WECHAT_LOGIN_REQUIRED` or `WECHAT_APPID_REQUIRED`) with no secret output. Record it as the next human environment action; do not mark the live gate complete and do not proceed to Task 6.

- [ ] **Step 3: Verify the worktree and report the gate honestly**

Run:

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: no uncommitted implementation changes. Report automated quality separately from live Developer Tools/AppID/login readiness.
