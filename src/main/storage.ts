/**
 * Persistance locale atomique de la sauvegarde (`save.json` + `save.backup.json`)
 * et chargement des catalogues de données statiques (`game-config.json`, `foods.json`, `species.json`, `cosmetics.json`).
 */

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  createInitialSaveData,
  parseSaveDataJson,
  serializeSaveData,
  validateAndMigrateSaveData,
} from '../core/saveSystem';
import type {
  CosmeticItem,
  FoodItem,
  GameConfig,
  SaveDataV1,
  SpeciesFormDefinition,
  UserSettings,
} from '../core/types';

const SAVE_FILE_NAME = 'save.json';
const BACKUP_FILE_NAME = 'save.backup.json';
const TEMP_FILE_NAME = 'save.json.tmp';

/**
 * Retourne le répertoire `userData` de l'application (et le crée s'il n'existe pas).
 */
export function getUserDataDir(): string {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Chemin complet vers `save.json`. */
export function getSaveFilePath(): string {
  return path.join(getUserDataDir(), SAVE_FILE_NAME);
}

/** Chemin complet vers `save.backup.json`. */
export function getBackupFilePath(): string {
  return path.join(getUserDataDir(), BACKUP_FILE_NAME);
}

/**
 * Écrit la sauvegarde sur le disque de manière atomique (`save.json.tmp` -> `save.json`)
 * tout en maintenant une copie de secours saine dans `save.backup.json`.
 */
export function saveToDiskAtomically(saveData: SaveDataV1): boolean {
  try {
    const userDataDir = getUserDataDir();
    const savePath = path.join(userDataDir, SAVE_FILE_NAME);
    const backupPath = path.join(userDataDir, BACKUP_FILE_NAME);
    const tempPath = path.join(userDataDir, TEMP_FILE_NAME);

    const { saveData: sanitized } = validateAndMigrateSaveData(saveData, Date.now());
    sanitized.savedAt = Date.now();
    const jsonContent = serializeSaveData(sanitized);

    // 1. Écriture dans le fichier temporaire
    fs.writeFileSync(tempPath, jsonContent, { encoding: 'utf-8', flag: 'w' });

    // 2. Si une sauvegarde saine existe déjà, la copier vers save.backup.json avant remplacement
    if (fs.existsSync(savePath)) {
      try {
        const currentRaw = fs.readFileSync(savePath, 'utf-8');
        const currentCheck = parseSaveDataJson(currentRaw);
        if (!currentCheck.recoveredFromCorruption) {
          fs.copyFileSync(savePath, backupPath);
        }
      } catch {
        // Ignorer les erreurs de lecture de l'ancien fichier lors du backup
      }
    }

    // 3. Remplacement atomique (avec repli copy+unlink si Windows verrouille brièvement le fichier)
    try {
      fs.renameSync(tempPath, savePath);
    } catch {
      fs.copyFileSync(tempPath, savePath);
      fs.unlinkSync(tempPath);
    }

    // 4. Si aucun backup n'existait encore, en créer un immédiatement
    if (!fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(savePath, backupPath);
      } catch {
        // Non bloquant
      }
    }

    return true;
  } catch (error) {
    console.error('[storage] Échec de l\'écriture atomique de la sauvegarde :', error);
    return false;
  }
}

/**
 * Charge la sauvegarde depuis `save.json`.
 * En cas de corruption, tente une restauration depuis `save.backup.json` via `parseSaveDataJson`,
 * sinon régénère une sauvegarde saine et l'écrit immédiatement sur le disque.
 */
export function loadSaveFromDisk(nowMs: number = Date.now()): SaveDataV1 {
  const savePath = getSaveFilePath();
  const backupPath = getBackupFilePath();

  if (fs.existsSync(savePath)) {
    try {
      const raw = fs.readFileSync(savePath, 'utf-8');
      const parsed = parseSaveDataJson(raw, nowMs);
      if (!parsed.recoveredFromCorruption) {
        if (parsed.migrated || parsed.warnings.length > 0) {
          saveToDiskAtomically(parsed.saveData);
        }
        return parsed.saveData;
      }
      console.warn(
        '[storage] save.json corrompu ou invalide, tentative de restauration depuis save.backup.json...',
        parsed.warnings
      );
    } catch (error) {
      console.warn('[storage] Impossible de lire save.json :', error);
    }
  }

  if (fs.existsSync(backupPath)) {
    try {
      const backupRaw = fs.readFileSync(backupPath, 'utf-8');
      const backupParsed = parseSaveDataJson(backupRaw, nowMs);
      if (!backupParsed.recoveredFromCorruption) {
        console.info('[storage] Restauration réussie depuis save.backup.json.');
        saveToDiskAtomically(backupParsed.saveData);
        return backupParsed.saveData;
      }
      console.warn(
        '[storage] save.backup.json également corrompu, génération d\'une nouvelle sauvegarde.',
        backupParsed.warnings
      );
    } catch (error) {
      console.warn('[storage] Impossible de lire save.backup.json :', error);
    }
  }

  const freshSave = createInitialSaveData(undefined, nowMs);
  saveToDiskAtomically(freshSave);
  return freshSave;
}

/**
 * Réinitialise la sauvegarde avec un nouvel œuf tout en conservant les préférences utilisateur
 * existantes si fournies, et persiste immédiatement le fichier.
 */
export function resetSaveOnDisk(
  newPetName?: string,
  preservedSettings?: UserSettings,
  nowMs: number = Date.now()
): SaveDataV1 {
  const freshSave = createInitialSaveData(newPetName, nowMs);
  if (preservedSettings) {
    freshSave.settings = { ...preservedSettings };
  }
  saveToDiskAtomically(freshSave);
  return freshSave;
}

/**
 * Résout le chemin du dossier `data/` contenant les fichiers JSON de configuration.
 * Cherche dans `dist/data/`, `../../data/`, `app.getAppPath()` et `process.cwd()`.
 */
export function resolveDataDirectory(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'data'),
    path.resolve(__dirname, '..', '..', 'data'),
    path.join(app.getAppPath(), 'dist', 'data'),
    path.join(app.getAppPath(), 'data'),
    path.join(process.cwd(), 'data'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'game-config.json'))) {
      return candidate;
    }
  }

  throw new Error(
    `[storage] Impossible de localiser le dossier data/ parmi : ${candidates.join(', ')}`
  );
}

/**
 * Charge le catalogue des objets cosmétiques depuis `data/cosmetics.json`.
 */
export function loadCosmeticsCatalog(): CosmeticItem[] {
  const dataDir = resolveDataDirectory();
  const cosmeticsPath = path.join(dataDir, 'cosmetics.json');
  if (!fs.existsSync(cosmeticsPath)) {
    return [];
  }
  const cosmeticsRaw = fs.readFileSync(cosmeticsPath, 'utf-8');
  return JSON.parse(cosmeticsRaw) as CosmeticItem[];
}

/**
 * Charge et parse les fichiers JSON statiques (`game-config.json`, `foods.json`, `species.json`, `cosmetics.json`).
 */
export function loadStaticGameData(): {
  gameConfig: GameConfig;
  foods: FoodItem[];
  species: SpeciesFormDefinition[];
  cosmetics: CosmeticItem[];
} {
  const dataDir = resolveDataDirectory();

  const gameConfigRaw = fs.readFileSync(path.join(dataDir, 'game-config.json'), 'utf-8');
  const foodsRaw = fs.readFileSync(path.join(dataDir, 'foods.json'), 'utf-8');
  const speciesRaw = fs.readFileSync(path.join(dataDir, 'species.json'), 'utf-8');

  const gameConfig = JSON.parse(gameConfigRaw) as GameConfig;
  const foods = JSON.parse(foodsRaw) as FoodItem[];
  const species = JSON.parse(speciesRaw) as SpeciesFormDefinition[];
  const cosmetics = loadCosmeticsCatalog();

  return {
    gameConfig,
    foods,
    species,
    cosmetics,
  };
}
