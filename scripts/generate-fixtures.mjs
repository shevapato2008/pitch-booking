import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateContract } from './validate-contract.mjs';

const defaultRepositoryDirectory = fileURLToPath(new URL('../', import.meta.url));
const allowList = new Map([
  ['venue-primary.json', 'venue-ready.json'],
  ['availability-ready.json', 'slots-ready.json'],
  ['availability-empty.json', 'slots-empty.json'],
]);

function resolveSelection(argument, repositoryDirectory, examplesDirectory) {
  if (!argument) return [...allowList.keys()];
  const filename = path.basename(argument);
  if (filename.startsWith('error-')) throw new Error('error responses belong in scenarios');
  if (!allowList.has(filename)) throw new Error(`fixture source is not allow-listed: ${argument}`);
  const resolved = path.resolve(repositoryDirectory, argument);
  const canonicalSource = path.join(examplesDirectory, filename);
  if (argument !== filename && resolved !== canonicalSource) {
    throw new Error(`fixture source is not allow-listed: ${argument}`);
  }
  return [filename];
}

async function inspect(filename, context) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`${context} ${filename}: ${error.message}`);
  }
}

async function ensureSafeDirectoryTree(repositoryDirectory, relativeDirectory) {
  // This local build tool blocks static symlink escapes. Concurrent hostile path mutation
  // is outside its threat model; callers must not run it against an actively hostile tree.
  const repositoryStat = await inspect(repositoryDirectory, 'cannot inspect repository root');
  if (!repositoryStat?.isDirectory() || repositoryStat.isSymbolicLink()) {
    throw new Error(`repository root must be a real directory, not a symlink: ${repositoryDirectory}`);
  }
  const repositoryRealPath = await realpath(repositoryDirectory);
  let current = repositoryDirectory;
  for (const segment of relativeDirectory.split(path.sep)) {
    current = path.join(current, segment);
    let stat = await inspect(current, 'cannot inspect fixture directory');
    if (!stat) {
      await mkdir(current);
      stat = await inspect(current, 'cannot verify created fixture directory');
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`fixture directory must be a real directory, not a symlink: ${current}`);
    }
    const currentRealPath = await realpath(current);
    if (currentRealPath !== repositoryRealPath && !currentRealPath.startsWith(`${repositoryRealPath}${path.sep}`)) {
      throw new Error(`fixture directory escapes repository root: ${current}`);
    }
  }
  return current;
}

async function readNormalizedSource(sourcePath) {
  const stat = await inspect(sourcePath, 'cannot inspect fixture source');
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`fixture source must be a regular file, not a symlink: ${sourcePath}`);
  }
  try {
    const value = JSON.parse(await readFile(sourcePath, 'utf8'));
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch (error) {
    throw new Error(`fixture source ${sourcePath}: ${error.message}`);
  }
}

async function verifyDestinations(fixturesDirectory) {
  const allowedDestinations = new Set(allowList.values());
  for (const entry of await readdir(fixturesDirectory)) {
    if (!allowedDestinations.has(entry)) {
      throw new Error(`unexpected fixture destination entry: ${path.join(fixturesDirectory, entry)}`);
    }
    const destinationPath = path.join(fixturesDirectory, entry);
    const stat = await inspect(destinationPath, 'cannot inspect fixture destination');
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error(`fixture destination must be a regular file, not a symlink: ${destinationPath}`);
    }
  }
}

export async function generateFixtures({
  repositoryDirectory = defaultRepositoryDirectory,
  argument,
  publishFile = rename,
  removeBackupFile = unlink,
  restoreBackupFile = rename,
  removeTemporaryFile = unlink,
} = {}) {
  repositoryDirectory = path.resolve(repositoryDirectory);
  const examplesDirectory = path.join(repositoryDirectory, 'contracts/examples');
  const contractPath = path.join(repositoryDirectory, 'contracts/openapi.yaml');
  const selected = resolveSelection(argument, repositoryDirectory, examplesDirectory);

  await validateContract(contractPath);
  const prepared = [];
  for (const filename of selected) {
    const sourcePath = path.join(examplesDirectory, filename);
    prepared.push({
      destinationName: allowList.get(filename),
      output: await readNormalizedSource(sourcePath),
      sourcePath,
    });
  }

  const fixturesDirectory = await ensureSafeDirectoryTree(repositoryDirectory, 'artifacts/ui/fixtures');
  await verifyDestinations(fixturesDirectory);
  const stagedPaths = [];
  try {
    for (const fixture of prepared) {
      const stagedPath = path.join(
        fixturesDirectory,
        `.fixture-stage-${process.pid}-${randomUUID()}-${fixture.destinationName}`,
      );
      try {
        await writeFile(stagedPath, fixture.output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      } catch (error) {
        throw new Error(`cannot stage fixture ${fixture.sourcePath} -> ${stagedPath}: ${error.message}`);
      }
      stagedPaths.push({
        stagedPath,
        destinationPath: path.join(fixturesDirectory, fixture.destinationName),
        backupPath: path.join(fixturesDirectory, `.fixture-backup-${process.pid}-${randomUUID()}-${fixture.destinationName}`),
        backedUp: false,
        published: false,
      });
    }
  } catch (error) {
    const cleanupErrors = [];
    for (const item of stagedPaths) {
      try {
        await removeTemporaryFile(item.stagedPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') cleanupErrors.push(`${item.stagedPath}: ${cleanupError.message}`);
      }
    }
    const suffix = cleanupErrors.length > 0 ? `; cleanup failed: ${cleanupErrors.join('; ')}` : '';
    throw new Error(`${error.message}${suffix}`);
  }

  let primaryError;
  try {
    for (const item of stagedPaths) {
      const destinationStat = await inspect(item.destinationPath, 'cannot inspect fixture destination before rename');
      if (destinationStat && (!destinationStat.isFile() || destinationStat.isSymbolicLink())) {
        throw new Error(`fixture destination must be a regular file, not a symlink: ${item.destinationPath}`);
      }
      if (destinationStat) {
        await rename(item.destinationPath, item.backupPath);
        item.backedUp = true;
      }
    }
    for (const [index, item] of stagedPaths.entries()) {
      try {
        await publishFile(item.stagedPath, item.destinationPath, index);
        item.published = true;
      } catch (error) {
        throw new Error(`cannot publish fixture ${item.stagedPath} -> ${item.destinationPath}: ${error.message}`);
      }
    }
  } catch (error) {
    primaryError = error;
  }

  if (primaryError) {
    const rollbackErrors = [];
    for (const item of [...stagedPaths].reverse()) {
      try {
        if (item.published) {
          await unlink(item.destinationPath);
          item.published = false;
        }
        if (item.backedUp) {
          await restoreBackupFile(item.backupPath, item.destinationPath);
          item.backedUp = false;
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${item.destinationPath}: ${rollbackError.message}`);
      }
    }
    const cleanupErrors = [];
    for (const item of stagedPaths) {
      try {
        await removeTemporaryFile(item.stagedPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') cleanupErrors.push(`${item.stagedPath}: ${cleanupError.message}`);
      }
    }
    const rollbackSuffix = rollbackErrors.length > 0 ? `; rollback failed: ${rollbackErrors.join('; ')}` : '';
    const cleanupSuffix = cleanupErrors.length > 0 ? `; cleanup failed: ${cleanupErrors.join('; ')}` : '';
    throw new Error(`${primaryError.message}${rollbackSuffix}${cleanupSuffix}`);
  }

  // Commit point: every destination now contains the new complete set. From here onward,
  // failures are post-commit cleanup errors and must never roll destinations back.
  const backupCleanupErrors = [];
  for (const item of stagedPaths) {
    if (item.backedUp) {
      try {
        await removeBackupFile(item.backupPath);
        item.backedUp = false;
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          backupCleanupErrors.push(`${item.backupPath}: ${cleanupError.message}`);
        }
      }
    }
  }
  const temporaryCleanupErrors = [];
  for (const item of stagedPaths) {
    try {
      await removeTemporaryFile(item.stagedPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        temporaryCleanupErrors.push(`${item.stagedPath}: ${cleanupError.message}`);
      }
    }
  }
  if (backupCleanupErrors.length > 0 || temporaryCleanupErrors.length > 0) {
    const diagnostics = [];
    if (backupCleanupErrors.length > 0) diagnostics.push(`backup cleanup failed: ${backupCleanupErrors.join('; ')}`);
    if (temporaryCleanupErrors.length > 0) diagnostics.push(`temporary cleanup failed: ${temporaryCleanupErrors.join('; ')}`);
    throw new Error(`fixture transaction committed; ${diagnostics.join('; ')}`);
  }
  return selected.length;
}

async function main() {
  const [, , ...arguments_] = process.argv;
  if (arguments_.length > 1) throw new Error('pass at most one success example path or name');
  const count = await generateFixtures({ argument: arguments_[0] });
  console.log(`Generated ${count} fixture${count === 1 ? '' : 's'}.`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
