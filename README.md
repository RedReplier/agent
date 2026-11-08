# RedReplier agent

[![smithery badge](https://smithery.ai/badge/tarasshyn/redreplier)](https://smithery.ai/servers/tarasshyn/redreplier)

Let your AI agent find leads in public conversations on Reddit, Hacker News, X, Bluesky and Facebook. RedReplier watches for your keywords and scores every mention 0 to 100 for relevance, so the agent can surface the real leads and skip the noise.

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

## The MCP server

RedReplier runs this server at `https://mcp.redreplier.com/mcp`. An OAuth-capable client needs only the URL and signs in in the browser; that sign-in reaches every workspace you belong to. A client without OAuth sends an API key:

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

To run it yourself over stdio with [Bun](https://bun.sh):

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

The tools and the local options are in [`mcp-server/README.md`](./mcp-server/README.md).

## Links

- [RedReplier](https://redreplier.com)
- [AI agents](https://redreplier.com/features/agents)
- [API tokens](https://redreplier.com/api-tokens)
- [Claude Code and Hermes plugin](https://github.com/RedReplier/claude-plugin)
- Privacy policy: [redreplier.com/privacy](https://redreplier.com/privacy)

## License

MIT
