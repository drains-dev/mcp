SkunkWorks Logs MCP server. Lets Claude Desktop, Claude Code, or any other MCP-compatible agent read and write your drains directly.

This runs locally on your own machine as a small process the agent starts itself — it is not something you deploy to a server. It just makes HTTP calls to your SkunkWorks Logs deployment using a personal API token, the same way a browser tab would. `npx` fetches it straight from this repo on first run, no install step, no cloning.

Setup:

1. In SkunkWorks Logs, open the key icon in the sidebar and create an API token — it shows you a ready-to-copy config block for this exact step.
2. Add it to your MCP client's config. For Claude Desktop, that's `claude_desktop_config.json`; for Claude Code, `.claude/settings.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "skunkworks-logs": {
      "command": "npx",
      "args": ["-y", "github:kabeer11000/skunkworks-logs-mcp"],
      "env": {
        "SKUNKWORKS_API_URL": "https://your-deployment.example.com",
        "SKUNKWORKS_API_TOKEN": "the token you created above"
      }
    }
  }
}
```

3. Restart the client. It will list drains, read and post entries, invite members, and trigger AI summaries on your behalf, with the same access as signing in yourself — except it can only edit or delete entries it (or your own account) originally created.

Regenerate or revoke the token from the SkunkWorks Logs API Tokens dialog at any time; revoking it immediately cuts the agent off.
<img width="1911" height="904" alt="image" src="https://github.com/user-attachments/assets/96504d54-1521-44d8-b00e-3bca5d6622e3" />
