# InstaWP CLI Roadmap

Forward-looking improvement areas for the InstaWP CLI, beyond the v0.0.1-beta.4 friction fixes already in flight (db push/pull, wp eval escaping, `--` passthrough, TTY spinner, `open`, `logs`, `sites creds`, wp/exec docs).

These are grouped by theme and ranked by ROI to the 2026 roadmap (agency persona, pricing-model demonstration, dev/CI growth lever).

---

## Priority Ranking

| Rank | Improvement                    | Why now                                                           |
| ---- | ------------------------------ | ----------------------------------------------------------------- |
| 1    | Multi-site / bulk ops          | Direct agency lever; differentiates from per-site competitor CLIs |
| 2    | Cost transparency              | Dogfoods the pricing wedge; unique to InstaWP                     |
| 3    | CI/CD deploy command           | Required for product-led growth via dev channels                  |
| 4    | Shell completion               | Baseline modern-CLI expectation                                   |
| 5    | `instawp doctor`               | Cuts support load; signals maturity                               |
| 6    | DB push/pull (in flight)       | Unblocks full-site deploys                                        |
| 7    | Config file                    | DX standard; reduces repeat-typing                                |
| 8    | Snapshot CLI integration       | Surfaces a feature that's currently dashboard-only                |
| 9    | Migration CLI                  | Dogfoods the migration use case                                   |
| 10   | Self-update + version checks   | Removes "stale CLI silently broken" failure mode                  |

The top 3 specifically advance the 2026 roadmap revenue strategy — agencies, pricing-model demonstration, dev/CI growth lever.

---

## 1. Multi-site / bulk operations

**Highest revenue impact** — maps to agency persona + PPU expansion.

Agencies will manage 20–200 sites. Today every command is one-site-at-a-time.

```bash
instawp wp --all plugin update woocommerce              # update across all sites
instawp wp --where "tier=plus" cache flush              # filter then act
instawp sync push --all --path wp-content/themes/x/    # deploy theme to all sites
instawp sites list --where "status=paused"
```

This single feature is the difference between "useful for individual devs" and "indispensable for agencies."

## 2. Cost transparency built into the CLI

**Unique to InstaWP's pricing model.** Your pricing wedge is per-site daily billing — the CLI should make it visible:

```bash
instawp create --name foo
→ Site ready · Plan: Sandbox · Cost: $0.07/day · Free for first 48h ✓

instawp sites list
→ NAME              TIER     COST/DAY    THIS MONTH    STATUS
   instawp-marketing  Plus     $0.30       $4.20         live
   peak-studio        Starter  $0.17       $5.10         live

instawp billing                # current month + projected
instawp billing forecast       # what's the bill if I leave things as-is
```

No other host CLI does this because no other host bills per-site-per-day. This becomes a demonstration of the pricing model every time the CLI is used.

## 3. CI/CD-first commands

Maps to roadmap's developer/AI/MCP lever. The current CLI assumes interactive use; CI/CD needs a different shape:

```bash
instawp deploy <site>                # = sync push + cache flush + smoke test; one-shot
instawp deploy --token $TOKEN        # service account auth
instawp deploy --wait-healthy        # block until /wp-admin/admin-ajax.php returns 200
instawp deploy --rollback-on-fail
```

Plus a GitHub Action wrapper (`actions/instawp-deploy@v1`) so people can `uses:` it in 3 lines. That's distribution.

## 4. Shell completion

Table-stakes — every CLI feels broken without it.

```bash
instawp completion zsh > ~/.zsh/completions/_instawp
instawp completion bash > /etc/bash_completion.d/instawp
```

Plus tab-completion for **site names** (not just commands). When users have 50 sites, typing `instawp wp <tab>` should fuzzy-match them.

## 5. `instawp doctor`

Support deflection.

```bash
instawp doctor
→ ✓ Authentication OK (you@example.com)
   ✓ Network OK (api.instawp.io: 45ms)
   ✓ CLI version up to date (0.0.1-beta.4)
   ⚠ Local wp-cli not found — `wp` shorthand needs local wp-cli for previews
   ✓ rsync 3.2.7 available
   ✓ 4 active sites, all healthy
```

Cuts support tickets, gives confidence, helps debug fast. Stripe / Heroku / Fly all have this.

## 6. DB push/pull *(in flight)*

Tracked in v0.0.2-beta.x — unblocks full-site deploys. Auto-backup on push, gzipped dumps, `--include-db` flag pairing with `sync push`.

## 7. Config file (`.instawprc` or `instawp.yml`)

Today you specify `--site`, `--path`, `--exclude` repeatedly per command. A config file at repo root removes that:

```yaml
# instawp.yml
site: instawp-marketing
path: ./wp-content/
exclude:
  - "**/cache/**"
  - "**/uploads/blockstudio/tailwind/cache/**"
hooks:
  post-deploy:
    - wp eval-file - <<< "\\Blockstudio\\Pages::init(['force' => true]);"
```

Then `instawp deploy` reads the config. Vercel / Fly / Railway all converge on this pattern.

## 8. Snapshot integration

Dogfoods one of your features.

```bash
instawp snapshot create <site> --name agency-base
instawp snapshot list
instawp create --from-snapshot agency-base --name new-client
instawp snapshot push agency-base       # to the store / share
```

Currently the user has to go to the dashboard for snapshots. The CLI experience misses your differentiating feature.

## 9. Migration as a CLI command

Integrates the migration use-case page.

```bash
instawp migrate --from-host wp-engine --site target-site
instawp migrate --backup-file ./old-site.zip --site target
instawp migrate --from-url https://oldsite.com --target target-site
instawp migrate status <migration-id>
```

Pairs with the migration page perfectly: "Or, if you're a developer, migrate from the command line: `instawp migrate ...`"

## 10. Self-update + version sanity

```bash
instawp upgrade
→ Local: 0.0.1-beta.4 · Latest: 0.0.2-beta.1
   Updating... done.
```

Today users have to know to `npm i -g @instawp/cli` or equivalent. CLI should manage itself.

Plus: when the CLI is stale and the API has moved, fail with `Your CLI version is 3 weeks old. Run: instawp upgrade` instead of a cryptic 404.

## 11. Output consistency

`--json` exists on some commands but not all — make it global. Also add:

- `--quiet` (only errors)
- `--no-color` and respect the `NO_COLOR` env var (the standard)
- `--progress` (current default) vs `--no-progress` (CI mode) on long-running commands like `sync push`

## 12. Per-project / per-environment contexts

Beyond `teams switch` (which is account-level):

```bash
instawp context use staging
instawp context use production
# now `instawp deploy` knows which site/team to push to
```

Or env var: `INSTAWP_SITE=foo instawp deploy` for one-off overrides.

## 13. Webhook events

```bash
instawp webhooks add deploy --url https://hooks.slack.com/...
```

Lets agencies hook InstaWP into Slack / Linear / PagerDuty without polling.

## 14. Better errors with "did you mean"

When a site doesn't exist:

```bash
instawp wp instawp-markting plugin list
→ Error: Site 'instawp-markting' not found.
   Did you mean: instawp-marketing?
   Run: instawp sites list
```

Tiny touch, huge UX win.

## 15. `instawp tail <site>` — live log streaming

Hand-in-hand with `logs`. Tail PHP errors / nginx access in real-time. For debugging production issues, this is non-negotiable.
