import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { NATIVE_TARGETS, executableName, validateNativeBinary } from "./native-targets.mjs";

const dist = fileURLToPath(new URL("../packages/schema/dist/", import.meta.url));
for (const target of NATIVE_TARGETS) {
  const path = join(dist, "native", target, executableName(target));
  const binary = await readFile(path).catch(() => {
    throw new Error(
      `Missing ${target} release binary. Download all native artifacts and run scripts/assemble-native.mjs before packing.`,
    );
  });
  validateNativeBinary(target, binary);
}
await readFile(join(dist, "bin/relay-schema-native.mjs"));
console.log("All five release binaries and the native dispatcher are present.");
