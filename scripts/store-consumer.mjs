import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function run(args, cwd) {
  return execFileSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 60_000 });
}

/** Exercise installed tarballs without workspace aliases or TypeScript loaders. */
export function verifyStoreConsumer(directory, configPath) {
  const packageDirectory = join(directory, "node_modules/@relay-dx/store");
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  const cli = join(packageDirectory, manifest.bin["relay-store"]);
  const launcher = join(
    directory,
    "node_modules/.bin",
    process.platform === "win32" ? "relay-store.cmd" : "relay-store",
  );
  assert.ok(statSync(launcher).isFile(), "installed relay-store command exists");
  const help =
    process.platform === "win32"
      ? run([cli, "--help"], directory)
      : execFileSync(launcher, ["--help"], { cwd: directory, encoding: "utf8", timeout: 60_000 });
  assert.match(help, /Usage: relay-store/);
  assert.equal(run([cli, "--version"], directory).trim(), manifest.version);
  const runtime = readFileSync(join(packageDirectory, "dist/index.js"), "utf8");
  assert.doesNotMatch(runtime, /from ["'](?:node:|@relay-dx\/schema|graphql)/);
  run([cli, configPath, "-o", "generated/store.ts"], directory);
  writeFileSync(
    join(directory, "consumer.ts"),
    `
import { Environment, Network, RecordSource, Store } from "relay-runtime";
import { store } from "./generated/store.js";
const environment = new Environment({
  network: Network.create(() => { throw new Error("Unexpected network request"); }),
  store: new Store(new RecordSource()),
});
environment.commitUpdate(raw => { raw.getRoot(); });
environment.commitUpdate(store.updater(environment, view => {
  const user = view.create("User", "consumer-user");
  user.name.set("Ada");
  view.getRoot().viewer.set(user);
}));
const name = store.read(environment, view => view.getRoot().viewer.require().name.require());
if (name !== "Ada") throw new Error("Installed store failed to read its update");
function checkTypes() {
  store.updater(environment, view => {
    const user = view.get("User", "consumer-user")!;
    // @ts-expect-error Published declarations must reject invalid scalar values.
    user.name.set(42);
  });
  store.read(environment, view => {
    // @ts-expect-error Published declarations must exclude read-only writes.
    view.get("User", "consumer-user")!.name.set("No");
  });
}
`,
  );
  const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
  run(
    [
      tsc,
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--outDir",
      "compiled",
      "consumer.ts",
    ],
    directory,
  );
  run([join(directory, "compiled/consumer.js")], directory);
  run(
    [
      "--input-type=module",
      "-e",
      `
    import { generateStore } from "@relay-dx/store/generate";
    import { runCli } from "@relay-dx/store/cli";
    import { buildSchema } from "graphql";
    if (!generateStore(buildSchema("type Query { name: String }")).includes("createStoreAPI")) throw new Error("Generator export failed");
    let version = "";
    if (await runCli(["--version"], {stdout: text => version += text, stderr: text => {throw new Error(text)}}) !== 0 || !version.trim()) throw new Error("Command export failed");
  `,
    ],
    directory,
  );
  console.log(
    `Installed @relay-dx/store ${manifest.version}: CLI, exports, declarations, generation and runtime passed.`,
  );
}
