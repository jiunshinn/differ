import path from 'node:path';
import dotenv from 'dotenv';
import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, session } from 'electron';
import { initDatabase, closeDatabase } from './services/db';
import { killAllGitProcesses } from './services/git';
import { registerIpcHandlers } from './ipc';

// Load env from .env only in development, from the project root and the packaged
// resources dir. We never read .env from process.cwd(): launching the app from a
// terminal inside an untrusted cloned repo must not let that repo's .env inject
// env vars (e.g. flip NODE_ENV/VITE_DEV_SERVER_URL to load an attacker URL).
// Done before any other code that may read process.env.
if (!app.isPackaged) {
  // dist/electron/main.js -> project root is two levels up.
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
} else {
  // Packaged: read optional config bundled next to the app resources.
  dotenv.config({ path: path.resolve(process.resourcesPath, '.env') });
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0f1115',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Never let the renderer spawn child windows that would inherit the preload
  // bridge. Route external http(s) links to the OS browser; deny everything else.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block navigations away from the app (e.g. dropping a file onto the window,
  // or a hijacked link) so the privileged renderer can't be replaced.
  const guardNavigation = (event: Electron.Event, url: string): void => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  };
  mainWindow.webContents.on('will-navigate', guardNavigation);
  mainWindow.webContents.on('will-frame-navigate', (event) =>
    guardNavigation(event, event.url),
  );

  // Gate dev behavior on !app.isPackaged (not NODE_ENV) so a stray NODE_ENV can't
  // flip a packaged build into loading the dev server URL.
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// A strict Content-Security-Policy for the renderer. Applied in production only so
// the Vite dev server (HMR websocket, inline injected scripts) keeps working.
function installContentSecurityPolicy(): void {
  if (!app.isPackaged) return;
  // The renderer makes no direct network requests (all GitHub access is via IPC),
  // so connect-src stays 'self'. Remote origins are only for the Google Fonts
  // stylesheet/font files loaded by src/index.html and GitHub avatar <img> tags.
  const csp =
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    'font-src https://fonts.gstatic.com; ' +
    "img-src 'self' https: data:; " +
    "connect-src 'self'";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

// Single-instance lock: focus the existing window instead of opening a second
// process that would run migrations and write the same SQLite file concurrently.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(() => {
      initDatabase();
      installContentSecurityPolicy();
      registerIpcHandlers({ ipcMain, dialog, shell, clipboard, getWindow: () => mainWindow });
      createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((err) => {
      dialog.showErrorBox('Differ failed to start', String(err?.stack ?? err));
      app.quit();
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Let before-quit own closing the database so it happens exactly once,
    // after any in-flight work settles.
    app.quit();
  }
});

app.on('before-quit', () => {
  // Terminate any in-flight git children (clone/fetch/pull/push) so quitting
  // mid-operation doesn't orphan processes, then close the database once.
  killAllGitProcesses();
  closeDatabase();
});
