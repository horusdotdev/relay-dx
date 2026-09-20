# Relay compiler kitchen sink

This is a deliberately small Relay project with a complete server schema, a
client schema extension, and resolver docblocks. It is used as a fixture for
Relay schema extraction and MCP inspection. The project is expected to compile
with Relay Compiler 21.0.1:

```sh
npm install
npm run relay
```

The server schema covers interfaces, unions, enums, input objects, custom
scalars, connections, deprecations, and descriptions. `client-schema.graphql`
adds a client-only field to a server type. `src/resolvers.ts` covers
strong and weak client models, a resolver with runtime arguments, a derived
resolver with a root fragment, a live resolver, and the modern `@relayField`
syntax introduced in Relay 21.
