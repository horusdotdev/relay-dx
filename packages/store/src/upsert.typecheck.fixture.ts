import type { Environment } from "relay-runtime";
import { store } from "../fixtures/__generated__/store.js";

/** Compiled by tsc; intentionally invalid examples are never executed. */
export function checkUpserts(environment: Environment): void {
  store.updater(environment, (view) => {
    const userValues = { id: "author", name: "Ada", friends: [], tags: [] };
    const post = view.upsert("Post", {
      id: "post",
      title: "Hello",
      author: view.upsert("User", userValues),
    });
    post.title.set("Updated");
    // @ts-expect-error Selected non-null linked fields are required.
    view.upsert("Post", { id: "missing-author", title: "Hello" });
    // @ts-expect-error Upsert replaced create.
    view.create("Post", { id: "old" });
    // @ts-expect-error Identity belongs in the initializer.
    view.upsert("Post", "old-id", { title: "Hello" });
    view.upsert("User", { ...userValues, constructor: "Own field" });
    const invalidConstructor = { ...userValues, constructor: 42 };
    // @ts-expect-error Optional fields named constructor still have their schema type.
    view.upsert("User", invalidConstructor);
    const unknownField = { ...userValues, typo: "No" };
    // @ts-expect-error Unknown initializer fields are rejected.
    view.upsert("User", unknownField);

    const required = {
      title: "Hello",
      semantic: "Present",
      conditional: "Present",
      requiredLabel: "Present",
      strictItems: [],
      nested: [],
    };
    // Argumented and unselected non-null fields can be omitted.
    view.upsert("CreationFixture", { id: "required", ...required });
    view.upsert("CreationFixture", { id: "matrix", ...required, nested: [null, [1, 2]] });
    view.upsert("CreationFixture", {
      id: "argumented",
      ...required,
      argumented: { args: { locale: "en" }, value: "Hello" },
    });
    // @ts-expect-error Semantic non-null and @required selections contribute requirements.
    view.upsert("CreationFixture", { id: "incomplete", title: "Hello" });
    const badItems = { id: "bad-items", ...required, items: [null] };
    // @ts-expect-error Semantic non-null list items cannot be null.
    view.upsert("CreationFixture", badItems);
    const badMatrix = { id: "bad-matrix", ...required, nested: [[null]] };
    // @ts-expect-error Semantic nullability applies independently to nested list levels.
    view.upsert("CreationFixture", badMatrix);
    const badArguments = { id: "bad-args", ...required, argumented: { value: "Hello" } };
    // @ts-expect-error Argument values are required if an argumented initializer is supplied.
    view.upsert("CreationFixture", badArguments);
    const badBody = {
      id: "bad-body",
      title: "Hello",
      author: view.get("User", "author")!,
      body: null,
    };
    // @ts-expect-error An unselected non-null field is optional but cannot be null when supplied.
    view.upsert("Post", badBody);
  });
}
