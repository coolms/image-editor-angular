# Attribution

`@coolms/image-editor` builds on top of one open-source canvas
library. This file acknowledges it and records the license under
which it is used. The entry is MIT-compatible with CoolMS's own
MIT license.

## fabric.js

- **Project**: `fabric`
- **Version**: `^6.9.1` (peer dependency)
- **Copyright**: Printio (Juriy Zaytsev, Maxim Chernyak) and the
  fabric.js contributors
- **License**: MIT
- **Repository**: https://github.com/fabricjs/fabric.js
- **Role**: Provides the canvas rendering surface (`Canvas`), the
  image object (`FabricImage`), interactive corner / rotation
  controls, and the filter pipeline (WebGL primary, Canvas2D
  fallback) wrapped by `FabricEngineAdapter`. Imported via
  `from 'fabric/es'` for tree-shaking.
- **Notes**: zero runtime dependencies, ESM-first, Promise-based
  image loading, ships its own TypeScript types.

## Why this file exists

Even though every dependency is MIT and CoolMS itself ships under
MIT, the project policy is to track each transitive vendor surfaced
through public-facing packages. When `@coolms/image-editor` is
consumed by downstream CoolMS deployments, this file documents the
upstream chain without forcing operators to crawl `node_modules` to
assemble it.

## History

Prior to (May 3-4, 2026) this package wrapped Toast UI
Image Editor in headless mode. Toast UI in turn embedded fabric.js
v4. replaced the Toast UI layer with a direct
`FabricEngineAdapter` against fabric.js v6, and removed the
`tui-image-editor`, `tui-color-picker`, and `tui-code-snippet`
dependencies. See `docs/adr/079-toast-ui-rejection.md` for the
rationale and `docs/adr/081-image-editor-engine-swap.md` for the
journey. Toast UI Image Editor was MIT-licensed (NHN Cloud Corp,
https://github.com/nhn/tui.image-editor).
