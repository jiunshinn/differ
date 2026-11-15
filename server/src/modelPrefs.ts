import fs from 'node:fs';
import path from 'node:path';
import type { HiddenModels } from '../../shared/protocol.js';
import { ProviderError } from './providers.js';

/**
 * Which model values the user turned off per provider, kept in
 * <dataDir>/models.json next to the provider list. Purely a UI preference:
 * the agent still knows every model, differ just stops offering them.
 */
export class ModelPrefs {
  private cache: HiddenModels | null = null;

  constructor(private dataDir: string) {}

  private get file() {
    return path.join(this.dataDir, 'models.json');
  }

  private read(): HiddenModels {
    if (this.cache) return this.cache;
    const out: HiddenModels = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [id, values] of Object.entries(raw as Record<string, unknown>)) {
          if (Array.isArray(values)) out[id] = values.filter((v): v is string => typeof v === 'string' && v.length > 0);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[differ] ignoring invalid ${this.file}:`, err);
    }
    this.cache = out;
    return out;
  }

  all(): HiddenModels {
    return this.read();
  }

  get(providerId: string): string[] {
    return this.read()[providerId] ?? [];
  }

  /** Replace the hidden list for one provider and return the whole map. */
  set(providerId: string, disabled: unknown): HiddenModels {
    if (!Array.isArray(disabled) || disabled.some((v) => typeof v !== 'string')) throw new ProviderError('Expected a list of model ids');
    const values = [...new Set((disabled as string[]).filter((v) => v.length > 0))];
    const next = { ...this.read() };
    if (values.length) next[providerId] = values;
    else delete next[providerId];
    this.write(next);
    this.cache = next;
    return next;
  }

  private write(all: HiddenModels): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }
}
