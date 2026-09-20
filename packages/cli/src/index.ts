import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { loadRelaySchema } from "@relay-mcp/schema";

const HELP = `Usage: relay-schema [config-path] [options]

Extract the schema used by Relay, including client extensions and resolvers.
Defaults to discovering relay.config.json from the current directory.

Options:
  -c, --config <path>     Relay config file or project directory
  -p, --project <name>    Select a project from a multi-project config
      --native-helper <path>  Override the Relay schema helper executable
  -o, --output <path>     Write GraphQL SDL to a file (default: stdout)
  -h, --help              Show help
  -v, --version           Show version

Examples:
  relay-schema ./relay.config.json > effective-schema.graphql
  relay-schema ./my-app --output ./schema.graphql
  relay-schema --config relay.config.json --project web
`;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Run without terminating the process, so callers can embed the CLI. */
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
        "native-helper": { type: "string" },
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
    if (values.help) {
      io.stdout(HELP);
      return 0;
    }
    if (values.version) {
      io.stdout("0.1.0\n");
      return 0;
    }
    if (positionals.length > 1 || (positionals.length > 0 && values.config)) {
      throw new Error("Specify one config path, either positionally or with --config.");
    }
    const result = await loadRelaySchema({
      configPath: values.config ?? positionals[0],
      project: values.project,
      nativeHelperPath: values["native-helper"],
    });
    const sdl = result.sdl.endsWith("\n") ? result.sdl : `${result.sdl}\n`;
    if (!values.output || values.output === "-") {
      io.stdout(sdl);
    } else {
      const outputPath = resolve(values.output);
      await mkdir(dirname(outputPath), { recursive: true });
      const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, sdl, { flag: "wx" });
        await rename(temporaryPath, outputPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      io.stderr(`Wrote ${outputPath}\n`);
    }
    return 0;
  } catch (error) {
    io.stderr(`relay-schema: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
