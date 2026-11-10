/**
 * Système de sauvegarde, validation structurelle, assainissement et migration de schéma.
 * Ne dépend d'aucune API de système de fichiers (`fs`) ou d'Electron.
 */

import { clampNeed } from './needsSystem';
import type {
  CareStats,
  FoodCategory,
  FormId,
  NeedsState,
  PetState,
  SaveDataV1,
  StageId,
  UserSettings,
} from './types';

/** Version actuelle du schéma de sauvegarde. */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** Ensemble des identifiants de formes valides. */
const VALID_FORM_IDS: readonly FormId[] = [
  'egg',
  'baby_blob',
  'child_sprout',
  'adult_solar',
  'adult_athletic',
  'adult_gourmet',
  'adult_shadow',
] as const;

/** Correspondance entre une forme et son stade de vie. */
const FORM_TO_STAGE: Record<FormId, StageId> = {
  egg: 'egg',
  baby_blob: 'baby',
  child_sprout: 'child',
  adult_solar: 'adult',
  adult_athletic: 'adult',
  adult_gourmet: 'adult',
  adult_shadow: 'adult',
};

/** Ensemble des stades valides. */
const VALID_STAGE_IDS: readonly StageId[] = ['egg', 'baby', 'child', 'adult'] as const;

/**
 * Crée les préférences utilisateur par défaut.
 */
export function createDefaultSettings(): UserSettings {
  return {
    autoStartEnabled: false,
    notificationsEnabled: true,
    fpsLimitIdle: 15,
    fpsLimitActive: 60,
    preferredDisplayId: null,
    petScale: 1,
  };
}

/**
 * Crée les statistiques de soin initiales d'un nouveau familier.
 */
export function createInitialCareStats(): CareStats {
  return {
    totalMeals: 0,
    foodCategoryCounts: {
      healthy: 0,
      snack: 0,
      energizing: 0,
      gourmet: 0,
    },
    totalGamesPlayed: 0,
    totalGamesWon: 0,
    totalPets: 0,
    totalCleans: 0,
    careMistakes: 0,
    neglectSecondsAccumulator: 0,
  };
}

/**
 * Crée l'état initial d'un nouveau familier au stade d'œuf.
 */
export function createInitialPetState(name?: string, nowMs?: number): PetState {
  const safeNow =
    typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const safeName =
    typeof name === 'string' && name.trim().length > 0 ? name.trim() : 'Mochi';

  return {
    name: safeName,
    formId: 'egg',
    stage: 'egg',
    bornAt: safeNow,
    lastUpdatedAt: safeNow,
    ageSeconds: 0,
    needs: {
      hunger: 85,
      energy: 90,
      happiness: 85,
      cleanliness: 100,
    },
    isSleeping: false,
    poopCount: 0,
    lastPettedAt: 0,
    discoveredForms: ['egg'],
    position: { x: 240, y: 240 },
    careStats: createInitialCareStats(),
  };
}

/**
 * Crée une sauvegarde initiale complète au format `SaveDataV1`.
 */
export function createInitialSaveData(name?: string, nowMs?: number): SaveDataV1 {
  const safeNow =
    typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: safeNow,
    pet: createInitialPetState(name, safeNow),
    settings: createDefaultSettings(),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidFormId(value: unknown): value is FormId {
  return typeof value === 'string' && (VALID_FORM_IDS as readonly string[]).includes(value);
}

function isValidStageId(value: unknown): value is StageId {
  return typeof value === 'string' && (VALID_STAGE_IDS as readonly string[]).includes(value);
}

function sanitizeNonNegativeNumber(
  value: unknown,
  fallback: number,
  warnings: string[],
  fieldName: string
): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  warnings.push(`Champ numérique invalide ou manquant (${fieldName}), remplacé par ${fallback}.`);
  return fallback;
}

function sanitizeNeedField(
  rawNeeds: Record<string, unknown>,
  key: keyof NeedsState,
  fallback: number,
  warnings: string[]
): number {
  const rawVal = rawNeeds[key];
  if (typeof rawVal !== 'number' || Number.isNaN(rawVal)) {
    warnings.push(`Jauge '${key}' manquante ou NaN, assainie.`);
    return typeof rawVal === 'number' ? clampNeed(rawVal) : fallback;
  }
  if (!Number.isFinite(rawVal) || rawVal < 0 || rawVal > 100) {
    warnings.push(`Jauge '${key}' hors bornes (${rawVal}), recalée dans [0, 100].`);
  }
  return clampNeed(rawVal);
}

/**
 * Valide, assainit et migre si nécessaire une donnée brute vers `SaveDataV1`.
 * Ne lève jamais d'exception : en cas de corruption totale, retourne un état sain avec
 * `recoveredFromCorruption: true`.
 */
export function validateAndMigrateSaveData(
  raw: unknown,
  nowMs?: number
): {
  saveData: SaveDataV1;
  migrated: boolean;
  recoveredFromCorruption: boolean;
  warnings: string[];
} {
  const safeNow =
    typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const warnings: string[] = [];

  if (!isPlainObject(raw)) {
    warnings.push('Données de sauvegarde absentes ou non-objet : réinitialisation complète.');
    return {
      saveData: createInitialSaveData(undefined, safeNow),
      migrated: false,
      recoveredFromCorruption: true,
      warnings,
    };
  }

  const rawPet = raw.pet;
  if (!isPlainObject(rawPet)) {
    warnings.push('Objet `pet` manquant ou corrompu : réinitialisation complète.');
    return {
      saveData: createInitialSaveData(undefined, safeNow),
      migrated: false,
      recoveredFromCorruption: true,
      warnings,
    };
  }

  let migrated = false;
  const rawSchemaVersion = raw.schemaVersion;
  if (rawSchemaVersion !== CURRENT_SCHEMA_VERSION) {
    migrated = true;
    warnings.push(
      `Migration du schéma de sauvegarde (${String(rawSchemaVersion)} -> ${CURRENT_SCHEMA_VERSION}).`
    );
  }

  const defaults = createInitialPetState(undefined, safeNow);

  const name =
    typeof rawPet.name === 'string' && rawPet.name.trim().length > 0
      ? rawPet.name.trim()
      : (() => {
          warnings.push('Nom du familier invalide ou manquant, remplacé par la valeur par défaut.');
          return defaults.name;
        })();

  const formId: FormId = isValidFormId(rawPet.formId)
    ? rawPet.formId
    : (() => {
        warnings.push(`FormId invalide (${String(rawPet.formId)}), repli sur 'egg'.`);
        return 'egg' as const;
      })();

  const stage: StageId = isValidStageId(rawPet.stage)
    ? rawPet.stage
    : (() => {
        warnings.push(`Stage invalide (${String(rawPet.stage)}), déduit depuis formId.`);
        return FORM_TO_STAGE[formId];
      })();

  const bornAt = sanitizeNonNegativeNumber(rawPet.bornAt, safeNow, warnings, 'pet.bornAt');
  const lastUpdatedAt = sanitizeNonNegativeNumber(
    rawPet.lastUpdatedAt,
    safeNow,
    warnings,
    'pet.lastUpdatedAt'
  );
  const ageSeconds = sanitizeNonNegativeNumber(
    rawPet.ageSeconds,
    0,
    warnings,
    'pet.ageSeconds'
  );

  const rawNeeds = isPlainObject(rawPet.needs) ? rawPet.needs : {};
  if (!isPlainObject(rawPet.needs)) {
    warnings.push('Objet `pet.needs` manquant ou invalide, valeurs par défaut appliquées.');
  }

  const needs: NeedsState = {
    hunger: sanitizeNeedField(rawNeeds, 'hunger', defaults.needs.hunger, warnings),
    energy: sanitizeNeedField(rawNeeds, 'energy', defaults.needs.energy, warnings),
    happiness: sanitizeNeedField(rawNeeds, 'happiness', defaults.needs.happiness, warnings),
    cleanliness: sanitizeNeedField(
      rawNeeds,
      'cleanliness',
      defaults.needs.cleanliness,
      warnings
    ),
  };

  const isSleeping =
    stage === 'egg'
      ? false
      : typeof rawPet.isSleeping === 'boolean'
        ? rawPet.isSleeping
        : false;

  const poopCount = Math.floor(
    sanitizeNonNegativeNumber(rawPet.poopCount, 0, warnings, 'pet.poopCount')
  );
  const lastPettedAt = sanitizeNonNegativeNumber(
    rawPet.lastPettedAt,
    0,
    warnings,
    'pet.lastPettedAt'
  );

  const discoveredSet = new Set<FormId>(['egg', formId]);
  if (Array.isArray(rawPet.discoveredForms)) {
    for (const item of rawPet.discoveredForms) {
      if (isValidFormId(item)) {
        discoveredSet.add(item);
      }
    }
  } else {
    warnings.push('Liste `discoveredForms` absente ou invalide, reconstruite.');
  }

  const rawPosition = isPlainObject(rawPet.position) ? rawPet.position : {};
  const position = {
    x:
      typeof rawPosition.x === 'number' && Number.isFinite(rawPosition.x)
        ? rawPosition.x
        : defaults.position.x,
    y:
      typeof rawPosition.y === 'number' && Number.isFinite(rawPosition.y)
        ? rawPosition.y
        : defaults.position.y,
  };

  const rawCareStats = isPlainObject(rawPet.careStats) ? rawPet.careStats : {};
  const rawFoodCounts = isPlainObject(rawCareStats.foodCategoryCounts)
    ? rawCareStats.foodCategoryCounts
    : {};

  const foodCategories: readonly FoodCategory[] = [
    'healthy',
    'snack',
    'energizing',
    'gourmet',
  ];
  const foodCategoryCounts: Record<FoodCategory, number> = {
    healthy: 0,
    snack: 0,
    energizing: 0,
    gourmet: 0,
  };

  for (const cat of foodCategories) {
    const val = rawFoodCounts[cat];
    foodCategoryCounts[cat] =
      typeof val === 'number' && Number.isFinite(val) && val >= 0 ? Math.floor(val) : 0;
  }

  const careStats: CareStats = {
    totalMeals: Math.floor(
      sanitizeNonNegativeNumber(rawCareStats.totalMeals, 0, warnings, 'careStats.totalMeals')
    ),
    foodCategoryCounts,
    totalGamesPlayed: Math.floor(
      sanitizeNonNegativeNumber(
        rawCareStats.totalGamesPlayed,
        0,
        warnings,
        'careStats.totalGamesPlayed'
      )
    ),
    totalGamesWon: Math.floor(
      sanitizeNonNegativeNumber(
        rawCareStats.totalGamesWon,
        0,
        warnings,
        'careStats.totalGamesWon'
      )
    ),
    totalPets: Math.floor(
      sanitizeNonNegativeNumber(rawCareStats.totalPets, 0, warnings, 'careStats.totalPets')
    ),
    totalCleans: Math.floor(
      sanitizeNonNegativeNumber(
        rawCareStats.totalCleans,
        0,
        warnings,
        'careStats.totalCleans'
      )
    ),
    careMistakes: Math.floor(
      sanitizeNonNegativeNumber(
        rawCareStats.careMistakes,
        0,
        warnings,
        'careStats.careMistakes'
      )
    ),
    neglectSecondsAccumulator: sanitizeNonNegativeNumber(
      rawCareStats.neglectSecondsAccumulator,
      0,
      warnings,
      'careStats.neglectSecondsAccumulator'
    ),
  };

  const defaultSettings = createDefaultSettings();
  const rawSettings = isPlainObject(raw.settings) ? raw.settings : {};

  const settings: UserSettings = {
    autoStartEnabled:
      typeof rawSettings.autoStartEnabled === 'boolean'
        ? rawSettings.autoStartEnabled
        : defaultSettings.autoStartEnabled,
    notificationsEnabled:
      typeof rawSettings.notificationsEnabled === 'boolean'
        ? rawSettings.notificationsEnabled
        : defaultSettings.notificationsEnabled,
    fpsLimitIdle:
      typeof rawSettings.fpsLimitIdle === 'number' &&
      Number.isFinite(rawSettings.fpsLimitIdle) &&
      rawSettings.fpsLimitIdle > 0
        ? rawSettings.fpsLimitIdle
        : defaultSettings.fpsLimitIdle,
    fpsLimitActive:
      typeof rawSettings.fpsLimitActive === 'number' &&
      Number.isFinite(rawSettings.fpsLimitActive) &&
      rawSettings.fpsLimitActive > 0
        ? rawSettings.fpsLimitActive
        : defaultSettings.fpsLimitActive,
    preferredDisplayId:
      typeof rawSettings.preferredDisplayId === 'number' &&
      Number.isFinite(rawSettings.preferredDisplayId)
        ? rawSettings.preferredDisplayId
        : null,
    petScale:
      typeof rawSettings.petScale === 'number' &&
      Number.isFinite(rawSettings.petScale) &&
      rawSettings.petScale >= 0.5 &&
      rawSettings.petScale <= 3
        ? rawSettings.petScale
        : defaultSettings.petScale,
  };

  const savedAt = sanitizeNonNegativeNumber(raw.savedAt, safeNow, warnings, 'savedAt');

  const saveData: SaveDataV1 = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt,
    pet: {
      name,
      formId,
      stage,
      bornAt,
      lastUpdatedAt,
      ageSeconds,
      needs,
      isSleeping,
      poopCount,
      lastPettedAt,
      discoveredForms: Array.from(discoveredSet),
      position,
      careStats,
    },
    settings,
  };

  return {
    saveData,
    migrated,
    recoveredFromCorruption: false,
    warnings,
  };
}

/**
 * Sérialise une sauvegarde `SaveDataV1` en chaîne JSON formatée.
 */
export function serializeSaveData(saveData: SaveDataV1): string {
  return JSON.stringify(saveData, null, 2);
}

/**
 * Analyse une chaîne JSON de sauvegarde, valide et migre son contenu sans jamais lever d'exception.
 */
export function parseSaveDataJson(
  jsonString: string,
  nowMs?: number
): {
  saveData: SaveDataV1;
  migrated: boolean;
  recoveredFromCorruption: boolean;
  warnings: string[];
} {
  const safeNow =
    typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();

  if (typeof jsonString !== 'string' || jsonString.trim().length === 0) {
    return {
      saveData: createInitialSaveData(undefined, safeNow),
      migrated: false,
      recoveredFromCorruption: true,
      warnings: ['Chaîne JSON vide ou invalide : réinitialisation de la sauvegarde.'],
    };
  }

  try {
    const parsed: unknown = JSON.parse(jsonString);
    return validateAndMigrateSaveData(parsed, safeNow);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      saveData: createInitialSaveData(undefined, safeNow),
      migrated: false,
      recoveredFromCorruption: true,
      warnings: [`JSON malformé (${message}) : récupération sur une sauvegarde neuve.`],
    };
  }
}
