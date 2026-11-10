/**
 * Gestionnaire de l'icône System Tray Windows 10/11, de son infobulle dynamique et de son menu contextuel.
 */

import { app, type BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { SaveDataV1, StageId, TrayActionType, UserSettings } from '../core/types';

const STAGE_LABELS: Record<StageId, string> = {
  egg: 'Œuf',
  baby: 'Bébé',
  child: 'Enfant',
  adult: 'Adulte',
};

/** Fallback PNG 16x16 minimal encodé en base64 si l'icône sur disque est absente. */
const FALLBACK_TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA8SURBVDhPY/z//z8DJYCRkZGRgYGBgYFRBqMGjBoAA8QaQAwg1gBiDSDWAGININYAYg0g1gBiDRg1AAA7TwgR+7f2pAAAAABJRU5ErkJggg==';

function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'icons', 'tray-icon.png'),
    path.resolve(__dirname, '..', '..', 'assets', 'icons', 'tray-icon.png'),
    path.join(app.getAppPath(), 'dist', 'assets', 'icons', 'tray-icon.png'),
    path.join(app.getAppPath(), 'assets', 'icons', 'tray-icon.png'),
    path.join(process.cwd(), 'assets', 'icons', 'tray-icon.png'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) {
        return img.resize({ width: 16, height: 16 });
      }
    }
  }

  return nativeImage.createFromDataURL(FALLBACK_TRAY_ICON_DATA_URL);
}

export interface TrayManagerCallbacks {
  getWindow: () => BrowserWindow | null;
  getSaveData: () => SaveDataV1;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onQuit: () => void;
}

export class TrayManager {
  private tray: Tray | null = null;
  private readonly callbacks: TrayManagerCallbacks;

  constructor(callbacks: TrayManagerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Initialise l'icône System Tray Windows et attache le menu contextuel ainsi que le clic simple.
   */
  public init(): Tray {
    const icon = resolveTrayIcon();
    this.tray = new Tray(icon);

    this.tray.on('click', () => {
      this.sendTrayAction('open-hud');
    });

    this.updateFromSaveData(this.callbacks.getSaveData());
    return this.tray;
  }

  /**
   * Envoie une commande `TrayActionType` au processus Renderer via le canal `'pet:tray-action'`.
   */
  public sendTrayAction(action: TrayActionType): void {
    const win = this.callbacks.getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return;
    }
    win.webContents.send('pet:tray-action', action);
  }

  /**
   * Met à jour l'infobulle (tooltip) et l'état des cases à cocher du menu contextuel.
   */
  public updateFromSaveData(saveData: SaveDataV1): void {
    if (!this.tray || this.tray.isDestroyed()) {
      return;
    }

    const { pet, settings } = saveData;
    const stageLabel = STAGE_LABELS[pet.stage] ?? pet.stage;
    const hunger = Math.round(pet.needs.hunger);
    const energy = Math.round(pet.needs.energy);
    const happiness = Math.round(pet.needs.happiness);
    const cleanliness = Math.round(pet.needs.cleanliness);
    const tamaCoins = Math.round(pet.tamaCoins ?? 0);

    const tooltip = `${pet.name} (${stageLabel}) — 🪙 ${tamaCoins} | Faim: ${hunger}% | Énergie: ${energy}% | Bonheur: ${happiness}% | Propreté: ${cleanliness}%`;
    this.tray.setToolTip(tooltip);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `${pet.name} (${stageLabel}) — 🪙 ${pet.tamaCoins}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Nourrir',
        click: () => this.sendTrayAction('feed'),
      },
      {
        label: 'Jouer',
        click: () => this.sendTrayAction('play'),
      },
      {
        label: 'Dormir / Réveiller',
        click: () => this.sendTrayAction('toggle-sleep'),
      },
      {
        label: 'Nettoyer',
        click: () => this.sendTrayAction('clean'),
      },
      { type: 'separator' },
      {
        label: '🛍️ Boutique & Cosmétiques',
        click: () => this.sendTrayAction('open-shop'),
      },
      {
        label: '🌐 Mode Online (Recevoir un ami)',
        click: () => this.sendTrayAction('open-online'),
      },
      {
        label: 'Statistiques & Réglages',
        click: () => this.sendTrayAction('open-compendium'),
      },
      {
        label: '🧪 Menu Test / Sandbox',
        click: () => this.sendTrayAction('open-sandbox'),
      },
      {
        label: 'Recentrer le familier',
        click: () => this.sendTrayAction('center-pet'),
      },
      { type: 'separator' },
      {
        label: 'Lancer au démarrage de Windows',
        type: 'checkbox',
        checked: Boolean(settings.autoStartEnabled),
        click: (menuItem) => {
          this.callbacks.onUpdateSettings({ autoStartEnabled: menuItem.checked });
        },
      },
      {
        label: 'Notifications discrètes',
        type: 'checkbox',
        checked: Boolean(settings.notificationsEnabled),
        click: (menuItem) => {
          this.callbacks.onUpdateSettings({ notificationsEnabled: menuItem.checked });
        },
      },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          this.callbacks.onQuit();
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Détruit proprement l'icône du System Tray.
   */
  public destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
