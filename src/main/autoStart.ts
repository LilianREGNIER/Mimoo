/**
 * Gestion du lancement automatique au démarrage de Windows 10/11 via Electron `setLoginItemSettings`.
 */

import { app } from 'electron';

let lastKnownAutoStartState = false;

/**
 * Active ou désactive l'ouverture automatique de l'application à l'ouverture de session Windows.
 * Protégé par un bloc `try/catch` pour les environnements non packagés ou restreints.
 */
export function applyAutoStartSetting(enabled: boolean): void {
  lastKnownAutoStartState = Boolean(enabled);

  // En mode smoke-test automatisé, on évite d'inscrire l'exécutable de test dans le registre Windows
  if (process.argv.includes('--smoke-test')) {
    return;
  }

  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: lastKnownAutoStartState,
        path: process.execPath,
      });
    } else {
      app.setLoginItemSettings({
        openAtLogin: lastKnownAutoStartState,
        path: process.execPath,
        args: [app.getAppPath()],
      });
    }
  } catch (error) {
    console.warn(
      '[autoStart] Impossible de modifier les paramètres de démarrage Windows (mode dev ou droits limités) :',
      error
    );
  }
}

/**
 * Retourne l'état actuel du démarrage automatique Windows.
 */
export function getAutoStartStatus(): boolean {
  if (process.argv.includes('--smoke-test')) {
    return lastKnownAutoStartState;
  }

  try {
    const settings = app.getLoginItemSettings({
      path: process.execPath,
      ...(app.isPackaged ? {} : { args: [app.getAppPath()] }),
    });
    return Boolean(settings.openAtLogin);
  } catch {
    return lastKnownAutoStartState;
  }
}
