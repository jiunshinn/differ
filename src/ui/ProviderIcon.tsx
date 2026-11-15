import type { ComponentType } from 'react';
import { cn } from '../utils/cn';
import { ClaudeMark, CodexMark, CopilotMark, CursorMark, DevinMark, GeminiMark, GooseMark, OpencodeMark } from './brandMarks';

type Mark = ComponentType<{ size?: number; className?: string }>;

const marks: Record<string, Mark> = {
  claude: ClaudeMark,
  codex: CodexMark,
  cursor: CursorMark,
  devin: DevinMark,
  gemini: GeminiMark,
  copilot: CopilotMark,
  goose: GooseMark,
  opencode: OpencodeMark,
};

/**
 * Provider ids are whatever the install created ("claude-code", "codex-acp",
 * "gemini-cli"…), so normalise to a brand before looking up a mark.
 */
const aliases: Record<string, keyof typeof marks> = {
  claude: 'claude',
  'claude-code': 'claude',
  'claude-agent': 'claude',
  codex: 'codex',
  'codex-acp': 'codex',
  cursor: 'cursor',
  'cursor-agent': 'cursor',
  devin: 'devin',
  opencode: 'opencode',
  'opencode-v2': 'opencode',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  copilot: 'copilot',
  'copilot-cli': 'copilot',
  'github-copilot': 'copilot',
  goose: 'goose',
};

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function brandFor(id?: string | null, name?: string | null): Mark | null {
  for (const candidate of [id, name]) {
    if (!candidate) continue;
    const key = aliases[candidate.trim().toLowerCase()] ?? aliases[slug(candidate)];
    if (key) return marks[key];
  }
  return null;
}

export interface ProviderIconProps {
  /** Provider id, e.g. "claude-code" or "opencode". */
  id?: string | null;
  /** Fallback for matching and for the letter shown for unknown providers. */
  name?: string | null;
  size?: number;
  className?: string;
}

/**
 * The agent's own mark when we know it, otherwise a monogram tile. Renders in
 * the current text colour, so it works on both themes.
 */
export function ProviderIcon({ id, name, size = 16, className }: ProviderIconProps) {
  const Mark = brandFor(id, name);
  if (Mark) return <Mark size={size} className={className} />;
  const letter = (name ?? id ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={cn('grid place-items-center rounded-[5px] bg-bg-hover font-semibold text-text-muted shrink-0', className)}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.6)) }}
    >
      {letter}
    </span>
  );
}
