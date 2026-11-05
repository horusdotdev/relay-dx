# @relay-dx/mcp

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
