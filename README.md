# RedReplier Agent

Give your AI agent the ability to monitor **Reddit and Hacker News** for keyword mentions of your product — and triage the AI-scored leads — from a single command.

**Works with:** Claude Code, Cursor, Windsurf, Codex, and any agent that supports skills.

## Install

```bash
npx skills add redreplier/agent
```

### Other installation methods

**Manual**: Copy the `skills/redreplier/` folder into your project's skills directory.

**Cursor remote rules**: Point to `https://raw.githubusercontent.com/redreplier/agent/main/skills/redreplier/SKILL.md`

## Setup

1. Create an account at [redreplier.com](https://redreplier.com)
2. Add the websites and keywords you want to monitor
3. Create an API token at [Settings → API Tokens](https://redreplier.com/api-tokens)
4. Run:
   ```bash
   ./scripts/redreplier.js setup --key redreplier_xxxxx
   ```

## What it does

Once installed, your AI agent can:

- **Manage monitored websites** — add, update, AI-analyze, remove
- **Manage keywords** — add, edit, enable/disable, activate within your plan
- **Triage mentions** — list AI-scored Reddit/HN mentions, filter by relevance / keyword / source / date, approve or reject leads
- **Explain relevance** — see why a mention scored the way it did
- **Configure alerts** — enable email digests and set the cadence

## Example

```
You: Show me this week's best Reddit leads for my product.
Agent: 3 mentions scoring 70+. Top: r/webdev "Looking for an example tool" (85) —
       a direct buying-intent question. Want me to approve it and reject the rest?
```

## Alternative: MCP

For deeper integration with Claude Desktop, Cursor, or other MCP-compatible clients, use the RedReplier MCP server:

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

## Links

- [RedReplier](https://redreplier.com)
- [API Tokens](https://redreplier.com/api-tokens)
- [MCP Server](https://github.com/redreplier/mcp-server)

## License

MIT
