# Plugin Authoring Smoke Example

A Pilibala plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

## Install Into Pilibala

```bash
npx pilibalaai plugin install ./
```

## Build Options

- `pnpm build` uses esbuild presets from `@pilibalaai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
