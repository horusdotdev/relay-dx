import { describe, expect, it } from "vite-plus/test";
import { buildASTSchema, parse, print } from "graphql";
import { restoreDescriptions } from "./descriptions.js";

describe("description serialization", () => {
  it.each([
    "type Query { hello: String } type Mutation { set: String } type Subscription { changed: String }",
    "schema { query: Root } type Root { hello: String }",
  ])("retains schema descriptions and operation roots in %s", (sdl) => {
    const document = parse(sdl);
    const before = buildASTSchema(document);
    const after = buildASTSchema(
      parse(
        print(
          restoreDescriptions(document, {
            $schema: "Documentation for the whole API.",
          }),
        ),
      ),
    );
    expect(after.description).toBe("Documentation for the whole API.");
    expect(after.getQueryType()?.name).toBe(before.getQueryType()?.name);
    expect(after.getMutationType()?.name).toBe(before.getMutationType()?.name);
    expect(after.getSubscriptionType()?.name).toBe(before.getSubscriptionType()?.name);
  });

  it.each([
    "",
    "An ordinary description.",
    'Unicode café 東京 and "quoted text".',
    "First line.\nSecond line.",
    "\nLeading and trailing newlines.\n",
    "  Indented first line.\n  Indented second line.",
    'Contains triple quotes: """ and a trailing backslash \\',
    "Tabs\tand carriage returns\r\nare preserved.",
    "An escaped control character: \u0007",
  ])("round-trips the exact description %j", (description) => {
    const restored = restoreDescriptions(parse("type Query { hello: String }"), {
      Query: description,
    });
    const reparsed = buildASTSchema(parse(print(restored)));
    expect(reparsed.getQueryType()?.description).toBe(description);
  });

  it("keeps applied directives, defaults, and existing descriptions intact", () => {
    const document = parse(`
      directive @label(text: String = "default") on FIELD_DEFINITION
      "Existing type description"
      type Query {
        hello(prefix: String = "Hi"): String @label(text: "A greeting") @deprecated(reason: "Use greetings")
      }
    `);
    const restored = restoreDescriptions(document, {
      "Query.hello": "A greeting field.",
      "Query.hello(prefix:)": "The greeting prefix.",
      "@label(text:)": "The label text.",
    });
    const schema = buildASTSchema(parse(print(restored)));
    expect(schema.getQueryType()?.description).toBe("Existing type description");
    const field = schema.getQueryType()!.getFields().hello;
    expect(field.description).toBe("A greeting field.");
    expect(field.args[0]).toMatchObject({
      description: "The greeting prefix.",
      defaultValue: "Hi",
    });
    expect(field.deprecationReason).toBe("Use greetings");
    expect(print(restored)).toContain('@label(text: "A greeting")');
    expect(schema.getDirective("label")?.args[0]).toMatchObject({
      description: "The label text.",
      defaultValue: "default",
    });
  });
});
