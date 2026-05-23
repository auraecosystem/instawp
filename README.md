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

# Re-fetch admin credentials + Magic Login URL
instawp sites creds <site>

# Open the site (or admin / magic login) in your browser
instawp open <site>
instawp open <site> --admin
instawp open <site> --magic

# Delete a site
instawp sites delete <site>
instawp sites delete <site> --force
```

### Run Commands (WP-CLI + shell)

`wp` is the **primary** command for interacting with a remote site. `exec` is the escape hatch for non-WP shell commands.

```bash
# WP-CLI on a remote site
instawp wp <site> plugin list
instawp wp <site> option get siteurl
instawp wp <site> user list --api

# Pass raw args to WP-CLI with --
instawp wp <site> -- post list --post_type=page --format=json

# eval / PHP payloads — wrap in single quotes; args are shell-escaped for you
instawp wp <site> eval '\MyClass::init(["force" => true]);'

# Escape hatch for non-WP commands
instawp exec <site> ls -la
instawp exec <site> php -v
instawp exec <site> cat wp-config.php

# --api transport (no SSH setup required)
instawp exec <site> php -v --api
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

### Database (mysqldump)

`db push` always backs up the remote database before overwriting (use `--no-backup` to skip).

```bash
# Pull remote DB to a gzipped SQL dump
instawp db pull <site>
instawp db pull <site> --output ./backup.sql.gz
instawp db pull <site> --no-compress      # write .sql instead of .sql.gz

# Push a local dump back (auto-backs up the remote first)
instawp db push <site> ./backup.sql.gz
instawp db push <site> ./backup.sql --force   # skip confirmation
```

### Logs

```bash
# Tail the WP debug.log (default)
instawp logs <site>
instawp logs <site> --follow             # tail -f

# Tail PHP-FPM or nginx error logs
instawp logs <site> --php
instawp logs <site> --nginx
instawp logs <site> --php --nginx -f     # multi-tail

# Custom line count
instawp logs <site> --lines 500
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
instawp sites creds <site> --json
instawp wp <site> option get siteurl --json
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
