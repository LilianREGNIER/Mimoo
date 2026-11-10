/**
 * Point d'entrée du processus principal Electron (Main Process) pour Windows 10/11.
 * Orchestre le cycle de vie de l'application, l'overlay transparent, le System Tray,
 * la persistance atomique, le multi-écrans, la veille système et les canaux IPC.
 */

import { app, type BrowserWindow, ipcMain, powerMonitor } from 'electron';
import { clampPetPositionToWorkArea } from '../core/displayUtils';
import { evaluateEvolution } from '../core/evolutionSystem';
import { validateAndMigrateSaveData } from '../core/saveSystem';
import { computeOfflineCatchup } from '../core/timeSystem';
import type {
  BootstrapPayload,
  CosmeticItem,
  DisplayBoundsInfo,
  FoodItem,
  GameConfig,
  OfflineCatchupReport,
  SaveDataV1,
  SpeciesFormDefinition,
  UserSettings,
} from '../core/types';
import { applyAutoStartSetting } from './autoStart';
import { NotificationManager } from './notifications';
import { PcActivityTracker } from './pcActivityTracker';
import {
  loadCosmeticsCatalog,
  loadSaveFromDisk,
  loadStaticGameData,
  resetSaveOnDisk,
  saveToDiskAtomically,
} from './storage';
import { TrayManager } from './trayManager';
import {
  createOverlayWindow,
  getDisplaysInfo,
  moveWindowToDisplay,
  registerDisplayChangeListeners,
  resolveTargetDisplay,
} from './windowManager';

const isSmokeTest = process.argv.includes('--smoke-test');

// Identifiant AppUserModelId requis sur Windows 10/11 pour les notifications Toast natives
if (process.platform === 'win32') {
  app.setAppUserModelId('com.tamagotchi.desktoppet');
}

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let pcActivityTracker: PcActivityTracker | null = null;
let unregisterDisplayListeners: (() => void) | null = null;
const notificationManager = new NotificationManager();

let currentSaveData!: SaveDataV1;
let gameConfig!: GameConfig;
let foodsCatalog: FoodItem[] = [];
let speciesCatalog: SpeciesFormDefinition[] = [];
let cosmeticsCatalog: CosmeticItem[] = [];
let initialOfflineReport!: OfflineCatchupReport;

/**
 * Recale les coordonnées du familier dans la zone de travail locale de l'écran actif.
 */
function clampCurrentPetToDisplay(display: DisplayBoundsInfo): void {
  const localWorkArea = {
    x: 0,
    y: 0,
    width: display.workArea.width,
    height: display.workArea.height,
  };
  const clamped = clampPetPositionToWorkArea(
    currentSaveData.pet.position,
    localWorkArea,
    48
  );
  currentSaveData.pet.position = { x: clamped.x, y: clamped.y };
}

/**
 * Met à jour les préférences utilisateur (depuis IPC ou depuis le menu System Tray)
 * et synchronise immédiatement le démarrage Windows, l'écran actif et le Tray.
 */
function handleUpdateSettings(partial: Partial<UserSettings>): UserSettings {
  const previousDisplayId = currentSaveData.settings.preferredDisplayId;
  const previousAutoStart = currentSaveData.settings.autoStartEnabled;

  const merged: SaveDataV1 = {
    ...currentSaveData,
    settings: {
      ...currentSaveData.settings,
      ...partial,
    },
  };

  const { saveData: validated } = validateAndMigrateSaveData(merged, Date.now());
  currentSaveData = validated;

  if (currentSaveData.settings.autoStartEnabled !== previousAutoStart) {
    applyAutoStartSetting(currentSaveData.settings.autoStartEnabled);
  }

  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    currentSaveData.settings.preferredDisplayId !== previousDisplayId
  ) {
    const targetDisplay = resolveTargetDisplay(currentSaveData.settings.preferredDisplayId);
    moveWindowToDisplay(mainWindow, targetDisplay.id);
    clampCurrentPetToDisplay(targetDisplay);
  }

  saveToDiskAtomically(currentSaveData);
  trayManager?.updateFromSaveData(currentSaveData);

  return { ...currentSaveData.settings };
}

/**
 * Enregistre tous les handlers `ipcMain.handle(...)` conformément à `PetIPCContract`.
 */
function registerIpcHandlers(): void {
  ipcMain.handle('pet:bootstrap', (): BootstrapPayload => {
    return {
      saveData: currentSaveData,
      gameConfig,
      foods: foodsCatalog,
      species: speciesCatalog,
      cosmetics: cosmeticsCatalog,
      offlineReport: initialOfflineReport,
      displays: getDisplaysInfo(),
    };
  });

  ipcMain.handle('pet:save-state', (_event, incomingSaveData: SaveDataV1): boolean => {
    const { saveData: sanitized } = validateAndMigrateSaveData(
      incomingSaveData,
      Date.now()
    );
    currentSaveData = sanitized;
    const saved = saveToDiskAtomically(currentSaveData);
    trayManager?.updateFromSaveData(currentSaveData);
    return saved;
  });

  ipcMain.handle('pet:reset-save', (_event, newPetName?: string): SaveDataV1 => {
    const freshSave = resetSaveOnDisk(
      newPetName,
      currentSaveData.settings,
      Date.now()
    );
    currentSaveData = freshSave;

    const activeDisplay = resolveTargetDisplay(currentSaveData.settings.preferredDisplayId);
    clampCurrentPetToDisplay(activeDisplay);
    saveToDiskAtomically(currentSaveData);

    notificationManager.resetCooldowns();
    trayManager?.updateFromSaveData(currentSaveData);
    return currentSaveData;
  });

  ipcMain.handle(
    'pet:set-ignore-mouse',
    (_event, ignore: boolean, forward: boolean = true): void => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      if (ignore) {
        mainWindow.setIgnoreMouseEvents(true, { forward: Boolean(forward) });
      } else {
        mainWindow.setIgnoreMouseEvents(false);
      }
    }
  );

  ipcMain.handle(
    'pet:update-settings',
    (_event, partialSettings: Partial<UserSettings>): UserSettings => {
      return handleUpdateSettings(partialSettings ?? {});
    }
  );

  ipcMain.handle('pet:get-displays', (): DisplayBoundsInfo[] => {
    return getDisplaysInfo();
  });

  ipcMain.handle(
    'pet:move-to-display',
    (_event, displayId: number): DisplayBoundsInfo | null => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return null;
      }
      const movedDisplay = moveWindowToDisplay(mainWindow, displayId);
      if (!movedDisplay) {
        return null;
      }

      currentSaveData.settings.preferredDisplayId = movedDisplay.id;
      clampCurrentPetToDisplay(movedDisplay);
      saveToDiskAtomically(currentSaveData);
      trayManager?.updateFromSaveData(currentSaveData);

      if (!mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('pet:displays-changed', getDisplaysInfo());
      }

      return movedDisplay;
    }
  );

  ipcMain.handle(
    'pet:notify-critical',
    (_event, title: string, body: string): void => {
      notificationManager.notify(
        typeof title === 'string' ? title : 'Alerte Familier',
        typeof body === 'string' ? body : '',
        currentSaveData.settings
      );
    }
  );
}

/**
 * Configure la surveillance de l'alimentation / mise en veille Windows (`powerMonitor`).
 */
function registerPowerMonitorListeners(): void {
  powerMonitor.on('suspend', () => {
    if (!currentSaveData) {
      return;
    }
    currentSaveData.pet.lastUpdatedAt = Date.now();
    saveToDiskAtomically(currentSaveData);
  });

  powerMonitor.on('resume', () => {
    if (!currentSaveData || !gameConfig) {
      return;
    }
    const nowMs = Date.now();
    const { pet: caughtUpPet, report } = computeOfflineCatchup(
      currentSaveData.pet,
      nowMs,
      gameConfig
    );
    const evoResult = evaluateEvolution(caughtUpPet, speciesCatalog);
    currentSaveData = {
      ...currentSaveData,
      savedAt: nowMs,
      pet: evoResult.pet,
    };
    initialOfflineReport = report;
    saveToDiskAtomically(currentSaveData);
    trayManager?.updateFromSaveData(currentSaveData);
  });
}

/**
 * Active le protocole de validation automatisée `--smoke-test` :
 * attend 2.5 secondes après `did-finish-load`, vérifie l'absence d'erreurs critiques,
 * sauvegarde proprement et quitte avec le code 0 (ou 1 en cas d'erreur).
 */
function attachSmokeTestLifecycle(win: BrowserWindow): void {
  let hasError = false;
  const errorMessages: string[] = [];

  const failSmokeTest = (reason: string): void => {
    hasError = true;
    errorMessages.push(reason);
    console.error(`[smoke-test] ERREUR : ${reason}`);
  };

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    failSmokeTest(`did-fail-load (${errorCode}): ${errorDescription}`);
  });

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    failSmokeTest(`preload-error (${preloadPath}): ${error.message}`);
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    failSmokeTest(`render-process-gone (${details.reason})`);
  });

  win.webContents.on('console-message', (_event, level, message) => {
    // level 3 = error dans Electron
    if (level >= 3) {
      failSmokeTest(`Renderer console.error: ${message}`);
    }
  });

  const timeoutGuard = setTimeout(() => {
    failSmokeTest('Délai maximal de chargement dépassé (15s).');
    pcActivityTracker?.stop();
    trayManager?.destroy();
    app.exit(1);
  }, 15000);

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      clearTimeout(timeoutGuard);
      saveToDiskAtomically(currentSaveData);
      pcActivityTracker?.stop();
      trayManager?.destroy();

      if (hasError) {
        console.error('[smoke-test] Échec du smoke test :', errorMessages.join(' | '));
        app.exit(1);
      } else {
        console.log('[smoke-test] Application démarrée, overlay + Tray + IPC validés avec succès.');
        app.exit(0);
      }
    }, 2500);
  });
}

// Verrou d'instance unique
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      trayManager?.sendTrayAction('open-hud');
    }
  });

  void app.whenReady().then(() => {
    const nowMs = Date.now();

    // 1. Chargement des catalogues JSON et de la sauvegarde
    const staticData = loadStaticGameData();
    gameConfig = staticData.gameConfig;
    foodsCatalog = staticData.foods;
    speciesCatalog = staticData.species;
    cosmeticsCatalog = loadCosmeticsCatalog();

    const loadedSave = loadSaveFromDisk(nowMs);

    // 2. Calcul du rattrapage hors-ligne (offline catch-up) et vérification d'évolution
    const catchup = computeOfflineCatchup(loadedSave.pet, nowMs, gameConfig);
    const evoResult = evaluateEvolution(catchup.pet, speciesCatalog);
    initialOfflineReport = catchup.report;

    currentSaveData = {
      ...loadedSave,
      savedAt: nowMs,
      pet: evoResult.pet,
    };

    // 3. Synchronisation du démarrage automatique Windows
    applyAutoStartSetting(currentSaveData.settings.autoStartEnabled);

    // 4. Enregistrement des canaux IPC avant la création de la fenêtre
    registerIpcHandlers();

    // 5. Création de la fenêtre overlay transparente et recalage dans le workArea
    const { window: overlayWin, activeDisplay } = createOverlayWindow(
      currentSaveData.settings.preferredDisplayId
    );
    mainWindow = overlayWin;

    clampCurrentPetToDisplay(activeDisplay);
    saveToDiskAtomically(currentSaveData);

    // Suivi léger et anonyme de l'activité PC
    pcActivityTracker = new PcActivityTracker(() => mainWindow);
    pcActivityTracker.start();

    // 6. Surveillance multi-écrans et DPI
    unregisterDisplayListeners = registerDisplayChangeListeners(
      overlayWin,
      () => currentSaveData.settings.preferredDisplayId,
      (recalibratedDisplay) => {
        clampCurrentPetToDisplay(recalibratedDisplay);
        saveToDiskAtomically(currentSaveData);
      }
    );

    // 7. Création de l'icône System Tray Windows
    trayManager = new TrayManager({
      getWindow: () => mainWindow,
      getSaveData: () => currentSaveData,
      onUpdateSettings: (partial) => {
        handleUpdateSettings(partial);
      },
      onQuit: () => {
        saveToDiskAtomically(currentSaveData);
      },
    });
    trayManager.init();

    // 8. Surveillance de la mise en veille / sortie de veille Windows
    registerPowerMonitorListeners();

    // 9. Mode validation automatique --smoke-test
    if (isSmokeTest) {
      attachSmokeTestLifecycle(overlayWin);
    }
  });

  app.on('before-quit', () => {
    if (unregisterDisplayListeners) {
      unregisterDisplayListeners();
      unregisterDisplayListeners = null;
    }
    if (currentSaveData) {
      saveToDiskAtomically(currentSaveData);
    }
    trayManager?.destroy();
  });

  app.on('will-quit', () => {
    pcActivityTracker?.stop();
    pcActivityTracker = null;
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
