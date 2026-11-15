import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUp,
  AtSign,
  Bot,
  Clock,
  Database,
  FileDiff,
  FilePen,
  FilePlus,
  FlaskConical,
  GitBranch,
  GitCompare,
  GitPullRequest,
  Globe,
  MessageSquare,
  PanelLeft,
  Plug,
  Plus,
  Search,
  Server,
  Settings,
  ShieldAlert,
  Square,
  SquarePen,
  SquareTerminal,
  Terminal,
  Workflow,
} from 'lucide-react';
import { useTheme } from '../utils/theme';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FloatingSurface,
  IconButton,
  Input,
  Kbd,
  MenuList,
  MenuRow,
  MenuSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressRing,
  Segmented,
  Spinner,
  StatusDot,
  Tag,
  Textarea,
  type AgentStatus,
} from '../ui';

const colorGroups: { title: string; tokens: [string, string][] }[] = [
  {
    title: 'Surfaces',
    tokens: [
      ['bg', 'color-bg'],
      ['bg-panel', 'color-bg-panel'],
      ['bg-raised', 'color-bg-raised'],
      ['bg-hover', 'color-bg-hover'],
    ],
  },
  {
    title: 'Borders',
    tokens: [
      ['border-subtle', 'color-border-subtle'],
      ['border', 'color-border'],
      ['border-strong', 'color-border-strong'],
    ],
  },
  {
    title: 'Text',
    tokens: [
      ['text-primary', 'color-text-primary'],
      ['text-secondary', 'color-text-secondary'],
      ['text-muted', 'color-text-muted'],
      ['text-faint', 'color-text-faint'],
    ],
  },
  {
    title: 'Accent & meaning',
    tokens: [
      ['accent', 'color-accent'],
      ['warn · needs you', 'color-warn'],
      ['success · added', 'color-success'],
      ['danger · removed', 'color-danger'],
      ['info · subagents', 'color-info'],
    ],
  },
];

const typeScale: [string, string, string][] = [
  ['3xl', 'text-3xl font-semibold', '28 / 34 · page title'],
  ['2xl', 'text-2xl font-semibold', '20 / 28 · section title'],
  ['xl', 'text-xl font-semibold', '17 / 24 · dialog title'],
  ['lg', 'text-lg font-medium', '15 / 22 · card title'],
  ['base', 'text-base', '13.5 / 20 · body'],
  ['sm', 'text-sm', '12.5 / 18 · secondary'],
  ['xs', 'text-xs', '11.5 / 16 · meta, badges'],
  ['2xs', 'text-2xs font-mono', '10.5 / 14 · kbd, counts'],
];

const icons = [
  ['Threads', MessageSquare],
  ['Review', GitCompare],
  ['Terminal', SquareTerminal],
  ['Automations', Clock],
  ['Hosts', Server],
  ['Agents', Bot],
  ['Branch', GitBranch],
  ['MCP', Plug],
  ['Subagents', Workflow],
  ['Edit', FilePen],
  ['Create', FilePlus],
  ['Changes', FileDiff],
  ['Approval', ShieldAlert],
  ['Search', Search],
  ['New', SquarePen],
  ['Settings', Settings],
] as const;

function readToken(name: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const [r, g, b] = v.split(/\s+/).map(Number);
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        {note && <p className="text-text-secondary mt-1 max-w-[680px]">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-4">
      <span className="text-sm text-text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export default function DesignSystemPage() {
  const { isDark, setMode } = useTheme();
  const [hex, setHex] = useState<Record<string, string>>({});
  const [view, setView] = useState<'conversation' | 'review' | 'terminal'>('conversation');

  useEffect(() => {
    const next: Record<string, string> = {};
    colorGroups.forEach((g) => g.tokens.forEach(([, t]) => (next[t] = readToken(t))));
    setHex(next);
  }, [isDark]);

  return (
    <div className="h-full overflow-auto bg-bg text-text-primary select-text">
      <div className="max-w-[1120px] mx-auto px-10 pt-14 pb-24 flex flex-col gap-14">
        <header className="flex items-end gap-6">
          <div>
            <h1 className="text-3xl font-semibold">differ design system</h1>
            <p className="text-text-secondary mt-1.5">
              Dusk palette · Geist + Geist Mono · Pretendard for Korean · Lucide icons. Source: <code className="font-mono text-sm">src/styles/tokens.css</code>, <code className="font-mono text-sm">src/ui/</code>
            </p>
          </div>
          <Segmented
            className="ml-auto"
            aria-label="Theme"
            value={isDark ? 'dark' : 'light'}
            onChange={(v) => setMode(v)}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </header>

        <Section title="Colour" note="Neutrals carry the interface. Colour only means something: amber needs you, green is added or passed, red is removed or failed, blue is subagent activity.">
          <div className="grid grid-cols-4 gap-6">
            {colorGroups.map((g) => (
              <div key={g.title} className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">{g.title}</div>
                {g.tokens.map(([name, token]) => (
                  <div key={token} className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg border border-border-strong shrink-0" style={{ background: `rgb(var(--${token}))` }} />
                    <span className="leading-tight">
                      <span className="block text-sm font-medium">{name}</span>
                      <span className="block font-mono text-2xs text-text-muted">{hex[token]}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography" note="Geist for interface text, Geist Mono for code, paths, numbers and shortcuts. Korean falls back to Pretendard in both.">
          <Card className="divide-y divide-border">
            {typeScale.map(([name, cls, meta]) => (
              <div key={name} className="grid grid-cols-[80px_1fr_220px] items-baseline gap-4 px-5 py-3">
                <span className="font-mono text-xs text-text-muted">{name}</span>
                <span className={cls}>Implement ACP client handlers</span>
                <span className="font-mono text-xs text-text-muted text-right">{meta}</span>
              </div>
            ))}
          </Card>
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4 flex flex-col gap-1">
              <span className="text-xs text-text-muted">Sans · Geist</span>
              <span className="text-xl">Aa Bb Gg 0123 → ✓</span>
            </Card>
            <Card className="p-4 flex flex-col gap-1">
              <span className="text-xs text-text-muted">Mono · Geist Mono</span>
              <span className="font-mono text-md">Il1| O0o {'{}'} =&gt; !== +118 −6</span>
            </Card>
            <Card className="p-4 flex flex-col gap-1">
              <span className="text-xs text-text-muted">Korean · Pretendard</span>
              <span className="text-xl">워크트리 밖의 파일 쓰기를 허용할까요?</span>
            </Card>
          </div>
        </Section>

        <Section title="Icons" note="Lucide at 16px, 1.75 stroke. 14px inside small controls, 15px in buttons.">
          <Card className="grid grid-cols-8">
            {icons.map(([name, Icon]) => (
              <div key={name} className="flex flex-col items-center gap-2 py-4 text-text-secondary">
                <Icon size={16} strokeWidth={1.75} />
                <span className="text-xs text-text-muted">{name}</span>
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-col gap-3">
            <Row label="Variants">
              <Button variant="primary">Allow once</Button>
              <Button>Always allow</Button>
              <Button variant="ghost">Reject</Button>
              <Button variant="danger" icon={Square}>
                Stop agent
              </Button>
            </Row>
            <Row label="Sizes">
              <Button size="sm">Small · 28</Button>
              <Button size="md">Medium · 32</Button>
              <Button size="lg">Large · 36</Button>
            </Row>
            <Row label="Icon, shortcut">
              <Button icon={SquarePen} kbd="⌘N">
                New thread
              </Button>
              <Button variant="primary" kbd="↵">
                Allow once
              </Button>
              <Button variant="ghost" iconRight={ArrowRight}>
                Review changes
              </Button>
            </Row>
            <Row label="States">
              <Button loading>Connecting</Button>
              <Button disabled>Disabled</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </Row>
            <Row label="Icon buttons">
              <IconButton icon={PanelLeft} label="Collapse sidebar" shortcut="⌘B" />
              <IconButton icon={Settings} label="Settings" />
              <IconButton icon={Plus} label="Add host" variant="secondary" />
              <IconButton icon={MessageSquare} label="Threads" active size="lg" />
              <span className="text-xs text-text-muted">Hover for tooltips</span>
            </Row>
          </div>
        </Section>

        <Section title="Status">
          <div className="flex flex-col gap-3">
            <Row label="Badges">
              <Badge tone="accent" dot>
                Running
              </Badge>
              <Badge tone="warn" dot outline>
                Approval
              </Badge>
              <Badge tone="success" dot>
                Connected
              </Badge>
              <Badge tone="danger" dot>
                Failed
              </Badge>
              <Badge tone="info" dot>
                Subagent
              </Badge>
              <Badge>Merged</Badge>
            </Row>
            <Row label="Tags">
              <Tag>
                <Bot size={11} /> Claude Code
              </Tag>
              <Tag>devbox</Tag>
              <Tag>
                <GitBranch size={11} /> wt/acp-client
              </Tag>
              <Tag>sonnet-5.5</Tag>
            </Row>
            <Row label="Thread status">
              {(['running', 'waiting', 'failed', 'done', 'idle', 'scheduled'] as AgentStatus[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-2 mr-3 text-sm text-text-secondary">
                  <StatusDot status={s} />
                  {s}
                </span>
              ))}
            </Row>
            <Row label="Progress">
              <ProgressRing value={0.42} />
              <ProgressRing value={0.84} />
              <ProgressRing value={0.97} />
              <ProgressRing value={0.42} size={28} stroke={3} />
              <Spinner label="Loading" />
              <Kbd>⌘K</Kbd>
              <Kbd>⌃C</Kbd>
            </Row>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid grid-cols-3 gap-4 max-w-[900px]">
            <Field label="Host" htmlFor="ds-host" help="Any host from ~/.ssh/config">
              <Input id="ds-host" placeholder="devbox" icon={Server} />
            </Field>
            <Field label="Schedule" htmlFor="ds-cron" error="Not a valid cron expression">
              <Input id="ds-cron" mono defaultValue="0 2 * *" aria-invalid />
            </Field>
            <Field label="Search" htmlFor="ds-search">
              <Input id="ds-search" placeholder="Search threads" icon={Search} />
            </Field>
          </div>
          <Textarea rows={3} placeholder="Reply to Claude Code, @ to add files, / for commands" className="max-w-[720px]" />
        </Section>

        <Section title="Session controls" note="The two floating cards pinned at the top right of a thread. Rows with › open a detail popover.">
          <div className="relative rounded-card border border-border bg-[radial-gradient(circle_at_30%_20%,rgb(var(--color-bg-hover)),rgb(var(--color-bg))_60%)] p-8 flex justify-end min-h-[380px]">
            <div className="flex flex-col gap-1.5 w-[340px]">
              <FloatingSurface className="p-1">
                <Segmented
                  aria-label="Thread view"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'conversation', label: 'Conversation', icon: MessageSquare },
                    { value: 'review', label: 'Review', icon: GitCompare, count: 3 },
                    { value: 'terminal', label: 'Terminal', icon: SquareTerminal, count: 1 },
                  ]}
                />
              </FloatingSurface>
              <FloatingSurface>
                <MenuList>
                  <Popover>
                    <PopoverTrigger asChild>
                      <MenuRow leading={<ProgressRing value={0.42} />} label="Context" value="84k / 200k" trailing="submenu" />
                    </PopoverTrigger>
                    <PopoverContent side="left" align="start" title="Context window" footer={<>Reported by the agent each turn<Button size="sm" className="ml-auto">Compact</Button></>}>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-semibold">84k</span>
                        <span className="font-mono text-xs text-text-muted">of 200k tokens · 42%</span>
                      </div>
                      <div className="h-2 rounded bg-bg flex gap-0.5 overflow-hidden">
                        <i className="w-[9%] bg-text-muted" />
                        <i className="w-[6%] bg-info" />
                        <i className="w-[8%] bg-warn" />
                        <i className="w-[19%] bg-accent" />
                      </div>
                      {[
                        ['bg-text-muted', 'System prompt & tools', '18.2k'],
                        ['bg-info', 'MCP tools · 4 servers', '11.6k'],
                        ['bg-warn', 'Files added with @', '15.9k'],
                        ['bg-accent', 'Conversation', '38.3k'],
                      ].map(([c, l, v]) => (
                        <div key={l} className="grid grid-cols-[10px_1fr_auto] items-center gap-2.5 text-sm text-text-secondary">
                          <i className={`w-2.5 h-2.5 rounded-[3px] ${c}`} />
                          {l}
                          <span className="font-mono text-xs text-text-muted">{v}</span>
                        </div>
                      ))}
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <MenuRow icon={Plug} label="MCP servers" value={<>3 <span className="text-danger">· 1 error</span></>} trailing="submenu" />
                    </PopoverTrigger>
                    <PopoverContent side="left" align="start" title="MCP servers" footer={<>Passed to the agent at session start<Button size="sm" className="ml-auto">Manage</Button></>}>
                      {[
                        [GitPullRequest, 'github', 'http · 26 tools', true],
                        [Database, 'postgres', 'stdio · 5 tools', true],
                        [Globe, 'playwright', 'stdio · spawn failed', false],
                      ].map(([Icon, n, d, ok]) => {
                        const I = Icon as typeof GitPullRequest;
                        return (
                          <div key={n as string} className="grid grid-cols-[28px_1fr_auto] items-center gap-2.5">
                            <span className="w-7 h-7 rounded-[7px] border border-border bg-bg grid place-items-center text-text-secondary">
                              <I size={15} strokeWidth={1.75} />
                            </span>
                            <span className="leading-tight">
                              <span className="block text-sm font-medium">{n as string}</span>
                              <span className="block font-mono text-2xs text-text-muted">{d as string}</span>
                            </span>
                            <Badge tone={ok ? 'success' : 'danger'} dot>
                              {ok ? 'Connected' : 'Error'}
                            </Badge>
                          </div>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <MenuRow icon={Workflow} label="Subagents" value={<><span className="text-accent">1 running</span> · 1 done</>} trailing="submenu" />
                    </PopoverTrigger>
                    <PopoverContent side="left" align="start" title="Subagents">
                      {[
                        [Search, 'Explore ACP terminal spec', 'explore · 14 tool calls · 1m', false],
                        [FlaskConical, 'Write mock-agent tests', 'general · 6 tool calls · 32s', true],
                      ].map(([Icon, n, d, running]) => {
                        const I = Icon as typeof Search;
                        return (
                          <div key={n as string} className="grid grid-cols-[28px_1fr_auto] items-center gap-2.5">
                            <span className="w-7 h-7 rounded-[7px] border border-border bg-bg grid place-items-center text-text-secondary">
                              <I size={15} strokeWidth={1.75} />
                            </span>
                            <span className="leading-tight">
                              <span className="block text-sm font-medium">{n as string}</span>
                              <span className="block font-mono text-2xs text-text-muted">{d as string}</span>
                            </span>
                            <Badge tone={running ? 'accent' : 'success'} dot>
                              {running ? 'Running' : 'Done'}
                            </Badge>
                          </div>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                  <MenuSeparator />
                  <MenuRow icon={Server} label="devbox" value="ssh" trailing="menu" />
                  <MenuRow icon={GitBranch} label="wt/acp-client" mono trailing="menu" />
                  <MenuRow
                    icon={FileDiff}
                    label="Changes"
                    hint="vs main"
                    tone="muted"
                    value={
                      <>
                        <span className="text-success">+224</span> <span className="text-danger">−6</span>
                      </>
                    }
                  />
                  <MenuSeparator />
                  <MenuRow icon={Square} label="Stop agent" tone="danger" value={<Kbd>⌃C</Kbd>} />
                </MenuList>
              </FloatingSurface>
            </div>
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid grid-cols-2 gap-5 items-start">
            <Card>
              <CardHeader
                title="Work so far"
                meta="3 files · 1 command · 2 subagents"
                actions={
                  <Button variant="ghost" size="sm" iconRight={ArrowRight}>
                    Review
                  </Button>
                }
              />
              <CardBody className="py-1.5">
                {(
                  [
                    { Icon: FilePlus, label: <>Created <code className="font-mono text-sm bg-bg-hover px-1 rounded">worktreeGuard.ts</code></>, r: <span className="text-success">+42</span> },
                    { Icon: FilePen, label: <>Edited <code className="font-mono text-sm bg-bg-hover px-1 rounded">client.ts</code></>, r: <><span className="text-success">+118</span> <span className="text-danger">−6</span></> },
                    { Icon: Terminal, label: <>Ran <code className="font-mono text-sm bg-bg-hover px-1 rounded">npm test</code></>, r: <span className="text-success">5 passed</span> },
                    { Icon: Workflow, label: <>Subagent · Write mock-agent tests</>, r: 'running', info: true },
                  ] as { Icon: typeof FilePen; label: ReactNode; r: ReactNode; info?: boolean }[]
                ).map(({ Icon, label, r, info }, i) => (
                  <div key={i} className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5 px-4 py-1.5 text-text-secondary">
                    <span className={`w-[22px] h-[22px] rounded-md grid place-items-center ${info ? 'bg-info/12 text-info' : 'bg-bg-raised text-text-muted'}`}>
                      <Icon size={13} strokeWidth={1.75} />
                    </span>
                    <span>{label}</span>
                    <span className="font-mono text-xs text-text-muted">{r}</span>
                  </div>
                ))}
                <div className="grid grid-cols-[22px_1fr_auto] items-center gap-2.5 px-4 py-1.5 text-text-primary">
                  <span className="w-[22px] h-[22px] rounded-md grid place-items-center bg-accent/12 text-accent">
                    <Spinner size={13} />
                  </span>
                  Implementing terminal/* handlers…
                  <span className="font-mono text-xs text-text-muted">now</span>
                </div>
              </CardBody>
            </Card>

            <Card tone="warn" className="p-4 flex flex-col gap-3">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <ShieldAlert size={16} className="text-warn" />
                Allow Claude Code to install a package?
              </h3>
              <pre className="font-mono text-sm bg-bg border border-border rounded-lg px-3 py-2.5">npm install node-pty@1.0.0</pre>
              <p className="text-sm text-text-secondary">It needs a pseudo-terminal so terminal/create can stream coloured output.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" kbd="↵">
                  Allow once
                </Button>
                <Button>Always allow npm install here</Button>
                <Button variant="ghost">Reject</Button>
              </div>
            </Card>
          </div>

          <div className="max-w-[720px] w-full rounded-[14px] border border-border-strong bg-bg-panel shadow-float focus-within:border-accent/40">
            <textarea className="w-full h-14 bg-transparent outline-none resize-none px-4 pt-3.5 text-md placeholder:text-text-muted" placeholder="Reply to Claude Code, @ to add files, / for commands" />
            <div className="flex items-center gap-0.5 px-2.5 py-2">
              <Button variant="ghost" size="sm" icon={Bot} className="text-accent">
                Claude Code
              </Button>
              <Button variant="ghost" size="sm">sonnet-5.5</Button>
              <Button variant="ghost" size="sm">Edit mode</Button>
              <Button variant="ghost" size="sm" icon={AtSign}>
                Context
              </Button>
              <Button variant="ghost" size="sm" icon={Clock}>
                Schedule
              </Button>
              <button type="button" aria-label="Send" className="ml-auto w-8 h-8 rounded-full bg-accent text-on-accent grid place-items-center hover:bg-accent-hover transition-colors duration-fast">
                <ArrowUp size={16} strokeWidth={2.25} />
              </button>
            </div>
          </div>
        </Section>

        <Section title="Radius, elevation, motion">
          <div className="flex flex-wrap gap-5">
            {[
              ['rounded-md · 6', 'rounded-md'],
              ['rounded-lg · 8', 'rounded-lg'],
              ['rounded-card · 12', 'rounded-card'],
              ['shadow-card', 'rounded-card shadow-card'],
              ['shadow-float', 'rounded-card shadow-float'],
              ['shadow-popover', 'rounded-card shadow-popover'],
            ].map(([l, c]) => (
              <div key={l} className={`w-36 h-20 border border-border-strong bg-bg-raised grid place-items-center font-mono text-2xs text-text-muted ${c}`}>
                {l}
              </div>
            ))}
          </div>
          <p className="text-sm text-text-secondary">
            Motion: <span className="font-mono text-xs">fast 120ms</span> for hover and press, <span className="font-mono text-xs">base 180ms</span> for panels, <span className="font-mono text-xs">slow 240ms</span> for layout.
            Easing <span className="font-mono text-xs">cubic-bezier(0.2, 0.8, 0.2, 1)</span>. All durations drop to 0 with reduced motion.
          </p>
        </Section>
      </div>
    </div>
  );
}
