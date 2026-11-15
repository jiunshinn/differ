import type { ProviderSpec } from '../../shared/protocol.js';
import { modelSelector, type ConfigSelector } from '../../shared/protocol.js';
import { AcpSession } from './acpSession.js';

/** Agents answer `session/new` in well under a second; a cold one still fits. */
const PROBE_TIMEOUT_MS = 20_000;

export interface ProbeResult {
  selector: ConfigSelector | null;
  /** The agent's own name, useful when the provider list is stale. */
  name: string | null;
}

/**
 * Ask an agent what it offers by opening a throwaway session and closing it.
 * ACP has no "list models" call: config options only exist once a session does.
 */
export async function probeConfig(spec: ProviderSpec, cwd: string, clientVersion: string): Promise<ProbeResult> {
  const session = new AcpSession(spec, cwd, { emit: () => {}, waiting: () => {}, terminal: () => {}, crashed: () => {} }, clientVersion);
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${spec.name} did not answer within ${PROBE_TIMEOUT_MS / 1000}s`)), PROBE_TIMEOUT_MS);
    });
    await Promise.race([session.start(), timeout]);
    return { selector: modelSelector(session.configOptions), name: session.agentName ?? null };
  } finally {
    if (timer) clearTimeout(timer);
    session.dispose();
  }
}
