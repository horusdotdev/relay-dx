import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executableName } from "./native-targets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = `${process.platform}-${process.arch}`;
const binary = join(root, "packages/schema/dist/native", target, executableName(target));
const fixture = join(root, "examples/kitchen-sink");
const output = JSON.parse(
  execFileSync(binary, ["--config", join(fixture, "relay.config.json")], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  }),
);
assert.equal(output.compiler_version, "21.0.1");
for (const field of ["clientLabel", "displayName", "field120"]) {
  assert.ok(output.sdl.includes(field), `Missing ${field} on ${target}`);
}
const descriptions = JSON.parse(readFileSync(join(fixture, "expected-descriptions.json"), "utf8"));
for (const [coordinate, value] of Object.entries(descriptions)) {
  assert.equal(output.descriptions[coordinate], value, `${target}: ${coordinate}`);
}
console.log(`Native schema extraction passed on ${target}`);
