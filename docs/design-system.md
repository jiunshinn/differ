# Design system

Live gallery: run `npm run dev:renderer` and open <http://localhost:5173/#/design-system> (also works inside the Electron app at `#/design-system`).

## Sources

| What | Where |
|---|---|
| Tokens (colour, shadow, type, motion) | `src/styles/tokens.css` |
| Tailwind mapping | `tailwind.config.js` |
| Components | `src/ui/` (import from `src/ui`) |
| Gallery | `src/design/DesignSystemPage.tsx` |

## Principles

- **Neutrals carry the interface; colour carries meaning.** The accent is a soft graphite. Only these colours mean something:
  - `warn` (amber): needs you (permission requests, approvals)
  - `success` (green): added lines, passed, connected
  - `danger` (red): removed lines, failed, errors, destructive actions
  - `info` (blue): subagents and secondary activity
- **Dark first.** Every token has a light value too; the theme follows the `.dark` class set by `src/utils/theme.ts`.
- **State is never colour alone.** Status dots also differ in shape (solid, ring, dim, clock), and badges always include text.

## Type

- Geist Variable for interface text, Geist Mono Variable for code, paths, numbers, branches and shortcuts. Pretendard Variable is the fallback for Korean in both. All fonts are bundled through npm, so they work offline.
- Scale: `2xs` 10.5 · `xs` 11.5 · `sm` 12.5 · `base` 13.5 (body) · `md` 14 · `lg` 15 · `xl` 17 · `2xl` 20 · `3xl` 28.

## Icons

Lucide, 16px at stroke 1.75 by default; 15px inside buttons, 14px inside small controls. Lucide 1.x has no brand logos.

## Components

| Component | Use for |
|---|---|
| `Button` | `primary` (one per area), `secondary`, `ghost`, `danger`; sizes 28 / 32 / 36; optional icon, `kbd`, `loading` |
| `IconButton` | Icon-only actions; `label` is required and becomes the tooltip |
| `Badge`, `Tag` | Status pills with text; monospace labels for agent, host, branch, model |
| `StatusDot` | Thread state: running, waiting, failed, done, idle, scheduled |
| `Card`, `CardHeader`, `CardBody` | Grouped content; `tone="warn"` for permission requests |
| `FloatingSurface` | Translucent cards pinned over content (session controls) |
| `Segmented` | Switching views of one thing; arrow keys move between options |
| `MenuList`, `MenuRow`, `MenuSeparator` | Vertical rows with icon, label, value and a chevron |
| `Popover`, `PopoverContent` | Rich details (context, MCP, subagents) |
| `Tooltip` | Short labels only; the app is wrapped in `TooltipProvider` |
| `Input`, `Textarea`, `Field` | Form controls; set `aria-invalid` to show the error state |
| `ProgressRing`, `Spinner`, `Kbd` | Context usage, loading, shortcut hints |

## Motion

`duration-fast` (120ms) for hover and press, `duration-base` (180ms) for panels, `duration-slow` (240ms) for layout, with easing `ease-out`. All durations become 0 when reduced motion is on.
