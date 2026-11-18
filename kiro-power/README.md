# RedReplier power for Kiro

Find and triage leads from Reddit, Hacker News, X, Bluesky and Facebook from Kiro.

## Install

1. Open the Powers panel in Kiro.
2. Choose **Add Custom Power**, then **Import power from GitHub**.
3. Enter `https://github.com/RedReplier/agent/tree/main/kiro-power` and choose **Install**.

The first tool call opens a browser to sign in with your RedReplier account. There is no API key to set up.

You need a RedReplier account: [redreplier.com](https://redreplier.com).

## Privacy and support

- Privacy policy: [redreplier.com/privacy](https://redreplier.com/privacy)
- Support: [contact@redreplier.com](mailto:contact@redreplier.com)

## What is in this folder

| Path | What it is |
| --- | --- |
| `plugin.json` | The power's manifest and activation keywords. |
| `mcp.json` | The hosted MCP server at `https://mcp.redreplier.com/mcp`. |
| `skills/redreplier/` | How the agent should use the tools. |
