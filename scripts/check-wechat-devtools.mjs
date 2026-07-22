import { execFile } from 'node:child_process';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BUFFER_BYTES = 1024 * 1024;
const CLI_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 120_000;
const EXPECTED_MINIPROGRAM_ROOT = 'dist/miniprogram-development/';
const MESSAGES = Object.freeze({
  WECHAT_CLI_INVALID: 'WeChat DevTools CLI must be an absolute executable file',
  WECHAT_VERSION_UNAVAILABLE: 'WeChat DevTools bundle version is unavailable',
  WECHAT_APPID_REQUIRED: 'A private WeChat AppID is required',
  WECHAT_BUILD_FAILED: 'WeChat development build failed',
  WECHAT_LOGIN_REQUIRED: 'WeChat DevTools login is required',
  WECHAT_OPEN_FAILED: 'WeChat DevTools could not open the project',
  WECHAT_PORT_MISMATCH: 'quit Developer Tools, then rerun with one port',
  WECHAT_AUTOMATION_FAILED: 'WeChat DevTools automation could not start'
});

export class WeChatEnvironmentError extends Error {
  constructor(code, safeMessage = MESSAGES[code]) {
    super(safeMessage);
    this.name = 'WeChatEnvironmentError';
    this.code = code;
  }
}

function fail(code) {
  throw new WeChatEnvironmentError(code);
}

function isRunnerResult(value) {
  return Boolean(value)
    && typeof value === 'object'
    && Number.isInteger(value.exitCode)
    && typeof value.stdout === 'string'
    && typeof value.stderr === 'string'
    && typeof value.timedOut === 'boolean'
    && (value.signal === null || typeof value.signal === 'string');
}

function commandFailed(result, maxBufferBytes) {
  return !isRunnerResult(result)
    || result.exitCode !== 0
    || result.timedOut
    || result.signal !== null
    || Buffer.byteLength(result.stdout) > maxBufferBytes
    || Buffer.byteLength(result.stderr) > maxBufferBytes;
}

function appBundleFor(cliPath) {
  const parts = cliPath.split('/');
  const appIndex = parts.length - 4;
  if (appIndex < 1
    || !parts[appIndex].endsWith('.app')
    || parts.at(-3) !== 'Contents'
    || parts.at(-2) !== 'MacOS'
    || parts.at(-1) === ''
    || parts.slice(1, appIndex).some((part) => part.endsWith('.app'))) return null;
  return parts.slice(0, appIndex + 1).join('/');
}

function runnerResult(error, stdout = '', stderr = '') {
  const timedOut = error?.code === 'ETIMEDOUT' || Boolean(error?.killed && error?.signal === 'SIGTERM');
  return Object.freeze({
    exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
    stdout: String(stdout),
    stderr: String(stderr),
    timedOut,
    signal: typeof error?.signal === 'string' ? error.signal : null
  });
}

function safeErrorCode(error) {
  try {
    return error instanceof WeChatEnvironmentError && typeof error.code === 'string' && Object.hasOwn(MESSAGES, error.code)
      ? error.code
      : 'WECHAT_AUTOMATION_FAILED';
  } catch {
    return 'WECHAT_AUTOMATION_FAILED';
  }
}

function portIsValid(port) {
  return typeof port === 'number' && Number.isSafeInteger(port) && port > 0;
}

function snapshotEnvironmentField(env, field, code) {
  try {
    if (!env || (typeof env !== 'object' && typeof env !== 'function')) return undefined;
    return env[field];
  } catch {
    fail(code);
  }
}

function snapshotRepoRoot(repoRoot) {
  if (typeof repoRoot !== 'string'
    || repoRoot === ''
    || !path.isAbsolute(repoRoot)
    || repoRoot.split(path.sep).some((part) => part === '.' || part === '..')) fail('WECHAT_BUILD_FAILED');
  return repoRoot;
}

function loginIsAffirmative(stdout, stderr) {
  const lines = [stdout, stderr].flatMap((channel) => channel.split(/\r?\n/));
  return lines.includes('{"login":true}') && !lines.includes('{"login":false}');
}

function shortVersion(stdout, stderr) {
  const match = stderr === '' && stdout.match(/^(\d+\.\d+\.\d+)\r?\n$/);
  return match?.[1] ?? null;
}

function isPortMismatch(stdout, stderr, requestedPort) {
  const requested = String(requestedPort).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const current = '(?:[1-9][0-9]*)';
  const zh = new RegExp(`^✖ IDE 已启动并在监听 http://127\\.0\\.0\\.1:(${current})，需要重启才能使用端口 (${requested})$`);
  const en = new RegExp(`^✖ IDE server has started on http://127\\.0\\.0\\.1:(${current}) and must be restarted on port (${requested}) first$`);
  return [stdout, stderr].some((channel) => channel.split(/\r?\n/).some((line) => {
    const match = line.match(zh) ?? line.match(en);
    return match !== null && match[1] !== String(requestedPort) && match[2] === String(requestedPort);
  }));
}

function emit(output, event, code) {
  try {
    output(Object.freeze(event));
  } catch {
    fail(code);
  }
}

async function invoke(runner, command, args, options, code, output, step, port) {
  let value;
  try {
    value = await runner(command, args, options);
  } catch {
    emit(output, { step, status: 'failed', code }, code);
    fail(code);
  }
  let result;
  try {
    const snapshot = {
      exitCode: value.exitCode,
      stdout: value.stdout,
      stderr: value.stderr,
      timedOut: value.timedOut,
      signal: value.signal
    };
    if (isRunnerResult(snapshot)) result = Object.freeze(snapshot);
  } catch {
    emit(output, { step, status: 'failed', code }, code);
    fail(code);
  }
  if (!result) {
    emit(output, { step, status: 'failed', code }, code);
    fail(code);
  }
  if (port !== undefined && isPortMismatch(result.stdout, result.stderr, port)) {
    emit(output, { step, status: 'failed', code: 'WECHAT_PORT_MISMATCH' }, 'WECHAT_PORT_MISMATCH');
    fail('WECHAT_PORT_MISMATCH');
  }
  if (commandFailed(result, options.maxBufferBytes)) {
    emit(output, { step, status: 'failed', code }, code);
    fail(code);
  }
  return result;
}

export function createDefaultRunner() {
  return (command, args, options) => new Promise((resolve) => {
    try {
      execFile(command, args, { cwd: options.cwd, encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: options.maxBufferBytes }, (error, stdout = '', stderr = '') => {
        resolve(runnerResult(error, stdout, stderr));
      });
    } catch (error) {
      resolve(runnerResult(error));
    }
  });
}

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--port' || typeof argv[1] !== 'string' || !/^[1-9][0-9]*$/.test(argv[1])) fail('WECHAT_AUTOMATION_FAILED');
  const port = Number(argv[1]);
  if (!Number.isSafeInteger(port) || port <= 0) fail('WECHAT_AUTOMATION_FAILED');
  return Object.freeze({ port });
}

export async function checkWechatDevTools({ runner = createDefaultRunner(), env = {}, repoRoot, port, platform = process.platform, output = () => {} } = {}) {
  if (!portIsValid(port)) fail('WECHAT_AUTOMATION_FAILED');
  if (platform !== 'darwin') fail('WECHAT_CLI_INVALID');
  const cliPath = snapshotEnvironmentField(env, 'WECHAT_DEVTOOLS_CLI', 'WECHAT_CLI_INVALID');
  if (typeof cliPath !== 'string' || !cliPath.startsWith('/') || cliPath.split('/').some((part) => part === '.' || part === '..')) fail('WECHAT_CLI_INVALID');
  let canonicalCliPath;
  let cliStat;
  try {
    cliStat = await stat(cliPath);
    await access(cliPath, constants.X_OK);
    canonicalCliPath = await realpath(cliPath);
    cliStat = await stat(canonicalCliPath);
    await access(canonicalCliPath, constants.X_OK);
  } catch {
    fail('WECHAT_CLI_INVALID');
  }
  if (!cliStat.isFile()) fail('WECHAT_CLI_INVALID');
  const bundle = appBundleFor(canonicalCliPath);
  if (!bundle) fail('WECHAT_VERSION_UNAVAILABLE');

  const safeRepoRoot = snapshotRepoRoot(repoRoot);
  const privateConfigPath = `${safeRepoRoot}/project.private.config.json`;
  const projectConfigPath = `${safeRepoRoot}/project.config.json`;
  const cliOptions = Object.freeze({ cwd: safeRepoRoot, timeoutMs: CLI_TIMEOUT_MS, maxBufferBytes: MAX_BUFFER_BYTES });
  const buildOptions = Object.freeze({ cwd: safeRepoRoot, timeoutMs: BUILD_TIMEOUT_MS, maxBufferBytes: MAX_BUFFER_BYTES });

  await invoke(runner, 'git', ['check-ignore', '--quiet', privateConfigPath], cliOptions, 'WECHAT_APPID_REQUIRED', output, 'appid');
  let privateConfig;
  try {
    privateConfig = JSON.parse(await readFile(privateConfigPath, 'utf8'));
  } catch {
    fail('WECHAT_APPID_REQUIRED');
  }
  if (!privateConfig || typeof privateConfig.appid !== 'string' || privateConfig.appid.trim() === '') fail('WECHAT_APPID_REQUIRED');
  emit(output, { step: 'appid', status: 'passed', code: 'APPID_CONFIGURED' }, 'WECHAT_APPID_REQUIRED');

  const versionResult = await invoke(runner, '/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', `${bundle}/Contents/Info.plist`], cliOptions, 'WECHAT_VERSION_UNAVAILABLE', output, 'version');
  const version = shortVersion(versionResult.stdout, versionResult.stderr);
  if (version === null) fail('WECHAT_VERSION_UNAVAILABLE');
  emit(output, { step: 'version', status: 'passed', version }, 'WECHAT_VERSION_UNAVAILABLE');

  let projectConfig;
  try {
    projectConfig = JSON.parse(await readFile(projectConfigPath, 'utf8'));
  } catch {
    fail('WECHAT_BUILD_FAILED');
  }
  if (!projectConfig || projectConfig.miniprogramRoot !== EXPECTED_MINIPROGRAM_ROOT) fail('WECHAT_BUILD_FAILED');
  emit(output, { step: 'validate', status: 'passed' }, 'WECHAT_BUILD_FAILED');

  await invoke(runner, 'npm', ['run', 'build:miniprogram:development'], buildOptions, 'WECHAT_BUILD_FAILED', output, 'build');
  emit(output, { step: 'build', status: 'passed' }, 'WECHAT_BUILD_FAILED');
  const cliArgs = ['--project', safeRepoRoot, '--port', String(port)];
  const login = await invoke(runner, canonicalCliPath, ['islogin', ...cliArgs], cliOptions, 'WECHAT_LOGIN_REQUIRED', output, 'login', port);
  if (!loginIsAffirmative(login.stdout, login.stderr)) fail('WECHAT_LOGIN_REQUIRED');
  emit(output, { step: 'login', status: 'passed' }, 'WECHAT_LOGIN_REQUIRED');
  await invoke(runner, canonicalCliPath, ['open', ...cliArgs], cliOptions, 'WECHAT_OPEN_FAILED', output, 'open', port);
  emit(output, { step: 'open', status: 'passed' }, 'WECHAT_OPEN_FAILED');
  await invoke(runner, canonicalCliPath, ['auto', ...cliArgs, '--trust-project'], cliOptions, 'WECHAT_AUTOMATION_FAILED', output, 'automation', port);
  emit(output, { step: 'automation', status: 'passed' }, 'WECHAT_AUTOMATION_FAILED');
  return Object.freeze({ ok: true, version, checks: Object.freeze(['APPID_CONFIGURED', 'PROJECT_CONFIGURED', 'BUILD_COMPLETED', 'LOGIN_CONFIRMED', 'PROJECT_OPENED', 'AUTOMATION_ENABLED']) });
}

export async function main({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), runner = createDefaultRunner(), writeOut = (text) => process.stdout.write(text), writeErr = (text) => process.stderr.write(text) } = {}) {
  try {
    const { port } = parseArgs(argv);
    const report = await checkWechatDevTools({ runner, env, repoRoot: cwd, port, platform: process.platform, output: () => {} });
    writeOut(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    const code = safeErrorCode(error);
    try {
      writeErr(`${JSON.stringify({ ok: false, code, message: MESSAGES[code] })}\n`);
    } catch {}
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main({}).then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
