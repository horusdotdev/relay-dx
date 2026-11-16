import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildSchema } from "graphql";
import { generateStore } from "../src/generate.ts";

const cwd = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(new URL("../fixtures/__generated__/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../fixtures/__generated__/adoption.ts", import.meta.url),
  generateStore(
    buildSchema(readFileSync(new URL("../fixtures/adoption.graphql", import.meta.url), "utf8")),
    {
      connectionKeys: { Studio: { recordings: ["Library_recordings"] } },
    },
  ),
);
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
    "--types",
    "all",
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
