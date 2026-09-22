import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve } from "node:path";
import { buildASTSchema, GraphQLSchema, parse, print, Source } from "graphql";
import { restoreDescriptions } from "./descriptions.js";

export interface LoadRelaySchemaOptions {
  configPath?: string;
  project?: string;
  nativeHelperPath?: string;
  cwd?: string;
}
export interface RelaySchemaDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
  project?: string;
}
export interface RelayCompilerInfo {
  path?: string;
  version?: string;
  available: boolean;
}
export interface RelaySchemaResult {
  schema: GraphQLSchema;
  sdl: string;
  projectName: string;
  configPath: string;
  rootDirectory: string;
  schemaPaths: string[];
  schemaExtensionPaths: string[];
  compiler: RelayCompilerInfo;
  diagnostics: RelaySchemaDiagnostic[];
}
export class RelaySchemaError extends Error {
  readonly diagnostics: RelaySchemaDiagnostic[];
  constructor(message: string, diagnostics: RelaySchemaDiagnostic[] = []) {
    super(message);
    this.name = "RelaySchemaError";
    this.diagnostics = diagnostics;
  }
}

type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const execFileAsync = promisify(execFile);
const GRAPHQL_EXTENSIONS = new Set([".graphql", ".graphqls", ".gql"]);
function nativeArtifactDirectory(platform = process.platform, arch = process.arch): string {
  return `${platform}-${arch}`;
}
function diag(
  code: string,
  message: string,
  path?: string,
  project?: string,
  severity: RelaySchemaDiagnostic["severity"] = "error",
): RelaySchemaDiagnostic {
  return { code, message, severity, ...(path ? { path } : {}), ...(project ? { project } : {}) };
}
function parseJson(path: string, diagnostics: RelaySchemaDiagnostic[]): JsonObject {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(value)) throw new Error("Expected a JSON object.");
    return value;
  } catch (error) {
    const d = diag(
      "CONFIG_PARSE_ERROR",
      `Could not parse Relay config ${path}: ${error instanceof Error ? error.message : String(error)}`,
      path,
    );
    throw new RelaySchemaError(d.message, [...diagnostics, d]);
  }
}
function findConfig(
  cwd: string,
  requested: string | undefined,
  diagnostics: RelaySchemaDiagnostic[],
): { path: string; value: JsonObject } {
  if (requested) {
    const path = resolve(cwd, requested);
    if (!existsSync(path)) {
      const d = diag("CONFIG_NOT_FOUND", `Relay config was not found at ${path}.`, path);
      throw new RelaySchemaError(d.message, [d]);
    }
    if (statSync(path).isDirectory()) return findConfig(path, undefined, diagnostics);
    if (basename(path) === "package.json") {
      const pkg = parseJson(path, diagnostics);
      if (!isObject(pkg.relay)) {
        const d = diag(
          "RELAY_CONFIG_MISSING",
          `${path} does not contain a "relay" configuration object.`,
          path,
        );
        throw new RelaySchemaError(d.message, [d]);
      }
      return { path, value: pkg.relay };
    }
    return { path, value: parseJson(path, diagnostics) };
  }
  let directory = resolve(cwd);
  while (true) {
    const packagePath = join(directory, "package.json");
    if (existsSync(packagePath)) {
      const pkg = parseJson(packagePath, diagnostics);
      if (isObject(pkg.relay)) return { path: packagePath, value: pkg.relay };
    }
    const relayPath = join(directory, "relay.config.json");
    if (existsSync(relayPath)) return { path: relayPath, value: parseJson(relayPath, diagnostics) };
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const d = diag(
    "CONFIG_NOT_FOUND",
    `Could not find relay.config.json or package.json with a relay key from ${cwd}.`,
  );
  throw new RelaySchemaError(d.message, [d]);
}
function walk(directory: string, extensions: Set<string>): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__generated__" || entry.name === ".git")
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, extensions));
    else if (extensions.has(extname(path).toLowerCase())) files.push(path);
  }
  return files.sort();
}
function configuredPaths(
  value: unknown,
  root: string,
  diagnostics: RelaySchemaDiagnostic[],
  code: string,
  project: string,
): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const files: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const path = resolve(root, item);
    if (!existsSync(path)) {
      diagnostics.push(
        diag(code, `Configured path does not exist: ${path}`, path, project, "warning"),
      );
      continue;
    }
    files.push(...(statSync(path).isDirectory() ? walk(path, GRAPHQL_EXTENSIONS) : [path]));
  }
  return [...new Set(files)].sort();
}
function helperPath(requested?: string): string | undefined {
  if (requested)
    return existsSync(requested) && statSync(requested).isFile() ? requested : undefined;
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const executable =
    process.platform === "win32" ? "relay-schema-native.exe" : "relay-schema-native";
  const platformDirectory = nativeArtifactDirectory();
  const candidates = [
    join(moduleDirectory, "native", platformDirectory, executable),
    join(moduleDirectory, "native", executable),
    join(moduleDirectory, "../dist/native", platformDirectory, executable),
    join(moduleDirectory, "../dist/native", executable),
    join(moduleDirectory, "../native/target/release", executable),
    join(moduleDirectory, "../native/target/debug", executable),
  ];
  return candidates.find((path) => existsSync(path));
}

function installedCompilerVersion(configPath: string): string | undefined {
  let packagePath: string;
  try {
    packagePath = createRequire(configPath).resolve("relay-compiler/package.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return undefined;
    throw error;
  }
  const version = parseJson(packagePath, []).version;
  return typeof version === "string" ? version : undefined;
}
async function invokeNative(
  helper: string,
  configPath: string,
  project?: string,
): Promise<{
  project_name: string;
  config_path: string;
  root_directory: string;
  sdl: string;
  compiler_version: string;
  descriptions: Record<string, string>;
}> {
  const args = ["--config", configPath];
  if (project) args.push("--project", project);
  try {
    const result = await execFileAsync(helper, args, {
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      timeout: 60_000,
    });
    return JSON.parse(result.stdout) as {
      project_name: string;
      config_path: string;
      root_directory: string;
      sdl: string;
      compiler_version: string;
      descriptions: Record<string, string>;
    };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? (error as { stderr?: unknown }).stderr
        : undefined;
    const detail =
      typeof stderr === "string" && stderr.trim()
        ? stderr
        : error instanceof Error
          ? error.message
          : String(error);
    throw new RelaySchemaError(
      `The native Relay schema helper failed. ${detail.trim() || "Build packages/schema/native with cargo and retry."}`,
    );
  }
}

export async function loadRelaySchema(
  options: LoadRelaySchemaOptions = {},
): Promise<RelaySchemaResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const diagnostics: RelaySchemaDiagnostic[] = [];
  const config = findConfig(cwd, options.configPath, diagnostics);
  const raw = config.value;
  const multi = isObject(raw.projects);
  const projects: JsonObject = isObject(raw.projects) ? raw.projects : { default: raw };
  const names = Object.keys(projects);
  if (!names.length)
    throw new RelaySchemaError(`Relay config ${config.path} contains no projects.`, [
      diag("NO_PROJECTS", "Relay config contains no projects.", config.path),
    ]);
  const projectName = options.project ?? (names.length === 1 ? names[0] : undefined);
  if (!projectName || !Object.hasOwn(projects, projectName))
    throw new RelaySchemaError(
      `Select a Relay project with --project. Available projects: ${names.join(", ")}.${options.project ? ` Unknown project: ${options.project}.` : ""}`,
      [diag("PROJECT_REQUIRED", `Select one project from: ${names.join(", ")}.`, config.path)],
    );
  const project = projects[projectName];
  if (!isObject(project))
    throw new RelaySchemaError(`Invalid Relay project configuration: ${projectName}.`);
  const root = resolve(
    dirname(config.path),
    multi && typeof raw.root === "string" ? raw.root : ".",
  );
  const schemaPaths = configuredPaths(
    project.schema ?? project.schemaDir ?? project.schemaCompact,
    root,
    diagnostics,
    "SCHEMA_NOT_FOUND",
    projectName,
  );
  const schemaExtensionPaths = configuredPaths(
    project.schemaExtensions,
    root,
    diagnostics,
    "SCHEMA_EXTENSION_NOT_FOUND",
    projectName,
  );
  const baseNames = new Set<string>();
  let base = project.base;
  while (typeof base === "string" && !baseNames.has(base) && isObject(projects[base])) {
    baseNames.add(base);
    const baseProject = projects[base] as JsonObject;
    schemaExtensionPaths.push(
      ...configuredPaths(
        baseProject.schemaExtensions,
        root,
        diagnostics,
        "SCHEMA_EXTENSION_NOT_FOUND",
        base,
      ),
    );
    base = baseProject.base;
  }
  const helperOverride = options.nativeHelperPath ?? process.env.RELAY_MCP_NATIVE_HELPER;
  const requestedHelper = helperOverride ? resolve(cwd, helperOverride) : undefined;
  if (requestedHelper && !existsSync(requestedHelper))
    throw new RelaySchemaError(
      `The configured nativeHelperPath was not found: ${requestedHelper}`,
      [diag("NATIVE_HELPER_NOT_FOUND", "Check nativeHelperPath or build relay-schema-native.")],
    );
  const helper = helperPath(requestedHelper);
  if (!helper)
    throw new RelaySchemaError(
      "Relay schema extraction requires the compiler-native helper. Build it with `cargo build --release --manifest-path packages/schema/native/Cargo.toml`, or pass nativeHelperPath.",
      [diag("NATIVE_HELPER_MISSING", "The relay-schema-native executable was not found.")],
    );
  const native = await invokeNative(
    helper,
    config.path,
    projectName === "default" && !multi ? undefined : projectName,
  );
  const installedVersion = installedCompilerVersion(config.path);
  if (installedVersion && installedVersion !== native.compiler_version) {
    const message = `This project uses relay-compiler ${installedVersion}, but the native helper uses ${native.compiler_version}. Build and select a helper for the project's Relay version with nativeHelperPath.`;
    throw new RelaySchemaError(message, [
      diag("COMPILER_VERSION_MISMATCH", message, config.path, projectName),
    ]);
  }
  let schema: GraphQLSchema;
  let sdl: string;
  try {
    const document = restoreDescriptions(
      parse(new Source(native.sdl, native.config_path)),
      native.descriptions,
    );
    sdl = `${print(document)}\n`;
    schema = buildASTSchema(document, {
      assumeValidSDL: true,
      assumeValid: true,
    });
  } catch (error) {
    throw new RelaySchemaError(
      `The native Relay helper returned invalid SDL: ${error instanceof Error ? error.message : String(error)}`,
      [diag("NATIVE_SDL_ERROR", "Native SDL could not be parsed.", config.path, projectName)],
    );
  }
  schema.extensions = {
    ...schema.extensions,
    relay: {
      projectName: native.project_name,
      configPath: native.config_path,
      rootDirectory: native.root_directory,
      schemaPaths,
      schemaExtensionPaths,
      native: true,
      compilerVersion: native.compiler_version,
    },
  };
  return {
    schema,
    sdl,
    projectName: native.project_name,
    configPath: native.config_path,
    rootDirectory: native.root_directory,
    schemaPaths,
    schemaExtensionPaths,
    compiler: { path: helper, version: native.compiler_version, available: true },
    diagnostics,
  };
}
