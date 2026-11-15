# Differ

<img width="2056" height="1329" alt="Screenshot 2026-06-10 at 15 30 08" src="https://github.com/user-attachments/assets/168bade3-4b84-4494-b81e-a4d6e5a22b43" />


A local-first Git and GitHub review desktop app.

Differ is a focused desktop surface for reviewing local changes and GitHub PRs, leaving actionable comments, and managing review state without opening a full IDE.

## What you can do

- Open local Git repositories and keep a pinned, reorderable recent repository sidebar.
- Review unstaged, staged, and untracked changes with unified or split diffs.
- Stage and unstage files or individual hunks, then commit or amend from the app.
- Track file review state, inline comments, hunk comments, and file-level notes locally.
- Browse repository files without leaving the desktop app.
- Connect GitHub accounts with OAuth Device Flow or a personal access token.
- Browse GitHub pull requests, PR details, changed files, checks, review comments, and Issues.
- Fetch, pull, push, and monitor ahead/behind status from the top bar.
- Switch between light, dark, and system themes.

## Agent threads

differ runs coding agents as **ACP** (Agent Client Protocol) providers, so any agent that speaks ACP works the same way: Claude Code ships built in, and more can be added under **Settings → Providers**.

Agents already installed on the machine are detected automatically — Codex (`codex-acp`), Cursor (`cursor-agent`), OpenCode, Devin, Gemini CLI, GitHub Copilot and goose — so there is nothing to configure. Detection also checks `~/.local/bin`, Homebrew, Volta and asdf paths, because a Finder-launched app doesn't inherit your shell's `PATH`.

The model list comes from the agent itself, not a hardcoded table: ACP only exposes config options once a session exists, so the server opens a throwaway session, reads the model selector, and caches it. The composer then offers the real models before the first message, and the same picker stays available inside a thread. **Settings → Providers → Models** lists each provider's models inline with a switch per model; hidden ones are kept out of the composer and saved to `models.json`.

- Agent threads live in a separate headless server (`server/`) that Electron starts on its bundled Node. The same server can later run on a remote host over SSH and serve a mobile client.
- Each thread gets its own agent process and works inside one folder; the agent can only read and write inside that folder.
- Permission requests, file edits, plans and command output stream into the thread as they happen and are stored, so threads survive restarts.
- The renderer talks to the server over a local WebSocket with a random token. The contract is `shared/protocol.ts`; `reduceThread()` there turns a thread's event log into what you see, and the mobile app will reuse it.

## Stack

- Electron (desktop shell)
- React + Tailwind + Radix primitives (renderer)
- Zustand for client-side UI state
- TanStack Query for async IPC/GitHub data, mutations, and cache invalidation
- SQLite via Node's built-in `node:sqlite` (local storage; no native add-on to compile)
- Native `git` CLI through a typed IPC bridge (the renderer never spawns commands directly)
- GitHub REST API via `@octokit/rest`

## Dev

```sh
npm install
npm run dev
```

`npm run dev` starts the Vite renderer on `http://localhost:5173` and an Electron process pointed at it.

Useful checks:

```sh
npm run lint
npm run typecheck
npm run test:server   # end-to-end tests for the agent server (mock ACP agent)
npm run build
```

## Build

```sh
npm run build
npm start
```

`npm run build` produces `dist/electron/*.js` (main + preload) and `dist/renderer/*` (the React app). `npm start` launches Electron against the built output.

## Architecture notes

- Renderer state is split between client state and server/cache state.
- Client state lives in `src/state/store.ts` and is organized around repo, view, diff, toast, and activity concerns.
- Async data lives behind TanStack Query hooks in `src/query/hooks.ts`, with stable keys from `src/query/keys.ts`.
- Mutations invalidate or refresh the related repo, session, GitHub, comment, file-state, and diff queries instead of duplicating server data in the UI store.
- `src/state/AppStore.tsx` remains as a compatibility layer for older components while new code can subscribe to Zustand selectors directly.
- Heavier views are lazy-loaded from `src/App.tsx` so the renderer bundle is split by route-level surfaces.

## CI

GitHub Actions runs on pushes to `main` and on pull requests:

```sh
npm ci
npm run lint
npm run typecheck
npm run build
```

## GitHub OAuth (optional, for "Sign in with GitHub")

Differ supports the GitHub OAuth Device Flow so users can sign in with one click and browse / clone their personal, private, and organization repositories.

Because Differ is open source, the `client_id` for the OAuth App is not hardcoded — each build supplies its own. To enable OAuth sign-in:

1. Visit https://github.com/settings/developers → **New OAuth App**
2. Fill in any homepage/callback URL (callback isn't used for device flow).
3. After creating the app, open its settings and **enable Device Flow**.
4. Copy the **Client ID**.
5. Copy `.env.example` to `.env` (gitignored) and paste the Client ID:

   ```sh
   cp .env.example .env
   # then edit .env and set:
   #   DIFFER_GITHUB_OAUTH_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
   # optional — override the requested scopes (default: repo read:org read:user)
   #   DIFFER_GITHUB_OAUTH_SCOPES=repo read:org read:user
   ```

   The Electron main process loads `.env` automatically at startup.

The Client ID is public information by design — it's safe to ship in built artifacts. If `DIFFER_GITHUB_OAUTH_CLIENT_ID` is unset, the "Sign in with GitHub" button is disabled and users can still sign in by pasting a personal access token.
