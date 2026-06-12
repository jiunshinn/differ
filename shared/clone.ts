// Derive a target folder name from a git remote URL.
// Shared by the main process (clone IPC handler) and the renderer (clone dialog)
// so the suggested name and the actual destination stay in sync.
export function deriveCloneFolderName(remoteUrl: string): string {
  // Strip trailing slashes and a single trailing .git
  const trimmed = remoteUrl.trim().replace(/\/+$/, '');
  const noGit = trimmed.replace(/\.git$/i, '');
  // Take the last path segment after / or :
  const parts = noGit.split(/[/:]/);
  return (parts[parts.length - 1] || '').trim();
}
