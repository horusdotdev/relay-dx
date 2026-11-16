import { fileURLToPath } from "node:url";
import { buildSchema } from "graphql";
import ts from "typescript6";
import { expect, it } from "vite-plus/test";
import { generateStore } from "./generate.js";

it("reports an abstract initializer error without expanding every record in a large schema", () => {
  const schema = buildSchema(`
    interface Resource { id: ID! }
    ${Array.from({ length: 950 }, (_, index) => `type Resource${index} implements Resource { id: ID! title: String! related: Resource }`).join("\n")}
    type Query { resource: Resource }
  `);
  const generated = fileURLToPath(new URL("__large.generated.ts", import.meta.url));
  const consumer = fileURLToPath(new URL("__large.consumer.ts", import.meta.url));
  const files = new Map([
    [generated, generateStore(schema)],
    [
      consumer,
      `
      import { store } from "./__large.generated.js";
      store.updater(view => {
        view.upsert("Resource0", { id: "resource:1", title: "Catalog" });
        view.upsert("Resource1", { id: "resource:2", title: "Index" });
        view.upsert("Resource", { id: "resource:abstract" });
      });
    `,
    ],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    paths: { "@relay-dx/store": [fileURLToPath(new URL("./index.ts", import.meta.url))] },
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  host.readFile = (name) => files.get(name) ?? originalRead(name);
  host.fileExists = (name) => files.has(name) || originalExists(name);
  host.getSourceFile = (name, version) => {
    const text = host.readFile(name);
    return text === undefined ? undefined : ts.createSourceFile(name, text, version);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([2345]);
  expect(ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, "\n")).toContain(
    "Abstract type; use Resource",
  );
});
