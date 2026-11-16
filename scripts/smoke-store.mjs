import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStoreConsumer } from "./store-consumer.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "relay-store-package-"));
try {
  const archives = [];
  // Install the full package set to catch dependency hoisting differences.
  for (const name of ["schema", "cli", "mcp", "store"]) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    execFileSync("pnpm", ["--dir", directory, "pack", "--pack-destination", temporary], {
      stdio: "inherit",
    });
    archives.push(
      join(
        temporary,
        `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`,
      ),
    );
  }
  for (const graphqlVersion of ["16.14.2", "16.15.0"]) {
    const consumer = join(temporary, `consumer-${graphqlVersion}`);
    await mkdir(consumer);
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ name: "store-consumer", private: true, type: "module" }),
    );
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        `graphql@${graphqlVersion}`,
        ...archives,
      ],
      { cwd: consumer, stdio: "inherit", timeout: 60_000 },
    );
    verifyStoreConsumer(consumer, join(root, "examples/kitchen-sink/relay.config.json"));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
