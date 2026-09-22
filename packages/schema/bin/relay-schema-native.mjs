#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = process.platform === "win32" ? "relay-schema-native.exe" : "relay-schema-native";
const targetDirectory = `${process.platform}-${process.arch}`;
const candidates = [
  join(packageDirectory, "native", targetDirectory, executable),
  join(packageDirectory, "native", executable),
  join(packageDirectory, "dist/native", targetDirectory, executable),
  join(packageDirectory, "dist/native", executable),
  join(packageDirectory, "../native/target/release", executable),
  join(packageDirectory, "../native/target/debug", executable),
];
const helper = candidates.find(
  (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
);

if (!helper) {
  console.error(
    `No Relay schema helper is bundled for ${targetDirectory}. Supported releases are darwin-arm64, darwin-x64, linux-arm64, linux-x64, and win32-x64.`,
  );
  process.exit(1);
}

const result = spawnSync(helper, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(`Could not execute the Relay schema helper: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
