import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema, isEnumType, isInputObjectType, isInterfaceType, isObjectType } from "graphql";
import { NATIVE_TARGETS, executableName, validateNativeBinary } from "./native-targets.mjs";

const PACKAGE_NAMES = ["@relay-dx/schema", "@relay-dx/cli", "@relay-dx/mcp"];
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = join(root, "examples/kitchen-sink");
const packDirectory = resolve(process.argv[2] ?? "");

function fail(message) {
  throw new Error(`Release pack smoke test: ${message}`);
}

function packagePath(name) {
  return join("node_modules", ...name.split("/"), "package.json");
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
      ...options,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

function readPublishEntries(plan) {
  if (!plan || !Array.isArray(plan.plan)) fail("publish-plan.json has no plan array");
  return plan.plan
    .flatMap((group) => (Array.isArray(group) ? group : []))
    .filter((entry) => entry?.kind === "publish" && PACKAGE_NAMES.includes(entry.name));
}

function tarballPath(entry) {
  const path = entry.tarball?.path;
  if (typeof path !== "string" || path.length === 0) {
    fail(`publish plan entry for ${entry.name} has no packed tarball path`);
  }
  const archive = resolve(packDirectory, path);
  if (!statSync(archive, { throwIfNoEntry: false })?.isFile()) {
    fail(`packed tarball for ${entry.name} does not exist: ${archive}`);
  }
  return archive;
}

function extractArchive(archive, destination) {
  run("tar", ["-xzf", archive, "-C", destination]);
  const packageDirectory = join(destination, "package");
  if (!statSync(join(packageDirectory, "package.json"), { throwIfNoEntry: false })?.isFile()) {
    fail(`packed archive does not contain package/package.json: ${archive}`);
  }
  return packageDirectory;
}

function descriptionAt(schema, coordinate) {
  if (coordinate === "$schema") return schema.description;
  const match = /^(@?\w+)(?:\.(\w+))?(?:\((\w+):\))?$/.exec(coordinate);
  if (!match) fail(`invalid description coordinate ${coordinate}`);
  const [, name, member, argument] = match;
  if (name.startsWith("@")) {
    const directive = schema.getDirective(name.slice(1));
    return argument
      ? directive?.args.find((value) => value.name === argument)?.description
      : directive?.description;
  }
  const type = schema.getType(name);
  if (!member) return type?.description;
  if (isEnumType(type)) return type.getValue(member)?.description;
  if (isInputObjectType(type)) return type.getFields()[member]?.description;
  if (isObjectType(type) || isInterfaceType(type)) {
    const field = type.getFields()[member];
    return argument
      ? field?.args.find((value) => value.name === argument)?.description
      : field?.description;
  }
  return undefined;
}

function expectedDescriptions() {
  return JSON.parse(readFileSync(join(fixture, "expected-descriptions.json"), "utf8"));
}

function verifyDescriptions(sdl, label) {
  const schema = buildSchema(sdl, { assumeValidSDL: true });
  const expected = expectedDescriptions();
  for (const [coordinate, description] of Object.entries(expected)) {
    assert.equal(descriptionAt(schema, coordinate), description, `${label}: ${coordinate}`);
  }
  return schema;
}

function verifyDescriptionMap(descriptions, label) {
  const expected = expectedDescriptions();
  for (const [coordinate, description] of Object.entries(expected)) {
    assert.equal(descriptions?.[coordinate], description, `${label}: ${coordinate}`);
  }
}

function commandPath(directory, name) {
  return join(directory, "node_modules/.bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function packageManifest(directory, name) {
  const manifestPath = join(directory, packagePath(name));
  if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) return undefined;
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function verifyVersion(directory, name) {
  const manifest = packageManifest(directory, name);
  if (!manifest) return false;
  const command = commandPath(directory, name === "@relay-dx/cli" ? "relay-schema" : "relay-mcp");
  const output = run(command, ["--version"], { cwd: directory }).trim();
  assert.equal(output, manifest.version, `${name} --version`);
  console.log(`${name} --version ${output}`);
  return true;
}

function verifyMcpHelp(directory) {
  const manifest = packageManifest(directory, "@relay-dx/mcp");
  if (!manifest) return false;
  const command = commandPath(directory, "relay-mcp");
  const output = run(command, ["--help"], { cwd: directory });
  assert.match(output, /Usage: relay-mcp/);
  console.log(`@relay-dx/mcp ${manifest.version} --help`);
  return true;
}

async function main() {
  if (!process.argv[2]) fail("usage: node scripts/smoke-pack.mjs <changesets-pack-directory>");
  const planPath = join(packDirectory, "publish-plan.json");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const entries = readPublishEntries(plan);
  if (entries.length === 0) {
    console.log("No schema, CLI, or MCP packages are being published in this plan; smoke skipped.");
    return;
  }

  const archives = new Map(entries.map((entry) => [entry.name, tarballPath(entry)]));
  for (const entry of entries) {
    const integrity = entry.tarball?.integrity;
    if (typeof integrity !== "string" || !integrity.startsWith("sha256-")) {
      fail(`publish plan entry for ${entry.name} has no sha256 tarball integrity`);
    }
    const digest = `sha256-${createHash("sha256")
      .update(await readFile(archives.get(entry.name)))
      .digest("base64")}`;
    assert.equal(digest, integrity, `${entry.name} tarball integrity`);
  }
  for (const entry of entries) console.log(`Checking ${entry.name} ${entry.version}`);

  const schemaArchive = archives.get("@relay-dx/schema");
  if (schemaArchive) {
    const archiveDirectory = mkdtempSync(join(tmpdir(), "relay-dx-schema-archive-"));
    try {
      const packageDirectory = extractArchive(schemaArchive, archiveDirectory);
      const dispatcher = join(packageDirectory, "dist/bin/relay-schema-native.mjs");
      assert.equal(statSync(dispatcher).mode & 0o111, 0o111, "schema dispatcher is executable");
      for (const target of NATIVE_TARGETS) {
        const binary = join(packageDirectory, "dist/native", target, executableName(target));
        const stat = statSync(binary, { throwIfNoEntry: false });
        assert.ok(stat?.isFile(), `schema archive is missing ${target}`);
        assert.equal(stat.mode & 0o111, 0o111, `${target} native helper is executable`);
        validateNativeBinary(target, readFileSync(binary));
      }
      console.log("Schema archive contains all five native helpers and an executable dispatcher.");
    } finally {
      await rm(archiveDirectory, { recursive: true, force: true });
    }
  } else {
    console.log("Schema is absent from this publish subset; skipping native archive checks.");
  }

  const installDirectory = mkdtempSync(join(tmpdir(), "relay-dx-pack-smoke-"));
  try {
    writeFileSync(
      join(installDirectory, "package.json"),
      JSON.stringify({ name: "relay-dx-pack-smoke", private: true, version: "1.0.0" }),
    );
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        ...archives.values(),
      ],
      { cwd: installDirectory, stdio: "inherit" },
    );

    if (schemaArchive) {
      const installedSchema = packageManifest(installDirectory, "@relay-dx/schema");
      assert.ok(installedSchema, "schema tarball was installed");
      const schemaEntry = entries.find((entry) => entry.name === "@relay-dx/schema");
      assert.equal(
        installedSchema.version,
        schemaEntry?.version,
        "installed schema tarball version",
      );
      const dispatcher = commandPath(installDirectory, "relay-schema-native");
      const nativeOutput = JSON.parse(
        run(dispatcher, ["--config", join(fixture, "relay.config.json")], {
          cwd: installDirectory,
        }),
      );
      assert.equal(typeof nativeOutput.sdl, "string", "native dispatcher SDL output");
      verifyDescriptionMap(nativeOutput.descriptions, "installed native dispatcher");
      console.log(`Installed schema helper ${installedSchema.version} passed description checks.`);
    }

    if (packageManifest(installDirectory, "@relay-dx/cli")) {
      verifyVersion(installDirectory, "@relay-dx/cli");
      const command = commandPath(installDirectory, "relay-schema");
      const output = run(command, ["--config", join(fixture, "relay.config.json")], {
        cwd: installDirectory,
      });
      verifyDescriptions(output, "installed relay-schema CLI");
      console.log("Installed relay-schema CLI passed description checks.");
    } else {
      console.log("CLI is absent from this publish subset; skipping CLI checks.");
    }
    if (packageManifest(installDirectory, "@relay-dx/mcp")) verifyMcpHelp(installDirectory);
    else console.log("MCP is absent from this publish subset; skipping MCP checks.");
  } finally {
    await rm(installDirectory, { recursive: true, force: true });
  }
  console.log("Packed release smoke test passed.");
}

await main();
