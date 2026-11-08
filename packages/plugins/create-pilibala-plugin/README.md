# @pilibalaai/create-pilibala-plugin

Scaffolding tool for creating new Pilibala plugins.

```bash
npx @pilibalaai/create-pilibala-plugin my-plugin
```

Or with options:

```bash
npx @pilibalaai/create-pilibala-plugin @acme/my-plugin \
  --template connector \
  --category connector \
  --display-name "Acme Connector" \
  --description "Syncs Acme data into Pilibala" \
  --author "Acme Inc"
```

Supported templates: `default`, `connector`, `workspace`  
Supported categories: `connector`, `workspace`, `automation`, `ui`

Generates:
- typed manifest + worker entrypoint
- example UI widget using the supported `@pilibalaai/plugin-sdk/ui` hooks
- test file using `@pilibalaai/plugin-sdk/testing`
- `esbuild` and `rollup` config files using SDK bundler presets
- dev server script for hot-reload (`pilibala-plugin-dev-server`)

The scaffold starts with plain React elements so the generated plugin stays minimal. For Pilibala-native controls, import shared host components such as `MarkdownEditor`, `FileTree`, `AssigneePicker`, and `ProjectPicker` from `@pilibalaai/plugin-sdk/ui`.

Inside this repo, the generated package uses `@pilibalaai/plugin-sdk` via `workspace:*`.

Outside this repo, the scaffold snapshots `@pilibalaai/plugin-sdk` from your local Pilibala checkout into a `.pilibala-sdk/` tarball and points the generated package at that local file by default. You can override the SDK source explicitly:

```bash
node packages/plugins/create-pilibala-plugin/dist/bin.js @acme/my-plugin \
  --output /absolute/path/to/plugins \
  --sdk-path /absolute/path/to/pilibala/packages/plugins/sdk
```

That gives you an outside-repo local development path before the SDK is published to npm.

## Workflow after scaffolding

```bash
cd my-plugin
pnpm install
pnpm dev       # watch worker + manifest + ui bundles
pnpm dev:ui    # local UI preview server with hot-reload events
pnpm test
```
