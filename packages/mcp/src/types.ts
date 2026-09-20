import type { GraphQLSchema } from "graphql";

/** The options understood by the Relay schema loader. */
export interface RelaySchemaLoadOptions {
  configPath?: string;
  project?: string;
  nativeHelperPath?: string;
  cwd?: string;
}

export interface RelayCompilerMetadata {
  path?: string;
  version?: string;
  available?: boolean;
}

export interface RelaySchemaDiagnostic {
  severity?: string;
  code?: string;
  message?: string;
  path?: string;
  project?: string;
}

/**
 * The deliberately small contract consumed from @relay-mcp/schema.
 * Keeping this structural lets the MCP package work while the loader evolves.
 */
export interface LoadedRelaySchema {
  schema: GraphQLSchema;
  sdl: string;
  projectName?: string;
  configPath?: string;
  compiler?: RelayCompilerMetadata;
  nativeHelper?: RelayCompilerMetadata;
  diagnostics?: readonly RelaySchemaDiagnostic[];
  metadata?: Record<string, unknown>;
}

export type RelaySchemaLoader = (
  options?: RelaySchemaLoadOptions,
) => LoadedRelaySchema | Promise<LoadedRelaySchema>;

export interface RelayMcpServerOptions extends RelaySchemaLoadOptions {
  /** Primarily useful to embed and test the server without a Relay project. */
  loadSchema?: RelaySchemaLoader;
}

export interface EffectiveSchema {
  loaded: LoadedRelaySchema;
  loadedAt: string;
  loadOptions: RelaySchemaLoadOptions;
}
