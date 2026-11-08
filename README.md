# RedReplier agent

Let your AI agent find leads in public conversations on Reddit, Hacker News, X, Bluesky and Facebook. RedReplier watches your keywords, scores every mention 0 to 100 for relevance, explains the score and drafts a reply, so the agent surfaces the real leads and skips the noise. 19 MCP tools, OAuth sign-in.

## Connect in 30 seconds

```bash
claude mcp add --transport http redreplier https://mcp.redreplier.com/mcp
```

Any other MCP client needs only the URL, `https://mcp.redreplier.com/mcp`. The first call opens a browser to sign in with your RedReplier account. Nothing to install and no key to paste. Setup for each client is [below](#setup-by-client).

## What this repo is

This repo holds every RedReplier agent integration except the Claude Code and Hermes Agent plugin:

| Path | What it is |
| --- | --- |
| [`skills/redreplier/`](./skills/redreplier) | The agent skill for `npx skills add`. It drives the RedReplier REST API through `scripts/redreplier.js` with an API key. |
| [`mcp-server/`](./mcp-server) | Source of the MCP server that runs at `https://mcp.redreplier.com/mcp`. A push to `main` that touches it builds a new image. |
| `gemini-extension.json`, `GEMINI.md` | The Gemini CLI extension. It connects to the hosted MCP server and signs in with OAuth. |
| `Dockerfile`, `glama.json` | Runs the MCP server over stdio, for Glama and anyone who wants it in a container. |
| `lhm.plugin.json` | The LobeHub marketplace listing for the hosted MCP server. |

The Claude Code and Hermes Agent plugin lives in [RedReplier/claude-plugin](https://github.com/RedReplier/claude-plugin). It signs in with OAuth and never asks for an API key, which the Claude plugin directory and the Hermes catalog both require, so it ships its own MCP-only skill instead of the script skill here.

## Pick your install

| You use | Install | Sign-in |
| --- | --- | --- |
| Claude Code | `/plugin install redreplier --marketplace RedReplier/claude-plugin` | OAuth |
| Hermes Agent | `hermes plugins install redreplier` | OAuth |
| Gemini CLI | `gemini extensions install https://github.com/RedReplier/agent` | OAuth |
| Claude Desktop, Cursor, ChatGPT or any MCP client | Add `https://mcp.redreplier.com/mcp` as a remote server | OAuth, or an API key header |
| Cursor, Codex, Windsurf, Claude Code or any agent with skills | `npx skills add RedReplier/agent` | API key |

## Setup by client

The server answers an unauthenticated call with a 401 that points at its OAuth metadata, so every client below opens the RedReplier sign-in on its own. One sign-in reaches every workspace you belong to.

### Claude.ai and Claude Desktop

Open Settings > Connectors, add a custom connector with the URL `https://mcp.redreplier.com/mcp`, and sign in. A Claude Desktop build without connectors can go through `mcp-remote`, which handles the sign-in itself:

```json
{
  "mcpServers": {
    "redreplier": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.redreplier.com/mcp"]
    }
  }
}
```

### Claude Code

The plugin adds the server and a skill that knows how to use it:

```
/plugin install redreplier --marketplace RedReplier/claude-plugin
```

Or add only the server:

```bash
claude mcp add --transport http redreplier https://mcp.redreplier.com/mcp
```

Run `/mcp`, pick `redreplier` and sign in.

### ChatGPT

Add a custom connector in Settings > Apps & Connectors with the URL `https://mcp.redreplier.com/mcp` and sign in.

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "redreplier": { "url": "https://mcp.redreplier.com/mcp" }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "redreplier": { "serverUrl": "https://mcp.redreplier.com/mcp" }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "redreplier": { "type": "http", "url": "https://mcp.redreplier.com/mcp" }
  }
}
```

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.redreplier]
url = "https://mcp.redreplier.com/mcp"
```

Then sign in with `codex mcp login redreplier`.

### Gemini CLI

```bash
gemini extensions install https://github.com/RedReplier/agent
```

### Hermes Agent

```bash
hermes plugins install redreplier
hermes plugins enable redreplier
```

### Headless agents and clients without OAuth

Create an API token on [Settings > API Tokens](https://redreplier.com/api-tokens) and send it as a header. Keys start with `redreplier_`.

```json
{
  "mcpServers": {
    "redreplier": {
      "type": "http",
      "url": "https://mcp.redreplier.com/mcp",
      "headers": { "Authorization": "Bearer redreplier_your_key" }
    }
  }
}
```

## Example prompts

- "Show me this week's best leads, score 70 and above."
- "Why did this Reddit thread score 85? Draft a reply I can post."
- "Add 'social media scheduler' and 'buffer alternative' as keywords for my website."
- "Approve the top three mentions and reject the rest."
- "How many Hacker News mentions did we get this month?"
- "Send me an email digest every 4 hours."
- "Write a description for https://example.com and start monitoring it."

## Tools

19 tools. Mentions come from Reddit, Hacker News, X, Bluesky and Facebook. Slack, Telegram, Notion and Linear alerts are set up in the RedReplier app.

### Workspaces and websites

| Tool | What it does | Changes data |
| --- | --- | --- |
| `list_workspaces` | List the workspaces the sign-in can act in; pass an id as `workspaceId` to any other tool | No |
| `list_websites` | List monitored websites with their keywords and statuses | No |
| `get_website` | Get one website with its keywords | No |
| `create_website` | Add a website to monitor, with optional keywords and description | Yes |
| `update_website` | Change a website's name or description | Yes |
| `delete_website` | Stop monitoring a website | Yes |
| `analyze_website` | Write a description of a website from its URL with AI | Yes |

### Keywords

| Tool | What it does | Changes data |
| --- | --- | --- |
| `add_keywords` | Add keywords to a website; those that fit the plan go active, the rest wait as pending | Yes |
| `edit_keyword` | Reword a keyword; it is graded again and keeps its slot | Yes |
| `disable_keyword` | Stop monitoring a keyword; its mentions stay | Yes |
| `enable_keyword` | Turn a disabled keyword back on; it waits as pending when the plan is full, and never charges | Yes |
| `delete_keyword` | Delete a keyword and every mention it produced | Yes |
| `keyword_change_usage` | Keyword-edit allowance and usage | No |

### Mentions

| Tool | What it does | Changes data |
| --- | --- | --- |
| `list_mentions` | List AI-scored mentions, filtered by status, relevance, minimum score, keyword, source and date | No |
| `count_mentions` | Count mentions with the same filters | No |
| `update_mention_status` | Approve, reject or send a mention back to the inbox | Yes |
| `explain_mention` | Why a mention scored the way it did, with tags and a drafted reply | Yes |

### Alerts

| Tool | What it does | Changes data |
| --- | --- | --- |
| `get_alert_settings` | Email alert settings: on or off, cadence and the plan's fastest cadence | No |
| `update_alert_settings` | Turn email alerts on or off and set the cadence | Yes |

## Roles, permissions and safety

- Every call runs with the signed-in member's role in the workspace. Reads need `workspace.read`; every change needs `redreplier.write`, which Admin and Editor hold.
- Read-only tools carry `readOnlyHint`, so clients that confirm writes ask before adding websites or keywords, triaging mentions or changing alerts.
- Keywords count against your RedReplier plan. Adding one never charges: keywords beyond the plan wait as pending.
- Mentions are public posts. `analyze_website` reads the website's public pages.

## Workspaces

An OAuth sign-in can reach several workspaces, each with its own data and your own role there. `list_workspaces` returns them, and every other tool takes an optional `workspaceId`, which the server sends as the `X-Workspace-Id` header. Without it a tool works in the workspace `list_workspaces` marks current. A `workspaceId` the sign-in cannot reach answers 403 with `code: workspace_access_denied`. An API key belongs to one workspace.

## The skill

```bash
npx skills add RedReplier/agent
```

Or copy `skills/redreplier/` into your project's skills folder. Cursor can also read it as a remote rule from `https://raw.githubusercontent.com/RedReplier/agent/main/skills/redreplier/SKILL.md`.

### Setup

1. Create an account at [redreplier.com/signup](https://redreplier.com/signup) and add the websites and keywords you want to monitor.
2. Create an API token at [Settings > API Tokens](https://redreplier.com/api-tokens).
3. Run:
   ```bash
   ./scripts/redreplier.js setup --key redreplier_xxxxx
   ```

### What the agent can do

- Add, update, analyze and remove monitored websites
- Add, reword, disable, enable and delete keywords. Keywords that fit the plan go active, the rest wait as pending
- List and count AI-scored mentions, filtered by relevance, minimum score, keyword, source or date
- Approve or reject mentions, or send them back to the inbox
- Explain why a mention scored the way it did, with a drafted reply
- Turn email alerts on or off and set how often they arrive

```
You: Show me this week's best leads for my product.
Agent: 3 mentions scoring 70+. Top: r/webdev "Looking for an example tool" (85),
       a direct buying-intent question, plus one on Hacker News and one on X.
       Want me to approve them and reject the rest?
```

## Run the server yourself

The hosted server is the easy path. To run it yourself over stdio with [Bun](https://bun.sh):

```json
{
  "mcpServers": {
    "redreplier": {
      "command": "bun",
      "args": ["run", "/path/to/agent/mcp-server/src/index.ts"],
      "env": { "REDREPLIER_API_TOKEN": "redreplier_your_key" }
    }
  }
}
```

Or in Docker:

```bash
docker build -t redreplier-mcp .
docker run -i -e REDREPLIER_API_TOKEN=redreplier_your_key redreplier-mcp
```

`bun run src/index.ts --http` in `mcp-server/` serves the same tools over Streamable HTTP on port 3100, the way `https://mcp.redreplier.com/mcp` runs. Environment variables and local development are in [`mcp-server/README.md`](./mcp-server/README.md).

## FAQ

**Do I need an API key?**
No. Point your client at `https://mcp.redreplier.com/mcp` and sign in with the email you use on RedReplier. Keys are for headless agents and clients without OAuth.

**Can the agent post replies for me?**
No. It drafts a reply with `explain_mention`; you post it yourself.

**Will adding keywords charge me?**
No. Keywords that fit the plan go active, the rest wait as pending until you upgrade in the app.

**Which sources does it watch?**
Reddit, Hacker News, X (Twitter), Bluesky and Facebook.

**What's the difference between this repo and RedReplier/claude-plugin?**
The plugin is the Claude Code and Hermes package: OAuth only, with a skill that drives these MCP tools. This repo has the server's source, the API-key skill for `npx skills add` and the Gemini extension.

## Links

- [RedReplier](https://redreplier.com)
- [AI agents](https://redreplier.com/features/agents)
- [API tokens](https://redreplier.com/api-tokens)
- [Claude Code and Hermes plugin](https://github.com/RedReplier/claude-plugin)
- Privacy policy: [redreplier.com/privacy](https://redreplier.com/privacy)

## License

MIT
