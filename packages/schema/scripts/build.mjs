import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const jsOnly = process.argv.includes("--js-only");
const nativeTarget = process.env.RELAY_SCHEMA_NATIVE_TARGET;
const rustTarget = process.env.RELAY_SCHEMA_RUST_TARGET;
const targetPlatform = nativeTarget?.split("-", 1)[0] ?? process.platform;
const executable = targetPlatform === "win32" ? "relay-schema-native.exe" : "relay-schema-native";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const cargoArguments = ["build", "--release", "--locked", "--manifest-path", "native/Cargo.toml"];
if (rustTarget) cargoArguments.push("--target", rustTarget);
if (!jsOnly) run("cargo", cargoArguments);
if (jsOnly || process.env.RELAY_SCHEMA_NATIVE_ONLY !== "1") {
  run("vp", ["pack"]);
  const dispatcher = join(root, "dist/bin/relay-schema-native.mjs");
  await mkdir(dirname(dispatcher), { recursive: true });
  await copyFile(join(root, "bin/relay-schema-native.mjs"), dispatcher);
  await chmod(dispatcher, 0o755);
}
if (jsOnly) process.exit(0);
const destinationDirectory = nativeTarget
  ? join(root, "dist/native", nativeTarget)
  : join(root, "dist/native");
await mkdir(destinationDirectory, { recursive: true });
const targetDirectory = process.env.CARGO_TARGET_DIR
  ? resolve(root, process.env.CARGO_TARGET_DIR)
  : join(root, "native/target");
const releaseDirectory = rustTarget
  ? join(targetDirectory, rustTarget, "release")
  : join(targetDirectory, "release");
const destination = join(destinationDirectory, executable);
await copyFile(join(releaseDirectory, executable), destination);
if (process.platform !== "win32") await chmod(destination, 0o755);
