# Changelog

All notable changes to `@coolms/image-editor-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the version named below, which is what the registry
currently serves. Earlier alphas are deliberately not reconstructed: entries are written
in the same commit as the work they describe, and inventing the ones that
predate this file would be a worse record than not having them.

## Unreleased

### Added

- **A tool rail on the left and a properties panel on the right.** The rail
  draws the tools in their groups (Transform, Insert, Filters, Layers), with
  their names or as icons whose names and shortcuts are tooltips; the
  person switches at its foot, and the host remembers the choice through
  `IMAGE_EDITOR_RAIL_MODE` (for this page load when it provides none). The
  active tool is always scrolled into view. The panel shows the active
  tool's properties under its name, or, with no tool, the image's own: its
  size, its format and how many layers it has.
- **Each tool has a shortcut**: C crop, R rotate, F flip, I resize, M mask,
  U shapes, T text, L layers. A tool's key selects it and, when it is the
  active one, closes it; only while the editor has the keyboard, never from a
  field, and never with Ctrl, Alt or Meta.
- **The editor's text goes through keys.** `IMAGE_EDITOR_TRANSLATOR` answers
  them; without a host translator the base catalogue's English does
  (`IMAGE_EDITOR_MESSAGES`), and `catalogueTranslator()` puts a host's
  catalogue in front of it, never showing a key or an empty label for a
  message it lacks or holds blank.
- **`src/core/` holds the tools and the text as data, with no framework**, so
  a React host uses them as they are; a lint rule refuses any import there
  from outside it, and any package at all.
- Delete acts on the editor's own selection: it removes the selected shape or
  text layer, and does nothing when nothing, or the base image, is selected.
  It is bound to the editor's own layer through the keyboard scope, so it never
  reaches a page beneath the editor. Needs `@coolms/ui-angular` 2.0.0-alpha.4.
- A save names the version it opened (`If-Match`): when the image changed
  meanwhile (412) or was deleted (404), the editor says so and offers Save as,
  never writing over the newer file or making the deleted one again; a change
  made elsewhere is said at once, through the host's `VFS_NODE_WATCH`. Needs
  `@coolms/ui-angular` with `VFS_NODE_WATCH`.
- Declares `bugs` so a page imported from this package, and the catalogue,
  know where a correction is filed. The registry filled the gap from GitHub when
  the manifest was silent; the declared field is the one that holds on any
  registry.

### Changed

- The right sidebar is gone: tools are picked on the rail and their properties
  shown in the panel. A tool registers a name key, a group, an order and a
  shortcut instead of a label and a category.
- The version an overwrite names is the version of the pixels the editor
  opened: the host reads the file's bytes and takes their version from the
  same response (its `ETag`). The listing's version, a separate and earlier
  read, is no longer part of the VFS host data (`node.version` is removed). A
  file changed between the listing and the open is edited as it is now, and
  bytes served from a cache name their own older version, so saving them over
  the newer file is refused. A read that names no version leaves Save off;
  Save as still works.
- The same for a media asset: given `asset.sourceUrl`, the host reads the
  asset's bytes and their version from one response, and the replace names
  that version (`If-Match`, which the replace now requires). An asset replaced
  meanwhile (412) or deleted (404) is not overwritten: the editor says so and
  offers Save as. Without `sourceUrl` the image is shown from `originalUrl`,
  which names no version, and Save is off.

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

- **Save overwrites only a PNG or a JPEG.** Save wrote JPEG bytes over every
  source that was not a PNG: an SVG's vectors became pixels, a GIF lost its
  animation, and the file's name and type no longer said what it held. Save
  now overwrites only a PNG or a JPEG, which the editor writes back in the
  same format; every other format -- GIF, SVG, TIFF, HEIC, BMP, and WebP until
  its export is verified in every supported browser -- has Save as only, and
  the Save button says why. A JPEG whose edit gained transparent areas is not
  written over as PNG under its name: Save says so and opens Save as.
  `writtenBackAs(mimeType)` names the format Save writes a source back as.
- **A photo is saved upright.** Its EXIF orientation is applied when the
  editor opens it, so the saved pixels are turned upright themselves. The
  export carries no EXIF of its own; a JPEG export embeds an sRGB colour
  profile, a PNG export none. The canvas the editor draws on is sRGB: a
  Display P3 photo saved as JPEG loses its own profile, and its colours
  beyond sRGB are clipped (measured, not yet changed). On a JPEG overwrite, a CoolMS backend that
  carries the replaced photo's EXIF into the new file keeps the camera, the
  dates and the location, sets the orientation to normal and removes the stale
  embedded thumbnail. The location is kept: removing it is an action of its
  own, never a side effect of a save.
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
