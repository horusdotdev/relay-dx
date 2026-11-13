import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import manifest from "../package.json" with { type: "json" };
import { runCli } from "./command.js";

const fixture = fileURLToPath(new URL("../fixtures/relay.config.json", import.meta.url));
function capture() {
  const stdout: string[] = [],
    stderr: string[] = [];
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

describe("relay-store command", () => {
  it("prints help and version without loading a Relay project", async () => {
    for (const option of ["--help", "-h", "--version", "-v"]) {
      const { stdout, stderr, io } = capture();
      expect(await runCli([option], io)).toBe(0);
      if (option === "--version" || option === "-v")
        expect(stdout.join("")).toBe(`${manifest.version}\n`);
      else expect(stdout.join("")).toContain("Usage: relay-store");
      expect(stderr).toEqual([]);
    }
  });

  it("rejects unknown, missing and ambiguous arguments without partial output", async () => {
    for (const args of [["--unknown"], ["--output"], ["a", "b"], ["a", "--config", "b"]]) {
      const { stdout, stderr, io } = capture();
      expect(await runCli(args, io)).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toMatch(/^relay-store:/);
    }
  });

  it("prints only generated TypeScript to stdout by default or with --output -", async () => {
    for (const args of [[fixture], ["-c", fixture, "-o", "-"]]) {
      const { stdout, stderr, io } = capture();
      expect(await runCli(args, io), stderr.join("")).toBe(0);
      expect(stdout.join("")).toContain(
        '"avatar": ScalarField<string | null | undefined, string | null',
      );
      expect(stdout.join("")).toContain('from "@relay-dx/store"');
      expect(stderr).toEqual([]);
    }
  });

  it("discovers package.json config and resolves output against --cwd", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-store-command-"));
    try {
      await mkdir(join(directory, "src"));
      await writeFile(
        join(directory, "src", "Query.ts"),
        "const query = graphql`query Query { __typename }`;",
      );
      await writeFile(join(directory, "schema.graphql"), "scalar URL type Query { avatar: URL }");
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: "store-fixture",
          private: true,
          relay: {
            src: "src",
            schema: "schema.graphql",
            language: "typescript",
            customScalarTypes: { URL: "string" },
          },
        }),
      );
      const { stdout, stderr, io } = capture();
      const output = join(directory, "nested", "store.ts");
      await mkdir(join(directory, "nested"));
      await writeFile(output, "Previous generated file");
      expect(await runCli(["--cwd", directory, "-o", "nested/store.ts"], io), stderr.join("")).toBe(
        0,
      );
      expect(await readFile(output, "utf8")).toContain(
        '"avatar": ScalarField<string | null | undefined, string | null',
      );
      expect(await readdir(join(directory, "nested"))).toEqual(["store.ts"]);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain(output);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires project selection for multi-project configuration", async () => {
    const config = fileURLToPath(
      new URL("../../../tests/fixtures/multi-project/relay.config.json", import.meta.url),
    );
    const failed = capture();
    expect(await runCli([config], failed.io)).toBe(1);
    expect(failed.stdout).toEqual([]);
    const selected = capture();
    expect(await runCli([config, "-p", "app"], selected.io), selected.stderr.join("")).toBe(0);
    expect(selected.stdout.join("")).toContain("export const store = createStoreAPI");
  });

  it("keeps existing output intact when schema extraction fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-store-error-"));
    try {
      const output = join(directory, "store.ts");
      await writeFile(output, "Existing generated file");
      const { stdout, stderr, io } = capture();
      expect(
        await runCli(
          [fixture, "--native-helper", join(directory, "missing-helper"), "-o", output],
          io,
        ),
      ).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toMatch(/^relay-store:/);
      expect(await readFile(output, "utf8")).toBe("Existing generated file");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
