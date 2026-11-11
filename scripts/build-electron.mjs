import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Copie récursivement un répertoire source vers une destination s'il existe.
 * @param {string} src - Chemin absolu du dossier source
 * @param {string} dest - Chemin absolu du dossier de destination
 */
function copyDirectoryIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

async function buildElectron() {
  const sharedOptions = {
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true,
    logLevel: 'info'
  };

  // 1. Compilation du processus principal Electron (Main)
  await build({
    ...sharedOptions,
    entryPoints: [path.join(rootDir, 'src', 'main', 'main.ts')],
    outfile: path.join(rootDir, 'dist', 'main', 'main.js')
  });

  // 2. Compilation du script Preload (Pont IPC contextBridge)
  await build({
    ...sharedOptions,
    entryPoints: [path.join(rootDir, 'src', 'preload', 'preload.ts')],
    outfile: path.join(rootDir, 'dist', 'preload', 'preload.js')
  });

  // 3. Copie des données pilotées par JSON (data/ -> dist/data/)
  copyDirectoryIfExists(
    path.join(rootDir, 'data'),
    path.join(rootDir, 'dist', 'data')
  );

  // 3.5 Compilation du hook natif Windows si absent (assets/bin/activity-hook.exe)
  const hookExePath = path.join(rootDir, 'assets', 'bin', 'activity-hook.exe');
  const hookCsPath = path.join(rootDir, 'scripts', 'activity-hook.cs');
  if (!fs.existsSync(hookExePath) && fs.existsSync(hookCsPath)) {
    try {
      const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
      if (fs.existsSync(cscPath)) {
        fs.mkdirSync(path.join(rootDir, 'assets', 'bin'), { recursive: true });
        execSync(`"${cscPath}" /target:exe /out:"${hookExePath}" /optimize+ "${hookCsPath}"`, { stdio: 'ignore' });
        console.log('[build-electron] Compilation du hook natif activity-hook.exe réussie.');
      }
    } catch (err) {
      console.warn('[build-electron] Avertissement : impossible de compiler activity-hook.cs :', err?.message);
    }
  }

  // 4. Copie des assets graphiques (assets/ -> dist/assets/)
  copyDirectoryIfExists(
    path.join(rootDir, 'assets'),
    path.join(rootDir, 'dist', 'assets')
  );

  console.log('[build-electron] Compilation Main/Preload et copie data/assets terminées.');
}

buildElectron().catch((err) => {
  console.error('[build-electron] Erreur lors de la compilation Electron :', err);
  process.exit(1);
});
