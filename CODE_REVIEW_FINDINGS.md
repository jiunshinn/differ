# differ 코드 리뷰 — 전체 발견사항 상세 (137건)

> 2026-06-11 멀티에이전트 딥다이브 리뷰의 원본 발견사항 전문입니다. 각 항목은 독립 검증 에이전트가 실제 코드를 재확인해 통과시킨 것이며, 검증 과정에서 보정된 내용은 "검증 단계 보정"으로 병기되어 있습니다. 요약본은 [CODE_REVIEW.md](./CODE_REVIEW.md) 참조.

### [CRITICAL/bug] ResizableLayout throws (renderer white-screens) when a consumer renders a conditional overlay child — triggered by CodeBrowserView's CommentComposer

- **위치**: `src/components/ResizableLayout.tsx:26-29`
- **발견**: react-components

ResizableLayout hard-throws during render when children count differs from panes count: `const items = React.Children.toArray(children); if (items.length !== panes.length) { throw new Error(...) }`. This is a live crash, not just a footgun: in /Users/jiun/develop/differ/src/views/CodeBrowserView.tsx (panes array of length 2 at lines 27-30), `{composer && sessionId && selected && (<CommentComposer .../>)}` is rendered as a direct third child inside `</ResizableLayout>` (lines 87-96). React.Children.toArray strips the `false` but keeps the element, so the moment a user selects a file in the Code view and clicks "Comment file" / "Comment lines", items.length becomes 3 !== 2 and the throw fires. There is no ErrorBoundary anywhere in the app (grep for ErrorBoundary/componentDidCatch returns nothing), so React 18 unmounts the entire root — full white screen, all unsaved state lost.

**권장 수정**: Make ResizableLayout tolerant: render the first panes.length children as grid panes and render any extra children (overlays/portals) after the grid, or at minimum console.error instead of throwing. Independently, the CommentComposer in CodeBrowserView should be moved outside the ResizableLayout (wrap in a fragment like PullRequestDetailView does). Add an ErrorBoundary around the view container so a single component error cannot blank the whole app.

### [CRITICAL/bug] refresh() installs the previous repo's review session after a mid-flight repo switch

- **위치**: `src/state/AppStore.tsx:129-159`
- **발견**: sweep:async-races

refresh() captures the repo once (`const snapshot = useAppStore.getState()`), awaits a status IPC call, then re-reads live state for the session: `const current = useAppStore.getState(); let session = current.session; if (!session) { session = await queryClient.fetchQuery(localSessionQueryOptions(snapshot.repo.id)); ... useAppStore.getState().setSession(session); }`. The session fetch uses the STALE `snapshot.repo.id` while the null-check uses CURRENT state. Scenario: repo A's refresh is in flight (git status on a large repo); the user switches to repo B (`setRepo` clears `session` to null). refresh(A) resumes, sees `session == null`, calls `ensureLocalSession(A)` over IPC and `setSession(sessionA)` — repo A's local session is now installed while repo B is selected. Worse, the concurrent refresh(B) (fired by LocalChangesView's `useEffect` on repoId change) then sees a non-null session and skips fetching repo B's session entirely. From then on every comment, 'viewed' file-state and the ReviewPanel content for repo B are read from and written to repo A's session rows in SQLite — silent cross-repo data corruption that persists until the next repo switch. The trailing `catch` also toasts repo A's errors into repo B's UI.

**권장 수정**: Make refresh() race-safe: after every await, verify the context is unchanged (`if (useAppStore.getState().repo?.id !== snapshot.repo.id) return;`) before applying results, and use `snapshot`-consistent values throughout (don't mix `snapshot.repo` with `current.session`). Longer term, derive the session from the current repo via a query (`useQuery(localSession(repoId))`) instead of imperatively writing it into the zustand store.

### [HIGH/bug] Stage/unstage hunk re-derives the diff without the renderer's ignoreWhitespace flag — hunk headers don't match and staging fails

- **위치**: `electron/ipc.ts:228-248`
- **발견**: sweep:perf-hotpaths

The handler refetches the diff with default options: `const diffs = await getDiff(repo.path, { filePath, includeUntracked: true }); ... const hunk = file.hunks.find((h) => h.header === hunkHeader); if (!hunk) throw new Error(`Hunk not found in ${filePath}`);`. But the hunk header the renderer sends comes from a diff fetched with the user's WS toggle (`ignoreWhitespace: clientState.ignoreWhitespace` in AppStore.tsx:117, rendered by DiffViewer and passed via `api.stageHunk(repoId, filePath, hunkHeader)`). When ignore-whitespace is ON and the file contains any whitespace-only changes, `git diff -w` produces different hunk boundaries and line counts (e.g. `@@ -12,7 +12,7 @@` vs `@@ -12,8 +12,9 @@`), so the exact-string header lookup against the non `-w` diff fails and every Stage/Unstage hunk click errors with 'Hunk not found' — precisely in the situation the WS toggle exists for. The unstage path (line 241) has the same mismatch.

**권장 수정**: Thread the same diff options the renderer used (at minimum `ignoreWhitespace`, plus `staged`) through the stageHunk/unstageHunk IPC and into `getDiff`, or better: send the full hunk (or its serialized patch) from the renderer instead of re-deriving it by header string in the main process. If re-deriving, match hunks by old/new start lines rather than the full header string.

**검증 단계 보정**: The finding is accurate except for one overstatement: with WS on and whitespace-only changes present, not literally every Stage/Unstage click fails — only hunks whose boundaries are affected (a ws-only change inside or within the 3-line context range of the hunk) produce mismatched headers; hunks in untouched regions of the file have identical headers in both diffs and still stage correctly. The mechanism, cited lines, and recommendation are otherwise correct.

### [HIGH/performance] Whole PR diff is fetched eagerly as one structured-clone IPC blob of per-line objects

- **위치**: `electron/ipc.ts:293-303`
- **발견**: sweep:perf-hotpaths

`handle(IpcChannels.diffAll, async (repoId, opts) => { ... return getDiff(repo.path, { ...opts, includeUntracked }); })` returns `FileDiff[]` where every source line is an object `{ kind, content, oldLineNumber, newLineNumber }` (shared/types.ts DiffLine). PullRequestDetailView's `useAllDiffQuery` (src/views/PullRequestDetailView.tsx:43-50) fires this for the whole PR before anything renders: a 10k+ line PR becomes hundreds of thousands of JS objects serialized through one `ipcRenderer.invoke` reply — the main process blocks while structured-cloning the graph and the renderer blocks deserializing it, even though the user only ever views one file at a time. Because the query lives under `queryKeys.diff.repo(repoId)`, the entire blob is also recomputed and re-shipped on every `invalidateRepoQueries` (each stage/commit and each 30s auto-fetch).

**권장 수정**: For the PR view, fetch the changed-file list cheaply (`git diff --name-status -z base..head`) and load hunks per file on selection via the existing `diffFile` channel with base/head. Alternatively transfer the raw unified diff text per file and parse in the renderer; cap line counts per response with an explicit 'load more' escape hatch.

**검증 단계 보정**: The finding is correct except one nuance: stage/commit mutations do call invalidateRepoQueries, but they occur in the local review view where the PR diffAll query is unmounted; with TanStack Query 5's default refetchType 'active', the inactive query is only marked stale and the blob is re-shipped on the next mount of the PR detail view rather than immediately on every stage/commit. The 30s auto-fetch re-ship while the PR view is open is accurate as stated.

### [HIGH/security] Renderer sandbox explicitly disabled (sandbox: false) without need

- **위치**: `electron/main.ts:23-28`
- **발견**: electron-core

webPreferences sets `sandbox: false`:
```
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
},
```
The preload (electron/preload.ts) only uses `contextBridge` and `ipcRenderer`, both of which are fully available in sandboxed preloads, so nothing here requires disabling the sandbox. With the sandbox off, the renderer process runs with full OS privileges; any renderer compromise (a Chromium bug triggered by content the app displays — diffs/files from arbitrary cloned repos, GitHub API data, the remote Google Fonts stylesheet loaded by src/index.html — or a navigation hijack, see the missing setWindowOpenHandler finding) escalates directly to arbitrary code execution as the user instead of being contained.

**권장 수정**: Delete the `sandbox: false` line (sandbox defaults to true since Electron 20). The preload as written will keep working; if a future preload needs Node built-ins, refactor it to use only the sandboxed-preload API surface rather than disabling the sandbox.

**검증 단계 보정**: The issue is real: sandbox: false in electron/main.ts:27 needlessly removes the OS sandbox from a renderer that displays untrusted repo/GitHub content and loads a remote stylesheet, with no window-open/navigation handlers as defense in depth. Correction to the remediation only: simply deleting the line will break the app, because the tsc-compiled (unbundled) preload does require("../shared/types") at runtime, which sandboxed preloads cannot load (their polyfilled require supports only electron/events/timers/url). To re-enable the sandbox, also bundle the preload into a single file (e.g., esbuild/vite) or inline the IpcChannels constants into preload.ts.

### [HIGH/security] No setWindowOpenHandler or will-navigate hardening; new windows/navigations inherit the full IPC bridge

- **위치**: `electron/main.ts:16-41`
- **발견**: electron-core

`createWindow()` configures the BrowserWindow but never calls `mainWindow.webContents.setWindowOpenHandler(...)` and never registers a `will-navigate` (or `will-frame-navigate`) handler; there is no navigation restriction anywhere in main.ts. Default Electron behavior is to allow `window.open()`/`target=_blank` to create real child BrowserWindows that inherit the opener's webPreferences — including the preload bridge and the disabled sandbox — and to allow the main window to navigate anywhere. If any remote or attacker-influenced page ever gets loaded (e.g. via the dev-server URL fallback `process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'` on line 31, an XSS, or a future markdown/link feature for PR bodies), that page receives the entire `window.differ` API: running git operations on any registered repo, reading repo files, making GitHub API calls with the stored token, and `shell.openExternal` with arbitrary URLs.

**권장 수정**: In createWindow(), add:
```ts
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
  return { action: 'deny' };
});
mainWindow.webContents.on('will-navigate', (e, url) => {
  if (url !== mainWindow?.webContents.getURL()) e.preventDefault();
});
```
Optionally also validate `event.senderFrame` in the IPC layer so only the main frame of the main window can invoke handlers.

**검증 단계 보정**: Finding is factually correct as written. Only adjustment: severity is better rated medium rather than high — it is a defense-in-depth gap, since the app never loads remote content and the renderer currently renders no attacker-controlled HTML/links, so the exposed IPC bridge is only reachable after a separate renderer compromise (XSS) or a future feature that loads/renders remote content.

### [HIGH/bug] Off-by-one in porcelain v2 unmerged ('u') record parsing — conflicted file paths are wrong or empty

- **위치**: `electron/services/git.ts:235-249`
- **발견**: electron-git

In parsePorcelainV2, the unmerged branch does:
```
const rest = tok.slice(5).split(' ');
const filePath = rest.slice(9).join(' ');
```
The porcelain v2 unmerged format is `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`. After `tok.slice(5)` strips `u XY `, the remaining fields are [sub, m1, m2, m3, mW, h1, h2, h3, path...], so the path starts at index 8, not 9. I verified against real git output: for a conflicted file `my file.txt`, `rest.slice(9)` yields `"file.txt"` (and for a path with no spaces it yields `""`), while `rest.slice(8)` correctly yields `"my file.txt"`. Every merge/rebase conflict therefore produces ChangedFile entries in the 'conflicted' group with an empty or truncated path, breaking the conflict list, diff lookup, and staging for those files. Note the '1' and '2' record branches (slice(6)/slice(7)) are correct — only 'u' is off.

**권장 수정**: Change `rest.slice(9)` to `rest.slice(8)` in the 'u' branch (line 239). Add a unit test that feeds a real `git status --porcelain=v2 -z` unmerged record (e.g. generated from a merge-conflict fixture) through parsePorcelainV2.

### [HIGH/bug] getOperationState resolves relative --git-path output against the Electron process cwd — rebase/merge detection is always wrong

- **위치**: `electron/services/git.ts:141-160`
- **발견**: electron-git

gitPath() runs `git rev-parse --git-path <name>` with `cwd: opts.cwd` and then getOperationState does:
```
const rebaseInProgress =
  (!!rebaseMerge && fs.existsSync(rebaseMerge)) || (!!rebaseApply && fs.existsSync(rebaseApply));
const mergeInProgress = !!mergeHead && fs.existsSync(mergeHead);
```
I verified that `git rev-parse --git-path MERGE_HEAD` prints a path relative to the git process's cwd (e.g. `.git/MERGE_HEAD`, or `../.git/MERGE_HEAD` from a subdir). `fs.existsSync` then resolves that relative path against the Electron main process's cwd (`/` in a packaged app, the differ source tree in dev), not against the repository. Result: `rebaseInProgress`/`mergeInProgress` in RepoStatus are effectively always false (with false positives possible if the app's own cwd happens to contain `.git/MERGE_HEAD`). The syncWithRemote comment says the UI relies on this to 'route the user to the Resolve view', so conflict routing is silently broken.

**권장 수정**: Resolve the returned path against the repo cwd (`path.resolve(cwd, p)`), or better, use one git call: `git rev-parse --path-format=absolute --git-path rebase-merge --git-path rebase-apply --git-path MERGE_HEAD` (git ≥2.31) and split on newlines. That also collapses the three extra `git` process spawns per getStatus call into one.

**검증 단계 보정**: Finding is correct in substance. One narrow exception to the title's "always wrong": in a linked git worktree, `--git-path` happens to emit an absolute path (e.g. <main>/.git/worktrees/<wt>/MERGE_HEAD), so detection accidentally works there. For ordinary repositories — the normal case — the relative output (.git/MERGE_HEAD) is resolved against the Electron process cwd and detection is broken exactly as described, including the dev-mode false-positive vector (the differ source tree is itself a git repo).

### [HIGH/bug] parseUnifiedDiff cannot handle quoted (non-ASCII) or space-containing paths in diff headers — diffs and hunk staging break for unicode filenames

- **위치**: `electron/services/git.ts:372-385, 425-432, 490-506`
- **발견**: electron-git

With git's default `core.quotepath=true` (and runGit forcing `LC_ALL=C`), any non-ASCII filename appears octal-escaped and double-quoted in diff headers. Verified output for `한글파일.txt`:
```
diff --git "a/\355\225\234...txt" "b/\355\225\234...txt"
+++ "b/\355\225\234...txt"
```
The parser's `line.match(/^diff --git a\/(.+) b\/(.+)$/)` fails on the leading quote, and the `+++` fallback `current.filePath = after.replace(/^b\//, '')` leaves the quoted/escaped garbage as filePath. Downstream, the repoStageHunk handler (electron/ipc.ts:231) matches `diffs.find((f) => f.filePath === filePath)` — which never matches the real path — so hunk staging on any non-ASCII filename fails with 'No unstaged changes for ...', and the diff viewer shows escaped octal paths. Separately, the greedy regex misparses any path containing ' b/' (e.g. dir 'a b'): for `diff --git a/src/a b/c.txt b/src/a b/c.txt` it sets oldPath to a bogus value and isRenamed=true.

**권장 수정**: Pass `-c core.quotepath=false` (i.e. prepend ['-c','core.quotepath=false'] to args) on all diff/log invocations in getDiff, and prefer the `--- a/...` / `+++ b/...` / `rename from/to` lines over the ambiguous `diff --git` line for path extraction (or run a separate `git diff --raw -z` to get authoritative NUL-delimited paths). Add tests with unicode and space-containing filenames.

### [HIGH/bug] buildSingleHunkPatch generates invalid patches for new/deleted files — stage-hunk on untracked files errors, unstage-hunk on added files leaves an empty blob staged

- **위치**: `electron/services/git.ts:683-713`
- **발견**: electron-git

buildSingleHunkPatch always emits a modify-style header:
```
`--- a/${file.oldPath ?? file.filePath}\n` +
`+++ b/${file.filePath}\n`
```
ignoring file.isNew/isDeleted, so it never emits `/dev/null` or `new file mode` headers. Two verified failure modes: (1) The DiffViewer renders Stage buttons on every hunk, including untracked files synthesized by synthesizeUntrackedDiff (hunk header `@@ -0,0 +1,N @@`); `git apply --cached` on that patch fails with `error: <path>: does not exist in index` (exit 1) — staging a hunk of an untracked file always errors. (2) unstageHunk on a newly `git add`ed file reverse-applies the same shape of patch, which succeeds (exit 0) but leaves the file in the index as an empty blob (`100644 e69de29... 0`, status `AM`) instead of removing it from the index — a silently wrong index state the user did not ask for.

**권장 수정**: In buildSingleHunkPatch, emit `--- /dev/null` plus a `new file mode 100644` line when file.isNew, and `+++ /dev/null` with `deleted file mode` when file.isDeleted. For unstaging the sole hunk of a new file, fall back to `git restore --staged -- <path>` (or `git rm --cached`). For staging an entire untracked file's only hunk, just call `git add -- <path>` instead of apply.

### [HIGH/bug] parseGithubFromRemote rejects repository names containing dots (e.g. next.js) — GitHub integration silently disabled

- **위치**: `electron/services/git.ts:733-745`
- **발견**: electron-git

All three patterns use a character class that forbids dots in the repo name, e.g.:
```
let m = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
...
m = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/.*)?$/);
```
`[^/.]+` cannot match 'next.js', 'socket.io', 'differ.app', etc., and the optional literal `(?:\.git)?` can't absorb an arbitrary `.js` suffix, so the function returns null for any repo whose name contains a dot. This is consumed at electron/ipc.ts:464 to decide whether a repo has GitHub PR/review features — for a code-review app, a whole class of common repos (next.js-style names) silently loses its core feature with no error.

**권장 수정**: Allow dots in the repo group and only strip a trailing `.git`: e.g. `/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/` and `/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/`, then `repo.replace(/\.git$/, '')`. Add test cases for 'next.js' over ssh, https, and ssh:// forms.

### [HIGH/bug] listIssues fetches a single page and filters out PRs, silently truncating the issue list

- **위치**: `electron/services/githubService.ts:343-361`
- **발견**: electron-github

`const res = await client.issues.listForRepo({ ... per_page: 50 ... }); return res.data.filter((issue) => !issue.pull_request)...`. GitHub's issues endpoint returns pull requests interleaved with issues, and only one page of 50 is fetched with no pagination. In a PR-heavy repo (most active repos), the 50 most recently updated 'issues' are mostly PRs, so the visible issue list can shrink to a handful of items — or be empty — even though many open issues exist. The truncation is silent: the user just sees fewer issues than GitHub shows.

**권장 수정**: Paginate until you have accumulated the desired number of real issues (e.g. loop pages of 100 with client.paginate.iterator, filtering out `pull_request`, stop at N results or end of data), mirroring the loop already used in listPullRequests.

### [HIGH/react] Radix DropdownMenu typeahead steals focus from the new-branch input while typing

- **위치**: `src/components/BranchMenu.tsx:93-108`
- **발견**: react-components

The new-branch `<input ... autoFocus onKeyDown={...} />` is rendered directly inside `DropdownMenu.Content`. Radix Menu (@radix-ui/react-dropdown-menu 2.1.2) handles character keydown events that bubble to the Content and runs typeahead, focusing the first `DropdownMenu.Item` whose text matches. New branch names almost always share a prefix with existing branch names (e.g. typing "fix-..." while a `fix/foo` branch is listed), so after the first matching character the input loses focus to a branch item; a subsequent Enter then activates `onSelect={() => void doCheckout(b.name)}` — checking out an unintended branch instead of creating one. Escape in the input also bubbles to Content and closes the whole menu, not just the create form.

**권장 수정**: Stop propagation of keydown from the input so Radix never sees it: `onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void doCreate(); if (e.key === 'Escape') setCreating(false); }}`. Alternatively render the create form in a Popover/Dialog instead of inside the menu, which is the Radix-recommended pattern for text inputs.

**검증 단계 보정**: The finding is correct except for one mechanism detail: Escape closes the menu via Radix DismissableLayer's document-level capture keydown listener (useEscapeKeydown registers with { capture: true }), not by bubbling to Content. Therefore the recommended e.stopPropagation() fixes the typeahead focus steal but will NOT prevent Escape from closing the whole menu — that requires onEscapeKeyDown={(e) => e.preventDefault()} on DropdownMenu.Content while the create form is open (or the suggested Popover/Dialog restructure).

### [HIGH/performance] Stage all / Unstage all issues one sequential IPC call plus full query invalidation per file

- **위치**: `src/components/ChangedFilesPanel.tsx:56-77`
- **발견**: react-components

`for (const f of byGroup.get(group) ?? []) { await stageFileMutation.mutateAsync(f.path); }` — each `mutateAsync` awaits the mutation's `onSuccess`, which is `invalidateRepoQueries(queryClient, repoId)` (src/query/hooks.ts:344-347): three `invalidateQueries` calls that refetch the active repo status query (a full `git status`) and the active diff query before the next loop iteration starts. Staging N files therefore costs N × (stage IPC + git status + diff refetch) executed strictly sequentially — for a few dozen untracked files this is multiple seconds of UI churn with the file list reshuffling on every iteration, when a single `git add` of all paths would do.

**권장 수정**: Add a batch IPC endpoint (`api.stageFiles(repoId, paths)` mapping to one `git add -- <paths...>`), or at minimum call the raw `api.stageFile` in the loop without per-file invalidation and run `invalidateRepoQueries`/`refresh()` once at the end.

### [HIGH/performance] Inline basicSetup object causes full CodeMirror reconfiguration on every render

- **위치**: `src/components/CodeViewer.tsx:160-174`
- **발견**: react-views-b

CodeViewer passes a fresh object literal every render: `basicSetup={{ lineNumbers: false, foldGutter: true, ... }}`. In @uiw/react-codemirror 4.25.9, useCodeMirror.js line 186 includes `defaultBasicSetup` (the basicSetup prop) in the deps of the effect that runs `view.dispatch({ effects: StateEffect.reconfigure.of(getExtensions) })`. Because the object identity changes every render, the editor is fully reconfigured (default extensions, syntax highlighting, fold gutter all rebuilt) on EVERY CodeViewer re-render. CodeViewer re-renders constantly: its own `EditorView.updateListener` (line 103) calls `selectionRef.current?.({ startLine, endLine })` on each selection change, which sets state in CodeBrowserView and re-renders CodeViewer — so dragging a text selection triggers a reconfigure per pointer move. Any global zustand store change (toast, activity, file filter) also re-renders CodeBrowserView via its unselected `useApp()` and cascades here. On large files (up to the 2MB truncation limit) this causes visible selection lag. The carefully-memoized `extensions` array (line 91) shows the author knew about this hazard but missed the basicSetup prop.

**권장 수정**: Hoist the basicSetup options object to a module-level constant (e.g. `const BASIC_SETUP: BasicSetupOptions = { lineNumbers: false, foldGutter: true, ... };`) and pass `basicSetup={BASIC_SETUP}`. Optionally hoist `style={{ fontSize: 13 }}` too, and wrap CodeViewer in React.memo with a stable `onAddLineComment` callback from CodeBrowserView.

### [HIGH/performance] Entire diff re-renders on every unrelated state change; no memoized row/hunk components

- **위치**: `src/components/DiffViewer.tsx:16, 59, 178-195, 360-362, 470-491`
- **발견**: react-views-b

DiffViewer calls `useApp()` (line 16), which internally calls `useAppStore()` with no selector — subscribing to every zustand store change — plus 4 React Query observers. None of HunkBlock / UnifiedRow / SideCell are wrapped in React.memo, and the props passed down are new identities each render: `const fileComments = state.comments.filter((c) => c.file_path === selected)` (line 59) creates a new array, and `onStage={() => void stageHunk(h.header)}` etc. (lines 186-193) create new closures per hunk per render. The consequence: typing in the file-filter input (each keystroke calls `setFileFilter` in the shared store), a toast appearing and auto-dismissing 3.2s later, or any activity-log push re-renders every diff line of every hunk. For a multi-thousand-line diff this is thousands of DOM reconciliations per keystroke — directly in the perf-critical path of the app. Even adding React.memo today would do nothing because every prop identity changes every render.

**권장 수정**: 1) Subscribe with selectors (`useAppStore((s) => s.selectedFile)` etc.) or split useApp so DiffViewer only re-renders on diff-relevant changes. 2) Wrap HunkBlock, UnifiedRow, and SideCell in React.memo. 3) Memoize `fileComments` with useMemo keyed on `[state.comments, selected]` and stabilize the stage/unstage/comment callbacks with useCallback (pass `hunkHeader` as an argument instead of closing over it). 4) For very large diffs, consider virtualizing rows (e.g. @tanstack/react-virtual) since all hunks render eagerly.

### [HIGH/performance] useApp() subscribes every consumer to the entire zustand store, re-rendering ~30 components on any state change

- **위치**: `src/state/AppStore.tsx:105-119`
- **발견**: react-state

`const clientState = useAppStore();` (line 106) is called with no selector, so every component that calls `useApp()` re-renders on EVERY store change. `useApp()` is used at ~30 call sites (DiffViewer, ReviewPanel x6, TopBar, HistoryView x5, ChangedFilesPanel, etc.). Concretely: each keystroke in the file-filter input (ChangedFilesPanel.tsx:88 `dispatch({ type: 'setFileFilter', value: e.target.value })`) re-renders DiffViewer (which hosts CodeMirror diffs), every ReviewPanel section, TopBar, HistoryView, etc. The same happens twice per toast (show + auto-dismiss timeout in store.ts:139-145) and on every `pushActivity`. Worse, `useAutoFetch()` calls `useApp()` from App.tsx, so the ROOT component re-renders on every store change, cascading through the whole mounted tree. Additionally each `useApp()` call mounts 4 query observers (lines 110-119: status, comments, fileStates, selected-file diff), so ~30 consumers create ~120 observers that all receive notifications on every cache update.

**권장 수정**: Kill the monolithic facade. Have components subscribe with narrow selectors (`useAppStore(s => s.fileFilter)`, or object selectors wrapped in `useShallow`) and call only the query hooks they actually need (e.g. only DiffViewer needs useFileDiffQuery). If a transitional facade is required, split `useApp()` into `useAppState(selector)` + a stable `useAppActions()` so subscriptions are scoped.

**검증 단계 보정**: Finding is correct as stated, with two minor quantitative fixes: ReviewPanel has 7 useApp() call sites (not 6), and the "~120 query observers" figure is an upper bound — views are mutually exclusive, so only the mounted subset of the 29 call sites creates observers at any time (e.g. in the local-changes view roughly 13-15 consumers / ~50-60 observers). Also, TanStack Query 5 observers are notified per-query (tracked properties), not on every cache update; the real cost is that all mounted consumers re-render whenever any of the four shared queries' data changes, plus on every zustand state change due to the selector-less subscription at AppStore.tsx:106.

### [HIGH/bug] refresh() uses fetchQuery which honors staleTime 5s, so refresh after pull/push/sync can silently return stale status

- **위치**: `src/state/AppStore.tsx:129-159`
- **발견**: react-state

`await queryClient.fetchQuery(repoStatusQueryOptions(snapshot.repo.id));` — `fetchQuery` returns cached data without hitting the queryFn when the data is fresher than `staleTime` (globally 5_000ms in src/query/client.ts:6). `refresh()` is the app's "make UI reflect current git state" primitive, and TopBar.tsx:333-376 calls `await api.sync/push/pull(repoId)` directly (no cache invalidation) followed by `await refresh()`. If the status query was fetched within the previous 5 seconds — very likely, since useAutoFetch invalidates and refetches it every 30s and on focus — the refresh is a no-op and the pulled/synced changes (changed files, ahead/behind, conflict state) do not appear until the next background fetch up to ~30s later. The same applies to the file-diff fetchQuery at lines 144-150. Note refresh() also never invalidates branches/commits, so HistoryView stays stale after a pull.

**권장 수정**: In refresh(), force freshness: `queryClient.fetchQuery({ ...repoStatusQueryOptions(id), staleTime: 0 })` (same for the diff fetch), or call `invalidateRepoQueries(queryClient, repo.id)` first and await the refetch. That also fixes branches/commits staleness after pull/sync.

### [HIGH/performance] useApp() subscribes every consumer to the entire zustand store and mounts 4 query observers per call — file-filter keystrokes re-render the whole app including the full diff DOM

- **위치**: `src/state/AppStore.tsx:105-119, 299-353`
- **발견**: architecture

`const clientState = useAppStore();` (AppStore.tsx:106) is a selector-less subscription, so every component calling `useApp()` re-renders on ANY store change. useApp() is used by 16 components (TopBar, DiffViewer, ReviewPanel, ProjectSidebar, ChangedFilesPanel, HistoryView, LocalChangesView, CodeBrowserView, CommentComposer, useAutoFetch in the root Shell, etc.) and additionally by `InlineCommentRow` (DiffViewer.tsx:557), i.e. once per rendered diff comment. Each call also mounts useRepoStatusQuery + useCommentsQuery + useFileStatesQuery + useFileDiffQuery (AppStore.tsx:110-119) regardless of whether the consumer needs them (TopBar and CommentComposer observe the selected file's diff). Concrete scenario: typing in the file filter input (ChangedFilesPanel.tsx:88 dispatches `setFileFilter` per keystroke) invalidates the `state` useMemo (dep `clientState.fileFilter`, AppStore.tsx:332) in all 16 consumers, re-rendering DiffViewer's entire hunk/line DOM (potentially thousands of rows, no memoized rows, no virtualization) on every keystroke. Same for every toast, activity event, and 15s `now` tick interactions.

**권장 수정**: Kill the monolithic `useApp()` facade. Have components select only what they need (`useAppStore((s) => s.fileFilter)` etc., as PullRequestsView/IssuesView already do) and call the specific query hook they need. For DiffViewer, additionally memoize row components (React.memo on UnifiedRow/SideCell keyed by line + comments) and pass comment data/callbacks into InlineCommentRow via props instead of calling useApp() per row.

**검증 단계 보정**: The finding is accurate except one detail: the 15-second `now` tick is local useState inside TopBar (/Users/jiun/develop/differ/src/components/TopBar.tsx:16,24), not a zustand store update, so it re-renders only TopBar — not all useApp() consumers. Toasts, activity events, and file-filter keystrokes do go through the store and re-render every selector-less consumer as claimed. Also, 're-renders the full diff DOM' should read 're-executes the full diff render/reconciliation' — actual DOM mutations are minimal, but the per-keystroke React render over all unmemoized hunk/line rows is the real cost.

### [HIGH/bug] PR diff is computed against the base branch tip instead of the merge-base, showing unrelated changes

- **위치**: `src/views/PullRequestDetailView.tsx:43-50`
- **발견**: react-views-a

The diff query is built as `useAllDiffQuery(repo?.id ?? null, { base: detail ? `origin/${detail.baseRef}` : undefined, head: detail?.headSha }, !!detail)`. In the main process, getDiff (electron/services/git.ts:495) runs `git diff ${base}..${head}`, and for `git diff` the two-dot range is a plain two-point comparison. So the view diffs the PR head against the CURRENT tip of origin/<base> (ghPrCheckout even fetches the latest base ref first, electron/ipc.ts:407). Whenever the base branch has advanced since the PR branched off — the normal case for any PR open more than a few hours on an active repo — every commit landed on base appears in the PR diff as reverted changes: files the PR never touched show up in 'Changed files', and real PR files show phantom deletions. GitHub's PR diff uses the merge-base (three-dot semantics), so this view silently disagrees with what the reviewer sees on github.com. This is the core review surface of the app rendering an incorrect diff.

**권장 수정**: Diff from the merge-base, mirroring GitHub. Easiest: have the main process compute `git merge-base origin/<baseRef> <headSha>` during ghPrCheckout (or in getDiff when given a PR range) and use that SHA as `base`; alternatively make getDiff use the three-dot form `base...head` for PR diffs. The session already stores baseSha/headSha, so the merge-base could be persisted on the session and passed from this view instead of `origin/${detail.baseRef}`.

### [HIGH/bug] Local line comments are saved but never rendered in the PR diff

- **위치**: `src/views/PullRequestDetailView.tsx:286-336`
- **발견**: react-views-a

PrFileDiff renders hunk comments (`comments.filter((c) => c.target_kind === 'hunk' && c.hunk_header === h.header)`, line 317) and file comments (`comments.filter((c) => c.target_kind === 'file')`, line 330), but there is no rendering path for `target_kind === 'line'` — the primary comment type the UI promotes via double-click and the per-line '+' button (lines 296-310). CommentComposer saves the comment to SQLite, the dialog closes, and the comment is completely invisible in the diff: no inline body, no gutter marker. The only places a line comment ever surfaces are the aggregate 'Local comments' count in PrSummaryPanel and the checkbox list inside SubmitReviewDialog. A reviewer who annotates several lines has no way to see, edit, or delete those comments from the diff they annotated, and will likely re-add duplicates believing the first save failed.

**권장 수정**: Inside the `h.lines.map` loop, after each rendered line, render the matching line comments: `comments.filter(c => c.target_kind === 'line' && c.hunk_header === h.header && c.line_number === lineNumber && c.diff_side === side)` (or match by line_number/side across the hunk). At minimum render a gutter marker plus an expandable comment body, with edit/delete actions like the local-changes review panel.

### [HIGH/bug] Diff rendering is implemented twice (DiffViewer vs PullRequestDetailView) and has already diverged: line comments created in the PR diff are never displayed there

- **위치**: `src/views/PullRequestDetailView.tsx:237-340`
- **발견**: architecture

PrFileDiff (PullRequestDetailView.tsx:286-315) reimplements the unified diff row markup of DiffViewer's UnifiedRow (DiffViewer.tsx:368-420): same `cls` derivation, same gutter/body/'+' comment button markup. The copy has diverged: PrFileDiff renders only hunk comments (`comments.filter((c) => c.target_kind === 'hunk' ...)`, lines 316-325) and file comments (lines 329-336) — there is NO rendering of `target_kind === 'line'` comments, even though the same view's composer creates them (`setComposer({ target: 'line', ... })`, lines 184-186). Scenario: a reviewer double-clicks a line in the PR diff, writes a comment, saves — the dialog closes and the comment vanishes from sight (it exists in SQLite and reappears only in the SubmitReviewDialog checklist), which reads as data loss. Also, unlike DiffViewer, context-line comments and split mode are unsupported here.

**권장 수정**: Extract the diff renderer (UnifiedHunk/UnifiedRow/SplitHunk/SideCell + commentsByLine from DiffViewer.tsx:329-554) into a shared component, e.g. src/components/diff/DiffHunks.tsx taking `{diff, comments, mode, onAddLineComment, onAddHunkComment, renderComment}` props, and use it in both LocalChanges DiffViewer and PrFileDiff. That fixes the missing inline line comments in the PR view for free.

### [HIGH/bug] PR review session permanently leaks into Local Changes / Code views after opening a PR

- **위치**: `src/views/PullRequestsView.tsx:49-60`
- **발견**: sweep:async-races

openPrMutation's `onSuccess: (session, pr) => { setSession(session); setPrNumber(pr.number); setView('pr-detail'); }` replaces the active session with the PR session, and nothing ever restores the local session afterwards. TopBar's ViewSwitch only calls `setView`, and AppStore.refresh() (AppStore.tsx:136) only resolves a local session `if (!session)` — which is never true once a PR session is set. So after viewing any PR, switching back to the Local tab leaves `state.session` pointing at the PR session: CommentComposer (`useCreateCommentMutation(state.session?.id)`), DiffViewer's viewed-state writes (`useSetFileStateMutation(sessionId)`), and loadDiff's auto-'viewed' marking all write local working-tree review data into the pull_request session rows. Those local comments then surface in the PR's SubmitReviewDialog (`state.comments`) with working-tree line numbers and can be posted to GitHub at wrong positions, while the actual local session shows nothing. Only switching repositories (which nulls the session) escapes this state.

**권장 수정**: Scope the session to the view context: when the view changes to 'local'/'code'/'history', re-resolve the local session (e.g. setView('local') triggers ensureLocalSession for the current repo), or store localSession and prSession separately in the store and select by view, rather than sharing a single mutable `session` slot.

### [MEDIUM/security] IPC handler wrapper blindly casts renderer args with zero runtime validation

- **위치**: `electron/ipc.ts:92-94`
- **발견**: electron-core

```
const handle = <T extends unknown[], R>(channel: string, fn: (...args: T) => Promise<R> | R): void => {
  ipcMain.handle(channel, async (_e, ...args) => fn(...(args as T)));
};
```
Every handler trusts renderer-supplied values via a compile-time-only cast; nothing checks types, shapes, or ranges at runtime, and `_e.senderFrame` is never validated. Concrete consequences: `repoCheckout` (lines 204-208) forwards `branch` into `runGit(['checkout', branch])` (git.ts:660) with no `--` separator, so a string like `.` discards all working-tree changes and a leading-dash string is parsed as a git option; `fileStateSet` (lines 344-346) force-casts an arbitrary string into the status union (`status as Parameters<typeof setFileState>[2]`), so invalid values surface as raw SQLite CHECK-constraint errors; `commentCreate` passes `input` (typed `unknown` in preload.ts:61) straight into the DB layer. Today the renderer is first-party, but combined with the missing navigation hardening and disabled sandbox this is the last line of defense, and it is absent.

**권장 수정**: Validate at the IPC boundary: assert primitives (`typeof repoId === 'number' && Number.isInteger(repoId)`), validate string enums against allowlists, and validate object payloads (a small schema validator or hand-rolled guards). For git, always pass user-supplied refs/paths after `--` or via explicit flags. Also consider rejecting calls where `event.senderFrame !== mainWindow.webContents.mainFrame`.

**검증 단계 보정**: Minor wording only: `git checkout .` discards unstaged modifications to tracked files (staged changes survive), so 'discards all working-tree changes' is slightly overbroad. All other claims are accurate as written; note the cited git.ts is at electron/services/git.ts (line 660 matches).

### [MEDIUM/security] shell.openExternal called with unvalidated renderer-supplied URL (any protocol)

- **위치**: `electron/ipc.ts:451-454`
- **발견**: electron-core

```
handle(IpcChannels.shellOpenExternal, async (url: string) => {
  await shell.openExternal(url);
  return true;
});
```
The URL string from the renderer is passed straight to `shell.openExternal`, which on the OS level launches the default handler for any scheme: `file:///...` (open arbitrary local files/apps), `smb://` (credential-leaking mounts on macOS), or arbitrary registered protocol handlers. The renderer currently only calls it with GitHub OAuth verification URIs (src/components/GithubAuthDialog.tsx:55,197), so legitimate use is strictly https. If the renderer is ever compromised (XSS, hijacked navigation), this handler converts that into launching local content.

**권장 수정**: Parse and allowlist the scheme in the handler:
```ts
const u = new URL(url);
if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Blocked URL');
await shell.openExternal(u.toString());
```

### [MEDIUM/architecture] electron/ipc.ts is a 503-line single registrar mixing 7 domains plus inline business logic and a pointless dynamic import

- **위치**: `electron/ipc.ts:90-503`
- **발견**: architecture

registerIpcHandlers registers ~55 channels across repo lifecycle, diff, sessions, comments, file state, GitHub auth/PRs/issues/OAuth, and system in one function. Beyond size, domain logic lives inline in the transport layer: repo onboarding (`openRepoAtPath`, ipc.ts:457-475 — isGitRepo/toplevel/remote/parseGithub/upsert), hunk lookup for staging (ipc.ts:228-248), PR checkout fetch sequencing (ipc.ts:399-409), and clone folder derivation (ipc.ts:496-503). Notably line 405 does `const { runGit } = await import('./services/git');` inside the handler even though './services/git' is already statically imported at the top of the file (lines 5-32) — the lazy import buys nothing and hides the dependency. The 60-import header (lines 1-80) is the symptom.

**권장 수정**: Split into per-domain registrars colocated with their services: electron/ipc/repo.ts, diff.ts, session.ts, comments.ts, github.ts, system.ts, each exporting `register(deps)`, with ipc.ts reduced to composing them. Move openRepoAtPath into repoStore (or a new repoService), move the hunk-lookup into git.ts (e.g. `stageHunkByHeader(cwd, filePath, header)`), and replace the dynamic import with the existing static one by adding `runGit` to the import list.

**검증 단계 보정**: Minor count imprecision only: the file registers 59 channels (not "~55"), and the lines 1-80 header contains 12 import statements pulling in ~77 named identifiers (not exactly "60 imports"). All other cited facts are exact.

### [MEDIUM/bug] ghPrCheckout fetches PR objects once by ref while the renderer diffs a live headSha — PR updated during review breaks the diff

- **위치**: `electron/ipc.ts:399-409`
- **발견**: sweep:async-races

ghPrCheckout snapshots the head from the GitHub API and then fetches by ref name: `const detail = await getPullRequestDetail(...); await runGit(['fetch', 'origin', `pull/${prNumber}/head`], ...); return ensurePrSession(repoId, prNumber, detail.headSha, ...)`. Two desyncs follow. (1) If the PR is force-pushed between the API call and the fetch, the fetch retrieves only the NEW head, so `detail.headSha` (old) is unreachable and `git diff origin/<base>..<headSha>` fails on first open. (2) More commonly: PullRequestDetailView diffs against a LIVE query (`head: detail?.headSha` from useGithubPullRequestDetailQuery), and invalidateRepoQueries — triggered every 30s by silentFetch/useAutoFetch — invalidates `github.repo(repoId)` and refetches the PR detail. The moment the PR receives new commits on GitHub, the diff query re-runs with a headSha whose objects were never fetched locally (fork PRs especially, which `fetch --all` does not cover), so the entire diff view collapses to an error toast plus 'No diff available. The PR head may have moved; try re-checking out.' for the rest of the review until the user manually re-opens the PR.

**권장 수정**: After fetching `pull/<n>/head`, resolve the actually-fetched SHA in the main process (`git rev-parse FETCH_HEAD`) and use that as the session/diff head instead of the API snapshot. In the renderer, when detail.headSha changes relative to the session's head_sha, re-run the checkout/fetch (or expose a ghPrRefetch IPC) before issuing the diff query.

**검증 단계 보정**: Core issue is real but scenario (1) is inaccurate. ghPrCheckout (electron/ipc.ts:399-409) fetches pull/N/head exactly once, while PullRequestDetailView diffs against the LIVE detail.headSha from useGithubPullRequestDetailQuery; invalidateRepoQueries (triggered every 30s by useAutoFetch/silentFetch) refetches that detail, and when the PR gains new commits the diff query runs git diff origin/<base>..<newSha> against objects never fetched locally — git exits 128, runGit throws, and the view collapses to an error toast plus 'No diff available...' until the user re-opens the PR. This persistently affects fork PRs (git fetch --all covers neither refs/pull/* nor fork remotes); same-repo PRs are mostly self-healing because silentFetch runs git fetch --all BEFORE invalidating, pulling the head branch tip from origin. However, scenario (1) — force-push during the checkout window breaking the diff 'on first open' — is wrong: the renderer's diff head comes from a fresh ghPrDetail call made AFTER the fetch, so it carries the NEW sha that the pull/N/head fetch did retrieve; the stale API snapshot only lands in the session row (ensurePrSession), which the diff view never reads.

### [MEDIUM/security] dotenv loads .env from process.cwd(), letting the launch directory inject env vars that control which URL is loaded

- **위치**: `electron/main.ts:4-7`
- **발견**: electron-core

```
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
```
The second call reads `.env` from whatever directory the app happens to be launched from. For a git review tool, launching from a terminal inside a freshly cloned (untrusted) repository is a realistic scenario; a `.env` committed to that repo can then set any not-yet-defined env var. Because lines 31-32 do `const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'; if (process.env.NODE_ENV === 'development')`, a foreign `.env` containing `NODE_ENV=development` and `VITE_DEV_SERVER_URL=http://...` makes a packaged/`npm start` app load an attacker-chosen URL with the preload bridge attached and DevTools open. It can also override `GITHUB_CLIENT_ID` used by the OAuth device flow. Additionally, the comment on lines 4-5 says the first path covers "the resources dir (packaged)", but `__dirname/../../.env` resolves inside app.asar (`dist/electron/../../`), not `process.resourcesPath`, so the documented packaged behavior is wrong.

**권장 수정**: Drop the `process.cwd()` dotenv call entirely. Load `.env` only in development (`if (!app.isPackaged)`) from the project root, and for packaged builds read config from `process.resourcesPath` or app userData. Gate dev-mode on `!app.isPackaged` instead of `NODE_ENV` so environment variables cannot flip a production build into dev loading.

**검증 단계 보정**: The cwd-based dotenv load (electron/main.ts:7) is a real issue: a `.env` in an untrusted launch directory can set NODE_ENV=development and VITE_DEV_SERVER_URL (dotenv only fills undefined vars), making the app load an attacker-chosen URL with the privileged preload bridge and DevTools — but only when NODE_ENV is otherwise unset (e.g., a packaged binary or bare `electron <app>` launched from a terminal in that directory). The `npm start` case in the finding is wrong: `start` uses `cross-env NODE_ENV=production`, which dotenv cannot override, and cwd is the project root. The OAuth env var that can be injected is DIFFER_GITHUB_OAUTH_CLIENT_ID (and DIFFER_GITHUB_OAUTH_SCOPES), not GITHUB_CLIENT_ID. The comment-vs-behavior claim is accurate: in a packaged app, __dirname/../../.env resolves inside app.asar, not the resources dir.

### [MEDIUM/security] Renderer sandbox disabled without need; no navigation guards on the BrowserWindow

- **위치**: `electron/main.ts:23-37`
- **발견**: architecture

webPreferences sets `sandbox: false` (main.ts:27). The preload (electron/preload.ts) only uses `contextBridge` and `ipcRenderer`, both of which are fully supported in sandboxed preloads, so the sandbox is being disabled for no functional reason while the renderer does load remote content (GitHub avatar `<img src>` in TopBar.tsx:226, RepoBrowserDialog.tsx:110/218). Additionally there is no `will-navigate` handler or `setWindowOpenHandler` anywhere in main.ts, so the default Chromium behaviors remain — e.g. dragging-and-dropping a file onto the window navigates the renderer to `file://`, replacing the app with raw file contents and the preload bridge still attached.

**권장 수정**: Set `sandbox: true`, and in createWindow add `mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))` plus a `will-navigate` listener that `event.preventDefault()`s any navigation away from the dev URL / index.html.

**검증 단계 보정**: The finding is correct in substance. Minor correction: the claim that sandbox is disabled "for no functional reason" overlooks that the preload's compiled output does `require("../shared/types")` (dist/electron/preload.js line 4), which throws in an Electron 33 sandboxed preload where require is restricted to a small module allowlist. Enabling `sandbox: true` therefore also requires bundling the preload into a single file (e.g., with esbuild) or inlining the IpcChannels strings — the Electron APIs used (contextBridge, ipcRenderer) are otherwise fully sandbox-compatible. The missing setWindowOpenHandler/will-navigate guards and unguarded remote content (GitHub avatars, Google Fonts, no CSP) are confirmed as described.

### [MEDIUM/security] GitHub OAuth tokens persisted in plaintext SQLite when safeStorage is unavailable

- **위치**: `electron/services/accountStore.ts:36-57`
- **발견**: electron-stores

upsertAccount() writes `input.tokenPlain` into the `token_plain` column (schema at db.ts:100, `token_plain TEXT`). The value comes from githubService.encryptToken(): `if (safeStorage.isEncryptionAvailable()) {...} return { encrypted: null, plain: token };` — i.e. when Electron safeStorage has no OS keychain backend (common on Linux without gnome-keyring/kwallet, and in some packaged/AppImage setups), the raw GitHub OAuth token is silently written unencrypted to differ.sqlite3 in userData, plus copies in the -wal file and any backups. There is no user-facing warning that this fallback occurred. The legacy `github_token_plain` app_settings key has the same property and is only deleted if migration succeeds (githubService.ts:127-131).

**권장 수정**: Do not persist the plaintext fallback. When safeStorage is unavailable, keep the token in memory only and require re-auth on next launch (or prompt the user with an explicit opt-in warning before storing plaintext). Also note safeStorage on Linux can report available while using the trivially-reversible basic_text backend — consider checking safeStorage.getSelectedStorageBackend().

### [MEDIUM/architecture] No schema versioning or migration framework — non-additive schema changes are impossible

- **위치**: `electron/services/db.ts:32-127`
- **발견**: electron-stores

applyMigrations() consists only of `CREATE TABLE IF NOT EXISTS ...` plus `ensureColumn()` (ALTER TABLE ADD COLUMN if missing). There is no PRAGMA user_version or migrations table. Constraints are baked into the CREATE statements, e.g. `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved'))` and `target_kind TEXT NOT NULL CHECK (target_kind IN ('file','line','hunk'))` (lines 67, 73). Because CREATE TABLE IF NOT EXISTS is a no-op on existing DBs, any future change to a CHECK value list, NOT NULL-ness, index definition, or any data transform has no mechanism to reach upgraded installs: fresh installs would get the new schema while existing users keep the old one, causing INSERTs that work in dev to fail with SQLITE_CONSTRAINT_CHECK in the field. The shared types (CommentTargetKind, CommentStatus, FileReviewStatus) are exactly the kind of enums that grow over time.

**권장 수정**: Adopt versioned migrations: read `PRAGMA user_version`, run an ordered array of migration functions for versions above it inside a single transaction (`db.transaction(...)`), then bump user_version. Keep the current schema as migration 1. This also replaces the ad-hoc ensureColumn checks.

### [MEDIUM/bug] Corrupt or unreadable database aborts startup with no error handling or recovery

- **위치**: `electron/services/db.ts:8-18`
- **발견**: electron-stores

`db = new Database(dbPath); db.pragma('journal_mode = WAL'); ... applyMigrations(db);` has no try/catch and no recovery path. If differ.sqlite3 is corrupt or not a database (SQLITE_CORRUPT / SQLITE_NOTADB — e.g. after a bad disk write or a partial restore of the WAL file), the first pragma/exec throws. The only caller is main.ts:44-47 `app.whenReady().then(() => { initDatabase(); registerIpcHandlers(...); createWindow(); })` — the throw becomes an unhandled promise rejection before createWindow() runs, so the app launches with no window and no error dialog; to the user it simply does nothing, and the only fix is manually finding and deleting the sqlite file.

**권장 수정**: Wrap open+migrate in try/catch. On failure, rename the corrupt file aside (e.g. differ.sqlite3.corrupt-<timestamp>, plus -wal/-shm) and reopen a fresh database, and/or show a dialog.showErrorBox explaining what happened before continuing or quitting.

### [MEDIUM/security] safeJoin is lexical-only; symlinks inside the repo let readFile escape the repository root

- **위치**: `electron/services/fileTree.ts:28-37`
- **발견**: electron-stores

safeJoin guards with `const target = path.resolve(joined); if (target !== root && !target.startsWith(root + path.sep)) throw ...` — a purely lexical check. readFile() (lines 70-73) then calls `fs.stat(abs)` and `fs.readFile(abs)`, both of which follow symlinks. A cloned repository containing a committed symlink (e.g. `creds -> /Users/jiun/.ssh/id_ed25519` or `-> ../../outside`) passes the containment check, and its target's contents are read and returned to the renderer. listTree skips symlinks in the tree UI, but readFile is independently reachable over IPC (ipc.ts:273-276, repoReadFile) with any rel path — e.g. git diff/PR file lists include symlink paths, so clicking such a file in a malicious repo exfiltrates the target into the viewer.

**권장 수정**: In readFile, use fs.lstat and refuse symlinks (matching listTree's policy), or resolve via fs.realpath and re-verify the realpath is contained within the realpath of repoRoot before reading.

### [MEDIUM/bug] Hardcoded SKIP_DIRS hides legitimately tracked directories (dist, build, out, .vscode) from the file tree

- **위치**: `electron/services/fileTree.ts:5-19`
- **발견**: electron-stores

`const SKIP_DIRS = new Set(['.git','node_modules',...,'dist','build','out',...,'.vscode',...])` is applied unconditionally in listTree (line 44: `if (SKIP_DIRS.has(d.name)) continue;`). Many repos track these names as real source: `build/` (Chromium, many Go/CMake projects, scripts dirs), committed `dist/` (published JS libs, gh-pages), `out/` and shared `.vscode/` settings. Files in those directories are invisible in the tree at every depth and cannot be browsed, with no indication why. Meanwhile actually-ignored dirs not in the list (.venv, __pycache__, target, vendor) are still shown, so the heuristic is wrong in both directions.

**권장 수정**: Drive the listing from git instead of a hardcoded set: use `git ls-files` / `git status --porcelain` output (the repo path always comes from a git repository here), or filter via `git check-ignore --stdin`, falling back to SKIP_DIRS only for non-git contexts.

### [MEDIUM/bug] runGit decodes stdout per 64KB chunk — multibyte UTF-8 characters straddling chunk boundaries are corrupted to U+FFFD

- **위치**: `electron/services/git.ts:49-56`
- **발견**: electron-git

```
child.stdout.on('data', (d: Buffer) => {
  stdout += d.toString('utf8');
});
```
`Buffer.toString('utf8')` on an individual chunk replaces a multibyte sequence split across the ~64KB pipe chunk boundary with U+FFFD replacement characters. Any diff/log output larger than one pipe buffer that contains multibyte text (CJK comments/identifiers, emoji) can be corrupted mid-stream. This is not just cosmetic: stageHunk/unstageHunk re-serialize the parsed lines back into a patch (serializeHunk) and pipe it to `git apply`, so a corrupted context line makes the patch fail to apply (or worse, corrupted '+' content could be staged verbatim via the synthesized untracked path).

**권장 수정**: Either call `child.stdout.setEncoding('utf8')` / `child.stderr.setEncoding('utf8')` (Node's StringDecoder handles split code points), or accumulate Buffers in an array and do a single `Buffer.concat(chunks).toString('utf8')` on close.

**검증 단계 보정**: The finding is correct except one detail: corrupted '+' content cannot enter via the synthesized untracked path — synthesizeUntrackedDiff (git.ts:527-587) reads the file with fs.readFileSync and decodes the entire buffer in a single toString('utf8'), bypassing runGit's chunked decode. Verbatim staging of corrupted '+' content is only possible for tracked-file hunks parsed from chunked git diff output (when context lines happen to remain intact so git apply succeeds).

### [MEDIUM/bug] allowNonZeroCodes: [1] on git restore swallows real failures — unstage/discard silently no-op on errors

- **위치**: `electron/services/git.ts:596-603`
- **발견**: electron-git

```
await runGit(['restore', '--staged', '--', filePath], { cwd, allowNonZeroCodes: [1] });
...
await runGit(['restore', '--worktree', '--', filePath], { cwd, allowNonZeroCodes: [1] });
```
`git restore` exits 1 for genuine errors, including `error: pathspec '<path>' did not match any file(s) known to git` (verified). Treating exit 1 as success means: discardFile on an untracked file silently does nothing (git restore cannot remove untracked files — verified exit 1, file untouched) while the API reports `true`; and any unstageFile failure (stale path after a rename, repo state change) is reported to the renderer as success, so the UI's optimistic refresh shows the file still staged with no error surfaced.

**권장 수정**: Remove `allowNonZeroCodes: [1]` from both calls — unlike `git diff`, `git restore` does not use exit 1 as a benign signal. For discardFile, explicitly handle untracked files by deleting them from disk (with confirmation) or rejecting with a clear message.

**검증 단계 보정**: The finding is accurate with one caveat: discardFile is exposed via preload/api (src/api.ts:61) but no renderer code currently calls it (no mutation hook or component usage), so the discard-untracked-file silent no-op is latent API behavior, not reachable from today's UI. The unstageFile path IS wired into ChangedFilesPanel and its silent-failure scenario (stale path after external rename/repo change) is reachable.

### [MEDIUM/architecture] No serialization of mutating git commands per repo — concurrent operations race on index.lock and on read-then-apply hunk staging

- **위치**: `electron/services/git.ts:37-70, 591-614, 705-713`
- **발견**: electron-git

Every exported function spawns git immediately with no per-repo queue or mutex. Index-mutating commands (add/restore/apply/commit) take `.git/index.lock`; if the renderer fires two mutations concurrently (e.g. rapid clicks on stage buttons — each ChangedFilesPanel click triggers an independent TanStack mutation; nothing in the IPC layer serializes them), the second fails with `fatal: Unable to create '.../index.lock': File exists`, surfaced as a raw GitError. The hunk flow is also a non-atomic read-modify-write: repoStageHunk (electron/ipc.ts:228-237) calls getDiff, finds the hunk by header string, then `git apply` — if the index/worktree changed in between (another stage operation, external editor save), the patch applies to stale state or fails.

**권장 수정**: Add a simple per-repo promise queue (keyed by repo path) inside git.ts that serializes mutating commands (add, restore, apply, commit, checkout, rebase/merge ops); read-only commands can stay parallel. Optionally retry once on `index.lock` errors as a fallback.

### [MEDIUM/security] clone() passes the GitHub OAuth token on the git command line — visible to other local processes via ps

- **위치**: `electron/services/git.ts:89-93`
- **발견**: electron-git

```
const basic = Buffer.from(`x-access-token:${opts.authToken}`).toString('base64');
args.push('-c', `http.https://github.com/.extraheader=Authorization: Basic ${basic}`);
```
The intent (keep the token out of .git/config) is good, but `-c key=value` puts the trivially-decodable base64 token into git's argv, which is readable by any other process on the machine for the duration of the clone (`ps aux`/`/proc/<pid>/cmdline` — and clones of large repos run for minutes). Argv is also more likely to end up in crash reports and process-monitoring tooling than env vars.

**권장 수정**: Pass the config via environment instead of argv: set `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`, `GIT_CONFIG_VALUE_0=Authorization: Basic <b64>` in opts.env (supported since git 2.31). This keeps it out of both argv and the on-disk config.

### [MEDIUM/security] Revision arguments passed without --end-of-options; checkout without '--' can silently discard worktree changes

- **위치**: `electron/services/git.ts:490-496, 659-661`
- **발견**: electron-git

getDiff does `args.push(`${opts.base}..${opts.head}`)` with renderer-supplied strings — a value beginning with '-' (e.g. base `--output=/path/x`) is parsed by git as an option, an argument-injection primitive (git's `--output` writes arbitrary files). More practically, `checkout` is:
```
export async function checkout(cwd: string, branch: string): Promise<void> {
  await runGit(['checkout', branch], { cwd });
}
```
Without `--end-of-options`/`--`, if `branch` does not resolve to a ref but matches a file path, git silently checks the file out from the index, discarding uncommitted changes — verified: `git checkout "my file.txt"` exits 0, prints 'Updated 1 path from the index', and the dirty edit is gone. Today BranchMenu passes names from listBranches, but a branch deleted between listing and click (or any future caller) turns this into data loss with a success result.

**권장 수정**: Use `git switch --no-guess <branch>` (refuses pathspec fallback) or `git checkout --end-of-options <branch> --` so the argument can only be a ref. In getDiff, prepend `--end-of-options` before the rev-range (and keep the existing `--` before pathspecs); optionally validate base/head with `git check-ref-format` or a /^[^-]/ guard at the IPC boundary.

**검증 단계 보정**: The code-level claim is fully accurate, but reachability/severity is somewhat overstated. I traced the inputs: checkout's `branch` comes from BranchMenu iterating api.branches() (a server-listed branch list), and getDiff's base/head come from PullRequestDetailView as `origin/${detail.baseRef}` and `detail.headSha` (GitHub-API-provided ref names and SHAs, which git/GitHub ref-format rules forbid from starting with `-`). So the argument-injection path is largely theoretical with current callers, and the checkout data-loss requires a TOCTOU where a branch is deleted between listing and click AND its name coincidentally matches a worktree file path. This is therefore primarily a defense-in-depth / latent-footgun hardening issue rather than an actively exploitable vulnerability. Also a minor imprecision in the example: the constructed token is `${base}..${head}`, so `--output=/path/x` actually becomes `--output=/path/x..${head}`, writing to a path with the head value appended — argument injection still holds, just with that suffix constraint.

### [MEDIUM/performance] Unbounded memory: getDiff reads every untracked file fully and parseUnifiedDiff materializes the entire diff with no size cap

- **위치**: `electron/services/git.ts:509-524, 527-561`
- **발견**: electron-git

With includeUntracked, getDiff runs `git status --porcelain=v1 -z --untracked-files=all` and then, sequentially per file, `synthesizeUntrackedDiff` does `buf = fs.readFileSync(abs)` and builds a DiffLine object per line. In a repo with a large non-ignored untracked tree (fresh clone before .gitignore, build output, vendored deps) this reads every file into main-process memory and ships an enormous object graph over IPC in one diffAll response. Similarly, runGit buffers the whole `git diff` output as a single string with no `--stat` pre-check or byte cap, and parseUnifiedDiff allocates an object per line — a multi-hundred-MB diff (lockfiles, minified bundles, generated code) can balloon to GBs of JS objects and freeze or OOM the main process. spawn avoids exec's maxBuffer truncation, but there is no defensive limit at all.

**권장 수정**: Cap synthesized untracked diffs (skip files over ~1MB with a 'file too large' FileDiff stub, and cap the number of untracked files synthesized per call). Before parsing full diffs, run `git diff --numstat` (or check stdout byte length) and return a truncated/binary-style placeholder for files beyond a threshold instead of parsing them line-by-line.

### [MEDIUM/electron] In-flight git child processes are never tracked, killed, or awaited on app quit

- **위치**: `electron/services/git.ts:37-48`
- **발견**: sweep:leaks-cleanup

runGit spawns every git invocation with `const child = spawn('git', args, { cwd: opts.cwd, env: {...} })` and keeps no reference to running children: there is no AbortSignal, no registry of live processes, and no kill path anywhere in the main process (grep for kill/SIGTERM/AbortController across electron/ returns nothing). Meanwhile /Users/jiun/develop/differ/electron/main.ts:61-63 handles quit with `app.on('before-quit', () => { closeDatabase(); })` and lets the app exit immediately. If the user quits (Cmd+Q) while a long network operation is in flight — `clone()` (minutes for a large repo), `fetch`, `pull --rebase`, `push` — the git child is orphaned: it is re-parented to launchd and either keeps mutating the repository after the app is gone, or dies from SIGPIPE the next time it writes progress to its now-closed piped stderr. A git process killed mid-write can leave `.git/index.lock` behind (blocking every subsequent git operation in that repo) or a partially written clone destination. The partial-clone case is compounded by clone()'s own pre-check at git.ts:79-81 — `if (fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0) throw new Error('Destination already exists and is not empty')` — so an interrupted clone permanently blocks retrying to the same folder until the user manually deletes it in Finder.

**권장 수정**: Track live children in a module-level Set inside git.ts (add on spawn, remove on 'close'). Wire shutdown: in `before-quit`, if the set is non-empty, `event.preventDefault()`, send SIGTERM to all children (or await them with a short grace timeout), then close the database and quit. Simplest implementation: pass an AbortSignal to `spawn(..., { signal })` tied to a single app-shutdown AbortController. For clone specifically, on failure/abort remove the partially written destination directory (only if it was created by this clone) so retries are not blocked.

**검증 단계 보정**: The structural issue is real as described: runGit (electron/services/git.ts:37-48) keeps no reference to spawned children, nothing in electron/ kills or awaits them, and before-quit (electron/main.ts:61-63) only closes the database, so Cmd+Q mid-clone/fetch/pull/push orphans the git process. However, the claimed file-state consequences are overstated: git installs its own signal and atexit handlers (covering SIGPIPE/SIGTERM) that remove .git/index.lock and, for clone, delete the partially written destination directory, so a stuck lockfile or permanently retry-blocking partial clone is an edge case (e.g., hard kill), not the typical outcome. The typical outcome is the orphaned git silently running to completion after quit — mutating the repository or finishing a clone the app never records — plus the absence of any cancellation mechanism. Severity is better characterized as low-to-medium.

### [MEDIUM/performance] Every per-file diff request runs a repo-wide `git status --untracked-files=all` scan even for tracked files

- **위치**: `electron/services/git.ts:509-523`
- **발견**: sweep:perf-hotpaths

In `getDiff`: `if (opts.includeUntracked && !opts.staged) { const statusResult = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd }); ... }`. The renderer always passes `includeUntracked: !diffStaged` (AppStore.tsx:118), so every single-file diff load (every click on a changed file, every j/k navigation, every refetch after stage/unstage invalidation) spawns a second git process that walks the ENTIRE working tree, including recursing into all untracked directories — only to find out the requested file is tracked and discard the result. On large repos or repos with big untracked dirs this scan dominates the per-file diff latency, and on the diffAll path the loop then reads each untracked file with blocking `fs.readFileSync` (line 532) on the main process.

**권장 수정**: When `opts.filePath` is set, skip the repo-wide scan: run the untracked check scoped to the single pathspec (`git status --porcelain=v1 -z -- <filePath>`) and only synthesize the untracked diff when the unified diff returned nothing for that file. Replace `fs.readFileSync` with `fs.promises.readFile` so the main-process event loop is not blocked.

### [MEDIUM/bug] pollDeviceFlow discards the granted access token if the /user probe fails

- **위치**: `electron/services/githubOAuth.ts:144-152`
- **발견**: electron-github

`if (data.access_token) { activeFlow = null; try { const account = await addAccount(data.access_token); ... } catch (e) { return { status: 'error', ... }; } }`. The flow state is cleared *before* addAccount() runs. addAccount calls probeUser (GET /user); if that single request fails transiently (network blip, brief GitHub 5xx), the freshly issued access token is dropped on the floor, the renderer treats 'error' as terminal (GithubAuthDialog.tsx line 92-97), and the user must redo the entire device flow even though they already authorized. It also orphans an authorized OAuth grant on the user's GitHub account that the app never stored.

**권장 수정**: Retry probeUser a few times before giving up, or keep the access token in the flow state so a subsequent poll can retry addAccount instead of clearing activeFlow before the account is durably persisted.

**검증 단계 보정**: Only one minor overstatement: "orphans an authorized OAuth grant" — GitHub OAuth-app grants are per-app/per-user and are reused when the user re-authorizes, so no extra grant accumulates. What is actually orphaned is one valid, unstored access token. The core bug (token discarded on a single transient probe failure, terminal error in the UI, user must redo the full device flow) is accurate as written.

### [MEDIUM/security] GitHub tokens stored in plaintext SQLite when safeStorage is unavailable, with no user disclosure

- **위치**: `electron/services/githubService.ts:43-48`
- **발견**: electron-github

encryptToken() silently falls back to plaintext: `if (safeStorage.isEncryptionAvailable()) { return { encrypted: ..., plain: null }; } return { encrypted: null, plain: token };`. The plain token is persisted into the `token_plain` column of the github_accounts table (accountStore.ts upsertAccount). The default OAuth scopes requested in githubOAuth.ts line 16 include `repo`, i.e. full read/write to all private repos. On Linux without an unlocked keyring/wallet (a common configuration), safeStorage.isEncryptionAvailable() returns false, so a highly privileged credential ends up at rest in an unencrypted SQLite file with no warning to the user and no UI indication that it happened. The legacy `github_token_plain` settings key (line 31) has the same property.

**권장 수정**: At minimum, surface the downgrade: have addAccountFromProbe return whether the token was stored encrypted, and show a warning in the accounts UI when token_plain is used. Better: refuse to persist plaintext (keep the token in memory only for the session) or gate plaintext persistence behind an explicit user opt-in.

### [MEDIUM/bug] Accounts with undecryptable tokens silently vanish from the app

- **위치**: `electron/services/githubService.ts:50-59, 97-110`
- **발견**: electron-github

In ensureLoaded(): `const token = decryptStoredToken(row.token_encrypted, row.token_plain); if (!token) continue;`. decryptStoredToken returns null when safeStorage.decryptString throws (e.g. macOS Keychain entry reset, app signature change) or when isEncryptionAvailable() is false at load time even though the row holds only an encrypted token (line 51 falls through to `return plain`, which is null). The account row still exists in the DB, but listAccounts() only reads the in-memory `clients` map, so the account disappears from the UI with zero error, and every repo bound to it fails with the misleading 'GitHub account N is not signed in' from mustClient(). Because `loaded = true` is latched on line 99 before the loop, a transiently locked keyring at first IPC call permanently drops the account for the whole app session.

**권장 수정**: Track accounts whose token failed to decrypt as a distinct state (e.g. keep them in listAccounts() with a `needsReauth: true` flag) instead of skipping them, and log/surface the decryption failure. Consider retrying decryption on subsequent ensureLoaded calls rather than latching `loaded` on partial failure.

### [MEDIUM/bug] listCheckRuns is capped at 50 with no pagination, hiding check results

- **위치**: `electron/services/githubService.ts:389-406`
- **발견**: electron-github

`const res = await client.checks.listForRef({ owner, repo, ref, per_page: 50 });` fetches a single page. Monorepos commonly run well over 50 check runs per commit; everything past the first 50 is silently dropped. For a code review app this is dangerous: a failing check beyond the cutoff is simply invisible, and a reviewer may approve a PR believing all checks passed.

**권장 수정**: Use `client.paginate(client.checks.listForRef, { owner, repo, ref, per_page: 100 })` (octokit.paginate understands the `check_runs` envelope) so all check runs are returned.

### [MEDIUM/bug] submitReview omits commit_id, so review comments can anchor to the wrong lines if the PR head moved

- **위치**: `electron/services/githubService.ts:408-430`
- **발견**: electron-github

`await client.pulls.createReview({ owner, repo, pull_number: input.prNumber, event: input.event, body: input.body, comments: ... });` never passes `commit_id`, so GitHub anchors the line/side comments to the PR's *latest* head commit at submit time. The renderer (PullRequestDetailView.tsx line 384-394) builds these comments from local draft comments whose line numbers were computed against the headSha fetched earlier. If the author pushes between the user starting their review and clicking submit — easily hours for a careful local-first review — the comments either land on the wrong lines silently (content shifted) or the whole review fails with a 422 ('line must be part of the diff'). GithubSubmitReviewInput in shared/types.ts has no field to carry the sha, so callers cannot work around it.

**권장 수정**: Add `commitId` (the headSha the diff was reviewed against) to GithubSubmitReviewInput and pass it as `commit_id` to pulls.createReview, so comments anchor to the commit the reviewer actually saw and stale reviews fail loudly instead of mis-anchoring.

### [MEDIUM/bug] listAllRepos swallows all per-account errors, silently hiding repos on auth failure or rate limiting

- **위치**: `electron/services/githubService.ts:475-491`
- **발견**: electron-github

`} catch { // Skip this account silently — the UI surfaces auth issues via the account row itself. }`. The comment's claim is false: the account row in the UI is rendered purely from the DB (login/avatar/scopes) and there is no health/auth check anywhere, so nothing surfaces the failure. A revoked/expired token, a 403 primary or secondary rate limit (no throttling/retry plugin is configured on the Octokit instance, line 61-63, and the unbounded `paginate` of every repo for every account in parallel makes secondary rate limits plausible), or a network error all result in that account's repos simply missing from the browser with no explanation.

**권장 수정**: Return per-account results plus errors (e.g. `{ repos, errors: { accountId, message }[] }`) so the renderer can show 'couldn't load repos for @login'. Additionally install @octokit/plugin-throttling (or at least detect 401/403 responses) so auth and rate-limit failures are distinguishable from empty accounts.

### [MEDIUM/architecture] Hand-duplicated DifferApi interface must be kept in sync with preload by comment alone

- **위치**: `src/api.ts:35-141`
- **발견**: react-state

`// This must match the preload's exposed API exactly. We model it on the renderer side.` followed by a 100-line hand-written interface, ending in `export const api: DifferApi = (window as unknown as { differ: DifferApi }).differ;`. The preload already exports the real shape (`export type DifferApi = typeof api;`, electron/preload.ts:106), but nothing connects the two — there is no compile-time check, so adding/renaming a method in preload while forgetting api.ts (or vice versa) produces `api.someMethod is not a function` only at runtime. The risk is amplified because preload's `invoke<T = unknown>` is called without type arguments everywhere, so every preload method is `Promise<unknown>` and the renderer-side types are pure unchecked assertion at both ends. Also, if the preload script ever fails to load, `window.differ` is undefined and the very first call crashes with an opaque TypeError instead of a clear diagnostic.

**권장 수정**: Define the contract once: declare `DifferApi` in shared/types.ts (or `import type { DifferApi } from '../electron/preload'` — type-only imports cross the tsc/Vite boundary fine) and have BOTH preload (`const api: DifferApi = {...}`) and renderer reference it so drift is a compile error. Add a startup guard: `if (!window.differ) throw new Error('differ preload bridge missing')`.

### [MEDIUM/architecture] IPC contract is maintained by hand in three places (ipc.ts, preload.ts, api.ts) with no type linkage and existing drift

- **위치**: `src/api.ts:35-141`
- **발견**: architecture

src/api.ts:35 says "// This must match the preload's exposed API exactly. We model it on the renderer side." — the contract is duplicated by hand. Evidence it is already untyped/drifting: (1) preload.ts types several params as escape hatches: `cloneRepo: (req: unknown)` (preload.ts:12), `updateComment: (id: number, patch: unknown)` (:62), `setFileState: (..., status: string)` (:67) vs `FileReviewStatus` in api.ts:106, `ghPrList: (repoId, state?: string)` (:88) vs the union in api.ts:121. (2) preload.ts:106 exports `export type DifferApi = typeof api;` which is imported by nothing (grep confirms), so the two `DifferApi` types can diverge silently. (3) ipc.ts:92-94's `handle = <T,R>(channel: string, fn) => ipcMain.handle(channel, async (_e, ...args) => fn(...(args as T)))` casts args unchecked, and `openRepoAtPath` returns `Promise<unknown>` (ipc.ts:457) while api.ts:38 promises `Promise<Repository>`. Any change to a handler signature compiles cleanly in all three layers while breaking at runtime.

**권장 수정**: Make shared/types.ts the single source of truth: define a channel map like `interface IpcContract { 'repo:open': { args: [string]; result: Repository }; ... }` keyed by IpcChannels. Derive preload (`invoke<C extends keyof IpcContract>(c: C, ...args: IpcContract[C]['args'])`), the renderer DifferApi, and the ipc.ts `handle` helper from that one type so a signature change is a compile error in main, preload, and renderer simultaneously. At minimum, delete the duplicated interface in src/api.ts and import preload's `DifferApi` via a type-only import.

### [MEDIUM/react] No error boundary around lazy-loaded views

- **위치**: `src/App.tsx:26-34`
- **발견**: react-components

`<Suspense fallback={...}>` wraps seven `React.lazy` views but there is no error boundary anywhere in the tree (verified by grep across src/). Suspense only handles the pending state; a rejected dynamic import (corrupted build, file://-load hiccup) or any render-time throw in a view (e.g. the ResizableLayout children-count throw) propagates to the root and React 18 unmounts the entire app, leaving a permanent blank window with no recovery path.

**권장 수정**: Add an ErrorBoundary component (getDerivedStateFromError + a retry/reload UI) wrapping the `<main>` content, keyed by `view` so navigating to another view resets the boundary.

### [MEDIUM/react] Changed-file rows are clickable divs — completely keyboard inaccessible

- **위치**: `src/components/ChangedFilesPanel.tsx:117-126`
- **발견**: react-components

Each file row is `<div ... className={'... cursor-pointer ...'} onClick={() => void onClickFile(f)}>` with no `role`, no `tabIndex`, and no key handler. The core action of the app — selecting a changed file to view its diff — cannot be reached or activated with the keyboard, and is invisible to assistive tech. The inner stage/unstage `<button>`s are focusable, so Tab order skips straight to + / − controls of files the user cannot otherwise select.

**권장 수정**: Render the row label/area as a `<button type="button" className="w-full text-left ...">` (the stage/unstage controls already stopPropagation so they can sit beside it in the grid rather than nested), or add `role="button" tabIndex={0}` plus an Enter/Space keydown handler if the div must stay.

**검증 단계 보정**: Minor nuance only: once a file has been selected (by mouse) and fullscreen diff mode is entered, j/k/ArrowUp/ArrowDown can switch files — so file switching is not universally keyboard-impossible. But the panel rows themselves are unfocusable and invisible to assistive tech, and initial file selection is keyboard-impossible, so the finding stands as written.

### [MEDIUM/performance] Stage all / Unstage all issue one IPC round-trip + 3 query invalidations per file

- **위치**: `src/components/ChangedFilesPanel.tsx:56-77`
- **발견**: architecture

`stageAll` loops `await stageFileMutation.mutateAsync(f.path)` per file; every mutation's onSuccess runs `invalidateRepoQueries` (hooks.ts:337-348 → hooks.ts:67-73), which invalidates the whole repo scope, the diff scope, and the github scope. Staging N files therefore triggers N sequential `git add` spawns plus 3N invalidations, each refetching status/branches/commits/diff/PR queries that are actively observed, followed by one more full `refresh()` (ChangedFilesPanel.tsx:65). On a repo with 50 changed files this is dozens of redundant git status/diff executions and a visible UI stall.

**권장 수정**: Add a bulk channel (e.g. `repo:stageFiles` calling `git add -- <paths...>` once) or at minimum call `api.stageFile` directly in the loop (bypassing the mutation) and invalidate once at the end — the trailing `refresh()` already exists for that.

### [MEDIUM/architecture] deriveCloneFolderName duplicated verbatim in main process and renderer

- **위치**: `src/components/CloneFromUrlDialog.tsx:18-23`
- **발견**: architecture

CloneFromUrlDialog.tsx:18-23 `deriveFolderName` is a line-for-line copy of electron/ipc.ts:496-503 `deriveCloneFolderName` (trim trailing slashes, strip `.git`, take last `/`/`:` segment). The renderer uses it to show "Will clone into: {parentDir}/{folderName}" (CloneFromUrlDialog.tsx:156-158) and to prefill the folder field, while the main process re-derives it as the authoritative destination when `folderName` is empty (ipc.ts:125). If either copy changes (e.g. handling URLs with query strings or trailing `.GIT`), the previewed path and the actual clone destination silently disagree.

**권장 수정**: Move the function into shared/ (e.g. shared/cloneUrl.ts) — shared/ is already compiled into both tsconfig projects and aliased as @shared in the renderer — and import it in both ipc.ts and CloneFromUrlDialog.tsx.

**검증 단계 보정**: The duplication is real and the fix is correct, but the "previewed path and actual clone destination silently disagree" scenario is not reachable through the current dialog: submit() always sends a non-empty trimmed folderName (it errors otherwise), and ipc.ts:125 honors any provided name, so the main-process copy is only a fallback that this sole caller never triggers. The drift risk applies to the prefill/fallback paths and any future repoClone callers, not to the current preview-vs-destination flow.

### [MEDIUM/react] CodeMirror selection listener pushes a fresh state object to the parent on every selection tick, re-rendering the whole CodeBrowser view during drag

- **위치**: `src/components/CodeViewer.tsx:103-113`
- **발견**: sweep:perf-hotpaths

`EditorView.updateListener.of((u) => { if (!u.selectionSet) return; ... selectionRef.current?.({ startLine, endLine }); })` fires on every selection update — i.e. every mousemove during a drag-selection and every shift+arrow keystroke — and always passes a newly-allocated object, even when startLine/endLine are unchanged (e.g. selecting within one line). CodeBrowserView stores it directly in React state (`onSelectionChange={setSelection}`, CodeBrowserView.tsx:71), so each tick re-renders the entire view: the FileTree (which mounts a query observer per node) and CodeViewer itself, whose inline `basicSetup` prop object then triggers a CodeMirror reconfiguration per render. Dragging a selection over a large file produces a visible re-render/reconfigure storm at pointer-move frequency.

**권장 수정**: Track the previous range in a ref inside the update listener and only invoke `selectionRef.current` when `startLine` or `endLine` actually changed; alternatively keep the live selection in a ref and only commit it to React state when the user opens the comment composer.

**검증 단계 보정**: Minor: the listener fires on every selection-changing pointer move (CodeMirror skips dispatch when the new selection equals the current one), not literally every mousemove; identical-line-range updates still pass through unguarded with newly allocated objects, so the re-render/reconfigure storm described is accurate.

### [MEDIUM/bug] Cmd+Enter in comment textarea bypasses isPending — duplicate review comments

- **위치**: `src/components/CommentComposer.tsx:86-88`
- **발견**: react-components

`onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save(); }}` — the Save button is `disabled={busy ...}` (line 108) but `save()` never checks `createComment.isPending`. While the first `createComment.mutateAsync` is awaiting IPC + SQLite write, a repeated Cmd+Enter fires `save()` again with the same body, inserting duplicate comments into the review session. Since the dialog only closes via `onClose()` after the first call resolves, the window for the double-fire is the full mutation round-trip.

**권장 수정**: Early-return in `save()` when `createComment.isPending` is true (`if (busy) return;`).

### [MEDIUM/bug] Cmd+Enter in commit textarea bypasses the busy guard — concurrent duplicate commits

- **위치**: `src/components/CommitBar.tsx:63-65`
- **발견**: react-components

`onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void commit(); }}` — both buttons are `disabled={busy}` (busy = commitMutation.isPending || amendMutation.isPending), but the keyboard path never checks `busy`, and `commit()` itself only validates message/stagedCount, which are still satisfied while the first commit is in flight (message is cleared only after `mutateAsync` resolves). Holding Cmd+Enter (key repeat) or pressing it twice fires multiple concurrent `api.commit` IPC calls against the same repo — producing git `index.lock` errors or, depending on timing, two commits.

**권장 수정**: Guard the handler: `if (busy) return;` before calling `commit()` (and the same for amend if a shortcut is added later), or check `commitMutation.isPending` at the top of `commit()`.

**검증 단계 보정**: Finding is essentially correct. Minor refinement: the realistic failure mode is git index.lock errors (and error toasts) from concurrent `git commit` processes; an actual duplicate second commit is unlikely because a successfully completed first commit empties the index, making the follow-up commit fail with "nothing to commit". The recommended fix (check busy/isPending in the keydown handler or at the top of commit()) is appropriate.

### [MEDIUM/performance] SplitHunk rebuilds row pairing on every render and its comment map memo is always invalidated

- **위치**: `src/components/DiffViewer.tsx:433-464`
- **발견**: react-views-b

In SplitHunk the O(n) del/add pairing loop (`const rows: Row[] = []; let i = 0; while (i < hunk.lines.length) {...}`, lines 434-463) runs unconditionally on every render — it is not memoized even though `lineCommentMap` directly below it is (line 464). Worse, that memo is useless: its dependency `comments` is the `fileComments` array recreated by `state.comments.filter(...)` on every DiffViewer render (line 59), so `useMemo(() => commentsByLine(comments), [comments])` (also line 356 in UnifiedHunk) recomputes every time anyway. Combined with the re-render storm from the unselected store subscription, every keystroke in the file filter re-pairs and re-maps every hunk of the open diff.

**권장 수정**: Wrap the rows computation in `useMemo(() => buildRows(hunk.lines), [hunk.lines])`, and memoize `fileComments` in the parent so the `[comments]` dependency of `commentsByLine` is referentially stable between renders.

### [MEDIUM/bug] Comments on the old side of context lines silently disappear in unified mode

- **위치**: `src/components/DiffViewer.tsx:379-391`
- **발견**: react-views-b

UnifiedRow resolves a single side per row: `line.kind === 'del' ? 'old' : line.kind === 'add' ? 'new' : line.newLineNumber != null ? 'new' : ...` — for context lines it always prefers 'new', and the comment lookup checks only `lineKey(side, lineNumber)` for that one side (lines 390-391). But in split mode, SideCell renders context lines in the LEFT column with `side="old"` and `lineNumber = line.oldLineNumber` (lines 525-527), and double-clicking there creates a comment with `diff_side: 'old'` anchored to the old line number. Switching back to unified mode, that comment's map key is `old:<oldLineNo>` while the row only looks up `new:<newLineNo>`, so the comment is not rendered at all. The user sees their inline comment vanish when toggling Unified/Split (it still exists in the Comments tab), which looks like data loss.

**권장 수정**: In UnifiedRow, look up both sides for context lines: compute keys for `('old', line.oldLineNumber)` and `('new', line.newLineNumber)` when both numbers are present and concatenate the matching comment arrays, instead of picking a single side.

### [MEDIUM/react] InlineCommentRow instantiates the full useApp hook (4 query observers) per comment row

- **위치**: `src/components/DiffViewer.tsx:556-558`
- **발견**: react-views-b

`function InlineCommentRow({ comment, indent }) { const { state, toast, logActivity } = useApp(); ... }` — useApp is a heavyweight hook: it subscribes to the entire zustand store (no selector) and mounts useRepoStatusQuery, useCommentsQuery, useFileStatesQuery, and useFileDiffQuery observers, then builds two useMemo objects. InlineCommentRow is rendered once per inline comment in the diff (lines 415-417, 549-551, 322-324), so a file with 30 comments creates 120 extra React Query observers and 30 full-store subscriptions, all of which re-render on any store mutation (toast, activity, filter typing). The component only needs `state.session?.id`, `toast`, and `logActivity`.

**권장 수정**: Read only what is needed: `const sessionId = useAppStore((s) => s.session?.id ?? null)` plus `showToast`/`pushActivity` via store selectors (or pass sessionId/handlers down as props from DiffViewer), instead of calling useApp per row.

**검증 단계 보정**: Negligible correction only: useApp builds three useMemo objects (diffsByFile, state, and the returned Ctx), not two. Also note the parent DiffViewer itself uses useApp un-memoized, so fixing InlineCommentRow alone won't stop cascade re-renders from the parent — but the per-row query observers and store subscriptions are real, independent overhead exactly as described.

### [MEDIUM/bug] Diff load errors render as a permanent "Loading diff…" state

- **위치**: `src/components/DiffViewer.tsx:38-45`
- **발견**: react-views-b

`const diffEntry = state.diffsByFile[selected]; if (diffEntry === undefined) { return ... Loading diff… }` — `diffsByFile` is built in AppStore.tsx (line 299-302) from `selectedDiffQuery.data` only; the query's error state is never surfaced. If `api.fileDiff` fails (git error, index lock, odd path), `data` stays undefined forever, so DiffViewer shows "Loading diff…" indefinitely with no retry affordance. A toast may appear once if the failure came through `loadDiff`'s catch, but the background `useFileDiffQuery` in useApp fetches independently and its errors are completely swallowed. There is no error branch anywhere in this component.

**권장 수정**: Expose the diff query's error (e.g. extend diffsByFile entries to `{ data, error, isLoading }` or read `selectedDiffQuery.isError` through the context) and render an error state with a Retry button in DiffViewer instead of the unconditional loading message.

**검증 단계 보정**: Substantially correct as written. Two small nuances: loadDiff's fetchQuery and useFileDiffQuery share the same TanStack Query cache entry (same key), so they are not fully independent fetches — but the hook-initiated fetch errors are still never surfaced; and the 30s useAutoFetch loop invalidates diff queries on successful background git fetch, so transient errors can self-recover, while persistent errors still render as an indefinite "Loading diff…" with no error UI or retry.

### [MEDIUM/bug] SQLite UTC timestamps are parsed as local time in the renderer — comment times display shifted by the UTC offset

- **위치**: `src/components/DiffViewer.tsx:600-607`
- **발견**: sweep:perf-hotpaths

`{new Date(comment.created_at).toLocaleString(undefined, {...})}` — `created_at` comes from SQLite's `datetime('now')` default (electron/services/db.ts:74), which produces a UTC wall-clock string in the form `2026-06-11 05:12:33` with no timezone designator. Chrome parses that non-ISO format as LOCAL time, so the rendered timestamp is wrong by the user's UTC offset: a comment created right now in Seoul (UTC+9) displays as 9 hours in the past. The same misparse occurs in PullRequestDetailView.tsx lines 321 and 333.

**권장 수정**: Normalize before parsing: treat the stored value as UTC, e.g. `new Date(comment.created_at.replace(' ', 'T') + 'Z')` in a single shared `parseDbDate` util, or store ISO-8601 UTC strings (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`) in the schema.

**검증 단계 보정**: The finding is correct in substance; only the path of the secondary file is wrong: PullRequestDetailView.tsx is at /Users/jiun/develop/differ/src/views/PullRequestDetailView.tsx, not src/components/. Lines 321 and 333 there do misparse local SQLite UTC timestamps exactly as described.

### [MEDIUM/performance] FileTree creates a React Query observer per node (including every file) and re-renders the whole tree on selection

- **위치**: `src/components/FileTree.tsx:31-36`
- **발견**: react-components

`const childrenQuery = useTreeQuery(repoId, entry.path, entry.kind === 'dir' && open);` runs in every TreeNode, including plain file nodes where the query is permanently disabled. Each call still instantiates a QueryObserver with a unique `repo.tree(repoId, filePath)` key that subscribes to the query cache, so a directory with thousands of entries creates thousands of observers that are all notified on every cache update (e.g. the 30s auto-fetch invalidations). Additionally TreeNode is not memoized and `selectedPath` is drilled into every node, so selecting a file re-renders every mounted node in the tree, not just the two affected rows.

**권장 수정**: Only call useTreeQuery for directory nodes (split TreeNode into DirNode — which holds the hook — and a hook-free FileRow), wrap the node components in React.memo, and consider flattening visible nodes into a virtualized list for large repositories.

**검증 단계 보정**: Substantially correct, with one overstated phrase: observers are not notified on literally "every cache update" — a QueryObserver is only notified when its own query's state changes. However, the concrete scenario cited is accurate: the 30s auto-fetch (useAutoFetch -> silentFetch -> invalidateRepoQueries) invalidates queryKeys.repo.scope(repoId), which is a key prefix of every tree query, so every mounted TreeNode's observer is matched and notified each cycle. Additionally, TanStack Query 5's tracked-properties optimization means the disabled file-node observers (which read only data/isFetching/error) usually do not re-render on invalidation — the per-node cost is observer/cache-entry creation and notification bookkeeping, while open directory nodes do refetch and re-render. The re-render-on-selection claim is fully correct, though the recommended React.memo alone would not fix it because selectedPath changes for every node; the prop drilling must also be removed (e.g., derive isSelected per node or read selection from a store selector).

### [MEDIUM/bug] Repo switching has no in-flight guard or ordering: slower openRepo IPC response wins over the last click

- **위치**: `src/components/ProjectSidebar.tsx:60-92`
- **발견**: sweep:async-races

switchTo() awaits IPC before committing: `const r = await api.openRepo(repo.path); dispatch({ type: 'setRepo', repo: r }); ... await refresh();`. openRepoAtPath in the main process runs four sequential git invocations (isGitRepo, top-level, remote URL, default branch), so it can take hundreds of ms. The only guard, `if (state.repo?.id === repo.id) return;`, compares against render-time state, so clicking repo A then repo B fires two concurrent openRepo calls and two concurrent refresh() chains. Whichever IPC response resolves LAST wins `setRepo` — click A then B, and if A's response arrives after B's, the app ends up on repo A even though the user last selected B, with B's session/queries half-initialized underneath (this also feeds the refresh() session race). The same unguarded pattern exists in RepositoryPicker.tsx open()/pick() (lines 30-54).

**권장 수정**: Keep a monotonically increasing switch token (ref): capture it before `api.openRepo`, and after the await bail out if a newer switch started (`if (token !== latestToken.current) return;`). Alternatively disable repo buttons while a switch is pending, mirroring PullRequestsView's `isPending` row-disable pattern.

**검증 단계 보정**: Issue is correct as stated; only trivial correction: RepositoryPicker.tsx lives at /Users/jiun/develop/differ/src/views/RepositoryPicker.tsx (the finding's primary file path for ProjectSidebar.tsx and all line ranges are accurate).

### [MEDIUM/performance] Sizes persisted to localStorage synchronously on every pointermove during drag

- **위치**: `src/components/ResizableLayout.tsx:47-53`
- **발견**: react-components

`useEffect(() => { localStorage.setItem(fullKey, JSON.stringify(sizes)); }, [sizes, fullKey])` runs after every `setSizes(next)` call in `onMove` (line 79), which fires once per coalesced pointermove (~60-120/s while dragging). localStorage.setItem is a synchronous storage write executed on every frame of the drag, on top of the grid-template-columns relayout the drag already causes. This adds main-thread jank to every divider drag for zero benefit — only the final size matters.

**권장 수정**: Persist only on drag end: write to localStorage in `onUp` (or debounce the effect). Keep `setSizes` per-move for live resizing, but move the storage write out of the render-coupled effect.

### [MEDIUM/bug] Drag listeners: no pointer capture, no pointercancel handling, no cleanup on unmount

- **위치**: `src/components/ResizableLayout.tsx:55-91`
- **발견**: react-components

`startDrag` attaches `window.addEventListener('pointermove'/'pointerup', ...)` and sets `document.body.style.cursor/userSelect`, but (1) never calls `setPointerCapture`, so moves stop being delivered when the cursor leaves the window mid-drag; (2) never listens for `pointercancel` — if the pointer is cancelled (touch/pen input, OS gesture interruption) `pointerup` never fires, leaving the move listener attached and the body stuck with `cursor: col-resize; user-select: none` until the next unrelated pointerup; (3) there is no unmount cleanup, so switching views mid-drag (e.g. a toast/action changes `view`) leaves window listeners calling `setSizes` on an unmounted component and the body styles applied.

**권장 수정**: Call `(e.target as Element).setPointerCapture(e.pointerId)` in startDrag and listen on the handle element; register the same teardown for `pointercancel` and `lostpointercapture`; track active cleanup in a ref and run it from a `useEffect(() => () => cleanupRef.current?.(), [])` unmount handler.

**검증 단계 보정**: Corrected issue: ResizableLayout's startDrag (src/components/ResizableLayout.tsx:55-91) registers window pointermove/pointerup listeners and body cursor/user-select styles whose only teardown is the pointerup handler. There is no pointercancel (or lostpointercapture) handler and the resize handle lacks touch-action:none, so on touch/pen input a cancelled drag (gesture takeover) never fires pointerup, leaving the pointermove listener attached and body stuck with cursor:col-resize/user-select:none until a later pointerup. Severity: low (touch/pen-only edge case). The other two claimed consequences do not hold: Chromium/Electron implicitly captures the mouse during button-held drags, so window-level moves continue outside the window without setPointerCapture; and unmount-mid-drag self-heals because the window-bound pointerup still runs teardown, with React 18 ignoring setState on unmounted components. Fix: also register the teardown for pointercancel (and optionally add touch-action:none to the handle); the setPointerCapture/unmount-effect parts of the recommendation are optional hardening, not bug fixes.

### [MEDIUM/performance] useApp() subscribes consumers to the entire zustand store and instantiates 4 query observers per call site

- **위치**: `src/components/TopBar.tsx:13`
- **발견**: react-components

TopBar (line 13), ProjectSidebar (line 25), ChangedFilesPanel (line 17), CommitBar (line 6), BranchMenu (line 8), CommentComposer (line 31) and CloneFromUrlDialog (line 33) all call `useApp()`, which internally does `const clientState = useAppStore();` with no selector (src/state/AppStore.tsx:106) plus mounts useRepoStatusQuery/useCommentsQuery/useFileStatesQuery/useFileDiffQuery. Consequence in these components: every keystroke in the file-filter input (`setFileFilter`) re-renders TopBar, the sidebar, CommitBar and any open dialog; every toast show/clear re-renders all of them; and the selected file's diff query carries one observer per useApp consumer, so a single diff invalidation notifies ~7 subscribers. Components like BranchMenu and CommentComposer only need `toast`/`refresh`/one field but pay for the whole state.

**권장 수정**: Have leaf components subscribe via selectors (`useAppStore((s) => s.repo)`, `appSelectors.actions`) and call the stable action helpers directly instead of `useApp()`; reserve the heavyweight `useApp()` (or a split `useAppActions()` that mounts no queries) for the few view-level components that genuinely need the composite state.

### [MEDIUM/performance] TanStack structural sharing deep-walks the entire multi-megabyte diff object graph on every refetch

- **위치**: `src/query/hooks.ts:148-200`
- **발견**: sweep:perf-hotpaths

`useFileDiffQuery` and `useAllDiffQuery` store `FileDiff`/`FileDiff[]` results with TanStack Query's default `structuralSharing: true`. On every refetch (each stage/unstage invalidation, every 30s auto-fetch invalidation) TanStack runs `replaceEqualDeep` over the old and new results to preserve references — for a 10k+ line diff that is a synchronous deep comparison over hundreds of thousands of nodes (one object per diff line) on the renderer main thread, on top of the IPC deserialization cost. The sharing buys little here because diff consumers re-render wholesale anyway (DiffViewer/PrFileDiff are not memoized per row).

**권장 수정**: Set `structuralSharing: false` on the diff queries (or replace it with a cheap custom comparator that compares a content hash / file path + hunk count) so refetches swap the reference in O(1) instead of deep-walking the whole diff.

**검증 단계 보정**: The mechanism is real: with TanStack Query 5 defaults, every diff refetch (stage/unstage/commit mutations and the 30s/focus silentFetch invalidations) runs replaceEqualDeep synchronously over the full FileDiff/FileDiff[] graph (one DiffLine object per line) on the renderer thread. But the claim that "sharing buys little" is wrong — useApp memoizes diffsByFile and the whole AppState on selectedDiffQuery.data identity, and PullRequestDetailView keys an effect and selectedDiff memo on diffs identity, so structural sharing is what prevents whole-tree re-renders (and full 10k-row diff DOM re-renders) on no-change polls. Therefore setting structuralSharing:false would be a performance regression, not a fix. The valid remediation is only the second variant: a custom structuralSharing function that cheaply compares (e.g., a content hash computed in the main process, or per-file path+hunk signature) and returns the previous reference when unchanged. Also, the component "PrFileDiff" does not exist; PR diffs render via PullRequestDetailView + DiffViewer.

### [MEDIUM/architecture] Two coexisting write APIs (legacy dispatch facade vs direct zustand setters) with divergent query-cache side effects

- **위치**: `src/state/AppStore.tsx:101-103, 212-297`
- **발견**: react-state

AppStore.tsx keeps the old context shape alive: `AppProvider` is a no-op passthrough (`return <>{children}</>;`, lines 101-103) and `dispatch` (212-297) is a reducer-style switch that just forwards to zustand setters — but with extra side effects: `case 'setSession'` also writes `queryClient.setQueryData(queryKeys.session.detail(...))` (line 224). Meanwhile other components bypass dispatch and call the store directly (PullRequestsView.tsx:28 `useAppStore((state) => state.setSession)`, also AppStore.tsx:139 in refresh does both manually). So whether the `session.detail` cache entry is populated depends on WHICH API a component happened to use — a classic two-sources-of-truth split. That cache entry has no queryFn (only ever setQueryData), is invalidated by `invalidateReviewQueries` but can never refetch, and its only reader `readCurrentSession` (hooks.ts:508-511) is dead code, as is `readStatusFiles` (hooks.ts:504-506).

**권장 수정**: Delete the facade: remove AppProvider, the Action union, and dispatch; migrate call sites to direct zustand setters + query hooks. If the session must live in the query cache, make `setSession` in the store the single place that syncs it (or drop the `session.detail` cache entry and the dead `readCurrentSession`/`readStatusFiles` helpers entirely).

### [MEDIUM/architecture] Vestigial reducer shim over zustand: dispatch() actions that write to the query cache, and a silent no-op for `setStatus: null` that callers rely on

- **위치**: `src/state/AppStore.tsx:212-297`
- **발견**: architecture

After the zustand/TanStack migration (commit a7ebf5f), the old reducer API was kept as a shim: `dispatch({type: 'setStatus' ...})` etc. just call zustand setters or `queryClient.setQueryData`. Two concrete problems: (1) `case 'setStatus': { if (repo && action.status) queryClient.setQueryData(...) }` (AppStore.tsx:226-229) silently does NOTHING when `action.status` is null, yet ProjectSidebar.tsx:66 and :83 dispatch `{ type: 'setStatus', status: null }` intending to clear stale status when switching repos — the intent is dropped on the floor (it only works by accident because the status query is keyed per repoId). (2) Actions 'setFileDiff'/'setComments'/'setFileStates' (AppStore.tsx:246-269) write directly into the query cache, creating a second, hidden write-path beside the query hooks. The codebase now has two competing state-access styles: new views use `useAppStore((s)=>...)` selectors, old ones use `useApp().dispatch` — confusing for every new feature. `AppProvider` (AppStore.tsx:101-103) is a no-op `<>{children}</>` kept only so App.tsx can wrap with it.

**권장 수정**: Delete the Action union, dispatch(), and AppProvider. Replace dispatch call-sites with direct zustand setters (they already exist in store.ts) and replace cache-writing actions with queryClient.invalidateQueries/setQueryData at the call site. Where callers passed `setStatus: null`, use `queryClient.removeQueries({queryKey: queryKeys.repo.status(repoId)})` explicitly.

**검증 단계 보정**: Two minor refinements, neither refuting: (a) ProjectSidebar callers do not functionally "rely on" the setStatus:null no-op — they intend a clear that is silently dropped; correctness is preserved only by per-repoId query keying (with a possible brief stale flash of the new repo's previously cached status until refresh() refetches). (b) The cache-writing actions 'setFileDiff'/'setComments'/'setFileStates' are never dispatched anywhere in src/ — the second write-path is dead code rather than an actively used path, which makes the cleanup even safer.

### [MEDIUM/performance] 30-second auto-fetch invalidates every repo, diff and GitHub query, refetching the full PR diff and GitHub REST endpoints even when fetch brought nothing

- **위치**: `src/state/AppStore.tsx:200-210`
- **발견**: sweep:perf-hotpaths

`silentFetch` runs `await api.fetch(repo.id); ... await invalidateRepoQueries(queryClient, repo.id);` and useAutoFetch triggers it every `INTERVAL_MS = 30_000` plus on window focus (useAutoFetch.ts:9, 33-43). `invalidateRepoQueries` (hooks.ts:67-73) marks ALL of `repo.scope`, `diff.repo` and `github.repo` stale, so every active observer refetches immediately: on the PR detail view that is the entire `diffAll` blob (main-process re-diff + full re-serialization) plus the PR-detail and check-runs GitHub REST calls; on the local view it is status, branches, tree, file content and the selected diff. This happens unconditionally even when `git fetch` downloaded nothing, turning an idle app into a periodic CPU/IPC/GitHub-rate-limit drain. (Round 1 flagged over-invalidation on the staging call sites; this is the periodic background trigger, which has a much larger blast radius.)

**권장 수정**: After `api.fetch`, detect whether anything changed (compare `git rev-parse` of remote refs before/after, or parse fetch output) and only invalidate `repo.status`/`repo.branches`/`repo.commits` when remote tips moved; never blanket-invalidate `diff.repo` and `github.repo` on a timer — let those refresh on explicit user action or targeted events.

### [MEDIUM/react] Dark theme applied only after the JS bundle executes — flash of light theme on every startup

- **위치**: `src/utils/theme.ts:40-58`
- **발견**: react-state

`let currentMode: ThemeMode = readStoredMode(); ... export function initTheme() { applyDarkClass(currentIsDark); ... }` — the `dark` class and `colorScheme` are set only when `initTheme()` runs in main.tsx:9, i.e. after Vite's module graph loads and executes. src/index.html contains no inline theme script and `<body class="bg-bg text-text-primary">` resolves to light values until `document.documentElement.classList` gets `dark`. A dark-mode user therefore sees a white flash on every app launch (and on every dev-server reload, where module loading is slower). The matchMedia 'change' listener added in initTheme is also never removed, which is fine for a singleton but means a second initTheme call (e.g. future refactor) would stack listeners.

**권장 수정**: Add a tiny inline `<script>` in src/index.html `<head>` that reads `localStorage['differ.theme']`, falls back to `matchMedia('(prefers-color-scheme: dark)')`, and sets `document.documentElement.classList.toggle('dark', ...)` + `style.colorScheme` before first paint. Keep theme.ts as the runtime store; guard initTheme against double registration.

**검증 단계 보정**: Minor nuance only: the flash is not guaranteed visible on literally every production launch — Electron loads the bundle from disk and Chromium may execute the deferred module before first paint, making the flash brief or occasionally imperceptible; it is most pronounced (essentially guaranteed) in dev-server reloads. Also, because BrowserWindow sets backgroundColor '#0f1115' (dark), the startup sequence for a dark-mode user is dark window -> light first paint -> dark, i.e. a light-theme flicker rather than a white-from-the-start screen. Neither nuance changes the validity of the finding or its recommended fix.

### [MEDIUM/bug] useAutoFetch cooldown ref persists across repo switches, skipping the documented initial fetch for a newly opened repo

- **위치**: `src/utils/useAutoFetch.ts:16-33`
- **발견**: react-state

`const lastTriggeredAt = useRef(0);` lives outside the effect, and `trigger` bails with `if (now - lastTriggeredAt.current < FOCUS_COOLDOWN_MS) return;`. The effect re-runs on `repoId` change, but the ref is not reset — so if the previous repo was background-fetched within the last 15s, the new repo's initial fetch (the `setTimeout(trigger, INITIAL_DELAY_MS)` at line 33) is silently skipped, violating the stated policy "Fire once shortly after a repo is opened" (line 5). The new repo then waits up to 30s for the interval tick. Related: a trigger started for repo A that resolves after a switch to repo B stamps `setLastFetchedAt(Date.now())` (AppStore.tsx:205) into B's UI ("last fetched" badge in TopBar) even though B was never fetched. Also, this hook consumes the monolithic `useApp()` (line 14) just for `repo.id` and `silentFetch`, which is what drags App.tsx's root component into re-rendering on every store change.

**권장 수정**: Reset the refs when the repo changes — e.g. at the top of the effect: `lastTriggeredAt.current = 0; inFlight.current = false;` (cleanup-safe since the effect is keyed on repoId), and capture repoId in silentFetch so a late resolution for an old repo is discarded. Replace `useApp()` with `useAppStore(s => s.repo?.id ?? null)` plus a standalone silentFetch.

### [MEDIUM/bug] Sync screen cannot push a branch with no upstream; the setUpstream fallback is dead code

- **위치**: `src/views/HistoryView.tsx:525-544`
- **발견**: react-views-a

The Push button is `disabled={!!busy || ahead === 0}` (line 527), and its handler contains a fallback: `if ((e as Error).message.includes('no upstream')) { await api.push(repo.id, { setUpstream: true }); }` (lines 533-535). But `ahead` comes from porcelain-v2's `# branch.ab` header (electron/services/git.ts:204-209), which git only emits when an upstream IS configured — with no upstream, `ahead` stays 0 (git.ts:177). So for a brand-new local branch with unpushed commits, the Push button is permanently disabled with the checklist saying 'Nothing new to push', and the carefully written no-upstream retry can never execute from this screen. The fallback also relies on substring-matching git's English error text (safe today only because runGit forces LC_ALL=C, git.ts:45).

**권장 수정**: Enable Push when there is no upstream but the branch has local commits, e.g. `disabled={!!busy || (state.status?.upstream != null && ahead === 0)}`, and label it 'Publish branch' in that case, calling `api.push(repo.id, { setUpstream: true })` directly instead of relying on error-message sniffing. Longer term, have the main process expose a structured 'no-upstream' error code rather than matching message text.

**검증 단계 보정**: The finding is accurate as scoped. Minor caveat worth adding: the TopBar already offers a 'Publish' button (src/components/TopBar.tsx:345) that handles the no-upstream case via setUpstream, so the user is not fully blocked in the app — but on the Sync screen itself the Push button is permanently disabled for an unpublished branch and its no-upstream fallback is unreachable.

### [MEDIUM/bug] Merge conflict resolver is a non-functional placeholder presented as a working feature

- **위치**: `src/views/HistoryView.tsx:276-427`
- **발견**: react-views-a

ResolveScreen looks fully functional but its core is fake: 'Use incoming' and 'Stage resolution' (lines 277-282), 'Reopen block' and 'Accept and next' (lines 376-381) all just call `toast('info', '... not yet wired')`. MergePane renders hardcoded placeholder rows — `<span>{71 + n}</span><span>// preview placeholder</span>` over `[1,2,3,4,5].map` (lines 412-422) — regardless of which conflicted file is selected, and the footer asserts 'Autosaved resolution draft locally' (line 374), which is untrue. A user mid-rebase with real conflicts (exactly when this screen appears, since the operation banner at lines 286-320 IS real) sees plausible-looking three-way panes with line numbers and may believe their resolution is being drafted/saved. Only the abort/continue controls actually work.

**권장 수정**: Until the resolver is implemented, replace the three-way panes with an explicit 'Conflict editing not yet supported — resolve in your editor, then stage the file and Continue' notice, remove or disable the stub buttons, and delete the false 'Autosaved resolution draft locally' caption. The conflict queue + continue/abort controls can stay as they are functional.

### [MEDIUM/architecture] Oversized multi-screen components: HistoryView bundles 3 unrelated screens; SubmitReviewDialog and SyncButton belong in their own modules

- **위치**: `src/views/HistoryView.tsx:1-627`
- **발견**: architecture

Several components exceed ~450 lines because they bundle independent units: (1) HistoryView.tsx (627 lines) contains GraphScreen, ResolveScreen, and SyncScreen — three screens sharing nothing but a tab bar, each with its own data fetching (useCommitsQuery), git mutations (`runOp` rebase/merge handlers, lines 240-265), and presentation. (2) PullRequestDetailView.tsx (488 lines) embeds SubmitReviewDialog (lines 342-488), a self-contained dialog with its own mutation flow (submitReview + resolve loop, lines 380-406). (3) TopBar.tsx (458 lines) embeds SyncButton plus the deriveSyncMode/friendlyGitError business logic (lines 251-392). (4) DiffViewer.tsx (620 lines) mixes the split-pairing algorithm (SplitHunk row builder, lines 433-463) and comment-indexing (commentsByLine, lines 329-343) with presentation. Concrete extractions: src/views/history/{GraphScreen,ResolveScreen,SyncScreen}.tsx; src/components/pr/SubmitReviewDialog.tsx; src/components/SyncButton.tsx + src/utils/gitActions.ts; src/utils/diff.ts for pairSplitRows/commentsByLine.

**권장 수정**: Apply the four extractions above. Each is a pure file move with no behavior change (the inner components already take no shared closure state beyond useApp), and HistoryView/PullRequestDetailView/TopBar each drop to ~150-250 lines of layout.

### [MEDIUM/performance] j/k fullscreen file navigation fires ~6 IPC round trips and a DB write per keypress with no key-repeat coalescing

- **위치**: `src/views/LocalChangesView.tsx:36-55`
- **발견**: sweep:perf-hotpaths

The fullscreen keydown handler runs `dispatch({ type: 'setSelectedFile', ... }); dispatch({ type: 'setDiffStaged', ... }); void loadDiff(next.path);` per keypress. `loadDiff` (AppStore.tsx:161-186) then performs: fetchQuery(file diff) [IPC], fetchQuery(fileStates) — which was invalidated by the previous keypress so it refetches [IPC], `api.setFileState(..., 'viewed')` [IPC + SQLite write], and `invalidateReviewQueries` which refetches comments and fileStates again [2 IPC]. Holding j/k (OS key auto-repeat ~30Hz) queues dozens of these chains, hammers the main process, and permanently marks every file merely skimmed past as 'viewed' in the database.

**권장 수정**: On navigation keypress only update `selectedFile`/`diffStaged` (the always-mounted useFileDiffQuery already fetches the diff for the new key); debounce the 'mark viewed' side effect behind a dwell timer (e.g. 500ms on the same file) and drop the redundant fetchQuery(fileStates) pre-read by using the cached query data.

**검증 단계 보정**: Substantially correct; minor count fix: ~5 IPC round trips per keypress on an unviewed file, not ~6 — loadDiff's fetchQuery(fileDiff) shares its fetch with the always-mounted useFileDiffQuery observer (same query key), and the session.detail invalidation triggers no refetch (no active observer). Also, once every file has been marked 'viewed' (after one wrap-around pass), the setFileState write and invalidation refetches stop, so sustained key-hold churn drops to the diff fetch + fileStates pre-read. The core issue stands: no key-repeat coalescing, an uncoalesced multi-IPC chain plus a SQLite write per keypress on first pass, and files merely skimmed past are permanently marked 'viewed'.

### [MEDIUM/bug] Submit review flow is non-atomic: retry can double-post the GitHub review, and comment resolution may not refresh

- **위치**: `src/views/PullRequestDetailView.tsx:380-406`
- **발견**: react-views-a

In SubmitReviewDialog.submit(): `await api.ghPrSubmitReview(...); for (const c of selectedLineComments) { await api.updateComment(c.id, { status: 'resolved' }); } await loadComments();` wrapped in one try/catch. Two problems. (1) If any `updateComment` IPC call fails after the GitHub review was already submitted, the catch shows an error toast and leaves the dialog open with the Submit button re-enabled (`setBusy(false)` in finally) — clicking Submit again posts a duplicate review with duplicate line comments to GitHub. (2) Resolution bypasses the cache-invalidation path: `api.updateComment` is called raw (instead of useUpdateCommentMutation which calls invalidateReviewQueries), and `loadComments()` uses `queryClient.fetchQuery` (AppStore.tsx:188-192) which respects the global `staleTime: 5_000` (client.ts:6) — if the comments query was fetched within the last 5 seconds, fetchQuery returns the cached array and the just-resolved comments still display as 'open' elsewhere in the app until something else invalidates them.

**권장 수정**: Split the flow: after ghPrSubmitReview succeeds, mark a 'submitted' flag (or close the dialog immediately) so a retry only re-runs the local resolution step. Resolve comments via `Promise.allSettled` and use `queryClient.invalidateQueries(queryKeys.session.comments(sessionId))` (or the existing useUpdateCommentMutation) instead of raw api.updateComment + loadComments so the cache is reliably refreshed.

### [MEDIUM/performance] PR diff re-renders all hunks/lines on every unrelated store change; no memo or virtualization

- **위치**: `src/views/PullRequestDetailView.tsx:27, 237-315`
- **발견**: react-views-a

Both PullRequestDetailView (line 27) and PrFileDiff (line 248) call `useApp()`, which internally does `useAppStore()` with no selector (AppStore.tsx:106) — subscribing to the ENTIRE zustand store — plus four live queries including the local-changes `selectedDiffQuery`, which is irrelevant to the PR view. Any store mutation re-renders the whole tree: every toast (and its auto-clear 3.2s later, store.ts:142-144), every `pushActivity`, fileFilter typing, etc. PrFileDiff is not wrapped in React.memo and renders every line of every hunk of the selected file as raw divs (`diff.hunks.map(...h.lines.map(...))`, lines 276-315) with no virtualization, plus an inline unmemoized `state.comments.filter(...)` per render (line 249). For a large changed file (a few thousand diff lines), each stray store update re-renders thousands of DOM rows — e.g., opening the comment composer or any success toast makes the diff pane visibly janky.

**권장 수정**: Subscribe via narrow selectors (`useAppStore((s) => s.comments)` etc., as PullRequestsView/IssuesView already do) instead of `useApp()` in these components; wrap PrFileDiff in React.memo with stable callback props (the three inline `set Composer` lambdas at lines 184-192 should be useCallback); and virtualize long diffs (react-window or the CodeMirror-based DiffViewer already in the codebase) or at least collapse large hunks.

**검증 단계 보정**: The finding is correct in substance with two small factual errors: (1) "fileFilter typing" cannot trigger PR-view re-renders because the filter input (ChangedFilesPanel/LocalChangesView) is never mounted simultaneously with PullRequestDetailView (App.tsx renders views exclusively); toasts, the 3.2s toast auto-clear, and pushActivity remain valid reachable triggers. (2) The recommendation's reference to "the CodeMirror-based DiffViewer already in the codebase" is wrong — DiffViewer.tsx renders raw divs the same way; only CodeViewer.tsx uses CodeMirror, so reuse of DiffViewer would not provide virtualization.

### [MEDIUM/bug] Race: PR checkout onSuccess navigates with stale PR after the user switches repositories

- **위치**: `src/views/PullRequestsView.tsx:49-60`
- **발견**: react-views-a

`onSuccess: (session, pr) => { setSession(session); setPrNumber(pr.number); setView('pr-detail'); }`. The mutationFn `api.ghPrCheckout(repo.id, pr.number)` runs two network `git fetch` operations in the main process (electron/ipc.ts:406-407) and can take many seconds on a large repo. PullRequestsView stays mounted on the 'pr-list' view the whole time, so if the user switches repositories in the sidebar while the checkout is in flight, `setRepo` clears session/prNumber (store.ts:107-114) — and then this onSuccess fires and re-applies the OLD repo's session object and PR number against the NEW repo. PullRequestDetailView then queries `useGithubPullRequestDetailQuery(newRepoId, oldPrNumber)`, displaying an unrelated PR (or a 404 toast) from the wrong repository, while comments load from the old repo's review session. There is also no error/disabled treatment tied to the repo change, so nothing prevents this.

**권장 수정**: Capture the repo id with the mutation variables (e.g., `mutationFn: ({ repoId, pr }) => ...`) and guard onSuccess: `if (useAppStore.getState().repo?.id !== repoId) return;` before calling setSession/setPrNumber/setView. Alternatively cancel/ignore pending open-PR mutations whenever `repo` changes.

**검증 단계 보정**: The race is real but the mechanism description needs one fix: PullRequestsView does NOT stay mounted — ProjectSidebar.switchTo also dispatches view:'local', which unmounts it. The stale onSuccess fires anyway because in TanStack Query v5 the hook-level onSuccess is bound to the Mutation in the MutationCache and runs regardless of component unmount, and the captured zustand setters are stable globals. Everything else (stale session/prNumber re-applied against the new repo, pr-detail navigation showing the wrong repo's PR or a 404, comments loading from the old repo's session, and the recommended repoId guard) is accurate.

### [LOW/bug] IPC errors reach the renderer with Electron's noisy 'Error invoking remote method' prefix

- **위치**: `electron/ipc.ts:92-94`
- **발견**: electron-core

The `handle` wrapper rethrows handler errors through `ipcMain.handle`. Electron serializes these so the renderer receives `Error: Error invoking remote method 'repo:commit': Error: <real message>` — and nothing in src/api.ts or the renderer strips that prefix (no occurrence of 'Error invoking' anywhere in src/). Handlers deliberately throw user-facing messages, e.g. ipc.ts:489-491: `'This repository has no GitHub account bound. Open the account menu in the top bar and assign one.'` — so users see the doubled, channel-prefixed version in toasts/dialogs instead of the intended text.

**권장 수정**: Either catch in the wrapper and return a structured `{ ok, error }` envelope that src/api.ts unwraps, or strip the prefix on the renderer side with a regex like `/^Error invoking remote method '[^']+': (?:Error: )?/` before displaying messages.

### [LOW/security] system:shellOpenExternal opens arbitrary renderer-supplied URLs with no protocol allowlist

- **위치**: `electron/ipc.ts:451-454`
- **발견**: architecture

`handle(IpcChannels.shellOpenExternal, async (url: string) => { await shell.openExternal(url); ... })` passes whatever string the renderer sends straight to shell.openExternal. A compromised or XSS'd renderer could invoke `window.differ.openExternal('file:///...')` or other protocol handlers (smb://, vscode:// etc.) to escalate beyond the browser context. The other gh open handlers (ipc.ts:417-421, 438-442) correctly construct https URLs in main, so this generic channel is the only loose one.

**권장 수정**: Validate in the handler: `const u = new URL(url); if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('blocked');` before calling shell.openExternal.

### [LOW/security] No Content-Security-Policy set for the renderer (and index.html loads remote Google Fonts)

- **위치**: `electron/main.ts:23-37`
- **발견**: electron-core

Neither the main process (e.g. via `session.defaultSession.webRequest.onHeadersReceived`) nor src/index.html (no `<meta http-equiv="Content-Security-Policy">`) defines a CSP. The window also pulls `https://fonts.googleapis.com/css2?...` at runtime, so the renderer already mixes remote content into a privileged local page. Without a CSP, any HTML-injection bug in the renderer escalates to script execution with access to the `window.differ` bridge. Electron prints a security warning about exactly this in dev mode.

**권장 수정**: Add a strict CSP — either a meta tag in src/index.html or injected from main via onHeadersReceived — e.g. `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'`. Better: bundle the Inter/JetBrains Mono fonts locally and drop the remote origins entirely.

### [LOW/bug] Database closed before app.quit() while async IPC handlers may still be in flight; redundant double-close path

- **위치**: `electron/main.ts:54-63`
- **발견**: electron-core

```
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase();
    app.quit();
  }
});
app.on('before-quit', () => { closeDatabase(); });
```
On Windows/Linux this closes the DB, then `app.quit()` fires `before-quit`, which calls `closeDatabase()` again (harmless only because db.ts:25-30 nulls the handle). The real latent issue: closing the DB synchronously at `window-all-closed`/`before-quit` while an async IPC handler is mid-await (e.g. `repoCommit` awaiting `git commit`, then a store call) makes any subsequent `getDb()` throw 'Database not initialized' (db.ts:21), so an operation the user just triggered can half-complete its git work but lose its DB write during shutdown.

**권장 수정**: Remove the `closeDatabase()` call from `window-all-closed` (let `before-quit`/`will-quit` own it), and ideally track in-flight handler promises and await them (or use `app.once('will-quit', ...)` with `event.preventDefault()` until pending work settles) before closing the database.

**검증 단계 보정**: The issue is real, but the cited example handler is wrong: repoCommit (ipc.ts:256-260) performs no DB write after its await — its only DB access (mustRepo) happens before `await gitCommit()`. The lost-DB-write scenario instead applies to handlers like ghPrCheckout (ipc.ts:399-409, awaits API/git fetches then ensurePrSession), sessionEnsureLocal (ipc.ts:307-311, awaits getStatus then ensureLocalSession), and repoOpen/repoPick/repoClone via openRepoAtPath (ipc.ts:457-475, awaits git then upsertRepository). The double-close and the unguarded shutdown-while-in-flight claims are otherwise accurate as written.

### [LOW/bug] app.whenReady() chain has no error handling — startup failure leaves a running app with no window and no feedback

- **위치**: `electron/main.ts:44-52`
- **발견**: electron-core

```
app.whenReady().then(() => {
  initDatabase();
  registerIpcHandlers({...});
  createWindow();
  ...
});
```
There is no `.catch`. `initDatabase()` can throw synchronously (corrupt/locked SQLite file, migration failure in applyMigrations, mkdir failure). If it does, the rejection is unhandled, `createWindow()` never runs, and the process keeps running headless with no window and no error dialog — the user sees the app 'not opening' with zero diagnostics.

**권장 수정**: Append `.catch((err) => { dialog.showErrorBox('Differ failed to start', String(err?.stack ?? err)); app.quit(); })` to the whenReady chain so startup failures are surfaced and the process exits.

### [LOW/electron] No single-instance lock; multiple app instances share the same SQLite database

- **위치**: `electron/main.ts:44-52`
- **발견**: electron-core

main.ts never calls `app.requestSingleInstanceLock()`. Launching the app twice opens two windows, each with its own better-sqlite3 connection to `userData/differ.sqlite3` and each independently running migrations (db.ts applyMigrations, including the sort_order seeding writes at db.ts:110-119). WAL mode plus better-sqlite3's busy timeout makes corruption unlikely, but the instances do not see each other's writes consistently (recent repos, comments, OAuth account rows added in one instance won't appear in the other), and the OAuth device flow's module-level state is per-process. Standard desktop behavior is to focus the existing window.

**권장 수정**: At startup: `if (!app.requestSingleInstanceLock()) { app.quit(); } else { app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } }); ... }`.

### [LOW/architecture] Preload's exported DifferApi type is dead code; renderer hand-duplicates the API surface, creating drift risk

- **위치**: `electron/preload.ts:104-106`
- **발견**: electron-core

preload.ts ends with `export type DifferApi = typeof api;`, but the renderer never imports it — src/api.ts:35-36 redeclares the whole interface by hand with the comment 'This must match the preload's exposed API exactly. We model it on the renderer side.' Two sources of truth means a changed signature or renamed method in preload compiles cleanly while the renderer keeps calling the old shape, failing only at runtime (`undefined is not a function` or silently wrong args). Worse, several preload params are typed `unknown` (`cloneRepo: (req: unknown)` line 12, `createComment: (input: unknown)` line 61, `updateComment` patch line 62), so even if the type were shared it wouldn't catch payload mismatches; the wrapper `invoke<T = unknown>` (lines 4-5) also erases all return types.

**권장 수정**: Make preload the single source of truth: type each api method's params/returns with the shared types from ../shared/types (CloneRequest, ReviewComment inputs, etc.), then in src/api.ts do `import type { DifferApi } from '../electron/preload'` (type-only import is erased at build time and works across the tsconfig boundary) or move the DifferApi interface into shared/types.ts and have both sides implement/consume it.

### [LOW/bug] repositories.github_account_id has no foreign key constraint; dangling account bindings possible

- **위치**: `electron/services/accountStore.ts:82-86`
- **발견**: electron-stores

The column is added via `ensureColumn(d, 'repositories', 'github_account_id', 'INTEGER')` (db.ts:108) with no REFERENCES clause, so SQLite never validates it. setRepoAccount runs `UPDATE repositories SET github_account_id = ? WHERE id = ?` with an accountId straight from the renderer over IPC; rebindRepos (lines 75-80) likewise accepts any toAccountId. A stale or bogus id creates a binding to a nonexistent github_accounts row — the repo then silently loses GitHub features because githubService's client lookup by id finds nothing. deleteAccount correctly nulls bindings, but it is the only guarded path.

**권장 수정**: Add the constraint in the column declaration — SQLite permits `ALTER TABLE ... ADD COLUMN github_account_id INTEGER REFERENCES github_accounts(id) ON DELETE SET NULL` (with foreign_keys=ON already set at db.ts:15), which would also make the manual UPDATE in deleteAccount unnecessary. Short of that, validate accountId exists in setRepoAccount/rebindRepos before writing.

**검증 단계 보정**: The issue is real as described, with two refinements: the repo does not "silently" lose GitHub features — mustClient throws an explicit "GitHub account N is not signed in" error surfaced in the UI; and adding the REFERENCES clause inside ensureColumn only constrains fresh databases, since existing installs already have the column and the ALTER is skipped (a table-rebuild migration or write-path validation is needed for existing DBs). The clone flow (ipc.ts:131 → openRepoAtPath → upsertRepository) is an additional unvalidated write path beyond the two cited.

### [LOW/bug] Comment ordering by second-resolution created_at is non-deterministic for same-second comments

- **위치**: `electron/services/commentStore.ts:27-31`
- **발견**: electron-stores

`SELECT * FROM review_comments WHERE review_session_id = ? ORDER BY created_at ASC` — created_at defaults to `datetime('now')` (db.ts:74), which has 1-second resolution. Two comments added within the same second (easy when quickly annotating several lines) have unspecified relative order in SQLite; the order can differ between refetches or after a VACUUM/index change, so comments can visibly swap positions in the UI.

**권장 수정**: Change to `ORDER BY created_at ASC, id ASC` (id is the monotonic rowid) for a stable total order; same for listCommentsByIds if kept.

**검증 단계 보정**: Core finding is correct as written. Minor corrections to the impact narrative: (a) order changing "between refetches" within one app run is unlikely in practice because the query plan and index-scan input order are deterministic on a fixed SQLite build; (b) VACUUM will not change ordering here since id is an INTEGER PRIMARY KEY (rowid alias) which VACUUM preserves. The non-determinism is per the SQL contract and across SQLite version/plan changes. The recommended fix (ORDER BY created_at ASC, id ASC in both listComments and listCommentsByIds) is correct.

### [LOW/architecture] listCommentsByIds is dead code left over from the removed AI context builder

- **위치**: `electron/services/commentStore.ts:81-87`
- **발견**: electron-stores

`export function listCommentsByIds(ids: number[])` has no callers anywhere in electron/ or src/ (verified via grep); its consumer was removed in commit 6810677 "Remove AI context builder". It builds an IN clause with one `?` per id (`ids.map(() => '?').join(',')` — parameterized, so not injectable, but unbounded: a huge array would exceed SQLite's variable limit). Keeping an unused export that dynamically assembles SQL invites accidental reuse without the limit being addressed.

**권장 수정**: Delete the function. If it is ever needed again, chunk ids to stay under SQLITE_MAX_VARIABLE_NUMBER and add the `, id ASC` tiebreaker.

### [LOW/bug] sort_order seeding runs row-by-row outside a transaction; a crash mid-seed permanently strands repos at sort_order 0

- **위치**: `electron/services/db.ts:109-119`
- **발견**: electron-stores

The one-time seeding does `rows.forEach((r, i) => update.run(i + 1, r.id));` with each UPDATE in its own implicit transaction. The guard is `SELECT COUNT(*) ... WHERE sort_order != 0` — if the process dies mid-loop, some repos have sort_order > 0, so on next launch seeded.n > 0 and seeding never resumes. The remaining repos keep sort_order 0, and since listRecentRepositories orders by `sort_order ASC`, they are pinned to the top of the list forever (0 sorts before 1) regardless of last_opened_at, until the user manually reorders.

**권장 수정**: Wrap the seeding loop in `d.transaction(...)` so it is atomic (this also collapses N fsyncs into one). Alternatively seed with a single statement: `UPDATE repositories SET sort_order = (SELECT COUNT(*) FROM repositories r2 WHERE r2.last_opened_at >= repositories.last_opened_at)`.

### [LOW/performance] Every store call re-prepares its SQL statement instead of reusing prepared statements

- **위치**: `electron/services/db.ts:129-147`
- **발견**: electron-stores

All persistence functions across db.ts, repoStore.ts, sessionStore.ts, commentStore.ts, fileReviewStore.ts and accountStore.ts call `getDb().prepare(...)` on every invocation (e.g. listComments at commentStore.ts:27-31, setFileState at fileReviewStore.ts:16-20). better-sqlite3 does not cache prepared statements, so each call pays full SQL parse/compile cost synchronously on the Electron main process. Individually cheap, but hot paths like setFileState/listComments/listFileStates fire per file click during a review session, and it is pure waste given better-sqlite3 statements are designed to be prepared once and reused.

**권장 수정**: Add a small memoizing helper in db.ts, e.g. a Map<string, Statement> keyed by SQL (`function stmt(sql) { ... cache.get(sql) ?? cache.set(sql, getDb().prepare(sql)) }`), cleared in closeDatabase(); have the stores use it instead of raw prepare().

### [LOW/bug] Truncated reads ignore bytesRead, returning NUL-padded text and risking binary misclassification

- **위치**: `electron/services/fileTree.ts:76-87`
- **발견**: electron-stores

For files over 2MB: `const buf = Buffer.alloc(MAX_FILE_BYTES); await fd.read(buf, 0, MAX_FILE_BYTES, 0);` discards the `{ bytesRead }` result. A single read is not guaranteed to fill the buffer (short reads happen on network filesystems, and the file can shrink between the fs.stat at line 72 and the read — a real TOCTOU window in a live working tree being edited). Any unfilled tail stays zero-filled: looksBinary() then sees NUL bytes and flags a text file as binary (if bytesRead < 8000), or `buf.toString('utf8')` appends a run of U+0000 garbage to the returned text.

**권장 수정**: Capture `const { bytesRead } = await fd.read(...)` and operate on `buf.subarray(0, bytesRead)` for both looksBinary and toString; loop the read until bytesRead totals the requested length or EOF.

### [LOW/bug] All symlinks are silently dropped from the tree listing, hiding git-tracked symlinked files

- **위치**: `electron/services/fileTree.ts:46-48`
- **발견**: electron-stores

`const isDir = d.isDirectory(); const isFile = d.isFile(); if (!isDir && !isFile) continue; // skip symlinks/sockets` — Dirent reports false for both on any symlink (readdir withFileTypes does not follow links), so committed symlinks (common in monorepos, dotfiles repos, pnpm-linked packages) never appear in the file tree, with no indication anything was omitted. This is also inconsistent with readFile(), which does follow symlinks if given the path directly (see the separate safeJoin finding), so a symlinked file is openable from a diff list but invisible in the tree.

**권장 수정**: Include symlinks as entries (kind 'file' with e.g. a symlink flag in TreeEntry, resolving via fs.stat on the target to classify file vs dir, with containment re-checked), or at least keep the tree and readFile policies consistent by rejecting symlinks in both.

### [LOW/bug] getCommits throws on a repository with no commits

- **위치**: `electron/services/git.ts:298-308`
- **발견**: electron-git

```
const r = await runGit(['log', `-n`, String(limit), `--pretty=format:${format}`], { cwd });
```
In a freshly `git init`ed (or just-created empty GitHub) repo, `git log` exits 128 with 'fatal: your current branch ... does not have any commits yet'. runGit rejects with GitError and the repoCommits IPC handler (electron/ipc.ts:159) propagates it, so the commits panel shows an error instead of an empty list. Sibling helpers (getHeadSha, getMergeBase) catch and return null for exactly this kind of case; getCommits does not.

**권장 수정**: Wrap the runGit call in try/catch and return [] when the error indicates no commits (or guard with `await getHeadSha(cwd)` returning null first).

**검증 단계 보정**: Finding is accurate. Only presentation detail to refine: the error surfaces as an error toast (HistoryView.tsx:85) while the panel body coincidentally shows the empty-state text; the user still gets a spurious git fatal error for a valid empty repository.

### [LOW/bug] runGit stdin handling: no 'error' listener (EPIPE can crash the main process) and empty-string input never closes stdin

- **위치**: `electron/services/git.ts:65-68`
- **발견**: electron-git

```
if (opts.input) {
  child.stdin.write(opts.input);
  child.stdin.end();
}
```
Two issues: (1) there is no 'error' handler on child.stdin — if git exits before consuming stdin (e.g. `git apply` bailing early on a malformed patch while a large patch is still being flushed), the write raises EPIPE as an 'error' event on the stream; an unhandled stream 'error' event throws, which in the Electron main process is an uncaught exception that can take down the whole app. (2) the truthiness check means `input: ''` leaves stdin open forever — currently no caller passes an empty string, but any future stdin-reading command invoked with empty input would hang indefinitely.

**권장 수정**: Add `child.stdin.on('error', () => {})` (the close handler already reports the real failure via exit code/stderr), and change the guard to `if (opts.input !== undefined)` ... `child.stdin.end(opts.input)`.

**검증 단계 보정**: The finding is correct as written except for the illustrative trigger: `git apply` reads the entire stdin into memory before parsing, so a merely malformed patch will not normally cause EPIPE. The realistic triggers are git exiting before draining stdin (startup fatal errors such as repository/index access problems, or the process being killed) combined with an input larger than the OS pipe buffer (~64KB). The defect itself — no 'error' listener on child.stdin (unhandled EPIPE = uncaught exception in the Electron main process, which has no uncaughtException handler) and the truthy guard skipping stdin.end() for `input: ''` — is real and was reproduced.

### [LOW/performance] No timeout on any git invocation — network operations can hang the UI forever

- **위치**: `electron/services/git.ts:37-48, 617-634`
- **발견**: electron-git

runGit sets `GIT_TERMINAL_PROMPT: '0'` (good for HTTP credential prompts) but offers no timeout and no AbortSignal, and `GIT_TERMINAL_PROMPT` does not cover ssh: for ssh remotes, host-key confirmation or key-passphrase prompts make `fetch`/`pull`/`push`/`syncWithRemote` block indefinitely (ssh prompts on /dev/tty when one exists, e.g. app launched from a terminal in dev). A stalled network connection similarly hangs forever. The renderer just sees a promise that never settles — a spinner with no way to cancel.

**권장 수정**: Add an optional `timeoutMs` (and/or AbortSignal) to RunOptions that kills the child (`child.kill()`) and rejects, applied to network commands; and set `GIT_SSH_COMMAND: 'ssh -oBatchMode=yes'` so ssh fails fast with a reportable error instead of prompting.

### [LOW/architecture] Dead exports in electron services: applyHunkPatch, getHeadSha, getMergeBase, listCommentsByIds

- **위치**: `electron/services/git.ts:673-731`
- **발견**: architecture

Grep across the repo shows zero callers for: `applyHunkPatch` (git.ts:673-681 — superseded by stageHunk/unstageHunk which call runGit directly, and it contains the awkward push-then-splice `--cached` handling), `getHeadSha` (git.ts:715-722), `getMergeBase` (git.ts:724-731), and `listCommentsByIds` (commentStore.ts:81-87). Dead code in the git layer is risky specifically because applyHunkPatch looks like the canonical hunk API but is not what production uses — a future contributor patching staging behavior may patch the wrong function.

**권장 수정**: Delete these four exports (history is in git if they're needed later). Re-enabling unused-symbol linting (see eslint finding) prevents recurrence.

### [LOW/performance] clone() forces --progress output that is buffered unboundedly in memory and never consumed

- **위치**: `electron/services/git.ts:93`
- **발견**: sweep:leaks-cleanup

`args.push('clone', '--progress', '--', remoteUrl, destDir);` explicitly forces progress reporting even though stderr is a non-TTY pipe (git would otherwise suppress it). runGit then accumulates every chunk into a single string at git.ts:54-56: `child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); })`. Nothing in the app consumes this progress stream — there is no progress UI, and on success the accumulated stderr is simply discarded by the caller (ipc.ts repoClone returns only the path). For a multi-minute clone of a large repository, git emits continuous carriage-return-updated progress lines ('Receiving objects: 43% ...'), so the main process retains megabytes of useless progress text for the duration of the clone and pays repeated string-concatenation cost on every chunk. This is separate from the already-reported diff-parsing memory issue: it is gratuitous output the code itself requested.

**권장 수정**: Remove `--progress` from the clone args until a progress UI exists. If progress reporting is added later, stream stderr to the renderer incrementally instead of accumulating it, and cap what is retained for error messages (e.g. keep only the last 64KB of stderr in runGit).

**검증 단계 보정**: The issue is real as described except for the magnitude estimate: for a multi-minute clone of a large repo, the retained progress text is realistically tens to a few hundred KB (git throttles progress display to roughly one update per second plus per-percent changes), not megabytes; megabyte-scale retention would only occur for clones lasting many hours. The core finding stands: --progress is gratuitously forced on a non-TTY pipe, the output is accumulated unboundedly in runGit, never consumed by any progress UI or IPC event, and discarded on success.

### [LOW/performance] getOperationState spawns three `git rev-parse --git-path` processes on every status call for repo-constant paths

- **위치**: `electron/services/git.ts:141-171`
- **발견**: sweep:perf-hotpaths

`getStatus` runs `Promise.all([runGit(['status', ...]), getOperationState(cwd)])` and `getOperationState` issues three more spawns: `gitPath(cwd, 'rebase-merge'), gitPath(cwd, 'rebase-apply'), gitPath(cwd, 'MERGE_HEAD')` (lines 151-155). The resolved paths are constant for a given repository (they only depend on the git dir), yet they are re-derived by spawning three child processes on every status query — the hottest IPC in the app, refetched after every mutation and on each 30s auto-fetch invalidation. That is 4 process spawns (~30-60ms of fork/exec overhead on macOS) where 1 suffices.

**권장 수정**: Resolve the git dir once per repo (`git rev-parse --absolute-git-dir`), cache it (e.g. keyed by repo path in a Map), and implement getOperationState as three `fs.existsSync`/`fs.promises.access` checks against the cached paths.

**검증 단계 보정**: The finding is accurate as written; one nuance: because the three gitPath spawns run in parallel with the `git status` spawn (which dominates wall-clock time), the ~30-60ms estimate reflects cumulative process-spawn CPU overhead rather than added per-call latency.

### [LOW/bug] slow_down interval is tracked in minIntervalMs but never enforced, causing repeated rate-limit churn

- **위치**: `electron/services/githubOAuth.ts:21, 85-92, 156-160`
- **발견**: electron-github

ActiveFlow.minIntervalMs is written at flow start (line 90) and updated on slow_down (`flow.minIntervalMs = next * 1000;` line 158) but is never read anywhere — the main process happily fires a token poll whenever the renderer asks. Per GitHub's device-flow semantics, the interval increase is permanent for the device code, but the renderer reverts to the *original* interval after the very next 'pending' response (GithubAuthDialog.tsx line 89: `schedulePoll(device?.interval ?? 5)`), so the flow oscillates: slow_down → one slow poll → pending → fast poll → slow_down again. Each violation can bump the required interval further, delaying authorization detection and spamming GitHub.

**권장 수정**: Enforce minIntervalMs in pollDeviceFlow: record lastPollAt and, if called before lastPollAt + minIntervalMs, either delay the request or return { status: 'pending' } without hitting GitHub. Also return the current effective interval on 'pending' results so the renderer keeps the raised cadence.

### [LOW/security] Secret device_code is sent to the renderer although the renderer never needs it

- **위치**: `electron/services/githubOAuth.ts:93-99`
- **발견**: electron-github

startDeviceFlow returns `{ deviceCode: data.device_code, userCode, verificationUri, ... }` and this full object crosses the IPC bridge into renderer state (GithubAuthDialog.tsx stores it via setDevice). The device_code is the credential that, combined with the public client_id, can be exchanged for the access token; the renderer only ever uses userCode, verificationUri and interval. The main process already keeps device_code in `activeFlow` and pollDeviceFlow takes no arguments, so the exposure is pure least-privilege violation: renderer-level code execution (e.g. an XSS via rendered PR/issue markdown) during an active sign-in could exfiltrate device_code and poll GitHub directly to mint a repo-scoped token outside the app.

**권장 수정**: Drop deviceCode from the GithubDeviceCode IPC payload (and from shared/types.ts) — return only userCode, verificationUri, expiresIn and interval to the renderer.

### [LOW/bug] maybeMigrateLegacyToken race: concurrent callers see an empty account list mid-migration

- **위치**: `electron/services/githubService.ts:112-132, 155-158`
- **발견**: electron-github

`if (legacyMigrationAttempted) return; legacyMigrationAttempted = true;` sets the guard flag synchronously, then awaits probeUser (a network round-trip) before populating `clients`. A second caller arriving during that await (e.g. listAccounts() while listAllRepos() is migrating — both are invoked at startup) returns immediately and observes zero accounts, so the UI can briefly render a signed-out state for a user who has a valid legacy token, prompting an unnecessary re-auth.

**권장 수정**: Memoize the in-flight promise instead of a boolean: `let migrationPromise: Promise<void> | null = null; ... migrationPromise ??= doMigrate(); return migrationPromise;` so concurrent callers await the same migration.

**검증 단계 보정**: maybeMigrateLegacyToken race confirmed: the boolean guard is set before the awaited probeUser call, so concurrent callers see an empty account list mid-migration. However, the cited startup pairing is wrong — listAllRepos() only runs when the RepoBrowserDialog is opened (and only if accounts already exist). The actual startup race is between two concurrent listAccounts() calls: TopBar's useGithubAuthQuery and RepositoryPicker's direct api.ghAuthList() in its mount effect (views/RepositoryPicker.tsx:21-28). The loser caches authed=false and never refetches, so clicking Browse opens the auth dialog despite a valid legacy token. The recommended in-flight promise memoization is the right fix.

### [LOW/bug] Merged-PR filter only scans the 500 most recently updated closed PRs

- **위치**: `electron/services/githubService.ts:210-230`
- **발견**: electron-github

For `state === 'merged'` the API is queried with state 'closed' and post-filtered client-side: `for (let page = 1; page <= 5; page += 1) { ... if (state === 'all' || pr.state === state) results.push(pr); ... }`. The candidate pool is hard-capped at 5 pages x 100 closed PRs. In a repo where recently updated closed PRs are dominated by unmerged ones (bot PRs, dependabot closures), the 'merged' tab can return far fewer than the intended 50 results — or none — while older merged PRs exist, with no indication of truncation.

**권장 수정**: Use the search API for the merged filter (`GET /search/issues?q=repo:{owner}/{repo}+is:pr+is:merged&sort=updated`) which filters server-side, or raise/iterate the page bound until 50 merged results or end of data.

### [LOW/architecture] ESLint and tsconfig both disable unused-symbol detection, which is why dead code accumulated

- **위치**: `eslint.config.mjs:17-35`
- **발견**: architecture

eslint.config.mjs:33 sets `'@typescript-eslint/no-unused-vars': 'off'` and tsconfig.json:15-16 sets `noUnusedLocals: false` / `noUnusedParameters: false` — nothing in the toolchain flags unused code, and this audit found 8+ dead exports plus a dead IPC channel. Additionally the single config block (eslint.config.mjs:18-25) applies `globals.browser` AND `globals.node` to every ts/tsx file with `'no-undef': 'off'`, so renderer code referencing `process` (typed via @types/node leaking into the src project) lints and type-checks clean but is `undefined` at runtime under Vite.

**권장 수정**: Re-enable `@typescript-eslint/no-unused-vars` (with `argsIgnorePattern: '^_'`), and split the flat config into two file-scoped blocks: `src/**` with browser globals only and `electron/**` with node globals only. Optionally add `noUnusedLocals` back to both tsconfigs.

### [LOW/architecture] Runtime renderer dependencies inconsistently split between dependencies and devDependencies

- **위치**: `package.json:20-59`
- **발견**: architecture

`@radix-ui/react-dialog/dropdown-menu/popover/tabs/tooltip` and `clsx` — imported at runtime by renderer components (e.g. CommentComposer.tsx:2, cn util) — sit in devDependencies, while other renderer-only libs (react, zustand, lucide-react, @uiw/*, @tanstack/react-query) sit in dependencies alongside genuine main-process deps (better-sqlite3, dotenv, @octokit/rest). It works today only because Vite bundles the renderer. The split matters the moment packaging is added: electron-builder ships `dependencies` into the app (bloating the package with react/zustand/codemirror that are already bundled) and prunes devDependencies (fine for radix, but the inconsistency means nobody can tell which deps the main process actually needs).

**권장 수정**: Adopt the convention: `dependencies` = main-process runtime only (better-sqlite3, dotenv, @octokit/rest); everything bundled by Vite (react, zustand, radix, lucide, codemirror, tanstack, clsx) goes to devDependencies. Document it with a comment or in README so future deps land in the right bucket.

**검증 단계 보정**: Finding is correct, with one refinement: of the radix packages in devDependencies, only react-dialog and react-dropdown-menu are actually imported at runtime (plus clsx); @radix-ui/react-popover, react-tabs, and react-tooltip are declared but never imported anywhere in src/ or electron/ — they are unused dependencies that could simply be removed rather than re-categorized.

### [LOW/architecture] Dead IPC channel: fileStateGet is declared but never registered or invoked

- **위치**: `shared/types.ts:409`
- **발견**: architecture

`fileStateGet: 'fileState:get'` exists in the IpcChannels map (shared/types.ts:409) but ipc.ts registers only `fileStateList` and `fileStateSet` (ipc.ts:343-346) and preload.ts never invokes it. Anyone reading IpcChannels as the contract will assume the channel exists; invoking it would throw Electron's "No handler registered for 'fileState:get'" at runtime. This is exactly the drift the const map was meant to prevent.

**권장 수정**: Delete the `fileStateGet` entry (or implement the handler if a single-file getter is actually wanted). If you adopt the typed channel-map contract from the api.ts finding, missing handlers like this become detectable.

### [LOW/architecture] SQLite row shapes leak through the IPC contract: Repository.pinned is a 0/1 number, snake_case rows mixed with camelCase wire types

- **위치**: `shared/types.ts:3-61`
- **발견**: architecture

Repository/ReviewSession/ReviewComment/FileReviewState in shared/types.ts are raw `SELECT *` row shapes (snake_case, `pinned: number`), while the git/GitHub wire types in the same file are camelCase with booleans. The renderer pays for it: ProjectSidebar must write `pinned: wantPinned ? 1 : 0` and `{ ...r, pinned: willPin ? 1 : 0 }` when optimistically updating the cache (ProjectSidebar.tsx:96-97, 135), and truthiness checks like `r.pinned ? p : u` (line 56) rely on sqlite's int convention. Any future column rename in the DB is automatically an IPC/UI breaking change because there is no mapping layer.

**권장 수정**: Map rows to the wire type at the store boundary (repoStore/sessionStore/commentStore return camelCase objects with real booleans, e.g. `pinned: row.pinned === 1`), keeping row interfaces private to electron/services like accountStore.ts already does with GithubAccountRow → GithubAccount.

**검증 단계 보정**: Minor precision: the GithubAccountRow → GithubAccount mapping cited as precedent is implemented in electron/services/githubService.ts (rowToAccount, line 87), with accountStore.ts only defining and returning the private row type. The substance of the finding is otherwise accurate as written.

### [LOW/bug] BranchMenu create flow has no pending guard and stale state survives menu close

- **위치**: `src/components/BranchMenu.tsx:33-45`
- **발견**: react-components

`doCreate` has no busy/pending state: the Create button (line 105) is never disabled and Enter in the input fires it too, so double-press/double-click issues two concurrent `api.createBranch` calls — the second fails with a confusing "branch already exists" error toast right after the success toast. Also `creating`/`newName` live in BranchMenu (not the unmounting Content), and are only reset on successful create, so closing the menu by clicking outside while the form is open re-shows the half-filled create form on next open.

**권장 수정**: Add a `pending` state set around the createBranch call, disable the button and ignore Enter while pending, and reset `creating`/`newName` when `open` becomes false (in the `onOpenChange` handler).

### [LOW/bug] initialFolderName prop is silently overwritten on mount by the URL-derivation effect

- **위치**: `src/components/CloneFromUrlDialog.tsx:54-58`
- **발견**: react-components

`useEffect(() => { if (!userEditedFolder.current) { setFolderName(deriveFolderName(url)); } }, [url]);` runs on mount (effects always run after the first render), and `userEditedFolder.current` is false at that point, so the initial state `useState(initialFolderName ?? deriveFolderName(initialUrl))` is immediately replaced with `deriveFolderName(initialUrl)`. The `initialFolderName` prop passed from RepoBrowserDialog (`initialFolderName={cloneTarget.name}`) is therefore dead — it only happens to work today because GitHub clone URLs end in `<name>.git`. Any future caller passing a folder name that differs from the URL basename will be silently ignored.

**권장 수정**: Skip the first run when an explicit name was provided: initialize `userEditedFolder` from `initialFolderName != null`, or track the previous url in a ref and only re-derive when `url` actually changes from its initial value.

### [LOW/bug] toggleReviewed has no error handling — IPC failure becomes a silent unhandled rejection

- **위치**: `src/components/DiffViewer.tsx:83-91`
- **발견**: react-views-b

`const toggleReviewed = async () => { ...; await setFileStateMutation.mutateAsync({ filePath: selected, status: next }); ... }` is invoked as `void toggleReviewed()` (line 150) with no try/catch, unlike the sibling handlers `stageHunk`/`unstageHunk` (lines 64-81) which catch and toast. If the IPC call fails the rejection is unhandled, the user gets no toast, and the "Mark reviewed" button silently does nothing.

**권장 수정**: Wrap the mutateAsync call in try/catch and call `toast('error', (e as Error).message)` like the other handlers in this file.

### [LOW/bug] Collapsing a directory discards the expansion state of all nested directories

- **위치**: `src/components/FileTree.tsx:71-99`
- **발견**: react-components

Children are conditionally mounted: `{entry.kind === 'dir' && open && (<>...{children?.map((c) => <TreeNode key={c.path} .../>)}</>)}`. Because each node's `open` flag lives in component-local `useState(false)` (line 32), unmounting on collapse destroys it. Collapsing `src/` and re-expanding it loses every expanded subdirectory underneath, forcing the user to re-drill into deep paths — a constant annoyance when browsing large trees.

**권장 수정**: Lift expansion state into the FileTree parent as a `Set<string>` of expanded paths (or a zustand slice keyed by repoId) so it survives unmounts; alternatively keep children mounted and hide them with CSS, though lifted state is cheaper for big trees.

### [LOW/react] OAuth poll loop captures a stale `device`, ignoring GitHub's mandated polling interval

- **위치**: `src/components/GithubAuthDialog.tsx:65-103`
- **발견**: react-components

`schedulePoll` is first invoked inside `startOAuth`, so the `setTimeout(() => void poll(), ...)` callback captures the `poll` closure from the render where `device` was still `null` (`setDevice(code)` hasn't re-rendered yet). Every subsequent `schedulePoll` inside that stale `poll` re-schedules the same stale closure, so in the pending branch `schedulePoll(device?.interval ?? 5)` always evaluates with `device === null` and falls back to 5s forever. If GitHub returns an interval > 5s, the app polls too fast and relies on `slow_down` responses to back off, generating avoidable API churn.

**권장 수정**: Keep the interval in a ref (`intervalRef.current = code.interval` set in startOAuth and updated on slow_down) and read the ref inside `poll`, or store `poll` itself in a ref updated each render so timers always invoke the latest closure.

**검증 단계 보정**: The finding is accurate as stated. Minor addition: the slow_down recovery is also undermined — after one `slow_down` reschedule at `nextIntervalSeconds`, the next pending response reverts to the 5s fallback because of the same stale closure, so backoff does not persist.

### [LOW/bug] Initial account/config fetch has no error handling — silent empty dialog on IPC failure

- **위치**: `src/components/GithubAuthDialog.tsx:34-45`
- **발견**: react-components

`void (async () => { const [state, cfg] = await Promise.all([api.ghAuthList(), api.ghOauthConfig()]); ... })();` has no catch. If either IPC call rejects, the promise rejection is unhandled, `accounts` stays `[]` and `oauthConfigured` stays `null`, so the dialog silently renders the signed-out state with no error message — a signed-in user would see "Sign in to browse..." and might re-auth needlessly. The same uncaught pattern exists in CloneFromUrlDialog.tsx lines 42-50 (`void api.ghAuthList().then(...)` with no `.catch`).

**권장 수정**: Add a `.catch((e) => toast('error', (e as Error).message))` (or local error state) to both effects so backend failures surface instead of masquerading as a signed-out/empty state.

### [LOW/react] All dialogs lack Dialog.Description / aria-describedby (Radix logs a warning per open)

- **위치**: `src/components/GithubAuthDialog.tsx:181-182`
- **발견**: react-components

`<Dialog.Content className="fixed left-1/2 ...">` is rendered without a `Dialog.Description` child and without `aria-describedby={undefined}`. @radix-ui/react-dialog 1.1.x emits a console warning ('Missing `Description` or `aria-describedby={undefined}` for {DialogContent}') every time the dialog opens, and screen readers get no description for the dialog. The same omission exists in CommentComposer.tsx (line 77), CloneFromUrlDialog.tsx (line 115), and RepoBrowserDialog.tsx (line 88).

**권장 수정**: Wrap the explanatory paragraph in each dialog in `<Dialog.Description asChild>` where one exists, or pass `aria-describedby={undefined}` on Dialog.Content where no description is appropriate.

### [LOW/architecture] GitHub check-run status/conclusion classification duplicated in three components

- **위치**: `src/components/pr/PullRequestOverview.tsx:217-251`
- **발견**: architecture

The conclusion→tone mapping (`success` → success; `failure | timed_out | action_required` → danger; `status !== 'completed'` → warn) and the label derivation `check.status.replace('_',' ') : check.conclusion ?? 'completed'` are implemented identically in PullRequestOverview.tsx:217-251 `CheckRow` and ReviewPanel.tsx:174-206 `CheckRow`, and the failing/passing predicate is repeated a third and fourth time inline at PullRequestOverview.tsx:18-24 (ActivityView) and :114-120 (PrSummaryPanel). Adding a conclusion (e.g. treating `stale` or `cancelled` differently) requires touching 4 sites; today they only stay consistent by luck.

**권장 수정**: Add src/utils/checks.ts with `checkTone(run: GithubCheckRun)` and `isFailing(run)`/`isPassing(run)`, plus one shared <CheckRow> component, and use them in ReviewPanel, ActivityView, and PrSummaryPanel.

### [LOW/bug] Org list query errors are silently swallowed in the repo browser

- **위치**: `src/components/RepoBrowserDialog.tsx:43-54`
- **발견**: react-components

`queryError` checks `authQuery.error`, `allReposQuery.error` and `orgReposQuery.error`, but never `orgsQuery.error`; `loading` likewise omits `orgsQuery.isFetching`. If `api.ghListMyOrgs` fails (expired token, missing `read:org` scope), `orgsForActive` is just `[]` (line 82) and the Orgs row simply doesn't render — the user has no way to tell their org repos are unreachable versus nonexistent, which matters since org membership is exactly what scoped tokens commonly lack.

**권장 수정**: Include `orgsQuery.error instanceof Error ? orgsQuery.error.message : null` in the `queryError` chain (or render an inline notice next to the Orgs row) so org-listing failures are visible.

### [LOW/react] ChecksCard re-toasts the same error on every Overview tab remount, duplicating inline display

- **위치**: `src/components/ReviewPanel.tsx:140-142`
- **발견**: react-views-b

`useEffect(() => { if (error) toast('error', error); }, [error, toast]);` — the error is already rendered inline at line 159 (`{error && <div ...>{error}</div>}`), so users see it twice. Worse, ChecksCard is conditionally mounted by the tab switch (`{tab === 'overview' && <OverviewTab />}`, line 60): if the checks query is in an error state, every switch from Comments back to Overview remounts the component and the effect fires again, re-toasting the same stale error each time even though no new request was made.

**권장 수정**: Remove the toast effect and keep only the inline error rendering (it is already visible in context), or toast from the query's error callback / a mutation-style handler so it fires once per failed fetch rather than per mount.

**검증 단계 보정**: The finding is essentially correct; one minor detail is off: on remount TanStack Query 5 does issue a new request (retryOnMount defaults to true and the errored query is stale), so "even though no new request was made" is inaccurate. The re-toast still happens as described because the effect fires at mount from the cached error before the refetch resolves.

### [LOW/performance] LabelChooser calls the heavyweight useApp hook per comment in the comments list

- **위치**: `src/components/ReviewPanel.tsx:397-399`
- **발견**: react-views-b

`function LabelChooser({ comment }) { const { state, toast } = useApp(); const updateComment = useUpdateCommentMutation(state.session?.id ?? null); ... }` — LabelChooser is rendered once per comment in CommentsTab (line 380). Each instance subscribes to the whole zustand store and mounts 4 React Query observers via useApp (same pattern as InlineCommentRow in DiffViewer), plus its own mutation, when it only needs the session id and a toast function. CommentsTab (line 297) already has both and could pass them down; with dozens of comments this multiplies observers and forces every row to re-render on unrelated store changes.

**권장 수정**: Pass `sessionId`, the existing `updateComment` mutation (or an `onChangeLabel` callback), and `toast` down from CommentsTab as props, and delete the useApp call from LabelChooser.

### [LOW/react] Toast is not announced to assistive tech and the single slot drops messages from batch operations

- **위치**: `src/components/Toast.tsx:8-23`
- **발견**: react-components

The toast container is a plain `<div className="fixed bottom-8 right-8 z-50">` with no `role="status"`/`aria-live`, so screen readers never announce success/error feedback — the only feedback channel for most git operations in this app. Additionally the store holds a single toast slot (store.ts showToast replaces `toast` wholesale), so rapid sequences — e.g. the per-file error toasts emitted inside ChangedFilesPanel's `stageAll` loop (lines 60-62) — overwrite each other and only the last error is ever visible.

**권장 수정**: Add `role="status" aria-live="polite"` (or `role="alert"` for errors) to the toast element, and either queue toasts in the store (array with per-toast timers) or at least extend the visible duration when a toast is replaced.

### [LOW/bug] Push upstream-retry bypasses friendlyGitError, surfacing raw git stderr in the toast

- **위치**: `src/components/TopBar.tsx:358-363`
- **발견**: react-components

In SyncButton's push branch: `if (/no upstream/i.test(msg)) { await api.push(repoId, { setUpstream: true }); } else { await handleError(msg); }` — the retry call is not wrapped, so if `push --set-upstream` itself fails (auth failure, non-fast-forward, protected branch), the raw multi-line git stderr propagates to `run`'s catch (line 41-42) and is toasted verbatim, skipping both `friendlyGitError` mapping and the conflict redirect that every other failure path in this component goes through.

**권장 수정**: Wrap the retry in the same handler: `try { await api.push(repoId, { setUpstream: true }); } catch (e2) { await handleError((e2 as Error).message); }`.

### [LOW/architecture] Push 'no upstream' fallback logic duplicated in TopBar and HistoryView with different matching

- **위치**: `src/components/TopBar.tsx:262-380`
- **발견**: architecture

TopBar's SyncButton (TopBar.tsx:353-367) does `if (/no upstream/i.test(msg)) await api.push(repoId, { setUpstream: true })`, while HistoryView's SyncScreen (HistoryView.tsx:529-538) implements the same retry with `(e as Error).message.includes('no upstream')` (case-sensitive — git actually prints "has no upstream branch" so it works, but the two copies already differ). More broadly, git error→UX mapping is business logic living inside a component: `friendlyGitError`/`isConflictError`/`deriveSyncMode` (TopBar.tsx:262-291) plus a partial re-implementation of the conflict message trimming in HistoryView.tsx:248.

**권장 수정**: Extract a src/utils/gitActions.ts (or a useSyncActions hook) with `pushWithUpstreamFallback(repoId)`, `deriveSyncMode(status)`, and `friendlyGitError(msg)`; have TopBar and HistoryView SyncScreen consume it so retry behavior and messages cannot diverge.

### [LOW/performance] invalidateRepoQueries over-invalidates: staging a file/hunk invalidates all GitHub, tree, file-content, branches and commits queries

- **위치**: `src/query/hooks.ts:67-73`
- **발견**: react-state

`invalidateRepoQueries` invalidates `queryKeys.repo.scope(repoId)` (which prefixes status, branches, commits, tree, file-content), `diff.repo(repoId)` AND `github.repo(repoId)` (PR list, PR detail, checks, issues). It is wired as the onSuccess of every mutation including `useStageFileMutation`, `useStageHunkMutation`, `useUnstageHunkMutation` (lines 337-387). Staging a hunk changes only the index — it cannot change GitHub PRs, issues, branches, commit history, or file contents — yet all of those are marked stale (and any active ones refetch immediately; e.g. checks/PR queries hit the GitHub REST API, burning rate limit). On top of that, useAutoFetch routes its 30-second `silentFetch` through the same function, so every github/tree/file query is re-marked stale twice a minute, defeating caching for those families.

**권장 수정**: Split the helper: `invalidateWorkingTreeQueries` (status + diffs) for stage/unstage/hunk mutations; commit/amend additionally invalidate commits/branches; only fetch/pull/push/sync and submitReview touch the github scope.

**검증 단계 보정**: Only a minor overstatement: 'defeating caching for those families' via the 30s auto-fetch is marginal for inactive queries because the global staleTime is already just 5 seconds, so those queries would be stale on next mount regardless; the real auto-fetch cost is the immediate refetch of currently-active queries (including GitHub checks/PR queries during a PR session). Also, invalidating branches/commits from silentFetch after a git fetch is arguably intentional since fetch updates remote refs. The core finding stands as written.

### [LOW/bug] dispatch 'setStatus' silently ignores null — ProjectSidebar's intent to clear status on repo switch is a no-op

- **위치**: `src/state/AppStore.tsx:226-230`
- **발견**: react-state

`case 'setStatus': { const repo = store.repo; if (repo && action.status) queryClient.setQueryData(...); break; }` — when `action.status` is null the action does nothing. ProjectSidebar.tsx:66 and :83 dispatch `{ type: 'setStatus', status: null }` when switching/opening repos, clearly intending to clear the previous status; it silently no-ops. Also note the guard reads `store.repo` AFTER the preceding `setRepo` dispatch has already replaced it, so even a non-null write would target the NEW repo's key, not the one the caller saw. Impact is contained because status is keyed per repo, but the API lies about what it does and a returning user briefly sees up-to-10-min-old cached status (gcTime) until refresh lands.

**권장 수정**: Handle null by removing/resetting the cache entry (`queryClient.removeQueries({ queryKey: queryKeys.repo.status(repoId) })`), or delete the 'setStatus' action and its dead call sites since the status is fully owned by TanStack Query.

### [LOW/architecture] Confusing 'Store' naming: AppStore.tsx contains no store; zustand store, sqlite stores, and the shim all share the suffix

- **위치**: `src/state/AppStore.tsx:1-43`
- **발견**: architecture

Three unrelated things are called Store: (1) src/state/store.ts — the actual zustand store; (2) src/state/AppStore.tsx — which contains no store at all, only the legacy useApp() shim, a no-op AppProvider, and re-exports of useAppStore and its types (lines 36-43); (3) electron/services/*Store.ts (repoStore, commentStore, sessionStore, accountStore, fileReviewStore) — sqlite DAOs. As a result, imports are split: PullRequestsView/IssuesView/App import `useAppStore` from '../state/AppStore' (the re-export) while Toast and others would naturally import from './store'. A reader grepping 'AppStore' lands in the shim file and reasonably assumes it is the state container.

**권장 수정**: When deleting the useApp shim (see related finding), remove AppStore.tsx entirely and import useAppStore from src/state/store.ts everywhere. Optionally rename the electron DAOs to *Repository or *Dao if the overload still bites, but fixing the renderer side resolves most of the confusion.

**검증 단계 보정**: The finding is correct except for the 'imports are split' detail: currently no file outside src/state imports useAppStore from './store' — all consumers (App, Toast, IssuesView, PullRequestsView via useAppStore; ~15 others via useApp) import from the AppStore.tsx shim. The naming overload (store.ts = real zustand store, AppStore.tsx = storeless shim, electron/services/*Store.ts = sqlite DAOs) is fully accurate.

### [LOW/bug] silentFetch stamps lastFetchedAt onto the newly selected repo after a mid-flight switch

- **위치**: `src/state/AppStore.tsx:200-210`
- **발견**: sweep:async-races

silentFetch reads the repo once and applies the result unconditionally: `const repo = useAppStore.getState().repo; ... await api.fetch(repo.id); useAppStore.getState().setLastFetchedAt(Date.now());`. `api.fetch` runs `git fetch --all --prune` — a network operation that can take many seconds. If the user switches repositories while it is in flight, `setRepo` resets `lastFetchedAt` to null for the new repo, but the old fetch's completion then calls `setLastFetchedAt(Date.now())` on the global slot. TopBar (line 128-135) renders this as 'fetched Xs ago' for the NEW repo, which was never fetched, and the round-1-documented cooldown skip means no real fetch may happen for up to 15-30s while the UI claims freshness.

**권장 수정**: After the await, only call setLastFetchedAt when the repo is unchanged: `if (useAppStore.getState().repo?.id === repo.id) setLastFetchedAt(Date.now());` — or store lastFetchedAt keyed by repoId.

### [LOW/react] Unused appSelectors export returns fresh objects per call — an infinite-rerender footgun under zustand v5

- **위치**: `src/state/store.ts:153-184`
- **발견**: react-state

`appSelectors` is exported but referenced nowhere in src (grep confirms only its definition). Two of its selectors, `diffOptions` (160-165) and `actions` (167-183), build and return a new object literal on every invocation. In zustand v5 (which uses useSyncExternalStore), `useAppStore(appSelectors.actions)` would trigger the "The result of getSnapshot should be cached" error / maximum-update-depth loop the moment someone adopts this seemingly-official selector set without wrapping it in `useShallow`. Dead code that actively invites a crash is worse than no code.

**권장 수정**: Delete `appSelectors`, or keep only the scalar selectors and rewrite the object-returning ones as documented `useShallow(appSelectors.actions)` hooks (e.g. export `useAppActions()` that wraps it).

### [LOW/bug] setRepo resets only part of the per-repo UI state — fileFilter, diffStaged and panel tabs leak across repos

- **위치**: `src/state/store.ts:107-114`
- **발견**: react-state

`setRepo: (repo) => set({ repo, session: null, selectedFile: null, prNumber: null, lastFetchedAt: null })` — it clears the session/selection but leaves `fileFilter`, `diffStaged`, `rightPanelTab`, `historyTab` and `activity` from the previous repo. Scenario: user types "webpack" in repo A's file filter (ChangedFilesPanel), switches to repo B via ProjectSidebar — repo B's changed-files list appears empty (filtered by the stale "webpack" string), and if `diffStaged` was left true the first selected file shows the staged diff variant unexpectedly. The activity feed also mixes events from both repos.

**권장 수정**: Reset all per-repo UI state in setRepo: `set({ repo, session: null, selectedFile: null, prNumber: null, lastFetchedAt: null, fileFilter: '', diffStaged: false, rightPanelTab: 'overview', activity: [] })` (keep view/diffMode as user prefs).

**검증 단계 보정**: setRepo (src/state/store.ts:107-114) does leave fileFilter, diffStaged, rightPanelTab, historyTab and activity behind on repo switch, and the fileFilter (stale filter empties repo B's changed-files list) and activity (timeline mixes events from both repos) leaks are real as described. The diffStaged consequence is overstated: selecting a file via ChangedFilesPanel click or j/k keyboard navigation always sets diffStaged from the file's group, so the first selected file shows the correct variant; stale diffStaged only takes effect via ReviewPanel's comment file-select path, which never sets it.

### [LOW/architecture] Dead exports in renderer state/query layer: appSelectors, readStatusFiles, readCurrentSession

- **위치**: `src/state/store.ts:153-184`
- **발견**: architecture

`appSelectors` (store.ts:153-184) is exported and never imported anywhere. Worse, it is a trap: `appSelectors.diffOptions` and `appSelectors.actions` return a NEW object literal on every call, so if someone follows the apparent intent and writes `useAppStore(appSelectors.actions)`, zustand v5's Object.is equality makes the component re-render on every store change (and with `useSyncExternalStore` warnings about getSnapshot). Similarly unused: `readStatusFiles` and `readCurrentSession` (src/query/hooks.ts:504-511).

**권장 수정**: Delete appSelectors, readStatusFiles, and readCurrentSession. If grouped selectors are wanted later, ship them pre-wrapped with `useShallow` from 'zustand/react/shallow' so they are safe to use.

### [LOW/architecture] HistoryView is a 628-line file containing three unrelated screens

- **위치**: `src/views/HistoryView.tsx:1-628`
- **발견**: react-views-a

One file holds GraphScreen (commit log, lines 75-217), ResolveScreen (conflict resolver, lines 221-427), and SyncScreen (fetch/pull/push, lines 431-627) — three screens with disjoint data dependencies, plus their helper components (CommitRow, Lane, MergePane, formatRelative, dotColor). They share nothing but the tab header. Because all three are colocated and the tab content is conditionally rendered from the same parent (lines 43-45), any change to one screen forces re-review of the whole file, and the per-screen helpers (e.g. `formatRelative` vs IssuesView's `formatDate`) are duplicated across views.

**권장 수정**: Split into src/views/history/GraphScreen.tsx, ResolveScreen.tsx, and SyncScreen.tsx with HistoryView reduced to the tab shell, and hoist shared date-formatting into a utils module (IssuesView.tsx:398-405 has a parallel formatter).

**검증 단계 보정**: The core finding stands. Minor corrections: the file is 627 lines, not 628; formatRelative (relative time like "5m"/"2h") and IssuesView's formatDate (absolute Intl date) are parallel-purpose per-view formatters with different output, not duplicated implementations; and ResolveScreen and SyncScreen do share some store-level data (state.files, state.status), so the screens' data dependencies are mostly-but-not-fully disjoint.

### [LOW/architecture] Relative/absolute date formatting implemented 4 times with inconsistent output

- **위치**: `src/views/HistoryView.tsx:203-217`
- **발견**: architecture

Four private date formatters exist: HistoryView.tsx:203-217 `formatRelative` (returns `5m`/`3h`/`2d`), TopBar.tsx:394-401 `formatAgo` (returns `fetched 5m ago`, caps at hours so a 3-day-old fetch shows `72h ago`), IssuesView.tsx:398-405 `formatDate` (Intl medium date + short time), RepoBrowserDialog.tsx:225-232 `formatDate` (toLocaleDateString). Plus raw `new Date(...).toLocaleString(...)` inline at DiffViewer.tsx:601, PullRequestDetailView.tsx:321/333, ReviewPanel.tsx:264. Same concept (timestamp display) renders differently per screen, and bugs like the `formatAgo` hour cap have to be fixed in each copy.

**권장 수정**: Create src/utils/datetime.ts exporting `formatRelative(iso|ms)` and `formatDateTime(iso)` and replace all five implementations/inline calls.

**검증 단계 보정**: One micro-detail: ReviewPanel.tsx:264 uses toLocaleTimeString (hour/minute only), not toLocaleString. Otherwise the finding is fully accurate; TopBar.tsx:131 even adds a sixth inline toLocaleString() in a tooltip title.

### [LOW/bug] HistoryView Resolve tab is non-functional placeholder UI shipped as a working merge resolver

- **위치**: `src/views/HistoryView.tsx:277-427`
- **발견**: architecture

ResolveScreen renders four action buttons whose handlers are `() => toast('info', 'Use incoming — not yet wired')`, 'Stage resolution', 'Reopen block', 'Accept and next' (HistoryView.tsx:277-283, 376-381), and MergePane (HistoryView.tsx:390-427) renders hard-coded fake content: `{[1,2,3,4,5].map(...)}` with line numbers `{71 + n}` and the literal text `// preview placeholder`, regardless of the selected conflicted file. During a real rebase conflict the conflict banner (which IS real, lines 286-320) routes users here, where the three-way panes show fabricated code and the resolution buttons do nothing — actively misleading in the one moment the user is under pressure. It also claims "Autosaved resolution draft locally" (line 374) which is not implemented.

**권장 수정**: Either gate the placeholder panes/buttons behind a clearly labeled 'coming soon' empty state (and remove the fake line content/'Autosaved' claim), or wire MergePane to real content via api.readFile + `git show :2:path` / `:3:path` stages. Keep only the working Continue/Abort banner until then.

**검증 단계 보정**: Minor precision fix only: it is TopBar's SyncButton conflict handler (/Users/jiun/develop/differ/src/components/TopBar.tsx:318-326), not the in-screen conflict banner, that routes users to the Resolve tab when a pull/sync/push hits conflicts. The banner (HistoryView.tsx:286-320) is part of ResolveScreen itself and is the only functional element there. All other claims are accurate as written.

### [LOW/react] Error toast effect keyed on Error object identity re-fires on every refetch and masks secondary errors

- **위치**: `src/views/IssuesView.tsx:58-62`
- **발견**: react-views-a

`useEffect(() => { const errors = [authQuery.error, issuesQuery.error, detailQuery.error].filter(Boolean); const first = errors[0]; if (first instanceof Error) toast('error', first.message); }, [authQuery.error, detailQuery.error, issuesQuery.error, toast]);` — the deps are the raw Error objects, which get a NEW identity on every failed (re)fetch, so the same message is re-toasted on each manual Refresh, each remount, and each stale refetch while GitHub is unreachable. It also only surfaces `errors[0]`: a persistent auth/issues-list error permanently shadows a detail-query error, so selecting different issues that each fail to load produces no feedback. The sibling views avoid the identity problem by extracting message strings first (HistoryView.tsx:82, PullRequestDetailView.tsx:55-62).

**권장 수정**: Derive stable string messages (e.g. `const issuesError = issuesQuery.error instanceof Error ? issuesQuery.error.message : null`) and toast each one in its own effect keyed on the string, matching the pattern used in GraphScreen/PullRequestDetailView; or move error reporting into a global QueryCache onError handler so views don't need these effects at all.

**검증 단계 보정**: The finding is essentially correct; one detail is overstated: when a persistent auth/issues-list error shadows a detail-query error, selecting different failing issues does not produce "no feedback" — the detail error's new object identity re-runs the effect, which re-toasts the FIRST error's message. So the user gets repeated/misleading feedback (the wrong error message) rather than silence; the detail error message itself is indeed never surfaced.

### [LOW/bug] Fullscreen keyboard handler conflicts with the comment composer dialog (Escape closes both, j/k navigate behind it)

- **위치**: `src/views/LocalChangesView.tsx:22-57`
- **발견**: react-views-b

The fullscreen handler `window.addEventListener('keydown', handler)` only guards `if (editable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;` (line 28). DiffViewer in fullscreen can open the Radix CommentComposer dialog. If focus is on any non-input element inside the dialog (the label buttons, Cancel/Save buttons), pressing Escape is handled by both Radix (closes the dialog) and this handler (`dispatch({ type: 'setDiffFullscreen', value: false })`, line 32), so a single Escape kicks the user out of both the dialog and fullscreen. Similarly, pressing `j`/`k` with a dialog button focused navigates to a different file behind the open composer, so the comment is saved against `selected` (the new file) — DiffViewer passes `filePath={selected}` to the composer (DiffViewer.tsx line 201), retargeting the in-progress comment to a file the user never intended.

**권장 수정**: Bail out of the handler when a dialog is open — e.g. check `document.querySelector('[data-state="open"][role="dialog"]')` or, better, lift the composer-open state so the effect can early-return (and/or have DiffViewer freeze the composer's filePath/hunk target in the composer state at open time rather than reading live `selected`).

**검증 단계 보정**: Minor nuance only: the j/k retargeting that preserves the typed comment body occurs when the newly selected file's diff is already in the query cache; if uncached, DiffViewer's early-return branch unmounts the composer (losing the draft) and remounts it empty against the new file. The Escape double-close claim is exactly as described.

### [LOW/architecture] PullRequestDetailView mixes the view shell, a diff renderer, and a submit dialog in one file

- **위치**: `src/views/PullRequestDetailView.tsx:1-489`
- **발견**: react-views-a

The 489-line file contains the route-level view (lines 26-221), the full custom diff renderer PrFileDiff (lines 237-340), and the stateful SubmitReviewDialog with its own GitHub submission workflow (lines 342-488). PrFileDiff duplicates diff-rendering concerns already handled by src/components/DiffViewer.tsx (which has memoized row building), and SubmitReviewDialog owns a multi-step network workflow that is hard to test embedded here. This colocation is also what led to the unmemoized render path flagged in the performance finding — extracting PrFileDiff naturally introduces a memo boundary.

**권장 수정**: Move PrFileDiff and SubmitReviewDialog into src/components/pr/ alongside PullRequestOverview.tsx, exporting them as memoized components; consider reusing/extending DiffViewer for PR diffs instead of maintaining a second hand-rolled diff renderer.

**검증 단계 보정**: The finding is essentially correct. Two small details: the file is 488 lines (not 489), and DiffViewer's memoization covers the comment-lookup map (commentsByLine via useMemo), not row building — SplitHunk's row array is rebuilt unmemoized each render. The core claims (three concerns colocated, PrFileDiff near-duplicating DiffViewer's unified-row rendering, SubmitReviewDialog embedding a multi-step GitHub submission workflow, and PrFileDiff being unmemoized) all hold as written.

### [LOW/react] PR file selection resets whenever the diff query key changes (transient empty diffs)

- **위치**: `src/views/PullRequestDetailView.tsx:68-76`
- **발견**: sweep:async-races

The selection effect treats an empty diff list as 'clear selection': `if (!diffs.length) { setSelectedPath(null); return; }`. diffsQuery's key includes `head: detail?.headSha`, so when the PR detail refetch returns a new headSha (e.g. the author pushed a commit while the reviewer reads — refetch is triggered by the 30s auto-fetch invalidating github queries), the query key changes, data for the new key is briefly `undefined`, `diffs` becomes EMPTY_DIFFS, selectedPath is nulled, and once the new diff arrives the effect selects `diffs[0].filePath` — discarding the file the reviewer was reading mid-review.

**권장 수정**: Use `placeholderData: keepPreviousData` on useAllDiffQuery (or skip the reset while `diffsQuery.isPending`), and only fall back to `diffs[0]` when the previously selected path is confirmed absent from a successfully loaded diff list.

### [LOW/bug] RepositoryPicker swallows IPC errors in load/loadAuth/remove

- **위치**: `src/views/RepositoryPicker.tsx:17-28, 64-67`
- **발견**: react-views-b

`const load = async () => { const list = await api.recentRepos(); setRecent(list); };` and `loadAuth`/`remove` have no try/catch, and are invoked as `void load(); void loadAuth();` in the mount effect (lines 25-28) and `void remove(r.id)` (line 109). If any of these IPC calls reject (e.g. the better-sqlite3 store fails), the promise rejection is unhandled: the picker silently shows "No recent repositories yet.", the GitHub button silently shows "Sign in" for an authed user, and a failed remove leaves the row in place with no feedback — while `open` and `pick` in the same file (lines 30-54) do catch and toast.

**권장 수정**: Wrap these calls in try/catch and surface failures via the existing `toast('error', ...)` helper, consistent with `open`/`pick`. Consider using useRecentReposQuery/useGithubAuthQuery from query/hooks.ts instead of local state, which also removes the manual reload bookkeeping.
