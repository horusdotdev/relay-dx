# @relay-dx/schema

## 0.2.0

### Patch Changes

- 04e1453: Add the typed Relay store package and `relay-store` generator command, including
  documented direct field accessors, scoped reads and updaters, and connection
  helpers. Ship built ESM and TypeScript declarations and document installation,
  every public CLI option, and consumer examples. Add MCP command version output.
  Preserve executable permissions for native helpers in single-platform source packs.

## 0.1.3

### Patch Changes

- d37fb9f: Keep the MCP server connected when a worktree's schema is missing and automatically reload schema, extension, resolver source, and Relay config changes. Preserve the last valid schema when a reload fails, and recover when the files become valid again.

## 0.1.2

### Patch Changes

- 97df625: Include package-specific READMEs with installation, usage, API references, compatibility requirements, and troubleshooting in published packages.

## 0.1.1

### Patch Changes

- 7f3ed0f: Distribute Relay schema extraction and MCP tools through npm with native helpers
  for macOS, Linux, and Windows.
