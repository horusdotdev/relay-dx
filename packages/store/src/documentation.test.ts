import { fileURLToPath } from "node:url";
import ts from "typescript";
import { buildSchema } from "graphql";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { generateStore } from "./generate.js";

const schema = buildSchema(`
  "Search criteria."
  input Filter {
    "Legacy filter."
    old: String @deprecated(reason: "Use term instead.")
    "Search text."
    term: String
  }
  "A person, including café and 東京."
  type User {
    constructor: String
    "Current display name."
    name: String!
    "Legacy contact field."
    email: String @deprecated(reason: "Use contact instead.")
    "Related person."
    friend: User @deprecated(reason: "Use friends instead.")
    "Other people."
    friends: [User!]!
    "A formatted label."
    label(
      "Text before the name."
      prefix: String @deprecated(reason: "Use formatting instead.")
    ): String
    "A literal */ delimiter.\\n@deprecated This is description text, not a tag."
    note: String
  }
  type Query { viewer: User, search(filter: Filter): String }
`);
const filename = fileURLToPath(new URL("__documentation.consumer.ts", import.meta.url));
const generatedName = fileURLToPath(new URL("__documentation.generated.ts", import.meta.url));
const consumer = `
import { store, type Input_Filter } from "./__documentation.generated.js";
import type { Environment } from "relay-runtime";
declare const environment: Environment;
store.read(environment, view => {
  const user = view.get("User", "id")!;
  user./*old-read*/email.get();
  user./*current-read*/name.get();
  user.email./*method-completions*/get();
  user./*escaped-doc*/note.get();
  user./*required-read*/email.require();
  user./*linked-read*/friend.get();
  user./*field-completions*/email.get();
  user.label.get({ /*argument-completions*/prefix: "Hi" });
});
store.updater(environment, view => {
  const user = view.get("User", "id")!;
  user./*old-write*/email.set("old");
  user./*current-write*/name.set("new");
  user./*linked-write*/friend.set(null);
  user.friend.require().name.set("Writable link");
  user.friends.get()?.[0]?.name.set("Writable list item");
});
const input: Input_Filter = { /*input-completions*/old: "text" };
`;

const files = new Map([
  [filename, consumer],
  [generatedName, generateStore(schema)],
]);
const options: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: true,
  paths: { "@relay-dx/store": [fileURLToPath(new URL("./index.ts", import.meta.url))] },
};
const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: () => "1",
  getScriptSnapshot: (name) => {
    const source = files.get(name) ?? ts.sys.readFile(name);
    return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
  },
  getCurrentDirectory: () => fileURLToPath(new URL("../../../", import.meta.url)),
  getCompilationSettings: () => options,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: (name) => files.has(name) || ts.sys.fileExists(name),
  readFile: (name) => files.get(name) ?? ts.sys.readFile(name),
  readDirectory: (...args) => ts.sys.readDirectory(...args),
};
const service = ts.createLanguageService(host);
afterAll(() => service.dispose());
function position(marker: string) {
  return consumer.indexOf(`/*${marker}*/`) + `/*${marker}*/`.length;
}
function hover(marker: string) {
  return service.getQuickInfoAtPosition(filename, position(marker) + 1)!;
}
function completion(marker: string, name: string) {
  const pos = position(marker);
  const entry = service
    .getCompletionsAtPosition(filename, pos, {})
    ?.entries.find((item) => item.name === name);
  expect(entry, `Missing ${name} completion at ${marker}`).toBeDefined();
  return service.getCompletionEntryDetails(
    filename,
    pos,
    name,
    {},
    entry!.source,
    {},
    entry!.data,
  )!;
}

describe("generated GraphQL documentation in the TypeScript language service", () => {
  it("keeps direct field accessors well-typed in read and updater scopes", () => {
    for (const name of files.keys()) {
      expect(service.getSyntacticDiagnostics(name)).toEqual([]);
      expect(
        service
          .getSemanticDiagnostics(name)
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
      ).toEqual([]);
    }
  });

  it("shows field descriptions and deprecation reasons on scalar and linked accessors", () => {
    for (const marker of ["old-read", "required-read", "old-write"]) {
      const info = hover(marker);
      expect(ts.displayPartsToString(info.documentation)).toBe("Legacy contact field.");
      expect(
        info.tags
          ?.find((tag) => tag.name === "deprecated")
          ?.text?.map((part) => part.text)
          .join(""),
      ).toBe("Use contact instead.");
    }
    for (const marker of ["linked-read", "linked-write"]) {
      const info = hover(marker);
      expect(ts.displayPartsToString(info.documentation)).toBe("Related person.");
      expect(info.tags?.find((tag) => tag.name === "deprecated")).toBeDefined();
    }
  });

  it("keeps deprecation status specific to each field", () => {
    for (const marker of ["current-read", "current-write"]) {
      const info = hover(marker);
      expect(ts.displayPartsToString(info.documentation)).toBe("Current display name.");
      expect(info.tags?.some((tag) => tag.name === "deprecated")).not.toBe(true);
    }
    expect(ts.displayPartsToString(hover("escaped-doc").documentation)).toContain("delimiter");
    expect(hover("escaped-doc").tags?.some((tag) => tag.name === "deprecated")).not.toBe(true);
    expect(completion("method-completions", "get").kindModifiers).not.toContain("deprecated");
  });

  it("provides direct field completions with documentation and deprecation markers", () => {
    const old = completion("field-completions", "email");
    expect(old.kindModifiers).toContain("deprecated");
    expect(ts.displayPartsToString(old.documentation)).toBe("Legacy contact field.");
    expect(old.tags?.find((tag) => tag.name === "deprecated")).toBeDefined();
    expect(completion("field-completions", "name").kindModifiers).not.toContain("deprecated");
  });

  it("preserves descriptions and deprecations on field arguments and input fields", () => {
    const arg = completion("argument-completions", "prefix");
    expect(ts.displayPartsToString(arg.documentation)).toBe("Text before the name.");
    expect(arg.kindModifiers).toContain("deprecated");
    const input = completion("input-completions", "old");
    expect(ts.displayPartsToString(input.documentation)).toBe("Legacy filter.");
    expect(input.kindModifiers).toContain("deprecated");
  });
});
