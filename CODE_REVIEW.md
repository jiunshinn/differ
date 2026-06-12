# differ 전체 코드베이스 딥다이브 리뷰

- **일자**: 2026-06-11
- **방법**: 멀티에이전트 리뷰 — 도메인 리뷰어 9개(Electron 코어 / git 래퍼 / GitHub 서비스 / SQLite 스토어 / React 상태·쿼리 / 뷰 2팀 / 공용 컴포넌트 / 아키텍처) → 발견사항별 적대적 검증 에이전트 → 크로스커팅 2차 스윕(레이스 컨디션 · 리소스 누수 · 성능 핫패스). 총 154개 에이전트, 원시 발견 142건 중 **137건이 코드 재확인 검증을 통과**, 5건은 반박되어 제외.
- **정적 도구 베이스라인**: `tsc --noEmit`(렌더러/일렉트론 둘 다), `eslint --max-warnings=0` 모두 통과 — 즉 아래 항목들은 전부 도구가 못 잡는 종류의 문제.
- **전체 발견사항 상세**: [CODE_REVIEW_FINDINGS.md](./CODE_REVIEW_FINDINGS.md) (137건 전문, 영문)

---

## 총평

전반적으로 **구조 감각이 좋은 코드베이스**다. 프로세스 경계가 명확하고(`electron/` ↔ `src/` ↔ `shared/types.ts`), preload는 `contextBridge` + `ipcRenderer.invoke`만 쓰는 최소 표면이며, better-sqlite3 스토어가 도메인별 파일로 나뉘어 있고, zustand + TanStack Query 채택 방향도 옳다. 타입체크/린트가 깨끗한 것도 기본기가 잡혀 있다는 신호다.

다만 깊이 파고들면 네 가지 구조적 약점이 반복적으로 문제를 만든다:

1. **git 출력 파싱의 견고성 부족** — porcelain v2 / unified diff를 직접 파싱하는데, 유니코드 파일명·공백 경로·충돌 레코드·신규/삭제 파일 등 경계 케이스에서 연쇄적으로 깨진다 (high 버그 5건이 전부 `git.ts` 파서).
2. **`useApp()` 모놀리식 파사드** — 셀렉터 없는 zustand 구독 + 쿼리 옵저버 4개를 ~30개 컴포넌트가 통째로 물고 있어, 키 입력 하나에 거대한 diff 트리 전체가 재렌더링된다. 렌더러 성능 문제 대부분의 단일 근원.
3. **비동기 컨텍스트 검증 부재** — `refresh()`/뮤테이션 onSuccess가 "await 후에도 같은 repo/PR인가"를 확인하지 않아, 레포 전환 중 세션이 교차 오염되는 critical 데이터 무결성 버그로 이어진다.
4. **IPC 계약이 손으로 3중 유지** — `ipc.ts` / `preload.ts` / `src/api.ts`가 타입 연결 없이 주석으로만 동기화되고, 이미 드리프트가 존재한다.

긴급도 순서: **critical 2건(흰 화면 크래시, 세션 교차 오염)** → git 파서 버그군 → PR 리뷰 화면의 잘못된 diff(merge-base 미사용)와 라인 코멘트 미표시 → `useApp()` 분해.

---

## 1. Critical (2건)

### C1. ResizableLayout이 조건부 자식 때문에 throw → 앱 전체 흰 화면
`src/components/ResizableLayout.tsx:26-29`, 트리거: `src/views/CodeBrowserView.tsx:87-96`

`React.Children.toArray(children).length !== panes.length`이면 렌더 중 `throw`한다. CodeBrowserView가 ResizableLayout(panes 2개) 안에 `{composer && sessionId && selected && <CommentComposer/>}`를 세 번째 자식으로 직접 렌더하므로, **Code 뷰에서 파일을 선택하고 "Comment file"/"Comment lines"를 누르는 순간 자식이 3개가 되어 throw가 발생**한다. 앱에 ErrorBoundary가 하나도 없어 React 18이 루트 전체를 언마운트 — 흰 화면 + 미저장 상태 전부 소실.

**수정**: ① CommentComposer를 ResizableLayout 밖으로 (PullRequestDetailView처럼 프래그먼트로 감싸기) ② ResizableLayout은 panes 수만큼만 그리드 패널로 쓰고 초과 자식은 그리드 뒤에 렌더하도록 관용적으로 변경 ③ 뷰 컨테이너에 ErrorBoundary 추가.

### C2. 레포 전환 중 `refresh()`가 이전 레포의 리뷰 세션을 설치 — 교차 레포 데이터 오염
`src/state/AppStore.tsx:129-159`

`refresh()`가 시작 시점 스냅샷(`snapshot.repo.id`)으로 세션을 fetch하면서 null 체크는 **현재** 상태로 한다. 큰 레포 A의 status IPC가 도는 동안 사용자가 레포 B로 전환하면(`setRepo`가 session을 null로 초기화), 재개된 refresh(A)가 `session == null`을 보고 **A의 로컬 세션을 만들어 setSession** 해버린다. 이후 B에서 작성하는 모든 코멘트·viewed 파일 상태가 **A의 세션 행에 영구 기록**되고, 동시 실행된 refresh(B)는 세션이 이미 있다고 보고 건너뛴다. 다음 레포 전환 전까지 조용히 지속되는 데이터 무결성 버그.

**수정**: 모든 `await` 뒤에 `if (useAppStore.getState().repo?.id !== snapshot.repo.id) return;` 가드. 장기적으로는 세션을 zustand에 명령형으로 쓰지 말고 `useQuery(localSession(repoId))`로 파생.

---

## 2. High (중복 정리 후 19건)

### 버그 — git 파서/래퍼 (electron/services/git.ts)

| # | 위치 | 내용 |
|---|------|------|
| H1 | `git.ts:235-249` | **porcelain v2 unmerged('u') 레코드 off-by-one** — path가 인덱스 8인데 `rest.slice(9)` 사용. 머지/리베이스 충돌 파일 경로가 전부 빈 문자열이거나 잘림 → 충돌 목록·diff·스테이징 깨짐. `slice(8)`로 수정. |
| H2 | `git.ts:141-160` | **`--git-path` 상대경로를 Electron 프로세스 cwd 기준으로 `fs.existsSync`** — rebase/merge 진행 감지가 일반 레포에서 항상 false (dev에서는 differ 소스 트리 자체가 git 레포라 오탐도 가능). 충돌 해결 화면 라우팅이 조용히 죽어 있음. `path.resolve(cwd, p)` 또는 `--path-format=absolute`로 수정. |
| H3 | `git.ts:372-385 외` | **unified diff 파서가 따옴표 처리된(비ASCII)·공백 포함 경로를 못 다룸** — `core.quotepath` 기본값에서 한글 파일명은 8진 이스케이프로 출력되어 `diff --git a/(.+) b/(.+)` 정규식이 실패. 한글 파일명에서 diff 표시·헝크 스테이징 모두 깨짐. `-c core.quotepath=false` + `---`/`+++` 라인 기반 추출(또는 `diff --raw -z`)로 수정. |
| H4 | `git.ts:683-713` | **buildSingleHunkPatch가 신규/삭제 파일에 잘못된 패치 생성** — `/dev/null`·`new file mode` 헤더를 안 만들어 untracked 파일 헝크 스테이징은 항상 에러, 신규 add된 파일 unstage는 **빈 blob이 인덱스에 남는 잘못된 상태**를 만든다. isNew/isDeleted 분기 추가, 단일 헝크 신규 파일은 `git add --`/`git restore --staged --`로 폴백. |
| H5 | `git.ts:733-745` | **parseGithubFromRemote가 점 포함 레포명(next.js, socket.io) 거부** — `[^/.]+` 문자클래스 때문. 해당 레포는 GitHub 연동(PR/이슈/리뷰) 전체가 **에러 없이 조용히 꺼짐**. 점 허용 후 trailing `.git`만 strip. |

### 버그 — 스테이징/IPC

| # | 위치 | 내용 |
|---|------|------|
| H6 | `electron/ipc.ts:228-248` | **stage/unstage hunk가 renderer의 `ignoreWhitespace` 옵션 없이 diff를 재계산** — WS 토글이 켜진 상태(공백 변경 존재)에서 헝크 헤더 문자열이 어긋나 'Hunk not found' 에러. 옵션을 IPC로 전달하거나, 헤더 문자열 대신 헝크 자체(직렬화 패치)를 renderer가 보내도록 변경. |

### 버그 — PR 리뷰 화면 (앱의 핵심 기능)

| # | 위치 | 내용 |
|---|------|------|
| H7 | `src/views/PullRequestDetailView.tsx:43-50` | **PR diff를 merge-base가 아닌 base 브랜치 최신 팁과 비교** (`git diff base..head` 2-dot). base가 전진한 보통의 PR에서 **PR이 건드리지 않은 파일이 변경 목록에 나오고, 실제 파일엔 유령 삭제가 표시** — github.com과 다른 diff를 보여준다. `git merge-base` SHA를 base로 쓰거나 3-dot 의미론 적용. |
| H8 | `PullRequestDetailView.tsx:286-336` | **PR diff에서 작성한 라인 코멘트가 저장만 되고 표시되지 않음** — `target_kind === 'line'` 렌더 경로 자체가 없다. 사용자는 저장 실패로 오인해 중복 작성하게 됨. (UI가 더블클릭·`+` 버튼으로 라인 코멘트를 주력 홍보하면서 렌더링이 없는 상태.) |
| H9 | `PullRequestDetailView.tsx:237-340` | **diff 렌더러가 DiffViewer와 PrFileDiff 두 곳에 복제되어 이미 발산** — H8이 그 증거. DiffViewer의 UnifiedHunk/UnifiedRow/SplitHunk/SideCell + commentsByLine을 공용 컴포넌트(`src/components/diff/DiffHunks.tsx`)로 추출하면 H8도 함께 해결. |
| H10 | `src/views/PullRequestsView.tsx:49-60` | **PR을 한 번 열면 PR 세션이 Local/Code 뷰로 영구 누수** — 로컬 세션을 복원하는 코드가 없어, 이후 로컬 작업트리 코멘트·viewed 상태가 **PR 세션 행에 기록**되고 SubmitReviewDialog에 섞여 들어가 잘못된 위치로 GitHub에 게시될 수 있음. 뷰 전환 시 로컬 세션 재해석 또는 localSession/prSession 분리 보관. |

### 버그 — 데이터 신선도/GitHub API

| # | 위치 | 내용 |
|---|------|------|
| H11 | `src/state/AppStore.tsx:129-159` | **`refresh()`가 staleTime 5초를 존중하는 `fetchQuery` 사용** — pull/push/sync 직후 호출돼도 5초 내 캐시면 no-op. 동기화 결과가 최대 30초간 UI에 반영 안 됨. `staleTime: 0` 강제 또는 invalidate 후 await. branches/commits 무효화도 누락. |
| H12 | `electron/services/githubService.ts:343-361` | **listIssues가 1페이지(50개)만 가져온 뒤 PR을 필터링** — PR 많은 레포에서 이슈 목록이 몇 개로 쪼그라들거나 빈 목록. `client.paginate.iterator`로 N개 채울 때까지 루프 (listPullRequests에 이미 같은 패턴 있음). |

### 성능 — 렌더러

| # | 위치 | 내용 |
|---|------|------|
| H13 | `src/state/AppStore.tsx:105-119` | **`useApp()`이 셀렉터 없는 `useAppStore()` + 쿼리 옵저버 4개를 ~30개 호출처에 강제** — 파일 필터 키 입력·토스트 표시/해제·activity push마다 DiffViewer(수천 행)·ReviewPanel·TopBar 등 마운트된 전 컴포넌트 재렌더. `useAutoFetch`가 App 루트에서 호출해 루트까지 재렌더. **렌더러 성능 문제의 단일 최대 근원.** 좁은 셀렉터(`useAppStore(s => s.x)`) + 필요한 쿼리 훅만 호출하는 구조로 분해. |
| H14 | `src/components/DiffViewer.tsx:16, 59, 178-195` | **diff 행/헝크 컴포넌트가 전부 비메모이즈 + prop 정체성이 매 렌더 변경** (`comments.filter(...)` 새 배열, 헝크별 인라인 클로저). H13과 결합해 키 입력당 수천 행 reconciliation. React.memo + useMemo/useCallback + (대형 diff는) 가상화. |
| H15 | `src/components/CodeViewer.tsx:160-174` | **인라인 `basicSetup={{...}}` 객체가 매 렌더 CodeMirror 전체 재구성(reconfigure) 유발** — 선택 드래그 중 포인터 이동마다 발생, 대형 파일에서 체감 랙. 모듈 상수로 호이스팅 (line 91의 extensions 배열은 이미 메모이즈되어 있는데 이것만 누락). |
| H16 | `src/components/ChangedFilesPanel.tsx:56-77` | **Stage all / Unstage all이 파일당 순차 IPC + 전체 쿼리 무효화** — N개 파일에 N × (stage + git status + diff refetch)가 직렬 실행. 배치 IPC(`git add -- <paths...>`) 또는 루프 후 1회 무효화. |
| H17 | `electron/ipc.ts:293-303` | **PR 전체 diff를 라인당 객체 그래프 하나의 IPC 블롭으로 즉시 전송** — 10k+ 라인 PR이면 수십만 객체를 main이 structured-clone하고 renderer가 역직렬화(양쪽 블로킹). PR 뷰가 열려 있으면 30초 auto-fetch마다 재전송. 파일 목록만 싸게 가져오고(`git diff --name-status -z`) 헝크는 파일 선택 시 `diffFile`로 lazy 로드. |

### 보안 — Electron

| # | 위치 | 내용 |
|---|------|------|
| H18 | `electron/main.ts:27` | **`sandbox: false`** — preload는 contextBridge/ipcRenderer만 써서 샌드박스 비활성화가 불필요한데, 꺼진 상태에선 렌더러 침해(임의 클론 레포의 콘텐츠, GitHub API 데이터, 원격 Google Fonts CSS가 표시 표면) 시 곧장 사용자 권한 코드 실행으로 직결. **주의**: 검증 결과, 줄만 지우면 안 됨 — tsc로 컴파일된 비번들 preload가 런타임에 `require("../shared/types")`를 하는데 샌드박스 preload는 이를 로드할 수 없다. **preload를 단일 파일로 번들(esbuild/vite)하거나 IpcChannels 상수를 preload에 인라인한 뒤** sandbox를 켤 것. |
| H19 | `electron/main.ts:16-41` | **`setWindowOpenHandler` / `will-navigate` 가드 전무** — `window.open`/`target=_blank` 자식 창이 preload 브리지(+ 비활성 샌드박스)를 상속하고 메인 창이 어디로든 내비게이션 가능. 현재는 원격 콘텐츠를 안 띄우므로 심층 방어 결함(검증자는 medium 권고)이지만 표준 가드 2줄이면 닫힌다. IPC 레이어에서 `event.senderFrame` 검증도 권장. |

---

## 3. Medium (주제별 요약, 57건 중 중복 제외)

### Electron / 보안
- **GitHub 토큰이 safeStorage 불가 환경에서 평문 SQLite 저장, 고지 없음** — `accountStore.ts:36-57`, `githubService.ts:43-48`. 최소한 사용자 고지 + 평문 폴백 거부 옵션.
- **`shell.openExternal`에 renderer가 준 URL을 프로토콜 검증 없이 전달** — `ipc.ts:451-454`. `http(s):` 화이트리스트 필요.
- **IPC 핸들러 래퍼가 renderer 인자를 무검증 캐스팅** — `ipc.ts:92-94`. 채널별 최소 런타임 검증(타입·범위) 권장.
- **dotenv가 `process.cwd()`의 `.env`를 로드** — `main.ts:4-7`. git 리뷰 도구 특성상 미신뢰 클론 레포 안에서 터미널 실행이 현실적 시나리오인데, 그 레포에 커밋된 `.env`가 환경변수(로드 URL 포함)를 주입 가능. packaged 빌드에선 `process.resourcesPath` 기준으로만 로드.
- **`clone()`이 OAuth 토큰을 git 커맨드라인 인자로 전달** — `git.ts:89-93`. `ps`로 다른 로컬 프로세스에 노출. `-c credential.helper` + stdin 또는 `GIT_ASKPASS` 사용.
- **`safeJoin`이 어휘적 검사만 수행** — `fileTree.ts:28-37`. 레포 내부 심볼릭 링크가 레포 밖(`/etc/passwd` 등)을 가리키면 readFile이 따라감. `fs.realpath` 검증 추가.
- **revision 인자에 `--end-of-options` 미사용, 일부 checkout에 `--` 미사용** — `git.ts:490-496, 659-661`. 브랜치명이 옵션처럼 해석될 여지.

### git.ts 견고성
- **mutating git 명령의 레포별 직렬화 없음** — 동시 작업 시 `index.lock` 충돌 + 읽고-적용하는 헝크 스테이징의 read-then-apply 레이스 (`git.ts:37-70, 591-614`). 레포별 작업 큐 권장.
- **stdout을 64KB 청크 단위로 디코드** — 청크 경계에 걸린 멀티바이트 UTF-8이 U+FFFD로 손상 (`git.ts:49-56`). Buffer 누적 후 일괄 디코드 또는 `TextDecoder({stream:true})`.
- **`git restore`에 `allowNonZeroCodes: [1]`** — 진짜 실패도 exit 1이라 unstage/discard 실패가 조용히 무시됨 (`git.ts:596-603`).
- **diff 무한 메모리** — untracked 파일 전체 읽기 + diff 전체 구체화에 크기 상한 없음 (`git.ts:509-561`).
- **파일 하나 diff에도 레포 전체 `git status --untracked-files=all` 스캔** (`git.ts:509-523`).
- **종료 시 git 자식 프로세스 미정리** (`git.ts:37-48`).

### GitHub 서비스
- **`submitReview`가 `commit_id` 누락** — PR head가 이동했으면 코멘트가 엉뚱한 라인에 앵커링 (`githubService.ts:408-430`).
- **checkRuns 50개 상한, 페이지네이션 없음** (`389-406`) / **listAllRepos가 계정별 에러 전부 무시** — 인증 만료·rate limit 시 레포가 조용히 사라짐 (`475-491`) / **복호화 불가 토큰 계정이 UI에서 무단 증발** (`50-59, 97-110`) / **OAuth: `/user` 프로브 실패 시 발급된 토큰 폐기** (`githubOAuth.ts:144-152`).
- **ghPrCheckout이 ref 단위 fetch 후 renderer는 live headSha로 diff** — 리뷰 중 PR이 업데이트되면 diff가 깨짐 (`ipc.ts:399-409`).

### 데이터베이스
- **스키마 버전/마이그레이션 프레임워크 부재** — 비가산적 스키마 변경 불가능 (`db.ts:32-127`). `PRAGMA user_version` 기반 마이그레이션 도입.
- **손상 DB 시 기동 자체가 무처리 abort** (`db.ts:8-18`).

### React — 정확성
- **Cmd+Enter가 isPending/busy 가드 우회** — 코멘트 중복 게시(`CommentComposer.tsx:86-88`), 동시 중복 커밋(`CommitBar.tsx:63-65`).
- **unified 모드에서 컨텍스트 라인 old-side 코멘트 증발** (`DiffViewer.tsx:379-391`).
- **diff 로드 에러가 영구 "Loading diff…"로 표시** (`DiffViewer.tsx:38-45`).
- **SQLite UTC 타임스탬프를 로컬 시간으로 파싱** — 서울 기준 코멘트 시각이 9시간 과거로 표시 (`DiffViewer.tsx:600-607`, `PullRequestDetailView.tsx:321,333`). 공용 `parseDbDate` 유틸로 `'T'+...+'Z'` 정규화.
- **레포 전환에 in-flight 가드 없음** — 느린 openRepo 응답이 마지막 클릭을 이김 (`ProjectSidebar.tsx:60-92`); **PR checkout onSuccess가 레포 전환 후 stale PR로 내비게이션** (`PullRequestsView.tsx:49-60`).
- **리뷰 제출이 비원자적** — 재시도 시 GitHub 리뷰 중복 게시 가능 (`PullRequestDetailView.tsx:380-406`).
- **Sync 화면에서 upstream 없는 브랜치 push 불가** — setUpstream 폴백이 데드 코드 (`HistoryView.tsx:525-544`).
- **머지 충돌 해결(Resolve) 탭이 동작하는 척하는 플레이스홀더** (`HistoryView.tsx:276-427`) — 동작 안 하는 UI는 숨기거나 "준비 중" 명시.
- **useAutoFetch 쿨다운 ref가 레포 전환을 넘어 유지** — 새 레포 초기 fetch 스킵 (`useAutoFetch.ts:16-33`).
- **다크 테마가 JS 번들 실행 후 적용** — 매 기동 라이트 테마 플래시. `index.html` 인라인 스크립트로 선적용 (`theme.ts:40-58`).
- **lazy 뷰에 ErrorBoundary 없음** (`App.tsx:26-34`) — C1과 결합 시 치명.

### React — 성능
- **30초 auto-fetch가 fetch 결과와 무관하게 repo+diff+GitHub 쿼리 전부 무효화** — 유휴 앱이 주기적 CPU/IPC/rate-limit 소모원 (`AppStore.tsx:200-210`). 원격 팁 변동 감지 후 선별 무효화.
- **j/k 풀스크린 내비게이션이 키당 ~5 IPC + SQLite 쓰기, 키 반복 코얼레싱 없음** — 스쳐 지나간 파일이 전부 'viewed'로 영구 마킹 (`LocalChangesView.tsx:36-55`). dwell 타이머(500ms) 후 viewed 마킹.
- **diff 쿼리의 구조적 공유(replaceEqualDeep)가 매 refetch마다 수십만 노드 동기 deep-walk** (`hooks.ts:148-200`). **주의(검증 보정)**: `structuralSharing: false`는 오히려 퇴행 — useApp의 메모이제이션이 데이터 정체성에 의존하므로, 콘텐츠 해시 비교 후 이전 참조를 반환하는 **커스텀 structuralSharing 함수**가 올바른 수정.
- **FileTree가 노드(파일 포함)마다 쿼리 옵저버 생성 + 선택 시 트리 전체 재렌더** (`FileTree.tsx:31-36`).
- **CodeMirror selection 리스너가 selection 틱마다 부모 상태 갱신 → CodeBrowser 뷰 전체 재렌더** (`CodeViewer.tsx:103-113`).
- **드래그 중 매 pointermove마다 localStorage 동기 기록** (`ResizableLayout.tsx:47-53`); 드래그 리스너에 pointer capture/pointercancel/unmount cleanup 없음 (`55-91`).
- **SplitHunk가 매 렌더 행 페어링 재계산 + 코멘트 맵 메모 상시 무효화** (`DiffViewer.tsx:433-464`); **InlineCommentRow가 코멘트 행마다 풀 useApp 훅 인스턴스화** (`556-558`).

### 아키텍처 / 모듈화
- **IPC 계약 3중 수동 유지(ipc.ts / preload.ts / api.ts)** — preload의 `DifferApi` export는 사용처 없는 데드 코드이고 renderer가 손으로 재타이핑, 이미 드리프트 존재 (`api.ts:35-141`). preload 타입을 단일 진실원으로 renderer가 import하는 구조로.
- **`ipc.ts`가 7개 도메인 + 인라인 비즈니스 로직이 섞인 503줄 단일 등록기** — 도메인별 파일로 분리.
- **레거시 dispatch 파사드와 zustand 직접 setter의 이중 쓰기 API 공존** — 쿼리 캐시 부수효과가 서로 다름 (`AppStore.tsx:101-103, 212-297`). `dispatch('setStatus', null)`이 조용한 no-op인데 호출부는 의도를 갖고 호출 중 (`226-230`).
- **HistoryView 628줄에 무관한 화면 3개 동거** — History/Sync/Resolve 분리, SubmitReviewDialog·SyncButton 별도 모듈로 (`HistoryView.tsx`). PullRequestDetailView도 뷰 셸+diff 렌더러+제출 다이얼로그 혼합 (489줄).
- **`deriveCloneFolderName`이 main/renderer에 글자 그대로 중복** (`CloneFromUrlDialog.tsx:18-23` ↔ `ipc.ts:496-503`) — shared로 이동.
- **하드코딩 SKIP_DIRS가 정당하게 추적되는 디렉터리(dist 등)를 파일 트리에서 숨김** — git ls-files 기반 필터가 정석 (`fileTree.ts:5-19`).
- **접근성**: 변경 파일 행이 클릭 가능한 div(키보드 접근 불가, `ChangedFilesPanel.tsx:117-126`), BranchMenu 입력이 Radix typeahead에 포커스 강탈(`BranchMenu.tsx:93-108`, high로 분류됨 — Escape 보정은 `onEscapeKeyDown` 필요).

---

## 4. Low (57건 — 패턴별 묶음)

**에러 핸들링 누락(가장 흔한 패턴, 10여 건)**: `app.whenReady()` 체인 무처리(`main.ts:44-52`), RepositoryPicker·GithubAuthDialog·RepoBrowserDialog의 IPC 에러 silent 무시, DiffViewer.toggleReviewed unhandled rejection, IPC 에러의 'Error invoking remote method' 프리픽스 노출, push 재시도 시 friendlyGitError 우회.

**데드 코드/계약 드리프트**: `applyHunkPatch`/`getHeadSha`/`getMergeBase`/`listCommentsByIds`(AI 컨텍스트 빌더 제거 잔재), `appSelectors`(zustand v5에서 무한 재렌더 footgun이기도 함)/`readStatusFiles`/`readCurrentSession`, 미등록 IPC 채널 `fileStateGet`, preload `DifferApi` 타입. **근본 원인**: ESLint와 tsconfig 둘 다 unused-symbol 검출을 꺼둠(`eslint.config.mjs:17-35`) — `noUnusedLocals` 또는 `@typescript-eslint/no-unused-vars` 활성화 권장.

**중복 구현**: 날짜 포맷팅 4회(출력 불일치), check-run 상태 분류 3회, push 'no upstream' 폴백 2회(매칭 로직 상이) — 각각 공용 유틸로.

**Electron 운영 결함**: 단일 인스턴스 락 없음(SQLite 공유 위험), CSP 부재 + index.html의 원격 Google Fonts, 종료 시 DB 이중 close 경로, git 호출 타임아웃 전무(네트워크 작업 무한 행), OAuth `device_code`를 renderer에 불필요 전달, `slow_down` 인터벌 미적용.

**DB 소소**: 모든 호출마다 prepared statement 재생성, sort_order 시딩이 트랜잭션 밖 행 단위, `github_account_id` FK 부재, 초 단위 created_at의 비결정적 정렬.

**React/UX 소소**: setRepo가 fileFilter/diffStaged/패널 탭을 리셋 안 해 레포 간 누수, 디렉터리 접기 시 하위 확장 상태 소실, Toast 단일 슬롯이 배치 작업 메시지 드롭 + ARIA 부재, Dialog.Description 부재(Radix 경고), 풀스크린 키 핸들러와 코멘트 다이얼로그 충돌(Escape 이중 동작), IssuesView 에러 토스트가 refetch마다 재발화, PR 파일 선택이 쿼리 키 변경마다 리셋, 트렁케이트된 파일 읽기가 bytesRead 무시(NUL 패딩), 심볼릭 링크가 트리에서 일괄 누락, getCommits가 빈 레포에서 throw, runtime 의존성의 dependencies/devDependencies 혼재, snake_case DB 행 형태가 IPC 계약으로 누출(`pinned`가 0/1 숫자) 등.

전체 목록과 각 항목의 상세 근거·수정안은 [CODE_REVIEW_FINDINGS.md](./CODE_REVIEW_FINDINGS.md) 참조.

---

## 5. 영역별 평가

### React 권장 방식 준수도: **중하**
- **좋은 점**: TanStack Query 5 채택과 쿼리 키 팩토리(`query/keys.ts`) 구조는 정석. PullRequestsView/IssuesView처럼 좁은 셀렉터를 쓰는 컴포넌트도 일부 존재. lazy 뷰 분할.
- **핵심 문제**: `useApp()` 파사드가 zustand의 존재 이유(셀렉터 기반 구독)를 무효화. 레거시 Context 시절 reducer dispatch가 zustand 위 심(shim)으로 남아 이중 쓰기 경로 형성. 메모이제이션 부재가 diff 뷰(앱의 핵심 화면)에 집중. ErrorBoundary 0개.
- **방향**: ① `useApp()` 해체(셀렉터 + 개별 쿼리 훅) ② dispatch 심 제거 ③ diff 행 memo + 콜백 안정화 ④ ErrorBoundary 도입 — 이 4개가 React 측 개선의 80%.

### Electron 권장 방식 준수도: **중**
- **좋은 점**: `contextIsolation: true`, `nodeIntegration: false`, invoke 기반 IPC, 최소 preload 표면, main 프로세스 서비스 분리는 모두 권장 패턴.
- **핵심 문제**: `sandbox: false`(불필요), 내비게이션/창 생성 가드 전무, CSP 부재, IPC 입력 무검증, 단일 인스턴스 락 없음 — Electron 공식 보안 체크리스트의 상위 항목들이 비어 있다. better-sqlite3 동기 호출과 대형 IPC 블롭이 main 프로세스를 블로킹하는 설계도 주의.
- **방향**: preload 번들링 → sandbox 활성화 → 가드 2종 + CSP → IPC 검증 레이어. 순서대로 하면 충돌 없음.

### 모듈화/코드 구조: **중상**
- **좋은 점**: 프로세스/도메인 경계가 명확, 서비스·스토어 단위 분리가 잘 되어 있고 네이밍도 대체로 일관적. shared/types.ts로 계약을 모으려는 의도가 보임.
- **핵심 문제**: ① IPC 계약 3중 수동 유지(가장 시급) ② diff 렌더러 복제·발산 ③ 600줄급 다중 화면 컴포넌트(HistoryView, PullRequestDetailView) ④ 'Store' 접미사가 zustand 스토어/SQLite 스토어/Context 심 세 가지 의미로 혼용 ⑤ unused 검출이 꺼져 있어 데드 코드 축적.

---

## 6. 우선순위 권고 (작업 순서 제안)

| 순위 | 작업 | 해결되는 항목 |
|---|---|---|
| 1 | CommentComposer를 ResizableLayout 밖으로 + ErrorBoundary 추가 | C1 (즉시 크래시) |
| 2 | `refresh()` 등 비동기 후 repo-id 가드 + PR/로컬 세션 분리 | C2, H10, 레포 전환 race 일군 |
| 3 | `git.ts` 파서 수정 5종 + 유닛 테스트(porcelain v2·유니코드·신규/삭제 파일 픽스처) | H1–H5 |
| 4 | stage/unstage hunk에 diff 옵션 전달 | H6 |
| 5 | PR diff merge-base 적용 + diff 렌더러 공용화(라인 코멘트 표시 동시 해결) | H7–H9 |
| 6 | `useApp()` 해체 → 셀렉터/개별 훅 + DiffViewer memo | H13–H14, medium 성능 다수 |
| 7 | preload 번들 → `sandbox: true` + 내비게이션 가드 + openExternal 검증 + CSP | H18–H19, 보안 medium |
| 8 | IPC 계약 단일화(preload 타입을 renderer가 import) + `ipc.ts` 도메인 분할 | 아키텍처 medium |
| 9 | refresh staleTime 0 / auto-fetch 선별 무효화 / Stage-all 배치 IPC | H11, H16, H17 |
| 10 | unused 검출 활성화 + 데드 코드 일괄 제거, 날짜·check-run 유틸 공용화 | low 다수 |

유닛 테스트가 전무한 점도 짚어둔다. 특히 `git.ts`의 파서들(parsePorcelainV2, parseUnifiedDiff, buildSingleHunkPatch)은 순수 함수라 테스트 비용이 낮고, 이번에 발견된 high 버그 5건이 모두 여기 몰려 있다 — 픽스처 기반 테스트 도입의 ROI가 가장 높은 지점이다.
