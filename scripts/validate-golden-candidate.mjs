import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const candidatePattern = new RegExp([
  "^artifacts", "ui", "golden", "candidates",
  "([a-f0-9]{40})",
  "([a-z0-9]+(?:-[a-z0-9]+)*)",
  "([a-z0-9]+(?:-[a-z0-9]+)*)\\.metadata\\.json$",
].join(sep === "\\" ? "\\\\" : "/"));

const requireRegularFile = (path) => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`candidate must be a regular non-symlink file: ${path}`);
  }
};

export const validateGoldenCandidate = (metadataPath, { repositoryRoot = process.cwd() } = {}) => {
  const root = resolve(repositoryRoot);
  const absoluteMetadataPath = resolve(metadataPath);
  const relativeMetadataPath = relative(root, absoluteMetadataPath);
  const match = candidatePattern.exec(relativeMetadataPath);
  if (!match) {
    throw new Error(`invalid candidate metadata path: ${metadataPath}`);
  }

  const [, namespaceCommit, screenId, goldenId] = match;
  const pngPath = absoluteMetadataPath.replace(/\.metadata\.json$/, ".png");
  requireRegularFile(absoluteMetadataPath);
  requireRegularFile(pngPath);

  const schema = JSON.parse(readFileSync(resolve(root, "artifacts/ui/golden/metadata.schema.json"), "utf8"));
  const metadata = JSON.parse(readFileSync(absoluteMetadataPath, "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(metadata)) {
    throw new Error(`candidate metadata failed schema validation: ${JSON.stringify(validate.errors)}`);
  }
  if (metadata.commit !== namespaceCommit) {
    throw new Error(`metadata commit does not match namespace commit ${namespaceCommit}`);
  }

  const sha256 = createHash("sha256").update(readFileSync(pngPath)).digest("hex");
  if (metadata.sha256 !== sha256) {
    throw new Error(`candidate PNG SHA-256 does not match metadata sha256: ${sha256}`);
  }

  return { commit: namespaceCommit, identity: `${screenId}/${goldenId}`, sha256 };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/validate-golden-candidate.mjs <candidate.metadata.json>");
    process.exitCode = 1;
  } else {
    try {
      const result = validateGoldenCandidate(process.argv[2]);
      console.log(`${result.identity} ${result.commit} ${result.sha256}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
