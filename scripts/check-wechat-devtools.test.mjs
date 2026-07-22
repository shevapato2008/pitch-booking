import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const moduleUrl = new URL('./check-wechat-devtools.mjs', import.meta.url);
const { checkWechatDevTools, createDefaultRunner, main, parseArgs } = await import(moduleUrl);

const APPID = 'APPID_SECRET_SENTINEL_91e16f';
const REPO = 'REPO_PATH_SENTINEL_91e16f';
const CLI = 'CLI_PATH_SENTINEL_91e16f';
const PORT_SENTINEL = '98761';
const SESSION = 'SESSION_RAW_SENTINEL_91e16f';
const PORT = Number(PORT_SENTINEL);
const messages = Object.freeze({
  WECHAT_CLI_INVALID: 'WeChat DevTools CLI must be an absolute executable file',
  WECHAT_VERSION_UNAVAILABLE: 'WeChat DevTools bundle version is unavailable',
  WECHAT_APPID_REQUIRED: 'A private WeChat AppID is required',
  WECHAT_BUILD_FAILED: 'WeChat development build failed',
  WECHAT_LOGIN_REQUIRED: 'WeChat DevTools login is required',
  WECHAT_OPEN_FAILED: 'WeChat DevTools could not open the project',
  WECHAT_PORT_MISMATCH: 'quit Developer Tools, then rerun with one port',
  WECHAT_AUTOMATION_FAILED: 'WeChat DevTools automation could not start'
});

function result(overrides = {}) {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, signal: null, ...overrides };
}

async function fixture({ appid = APPID, project = { miniprogramRoot: 'dist/miniprogram-development/' } } = {}) {
  const root = await mkdtemp(join(tmpdir(), `${REPO}-`));
  const cli = join(root, `${CLI}.app`, 'Contents', 'MacOS', 'cli');
  await mkdir(join(root, `${CLI}.app`, 'Contents', 'MacOS'), { recursive: true });
  await writeFile(join(root, 'project.config.json'), JSON.stringify(project));
  await writeFile(join(root, 'project.private.config.json'), JSON.stringify({ appid }));
  await writeFile(join(root, `${CLI}.app`, 'Contents', 'Info.plist'), '<plist/>');
  await writeFile(cli, '#!/bin/sh\n');
  await chmod(cli, 0o755);
  return { root, cli, privateConfig: join(root, 'project.private.config.json') };
}

function phaseFor(command, args) {
  if (command === 'git') return 'appid';
  if (command === '/usr/libexec/PlistBuddy') return 'version';
  if (args[0] === 'run') return 'build';
  if (args[0] === 'islogin') return 'login';
  if (args[0] === 'open') return 'open';
  return 'automation';
}

function runner({ trace = [], byPhase = {}, throwPhase } = {}) {
  return async (command, args, options) => {
    trace.push({ command, args, options });
    const phase = phaseFor(command, args);
    if (throwPhase === phase) throw new Error(SESSION);
    if (Object.hasOwn(byPhase, phase)) return byPhase[phase];
    if (phase === 'version') return result({ stdout: 'release-candidate + 7\n' });
    if (phase === 'login') return result({ stdout: 'prose\n{"login":true}\nmore prose' });
    return result();
  };
}

async function expectFailure(run, code) {
  await assert.rejects(run, (error) => {
    assert.equal(error.name, 'WeChatEnvironmentError');
    assert.equal(error.code, code);
    assert.equal(error.message, messages[code]);
    assert.equal('cause' in error, false);
    return true;
  });
}

function assertStopsAfter(trace, phase) {
  const order = ['appid', 'version', 'build', 'login', 'open', 'automation'];
  const index = order.indexOf(phase);
  for (const call of trace) assert.ok(order.indexOf(phaseFor(call.command, call.args)) <= index);
}

function mismatch({ language = 'en', requested = PORT, current = 9421 }) {
  return language === 'zh'
    ? `✖ IDE 已启动并在监听 http://127.0.0.1:${current}，需要重启才能使用端口 ${requested}`
    : `✖ IDE server has started on http://127.0.0.1:${current} and must be restarted on port ${requested} first`;
}

test('success runs the full safe trace with one selected port and emits only safe fields', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const trace = []; const events = [];
  const report = await checkWechatDevTools({ runner: runner({ trace }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin', output: (event) => events.push(event) });
  assert.equal(Object.isFrozen(report), true);
  assert.deepEqual(trace.map(({ command, args }) => [command, args]), [
    ['git', ['check-ignore', '--quiet', f.privateConfig]],
    ['/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', `${f.cli.slice(0, f.cli.indexOf('.app') + 4)}/Contents/Info.plist`]],
    ['npm', ['run', 'build:miniprogram:development']],
    [f.cli, ['islogin', '--project', f.root, '--port', PORT_SENTINEL]],
    [f.cli, ['open', '--project', f.root, '--port', PORT_SENTINEL]],
    [f.cli, ['auto', '--project', f.root, '--port', PORT_SENTINEL, '--trust-project']]
  ]);
  assert.deepEqual(trace.map(({ options }) => options), [
    { cwd: f.root, timeoutMs: 30_000, maxBufferBytes: 1_048_576 },
    { cwd: f.root, timeoutMs: 30_000, maxBufferBytes: 1_048_576 },
    { cwd: f.root, timeoutMs: 120_000, maxBufferBytes: 1_048_576 },
    { cwd: f.root, timeoutMs: 30_000, maxBufferBytes: 1_048_576 },
    { cwd: f.root, timeoutMs: 30_000, maxBufferBytes: 1_048_576 },
    { cwd: f.root, timeoutMs: 30_000, maxBufferBytes: 1_048_576 }
  ]);
  assert.deepEqual(events.map(({ step, status }) => [step, status]), [['appid', 'passed'], ['version', 'passed'], ['validate', 'passed'], ['build', 'passed'], ['login', 'passed'], ['open', 'passed'], ['automation', 'passed']]);
  const rendered = JSON.stringify({ report, events });
  for (const secret of [APPID, REPO, CLI, PORT_SENTINEL, SESSION]) assert.doesNotMatch(rendered, new RegExp(secret));
  assert.deepEqual(Object.keys(report).sort(), ['checks', 'ok', 'version']);
});

test('main writes success only to stdout and exits zero', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  let stdout = ''; let stderr = '';
  const code = await main({ argv: ['--port', PORT_SENTINEL], env: { WECHAT_DEVTOOLS_CLI: f.cli }, cwd: f.root, runner: runner(), writeOut: (text) => { stdout += text; }, writeErr: (text) => { stderr += text; } });
  assert.equal(code, 0); assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { ok: true, version: 'release-candidate + 7', checks: ['APPID_CONFIGURED', 'PROJECT_CONFIGURED', 'BUILD_COMPLETED', 'LOGIN_CONFIRMED', 'PROJECT_OPENED', 'AUTOMATION_ENABLED'] });
  for (const secret of [APPID, REPO, CLI, PORT_SENTINEL, SESSION]) assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(secret));
});

test('login accepts only the independent characterized JSON line from stdout or stderr on exit zero', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const login of [result({ stdout: '{"login":true}\n' }), result({ stderr: 'localized\n{"login":true}\n' })]) {
    const trace = [];
    await checkWechatDevTools({ runner: runner({ trace, byPhase: { login } }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin' });
    assert.equal(trace.at(-1).args[0], 'auto');
  }
  for (const login of [result({ exitCode: 1, stdout: '{"login":true}' }), result(), result({ stdout: '{"login":false}' }), result({ stdout: '{"login":true} extra' }), result({ stdout: 'yes' }), result({ stdout: 'logged in' }), result({ stdout: '{' })]) {
    const trace = [];
    await expectFailure(() => checkWechatDevTools({ runner: runner({ trace, byPhase: { login } }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin' }), 'WECHAT_LOGIN_REQUIRED');
    assertStopsAfter(trace, 'login');
  }
});

test('recognized different-port output wins over generic login open and automation failures', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const phase of ['login', 'open', 'automation']) for (const language of ['en', 'zh']) for (const channel of ['stdout', 'stderr']) {
    const trace = [];
    await expectFailure(() => checkWechatDevTools({ runner: runner({ trace, byPhase: { [phase]: result({ exitCode: 255, [channel]: mismatch({ language }) }) } }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin' }), 'WECHAT_PORT_MISMATCH');
    assertStopsAfter(trace, phase);
    assert.equal(trace.some(({ args }) => ['kill', 'quit'].includes(args[0])), false);
  }
});

test('mismatch parser rejects wrong requested/current ports and arbitrary prose', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const text of [mismatch({ requested: PORT + 1 }), mismatch({ current: PORT }), 'IDE server has started on localhost and must be restarted', `port ${PORT}`]) {
    await expectFailure(() => checkWechatDevTools({ runner: runner({ byPhase: { login: result({ exitCode: 255, stdout: text }) } }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin' }), 'WECHAT_LOGIN_REQUIRED');
  }
});

test('maps generic runner throws, malformed results, timeout, signal, oversized output and nonzero to each active CLI phase', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const expectations = { build: 'WECHAT_BUILD_FAILED', login: 'WECHAT_LOGIN_REQUIRED', open: 'WECHAT_OPEN_FAILED', automation: 'WECHAT_AUTOMATION_FAILED' };
  const oversizedOutput = result({ stdout: 'x'.repeat(1_048_577) });
  for (const [phase, code] of Object.entries(expectations)) for (const outcome of [undefined, null, {}, result({ timedOut: true }), result({ signal: 'SIGTERM' }), oversizedOutput, result({ exitCode: 1, stderr: SESSION })]) {
    const trace = [];
    const options = outcome === undefined ? { throwPhase: phase } : { byPhase: { [phase]: outcome } };
    await expectFailure(() => checkWechatDevTools({ runner: runner({ trace, ...options }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin' }), code);
    assertStopsAfter(trace, phase);
  }
});

test('validates CLI AppID project and version boundaries exhaustively before later commands', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const options of [{ env: {} }, { env: { WECHAT_DEVTOOLS_CLI: 'relative' } }, { env: { WECHAT_DEVTOOLS_CLI: f.cli }, platform: 'linux' }, { env: { WECHAT_DEVTOOLS_CLI: join(f.root, 'missing') } }]) {
    const trace = [];
    await expectFailure(() => checkWechatDevTools({ runner: runner({ trace }), repoRoot: f.root, port: PORT, platform: 'darwin', ...options }), 'WECHAT_CLI_INVALID'); assert.deepEqual(trace, []);
  }
  const nonExecutable = await fixture(); t.after(() => rm(nonExecutable.root, { recursive: true, force: true }));
  await chmod(nonExecutable.cli, 0o644);
  await expectFailure(() => checkWechatDevTools({ runner: runner(), env: { WECHAT_DEVTOOLS_CLI: nonExecutable.cli }, repoRoot: nonExecutable.root, port: PORT, platform: 'darwin' }), 'WECHAT_CLI_INVALID');
  await expectFailure(() => checkWechatDevTools({ runner: runner(), env: { WECHAT_DEVTOOLS_CLI: nonExecutable.root }, repoRoot: nonExecutable.root, port: PORT, platform: 'darwin' }), 'WECHAT_CLI_INVALID');
  for (const version of ['', '   ']) await expectFailure(() => checkWechatDevTools({ runner: runner({ byPhase: { version: result({ stdout: version }) } }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin' }), 'WECHAT_VERSION_UNAVAILABLE');
  const noAppid = await fixture({ appid: ' ' }); t.after(() => rm(noAppid.root, { recursive: true, force: true }));
  await expectFailure(() => checkWechatDevTools({ runner: runner(), env: { WECHAT_DEVTOOLS_CLI: noAppid.cli }, repoRoot: noAppid.root, port: PORT, platform: 'darwin' }), 'WECHAT_APPID_REQUIRED');
  for (const appid of [null, 42]) {
    const malformed = await fixture({ appid }); t.after(() => rm(malformed.root, { recursive: true, force: true }));
    await expectFailure(() => checkWechatDevTools({ runner: runner(), env: { WECHAT_DEVTOOLS_CLI: malformed.cli }, repoRoot: malformed.root, port: PORT, platform: 'darwin' }), 'WECHAT_APPID_REQUIRED');
  }
  const absent = await fixture(); t.after(() => rm(absent.root, { recursive: true, force: true }));
  await unlink(absent.privateConfig);
  await expectFailure(() => checkWechatDevTools({ runner: runner(), env: { WECHAT_DEVTOOLS_CLI: absent.cli }, repoRoot: absent.root, port: PORT, platform: 'darwin' }), 'WECHAT_APPID_REQUIRED');
  const malformedPrivate = await fixture(); t.after(() => rm(malformedPrivate.root, { recursive: true, force: true }));
  await writeFile(malformedPrivate.privateConfig, '{');
  await expectFailure(() => checkWechatDevTools({ runner: runner(), env: { WECHAT_DEVTOOLS_CLI: malformedPrivate.cli }, repoRoot: malformedPrivate.root, port: PORT, platform: 'darwin' }), 'WECHAT_APPID_REQUIRED');
  const notIgnored = await fixture(); t.after(() => rm(notIgnored.root, { recursive: true, force: true }));
  await expectFailure(() => checkWechatDevTools({ runner: runner({ byPhase: { appid: result({ exitCode: 1 }) } }), env: { WECHAT_DEVTOOLS_CLI: notIgnored.cli }, repoRoot: notIgnored.root, port: PORT, platform: 'darwin' }), 'WECHAT_APPID_REQUIRED');
  for (const project of [{}, { miniprogramRoot: 'dist/miniprogram-production/' }]) {
    const badProject = await fixture({ project }); t.after(() => rm(badProject.root, { recursive: true, force: true }));
    await expectFailure(() => checkWechatDevTools({ runner: runner(), env: { WECHAT_DEVTOOLS_CLI: badProject.cli }, repoRoot: badProject.root, port: PORT, platform: 'darwin' }), 'WECHAT_BUILD_FAILED');
  }
  const malformedProject = await fixture(); t.after(() => rm(malformedProject.root, { recursive: true, force: true }));
  await writeFile(join(malformedProject.root, 'project.config.json'), '{');
  await expectFailure(() => checkWechatDevTools({ runner: runner(), env: { WECHAT_DEVTOOLS_CLI: malformedProject.cli }, repoRoot: malformedProject.root, port: PORT, platform: 'darwin' }), 'WECHAT_BUILD_FAILED');
});

test('parseArgs rejects every invalid port shape and main keeps the failure channel safe', async () => {
  for (const argv of [[], ['--port'], ['--port', '1', '--port', '2'], ['--port', '1', 'extra'], ['--port', '0'], ['--port', '-1'], ['--port', '1.5'], ['--port', '999999999999999999999'], ['--port', 'abc']]) assert.throws(() => parseArgs(argv), { code: 'WECHAT_AUTOMATION_FAILED' });
  assert.deepEqual(parseArgs(['--port', '9420']), { port: 9420 });
  let stdout = ''; let stderr = '';
  assert.equal(await main({ argv: ['--port', 'nope'], writeOut: (text) => { stdout += text; }, writeErr: (text) => { stderr += text; } }), 1);
  assert.equal(stdout, ''); assert.deepEqual(JSON.parse(stderr), { ok: false, code: 'WECHAT_AUTOMATION_FAILED', message: messages.WECHAT_AUTOMATION_FAILED });
});

test('default runner recognizes real timeout and max-buffer overflow without exposing Node errors', async () => {
  const runner_ = createDefaultRunner();
  const timedOut = await runner_(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { cwd: process.cwd(), timeoutMs: 10, maxBufferBytes: 1024 });
  assert.equal(timedOut.timedOut, true); assert.equal(timedOut.signal, 'SIGTERM');
  const overflow = await runner_(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], { cwd: process.cwd(), timeoutMs: 1_000, maxBufferBytes: 8 });
  assert.equal(overflow.exitCode, 1); assert.equal(overflow.timedOut, false);
  assert.deepEqual(Object.keys(overflow).sort(), ['exitCode', 'signal', 'stderr', 'stdout', 'timedOut']);
});

test('real entry point emits one safe stderr JSON object for invalid arguments', async () => {
  const child = await new Promise((resolve, reject) => execFile(process.execPath, [moduleUrl.pathname, '--port', 'nope'], { encoding: 'utf8' }, (error, stdout, stderr) => error ? resolve({ error, stdout, stderr }) : reject(new Error('expected failure'))));
  assert.equal(child.error.code, 1); assert.equal(child.stdout, '');
  assert.deepEqual(JSON.parse(child.stderr), { ok: false, code: 'WECHAT_AUTOMATION_FAILED', message: messages.WECHAT_AUTOMATION_FAILED });
  assert.doesNotMatch(child.stderr, /WeChatEnvironmentError|at .*check-wechat/);
});
