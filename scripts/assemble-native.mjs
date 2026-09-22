import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { NATIVE_TARGETS, executableName, validateNativeBinary } from "./native-targets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = resolve(root, process.argv[2] ?? ".release/native");
const destination = join(root, "packages/schema/dist/native");

// Downloaded Actions artifacts lose file permissions. Validate and restore them
// before packing; publishConfig.executableFiles preserves them in the tarball.
for (const target of NATIVE_TARGETS) {
  const filename = executableName(target);
  const source = join(artifacts, `native-${target}`, filename);
  const binary = await readFile(source);
  validateNativeBinary(target, binary);
  const directory = join(destination, target);
  await mkdir(directory, { recursive: true });
  const path = join(directory, filename);
  await copyFile(source, path);
  await chmod(path, 0o755);
  console.log(`Assembled ${target}`);
}
