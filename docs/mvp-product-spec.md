# Differ MVP Product Spec

## Product Positioning

Differ is a local-first, AI-native Git and GitHub review app for developers who mostly open code editors to inspect diffs, control Git, and prepare context for AI coding agents.

It is not an IDE. It is not a project-management tool. It is a focused desktop surface for reviewing local changes and pull requests, leaving comments, extracting high-quality context, and handing that context to tools like Codex, Cursor, Claude Code, and similar agentic coding systems.

## Target Users

- Developers who use AI agents for coding and review.
- Developers who prefer GUI Git workflows but find existing clients too heavy, expensive, or disconnected from AI workflows.
- Reviewers who want to inspect PRs, annotate concerns, and generate precise prompts for agents.
- Solo builders who want a fast local review loop before committing or opening a PR.

## Core Problem

Existing Git clients are built around human-only source control flows:

- They handle Git operations well, but do not help users package review intent for AI agents.
- They usually treat comments as remote PR artifacts, not local working notes.
- They do not make it easy to select diffs, comments, files, and repository metadata as one clean context bundle.
- They are not designed around an iterative loop where a human reviews, asks an AI agent to act, inspects the agent's changes, and then commits or comments on GitHub.

## Product Thesis

The smallest valuable product is an excellent diff review app with first-class local comments and one-click AI context extraction.

The core loop should feel like this:

1. Open a local repository.
2. Review changed files.
3. Leave comments on files, lines, and hunks.
4. Select comments and diff regions.
5. Extract context as clean Markdown.
6. Send it to an AI coding agent.
7. Review resulting changes.
8. Stage, commit, push, or continue review.

## MVP Scope

### 1. Repository Workspace

Users can open a local Git repository and see:

- Current branch.
- Upstream tracking branch.
- Working tree status.
- Changed files grouped by unstaged, staged, untracked, and conflicted.
- Recent commits on the current branch.
- Basic repository metadata used in context extraction.

Out of scope for MVP:

- Multi-repo workspaces.
- Full commit graph visualization.
- Complex history rewrite UI.
- Submodule management.

### 2. Diff Review

Users can inspect changes with:

- Unified diff view.
- Side-by-side diff view.
- File tree or changed-file list.
- Hunk navigation.
- Syntax highlighting.
- Whitespace toggle.
- Viewed or reviewed state per file.

Minimum interactions:

- Open changed file.
- Switch unified/side-by-side mode.
- Jump between files and hunks.
- Mark file as reviewed.

Out of scope for MVP:

- Rich code navigation.
- Language server features.
- Inline editing.
- Merge conflict editor.

### 3. Local Comments

Users can create local review comments that are stored inside Differ, not necessarily pushed anywhere.

Comment targets:

- File-level comment.
- Line-level comment.
- Hunk-level comment.

Comment metadata:

- Author name from local app profile.
- Timestamp.
- File path.
- Diff side when relevant.
- Line number or hunk anchor when relevant.
- Status: open, resolved.
- Optional label: issue, question, refactor, test, ask-ai.

Core interactions:

- Add comment.
- Edit comment.
- Resolve or reopen comment.
- Filter comments.
- Select comments for context extraction.

Out of scope for MVP:

- Real-time collaboration.
- Cloud sync.
- Complex threaded discussions.

### 4. AI Context Extraction

Users can generate a copy-ready Markdown context bundle from selected review material.

Inputs:

- Selected comments.
- Selected files.
- Selected hunks.
- Optional repository metadata.
- Optional user-written task prompt.
- Optional test command.

Output should be deterministic, readable, and agent-friendly.

Example structure:

````md
# Task

Verify whether the selected changes break the mobile empty state. If they do, fix the issue and add a focused test.

# Repository

- Name: differ
- Branch: feature/review-comments
- Base: main

# Review Comments

## src/components/ProfileEmptyState.tsx

Comment:
This looks like it may break the mobile empty state.

Relevant diff:
```diff
...
```

# Expectations

- Keep the change focused.
- Preserve existing UI patterns.
- Run: npm test
````

Core interactions:

- Extract context from selected comments.
- Extract context from selected files.
- Extract context from selected hunks.
- Copy to clipboard.
- Preview before copying.

Out of scope for MVP:

- Direct agent execution.
- Automatic patch application from agent output.
- Agent-specific prompt templates beyond a generic Markdown format.

### 5. Local Git Operations

MVP Git operations:

- Refresh status.
- Stage file.
- Unstage file.
- Stage hunk.
- Unstage hunk.
- Commit staged changes.
- Amend latest commit.
- Create branch.
- Checkout branch.
- Fetch.
- Pull.
- Push.

Nice-to-have if cheap:

- Stash changes.
- Discard file changes with explicit confirmation.

Out of scope for MVP:

- Rebase UI.
- Cherry-pick UI.
- Bisect.
- Patch stack workflows.
- Advanced conflict resolution.

### 6. GitHub Integration

MVP GitHub operations:

- Authenticate with GitHub.
- Detect GitHub remote.
- List pull requests for the current repo.
- Checkout a PR locally.
- Show PR title, author, status, branch, base, and review state.
- Show PR diff.
- Add pending review comments.
- Submit review as comment, approve, or request changes.
- Open PR in browser.

Preferred MVP path:

- Use GitHub's API directly for product-grade review comments and PR metadata.
- Allow `gh` CLI as an optional bootstrap/helper for authentication and checkout flows if it is installed.

Out of scope for MVP:

- GitHub Projects.
- Issue triage.
- CI log explorer.
- Multi-provider support such as GitLab or Bitbucket.

## Technical Recommendation

### App Stack

- Desktop shell: Electron.
- UI: React.
- Styling: Tailwind CSS.
- Components: Radix primitives plus a small local component layer inspired by shadcn/ui.
- Storage: SQLite.
- Local process execution: Electron main process with a narrow command bridge.
- Syntax highlighting: Shiki or CodeMirror language packages.

### Radix vs shadcn/ui

Use Radix primitives plus shadcn/ui patterns, but do not copy in a large component set on day one.

Why:

- Radix gives accessible, unstyled primitives for menus, dialogs, popovers, tabs, tooltips, and context menus.
- shadcn/ui is excellent for velocity and visual consistency, but it can encourage importing more UI than the MVP needs.
- Differ should feel like a precise desktop tool, so a small controlled component layer is better than a broad generic design system.

Recommended approach:

- Start with Tailwind design tokens.
- Use Radix for behavior-heavy primitives.
- Add shadcn-style components only as they are needed.
- Own the final component code locally so the app can evolve into a distinct product.

### Git: `git` CLI vs `isomorphic-git`

Use the native `git` CLI for MVP core Git operations.

`gh` CLI and `isomorphic-git` are not direct alternatives:

- `git` CLI handles local repository operations.
- `gh` CLI handles GitHub workflows.
- `isomorphic-git` is a JavaScript Git implementation.

Recommendation:

- Local Git: use system `git` CLI through a typed command service.
- GitHub: use GitHub API for durable product behavior.
- Optional MVP helper: use `gh` CLI when present for authentication, PR checkout, and quick GitHub actions.
- Avoid `isomorphic-git` for the primary desktop Git engine.

Why not `isomorphic-git` as the core engine:

- It is useful for JS-only environments, but Differ is an Electron desktop app and can rely on native Git.
- Native Git has the best compatibility with real-world repositories, hooks, LFS, credentials, worktrees, sparse checkout, and user configuration.
- A Git client replacement must match developer expectations exactly. Shelling out to Git gives the most predictable behavior.
- Diff, staging, patch application, and edge-case repository states are safer when delegated to Git itself.

Architecture rule:

The renderer never runs shell commands directly. The renderer calls typed IPC methods, and the main process owns all Git and GitHub execution.

Example services:

- `GitStatusService`
- `GitDiffService`
- `GitStageService`
- `GitCommitService`
- `GitBranchService`
- `GitHubAuthService`
- `GitHubPullRequestService`
- `ContextExtractionService`
- `ReviewCommentStore`

## Data Model

### Repository

- `id`
- `path`
- `name`
- `default_branch`
- `remote_url`
- `github_owner`
- `github_repo`
- `created_at`
- `last_opened_at`

### Review Session

- `id`
- `repository_id`
- `kind`: local, pull_request
- `branch`
- `base_branch`
- `head_sha`
- `base_sha`
- `github_pr_number`
- `created_at`
- `updated_at`

### Review Comment

- `id`
- `review_session_id`
- `file_path`
- `target_kind`: file, line, hunk
- `diff_side`: old, new, none
- `line_number`
- `hunk_header`
- `body`
- `label`
- `status`: open, resolved
- `created_at`
- `updated_at`

### File Review State

- `id`
- `review_session_id`
- `file_path`
- `status`: unviewed, viewed, reviewed
- `updated_at`

### Context Bundle

- `id`
- `review_session_id`
- `title`
- `task`
- `included_comments_json`
- `included_files_json`
- `included_hunks_json`
- `output_markdown`
- `created_at`

## Primary Screens

### Repository Picker

Purpose:

- Open recent repo.
- Add local repo.
- Clone from GitHub later.

MVP elements:

- Recent repositories list.
- Open local repository button.
- Basic validation that selected folder is a Git repo.

### Local Changes

Purpose:

- Main day-to-day workspace.

MVP layout:

- Left sidebar: changed files grouped by state.
- Center: diff viewer.
- Right panel: comments and context extraction.
- Bottom or command area: stage, unstage, commit, push.

### Pull Requests

Purpose:

- Review GitHub PRs without leaving Differ.

MVP layout:

- PR list.
- PR detail header.
- Changed files.
- Diff viewer.
- Review comments.
- Submit review controls.

### Context Builder

Purpose:

- Turn selected comments and diffs into agent-ready context.

MVP layout:

- Selected comments and files.
- Task text area.
- Options for including repo metadata, diff hunks, file snippets, and test command.
- Markdown preview.
- Copy button.

## User Stories

### Local Review Before Commit

As a developer, I want to review my uncommitted changes, leave local comments, and extract selected context so I can ask an AI agent to improve the change before I commit.

Acceptance criteria:

- User can open a repo with uncommitted changes.
- User can add comments on diff lines.
- User can select comments and extract Markdown context.
- Output includes branch, file paths, comment text, and relevant diff hunks.

### Ask AI to Fix a Review Comment

As a developer, I want to mark a comment as `ask-ai` and copy context for that comment so I can paste it into Codex, Cursor, or Claude Code.

Acceptance criteria:

- User can label a comment as `ask-ai`.
- Context builder can filter to `ask-ai` comments.
- Copied Markdown has a clear task and the exact relevant diff.

### Stage and Commit Reviewed Changes

As a developer, I want to stage files or hunks after reviewing them so I can create a focused commit.

Acceptance criteria:

- User can stage and unstage files.
- User can stage and unstage hunks.
- User can write a commit message.
- Commit only uses staged content.

### Review a GitHub PR

As a reviewer, I want to open a GitHub PR, review its diff, leave comments, and submit a review.

Acceptance criteria:

- User can authenticate with GitHub.
- User can list PRs for the current repo.
- User can open a PR diff.
- User can add review comments.
- User can submit approve, comment, or request changes.

## Non-Goals

- Replacing a full IDE.
- Editing source code directly in the MVP.
- Running AI agents inside the app in the first release.
- Supporting every Git hosting provider in the first release.
- Building cloud collaboration in the first release.
- Advanced Git graph and history management.

## MVP Milestones

### Milestone 1: Local Repository and Diff Foundation

- Electron app shell.
- Open local repo.
- Read Git status.
- Show changed files.
- Render unified diff.
- Basic app layout.

### Milestone 2: Local Comments

- SQLite persistence.
- Add file, hunk, and line comments.
- Show comments beside diff.
- Resolve and reopen comments.
- File reviewed state.

### Milestone 3: Context Extraction

- Select comments and hunks.
- Generate Markdown context.
- Preview context.
- Copy context to clipboard.
- Add generic task prompt field.

### Milestone 4: Local Git Control

- Stage and unstage files.
- Stage and unstage hunks.
- Commit staged changes.
- Branch switch and creation.
- Fetch, pull, push.

### Milestone 5: GitHub PR Review

- GitHub authentication.
- PR list.
- PR checkout.
- PR diff view.
- Review comments.
- Submit review.

## MVP Success Metrics

- User can review a local change without opening a code editor.
- User can create useful AI-agent context in under 30 seconds.
- User can commit reviewed changes from the app.
- User can review a GitHub PR from the app.
- Local comments remain useful even before GitHub integration.

## Open Product Questions

- Should local comments be stored only in app SQLite, or optionally exportable as repo-local files?
- Should context bundles be saved as reusable history?
- Should Differ support direct agent CLI execution after MVP?
- Should comments support templates such as bug, test, refactor, security, or performance?
- Should PR checkout require a clean working tree or allow worktree-based isolation?

## Recommended First Build

Build the local review loop before GitHub.

First usable slice:

1. Open a repository.
2. Show changed files and diffs.
3. Add local comments.
4. Extract comments plus diffs as Markdown.
5. Copy to clipboard.

This proves the unique product value before spending too much time on GitHub review mechanics.
