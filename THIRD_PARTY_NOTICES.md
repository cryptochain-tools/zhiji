# Third-party notices

Zhiji is built with third-party dependencies declared in the workspace package
manifests and pinned in `pnpm-lock.yaml`. Their licenses are not replaced by
Zhiji's repository license. Installers and redistributors must retain notices
required by those dependencies.

Notable direct dependencies include React, Vite, Egg, PostgreSQL client
libraries, Radix UI, Base UI, Lucide, Tailwind CSS and TypeScript. Their exact
versions and transitive dependencies are the authoritative lockfile inventory.

The source snapshots in `packages/zhiji-design` and `packages/zhiji-theme`
have separate provenance described in `NOTICE` and their `UPSTREAM.md` files.
They are not dependencies pulled from a local Earntools checkout.

Before a release, generate a versioned dependency-license report from the
locked production dependency tree and append any notices required by that
report to the release artifact.
