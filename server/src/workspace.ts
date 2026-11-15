import fs from 'node:fs/promises';
import path from 'node:path';

export class WorkspaceError extends Error {}

/**
 * Confines agent file access to one root directory.
 * Paths are resolved through symlinks, so a link inside the root that points
 * outside it is rejected too.
 */
export class Workspace {
  private realRoot: Promise<string>;

  constructor(readonly root: string) {
    this.realRoot = fs.realpath(root);
  }

  private async inside(real: string): Promise<boolean> {
    const root = await this.realRoot;
    const rel = path.relative(root, real);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  /** Resolve an absolute path, following symlinks, and check it stays in the root. */
  async resolve(p: string, { forWrite = false } = {}): Promise<string> {
    if (!path.isAbsolute(p)) throw new WorkspaceError(`Path must be absolute: ${p}`);
    const target = path.normalize(p);
    let real: string;
    try {
      real = await fs.realpath(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || !forWrite) throw err;
      // New file: the nearest existing ancestor must be inside the root.
      let dir = path.dirname(target);
      const rest = [path.basename(target)];
      for (;;) {
        try {
          real = path.join(await fs.realpath(dir), ...rest);
          break;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || dir === path.dirname(dir)) throw e;
          rest.unshift(path.basename(dir));
          dir = path.dirname(dir);
        }
      }
    }
    if (!(await this.inside(real))) throw new WorkspaceError(`Outside the thread's folder: ${p}`);
    return real;
  }

  async readText(p: string, line?: number | null, limit?: number | null): Promise<string> {
    const text = await fs.readFile(await this.resolve(p), 'utf8');
    if (!line && !limit) return text;
    const lines = text.split('\n');
    const start = Math.max(0, (line ?? 1) - 1);
    return lines.slice(start, limit ? start + limit : undefined).join('\n');
  }

  async writeText(p: string, content: string): Promise<void> {
    const real = await this.resolve(p, { forWrite: true });
    await fs.mkdir(path.dirname(real), { recursive: true });
    await fs.writeFile(real, content, 'utf8');
  }
}
