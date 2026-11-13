/**
 * Gestionnaire de mises à jour automatiques intégrées pour Mimoo (`electron-updater`).
 * Permet de vérifier, télécharger et installer les nouvelles versions depuis GitHub Releases
 * (avec prise en charge optionnelle d'un jeton personnel pour les dépôts privés).
 */

import { app, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatusPayload, UserSettings } from '../core/types';

const GITHUB_OWNER = 'LilianREGNIER';
const GITHUB_REPO = 'Mimoo';

let initialized = false;
let currentStatus: UpdateStatusPayload = {
  state: 'idle',
  currentVersion: app.getVersion(),
};

let windowGetter: () => BrowserWindow | null = () => null;
let settingsGetter: () => UserSettings | null = () => null;

function emitStatus(next: UpdateStatusPayload): UpdateStatusPayload {
  currentStatus = next;
  const win = windowGetter();
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('pet:update-status', currentStatus);
  }
  return currentStatus;
}

function configureFeedUrl(): void {
  const token = settingsGetter()?.githubUpdateToken?.trim() || '';
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    private: Boolean(token),
    ...(token ? { token } : {}),
  });
}

function formatUpdaterError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'Erreur inconnue');
  if (raw.includes('404') || raw.includes('401') || raw.includes('403')) {
    return 'Dépôt GitHub privé inaccessible : vérifiez votre Jeton GitHub (scope repo) dans Réglages.';
  }
  if (raw.includes('ENOTFOUND') || raw.includes('ERR_NETWORK') || raw.includes('ETIMEDOUT')) {
    return 'Impossible de joindre GitHub (vérifiez votre connexion Internet).';
  }
  return raw;
}

/**
 * Initialise les écouteurs `electron-updater` une seule fois au démarrage du processus Main.
 */
export function initAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
  getSettings: () => UserSettings | null
): void {
  windowGetter = getMainWindow;
  settingsGetter = getSettings;

  if (initialized) {
    return;
  }
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    emitStatus({
      state: 'checking',
      currentVersion: app.getVersion(),
      message: 'Recherche de mise à jour sur GitHub…',
    });
  });

  autoUpdater.on('update-available', (info) => {
    emitStatus({
      state: 'available',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      message: `Nouvelle version v${info.version} trouvée ! Téléchargement en cours…`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    emitStatus({
      state: 'not-available',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      message: `Mimoo est déjà à jour (v${app.getVersion()}).`,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.max(0, Math.min(100, Math.round(progress.percent)));
    emitStatus({
      state: 'downloading',
      currentVersion: app.getVersion(),
      latestVersion: currentStatus.latestVersion,
      progressPercent: pct,
      message: `Téléchargement de la mise à jour… ${pct}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emitStatus({
      state: 'downloaded',
      currentVersion: app.getVersion(),
      latestVersion: info.version,
      progressPercent: 100,
      message: `Mise à jour v${info.version} prête ! Cliquez sur « Redémarrer et installer ».`,
    });
  });

  autoUpdater.on('error', (err) => {
    emitStatus({
      state: 'error',
      currentVersion: app.getVersion(),
      message: formatUpdaterError(err),
    });
  });

  // Vérification automatique au démarrage si l'app est packagée (dépôt public : aucun jeton requis)
  if (app.isPackaged) {
    setTimeout(() => {
      void checkForUpdates();
    }, 12_000);
  }
}

/**
 * Lance une vérification de mise à jour sur GitHub Releases.
 */
export async function checkForUpdates(): Promise<UpdateStatusPayload> {
  const currentVersion = app.getVersion();
  if (!app.isPackaged) {
    return emitStatus({
      state: 'not-available',
      currentVersion,
      message: 'Mode développement : les mises à jour automatiques fonctionnent dans la version installée (.exe).',
    });
  }

  try {
    configureFeedUrl();
    emitStatus({
      state: 'checking',
      currentVersion,
      message: 'Recherche de mise à jour sur GitHub…',
    });
    await autoUpdater.checkForUpdates();
    return currentStatus;
  } catch (err) {
    return emitStatus({
      state: 'error',
      currentVersion,
      message: formatUpdaterError(err),
    });
  }
}

/**
 * Quitte l'application et installe la mise à jour téléchargée.
 */
export function installDownloadedUpdate(): void {
  if (!app.isPackaged) {
    return;
  }
  autoUpdater.quitAndInstall(false, true);
}

/**
 * Retourne la version actuelle de Mimoo.
 */
export function getAppVersion(): string {
  return app.getVersion();
}
