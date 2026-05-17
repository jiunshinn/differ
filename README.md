# Differ

<img width="2168" height="1402" alt="Screenshot 2026-05-17 at 13 37 37" src="https://github.com/user-attachments/assets/e9f51457-ba9c-4ec0-8377-86bb7188cfd3" />


A local-first, AI-native Git and GitHub review desktop app.

Differ is a focused desktop surface for reviewing local changes and GitHub PRs, leaving comments, extracting high-quality context, and handing that context to AI coding agents like Codex, Cursor, or Claude Code.

## Stack

- Electron (desktop shell)
- React + Tailwind + Radix primitives (renderer)
- SQLite via `better-sqlite3` (local storage)
- Native `git` CLI through a typed IPC bridge (the renderer never spawns commands directly)
- GitHub REST API via `@octokit/rest`

## Dev

```sh
npm install
npm run dev
```

`npm run dev` starts the Vite renderer on `http://localhost:5173` and an Electron process pointed at it.

## Build

```sh
npm run build
npm start
```

`npm run build` produces `dist/electron/*.js` (main + preload) and `dist/renderer/*` (the React app). `npm start` launches Electron against the built output.

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

## Features (MVP)

- Repository picker with recent repos, **Clone from URL**, and **Sign in with GitHub** to browse and clone your personal, private, and organization repositories. Left project sidebar with pin-to-top, drag-and-drop reorder, and collapse.
- Local Changes view: changed files grouped by staged / unstaged / untracked / conflicted, unified or split diff, hunk navigation, whitespace toggle, file reviewed state. Resizable panes, fullscreen diff with `j`/`k` file navigation.
- History view with three tabs: **Graph** (commit list with filter and HEAD marker), **Resolve** (merge-conflict queue with three-way preview scaffold), and **Sync** (staged-files summary, push checklist, fetch/pull/push).
- Local comments at file / hunk / line scope, with labels (issue, question, refactor, test, ask-ai), resolved/open status, filtering.
- AI context builder: select comments, hunks, files, type a task + test command, preview Markdown, copy to clipboard, save bundle.
- Local Git: stage/unstage files and hunks, commit, amend, branch create/checkout, fetch/pull/push.
- GitHub: OAuth Device Flow sign-in or personal-access-token auth, open PR list, checkout PR locally, review PR diff, draft line comments and submit a review (Comment / Approve / Request changes). Issues view for browsing open / closed issues, labels, assignees, descriptions, and comments inside the app.
- Native window header, system / light / dark theme toggle.
