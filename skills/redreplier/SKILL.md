---
name: redreplier
description: >
  Monitor Reddit, Hacker News, X, and Bluesky for keyword mentions of your product/website via the
  RedReplier API. Covers managing monitored websites, keyword lifecycle (add/edit/disable/enable/activate
  with plan billing), triaging AI-scored lead mentions (approve/reject, relevance reasoning), and email
  alert settings.
last-updated: 2026-08-29
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

1. **Websites** — you register the websites/products you want to track. The description is used as context for AI relevance scoring.
2. **Keywords** — each website has keywords. Keywords have a lifecycle: `PENDING` (proposed, not yet paid for) → `ACTIVE` (live, monitored) → `DISABLED` (stopped). `SUSPENDED` means the grader rejected the keyword as too noisy — edit it to fix.
3. **Billing** — keyword capacity is tied to the plan. Adding keywords auto-activates as many as fit for free; the rest stay `PENDING` until you `activate` (which may require a paid upgrade).
4. **Mentions** — matched posts and comments across Reddit, Hacker News, X, and Bluesky, each AI-scored 0-100 for relevance, with a reason and tags. You triage them: `APPROVED` (real lead) / `REJECTED` (noise) / `NEW` (inbox).
5. **Alerts** — optional email digests on a cadence (60 / 240 / 720 / 1440 minutes), clamped to what the plan allows.

## CLI Commands

| Command | Description |
|---------|-------------|
| `./scripts/redreplier.js setup --key <key>` | Configure API key |
| `./scripts/redreplier.js websites` | List monitored websites + keywords |
| `./scripts/redreplier.js websites:get --id <id>` | Get one website |
| `./scripts/redreplier.js websites:create --url <url> [--name ..] [--keywords a,b] [--description ..]` | Add a website |
| `./scripts/redreplier.js websites:update --id <id> [--name ..] [--description ..]` | Update a website |
| `./scripts/redreplier.js websites:delete --id <id>` | Stop monitoring a website |
| `./scripts/redreplier.js websites:analyze --url <url>` | AI-generate a description for a URL |
| `./scripts/redreplier.js keywords:add --website <id> --keywords a,b` | Add keywords |
| `./scripts/redreplier.js keywords:edit --id <id> --value "new"` | Rename a keyword |
| `./scripts/redreplier.js keywords:disable --id <id>` | Disable a keyword |
| `./scripts/redreplier.js keywords:enable --id <id>` | Re-enable a keyword |
| `./scripts/redreplier.js keywords:delete --id <id>` | Delete a PENDING keyword |
| `./scripts/redreplier.js keywords:activate` | Activate pending keywords (may charge upgrade) |
| `./scripts/redreplier.js keywords:activate-preview` | Preview cost of activating pending |
| `./scripts/redreplier.js keywords:billing-preview --count <n>` | Preview plan/price for N keywords |
| `./scripts/redreplier.js keywords:usage` | Monthly keyword-edit allowance/usage |
| `./scripts/redreplier.js mentions [filters]` | List AI-scored mentions |
| `./scripts/redreplier.js mentions:count [filters]` | Count mentions |
| `./scripts/redreplier.js mentions:status --id <id> --status APPROVED` | Approve/reject/reset a mention |
| `./scripts/redreplier.js mentions:explain --id <id>` | AI relevance reasoning + tags |
| `./scripts/redreplier.js alerts` | Get email-alert settings |
| `./scripts/redreplier.js alerts:update --enabled true --cadence 240` | Update alerts |

`mentions` / `mentions:count` filters: `--website <id>`, `--status NEW,APPROVED,REJECTED`, `--buckets VERY_LOW,LOW,MEDIUM,HIGH,VERY_HIGH`, `--keywords a,b`, `--sources REDDIT_POST,REDDIT_COMMENT,TWITTER,BLUESKY,HACKERNEWS`, `--sort RELEVANCE|RECENT`, `--include-low`, `--from <ISO>`, `--to <ISO>`, `--limit <1-500>`, `--offset <n>`.

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

Keywords created with a website start `PENDING`. Omitting `description` triggers a scrape + AI generation.

### Keywords

```
POST   /api/v1/websites/{id}/keywords          # { keywords: string[] }  (auto-activates within plan)
PATCH  /api/v1/keywords/{id}                    # { value }              (re-graded; counts as an edit)
POST   /api/v1/keywords/{id}/disable            # -> DISABLED
POST   /api/v1/keywords/{id}/enable             # -> ACTIVE or PENDING (if upgrade needed)
DELETE /api/v1/keywords/{id}                    # only PENDING keywords
POST   /api/v1/keywords/activate-pending        # activate pending; charges upgrade if over plan
GET    /api/v1/keywords/activate-pending/preview
GET    /api/v1/keywords/billing-preview?desiredKeywordCount=N
GET    /api/v1/keywords/change-usage            # { limit, used, remaining, unlimited }
```

Keyword status values: `PENDING`, `ACTIVE`, `DISABLED`, `SUSPENDED`.

### Mentions

```
GET   /api/v1/mentions?websiteId=&statuses=&scoreBuckets=&includeLowRelevance=&keywords=&sources=&sort=&from=&to=&limit=&offset=
GET   /api/v1/mentions/count?<same filters>
PATCH /api/v1/mentions/{id}/status              # { status: NEW | APPROVED | REJECTED }
POST  /api/v1/mentions/{id}/explain             # lazily generates + returns relevance reason/tags
```

Defaults: REJECTED mentions are excluded and mentions scoring below 30 are hidden unless `includeLowRelevance=true`. `sort` is `RELEVANCE` (default) or `RECENT`. `limit` 1-500 (default 50). Relevance buckets: `VERY_LOW` (<10), `LOW` (10-29), `MEDIUM` (30-49), `HIGH` (50-74), `VERY_HIGH` (75+). Sources: `REDDIT_POST`, `REDDIT_COMMENT`, `TWITTER` (X), `BLUESKY`, `HACKERNEWS`.

List returns `{ mentions: [...], total, limit, offset }`. Each mention: `id`, `websiteId`, `source`, `keyword`, `title`, `contentText`, `url`, `author`, `subreddit`, `status`, `relevanceScore`, `relevanceReason`, `tags`, `publishedAt`, `ingestedAt`, `reviewedAt`. `subreddit` is only set for Reddit sources (null for X, Bluesky, and Hacker News).

### Alert Settings

```
GET /api/v1/alert-settings                      # { enabled, cadenceMinutes, minIntervalMinutes, availableCadences }
PUT /api/v1/alert-settings                       # { enabled, cadenceMinutes? }
```

`cadenceMinutes` must be one of `60, 240, 720, 1440` and is clamped up to `minIntervalMinutes` (the plan's fastest allowed cadence).

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

- **Triage is reversible; billing is not.** Approving/rejecting mentions is safe and reversible. Activating pending keywords (`keywords:activate`) can trigger a **paid plan upgrade** — always run `keywords:activate-preview` first and confirm the charge with the user before activating.
- **Confirm before deleting websites.** `websites:delete` stops all monitoring for that site.
- **Edits are rate-limited.** Keyword *edits* count against a monthly allowance (`keywords:usage`); adding and disabling are unlimited. Don't burn edits on trivial changes.
- **Respect the grader.** A `SUSPENDED` keyword was judged too noisy — fix it with `keywords:edit`, don't try to force it active.

## Tips

- Always run `websites` first to get website IDs and keyword IDs.
- New keywords land as `PENDING`; the ones that fit the plan auto-activate. Check statuses after adding.
- Default mention lists hide low-relevance noise — pass `--include-low` only when you specifically want everything.
- Use `--sort RECENT` for "what's new", `--sort RELEVANCE` (default) for "best leads first".
- Use `mentions:explain` to understand *why* a mention scored the way it did before approving/rejecting.
- The account is determined by the API token; there is no account/group parameter on any call.
