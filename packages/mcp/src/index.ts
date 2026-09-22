import { loadRelaySchema } from "@relay-dx/schema";
import { parse, print, validate, type DocumentNode, type GraphQLError } from "graphql";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { schemaOverview, searchSchema, typeInfo } from "./schema-utils.js";
import type {
  EffectiveSchema,
  LoadedRelaySchema,
  RelayMcpServerOptions,
  RelaySchemaLoadOptions,
  RelaySchemaLoader,
} from "./types.js";

export type {
  EffectiveSchema,
  LoadedRelaySchema,
  RelayMcpServerOptions,
  RelaySchemaLoadOptions,
  RelaySchemaLoader,
} from "./types.js";

export { schemaOverview, searchSchema, typeInfo } from "./schema-utils.js";

const searchInput = z.object({
  query: z.string().min(1),
  kind: z.enum(["SCALAR", "OBJECT", "INTERFACE", "UNION", "ENUM", "INPUT_OBJECT"]).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const inspectInput = z.object({ name: z.string().min(1) });
const validateInput = z.object({ document: z.string().min(1) });

const TOOL_DESCRIPTIONS = {
  overview:
    "Summarize the effective Relay GraphQL schema: root operation types, type counts, names, and directives.",
  search:
    "Search type and field names in the effective Relay GraphQL schema. Use this before inspect_type when you only know part of a name.",
  inspect:
    "Inspect one GraphQL type, including fields, arguments, input fields, enum values, interfaces, and union members.",
  sdl: "Return the effective schema SDL. This describes the schema loaded by the Relay compiler configuration.",
  validate:
    "Parse and validate a GraphQL document against the effective schema. This performs standard GraphQL validation only; it does not run Relay compiler transforms or prove that a Relay operation satisfies all Relay compiler conventions.",
  refresh:
    "Reload the effective Relay schema from disk and return its new overview. Use this after schema or Relay config changes.",
} as const;

function textResult(payload: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isError ? { isError: true as const } : {}),
  };
}

function errorResult(error: unknown, code = "SCHEMA_ERROR") {
  const message = error instanceof Error ? error.message : String(error);
  return textResult({ error: { code, message } }, true);
}

function graphQLErrorInfo(error: GraphQLError) {
  return {
    message: error.message,
    locations: error.locations,
    path: error.path,
    extensions: error.extensions,
  };
}

function schemaMetadata(
  loaded: LoadedRelaySchema,
  loadedAt: string,
  options: RelaySchemaLoadOptions,
) {
  return {
    ...loaded.metadata,
    projectName: loaded.projectName,
    configPath: loaded.configPath ?? options.configPath,
    compiler: loaded.compiler,
    nativeHelper: loaded.nativeHelper,
    diagnostics: loaded.diagnostics,
    loadedAt,
  };
}

export class RelayMcpState {
  private current: EffectiveSchema | undefined;

  public constructor(
    private readonly loader: RelaySchemaLoader,
    private options: RelaySchemaLoadOptions,
  ) {}

  public async load(overrides: RelaySchemaLoadOptions = {}): Promise<EffectiveSchema> {
    const nextOptions = { ...this.options, ...overrides };
    const loaded = await this.loader(nextOptions);
    if (!loaded || !loaded.schema || typeof loaded.sdl !== "string") {
      throw new Error("The schema loader returned an invalid result; expected { schema, sdl }.");
    }
    this.options = nextOptions;
    this.current = { loaded, loadedAt: new Date().toISOString(), loadOptions: nextOptions };
    return this.current;
  }

  public get effective(): EffectiveSchema {
    if (!this.current) throw new Error("The Relay schema has not been loaded.");
    return this.current;
  }
}

/**
 * Build a server and load the effective Relay schema before exposing it.
 * The returned server is transport-agnostic; callers can use stdio or an
 * in-memory transport in tests.
 */
export async function createRelayMcpServer(
  options: RelayMcpServerOptions = {},
): Promise<McpServer> {
  const { loadSchema: injectedLoader, ...loadOptions } = options;
  const state = new RelayMcpState(
    injectedLoader ?? (loadRelaySchema as RelaySchemaLoader),
    loadOptions,
  );
  await state.load();

  const server = new McpServer(
    { name: "relay-dx", version: "0.1.0" },
    {
      instructions:
        "Explore the loaded Relay GraphQL schema with overview, search, inspect, SDL, validation, and refresh tools. This server never executes GraphQL operations or makes network requests. validate_document uses standard GraphQL validation; Relay compiler-specific transforms and conventions may require running the Relay compiler.",
    },
  );

  const overview = () => {
    const effective = state.effective;
    return {
      ...schemaOverview(
        effective.loaded.schema,
        schemaMetadata(effective.loaded, effective.loadedAt, effective.loadOptions),
      ),
      sdlLength: effective.loaded.sdl.length,
    };
  };

  server.registerTool(
    "schema_overview",
    {
      description: TOOL_DESCRIPTIONS.overview,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return textResult(overview());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_schema",
    {
      description: TOOL_DESCRIPTIONS.search,
      inputSchema: searchInput,
      annotations: { readOnlyHint: true },
    },
    async ({ query, kind, limit }) => {
      try {
        const effective = state.effective;
        return textResult({
          ...searchSchema(effective.loaded.schema, query, kind, limit),
          ...schemaMetadata(effective.loaded, effective.loadedAt, effective.loadOptions),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "inspect_type",
    {
      description: TOOL_DESCRIPTIONS.inspect,
      inputSchema: inspectInput,
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      try {
        const effective = state.effective;
        const inspected = typeInfo(effective.loaded.schema, name);
        if (!inspected)
          return errorResult(new Error(`GraphQL type '${name}' was not found.`), "TYPE_NOT_FOUND");
        return textResult({
          ...inspected,
          ...schemaMetadata(effective.loaded, effective.loadedAt, effective.loadOptions),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_sdl",
    {
      description: TOOL_DESCRIPTIONS.sdl,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const effective = state.effective;
        return textResult({
          sdl: effective.loaded.sdl,
          ...schemaMetadata(effective.loaded, effective.loadedAt, effective.loadOptions),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "validate_document",
    {
      description: TOOL_DESCRIPTIONS.validate,
      inputSchema: validateInput,
      annotations: { readOnlyHint: true },
    },
    async ({ document }) => {
      try {
        const effective = state.effective;
        let parsed: DocumentNode;
        try {
          parsed = parse(document);
        } catch (error) {
          return textResult(
            {
              valid: false,
              phase: "parse",
              errors: [
                error instanceof Error ? { message: error.message } : { message: String(error) },
              ],
              relayValidation:
                "Standard GraphQL parse/validate only; Relay compiler transforms are not run.",
            },
            true,
          );
        }
        const errors = validate(effective.loaded.schema, parsed);
        return textResult(
          {
            valid: errors.length === 0,
            phase: "validate",
            errors: errors.map(graphQLErrorInfo),
            document: print(parsed),
            relayValidation:
              "Standard GraphQL validation only. Relay directives are accepted when present in the loaded schema, but Relay compiler transforms, generated artifacts, operation naming policy, and data masking conventions are not checked.",
            ...schemaMetadata(effective.loaded, effective.loadedAt, effective.loadOptions),
          },
          errors.length > 0,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "refresh_schema",
    {
      description: TOOL_DESCRIPTIONS.refresh,
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false },
    },
    async () => {
      try {
        await state.load();
        return textResult({ refreshed: true, ...overview() });
      } catch (error) {
        return errorResult(error, "SCHEMA_REFRESH_FAILED");
      }
    },
  );

  server.registerResource(
    "effective_schema",
    "relay://schema/effective",
    {
      title: "Effective Relay GraphQL schema",
      description: "The SDL currently loaded from the selected Relay project configuration.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const effective = state.effective;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: effective.loaded.sdl,
          },
        ],
      };
    },
  );

  return server;
}
