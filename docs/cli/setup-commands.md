---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `pilibalaai run`

One-command bootstrap and start:

```sh
pnpm pilibalaai run
```

Does:

1. Auto-onboards if config is missing
2. Runs `pilibalaai doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
npx pilibalaai run --instance dev
```

## `pilibalaai onboard`

Interactive first-time setup:

```sh
pnpm pilibalaai onboard
```

If Pilibala is already configured, rerunning `onboard` keeps the existing config in place. Use `pilibalaai configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm pilibalaai onboard --run
```

Quickstart defaults + immediate start:

```sh
pnpm pilibalaai onboard --yes
```

When onboarding starts Pilibala from an interactive terminal, it opens the
onboarding page in your browser once. Non-interactive terminals stay silent.
Suppress browser opening explicitly for headless or automated runs with either
environment variable:

```sh
PILIBALA_NO_BROWSER=1 pnpm pilibalaai onboard --yes
PILIBALA_OPEN_ON_LISTEN=false pnpm pilibalaai onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Pilibala with that setup.

## `pilibalaai doctor`

Health checks with optional auto-repair:

```sh
pnpm pilibalaai doctor
pnpm pilibalaai doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration, including AWS Secrets Manager non-secret env
  config when selected
- Storage configuration
- Missing key files

## `pilibalaai configure`

Update configuration sections:

```sh
pnpm pilibalaai configure --section server
pnpm pilibalaai configure --section secrets
pnpm pilibalaai configure --section storage
```

`--section secrets` updates the deployment-level provider used as the fallback
for secrets that do not target a specific company vault. Per-company provider
vaults (named instances, default vault selection, multiple vaults per provider,
coming-soon GCP/Vault) live in the board UI under
`Company Settings → Secrets → Provider vaults` and the
`/api/companies/{companyId}/secret-provider-configs` API.

## `pilibalaai env`

Show resolved environment configuration:

```sh
pnpm pilibalaai env
```

This now includes bind-oriented deployment settings such as `PILIBALA_BIND` and `PILIBALA_BIND_HOST` when configured.

## `pilibalaai allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
npx pilibalaai allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.pilibala/instances/default/config.json` |
| Database | `~/.pilibala/instances/default/db` |
| Logs | `~/.pilibala/instances/default/logs` |
| Storage | `~/.pilibala/instances/default/data/storage` |
| Secrets key | `~/.pilibala/instances/default/secrets/master.key` |

Override with:

```sh
PILIBALA_HOME=/custom/home PILIBALA_INSTANCE_ID=dev pnpm pilibalaai run
```

Or pass `--data-dir` directly on any command:

```sh
npx pilibalaai run --data-dir ./tmp/pilibala-dev
npx pilibalaai doctor --data-dir ./tmp/pilibala-dev
```
