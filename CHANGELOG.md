# Changelog

## 0.0.1-beta.8 (2026-05-23)

### Bug Fixes (Windows)
- Moved bundled Windows binaries from `bin/win32/` to `vendor/win32/`. With `bin/` and the `bin` field in package.json both set, npm's global install on Windows dropped the `bin/win32/` subdirectory — leaving the CLI unable to find rsync.exe at runtime. macOS/Linux installs were unaffected. Renaming sidesteps the collision entirely.

## 0.0.1-beta.7 (2026-05-23)

### Internals
- Smoke-windows CI job now runs the bundled `rsync.exe` and `busybox.exe` directly from the workspace bundle **before** the npm-install step, so a passing smoke test proves the DLL chain is correct independent of whether antivirus interferes with the global install path.
- Adds Windows Defender exclusions before `npm i -g` to prevent msys DLLs from being quarantined during install.
- Publish job now skips on `workflow_dispatch` (manual triggers), so maintainers can re-test the smoke job without bumping the version.

## 0.0.1-beta.6 (2026-05-23)

### Bug Fixes (Windows)
- Bundled `rsync.exe` now actually loads. beta.4/beta.5 shipped with `msys-2.0.dll` from the legacy `msys2-runtime-3.3` fork, which is missing the `fallocate` symbol that rsync 3.4 needs — produced `Entry Point Not Found: fallocate` on launch and exit code `3221225785` (`STATUS_DLL_INIT_FAILED`) when invoked indirectly via `sync push/pull` or `local clone`.
- Rebuilt the Windows bundle against current MSYS2 packages: `msys2-runtime-3.6.9-1`, `libopenssl-3.6.2-1`, `libiconv-1.19-1`, `libxxhash-0.8.3-1`, `libzstd-1.5.7-1`, `popt-1.19-1`, `libintl-0.22.5-1`. Includes `msys-popt-0.dll` and `msys-intl-8.dll` which the newer rsync now requires.
- Upgraded bundled rsync from 3.4.0 → 3.4.2-2.

### Internals
- `scripts/fetch-windows-binaries.sh` now verifies DLL closure (every referenced `msys-*.dll` is present) and asserts `fallocate` is exported from `msys-2.0.dll` before declaring the bundle valid. Catches "wrong runtime fork" regressions at build time.
- Added `smoke-windows` job to the publish workflow — runs on `windows-latest` and actually executes the bundled `rsync.exe` and `busybox.exe` before npm publish. Publish is now gated on this passing.

## 0.0.1-beta.5 (2026-05-23)

### New Commands
- `db push <site> <file>` — Push a local SQL dump (`.sql` or `.sql.gz`) to the remote MySQL database. Always backs up the remote DB to `~/db-backup-{ISO}.sql.gz` first (skip with `--no-backup`). Confirmation prompt unless `--force`. Closes the #1 gap blocking full-site deploys from the CLI.
- `db pull <site>` — Stream the remote MySQL database to a local gzipped dump. `--output <path>` and `--no-compress` flags.
- `open <site>` — Open the site URL in the default browser. `--admin` opens `/wp-admin`, `--magic` opens the Magic Login URL, `--print` pipes the URL to stdout instead.
- `logs <site>` — Tail logs via SSH. `--wp` (default, debug.log), `--php` (PHP-FPM error log), `--nginx` (nginx error log), `--follow` / `-f`, `--lines <n>`. Multiple flags multi-tail. Probes HestiaCP path variations automatically.
- `sites creds <site>` — Re-fetch WP admin credentials + Magic Login URL for an existing site (previously only available in the `create` output).

### Improvements
- `wp <site>` is now positioned as the primary remote-access command; `exec` is documented as the escape hatch for non-WP shell commands.
- `wp` / `exec` accept POSIX `--` to forward raw args verbatim: `instawp wp my-site -- post list --post_type=page`.
- Spinners are suppressed in non-TTY contexts, CI environments (`CI` env var), `--json` mode, `NO_COLOR`, and `INSTAWP_QUIET` — fixes "Resolving site..." leaking into piped output.

### Bug Fixes
- `instawp wp <site> eval '...'` no longer breaks on parens, quotes, or other shell metacharacters. Each arg is now POSIX shell-quoted before being piped to the remote shell's stdin (previously `args.join(' ')` left metacharacters unescaped, causing remote `bash: syntax error near unexpected token '('`).

### Docs
- New `ROADMAP.md` capturing 15 forward-looking improvement areas (multi-site bulk ops, cost transparency, CI/CD deploy command, shell completion, `doctor`, config file, snapshot/migration CLI, self-update, etc.) ranked by ROI.
- README + CLAUDE.md updated with `wp`-primary positioning and examples for all new commands.

## 0.0.1-beta.4 (2026-05-22)

### Windows — Zero-Install Support
- Bundled `rsync.exe` (with msys2 runtime DLLs) and BusyBox-w64 (`awk` provider) in `bin/win32/`. No more "install Git for Windows / cwRsync" prerequisite — `instawp local clone`, `local push/pull`, and `sync push/pull` work out of the box on Windows.
- Replaced the external `sqlite3` CLI dependency with the `better-sqlite3` Node module.
- New `src/lib/windows-binaries.ts` resolves bundled binaries; falls back to PATH then common Git-for-Windows install dirs.

### Bug Fixes (Windows)
- `instawp local clone` now resolves the bundled `mysql2sqlite` script correctly (was broken by `new URL(import.meta.url).pathname` returning `/C:/...`).
- `mysql2sqlite` is invoked as `awk -f script` explicitly; no longer relies on shebang interpretation.
- `rsync` no longer treats Windows drive paths (`C:\...`) as remote hostnames — paths are converted to msys style (`/c/...`) inside `rsyncViaSsh`.
- `-e ssh -i <key>` argument uses forward slashes + quoted paths so msys/cygwin sh inside rsync parses the key path correctly.
- Eliminated the SQL injection risk in `local clone`'s URL search-replace (now uses bound parameters via better-sqlite3).

### Internals
- New `scripts/fetch-windows-binaries.sh` (maintainer-only) refreshes the Windows bundle from MSYS2 + frippery.org.
- 32 new tests covering path conversion and bundled-binary resolution.

## 0.0.1-beta.3 (2026-04-12)

### New Commands
- `local create` — Create local WordPress sites (powered by WordPress Playground, no Docker needed)
- `local clone <site>` — Clone an InstaWP cloud site to local (files + database)
- `local start/stop` — Start in foreground or `--background` mode
- `local push/pull` — Sync wp-content between local and cloud (incremental rsync)
- `local list` — Show local sites with running/stopped status
- `local delete` — Remove local sites
- `sites php <site>` — View or update PHP version and settings
- `sites update <site>` — Update site label, description, or expiration
- `teams switch <team>` — Switch active team context

### Improvements
- `create --wp <version>` — Specify WordPress version when creating sites
- `sites list` — 50 per page default, `--all` flag, pagination hints
- Login now shows user name and team after success
- Site resolver caches name-to-ID lookups for 10 minutes
- rsync only shows actually changed files (`--itemize-changes`)
- Magic login URL fixed to use correct `/wordpress-auto-login` endpoint

### Bug Fixes
- Windows: SSH key generation now works (removed Unix-specific shell commands)
- Windows: command detection uses `where` instead of `which`
- `exec/wp --api` flag now works at any position in the command
- Terminal restored after local site Ctrl+C (`stty sane`)

## 0.0.1-beta.2 (2026-03-23)

### New Commands
- `local create/clone/start/stop/push/pull/list/delete` — Full local development workflow
- `teams switch` — Client-side team context

### Improvements
- Site resolver caching
- Incremental rsync output

## 0.0.1-beta.1 (2026-03-02)

### Initial Release
- `login` — OAuth browser flow or `--token`
- `whoami` — Show current session
- `create` — Create WordPress sites with provisioning progress
- `sites list/delete` — Manage sites
- `exec/wp` — Run commands via SSH or API
- `ssh` — Interactive SSH sessions
- `sync push/pull` — rsync wp-content via SSH
- `teams list/members` — View teams
- `--json` mode for all commands
