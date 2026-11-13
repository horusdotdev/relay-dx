import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { loadRelaySchema } from "@relay-dx/schema";
import { generateStore } from "./generate.js";
import { PACKAGE_VERSION } from "./version.js";

export const HELP_TEXT = `Usage: relay-store [config-path] [options]

Generate a typed Relay store interface from the project's effective schema.
Defaults to discovering Relay configuration from the current directory.

Options:
  -c, --config <path>        Relay JSON config, package.json, or project directory
  -p, --project <name>       Select a project from a multi-project config
  -o, --output <path>        Write TypeScript to a file (default: stdout; - for stdout)
      --cwd <path>           Base directory for discovery and relative paths
      --native-helper <path> Override the native Relay schema helper executable
  -h, --help                 Show help
  -v, --version              Show the package version

Examples:
  relay-store --output src/__generated__/store.ts
  relay-store ./relay.config.json --project web -o src/__generated__/store.ts
  relay-store /path/to/app > store.ts
`;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Run generation without terminating the host process; return 0 or 1. */
export async function runCli(
  args: string[],
  io: CliIO = {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  },
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        config: { type: "string", short: "c" },
        project: { type: "string", short: "p" },
        output: { type: "string", short: "o" },
        cwd: { type: "string" },
        "native-helper": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
    if (values.help) {
      io.stdout(HELP_TEXT);
      return 0;
    }
    if (values.version) {
      io.stdout(`${PACKAGE_VERSION}\n`);
      return 0;
    }
    if (positionals.length > 1 || (positionals.length > 0 && values.config)) {
      throw new Error("Specify one config path, either positionally or with --config.");
    }
    const cwd = resolve(values.cwd ?? process.cwd());
    const loaded = await loadRelaySchema({
      cwd,
      configPath: values.config ?? positionals[0],
      project: values.project,
      nativeHelperPath: values["native-helper"],
    });
    const contents = object(JSON.parse(await readFile(loaded.configPath, "utf8")) as unknown);
    const config =
      basename(loaded.configPath) === "package.json" ? object(contents.relay) : contents;
    const projects = object(config.projects);
    const project = Object.hasOwn(projects, loaded.projectName)
      ? object(projects[loaded.projectName])
      : config;
    const source = generateStore(loaded.schema, {
      scalarTypes: { ...object(config.customScalarTypes), ...object(project.customScalarTypes) },
    });
    if (!values.output || values.output === "-") io.stdout(source);
    else {
      const output = resolve(cwd, values.output);
      await mkdir(dirname(output), { recursive: true });
      const temporary = `${output}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, source, { flag: "wx" });
        await rename(temporary, output);
      } finally {
        await rm(temporary, { force: true });
      }
      io.stderr(`Wrote ${output}\n`);
    }
    return 0;
  } catch (error) {
    io.stderr(`relay-store: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
