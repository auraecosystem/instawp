# InstaWP CLI

Create and manage WordPress sites from the terminal.

```
npm install -g @instawp/cli
```

> **Beta** - This is an early release. Report issues at [github.com/InstaWP/cli/issues](https://github.com/InstaWP/cli/issues).

## Quick Start

```bash
# Authenticate (opens browser)
instawp login

# Or use an API token (for CI/CD)
instawp login --token <your-api-token>

# Check your session
instawp whoami
```

## Commands

### Sites

```bash
# List all sites
instawp sites list

# Create a new site (waits for provisioning by default)
instawp create --name my-site
instawp create --name my-site --php 8.3

# Delete a site
instawp sites delete <site>
instawp sites delete <site> --force
```

### Run Commands

```bash
# Run any command on a site (via SSH, default)
instawp exec <site> ls -la
instawp exec <site> php -v
instawp exec <site> cat wp-config.php

# Run via API instead of SSH (no SSH setup needed)
instawp exec <site> ls -la --api

# WP-CLI shorthand (prepends `wp` automatically)
instawp wp <site> plugin list
instawp wp <site> option get siteurl
instawp wp <site> user list --api
```

`<site>` can be a site **ID**, **name**, or **domain** — the CLI resolves it automatically.

### SSH

```bash
# Open an interactive SSH session
instawp ssh <site>
```

The CLI manages SSH keys automatically — it generates a key, uploads it, and caches the connection.

### Sync (rsync)

```bash
# Push local wp-content to remote
instawp sync push <site> --path ./wp-content/

# Pull remote wp-content to local
instawp sync pull <site>

# Dry run first
instawp sync push <site> --dry-run
```

### Teams

```bash
instawp teams list
instawp teams members <team>
```

## JSON Output

Add `--json` to any command for machine-readable output:

```bash
instawp sites list --json
instawp create --name test-site --json
instawp exec <site> wp option get siteurl --json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INSTAWP_TOKEN` | API token — skips `instawp login` |
| `INSTAWP_API_URL` | Custom API base URL |

### CI/CD Example

```bash
export INSTAWP_TOKEN=${{ secrets.INSTAWP_TOKEN }}

# Create a preview site for a PR
instawp create --name "pr-$PR_NUMBER" --json

# Run a smoke test
instawp wp "pr-$PR_NUMBER" option get siteurl

# Clean up
instawp sites delete "pr-$PR_NUMBER" --force
```

## Requirements

- Node.js 18+
- `ssh` and `ssh-keygen` (for SSH/exec commands)
- `rsync` (for sync commands)

## License

MIT
