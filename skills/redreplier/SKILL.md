---
name: redreplier
description: >
  Monitor Reddit, Hacker News, X, and Bluesky for keyword mentions of your product/website via the
  RedReplier API. Covers managing monitored websites, keyword lifecycle (add/edit/disable/enable/activate
  with plan billing), triaging AI-scored lead mentions (approve/reject, relevance reasoning), and email
  alert settings.
last-updated: 2026-09-07
allowed-tools: Bash(./scripts/redreplier.js:*)
---

# RedReplier — Social Monitoring Skill

Autonomously monitor Reddit, Hacker News, X, and Bluesky for mentions of your keywords via [RedReplier](https://redreplier.com). RedReplier AI-scores every mention for relevance (0-100) so you surface real leads instead of noise.

> **Freshness check**: If more than 30 days have passed since the `last-updated` date above, inform the user that this skill may be outdated and point them to the update options below.

## Keeping This Skill Updated

**Source**: [github.com/redreplier/agent](https://github.com/redreplier/agent)

| Installation | How to update |
|--------------|---------------|
| CLI (`npx skills`) | `npx skills update` |
| Claude Code plugin | `/plugin marketplace update` |
| Cursor | Remote rules auto-sync from GitHub |
| Manual | Pull latest from repo or re-copy `skills/redreplier/` |

## Setup

1. Create a RedReplier account at [redreplier.com/signup](https://redreplier.com/signup)
2. Go to Settings → API Tokens and create an API token (starts with `redreplier_`)
3. Store your API key in workspace `.env`:
   ```
   REDREPLIER_API_KEY=redreplier_xxxxx
   ```

Or run the setup command:
```
./scripts/redreplier.js setup --key redreplier_xxxxx
```

## Auth

All requests use a Bearer token:
```
Authorization: Bearer <API_KEY>
```

Base URL: `https://ai.redreplier.com/ai-app`

**Config priority** (highest to lowest):
1. `REDREPLIER_API_KEY` environment variable
2. `./.redreplier/config.json` (project-local)
3. `~/.config/redreplier/config.json` (user-global)

### Handling "API key not found" errors

When you receive an "API key not found" error from the CLI:

1. **Tell the user to run the setup command** — setup requires user input, so you cannot run it on their behalf:
   ```bash
   ./scripts/redreplier.js setup --key redreplier_xxxxx
   ```
2. **Stop and wait** — do not continue. No operations work without a valid API key.
3. **DO NOT** search for API keys in env files, keychains, or other locations.

Get your API key at: https://redreplier.com/api-tokens

> **Note for agents**: All script paths in this document (e.g., `./scripts/redreplier.js`) are relative to the skill directory where this SKILL.md lives. Resolve them based on where the skill is installed.

## How RedReplier Works

1. **Websites** — you register the websites/products you want to track. The description is the context for AI relevance scoring: without one, a site's new mentions get no `relevanceScore`, so draft it with `websites:analyze` and set it.
2. **Keywords** — each website has keywords. Keywords have a lifecycle: `PENDING` (proposed, not yet paid for, matches nothing) → `ACTIVE` (live, monitored) → `DISABLED` (stopped, slot held until the cycle ends). `SUSPENDED` means the grader rejected the keyword as too noisy — edit it to fix. Edits are unlimited.
3. **Billing** — keyword capacity is tied to the plan. Adding keywords (and listing websites) auto-activates as many as fit for free; the rest stay `PENDING` until you `activate`, which charges a prorated upgrade for the remainder. Enabling one `DISABLED` keyword that no longer fits the plan charges the same way. Both have a preview command.
4. **Mentions** — matched posts and comments across Reddit, Hacker News, X, and Bluesky, each AI-scored 0-100 for relevance, with a reason, tags, and a drafted reply on demand. You triage them: `APPROVED` (real lead) / `REJECTED` (noise) / `NEW` (inbox). Triage is reversible.
5. **Alerts** — optional email digests on a cadence (15 / 30 / 60 / 120 / 180 / 240 / 720 / 1440 minutes), clamped up to what the plan allows.

## CLI Commands

| Command | Description |
|---------|-------------|
| `./scripts/redreplier.js setup --key <key>` | Configure API key |
| `./scripts/redreplier.js websites` | List monitored websites with keyword IDs and statuses. Run first. Also promotes PENDING keywords that fit the plan for free |
| `./scripts/redreplier.js websites:get --id <id>` | Get one website with its keywords; use it to re-check statuses after a keyword change |
| `./scripts/redreplier.js websites:create --url <url> [--name ..] [--keywords a,b] [--description ..]` | Add a website. Without `--description` the URL is scraped to write one (one AI generation); if the response shows `description: null`, run `websites:analyze` and `websites:update`. Initial keywords land as PENDING; duplicate domains are rejected |
| `./scripts/redreplier.js websites:update --id <id> [--name ..] [--description ..]` | Update name and/or description; omitted fields are kept. The description is the scoring context |
| `./scripts/redreplier.js websites:delete --id <id>` | Stop monitoring a website (soft delete, no restore command; re-creating the URL revives it). Confirm with the user first |
| `./scripts/redreplier.js websites:analyze --url <url>` | Scrape a URL and AI-generate a description without creating anything (uses one AI generation) |
| `./scripts/redreplier.js keywords:add --website <id> --keywords a,b` | Add keywords (unlimited). Those that fit the plan go ACTIVE for free; the rest stay PENDING until `keywords:activate`. Returns the whole website |
| `./scripts/redreplier.js keywords:edit --id <id> --value "new"` | Reword a keyword in place (unlimited, re-graded, keeps its slot). Use it to fix a SUSPENDED keyword instead of adding a variant |
| `./scripts/redreplier.js keywords:disable --id <id>` | Stop one keyword immediately (unlimited, reversible). Its paid slot is held until the cycle ends |
| `./scripts/redreplier.js keywords:enable --id <id>` | Re-enable one DISABLED keyword. Free if it fits the plan or was disabled this cycle; otherwise charges an upgrade immediately and stays PENDING until payment settles |
| `./scripts/redreplier.js keywords:delete --id <id>` | Permanently delete a PENDING keyword (any other status is rejected). No billing effect |
| `./scripts/redreplier.js keywords:activate` | Activate every PENDING keyword: free within the plan, then charges a prorated upgrade for the rest. Run `keywords:activate-preview` first and confirm |
| `./scripts/redreplier.js keywords:activate-preview` | Price activating everything currently PENDING, no changes (`immediateCharge`, `targetPlanName`) |
| `./scripts/redreplier.js keywords:billing-preview --count <n>` | Price an absolute total of N active keywords, no changes. Use before `keywords:add` or `keywords:enable` |
| `./scripts/redreplier.js keywords:usage` | Keyword-edit allowance; every plan currently reports unlimited (`limit: -1`) |
| `./scripts/redreplier.js mentions [filters]` | List AI-scored mentions. By default REJECTED and below-threshold (score < 30) mentions are hidden |
| `./scripts/redreplier.js mentions:count [filters]` | Count mentions with the same filters and defaults, no rows |
| `./scripts/redreplier.js mentions:status --id <id> --status APPROVED` | Triage: APPROVED (lead), REJECTED (hidden from default lists), NEW (back to inbox). Reversible |
| `./scripts/redreplier.js mentions:explain --id <id>` | Relevance reasoning, tags, and a drafted reply, generated on first call (needs a website description) |
| `./scripts/redreplier.js alerts` | Get email-alert settings, including `minIntervalMinutes` and `availableCadences` |
| `./scripts/redreplier.js alerts:update --enabled true --cadence 240` | Set alerts. Cadence: 15, 30, 60, 120, 180, 240, 720, 1440, clamped to the plan floor; omitting `--cadence` resets it to the fastest allowed |

`mentions` / `mentions:count` filters: `--website <id>`, `--status NEW,APPROVED,REJECTED`, `--buckets VERY_LOW,LOW,MEDIUM,HIGH,VERY_HIGH`, `--keywords a,b`, `--sources REDDIT_POST,REDDIT_COMMENT,TWITTER,BLUESKY,HACKERNEWS`, `--sort RELEVANCE|RECENT`, `--include-low`, `--from <ISO>`, `--to <ISO>`, `--limit <1-500>`, `--offset <n>`. `--buckets LOW,VERY_LOW` only returns rows together with `--include-low`; `--from`/`--to` filter on ingestion time.

## API Reference

Use these endpoints directly if you prefer raw API calls over the CLI. Base: `https://ai.redreplier.com/ai-app/api/v1`. The account is derived from the API token — you never pass an account/group ID.

### Websites

```
GET    /api/v1/websites                       # list (with keywords)
GET    /api/v1/websites/{id}                   # get one
POST   /api/v1/websites                        # { url, name?, keywords?, description? }
PATCH  /api/v1/websites/{id}                   # { name?, description? }
DELETE /api/v1/websites/{id}                   # soft delete
POST   /api/v1/websites/analyze-description    # { url } -> { description }
```

Keywords created with a website start `PENDING`. `description` is the scoring context; without it new mentions get no `relevanceScore`, so generate one with `analyze-description` and pass it (or set it later with `PATCH`). `PATCH` keeps omitted fields. `DELETE` is a soft delete that re-creating the URL revives.

### Keywords

```
POST   /api/v1/websites/{id}/keywords          # { keywords: string[] }  (auto-activates within plan; returns the website)
PATCH  /api/v1/keywords/{id}                    # { value }              (re-graded; unlimited; keeps its slot)
POST   /api/v1/keywords/{id}/disable            # -> DISABLED (slot held until cycle end)
POST   /api/v1/keywords/{id}/enable             # -> ACTIVE, or PENDING + upgrade charged immediately
DELETE /api/v1/keywords/{id}                    # only PENDING keywords; permanent
POST   /api/v1/keywords/activate-pending        # free within plan, then charges upgrade; paid ones flip ACTIVE after payment
GET    /api/v1/keywords/activate-pending/preview # cost of activating what is PENDING now
GET    /api/v1/keywords/billing-preview?desiredKeywordCount=N   # N = absolute active total wanted
GET    /api/v1/keywords/change-usage            # { limit, used, remaining, unlimited }; always unlimited today
```

Keyword status values: `PENDING`, `ACTIVE`, `DISABLED`, `SUSPENDED`.

### Mentions

```
GET   /api/v1/mentions?websiteId=&statuses=&scoreBuckets=&includeLowRelevance=&keywords=&sources=&sort=&from=&to=&limit=&offset=
GET   /api/v1/mentions/count?<same filters>
PATCH /api/v1/mentions/{id}/status              # { status: NEW | APPROVED | REJECTED }
POST  /api/v1/mentions/{id}/explain             # lazily generates + returns relevance reason/tags
```

Defaults: REJECTED mentions are excluded (unless `statuses` names them) and mentions below the website's minimum score (30 by default) are hidden unless `includeLowRelevance=true`; `scoreBuckets` does not lift that cutoff. `sort` is `RELEVANCE` (default) or `RECENT`. `limit` 1-500 (default 50). Relevance buckets: `VERY_LOW` (<10), `LOW` (10-29), `MEDIUM` (30-49), `HIGH` (50-74), `VERY_HIGH` (75+). Sources: `REDDIT_POST`, `REDDIT_COMMENT`, `TWITTER` (X), `BLUESKY`, `HACKERNEWS`.

List returns `{ mentions: [...], total, limit, offset }`. Each mention: `id`, `websiteId`, `source`, `keyword`, `title`, `contentText`, `url`, `author`, `subreddit`, `status`, `relevanceScore`, `relevanceReason`, `aiReplySuggestion`, `tags`, `publishedAt`, `ingestedAt`, `reviewedAt`. `explain` fills in `relevanceReason`, `tags`, and `aiReplySuggestion` on first call and needs the website to have a description; it returns `null` for an unknown ID. `subreddit` is only set for Reddit sources (null for X, Bluesky, and Hacker News).

### Alert Settings

```
GET /api/v1/alert-settings                      # { enabled, cadenceMinutes, minIntervalMinutes, availableCadences }
PUT /api/v1/alert-settings                       # { enabled, cadenceMinutes? }
```

`cadenceMinutes` must be one of `15, 30, 60, 120, 180, 240, 720, 1440` and is clamped up to `minIntervalMinutes` (the plan's fastest allowed cadence). The PUT replaces both settings: omitting `cadenceMinutes` resets it to the fastest allowed, so pass the current value when only toggling `enabled`.

## MCP Integration

RedReplier has a native MCP server. For Claude Desktop, Cursor, or any MCP-compatible client, connect directly:

```json
{
  "mcpServers": {
    "redreplier": {
      "type": "http",
      "url": "https://mcp.redreplier.com/mcp",
      "headers": {
        "Authorization": "Bearer redreplier_your_key"
      }
    }
  }
}
```

## Automation Guidelines

- **Triage is reversible; billing is not.** Approving/rejecting mentions is safe and reversible. Activating pending keywords (`keywords:activate`) can trigger a **paid plan upgrade** — always run `keywords:activate-preview` first and confirm the charge with the user before activating. `keywords:enable` on a keyword that no longer fits the plan charges the same way; run `keywords:billing-preview` first.
- **One keyword vs. all pending.** `keywords:enable` brings back one `DISABLED` keyword; `keywords:activate` brings every `PENDING` keyword live at once. Never run either in a loop.
- **Confirm before deleting websites.** `websites:delete` stops all monitoring for that site and there is no restore command.
- **Edits are unlimited.** `keywords:edit` re-grades the new value and keeps the keyword's slot; `keywords:usage` reports `limit: -1` on every plan. Prefer editing over adding a near-duplicate, and disabling over deleting (only `PENDING` keywords can be deleted).
- **Respect the grader.** A `SUSPENDED` keyword was judged too noisy — fix it with `keywords:edit`, don't try to force it active.

## Tips

- Always run `websites` first to get website IDs and keyword IDs.
- New keywords land as `PENDING`; the ones that fit the plan auto-activate. Check statuses after adding with `websites:get`.
- A website whose description is `null` gets unscored mentions. `websites:create` scrapes one when `--description` is omitted; if it comes back `null`, run `websites:analyze` and pass the text to `websites:update`.
- Default mention lists hide low-relevance noise — pass `--include-low` only when you specifically want everything.
- Use `--sort RECENT` for "what's new", `--sort RELEVANCE` (default) for "best leads first".
- Use `mentions:explain` to understand *why* a mention scored the way it did before approving/rejecting a borderline one; it is slow on first call, so don't run it across a whole list.
- The account is determined by the API token; there is no account/group parameter on any call.
