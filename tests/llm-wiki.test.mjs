import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const wikiRoot = resolve(repositoryRoot, 'docs/llm-wiki/wechat-miniprogram');
const environmentGuide = resolve(wikiRoot, 'environment-setup.md');

function read(relativePath) {
  return readFileSync(resolve(wikiRoot, relativePath), 'utf8');
}

function section(markdown, heading) {
  const pattern = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'm');
  const match = markdown.match(pattern);
  assert.ok(match, `missing section: ${heading}`);
  return match[1];
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(file);
    return entry.isFile() && entry.name.endsWith('.md') ? [file] : [];
  });
}

function localDestinations(markdown) {
  const inline = [...markdown.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)]
    .map((match) => (match[1] ?? match[2]).trim());
  const definitions = [...markdown.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)]
    .map((match) => (match[1] ?? match[2]).trim());
  return [...inline, ...definitions];
}

function validateLocalDestination(rawDestination, source) {
  if (!rawDestination || rawDestination.startsWith('#')) return;
  assert.equal(/^file:/i.test(rawDestination), false, `file URI is not allowed: ${source}`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawDestination)) return;

  const withoutSuffix = rawDestination.split(/[?#]/, 1)[0];
  let target;
  try {
    target = decodeURIComponent(withoutSuffix);
  } catch {
    assert.fail(`malformed percent encoding: ${rawDestination} in ${source}`);
  }
  assert.equal(isAbsolute(target), false, `absolute local target: ${rawDestination} in ${source}`);
  const resolved = resolve(source, '..', target);
  const fromRoot = relative(repositoryRoot, resolved);
  assert.equal(fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || fromRoot === '', false, `outside repository: ${rawDestination} in ${source}`);
  assert.equal(existsSync(resolved) && statSync(resolved).isFile(), true, `missing local target: ${rawDestination} in ${source}`);
}

test('inline Markdown destinations exclude optional titles', () => {
  assert.deepEqual(
    localDestinations('[plain](README.md "Read me") ![angle](<assets/icon.svg> \'Icon\')'),
    ['README.md', 'assets/icon.svg'],
  );
});

test('reference Markdown destinations participate in local link validation', () => {
  const destinations = localDestinations('[environment]: environment-setup.md#WX-ENV-003');
  assert.deepEqual(destinations, ['environment-setup.md#WX-ENV-003']);
  assert.doesNotThrow(() => validateLocalDestination(destinations[0], environmentGuide));
});

test('local link validation strips query and fragment suffixes before percent-decoding paths', () => {
  assert.doesNotThrow(() => validateLocalDestination('README%2Emd?source=wiki#route', environmentGuide));
});

test('local link validation rejects file URIs before skipping general URI schemes', () => {
  assert.throws(() => validateLocalDestination('FiLe:README.md', environmentGuide), /file URI is not allowed/);
});

test('local link validation rejects malformed encoding, absolute, outside, and missing local targets', () => {
  for (const [destination, expected] of [
    ['README%ZZ.md', /malformed percent encoding/],
    ['%2Fetc%2Fhosts', /absolute local target/],
    ['../../../../../../outside.md', /outside repository/],
    ['does-not-exist.md', /missing local target/],
  ]) {
    assert.throws(() => validateLocalDestination(destination, environmentGuide), expected);
  }
});

test('WX-ENV guide has one required section per stable environment knowledge ID', () => {
  const markdown = readFileSync(environmentGuide, 'utf8');
  for (const id of ['WX-ENV-001', 'WX-ENV-002', 'WX-ENV-003', 'WX-ENV-004', 'WX-ENV-005', 'WX-ENV-006']) {
    assert.equal((markdown.match(new RegExp(`^## ${id}：`, 'gm')) ?? []).length, 1, `${id} must have exactly one level-2 heading`);
  }
});

test('WX-ENV guide requires native evidence and makes CLI selection and output boundaries explicit', () => {
  const markdown = readFileSync(environmentGuide, 'utf8');
  const login = section(markdown, 'WX-ENV-002：首次启动与人工登录');
  const cli = section(markdown, 'WX-ENV-003：定位并配置 CLI');
  const build = section(markdown, 'WX-ENV-005：导入并构建本项目');

  assert.doesNotMatch(login, /若需要留存机器证据/);
  assert.match(login, /必须.*\.superpowers\/run-evidence/);
  assert.match(login, /现有 scaffold 页面.*成功编译并渲染/s);
  assert.match(login, /确认没有 WXML、WXSS 或 Console 错误/);
  assert.match(cli, /select/);
  assert.match(cli, /realpath/);
  assert.match(cli, /-f.*-x/);
  assert.match(cli, /<local-cli-path>/);
  assert.match(cli, /configure_wechat_cli_from_path/);
  assert.match(cli, /configure_wechat_cli_from_path '<local-cli-path>'/);
  assert.match(cli, /realpath "\$selected_cli"/);
  assert.match(build, /dist\/miniprogram-development\//);
  assert.match(build, /dist\/miniprogram-production\//);
  assert.match(build, /dist\/miniprogram-development\/.*preview.*Fixture.*Scenario/s);
  assert.match(build, /dist\/miniprogram-production\/.*排除.*preview.*Fixture.*Scenario/s);
  assert.match(build, /两者.*不是.*项目.*导入根/s);
});

test('Mac zero-to-CLI installation, login, and configuration route to the environment guide', () => {
  const readme = read('README.md');
  assert.match(readme, /Mac 从零安装、登录和配置 CLI/);
  assert.match(readme, /\[environment-setup\.md\]\(environment-setup\.md\)/);
});

test('testing flow delegates environment setup once without duplicating setup commands', () => {
  const testing = read('testing-release.md');
  const firstParagraph = section(testing, 'WX-TEST-001：Mac 开发循环')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean);
  assert.match(firstParagraph, /\[environment-setup\.md\]\(environment-setup\.md\)/);

  for (const token of ['brew install', 'WECHAT_DEVTOOLS_CLI', 'cli open', 'cli auto', 'cli islogin', '--port']) {
    assert.equal(testing.includes(token), false, `testing-release.md must not duplicate ${token}`);
  }
});

test('sources index contains the exact official environment URLs', () => {
  const destinations = localDestinations(read('sources.md'));
  for (const expected of [
    'https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html',
    'https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html',
    'https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html',
  ]) assert.ok(destinations.includes(expected), `missing official source: ${expected}`);
});

test('all wiki-local Markdown link and image targets exist and remain inside the repository', () => {
  for (const source of markdownFiles(wikiRoot)) {
    for (const rawDestination of localDestinations(readFileSync(source, 'utf8'))) {
      validateLocalDestination(rawDestination, source);
    }
  }
});
