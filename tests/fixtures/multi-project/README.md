# Multi-project Relay fixture

This fixture exercises Relay's multi-project configuration. The `app` project
uses `base` as its `base` project, so its documents can reference the shared
server field and client schema extension while the base document only produces
the base project's artifacts. Run it with Relay Compiler 21.0.1:

```sh
relay-compiler relay.config.json
```

Generated files under `base/__generated__` and `app/__generated__` are test
outputs and are intentionally ignored.
