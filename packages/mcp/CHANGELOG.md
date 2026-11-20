# @relay-dx/mcp

## 0.6.0

### Patch Changes

- @relay-dx/schema@0.6.0

## 0.5.0

### Patch Changes

- 38db6bb: Add typed operation payload reads, shallow record copies, connection linking,
  live record ID enumeration and type/interface/union scans, dynamic field accessors, and a standalone connection
  ID helper. Regenerate store metadata to enable mutation and subscription root
  field reads. Accept GraphQL 17 alongside supported GraphQL 16 releases.
- Updated dependencies [38db6bb]
  - @relay-dx/schema@0.5.0

## 0.4.0

### Patch Changes

- Share GraphQL through a peer dependency with schema and store to avoid duplicate
  module instances when installing the packages together.
- Updated dependencies [db3eca6]
  - @relay-dx/schema@0.4.0

## 0.3.1

### Patch Changes

- @relay-dx/schema@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [59bb289]
  - @relay-dx/schema@0.3.0

## 0.2.0

### Patch Changes

- 04e1453: Add the typed Relay store package and `relay-store` generator command, including
  documented direct field accessors, scoped reads and updaters, and connection
  helpers. Ship built ESM and TypeScript declarations and document installation,
  every public CLI option, and consumer examples. Add MCP command version output.
  Preserve executable permissions for native helpers in single-platform source packs.
- Updated dependencies [04e1453]
  - @relay-dx/schema@0.2.0

## 0.1.3

### Patch Changes

- d37fb9f: Keep the MCP server connected when a worktree's schema is missing and automatically reload schema, extension, resolver source, and Relay config changes. Preserve the last valid schema when a reload fails, and recover when the files become valid again.
- Updated dependencies [d37fb9f]
  - @relay-dx/schema@0.1.3

## 0.1.2

### Patch Changes

- 97df625: Include package-specific READMEs with installation, usage, API references, compatibility requirements, and troubleshooting in published packages.
- Updated dependencies [97df625]
  - @relay-dx/schema@0.1.2

## 0.1.1

### Patch Changes

- 7f3ed0f: Distribute Relay schema extraction and MCP tools through npm with native helpers
  for macOS, Linux, and Windows.
- Updated dependencies [7f3ed0f]
  - @relay-dx/schema@0.1.1
