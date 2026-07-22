import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const moduleUrl = new URL('./check-wechat-devtools.mjs', import.meta.url);
const {
  WeChatEnvironmentError,
  checkWechatDevTools,
  createDefaultRunner,
  main,
  parseArgs
} = await import(moduleUrl);

const PRIVATE_APPID = 'APPID_SECRET_SENTINEL_91e16f';
const REPO_SENTINEL = 'REPO_PATH_SENTINEL_91e16f';
const SESSION_SENTINEL = 'SESSION_RAW_SENTINEL_91e16f';
const PORT = 9420;
const codes = [
  'WECHAT_CLI_INVALID', 'WECHAT_VERSION_UNAVAILABLE', 'WECHAT_APPID_REQUIRED',
  'WECHAT_BUILD_FAILED', 'WECHAT_LOGIN_REQUIRED', 'WECHAT_OPEN_FAILED',
  'WECHAT_PORT_MISMATCH', 'WECHAT_AUTOMATION_FAILED'
];
const messages = {
  WECHAT_CLI_INVALID: 'WeChat DevTools CLI must be an absolute executable file',
  WECHAT_VERSION_UNAVAILABLE: 'WeChat DevTools bundle version is unavailable',
  WECHAT_APPID_REQUIRED: 'A private WeChat AppID is required',
  WECHAT_BUILD_FAILED: 'WeChat development build failed',
  WECHAT_LOGIN_REQUIRED: 'WeChat DevTools login is required',
  WECHAT_OPEN_FAILED: 'WeChat DevTools could not open the project',
  WECHAT_PORT_MISMATCH: 'quit Developer Tools, then rerun with one port',
  WECHAT_AUTOMATION_FAILED: 'WeChat DevTools automation could not start'
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), `${REPO_SENTINEL}-`));
  const cli = join(root, 'DevTools.app', 'Contents', 'MacOS', 'cli');
  const plist = join(root, 'DevTools.app', 'Contents', 'Info.plist');
  await mkdir(join(root, 'DevTools.app', 'Contents', 'MacOS'), { recursive: true });
  await writeFile(join(root, 'project.config.json'), JSON.stringify({ miniprogramRoot: 'dist/miniprogram-development/' }));
  await writeFile(join(root, 'project.private.config.json'), JSON.stringify({ appid: PRIVATE_APPID }));
  await writeFile(cli, '#!/bin/sh\n');
  await chmod(cli, 0o755);
  await writeFile(plist, '<plist/>');
  return { root, cli, plist, privateConfig: join(root, 'project.private.config.json') };
}

function result(overrides = {}) {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, signal: null, ...overrides };
}

function runnerFor({ resultForPhase = null, throws = null, trace = [] } = {}) {
  return async (command, args, options) => {
    trace.push({ command, args, options });
    const active = command === 'git' ? 'appid' : command === '/usr/libexec/PlistBuddy' ? 'version' : args[0] === 'run' ? 'build' : args[0] === 'islogin' ? 'login' : args[0] === 'open' ? 'open' : 'automation';
    if (throws === active) throw new Error(SESSION_SENTINEL);
    if (resultForPhase?.phase === active) return resultForPhase.result;
    if (active === 'version') return result({ stdout: '2.01.2510290\n' });
    if (active === 'login') return result({ stdout: '' }); // no affirmative fixture was observed; fail closed
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

test('all public failure messages are explicit and safe', () => {
  assert.deepEqual(Object.keys(messages), codes);
  for (const code of codes) {
    const error = new WeChatEnvironmentError(code, messages[code]);
    assert.equal(error.name, 'WeChatEnvironmentError');
    assert.equal('cause' in error, false);
  }
});

test('validates CLI and port before commands', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const options of [
    { env: {}, port: PORT }, { env: { WECHAT_DEVTOOLS_CLI: 'relative' }, port: PORT },
    { env: { WECHAT_DEVTOOLS_CLI: f.cli }, port: 0 }, { env: { WECHAT_DEVTOOLS_CLI: f.cli }, port: '9.2' }
  ]) {
    const trace = [];
    await expectFailure(() => checkWechatDevTools({ runner: runnerFor({ trace }), repoRoot: f.root, platform: 'darwin', output() {}, ...options }), options.port === PORT ? 'WECHAT_CLI_INVALID' : 'WECHAT_AUTOMATION_FAILED');
    assert.deepEqual(trace, []);
  }
});

test('maps validation boundaries and prevents later commands', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const cases = [
    ['version', 'WECHAT_VERSION_UNAVAILABLE'], ['appid', 'WECHAT_APPID_REQUIRED'],
    ['build', 'WECHAT_BUILD_FAILED'], ['login', 'WECHAT_LOGIN_REQUIRED']
  ];
  for (const [phase, code] of cases) {
    const trace = [];
    await expectFailure(() => checkWechatDevTools({ runner: runnerFor({ resultForPhase: { result: result({ exitCode: 1, stderr: SESSION_SENTINEL }), phase }, trace }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin', output() {} }), code);
    assert.equal(trace.some((call) => call.args[0] === 'auto') && phase !== 'automation', false);
  }
});

test('rejects blank or malformed bundle versions before the build', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const stdout of ['', `${SESSION_SENTINEL}\n`]) {
    const trace = [];
    await expectFailure(() => checkWechatDevTools({ runner: runnerFor({ resultForPhase: { phase: 'version', result: result({ stdout }) }, trace }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin', output() {} }), 'WECHAT_VERSION_UNAVAILABLE');
    assert.equal(trace.some((call) => call.args[0] === 'run'), false);
  }
});

test('maps thrown runner, timeout, signal, and overflow at command boundaries', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const phase of ['build', 'login']) {
    const expected = phase === 'build' ? 'WECHAT_BUILD_FAILED' : 'WECHAT_LOGIN_REQUIRED';
    for (const failure of [null, result({ timedOut: true }), result({ signal: 'SIGTERM' }), result({ stderr: SESSION_SENTINEL, exitCode: 1 })]) {
      const trace = [];
      await expectFailure(() => checkWechatDevTools({ runner: runnerFor({ throws: failure ? null : phase, resultForPhase: failure ? { phase, result: failure } : null, trace }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin', output() {} }), expected);
      assert.equal(trace.some((call) => call.args[0] === 'auto') && phase !== 'automation', false);
    }
  }
});

test('fail-closed login parser rejects empty, false, malformed, ambiguous and stderr shapes', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  for (const login of [result(), result({ stdout: '{"islogin":false}' }), result({ stdout: '{' }), result({ stdout: 'yes' }), result({ stderr: SESSION_SENTINEL })]) {
    await expectFailure(() => checkWechatDevTools({ runner: runnerFor({ resultForPhase: { phase: 'login', result: login } }), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin', output() {} }), 'WECHAT_LOGIN_REQUIRED');
  }
});

test('safe events and errors never expose repository, AppID, CLI, or child-output sentinels', async (t) => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const events = [];
  await expectFailure(() => checkWechatDevTools({ runner: runnerFor(), env: { WECHAT_DEVTOOLS_CLI: f.cli }, repoRoot: f.root, port: PORT, platform: 'darwin', output: (event) => events.push(event) }), 'WECHAT_LOGIN_REQUIRED');
  const rendered = JSON.stringify(events);
  for (const secret of [PRIVATE_APPID, REPO_SENTINEL, SESSION_SENTINEL]) assert.doesNotMatch(rendered, new RegExp(secret));
  assert.deepEqual(events.map(({ step, status }) => [step, status]), [['appid', 'passed'], ['version', 'passed'], ['validate', 'passed'], ['build', 'passed']]);
});

test('default runner normalizes a missing executable without a raw Node error', async () => {
  const normalized = await createDefaultRunner()('/definitely/missing/wechat-cli', [], { cwd: process.cwd(), timeoutMs: 1, maxBufferBytes: 1 });
  assert.deepEqual(Object.keys(normalized).sort(), ['exitCode', 'signal', 'stderr', 'stdout', 'timedOut']);
  assert.equal(normalized.exitCode, 1);
  assert.equal(normalized.signal, null);
});

test('parseArgs rejects every malformed port shape', () => {
  for (const argv of [[], ['--port'], ['--port', '1', '--port', '2'], ['--port', '1', 'extra'], ['--port', '0'], ['--port', '-1'], ['--port', '1.5'], ['--port', '999999999999999999999'], ['--port', 'abc']]) {
    assert.throws(() => parseArgs(argv), (error) => error.code === 'WECHAT_AUTOMATION_FAILED' && error.message === messages.WECHAT_AUTOMATION_FAILED);
  }
  assert.deepEqual(parseArgs(['--port', '9420']), { port: 9420 });
});

test('main serializes only one compact safe failure object', async () => {
  let stdout = ''; let stderr = '';
  const exitCode = await main({ argv: ['--port', 'x'], env: {}, cwd: '/unused', runner: runnerFor(), writeOut: (text) => { stdout += text; }, writeErr: (text) => { stderr += text; } });
  assert.equal(exitCode, 1); assert.equal(stdout, '');
  assert.deepEqual(JSON.parse(stderr), { ok: false, code: 'WECHAT_AUTOMATION_FAILED', message: messages.WECHAT_AUTOMATION_FAILED });
  assert.equal(stderr.endsWith('\n'), true);
});

test('real entry point rejects invalid arguments without a stack', async () => {
  const child = await new Promise((resolve, reject) => execFile(process.execPath, [moduleUrl.pathname, '--port', 'nope'], { encoding: 'utf8' }, (error, stdout, stderr) => error ? resolve({ error, stdout, stderr }) : reject(new Error('expected failure'))));
  assert.equal(child.error.code, 1); assert.equal(child.stdout, '');
  assert.deepEqual(JSON.parse(child.stderr), { ok: false, code: 'WECHAT_AUTOMATION_FAILED', message: messages.WECHAT_AUTOMATION_FAILED });
  assert.doesNotMatch(child.stderr, /WeChatEnvironmentError|at .*check-wechat/);
});
