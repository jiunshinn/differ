import React, { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';
import type { LanguageName } from '@uiw/codemirror-extensions-langs';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { EditorView } from '@codemirror/view';
import { api } from '../api';
import { useTheme } from '../utils/theme';
import type { FileContent } from '@shared/types';

interface Props {
  repoId: number;
  filePath: string | null;
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

export default function CodeViewer({ repoId, filePath }: Props) {
  const { isDark } = useTheme();
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api
      .readFile(repoId, filePath)
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setErr(e.message);
          setContent(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, filePath]);

  const extensions = useMemo(() => {
    const exts = [EditorView.lineWrapping];
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
          basicSetup={{
            lineNumbers: true,
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
          }}
          style={{ fontSize: 13 }}
        />
      </div>
    </div>
  );
}
