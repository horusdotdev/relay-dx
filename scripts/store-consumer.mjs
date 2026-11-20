import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

function run(args, cwd) {
  return execFileSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 60_000 });
}

/** Exercise installed tarballs without workspace aliases or TypeScript loaders. */
export function verifyStoreConsumer(directory, configPath) {
  const packageDirectory = join(directory, "node_modules/@relay-dx/store");
  const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  assert.equal(manifest.dependencies["@types/relay-runtime"], undefined);
  assert.equal(manifest.peerDependencies["relay-runtime"], "21.0.1");
  const consumerGraphQL = createRequire(join(directory, "package.json")).resolve("graphql");
  for (const name of ["schema", "store", "mcp"]) {
    const packageJSON = join(directory, `node_modules/@relay-dx/${name}/package.json`);
    if (!statSync(packageJSON, { throwIfNoEntry: false })?.isFile()) continue;
    const installed = JSON.parse(readFileSync(packageJSON, "utf8"));
    assert.equal(installed.dependencies?.graphql, undefined);
    assert.equal(installed.peerDependencies.graphql, "^16.14.2 || ^17.0.0");
    assert.equal(createRequire(packageJSON).resolve("graphql"), consumerGraphQL);
  }
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
  const user = view.upsert("User", { id: "consumer-user", name: "Ada", role: "VIEWER" });
  user.name.set("Ada");
  const copied = view.copy(user, "consumer-copy");
  copied.$.copyFrom(user);
  if (copied.$.field("name").get() !== "Ada" || !view.ids().includes("consumer-copy")) throw new Error("Installed record helpers failed");
  view.getRoot().viewer.set(user);
  if (user.$.concrete().name.get() !== "Ada") throw new Error("Installed concrete handle failed");
  const connectionID = store.connectionID("User", "consumer-user", "KitchenSinkQuery_posts");
  if (connectionID !== store.connectionID("consumer-user", "KitchenSinkQuery_posts")) throw new Error("Installed typed connection ID failed");
  if (view.getTypeRefinement("User", "Node") !== undefined) throw new Error("Installed cached refinement invented a flag");
  const firstID = store.createClientID("Post");
  if (!firstID.startsWith("client:Post:")) throw new Error("Installed client ID helper failed");
  const first = view.upsert("Post", { id: firstID, title: "Zulu", status: "DRAFT", author: user, tags: [] });
  const second = view.upsert("Post", { id: "consumer-post-2", title: "Alpha", status: "DRAFT", author: user, tags: [] });
  first.title.set("Zulu");
  second.title.set("Alpha");
  const record = view.upsert("PostConnection", {
    id: "consumer-posts", edges: [],
    pageInfo: view.upsert("PageInfo", {id: "consumer-page", hasNextPage: false}),
  });
  record.edges.set([]);
  user.posts.set(record);
  const keys: readonly "KitchenSinkQuery_posts"[] = user.posts.keys();
  if (keys.join() !== "KitchenSinkQuery_posts") throw new Error("Installed connection keys failed");
  for (const key of keys) user.posts.connections(key);
  const posts = user.posts.connections().include(record);
  const connection = posts.variants()[0]!;
  posts.appendNode(first);
  posts.appendNode(first);
  connection.prependNode(second);
  connection.prependNode(second);
  record.edges.append(connection.createEdge(second));
  record.edges.prepend(connection.createEdge(second));
  if (connection.record.edges.require().length !== 2) throw new Error("Installed duplicate-safe insertion failed");
  posts.sort((a, b) => a.title.require().localeCompare(b.title.require()));
  if (connection.nodes()[0]?.title.get() !== "Alpha") throw new Error("Installed connection sort failed");
  posts.filter(post => post.title.get() === "Alpha");
  if (connection.nodes().length !== 1) throw new Error("Installed connection filter failed");
  view.delete("Post", "consumer-post-2", { prune: true });
  if (connection.record.edges.require().length !== 0 || view.get("Post", "consumer-post-2")) throw new Error("Installed deletion pruning failed");
}));
const name = store.read(environment, view => view.getRoot().viewer.require().name.require());
if (name !== "Ada") throw new Error("Installed store failed to read its update");
environment.commitUpdate(store.updater(view => {
  const recording = view.upsert("Post", { id: "consumer-entry", title: "Coda", status: "DRAFT", author: view.getRoot().viewer.require(), tags: [] });
  recording.title.set("Coda");
  recording.status.set("%future added value");
  recording.$.invalidate();
  const connection = view.getRoot().viewer.require().posts.createConnection("KitchenSinkQuery_posts");
  connection.appendNode(recording);
  if (connection.nodes().length !== 1) throw new Error("Installed connection creation failed");
}));
environment.commitUpdate(raw => store.proxy(raw, view => {
  const recording = view.get("Post", "consumer-entry")!;
  for (const variant of recording.title.variants()) variant.set("Encore");
  if (recording.title.get() !== "Encore") throw new Error("Installed field variants failed");
  view.invalidateStore();
}));
function checkTypes() {
  store.updater(environment, view => {
    const user = view.get("User", "consumer-user")!;
    // @ts-expect-error Published declarations must reject invalid scalar values.
    user.name.set(42);
    // @ts-expect-error Connection keys are restricted to the field's Relay documents.
    user.posts.connections("KitchenSinkQuery_search");
  });
  store.read(environment, view => {
    // @ts-expect-error Published declarations must exclude read-only writes.
    view.get("User", "consumer-user")!.name.set("No");
    // @ts-expect-error Published declarations must keep connection mutations updater-only.
    view.get("User", "consumer-user")!.posts.connections().filter(() => false);
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
