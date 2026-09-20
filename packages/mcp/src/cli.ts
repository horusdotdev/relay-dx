#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRelayMcpServer, type RelayMcpServerOptions } from "./index.js";

export interface RelayMcpCliOptions extends RelayMcpServerOptions {
  help?: boolean;
}

export const HELP_TEXT = `Usage: relay-mcp [config-path] [options]

Start a Relay GraphQL schema MCP server over stdio.

Arguments:
  config-path                  Relay compiler config path (or use --config)

Options:
  -c, --config <path>          Relay compiler config path
  -p, --project <name>         Relay project name
      --native-helper <path>   Native Relay schema helper path
      --cwd <path>              Working directory for schema loading
  -h, --help                   Show this help

The MCP JSON-RPC protocol uses stdout. Diagnostics and startup errors use stderr.
`;

function valueAfter(argv: readonly string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
  return [value, index + 1];
}

export function parseCliArgs(argv: readonly string[]): RelayMcpCliOptions {
  const options: RelayMcpCliOptions = {};
  let positionalConfig: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "-c" || argument === "--config") {
      const [value, next] = valueAfter(argv, index, argument);
      options.configPath = value;
      index = next;
      continue;
    }
    if (argument === "-p" || argument === "--project") {
      const [value, next] = valueAfter(argv, index, argument);
      options.project = value;
      index = next;
      continue;
    }
    if (argument === "--native-helper") {
      const [value, next] = valueAfter(argv, index, argument);
      options.nativeHelperPath = value;
      index = next;
      continue;
    }
    if (argument === "--cwd") {
      const [value, next] = valueAfter(argv, index, argument);
      options.cwd = value;
      index = next;
      continue;
    }
    if (argument.startsWith("-"))
      throw new Error(`Unknown option '${argument}'. Use --help for usage.`);
    if (positionalConfig) throw new Error(`Unexpected positional argument '${argument}'.`);
    positionalConfig = argument;
  }

  if (positionalConfig && options.configPath) {
    throw new Error("Pass the Relay config path either positionally or with --config, not both.");
  }
  if (positionalConfig) options.configPath = positionalConfig;
  return options;
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  streams: { stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream } = {},
): Promise<void> {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  let options: RelayMcpCliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    stderr.write("Use --help for usage.\n");
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    stdout.write(HELP_TEXT);
    return;
  }

  const { help: _help, ...serverOptions } = options;
  try {
    const server = await createRelayMcpServer(serverOptions);
    await server.connect(new StdioServerTransport());
  } catch (error) {
    stderr.write(`relay-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedFile =
  process.argv[1] && existsSync(process.argv[1])
    ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href
    : undefined;
if (invokedFile && import.meta.url === invokedFile) {
  void runCli();
}
