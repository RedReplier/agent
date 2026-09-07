# @redreplier/mcp-server

MCP (Model Context Protocol) server for RedReplier — give AI agents the ability to monitor Reddit, Hacker News, X, and Bluesky for keyword mentions, manage monitored websites and keywords, triage AI-scored lead mentions, and configure email alerts.

## What is RedReplier

RedReplier watches Reddit, Hacker News, X, and Bluesky for mentions of your keywords, AI-scores each one for relevance (0-100), and surfaces the real leads. You register **websites**, attach **keywords** (a PENDING → ACTIVE billing lifecycle), review **mentions**, and set **alert** cadence.

## Quick Start

### One-link setup (hosted)

Connect with a single URL — no local install needed:

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

### Agent Skill (Claude Code, Cursor, Windsurf, Codex)

```bash
npx skills add redreplier/agent
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `REDREPLIER_API_TOKEN` | Yes | API token from [redreplier.com/api-tokens](https://redreplier.com/api-tokens) |
| `REDREPLIER_API_URL` | No | Custom API base URL (defaults to production) |

## Available Tools

| Tool | Description |
|---|---|
| `list_websites` | List monitored websites with their keywords and statuses |
| `get_website` | Get a single website with its keywords |
| `create_website` | Add a website to monitor (optional initial keywords + description) |
| `update_website` | Update a website's name or description |
| `delete_website` | Stop monitoring a website |
| `analyze_website` | AI-generate a description from a URL (preview/seed) |
| `add_keywords` | Add keywords to a website (auto-activates within plan) |
| `edit_keyword` | Change a keyword's text (re-graded) |
| `disable_keyword` | Stop monitoring a keyword |
| `enable_keyword` | Re-activate a disabled keyword |
| `delete_keyword` | Delete a PENDING keyword |
| `activate_pending_keywords` | Activate pending keywords (may charge an upgrade) |
| `preview_activate_pending` | Preview the cost of activating pending keywords |
| `preview_keyword_billing` | Preview plan/price for N active keywords |
| `keyword_change_usage` | Monthly keyword-edit allowance and usage |
| `list_mentions` | List AI-scored mentions with rich filters |
| `count_mentions` | Count mentions matching filters |
| `update_mention_status` | Approve / reject / reset a mention |
| `explain_mention` | Get the AI relevance reasoning + tags for a mention |
| `get_alert_settings` | Get email-alert settings (enabled, cadence, plan floor) |
| `update_alert_settings` | Enable/disable alerts and set cadence |

## Local development

```bash
bun install
REDREPLIER_API_TOKEN=redreplier_xxx bun run src/index.ts        # stdio (local clients)
bun run src/index.ts --http                                      # HTTP (deployed)
```

## Links

- [RedReplier](https://redreplier.com)
- [Agent Skill repo](https://github.com/redreplier/agent)
- [API Tokens](https://redreplier.com/api-tokens)

## License

MIT
