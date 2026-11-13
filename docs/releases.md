# Releases

`@relay-dx/schema`, `@relay-dx/cli`, `@relay-dx/mcp` and `@relay-dx/store` share one
fixed Changesets group. The workspace and kitchen-sink fixture are private.

## Normal release

```sh
vp run changeset
vp run changeset:status
```

Merge the changeset. The workflow opens a version PR; approve its CI run if GitHub
requires it. Merge that PR to build, verify, pack and publish the release.
Publishing requires `NPM_TRUSTED_PUBLISHING=true` and a trusted publisher for each
package. Versioning runs `vp run version-packages` in the version PR.

## Build-only packs

```sh
gh workflow run release.yml --ref main -f build_only=true
gh run list --workflow release.yml --limit 5
gh run download <run-id> -p 'changeset-pack-*' --dir .release
```

Build-only runs never publish or create version PRs. Tarballs are under downloaded
artifacts' `packages/` directories; packs are retained for 30 days.

Verification runs on Ubuntu. Native builds cover macOS arm64/x64, Linux arm64/x64
and Windows x64. Linux targets use Ubuntu 22.04: glibc 2.35+ and OpenSSL 3.
Packed-install checks verify native helpers, CLI commands, generation, declarations
and a compiled store consumer.

## First publish of a new package

The store was bootstrapped at `0.1.3` and has a trusted publisher for `release.yml`.
Future new packages need an initial npm publication before registering trust:

1. Build, verify and pack the new package outside the fixed group. Workspace
   dependencies must resolve to already-published versions.
2. Log in with permission for `@relay-dx`, publish and register trust:

   ```sh
   npm login
   npm publish <tarball>.tgz --access public
   npm trust github @relay-dx/<package> --repo horusdotdev/relay-dx --file release.yml --allow-publish
   npm trust list @relay-dx/<package>
   ```

3. Verify the registry install, then add the package to the fixed group in
   `.changeset/config.json`. Subsequent releases use the normal workflow.

Versions are immutable. The store tarball contains JavaScript and declarations;
native helpers come from the already-published schema dependency. Schema-package
releases still require five-target workflow packs. Trusted publishing uses OIDC;
see [npm prerequisites](https://docs.npmjs.com/trusted-publishers/).

## Local checks

```sh
vp run smoke:store
vp run release:pack
```

`smoke:store` checks a host-platform tarball install after building. `release:pack`
requires all five native binaries assembled by `scripts/assemble-native.mjs`.
`vp run release:publish` publishes already-versioned packs from `.release` using
current credentials; the normal workflow handles publishing automatically.
