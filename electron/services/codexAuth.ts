import { spawn } from 'node:child_process';
import { launchAgentSession } from './agentSessionStore';
import type { AgentSession, CodexLoginStatus } from '../../shared/types';

export async function getCodexLoginStatus(): Promise<CodexLoginStatus> {
  try {
    const result = await runCodex(['login', 'status']);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      available: true,
      logged_in: result.code === 0,
      mode: parseAuthMode(output),
      detail: output || (result.code === 0 ? 'Logged in' : 'Not logged in'),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      logged_in: false,
      mode: null,
      detail: message,
    };
  }
}

export function startCodexLogin(repoId: number, deviceAuth = true): Promise<AgentSession> {
  return launchAgentSession({
    repository_id: repoId,
    title: deviceAuth ? 'Codex device login' : 'Codex browser login',
    objective: deviceAuth
      ? 'Complete ChatGPT sign-in for Codex with the device code shown in this terminal.'
      : 'Complete ChatGPT sign-in for Codex in the browser window opened by the CLI.',
    agent_kind: 'codex',
  }, deviceAuth ? 'codex login --device-auth' : 'codex login');
}

function parseAuthMode(output: string): string | null {
  const mode = output.match(/(?:mode|auth(?:entication)?):\s*([^\n]+)/i)?.[1]?.trim();
  if (mode) return mode;
  if (/chatgpt/i.test(output)) return 'chatgpt';
  if (/api key|apikey/i.test(output)) return 'api-key';
  if (/access token/i.test(output)) return 'access-token';
  return null;
}

function runCodex(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('codex is not installed or is not available on PATH'));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
