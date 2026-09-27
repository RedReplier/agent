# RedReplier

RedReplier is keyword monitoring and lead mentions across Reddit, Hacker News, X, Bluesky and Facebook. This extension connects Gemini CLI to a RedReplier workspace
over MCP.

## Signing in

The server is at `https://mcp.redreplier.com/mcp`. It answers an unauthenticated call with a 401 and
points at its OAuth metadata, so Gemini CLI opens a browser the first time a tool
runs. Sign in with your RedReplier account. Nothing needs to be
configured by hand, and no API token is stored in this extension.

## What to ask for

- "what keywords am I tracking?"
- "show me this week’s highest scoring mentions and why they scored that way"
- "mark the last five mentions as rejected"

## Notes

- A sign-in reaches every workspace the account belongs to. `list_workspaces` lists them; pass an id as `workspaceId` to act in that workspace, or leave it out to use the default one.
- Ask before anything that writes. Deletes cannot be undone.
- Read the tool descriptions for the filters each one accepts rather than guessing
  parameter names.

https://redreplier.com
