# AGENTS.md — openfox-agent-office

Paths relative to `openfox-plugins/openfox-agent-office/`.

## Purpose

OpenFox plugin that launches Agent Office as a managed sub-process and allows its workers to run on LLM providers already configured in OpenFox.

## Stack

- TypeScript, ESM, tsup, vitest
- peerDep: `openfox >=2.0.140`

## Commands

```bash
npm run build      # tsup
npm test           # vitest run --passWithNoTests
npm run typecheck  # tsc --noEmit
```

## Project Map

```
src/
├── index.ts      # Plugin entry point (register)
├── agent.ts      # Worker executable (spawned by the office)
├── bridge.ts     # Bridge between Agent Office and OpenFox sessions
├── client.ts     # HTTP/WebSocket client to OpenFox
├── discover.ts   # OpenFox installation discovery
├── office.ts     # Agent Office process management
├── project.ts    # Projects/worktrees management
├── provision.ts  # Provisioning (clone/build)
├── settings.ts   # Plugin settings definition
└── types.ts      # Shared TypeScript types
```

## Where to Look What

- **Modify Agent Office ↔ OpenFox bridge** → `src/bridge.ts`
- **Modify HTTP/WS client** → `src/client.ts`
- **Add a setting** → `src/settings.ts`
- **Modify provisioning** → `src/provision.ts`

## Conventions

- `apiVersion: 2`, capabilities: `ui`, `rpc`, `settings`, `notifications`
- ESM build only via tsup
- `openfox` is externalized (provided by host)

## Cross-Project Dependencies

**Consumes**: `openfox` (peerDep), Agent Office (spawned as sub-process).

**Consumed by**: OpenFox (loaded as plugin).

**Touchpoints**:

- OpenFox side: `src/index.ts` (register), `src/bridge.ts`
- Agent Office side: `agent-office/src/server/server.ts`, `agent-office/src/shared/protocol.ts`

## Known Gotchas

- `dist/index.js` is the entry point loaded by OpenFox, not `src/`.
- The plugin runs in-process inside OpenFox with full Node privileges.
- Three launch modes: `managed` (auto-install), `global` (existing CLI), `local` (cloned repo).

## Do Not Read / Do Not Touch

- `node_modules/`, `dist/`, `.git/`

## Further Reading

- [README.md](README.md) — overview

---

> After any change affecting structure, a command, a convention, an inter-project contract, or a primary flow, update this file in the same commit. If any information here is inaccurate, fix it.
