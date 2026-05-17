# Differ

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

## Features (MVP)

- Repository picker with recent repos.
- Local Changes view: changed files grouped by staged / unstaged / untracked / conflicted, unified or split diff, hunk navigation, whitespace toggle, file reviewed state.
- Local comments at file / hunk / line scope, with labels (issue, question, refactor, test, ask-ai), resolved/open status, filtering.
- AI context builder: select comments, hunks, files, type a task + test command, preview Markdown, copy to clipboard, save bundle.
- Local Git: stage/unstage files and hunks, commit, amend, branch create/checkout, fetch/pull/push.
- GitHub: personal-access-token auth, open PR list, checkout PR locally, review PR diff, draft line comments and submit a review (Comment / Approve / Request changes).
