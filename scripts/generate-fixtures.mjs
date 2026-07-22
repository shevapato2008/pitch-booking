import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryDirectory = fileURLToPath(new URL('../', import.meta.url));
const examplesDirectory = path.join(repositoryDirectory, 'contracts/examples');
const fixturesDirectory = path.join(repositoryDirectory, 'artifacts/ui/fixtures');
const allowList = new Map([
  ['venue-primary.json', 'venue-ready.json'],
  ['availability-ready.json', 'slots-ready.json'],
  ['availability-empty.json', 'slots-empty.json'],
]);

function resolveSelection(argument) {
  if (!argument) return [...allowList.keys()];
  const filename = path.basename(argument);
  if (filename.startsWith('error-')) {
    throw new Error('error responses belong in scenarios');
  }
  if (!allowList.has(filename)) {
    throw new Error(`fixture source is not allow-listed: ${argument}`);
  }
  const resolved = path.resolve(repositoryDirectory, argument);
  const canonicalSource = path.join(examplesDirectory, filename);
  if (argument !== filename && resolved !== canonicalSource) {
    throw new Error(`fixture source is not allow-listed: ${argument}`);
  }
  return [filename];
}

async function main() {
  const [, , ...arguments_] = process.argv;
  if (arguments_.length > 1) throw new Error('pass at most one success example path or name');
  const selected = resolveSelection(arguments_[0]);
  await mkdir(fixturesDirectory, { recursive: true });

  for (const filename of selected) {
    const source = JSON.parse(await readFile(path.join(examplesDirectory, filename), 'utf8'));
    const output = `${JSON.stringify(source, null, 2)}\n`;
    await writeFile(path.join(fixturesDirectory, allowList.get(filename)), output, 'utf8');
  }
  console.log(`Generated ${selected.length} fixture${selected.length === 1 ? '' : 's'}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
