# Releases

The public packages are released as one fixed Changesets group:

- `@relay-dx/schema`
- `@relay-dx/cli`
- `@relay-dx/mcp`

The workspace and `@relay-dx/kitchen-sink` are private and are never published.
The release workflow builds the native schema helper for macOS, Linux, and
Windows, then packs the three public packages. Publishing is gated by the
repository variable `NPM_TRUSTED_PUBLISHING`; until that variable is set to
`true`, the workflow can verify and pack a release without publishing it.

The initial bootstrap is complete: all three public packages are published at
`0.1.0`, and their GitHub trusted-publisher registrations for
`horusdotdev/relay-dx` and `release.yml` have been verified. A fresh registry
installation passed schema extraction and MCP checks, and the repository
variable is now set to `true` for future releases.

## One-time npm bootstrap

The npm package records must exist before npm will accept a trusted-publisher
configuration. The three current package records and registrations are already
bootstrapped at `0.1.0`. Use the following flow only for a newly introduced
package or a future package whose record does not yet exist.

Set `NPM_TRUSTED_PUBLISHING=false` while bootstrapping a new package so the
workflow does not attempt to publish it before its trust registration exists.

1. Confirm the Node and Vite+ prerequisites from the root README, then log in
   to the public npm registry with an account that can publish under the
   `@relay-dx` scope:

   ```sh
   npm whoami --registry=https://registry.npmjs.org
   npm login --registry=https://registry.npmjs.org
   npm whoami --registry=https://registry.npmjs.org
   ```

   On an unconfigured machine, the first `npm whoami` is expected to fail with
   an authentication error. Before this bootstrap, `npm view` for these names
   is expected to report that the new package does not exist.

2. Create and merge the version PR for the new release. A version PR is created
   automatically from `main` when pending changesets are present; inspect it
   with:

   ```sh
   vp run changeset:status
   ```

   The version job runs `vp run version-packages` on the version PR. Merge the
   PR to `main` before continuing.

3. Build the bootstrap release through GitHub Actions. Do not run a local
   build or `vp run release:pack` for this step: a host build would omit the
   other operating systems and CPU architectures. The manual workflow run
   builds all five native targets and is build-only even if
   `NPM_TRUSTED_PUBLISHING` is already enabled:

   ```sh
   rm -rf .release
   gh workflow run release.yml --ref main -f build_only=true
   gh run list --workflow release.yml --limit 5
   gh run watch <run-id>
   gh run download <run-id> -p 'changeset-pack-*' --dir .release
   find .release -type f -name '*.tgz' -print
   ```

   The expected files are under `.release/packages/*.tgz`; artifact downloads
   may add another directory level, so use `find` to locate the actual paths.
   Publish only the new package's tarball manually. Replace the placeholder
   with the matching file printed by `find`:

   ```sh
   npm publish .release/<new-package-tarball>.tgz --access public
   ```

   Verify the package records before configuring trusted publishing:

   ```sh
   npm view <new-package-name> version
   ```

This manual bootstrap is required once for each newly introduced package. Do
not publish a version that already exists; npm versions are immutable.

## npm trusted publishing

Trusted publishing uses GitHub Actions OIDC and is configured per package. It
requires npm CLI 11.15.0 or newer, Node 22.14.0 or newer, npm two-factor
authentication, write access to each package, and an existing package record.
The workflow's Vite+ toolchain uses pnpm 11, whose native npm OIDC support is
used by the Changesets publish job; no long-lived npm token is stored.
See the [npm trusted publishers guide](https://docs.npmjs.com/trusted-publishers/)
and [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust#prerequisites)
for the current requirements.

The current three registrations have been verified. For a newly introduced
package, configure GitHub as its trusted publisher. Use repository
`horusdotdev/relay-dx`, workflow filename `release.yml`, and no GitHub
environment:

```sh
npm trust github <package-name> --repo horusdotdev/relay-dx --file release.yml --allow-publish
```

Check the resulting registrations with:

```sh
npm trust list <package-name>
```

Then restore the repository variable `NPM_TRUSTED_PUBLISHING` to `true` and
run `gh workflow run release.yml --ref main -f build_only=false` to publish
any remaining versions in the release. The workflow requests `contents: write`,
`pull-requests: write`, and `id-token: write` for the jobs that need them. In
the repository settings, enable the option allowing GitHub Actions to create
and approve pull requests. If the repository setting returns HTTP 409 because
the organization policy disallows this capability, an organization owner must
enable the organization-level policy first; only then can the repository-level
setting be enabled. The repository remains private; npm trusted publishing
supports that, but npm provenance is not generated for private repositories,
so the workflow does not pass `--provenance`.

## Normal Changesets flow

For a change to a public package, create a changeset and inspect its effect:

```sh
vp run changeset
vp run changeset:status
```

The version workflow consumes changesets on `main` and opens or updates the
version PR. Because it uses `GITHUB_TOKEN`, GitHub requires a maintainer to
approve the PR's CI run after the bot creates or updates it. Select
**Approve and run** in GitHub, or approve the specific run with
`gh api --method POST repos/horusdotdev/relay-dx/actions/runs/<run-id>/approve`.
See [GitHub's bot-created PR workflow policy](https://github.blog/changelog/2026-06-11-bot-created-pull-requests-can-run-workflows-if-approved/).

On that PR branch, the repository's version script runs:

```sh
vp run version-packages
```

After the version PR is merged, the next `main` release performs native builds,
verification, packing, and (when `NPM_TRUSTED_PUBLISHING=true`) npm publishing.

The local pack and publish helpers are also available for a maintainer working
with already-versioned packages and an assembled five-target native tree:

```sh
vp run release:pack
vp run release:publish
```

`release:pack` requires native helpers for all five release targets; it reports
an actionable error when the tree is incomplete. `release:publish` publishes
packages from `.release` using the current npm credentials. Use these helpers
only when a manual publish is intended; the normal GitHub path uses the
trusted-publisher workflow.

## Workflow outputs

The workflow separates versioning, native compilation, verification, packing,
and publishing. Verification runs on Ubuntu. The native build matrix covers:

| Platform | Architectures |
| -------- | ------------- |
| macOS    | arm64, x64    |
| Linux    | arm64, x64    |
| Windows  | x64           |

The pack job uploads each packed result as an artifact whose name starts with
`changeset-pack-` and keeps it for 30 days. A manual `build_only` run defaults
to this pack-only behavior and never creates a version PR or publishes. To
download all packs from a run:

```sh
gh run download <run-id> -p 'changeset-pack-*' --dir .release
find .release -type f -name '*.tgz' -print
```

Several artifacts may be downloaded into subdirectories, so inspect the output
of `find` and use the package name in each tarball rather than assuming a
single artifact filename. The native helper is included in the schema package
for each target supported by that build. Linux packages are built in an Ubuntu
22.04 container and require glibc 2.35 or newer plus OpenSSL 3 at runtime.
