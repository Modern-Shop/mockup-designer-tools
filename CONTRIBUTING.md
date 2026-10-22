# Contributing

Thanks for helping make Mockup Studio better!

1. Fork the repo and create a branch: `git checkout -b feature/text-layers`
2. `npm ci`, then `npm run dev`
3. Keep `npm run check`, `npm test` and `npm run build` green, and run **tests/browser.html** for changes to rendering, the editors or 3D
4. Open a pull request with a short description and, for visual changes, a screenshot or GIF

Before you start, read [AGENTS.md](AGENTS.md): it lists the rules every change keeps, such as no global CSS (everything stays inside the Shadow DOM and uses the `mdt-` prefix), no admin or 3D code in the shopper's first download, and every visible string translated in all catalogs under `src/locales/`.

Ideas and bugs are welcome as [issues](../../issues). New generated products are a great first contribution:
add a builder in `src/meshes.ts`, its parts and defaults in `src/core.ts` and `src/presets.ts`, and a sample in `demo/fixtures.ts`.
See the [integration guide](docs/INTEGRATION.md) for how the pieces fit together.
