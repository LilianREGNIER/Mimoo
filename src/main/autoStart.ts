/**
 * Gestion du lancement automatique au démarrage de Windows 10/11 via Electron `setLoginItemSettings`.
 */

import { app } from 'electron';

let lastKnownAutoStartState = false;

function quoteWindowsExecutablePath(exePath: string): string {
  const trimmed = exePath.trim();
  if (process.platform !== 'win32') {
    return trimmed;
  }
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed : `"${trimmed}"`;
}

function resolveAutoStartTarget(): { path: string; rawPath: string; args?: string[] } {
  if (app.isPackaged) {
    const portableExe = process.env.PORTABLE_EXECUTABLE_FILE?.trim();
    const rawPath = portableExe && portableExe.length > 0 ? portableExe : process.execPath;
    return {
      path: quoteWindowsExecutablePath(rawPath),
      rawPath,
    };
  }

  return {
    path: quoteWindowsExecutablePath(process.execPath),
    rawPath: process.execPath,
    args: [app.getAppPath()],
  };
}

/**
 * Active ou désactive l'ouverture automatique de l'application à l'ouverture de session Windows.
 * Utilise `PORTABLE_EXECUTABLE_FILE` pour les builds Portables et entoure le chemin de guillemets sous Windows.
 */
export function applyAutoStartSetting(enabled: boolean): void {
  lastKnownAutoStartState = Boolean(enabled);

  // En mode smoke-test automatisé, on évite d'inscrire l'exécutable de test dans le registre Windows
  if (process.argv.includes('--smoke-test')) {
    return;
  }

  try {
    const target = resolveAutoStartTarget();
    app.setLoginItemSettings({
      openAtLogin: lastKnownAutoStartState,
      path: target.path,
      ...(target.args ? { args: target.args } : {}),
    });

    // Nettoyage d'une éventuelle ancienne entrée non-quotée ou temporaire lors de la désactivation
    if (!lastKnownAutoStartState) {
      if (target.rawPath !== target.path) {
        app.setLoginItemSettings({
          openAtLogin: false,
          path: target.rawPath,
          ...(target.args ? { args: target.args } : {}),
        });
      }
      if (app.isPackaged && target.rawPath !== process.execPath) {
        app.setLoginItemSettings({
          openAtLogin: false,
          path: process.execPath,
        });
      }
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
    const target = resolveAutoStartTarget();
    const settings = app.getLoginItemSettings({
      path: target.path,
      ...(target.args ? { args: target.args } : {}),
    });
    return Boolean(settings.openAtLogin || settings.executableWillLaunchAtLogin);
  } catch {
    return lastKnownAutoStartState;
  }
}
