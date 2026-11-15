import path from 'node:path';
import dotenv from 'dotenv';

// Load env from .env in the project root (dev) and from the resources dir (packaged).
// Done before any other imports that may read process.env.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import { initDatabase, closeDatabase } from './services/db';
import { registerIpcHandlers } from './ipc';
import { activateEnvironment, deleteEnvironment, getEnvironment, listEnvironments, saveEnvironment } from './environments';
import { bootstrapEnvironment, checkNode, connectEnvironment, connectedEnvironmentIds, disconnectEnvironment } from './transport';
import { setSshResolver } from './services/git';
import { getRepositoryByPath } from './services/repoStore';
import { sshTarget } from './services/ssh';
import { IpcChannels, type EnvironmentDraft } from '../shared/types';

// Dev/test aid: point the app at a throwaway data folder.
if (process.env.DIFFER_USER_DATA) app.setPath('userData', path.resolve(process.env.DIFFER_USER_DATA));

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0c10',
    // The app draws its own chrome; window buttons float over the sidebar.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Environment plumbing: the renderer asks for server endpoints and for environment changes. */
function registerEnvironmentHandlers(): void {
  // One endpoint per environment, so multiple machines can be connected at once.
  ipcMain.handle(IpcChannels.serverEndpoint, (_e, envId?: string | null) => connectEnvironment(envId));

  ipcMain.handle(IpcChannels.envList, () => ({
    ...listEnvironments(),
    connectedIds: connectedEnvironmentIds(),
  }));

  ipcMain.handle(IpcChannels.envSave, (_e, draft: EnvironmentDraft) => saveEnvironment(draft));

  ipcMain.handle(IpcChannels.envDelete, (_e, id: string) => {
    deleteEnvironment(id);
    // Drop that machine's connection; the others keep running.
    disconnectEnvironment(id);
    return { ...listEnvironments(), connectedIds: connectedEnvironmentIds() };
  });

  // "Make this the default machine for new threads." Connections stay up.
  ipcMain.handle(IpcChannels.envActivate, async (_e, id: string) => {
    activateEnvironment(id);
    return connectEnvironment(id);
  });

  ipcMain.handle(IpcChannels.envDisconnect, (_e, id: string) => {
    disconnectEnvironment(id);
    return connectedEnvironmentIds();
  });

  ipcMain.handle(IpcChannels.envCheck, (_e, id: string) => {
    const env = getEnvironment(id);
    if (!env) throw new Error('No such environment');
    return checkNode(env);
  });

  ipcMain.handle(IpcChannels.envBootstrap, (_e, id: string) => {
    const env = getEnvironment(id);
    if (!env) throw new Error('No such environment');
    return bootstrapEnvironment(env);
  });
}

app.whenReady().then(() => {
  initDatabase();
  registerIpcHandlers({ ipcMain, dialog, shell, clipboard, getWindow: () => mainWindow });
  registerEnvironmentHandlers();
  // Repositories remember the machine they came from; git and file reads for a
  // remote one run over ssh instead of against this Mac's filesystem.
  setSshResolver((cwd) => {
    const repo = getRepositoryByPath(cwd);
    if (!repo || !repo.environment_id || repo.environment_id === 'local') return null;
    const env = getEnvironment(repo.environment_id);
    return env ? sshTarget(env) : null;
  });
  // Start the agent server early; the renderer asks for its address when it connects.
  connectEnvironment().catch((err) => console.error('[differ] could not reach the server:', err));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    disconnectEnvironment();
    closeDatabase();
    app.quit();
  }
});

app.on('before-quit', () => {
  disconnectEnvironment();
  closeDatabase();
});
