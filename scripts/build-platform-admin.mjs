import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "platform-admin");
const outputRoot = join(sourceRoot, "dist");

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const compiler = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const result = spawnSync(process.execPath, [compiler, "--project", join(sourceRoot, "tsconfig.json")], {
  cwd: root,
  encoding: "utf8",
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

for (const filename of ["api.js", "auth.js", "review.js", "attendance-correction.js", "main.js"]) {
  const target = join(outputRoot, filename);
  const browserModule = readFileSync(target, "utf8").replace(
    /from\s+(["'])\.\/(api|auth|review|attendance-correction)\1/g,
    "from $1./$2.js$1",
  );
  writeFileSync(target, browserModule, "utf8");
}
copyFileSync(join(sourceRoot, "index.html"), join(outputRoot, "index.html"));
copyFileSync(join(sourceRoot, "styles.css"), join(outputRoot, "styles.css"));

process.stdout.write(`Built platform admin at ${outputRoot}\n`);
