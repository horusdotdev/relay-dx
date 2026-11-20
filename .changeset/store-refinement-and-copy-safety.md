---
"@relay-dx/store": minor
---

Exclude Relay resolver-cache links from record copies so different records do not
share source-owned evaluations. Regenerated metadata also identifies dangling
resolver links. Add a schema-checked connection ID overload, concrete record
unions for accessing common member fields, and read-only cached type refinements.
Document lookup and copy typename checks and the legacy untyped connection ID form.
