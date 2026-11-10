/**
 * Gestionnaire de la fenêtre overlay transparente Windows 10/11 et du multi-écrans / DPI.
 */

import { app, BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { DisplayBoundsInfo } from '../core/types';

/**
 * Retourne la liste formatée de tous les écrans connectés (`DisplayBoundsInfo[]`).
 */
export function getDisplaysInfo(): DisplayBoundsInfo[] {
  const primaryDisplay = screen.getPrimaryDisplay();
  const allDisplays = screen.getAllDisplays();

  return allDisplays.map((display, index) => {
    const isPrimary = display.id === primaryDisplay.id;
    const rawLabel = typeof display.label === 'string' ? display.label.trim() : '';
    const fallbackLabel = `Écran ${index + 1}${isPrimary ? ' (Principal)' : ''}`;

    return {
      id: display.id,
      label: rawLabel.length > 0 ? rawLabel : fallbackLabel,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
      workArea: {
        x: display.workArea.x,
        y: display.workArea.y,
        width: display.workArea.width,
        height: display.workArea.height,
      },
      isPrimary,
    };
  });
}

/**
 * Résout l'écran cible selon `preferredDisplayId` (avec repli automatique sur l'écran principal).
 */
export function resolveTargetDisplay(preferredDisplayId: number | null): DisplayBoundsInfo {
  const displays = getDisplaysInfo();
  if (preferredDisplayId !== null) {
    const found = displays.find((d) => d.id === preferredDisplayId);
    if (found) {
      return found;
    }
  }
  return displays.find((d) => d.isPrimary) ?? displays[0];
}

/**
 * Résout le chemin du script Preload compilé (`dist/preload/preload.js`).
 */
function resolvePreloadPath(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'preload', 'preload.js'),
    path.join(app.getAppPath(), 'dist', 'preload', 'preload.js'),
    path.join(process.cwd(), 'dist', 'preload', 'preload.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Résout le chemin du fichier `index.html` du Renderer compilé.
 */
function resolveRendererHtmlPath(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'renderer', 'index.html'),
    path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
    path.join(process.cwd(), 'dist', 'renderer', 'index.html'),
    path.resolve(__dirname, '..', '..', 'src', 'renderer', 'index.html'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Crée et configure la `BrowserWindow` overlay transparente plein écran (calée sur `workArea`).
 */
export function createOverlayWindow(preferredDisplayId: number | null = null): {
  window: BrowserWindow;
  activeDisplay: DisplayBoundsInfo;
} {
  const targetDisplay = resolveTargetDisplay(preferredDisplayId);
  const { x, y, width, height } = targetDisplay.workArea;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // Toujours au premier plan au niveau screen-saver pour survoler les fenêtres classiques
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Click-through sélectif activé par défaut avec transfert des événements mousemove
  win.setIgnoreMouseEvents(true, { forward: true });

  const htmlPath = resolveRendererHtmlPath();
  void win.loadFile(htmlPath);

  return {
    window: win,
    activeDisplay: targetDisplay,
  };
}

/**
 * Déplace et redimensionne la fenêtre overlay vers l'écran correspondant à `displayId`.
 * Retourne les informations de l'écran cible ou `null` si l'identifiant est introuvable.
 */
export function moveWindowToDisplay(
  win: BrowserWindow,
  displayId: number
): DisplayBoundsInfo | null {
  if (win.isDestroyed()) {
    return null;
  }

  const displays = getDisplaysInfo();
  const target = displays.find((d) => d.id === displayId);
  if (!target) {
    return null;
  }

  win.setBounds({
    x: target.workArea.x,
    y: target.workArea.y,
    width: target.workArea.width,
    height: target.workArea.height,
  });
  win.setAlwaysOnTop(true, 'screen-saver');

  return target;
}

/**
 * Écoute les événements `screen` (`display-added`, `display-removed`, `display-metrics-changed`)
 * pour recalibrer automatiquement l'overlay et notifier le processus Renderer.
 */
export function registerDisplayChangeListeners(
  win: BrowserWindow,
  getPreferredDisplayId: () => number | null,
  onRecalibrated?: (activeDisplay: DisplayBoundsInfo, allDisplays: DisplayBoundsInfo[]) => void
): () => void {
  const handleDisplayChange = (): void => {
    if (win.isDestroyed()) {
      return;
    }

    const allDisplays = getDisplaysInfo();
    const activeDisplay = resolveTargetDisplay(getPreferredDisplayId());

    win.setBounds({
      x: activeDisplay.workArea.x,
      y: activeDisplay.workArea.y,
      width: activeDisplay.workArea.width,
      height: activeDisplay.workArea.height,
    });
    win.setAlwaysOnTop(true, 'screen-saver');

    if (onRecalibrated) {
      onRecalibrated(activeDisplay, allDisplays);
    }

    if (!win.webContents.isDestroyed()) {
      win.webContents.send('pet:displays-changed', allDisplays);
    }
  };

  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);
  screen.on('display-metrics-changed', handleDisplayChange);

  return () => {
    screen.removeListener('display-added', handleDisplayChange);
    screen.removeListener('display-removed', handleDisplayChange);
    screen.removeListener('display-metrics-changed', handleDisplayChange);
  };
}
