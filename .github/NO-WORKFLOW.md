# No CI workflow here, and why

This repository has no `.github/workflows`. That is a decision, and this file is
it -- so the absence is on record rather than looking like an oversight.

An empty `.github/workflows` directory is worse than no directory: it reads as a
promise of a check with nothing behind it, and git cannot track an empty
directory anyway, so it is invisible to everyone except whoever is looking at
that working copy. The release tooling refuses on both states by name.

## What this package has to run

- **own specs:** 0
- **scripts:** `build`, `clean`, `lint`, `typecheck`

## Why none of it can run here yet

Measured from a clean checkout -- the git-tracked files only, copied into an
empty directory in a container with no sibling packages visible, which is what
CI gets:

```
npm install
npm error 404 Not Found - GET https://registry.npmjs.org/@coolms%2fcore-angular
```

npm auto-installs peer dependencies, so an **unpublished peer 404s the whole
install as hard as a dependency would**. This package declares these `@coolms/*`
peers, and none of them is published:

- `@coolms/ui-angular`

⚠️ **Correction.** An earlier version of this file called
`Cannot find module 'fabric/es'` a second, independent problem that publishing
the peers would not fix. That was wrong, in both halves.

`fabric` is a **peer** dependency here, and `--legacy-peer-deps` -- the flag used
to get past the unpublished `@coolms` peers -- does not install peers at all, so
the module was simply absent from the tree. `fabric` 7.3.1 declares `./es` in its
`exports`, so the import is correct, and there was no fabric directory in the
test tree to resolve it against.

Same cause as the `@coolms` peers, arriving from a third-party package: a plain
`npm install` installs it. Nothing separate to fix.

A workflow added today would be red on its first run, or would have to be
written around the failure -- a green check that verifies nothing, which is the
one thing worse than no check.

## What does cover this package

This package has no specs of its own. It is exercised only through the admin application, which is to say it has no test coverage that a workflow here could run even if the install worked.

## What would unblock it

Publishing the `@coolms/*` packages to npm. That is gated on `private: true`
being lifted in their manifests -- a decision, not a missing file. Once the
peers resolve, this repository can install standalone, the workflow becomes a
real gate, and branch protection can follow it.

## The consequence, stated plainly

Until then this repository has **no gate**: code reaches `develop` with nothing
standing in the way. Branch protection cannot substitute for it, because a
required status check that no workflow ever produces blocks every pull request
forever.
