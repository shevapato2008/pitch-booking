import { execFile } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
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

function portIsValid(port) {
  return typeof port === 'number' && Number.isSafeInteger(port) && port > 0;
}

function commandResultError(result) {
  return !result || result.exitCode !== 0 || result.timedOut || result.signal !== null;
}

function noPortMismatchSignature() {
  // The installed 2.01.2510290 CLI observation recorded no port-mismatch output.
  // Keep this closed until a reviewed, sanitized version-labelled fixture exists.
  return false;
}

function loginIsAffirmative() {
  // No affirmative islogin shape was observable in the characterization evidence.
  return false;
}

function appBundleFor(cliPath) {
  const marker = '.app/Contents/MacOS/';
  const index = cliPath.indexOf(marker);
  return index === -1 ? null : cliPath.slice(0, index + 4);
}

function emit(output, event, code) {
  try {
    output(Object.freeze(event));
  } catch {
    fail(code);
  }
}

async function invoke(runner, command, args, options, code, output, step) {
  let value;
  try {
    value = await runner(command, args, options);
  } catch {
    emit(output, { step, status: 'failed', code }, code);
    fail(code);
  }
  if (noPortMismatchSignature(value?.stdout, value?.stderr)) {
    emit(output, { step, status: 'failed', code: 'WECHAT_PORT_MISMATCH' }, 'WECHAT_PORT_MISMATCH');
    fail('WECHAT_PORT_MISMATCH');
  }
  if (commandResultError(value)) {
    emit(output, { step, status: 'failed', code }, code);
    fail(code);
  }
  return value;
}

export function createDefaultRunner() {
  return (command, args, options) => new Promise((resolve) => {
    execFile(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: options.maxBufferBytes
    }, (error, stdout = '', stderr = '') => {
      const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
      resolve({
        exitCode: code,
        stdout: String(stdout),
        stderr: String(stderr),
        timedOut: error?.code === 'ETIMEDOUT',
        signal: typeof error?.signal === 'string' ? error.signal : null
      });
    });
  });
}

export function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== '--port' || !/^[1-9][0-9]*$/.test(argv[1])) {
    fail('WECHAT_AUTOMATION_FAILED');
  }
  const port = Number(argv[1]);
  if (!Number.isSafeInteger(port) || port <= 0) fail('WECHAT_AUTOMATION_FAILED');
  return Object.freeze({ port });
}

export async function checkWechatDevTools({ runner = createDefaultRunner(), env = {}, repoRoot, port, platform = process.platform, output = () => {} } = {}) {
  if (!portIsValid(port)) fail('WECHAT_AUTOMATION_FAILED');
  const cliPath = env.WECHAT_DEVTOOLS_CLI;
  if (platform !== 'darwin' || typeof cliPath !== 'string' || !cliPath.startsWith('/')) fail('WECHAT_CLI_INVALID');
  let cliStat;
  try {
    cliStat = await stat(cliPath);
    await access(cliPath, constants.X_OK);
  } catch {
    fail('WECHAT_CLI_INVALID');
  }
  if (!cliStat.isFile()) fail('WECHAT_CLI_INVALID');
  const bundle = appBundleFor(cliPath);
  if (!bundle) fail('WECHAT_VERSION_UNAVAILABLE');
  const privateConfigPath = `${repoRoot}/project.private.config.json`;
  const projectConfigPath = `${repoRoot}/project.config.json`;
  const baseOptions = Object.freeze({ cwd: repoRoot, timeoutMs: CLI_TIMEOUT_MS, maxBufferBytes: MAX_BUFFER_BYTES });

  const ignored = await invoke(runner, 'git', ['check-ignore', '--quiet', privateConfigPath], baseOptions, 'WECHAT_APPID_REQUIRED', output, 'appid');
  if (commandResultError(ignored)) fail('WECHAT_APPID_REQUIRED');
  let privateConfig;
  try {
    privateConfig = JSON.parse(await readFile(privateConfigPath, 'utf8'));
  } catch {
    fail('WECHAT_APPID_REQUIRED');
  }
  if (!privateConfig || typeof privateConfig.appid !== 'string' || privateConfig.appid.trim() === '') fail('WECHAT_APPID_REQUIRED');
  emit(output, { step: 'appid', status: 'passed', code: 'APPID_CONFIGURED' }, 'WECHAT_APPID_REQUIRED');

  const versionResult = await invoke(runner, '/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', `${bundle}/Contents/Info.plist`], baseOptions, 'WECHAT_VERSION_UNAVAILABLE', output, 'version');
  const version = versionResult.stdout.trim();
  if (!/^[0-9]+(?:\.[0-9]+)+$/.test(version)) fail('WECHAT_VERSION_UNAVAILABLE');
  emit(output, { step: 'version', status: 'passed', version }, 'WECHAT_VERSION_UNAVAILABLE');

  let projectConfig;
  try {
    projectConfig = JSON.parse(await readFile(projectConfigPath, 'utf8'));
  } catch {
    fail('WECHAT_BUILD_FAILED');
  }
  if (!projectConfig || projectConfig.miniprogramRoot !== EXPECTED_MINIPROGRAM_ROOT) fail('WECHAT_BUILD_FAILED');
  emit(output, { step: 'validate', status: 'passed' }, 'WECHAT_BUILD_FAILED');

  const npmExecutable = typeof env.npmExecutable === 'string' && env.npmExecutable ? env.npmExecutable : 'npm';
  await invoke(runner, npmExecutable, ['run', 'build:miniprogram:development'], Object.freeze({ cwd: repoRoot, timeoutMs: BUILD_TIMEOUT_MS, maxBufferBytes: MAX_BUFFER_BYTES }), 'WECHAT_BUILD_FAILED', output, 'build');
  emit(output, { step: 'build', status: 'passed' }, 'WECHAT_BUILD_FAILED');
  const cliArgs = ['--project', repoRoot, '--port', String(port)];
  const login = await invoke(runner, cliPath, ['islogin', ...cliArgs], baseOptions, 'WECHAT_LOGIN_REQUIRED', output, 'login');
  if (!loginIsAffirmative(login.stdout, login.stderr)) fail('WECHAT_LOGIN_REQUIRED');
  emit(output, { step: 'login', status: 'passed' }, 'WECHAT_LOGIN_REQUIRED');
  await invoke(runner, cliPath, ['open', ...cliArgs], baseOptions, 'WECHAT_OPEN_FAILED', output, 'open');
  emit(output, { step: 'open', status: 'passed' }, 'WECHAT_OPEN_FAILED');
  await invoke(runner, cliPath, ['auto', ...cliArgs, '--trust-project'], baseOptions, 'WECHAT_AUTOMATION_FAILED', output, 'automation');
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
    const safe = error instanceof WeChatEnvironmentError ? error : new WeChatEnvironmentError('WECHAT_AUTOMATION_FAILED');
    writeErr(`${JSON.stringify({ ok: false, code: safe.code, message: safe.message })}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main({}).then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
