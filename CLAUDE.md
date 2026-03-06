# CLAUDE.md - InstaWP CLI

## Overview

TypeScript CLI for InstaWP. Lets users create/manage WordPress sites from the terminal.

- **Stack**: TypeScript, ESM, Commander.js, Axios, Node 18+
- **Package**: `@instawp/cli` on npm (scoped, public)
- **Entry**: `src/index.ts` → compiled to `dist/index.js`
- **Binary**: `instawp` (registered via `bin` in package.json)

## Project Structure

```
src/
├── index.ts                 # CLI entry point, command registration
├── types.ts                 # All TypeScript interfaces
├── commands/
│   ├── login.ts             # OAuth browser flow + --token
│   ├── whoami.ts            # Show current session
│   ├── sites.ts             # sites list/create/delete + top-level create alias
│   ├── exec.ts              # exec + wp commands (merged, --api/--ssh transport)
│   ├── ssh.ts               # Interactive SSH shell
│   ├── sync.ts              # rsync push/pull via SSH
│   └── teams.ts             # teams list/members
├── lib/
│   ├── api.ts               # Axios client, auth interceptor, 401/429 handling
│   ├── auth.ts              # OAuth flow (local HTTP server for callback)
│   ├── config.ts            # Conf-based persistent config (~/.config/instawp/)
│   ├── output.ts            # chalk/ora output helpers, --json mode
│   ├── site-resolver.ts     # Resolve site by ID, name, or domain
│   ├── ssh-keys.ts          # SSH key generation, upload, caching
│   └── ssh-connection.ts    # SSH/rsync spawn helpers
└── __tests__/               # Vitest tests (148 tests)
```

## Commands

```
instawp login [--token <t>] [--api-url <url>]
instawp whoami
instawp sites list [--status <s>] [--page <n>]
instawp sites create --name <n> [--php <v>] [--config <id>]
instawp create --name <n>                    # alias for sites create
instawp sites delete <site> [--force]
instawp exec <site> <cmd...> [--api] [--timeout <s>]
instawp wp <site> <args...> [--api]          # shorthand: prepends `wp` to args
instawp ssh <site>
instawp sync push <site> [--path] [--exclude] [--dry-run]
instawp sync pull <site> [--path] [--exclude] [--dry-run]
instawp teams list
instawp teams members <team>
```

All commands support `--json` for machine-readable output.

## Key Design Decisions

### exec + wp merged (single transport flag)
- `exec` runs any command; `wp` is sugar that prepends `wp`
- `--ssh` (default): real SSH connection, proper exit codes, real-time output
- `--api`: uses `POST /sites/{id}/run-cmd` API → cloud-app → InstaCP `v-instawp-run-cmd`
- Both transports can run arbitrary commands (API is not WP-only despite the name)

### Site resolution
- `resolveSite()` accepts ID (numeric), name, or domain
- Numeric → direct `GET /sites/{id}/details`
- String → fetches list, matches by name/sub_domain/domain, then fetches details
- Errors on zero matches or ambiguous multiple matches

### SSH key management
- Auto-generates RSA 4096 key at `~/.instawp/cli_key` if needed
- Checks existing keys (`~/.ssh/id_rsa`, `id_ed25519`) first
- Uploads to InstaWP API, enables SSH+SFTP on site, attaches key
- Caches connection details for 1 hour in conf store

### Config storage
- Uses `conf` package → `~/.config/instawp/config.json`
- Env overrides: `INSTAWP_TOKEN`, `INSTAWP_API_URL`
- SSH cache with TTL stored alongside auth config

## API Endpoints Used

| Endpoint | Used By |
|----------|---------|
| `GET /api/v2/sites` | sites list, site resolver |
| `GET /api/v2/sites/{id}/details` | site resolver |
| `POST /api/v2/sites` | sites create |
| `DELETE /api/v2/sites/{id}` | sites delete |
| `POST /api/v2/sites/{id}/run-cmd` | exec --api, wp --api |
| `GET /api/v2/tasks/{id}/status` | create (poll provisioning) |
| `GET /api/v2/ssh-keys` | SSH key matching |
| `POST /api/v2/ssh-keys` | SSH key upload |
| `POST /api/v2/sites/{id}/ssh-keys/{keyId}` | attach key to site |
| `POST /api/v2/sites/{id}/update-ssh-status` | enable SSH |
| `POST /api/v2/sites/{id}/update-sftp-status` | enable SFTP |
| `GET /api/v2/teams` | teams list, whoami |
| `GET /api/v2/teams/{id}/members` | teams members |

## Development

```bash
npm install          # Install deps
npm run dev          # Watch mode (tsc --watch)
npm run build        # Build to dist/
npm test             # Run vitest (148 tests)
npm run test:watch   # Watch mode tests
```

### Testing locally
```bash
npm run build
node dist/index.js --help
node dist/index.js login --token <test-token>
node dist/index.js sites list
```

Or link globally:
```bash
npm link
instawp --help
```

## Publishing

**Workflow**: Push a `v*` tag → GitHub Actions builds, tests, publishes to npm.

```bash
# Bump version in package.json, then:
git tag v0.0.1-beta.1
git push origin v0.0.1-beta.1
```

- Publishes with `--tag beta` (install via `npm i -g @instawp/cli@beta`)
- Uses `NPM_TOKEN` secret (generated from vikas@instawp.com npm account)
- Remove `--tag beta` from workflow for stable releases

## Conventions

- All imports use `.js` extension (ESM requirement)
- `process.exit(1)` on fatal errors after printing message via `error()`
- Spinners stop before printing output (no interleaved text)
- JSON mode returns `{ success, data }` or `{ success: false, error }`
- Version reads from package.json at runtime (single source of truth)
