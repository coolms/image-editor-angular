# Changelog

All notable changes to `@coolms/image-editor-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the version named below, which is what the registry
currently serves. Earlier alphas are deliberately not reconstructed: entries are written
in the same commit as the work they describe, and inventing the ones that
predate this file would be a worse record than not having them.

## 2.0.0-alpha.3 -- 2026-09-03

**A pre-release, carrying no compatibility promise.** Published under the
`alpha` dist-tag.

The image editor: a fabric.js v6 engine behind a framework-agnostic adapter,
with transform tools (crop, rotate, flip, resize), seven filters, insert tools
(shapes, text, mask), a layers panel over the object stack, and a save flow
wired to the Media Library and the VFS.

The adapter is the reason the engine could be replaced without touching the UI
shell or any tool component, and it is why the editor loads as its own lazy
chunk.

### Fixed

- The Shapes tool had no icon. Its class named an icon Bootstrap Icons does not
  define, which renders nothing and reports nothing -- measured, it behaved
  identically to a class invented at random.
- The roadmap listed Shapes as planned when it ships, and the feature list
  omitted the insert tools entirely.
- The licence section pointed at `ATTRIBUTION.md`, which the package did not
  copy into the tarball. The file now ships.
- The package described itself as being for "CoolMS DXP", which is not what the
  platform is called, and claimed the package was framework-agnostic when it is
  the engine adapter behind it that is.
