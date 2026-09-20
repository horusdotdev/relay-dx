import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const executable = process.platform === "win32" ? "relay-schema-native.exe" : "relay-schema-native";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("cargo", ["build", "--release", "--locked", "--manifest-path", "native/Cargo.toml"]);
run("vp", ["pack"]);
await mkdir(join(root, "dist/native"), { recursive: true });
const targetDirectory = process.env.CARGO_TARGET_DIR
  ? resolve(root, process.env.CARGO_TARGET_DIR)
  : join(root, "native/target");
const destination = join(root, "dist/native", executable);
await copyFile(join(targetDirectory, "release", executable), destination);
if (process.platform !== "win32") await chmod(destination, 0o755);
