# Agent Office for OpenFox

Runs [Agent Office](https://github.com/AgentSystemLabs/agent-office) from
OpenFox — a 3D office where coding agents sit at desks — and makes every worker
in it an **OpenFox session**.

## What it does

- **Direct header access & plugin menu.** Quick access button in the header and in OpenFox's plugins menu to open Agent Office in a new browser tab.
- **OpenFox does the work.** Each worker is a real OpenFox session, so it uses
  the providers, models, agents, modes and tools you already have configured —
  no separate sign-in, no second set of API keys.
- **The office stays the office.** Worker status, activity, task cards, the
  GitHub boards, worktrees and pull requests all come from Agent Office itself,
  because the bridge speaks the Claude Code hooks it already understands.

## How it fits together

The office launches an agent CLI in a PTY and watches Claude Code's hook events
to learn what that agent is doing. This plugin supplies the CLI: a small bridge
that takes the worker's task, turns it into an OpenFox session over OpenFox's
own HTTP + WebSocket API, renders the turn into the terminal, and reports back
on the office's hook route.

```
Agent Office ──spawns──▶ bridge (agent.js)
     ▲                          │
     └── hook events ───────────┤
                                ▼
                    OpenFox session (tools, providers, modes)
```

## Settings

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| **Header button** (`showHeaderButton`) | `boolean` | `false` | Display a direct quick-access button to Agent Office in the top navigation header. |
| **Agent Office source** (`launchMode`) | `select` | `managed` | Source & launch mode: `managed` (automatic OpenFox install), `global` (existing CLI command), or `local` (cloned repository folder). |
| **Local repository folder** (`officeDir`) | `path` | `""` | Path to a local cloned Agent Office repository (used in `local` mode). |
| **Installed command / CLI path** (`officeCommand`) | `text` | `"agent-office"` | Name or path of the installed CLI executable (used in `global` mode). |
| **Office port** (`officePort`) | `number` | `0` | Port the office listens on (0 picks a free port, defaults to 4600). |
| **Office password** (`officePassword`) | `password` | `""` | Leave empty to let the office generate one and keep it in its own data directory. |

## Install

From **Settings → Plugins**, install from a local path:

```bash
git clone <this repo> && cd openfox-plugins/openfox-agent-office
npm install && npm run build
```

then install the path in OpenFox's Plugins tab and enable it.

The first click in `managed` mode clones and builds Agent Office (a few minutes); after that it
starts in seconds.

## Notes

- Workers run in the checkout of the project you open in the office, with the
  same tools an OpenFox session has there — including the file-editing tools.
  The office's own permission model still applies.
- The plugin runs in-process with OpenFox with full Node privileges, like every
  OpenFox plugin.
