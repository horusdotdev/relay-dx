import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
execFileSync("relay-compiler", ["relay.config.json"], {
  cwd: fileURLToPath(new URL("../fixtures/", import.meta.url)),
  stdio: "inherit",
});
execFileSync(
  process.execPath,
  [
    "dist/cli.js",
    "--config",
    "fixtures/relay.config.json",
    "--output",
    "fixtures/__generated__/store.ts",
  ],
  { cwd, stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [
    "dist/cli.js",
    "--config",
    "../../examples/kitchen-sink/relay.config.json",
    "--output",
    "examples/__generated__/store.ts",
  ],
  { cwd, stdio: "inherit" },
);
