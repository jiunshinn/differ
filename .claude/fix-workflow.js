export const meta = {
  name: 'differ-apply-fixes',
  description: 'Apply all 137 confirmed code-review fixes across the differ codebase, partitioned by file ownership',
  phases: [
    { title: 'Backend', detail: 'electron main/services/IPC contract — 5 agents, disjoint files' },
    { title: 'Frontend', detail: 'renderer state/views/components/config — 6 agents, disjoint files' },
  ],
}

const ROOT = '/Users/jiun/develop/differ'

const CONTEXT = `
Project "differ": a local-first Git/GitHub code review desktop app.
Stack: Electron 33 main process in ${ROOT}/electron (compiled with tsc -p tsconfig.electron.json), React 18.3 renderer in ${ROOT}/src (Vite), zustand 5, TanStack Query 5, better-sqlite3, @uiw/react-codemirror (CodeMirror 6), Radix UI, Tailwind. Shared IPC types in ${ROOT}/shared/types.ts. Preload bridge ${ROOT}/electron/preload.ts exposes window.differ consumed via ${ROOT}/src/api.ts.
Path aliases (renderer + shared): '@/*' -> src/*, '@shared/*' -> shared/*. Electron imports shared via relative paths (e.g. '../shared/types').
`

// Shared utilities ALREADY CREATED (import, do not recreate):
const UTILS = `
ALREADY-CREATED shared utilities — USE THESE, do not duplicate logic:
- shared/clone.ts  exports  deriveCloneFolderName(remoteUrl: string): string
    electron import: '../shared/clone'      renderer import: '@shared/clone'
- src/utils/date.ts exports:
    parseDbDate(value): Date           // normalizes SQLite 'YYYY-MM-DD HH:MM:SS' (UTC, no zone) AND ISO strings
    formatDateTime(value): string      // medium date + short time  (use for comment timestamps, issue dates)
    formatDate(value): string          // date only
    formatTime(value): string          // HH:MM
    formatRelativeTime(value): string  // "just now" / "5m" / "3h" / "2d" / "4mo" / "1y"
    renderer import from src/components/*: '../utils/date' ; from src/views/*: '../utils/date'
- src/utils/checkRuns.ts exports:
    checkRunTone(check): 'success'|'danger'|'warn'|'neutral'
    checkRunLabel(check): string
    summarizeChecks(checks): { passed, failed, pending, total }
`

// Cross-file contracts that multiple agents must agree on. Each agent only edits
// ITS OWN files; these pins ensure the pieces line up after integration.
const CONTRACTS = `
PINNED CROSS-FILE CONTRACTS (honor exactly the part that touches YOUR files):

[stageHunk/unstageHunk options] — fixes the ignore-whitespace hunk mismatch (electron/ipc.ts H6):
  New signature gains an optional 4th arg: opts?: { ignoreWhitespace?: boolean; staged?: boolean }.
  - electron/preload.ts: stageHunk:(repoId,filePath,hunkHeader,opts?) => invoke(ch, repoId,filePath,hunkHeader,opts); same for unstageHunk.
  - src/api.ts: update the DifferApi method types to add the optional opts arg.
  - electron/ipc.ts: handlers read opts and pass it into getDiff (stage: {...opts, filePath, includeUntracked:true}; unstage: {...opts, filePath, staged:true}); ALSO match the hunk by old/new start-line numbers as a fallback when the exact header string is not found.
  - src/components/DiffViewer.tsx: pass { ignoreWhitespace } (the same flag used to fetch the diff) into stageHunk/unstageHunk calls.

[sandbox enablement] — electron/main.ts sets webPreferences.sandbox: true. This is SAFE ONLY IF the
  preload requires no local module at runtime. Therefore electron/preload.ts MUST NOT import the runtime
  IpcChannels object from '../shared/types' (that becomes a require() the sandbox can't load). Instead define
  the channel string map LOCALLY inside preload.ts (copy the values), and keep any TYPE imports as 'import type'.
  - A_ipc (preload owner): inline the channels, remove the runtime import.
  - A_main (main.ts owner): set sandbox:true, AND add setWindowOpenHandler (deny, route http(s) via shell.openExternal),
    a will-navigate guard, and a production-only CSP via session onHeadersReceived.

[IPC DifferApi single source of truth] — A_ipc: create shared/api.ts exporting 'interface DifferApi { ... }'
  (move the interface currently hand-written in src/api.ts). In electron/preload.ts annotate 'const api: DifferApi = {...}'
  so the preload is type-checked against it (import type from '../shared/api'). In src/api.ts import type { DifferApi }
  from '@shared/api' and type window.differ with it; delete the now-duplicated local interface. Remove the dead
  'export type DifferApi = typeof api' from preload. If this proves too large/risky, at minimum remove the dead
  'fileStateGet' channel and align the existing duplicated interface — and record the rest under deferred.

[PR diff merge-base] — electron/services/git.ts getDiff: when BOTH base and head are provided, use 3-dot
  'git diff base...head' (merge-base semantics, matches github.com) instead of 2-dot. Local diffs (no base/head)
  are unaffected. The PR view (src/views/PullRequestDetailView.tsx) keeps passing base/head as-is; no renderer change.

[deriveCloneFolderName] — replace local copies with the shared one:
  - electron/ipc.ts: import from '../shared/clone', delete the local deriveCloneFolderName function.
  - src/components/CloneFromUrlDialog.tsx: import from '@shared/clone', delete the local deriveFolderName function.

[fileFilter perf] — src/state/AppStore.tsx: remove 'fileFilter' from the shared useApp().state memo so editing the
  filter no longer re-renders the diff. Export a narrow hook 'export function useFileFilter(): [string,(v:string)=>void]'
  from AppStore (selector on the zustand store + the existing setter). src/components/ChangedFilesPanel.tsx switches to
  useFileFilter() instead of reading state.fileFilter. If any OTHER file reads state.fileFilter, record it under crossFileNeeds.

[PR session leak H10 + repo-switch race C2] — both fixed in src/state/AppStore.tsx / store.ts (F_state):
  - refresh(): after every await, if useAppStore.getState().repo?.id !== the captured snapshot repo id, return early
    (do not apply status/session/toast to a different repo).
  - When the view changes away from the PR detail view (to local/code/history) OR the repo changes, drop any PR
    review session so refresh() re-resolves the local session. Detect a PR session via the ReviewSession's pr fields.
    No change needed in PullRequestsView for this (it keeps setting the PR session on open).

[ResizableLayout overlay crash C1] — handled entirely within F_comp1:
  - src/components/ResizableLayout.tsx: render the first panes.length children as panes and render any EXTRA children
    after the grid (do NOT throw).
  - src/views/CodeBrowserView.tsx (owned by F_comp1 for this fix): move the conditional <CommentComposer/> OUT of
    <ResizableLayout> (wrap the layout + composer in a fragment), mirroring PullRequestDetailView.
  - src/App.tsx: add a React error boundary around the lazy view container so one component error cannot blank the app.
`

const RULES = `
HARD RULES:
1. Edit ONLY the files assigned to you (listed below). NEVER edit any other file. If a fix needs a file you do not
   own, DO NOT touch it — record it under crossFileNeeds and move on.
2. READ each file fully before editing. Make minimal, surgical edits — do not reformat or rewrite unrelated code.
3. Address EVERY finding in your findings JSON. For each, apply the recommended fix (respecting any 'corr' correction
   note, which supersedes the original recommendation where they differ).
4. Use the ALREADY-CREATED shared utilities above instead of writing new duplicate helpers.
5. Honor the PINNED CONTRACTS for any part that touches your files, byte-for-byte on names/signatures.
6. DEFER (do NOT attempt) these large pure-reorganizations — instead record them under 'deferred' with a one-line reason:
   splitting electron/ipc.ts into multiple files; splitting HistoryView.tsx / PullRequestDetailView.tsx into separate
   files; full extraction of a shared diff-renderer component. BUT still fix the actual BUGS inside those files
   (e.g. render line comments in the PR diff, hide the non-functional Resolve placeholder, dedupe date/check helpers).
   For the DB migration finding, add a minimal 'PRAGMA user_version' scaffold (current schema = version 1), not a framework.
7. Do NOT run git. Do NOT run npm install. You MAY read other files for context and MAY grep. You may run
   'npx tsc --noEmit -p <config>' to sanity-check ONLY if quick, but other agents are editing concurrently so a
   whole-program typecheck may show unrelated errors — do not chase those.
8. Preserve all existing behavior except the specific fixes. Keep error messages user-friendly.
`

const OUT_SCHEMA = {
  type: 'object',
  required: ['applied', 'deferred', 'crossFileNeeds', 'buildNotes'],
  properties: {
    applied: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'file', 'summary'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          summary: { type: 'string', description: 'what you changed, 1-2 sentences' },
        },
      },
    },
    deferred: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'reason'],
        properties: { title: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    crossFileNeeds: {
      type: 'array',
      description: 'fixes that require editing a file you do not own',
      items: {
        type: 'object',
        required: ['need', 'file'],
        properties: { need: { type: 'string' }, file: { type: 'string' } },
      },
    },
    buildNotes: { type: 'string', description: 'anything the integrator must know (new imports, signature changes, risks)' },
  },
}

function agentPrompt(group, files, extra) {
  return `You are a senior engineer applying confirmed code-review fixes to the "differ" codebase. Repo root: ${ROOT}.
${CONTEXT}
${UTILS}
${CONTRACTS}
${RULES}

YOUR ASSIGNED FILES (edit only these):
${files.map((f) => '  - ' + ROOT + '/' + f).join('\n')}

YOUR FINDINGS: Read ${ROOT === '/Users/jiun/develop/differ' ? '/tmp/fix-' + group + '.json' : ''} — it maps each of your files to an array of findings:
  { t: title, l: line(s), s: severity, c: category, desc: full description, rec: recommended fix, corr?: verifier correction }
Apply a fix for every finding. Where 'corr' is present it refines/overrides 'rec'.
${extra || ''}
When done, report via the structured output tool: every fix you applied, anything deferred, any cross-file needs, and build notes.`
}

// ---------------- Phase 1: Backend (disjoint files, parallel) ----------------
phase('Backend')

const BACKEND = [
  {
    group: 'A_git', files: ['electron/services/git.ts'],
    extra: `Focus areas: porcelain v2 'u' record off-by-one (slice(8)); getOperationState relative --git-path resolved vs process cwd (use path.resolve(cwd,p) or --path-format=absolute); unified-diff parser quoted/space/unicode paths (pass -c core.quotepath=false and prefer ---/+++ lines); buildSingleHunkPatch new/deleted-file headers (/dev/null + new file mode, fallback git add/git restore --staged); parseGithubFromRemote allow dots in repo name; per-repo serialization of mutating git commands (a simple per-repo promise queue); UTF-8 chunk-boundary decode (accumulate Buffers then decode, or TextDecoder stream); git restore allowNonZeroCodes swallowing failures; unbounded diff/untracked memory caps; child-process timeouts and tracking; getCommits empty-repo; stdin error listener; remove genuinely-dead exports (grep the whole repo first to confirm zero importers). Implement the PINNED 3-dot getDiff base...head change.`,
  },
  {
    group: 'A_github', files: ['electron/services/githubService.ts', 'electron/services/githubOAuth.ts', 'electron/services/accountStore.ts'],
    extra: `Focus: listIssues must paginate and filter out PRs until N real issues (mirror listPullRequests); submitReview include commit_id (head sha); listCheckRuns paginate (drop the 50 cap); listAllRepos must surface per-account errors instead of swallowing; undecryptable-token accounts must remain visible (with an error flag) not vanish; plaintext-token-at-rest needs user disclosure / safeStorage gating; OAuth: do not discard a granted token if the /user probe fails; enforce the slow_down interval; stop sending device_code to the renderer; FK / dangling-binding integrity where applicable.`,
  },
  {
    group: 'A_stores', files: ['electron/services/db.ts', 'electron/services/commentStore.ts', 'electron/services/fileTree.ts'],
    extra: `Focus: db.ts add a minimal PRAGMA user_version scaffold (current schema = v1) and handle corrupt/unreadable DB at startup with a clear error (do not silently abort); reuse prepared statements instead of re-preparing per call; seed sort_order inside a transaction. commentStore: deterministic ordering (tie-break by id), remove dead listCommentsByIds (confirm no importers). fileTree: safeJoin must resolve symlinks (fs.realpath) so reads cannot escape the repo root; reconsider hardcoded SKIP_DIRS hiding tracked dirs (prefer not hiding dist/build/out/.vscode, or document); truncated reads must honor bytesRead (no NUL padding); decide symlink handling so tracked symlinks are not silently dropped.`,
  },
  {
    group: 'A_main', files: ['electron/main.ts', 'electron/ipc.ts'],
    extra: `main.ts: set sandbox:true (PINNED — relies on A_ipc inlining preload channels), add setWindowOpenHandler + will-navigate guards, production-only CSP via session onHeadersReceived, single-instance lock, error handling on the whenReady() chain, fix the DB double-close/close-before-quit ordering, scope dotenv .env loading to the app dir / resourcesPath (not arbitrary process.cwd()).
ipc.ts: implement the PINNED stageHunk/unstageHunk opts threading + start-line fallback match; validate shell.openExternal URLs against an http(s) allowlist; add minimal runtime validation of renderer args in the handle() wrapper; strip the noisy 'Error invoking remote method' prefix on errors; import deriveCloneFolderName from '../shared/clone' and delete the local copy; address the ghPrCheckout live-headSha note. DEFER splitting ipc.ts into multiple files (record as deferred) but keep all the above bug fixes inline.`,
  },
  {
    group: 'A_ipc', files: ['src/api.ts', 'electron/preload.ts', 'shared/types.ts'],
    extra: `Implement the PINNED contracts: (1) DifferApi single source of truth in shared/api.ts, preload 'const api: DifferApi', api.ts imports the type; (2) inline IpcChannels values inside preload.ts and drop the runtime import from '../shared/types' (keep type-only imports) so the sandbox can be enabled; (3) add the optional opts arg to stageHunk/unstageHunk in both preload and the api.ts types. shared/types.ts: remove the dead 'fileStateGet' channel; address the row-shape leak note (document/normalize as feasible without breaking callers). If the full DifferApi hoist is too risky, do the minimal safe subset and defer the rest.`,
  },
]

const backendResults = await parallel(
  BACKEND.map((a) => () =>
    agent(agentPrompt(a.group, a.files, a.extra), { label: a.group, phase: 'Backend', schema: OUT_SCHEMA })
      .then((r) => ({ group: a.group, result: r }))
  )
)
for (const b of backendResults.filter(Boolean)) {
  const r = b.result || {}
  log(`${b.group}: applied ${(r.applied || []).length}, deferred ${(r.deferred || []).length}, crossFileNeeds ${(r.crossFileNeeds || []).length}`)
}

// ---------------- Phase 2: Frontend (disjoint files, parallel) ----------------
phase('Frontend')

const FRONTEND = [
  {
    group: 'F_state', files: ['src/state/AppStore.tsx', 'src/state/store.ts', 'src/query/hooks.ts', 'src/utils/useAutoFetch.ts', 'src/utils/theme.ts'],
    extra: `Implement PINNED: refresh() repo-id race guards (C2), PR-session-leak fix via view/repo change (H10), useFileFilter() narrow hook + remove fileFilter from the shared state memo. Also: refresh() must force-fresh status/diff (staleTime:0 or invalidate+await) so post-pull/sync state shows immediately, and invalidate branches/commits too; make useApp's underlying useAppStore() subscription selector-based (useShallow over only the slices used) so toasts/activity no longer re-render all consumers; structuralSharing fix on the diff queries should be a custom comparator (content signature) NOT structuralSharing:false (per the verifier correction); narrow invalidateRepoQueries so staging does not blast GitHub/tree/branches/commits queries; remove the legacy dispatch shim's silent no-ops (setStatus:null) and dead exports (appSelectors/readStatusFiles/readCurrentSession) after confirming no importers; setRepo must reset per-repo UI (fileFilter/diffStaged/panel tabs); silentFetch must not stamp lastFetchedAt onto a newly-switched repo; useAutoFetch cooldown ref must reset on repo switch; theme.ts must cooperate with the pre-paint script (F_config) — keep the same storage key, just ensure no flash and listener cleanup. Keep dispatch()/existing setters working for consumers you do not own.`,
  },
  {
    group: 'F_diff', files: ['src/components/DiffViewer.tsx'],
    extra: `Memoize HunkBlock/UnifiedRow/SideCell with React.memo and stabilize props (useMemo fileComments keyed on [comments,selected]; useCallback stage/unstage/comment passing hunkHeader as an arg not a closure); subscribe narrowly so file-filter keystrokes don't re-render the diff; pass { ignoreWhitespace } into stageHunk/unstageHunk (PINNED); render comments on old-side context lines in unified mode; show diff load ERRORS instead of a permanent 'Loading diff…'; use formatDateTime from '../utils/date' for comment timestamps (fixes the UTC-as-local bug); fix SplitHunk re-pairing/comment-map memo; stop InlineCommentRow from instantiating the full useApp per row (take what it needs via props). DEFER extracting a shared diff component (note it) — but apply all these in-file.`,
  },
  {
    group: 'F_views', files: ['src/views/PullRequestDetailView.tsx', 'src/views/PullRequestsView.tsx', 'src/views/IssuesView.tsx', 'src/views/LocalChangesView.tsx', 'src/views/RepositoryPicker.tsx', 'src/views/HistoryView.tsx'],
    extra: `PullRequestDetailView: RENDER line comments (target_kind==='line') in the PR diff — currently saved but invisible (H8/H9); make submit-review idempotent/atomic (guard double-post on retry); use formatDateTime from '../utils/date' for comment timestamps; fix PR file-selection reset on query-key change; memoize hunks/rows like DiffViewer. (DEFER splitting the file / full shared-renderer extraction — note it.) PullRequestsView: in-flight guard so a stale PR checkout doesn't navigate after a repo switch. IssuesView: replace local formatDate with '../utils/date'; fix the error-toast effect keyed on Error identity (don't refire every refetch). LocalChangesView: debounce the j/k 'mark viewed' behind a dwell timer + coalesce key-repeat (guard e.repeat), drop redundant fileStates pre-read; resolve the fullscreen-key vs comment-dialog conflict. RepositoryPicker: surface IPC errors in load/loadAuth/remove instead of swallowing. HistoryView: replace the 4 local date formatters with '../utils/date'; remove the dead setUpstream branch OR wire it so no-upstream push works; HIDE / clearly mark the non-functional Resolve placeholder so it isn't presented as working. (DEFER splitting HistoryView into 3 files — note it.)`,
  },
  {
    group: 'F_comp1', files: ['src/App.tsx', 'src/views/CodeBrowserView.tsx', 'src/components/ResizableLayout.tsx', 'src/components/CodeViewer.tsx', 'src/components/ChangedFilesPanel.tsx', 'src/components/CommentComposer.tsx', 'src/components/CommitBar.tsx', 'src/components/FileTree.tsx', 'src/components/ProjectSidebar.tsx'],
    extra: `Implement PINNED C1 (ResizableLayout tolerant of extra overlay children + move CommentComposer out of ResizableLayout in CodeBrowserView + ErrorBoundary in App around the lazy views). CodeViewer: hoist basicSetup object (and style) to module constants so CodeMirror isn't fully reconfigured every render; throttle/stabilize the selection listener so selection drag doesn't re-render the parent each tick. ChangedFilesPanel: switch to useFileFilter() (PINNED); make Stage-all/Unstage-all a single batched operation (or loop without per-file invalidation + one invalidate at end); make changed-file rows keyboard-accessible (button semantics). CommentComposer + CommitBar: guard Cmd+Enter against isPending/busy to stop duplicate submits. FileTree: avoid a query observer per node / re-rendering the whole tree on selection; preserve nested expansion state when collapsing a parent. ProjectSidebar: add an in-flight/ordering guard so a slow openRepo response can't override the latest click. (CodeBrowserView has no findings of its own — your only change there is the C1 composer move.)`,
  },
  {
    group: 'F_comp2', files: ['src/components/TopBar.tsx', 'src/components/BranchMenu.tsx', 'src/components/GithubAuthDialog.tsx', 'src/components/RepoBrowserDialog.tsx', 'src/components/CloneFromUrlDialog.tsx', 'src/components/Toast.tsx', 'src/components/ReviewPanel.tsx', 'src/components/pr/PullRequestOverview.tsx'],
    extra: `Dedupe check-run classification: ReviewPanel + PullRequestOverview must use checkRunTone/checkRunLabel/summarizeChecks from '../utils/checkRuns' / '../../utils/checkRuns' (delete the inline copies). Dedupe dates via '../utils/date' (TopBar lastFetched, RepoBrowserDialog formatDate, ReviewPanel event time). CloneFromUrlDialog: import deriveCloneFolderName from '@shared/clone' (delete local deriveFolderName), and stop the URL-derivation effect from clobbering a user-provided initialFolderName. BranchMenu: stopPropagation on the new-branch input keydown so Radix typeahead can't steal focus, AND onEscapeKeyDown preventDefault while the create form is open (per the verifier correction); add a pending guard and reset stale state on menu close. GithubAuthDialog: fix the stale 'device' captured in the poll loop, honor GitHub's polling interval, add error handling on the initial fetch, add Dialog.Description/aria-describedby. RepoBrowserDialog: surface org-list query errors. Toast: announce via aria-live and don't drop batched messages. TopBar: route push upstream-retry through friendlyGitError (no raw stderr); the 'no upstream' fallback duplication with HistoryView can be left (HistoryView is another agent) — if you can centralize it within TopBar only, do so, else note crossFileNeeds.`,
  },
  {
    group: 'F_config', files: ['eslint.config.mjs', 'package.json', 'src/index.html'],
    extra: `eslint.config.mjs: enable unused-symbol detection (@typescript-eslint/no-unused-vars) so dead code can't silently accumulate — but set it to a level that does NOT fail the build on the existing tree if other agents are mid-removal; prefer 'warn' or scope it, and note it. package.json: move genuinely runtime renderer deps out of devDependencies into dependencies (clsx etc.) where miscategorized. index.html: add a tiny pre-paint inline <script> in <head> that applies the saved theme BEFORE the bundle loads to kill the light-theme flash — READ src/utils/theme.ts first to use the exact same storage key and class/data-attribute logic; do not change the key. Do NOT add a strict CSP meta here (would break Vite dev/HMR); CSP is handled in the main process. If index.html is not at repo root, find it (it's the Vite entry).`,
  },
]

const frontendResults = await parallel(
  FRONTEND.map((a) => () =>
    agent(agentPrompt(a.group, a.files, a.extra), { label: a.group, phase: 'Frontend', schema: OUT_SCHEMA })
      .then((r) => ({ group: a.group, result: r }))
  )
)
for (const f of frontendResults.filter(Boolean)) {
  const r = f.result || {}
  log(`${f.group}: applied ${(r.applied || []).length}, deferred ${(r.deferred || []).length}, crossFileNeeds ${(r.crossFileNeeds || []).length}`)
}

return {
  backend: backendResults.filter(Boolean),
  frontend: frontendResults.filter(Boolean),
}
