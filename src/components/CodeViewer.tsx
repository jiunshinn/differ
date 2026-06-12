import React, { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { BasicSetupOptions } from '@uiw/react-codemirror';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';
import type { LanguageName } from '@uiw/codemirror-extensions-langs';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { EditorView, lineNumbers } from '@codemirror/view';
import { useFileContentQuery } from '../query/hooks';
import { useTheme } from '../utils/theme';

// Hoisted to module scope so the object identity is stable across renders.
// @uiw/react-codemirror includes the basicSetup prop in the deps of its
// reconfigure effect, so a fresh literal each render would fully rebuild the
// editor (extensions, highlighting, fold gutter) on every re-render.
const BASIC_SETUP: BasicSetupOptions = {
  // Our custom lineNumbers extension below handles clicks; disable the
  // default to avoid two gutters.
  lineNumbers: false,
  foldGutter: true,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  highlightSelectionMatches: false,
  searchKeymap: true,
  autocompletion: false,
  closeBrackets: false,
  bracketMatching: true,
  indentOnInput: false,
  allowMultipleSelections: false,
};

const EDITOR_STYLE: React.CSSProperties = { fontSize: 13 };

interface Props {
  repoId: number;
  filePath: string | null;
  onAddLineComment?: (line: number) => void;
  onSelectionChange?: (range: { startLine: number; endLine: number } | null) => void;
}

const EXT_TO_LANG: Record<string, LanguageName> = {
  ts: 'ts',
  tsx: 'tsx',
  cts: 'cts',
  mts: 'mts',
  js: 'js',
  jsx: 'jsx',
  mjs: 'mjs',
  cjs: 'cjs',
  json: 'json',
  md: 'md',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  html: 'html',
  htm: 'htm',
  xml: 'xml',
  svg: 'svg',
  yml: 'yml',
  yaml: 'yaml',
  toml: 'toml',
  py: 'py',
  rb: 'rb',
  go: 'go',
  rs: 'rs',
  java: 'java',
  kt: 'kt',
  kts: 'kts',
  swift: 'swift',
  c: 'c',
  h: 'h',
  cc: 'cc',
  cpp: 'cpp',
  hpp: 'hpp',
  cs: 'cs',
  php: 'php',
  sh: 'sh',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  vue: 'vue',
  svelte: 'svelte',
  gradle: 'gradle',
  groovy: 'groovy',
  lua: 'lua',
  dart: 'dart',
};

function detectLanguage(path: string): LanguageName | null {
  const base = path.split('/').pop() ?? '';
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  return EXT_TO_LANG[ext] ?? null;
}

export default function CodeViewer({ repoId, filePath, onAddLineComment, onSelectionChange }: Props) {
  const { isDark } = useTheme();
  const contentQuery = useFileContentQuery(repoId, filePath);
  const content = contentQuery.data ?? null;
  const loading = contentQuery.isFetching;
  const err = contentQuery.error instanceof Error ? contentQuery.error.message : null;
  // Keep latest callbacks in refs so the CodeMirror extensions, which are
  // rebuilt only when the file changes, always invoke the current handlers.
  const addCommentRef = useRef(onAddLineComment);
  const selectionRef = useRef(onSelectionChange);
  addCommentRef.current = onAddLineComment;
  selectionRef.current = onSelectionChange;
  // Remember the last reported line range so we only push to the parent when it
  // actually changes — selection drags fire a tick per pointer move, and many
  // of those keep the same start/end line (e.g. selecting within one line).
  const lastRangeRef = useRef<{ startLine: number; endLine: number } | null>(null);

  // Clear any leftover selection when switching files.
  useEffect(() => {
    lastRangeRef.current = null;
    selectionRef.current?.(null);
  }, [filePath]);

  const extensions = useMemo(() => {
    const exts = [
      EditorView.lineWrapping,
      lineNumbers({
        domEventHandlers: {
          click(view, line) {
            const lineNo = view.state.doc.lineAt(line.from).number;
            addCommentRef.current?.(lineNo);
            return true;
          },
        },
      }),
      EditorView.updateListener.of((u) => {
        if (!u.selectionSet) return;
        const sel = u.state.selection.main;
        if (sel.empty) {
          if (lastRangeRef.current !== null) {
            lastRangeRef.current = null;
            selectionRef.current?.(null);
          }
          return;
        }
        const startLine = u.state.doc.lineAt(sel.from).number;
        const endLine = u.state.doc.lineAt(sel.to).number;
        const prev = lastRangeRef.current;
        if (prev && prev.startLine === startLine && prev.endLine === endLine) return;
        lastRangeRef.current = { startLine, endLine };
        selectionRef.current?.({ startLine, endLine });
      }),
    ];
    if (filePath) {
      const lang = detectLanguage(filePath);
      const langExt = lang ? loadLanguage(lang) : null;
      if (langExt) exts.push(langExt);
    }
    return exts;
  }, [filePath]);

  if (!filePath) {
    return (
      <div className="h-full grid place-items-center text-sm text-text-muted">
        Select a file to view.
      </div>
    );
  }
  if (loading && !content) {
    return <div className="p-4 text-sm text-text-muted">Loading…</div>;
  }
  if (err) {
    return <div className="p-4 text-sm text-danger">{err}</div>;
  }
  if (!content) return null;

  if (content.isBinary) {
    return (
      <div className="p-6 text-sm text-text-muted">
        Binary file ({content.size.toLocaleString()} bytes) — not displayed.
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {content.truncated && (
        <div className="text-xs text-warn bg-warn/10 px-3 py-1.5 border-b border-border">
          File is large — showing first 2MB.
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <CodeMirror
          value={content.text ?? ''}
          theme={isDark ? githubDark : githubLight}
          readOnly
          editable={false}
          extensions={extensions}
          basicSetup={BASIC_SETUP}
          style={EDITOR_STYLE}
        />
      </div>
    </div>
  );
}
