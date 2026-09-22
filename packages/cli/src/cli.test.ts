import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { buildSchema, isObjectType } from "graphql";
import manifest from "../package.json" with { type: "json" };
import { runCli } from "./index.js";

const fixture = fileURLToPath(
  new URL("../../../examples/kitchen-sink/relay.config.json", import.meta.url),
);

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => {
        stdout.push(text);
      },
      stderr: (text: string) => {
        stderr.push(text);
      },
    },
  };
}

describe("relay-schema CLI", () => {
  it("shows help without requiring a project", async () => {
    const { stdout, stderr, io } = capture();
    expect(await runCli(["--help"], io)).toBe(0);
    expect(stdout.join("")).toContain("Usage: relay-schema");
    expect(stderr).toEqual([]);
  });

  it("reports the package manifest version", async () => {
    const { stdout, stderr, io } = capture();
    expect(await runCli(["--version"], io)).toBe(0);
    expect(stdout).toEqual([`${manifest.version}\n`]);
    expect(stderr).toEqual([]);
  });

  it("rejects unknown flags and ambiguous input", async () => {
    for (const args of [["--unknown"], ["one", "two"], ["one", "--config", "two"]]) {
      const { stdout, stderr, io } = capture();
      expect(await runCli(args, io)).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain("relay-schema:");
    }
  });

  it("emits parseable effective SDL only on stdout", async () => {
    const { stdout, stderr, io } = capture();
    expect(await runCli([fixture], io), stderr.join("")).toBe(0);
    const schema = buildSchema(stdout.join(""), { assumeValidSDL: true });
    expect(isObjectType(schema.getQueryType())).toBe(true);
    expect(schema.getQueryType()?.getFields().viewer.description).toBe(
      "The currently authenticated user.",
    );
    expect(stderr).toEqual([]);
  });

  it("creates nested output directories and writes the schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-schema-cli-"));
    try {
      const output = join(directory, "nested", "schema.graphql");
      const { stdout, stderr, io } = capture();
      expect(await runCli(["--config", fixture, "--output", output], io), stderr.join("")).toBe(0);
      expect(stdout).toEqual([]);
      const schema = buildSchema(await readFile(output, "utf8"), { assumeValidSDL: true });
      expect(schema.getQueryType()?.getFields().viewer.description).toBe(
        "The currently authenticated user.",
      );
      expect(stderr.join("")).toContain(output);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns a useful error without emitting partial SDL", async () => {
    const { stdout, stderr, io } = capture();
    expect(await runCli(["/missing-relay-project/relay.config.json"], io)).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("relay-schema:");
  });
});
