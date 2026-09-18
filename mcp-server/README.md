# @redreplier/mcp-server

MCP (Model Context Protocol) server for RedReplier — give AI agents the ability to monitor Reddit, Hacker News, X, and Bluesky for keyword mentions, manage monitored websites and keywords, triage AI-scored lead mentions, and configure email alerts.

## What is RedReplier

RedReplier watches Reddit, Hacker News, X, and Bluesky for mentions of your keywords, AI-scores each one for relevance (0-100), and surfaces the real leads. You register **websites**, attach **keywords** (a PENDING → ACTIVE billing lifecycle), review **mentions**, and set **alert** cadence.

## Quick Start

### Hosted server (no install)

Point your MCP client at the URL and sign in when the browser opens. No API key to paste.

One-liner for Claude Code:

```bash
claude mcp add --transport http redreplier https://mcp.redreplier.com/mcp
```

Full config for any MCP client (Claude Desktop, Cursor, ChatGPT, Windsurf):

```json
{
  "mcpServers": {
    "redreplier": {
      "type": "http",
      "url": "https://mcp.redreplier.com/mcp"
    }
  }
}
```

The server answers unauthenticated requests with a 401 and a `WWW-Authenticate` header, so OAuth-capable clients open the RedReplier sign-in on their own.

Prefer a key? Headless agents and clients without OAuth can send a token from [redreplier.com/api-tokens](https://redreplier.com/api-tokens) instead:

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
| `REDREPLIER_API_TOKEN` | For stdio | API token from [redreplier.com/api-tokens](https://redreplier.com/api-tokens). The hosted HTTP server takes it per request instead. |
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
| `enable_keyword` | Re-activate a disabled keyword (stays pending if the plan is full; never charges) |
| `delete_keyword` | Delete a keyword and every mention it produced |
| `preview_activate_pending` | Preview what a plan upgrade covering pending keywords would cost |
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
