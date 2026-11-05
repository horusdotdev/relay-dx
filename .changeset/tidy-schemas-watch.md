---
"@relay-dx/mcp": patch
"@relay-dx/schema": patch
---

Keep the MCP server connected when a worktree's schema is missing and automatically reload schema, extension, resolver source, and Relay config changes. Preserve the last valid schema when a reload fails, and recover when the files become valid again.
