import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db';
import { getRepositoryById } from './repoStore';
import { getSession } from './sessionStore';
import { listCommentsByIds } from './commentStore';
import { getDiff } from './git';
import type {
  ContextBundle,
  ContextExtractionInput,
  ContextExtractionResult,
  DiffHunk,
  FileDiff,
  LineRangeRef,
  ReviewComment,
} from '../../shared/types';

export async function previewContext(input: ContextExtractionInput): Promise<ContextExtractionResult> {
  const session = getSession(input.sessionId);
  if (!session) throw new Error('Session not found');
  const repo = getRepositoryById(session.repository_id);
  if (!repo) throw new Error('Repository not found');

  const comments = listCommentsByIds(input.commentIds);

  // Collect file paths we need diffs for. Combine explicit file selections,
  // hunk file selections, and (for line/hunk comments) the comment's file path.
  const fileSet = new Set<string>();
  for (const fp of input.filePaths) fileSet.add(fp);
  for (const h of input.hunks) fileSet.add(h.filePath);
  for (const c of comments) {
    if (c.target_kind !== 'file') fileSet.add(c.file_path);
  }

  // Build a map of FileDiff per path.
  const fileDiffs = new Map<string, FileDiff>();
  for (const filePath of fileSet) {
    const merged = await collectFileDiff(repo.path, filePath, {
      isLocal: session.kind === 'local',
      base: session.base_sha,
      head: session.head_sha,
    });
    if (merged) fileDiffs.set(filePath, merged);
  }

  const markdown = renderMarkdown({
    task: input.task,
    testCommand: input.testCommand,
    includeRepoMetadata: input.includeRepoMetadata,
    includeFullFiles: input.includeFullFiles,
    repoName: repo.name,
    repoPath: repo.path,
    branch: session.branch,
    baseBranch: session.base_branch,
    prNumber: session.github_pr_number,
    comments,
    fileDiffs,
    selectedFiles: input.filePaths,
    selectedHunks: input.hunks,
    selectedLineRanges: input.lineRanges ?? [],
  });

  return { markdown };
}

async function collectFileDiff(
  repoPath: string,
  filePath: string,
  refs: { isLocal: boolean; base: string | null; head: string | null },
): Promise<FileDiff | null> {
  if (!refs.isLocal && refs.base && refs.head) {
    const prDiff = await getDiff(repoPath, {
      filePath,
      base: refs.base,
      head: refs.head,
      ignoreWhitespace: false,
    });
    if (prDiff[0]) return prDiff[0];
  }

  // Try unstaged + untracked first.
  const unstaged = await getDiff(repoPath, {
    filePath,
    includeUntracked: refs.isLocal,
    ignoreWhitespace: false,
  });
  if (unstaged[0]) return unstaged[0];
  // Try staged.
  const staged = await getDiff(repoPath, { filePath, staged: true, ignoreWhitespace: false });
  if (staged[0]) return staged[0];
  return null;
}

export function saveContext(sessionId: number, title: string, task: string, output: string, included: {
  comments: number[];
  files: string[];
  hunks: { filePath: string; hunkHeader: string }[];
  lineRanges?: LineRangeRef[];
}): ContextBundle {
  const db = getDb();
  // Embed line ranges inside the hunks JSON blob to avoid a schema migration,
  // keeping included_hunks_json as the single "diff-shaped selections" column.
  const hunksBlob = JSON.stringify({
    hunks: included.hunks,
    lineRanges: included.lineRanges ?? [],
  });
  const r = db
    .prepare(
      `INSERT INTO context_bundles
         (review_session_id, title, task, included_comments_json, included_files_json, included_hunks_json, output_markdown)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      title,
      task,
      JSON.stringify(included.comments),
      JSON.stringify(included.files),
      hunksBlob,
      output,
    );
  return db.prepare(`SELECT * FROM context_bundles WHERE id = ?`).get(r.lastInsertRowid) as ContextBundle;
}

interface RenderArgs {
  task: string;
  testCommand?: string;
  includeRepoMetadata: boolean;
  includeFullFiles: boolean;
  repoName: string;
  repoPath: string;
  branch: string | null;
  baseBranch: string | null;
  prNumber: number | null;
  comments: ReviewComment[];
  fileDiffs: Map<string, FileDiff>;
  selectedFiles: string[];
  selectedHunks: { filePath: string; hunkHeader: string }[];
  selectedLineRanges: LineRangeRef[];
}

function renderMarkdown(args: RenderArgs): string {
  const lines: string[] = [];

  lines.push('# Task');
  lines.push('');
  lines.push(args.task.trim() || '(No task description provided.)');
  lines.push('');

  if (args.includeRepoMetadata) {
    lines.push('# Repository');
    lines.push('');
    lines.push(`- Name: ${args.repoName}`);
    if (args.branch) lines.push(`- Branch: ${args.branch}`);
    if (args.baseBranch) lines.push(`- Base: ${args.baseBranch}`);
    if (args.prNumber !== null) lines.push(`- Pull Request: #${args.prNumber}`);
    lines.push('');
  }

  // Group comments by file
  if (args.comments.length) {
    lines.push('# Review Comments');
    lines.push('');
    const byFile = new Map<string, ReviewComment[]>();
    for (const c of args.comments) {
      const list = byFile.get(c.file_path) ?? [];
      list.push(c);
      byFile.set(c.file_path, list);
    }
    for (const [filePath, comments] of byFile) {
      lines.push(`## ${filePath}`);
      lines.push('');
      for (const c of comments) {
        const anchor = describeAnchor(c);
        const labelPart = c.label ? ` [${c.label}]` : '';
        lines.push(`- **${c.target_kind}${anchor}**${labelPart} (${c.status})`);
        lines.push('');
        // Quote body
        for (const bodyLine of c.body.split(/\r?\n/)) {
          lines.push(`  > ${bodyLine}`);
        }
        lines.push('');
        // Inline relevant diff snippet for line/hunk comments
        const file = args.fileDiffs.get(c.file_path);
        if (file) {
          const snippet = relevantDiffSnippetForComment(file, c);
          if (snippet) {
            lines.push('  Relevant diff:');
            lines.push('  ```diff');
            for (const l of snippet.split('\n')) lines.push(`  ${l}`);
            lines.push('  ```');
            lines.push('');
          }
        }
      }
    }
  }

  // Selected hunks
  const selectedHunksByFile = new Map<string, Set<string>>();
  for (const h of args.selectedHunks) {
    const set = selectedHunksByFile.get(h.filePath) ?? new Set();
    set.add(h.hunkHeader);
    selectedHunksByFile.set(h.filePath, set);
  }
  if (selectedHunksByFile.size) {
    lines.push('# Selected Hunks');
    lines.push('');
    for (const [filePath, headers] of selectedHunksByFile) {
      lines.push(`## ${filePath}`);
      lines.push('');
      const file = args.fileDiffs.get(filePath);
      if (!file) {
        lines.push('_No diff available._');
        lines.push('');
        continue;
      }
      for (const hunk of file.hunks) {
        if (!headers.has(hunk.header)) continue;
        lines.push('```diff');
        lines.push(serializeFileHunkForDisplay(file, hunk));
        lines.push('```');
        lines.push('');
      }
    }
  }

  // Selected files (full diff)
  if (args.selectedFiles.length) {
    lines.push('# Selected File Diffs');
    lines.push('');
    for (const filePath of args.selectedFiles) {
      const file = args.fileDiffs.get(filePath);
      lines.push(`## ${filePath}`);
      lines.push('');
      if (!file) {
        lines.push('_No diff available (file may be unchanged)._');
        lines.push('');
        continue;
      }
      if (file.isBinary) {
        lines.push('_Binary file changes; diff omitted._');
        lines.push('');
        continue;
      }
      lines.push('```diff');
      lines.push(serializeFileDiffForDisplay(file));
      lines.push('```');
      lines.push('');
    }
  }

  if (args.selectedLineRanges.length) {
    lines.push('# Selected Snippets');
    lines.push('');
    const byFile = new Map<string, LineRangeRef[]>();
    for (const r of args.selectedLineRanges) {
      const list = byFile.get(r.filePath) ?? [];
      list.push(r);
      byFile.set(r.filePath, list);
    }
    for (const [filePath, ranges] of byFile) {
      const fullPath = path.join(args.repoPath, filePath);
      let contents: string | null = null;
      try {
        contents = fs.readFileSync(fullPath, 'utf8');
      } catch {
        contents = null;
      }
      const ext = path.extname(filePath).replace('.', '');
      const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);
      for (const r of sorted) {
        lines.push(`## ${filePath}:${r.startLine}-${r.endLine}`);
        lines.push('');
        if (contents == null) {
          lines.push('_File not readable from working tree._');
          lines.push('');
          continue;
        }
        const allLines = contents.split('\n');
        const start = Math.max(1, r.startLine);
        const end = Math.min(allLines.length, r.endLine);
        const slice = allLines.slice(start - 1, end);
        const pad = String(end).length;
        const numbered = slice.map((l, i) => `${String(start + i).padStart(pad, ' ')}  ${l}`);
        lines.push('```' + ext);
        lines.push(numbered.join('\n'));
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (args.includeFullFiles && args.selectedFiles.length) {
    lines.push('# File Snippets');
    lines.push('');
    for (const filePath of args.selectedFiles) {
      const fullPath = path.join(args.repoPath, filePath);
      if (!fs.existsSync(fullPath)) continue;
      let contents = '';
      try {
        contents = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }
      const ext = path.extname(filePath).replace('.', '');
      lines.push(`## ${filePath}`);
      lines.push('');
      lines.push('```' + ext);
      lines.push(contents.trimEnd());
      lines.push('```');
      lines.push('');
    }
  }

  if (args.testCommand) {
    lines.push('# Expectations');
    lines.push('');
    lines.push('- Keep the change focused.');
    lines.push('- Preserve existing UI patterns.');
    lines.push(`- Run: ${args.testCommand}`);
    lines.push('');
  } else {
    lines.push('# Expectations');
    lines.push('');
    lines.push('- Keep the change focused.');
    lines.push('- Preserve existing UI patterns.');
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function describeAnchor(c: ReviewComment): string {
  if (c.target_kind === 'file') return '';
  if (c.target_kind === 'line') {
    if (c.line_number == null) return '';
    const side = c.diff_side === 'old' ? '-' : c.diff_side === 'new' ? '+' : '';
    return ` ${side}L${c.line_number}`;
  }
  if (c.target_kind === 'hunk' && c.hunk_header) return ` ${c.hunk_header}`;
  return '';
}

function relevantDiffSnippetForComment(file: FileDiff, c: ReviewComment): string | null {
  if (c.target_kind === 'file') return null;
  if (c.target_kind === 'hunk' && c.hunk_header) {
    const hunk = file.hunks.find((h) => h.header === c.hunk_header);
    if (!hunk) return null;
    return serializeFileHunkForDisplay(file, hunk);
  }
  if (c.target_kind === 'line' && c.line_number != null) {
    const targetSide = c.diff_side;
    const hunk = file.hunks.find((h) =>
      h.lines.some((l) =>
        targetSide === 'old'
          ? l.oldLineNumber === c.line_number
          : targetSide === 'new'
          ? l.newLineNumber === c.line_number
          : l.oldLineNumber === c.line_number || l.newLineNumber === c.line_number,
      ),
    );
    if (!hunk) return null;
    return serializeFileHunkForDisplay(file, hunk);
  }
  return null;
}

function serializeFileDiffForDisplay(file: FileDiff): string {
  const parts: string[] = [];
  parts.push(`diff --git a/${file.oldPath ?? file.filePath} b/${file.filePath}`);
  if (file.isNew) parts.push('new file');
  if (file.isDeleted) parts.push('deleted file');
  if (file.isRenamed && file.oldPath) {
    parts.push(`rename from ${file.oldPath}`);
    parts.push(`rename to ${file.filePath}`);
  }
  parts.push(`--- a/${file.oldPath ?? file.filePath}`);
  parts.push(`+++ b/${file.filePath}`);
  for (const h of file.hunks) parts.push(serializeHunk(h));
  return parts.join('\n');
}

function serializeFileHunkForDisplay(file: FileDiff, hunk: DiffHunk): string {
  return `--- a/${file.oldPath ?? file.filePath}\n+++ b/${file.filePath}\n${serializeHunk(hunk)}`;
}

function serializeHunk(hunk: DiffHunk): string {
  const out: string[] = [hunk.header];
  for (const l of hunk.lines) {
    if (l.kind === 'add') out.push(`+${l.content}`);
    else if (l.kind === 'del') out.push(`-${l.content}`);
    else if (l.kind === 'context') out.push(` ${l.content}`);
    else out.push(l.content);
  }
  return out.join('\n');
}
