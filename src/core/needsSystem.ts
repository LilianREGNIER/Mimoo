/**
 * Système de gestion des 4 besoins fondamentaux (faim, énergie, bonheur, propreté).
 * Module pur TypeScript sans aucune dépendance DOM, Node.js ou Electron.
 */

import type { GameConfig, NeedKey, NeedsState, PetState } from './types';

/** Liste ordonnée des clés des 4 besoins fondamentaux. */
export const NEED_KEYS: readonly NeedKey[] = [
  'hunger',
  'energy',
  'happiness',
  'cleanliness',
] as const;

/** Durée en ligne (ms) sans caresse au-delà de laquelle le familier réclame un câlin. */
export const CUDDLE_NEGLECT_ONLINE_MS = 20 * 60 * 1000;

/**
 * Borne une valeur de besoin dans l'intervalle [0, 100] et arrondit à 2 décimales.
 * Protège contre `NaN`, `+Infinity` et `-Infinity`.
 */
export function clampNeed(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? 100 : 0;
  }
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped * 100) / 100;
}

/**
 * Retourne la liste des besoins dont la valeur est strictement inférieure au seuil critique.
 */
export function getCriticalNeeds(needs: NeedsState, threshold: number): NeedKey[] {
  const safeThreshold = Number.isFinite(threshold) ? threshold : 25;
  return NEED_KEYS.filter((key) => clampNeed(needs[key]) < safeThreshold);
}

/**
 * Applique l'écoulement du temps (`deltaSeconds`) sur les 4 jauges de besoins,
 * l'âge du familier, les demandes affectives (`needsCuddle`, `needsPlay`)
 * et le suivi des erreurs de soin (`careMistakes`).
 */
export function applyTickNeeds(
  pet: PetState,
  deltaSeconds: number,
  config: GameConfig,
  options?: { isOffline?: boolean }
): { pet: PetState; needsDelta: NeedsState; floorApplied: boolean } {
  const zeroDelta: NeedsState = {
    hunger: 0,
    energy: 0,
    happiness: 0,
    cleanliness: 0,
  };

  if (typeof deltaSeconds !== 'number' || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return {
      pet: {
        ...pet,
        needs: { ...pet.needs },
        discoveredForms: [...pet.discoveredForms],
        position: { ...pet.position },
        careStats: {
          ...pet.careStats,
          foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
        },
      },
      needsDelta: zeroDelta,
      floorApplied: false,
    };
  }

  const prevNeeds: NeedsState = {
    hunger: clampNeed(pet.needs.hunger),
    energy: clampNeed(pet.needs.energy),
    happiness: clampNeed(pet.needs.happiness),
    cleanliness: clampNeed(pet.needs.cleanliness),
  };

  const currentAge = Number.isFinite(pet.ageSeconds) && pet.ageSeconds >= 0 ? pet.ageSeconds : 0;
  const nextAgeSeconds = Math.round((currentAge + deltaSeconds) * 100) / 100;

  // Au stade d'œuf, les jauges ne baissent pas (l'œuf attend d'être cliqué pour éclore)
  if (pet.stage === 'egg') {
    return {
      pet: {
        ...pet,
        ageSeconds: nextAgeSeconds,
        needs: prevNeeds,
        needsCuddle: false,
        needsPlay: false,
        discoveredForms: [...pet.discoveredForms],
        position: { ...pet.position },
        careStats: {
          ...pet.careStats,
          foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
        },
      },
      needsDelta: zeroDelta,
      floorApplied: false,
    };
  }

  const isOffline = options?.isOffline === true;
  const deltaMinutes = deltaSeconds / 60;
  const decayRates = pet.isSleeping
    ? config.decayPerMinuteAsleep
    : config.decayPerMinuteAwake;

  const poopCount = Math.max(0, Number.isFinite(pet.poopCount) ? pet.poopCount : 0);
  const poopPenalty = poopCount * Math.max(0, config.poopPenaltyPerMinute) * deltaMinutes;

  const rawNeeds: NeedsState = {
    hunger: prevNeeds.hunger - decayRates.hunger * deltaMinutes,
    energy: pet.isSleeping
      ? prevNeeds.energy + (config.sleepEnergyRecoveryPerMinute - decayRates.energy) * deltaMinutes
      : prevNeeds.energy - decayRates.energy * deltaMinutes,
    happiness: prevNeeds.happiness - decayRates.happiness * deltaMinutes,
    cleanliness: prevNeeds.cleanliness - (decayRates.cleanliness * deltaMinutes + poopPenalty),
  };

  let floorApplied = false;
  const nextNeeds: NeedsState = { ...prevNeeds };
  const needsDelta: NeedsState = { ...zeroDelta };
  const offlineFloor = clampNeed(config.offlineFloor);

  for (const key of NEED_KEYS) {
    let candidate = rawNeeds[key];
    const previous = prevNeeds[key];

    if (isOffline && candidate < previous) {
      // Si le besoin était déjà sous offlineFloor avant la fermeture, il ne descend pas plus bas.
      // S'il était au-dessus, il est retenu à offlineFloor.
      const effectiveFloor = Math.min(previous, offlineFloor);
      if (candidate < effectiveFloor) {
        candidate = effectiveFloor;
        floorApplied = true;
      }
    }

    const clamped = clampNeed(candidate);
    nextNeeds[key] = clamped;
    needsDelta[key] = Math.round((clamped - previous) * 100) / 100;
  }

  // Gestion des erreurs de soin (careMistakes) lorsque des besoins sont sous le seuil critique
  let neglectSecondsAccumulator =
    Number.isFinite(pet.careStats.neglectSecondsAccumulator) &&
    pet.careStats.neglectSecondsAccumulator >= 0
      ? pet.careStats.neglectSecondsAccumulator
      : 0;
  let careMistakes =
    Number.isFinite(pet.careStats.careMistakes) && pet.careStats.careMistakes >= 0
      ? Math.floor(pet.careStats.careMistakes)
      : 0;

  const criticalNeeds = getCriticalNeeds(nextNeeds, config.criticalThreshold);
  const graceSeconds =
    Number.isFinite(config.careMistakeGraceSeconds) && config.careMistakeGraceSeconds > 0
      ? config.careMistakeGraceSeconds
      : 300;

  if (criticalNeeds.length > 0) {
    const totalNeglect = neglectSecondsAccumulator + deltaSeconds;
    const rawMistakesAdded = Math.floor(totalNeglect / graceSeconds);

    if (isOffline) {
      // Plafonne à maximum 1 erreur de soin par session hors-ligne
      const mistakesAdded = Math.min(1, rawMistakesAdded);
      careMistakes += mistakesAdded;
      neglectSecondsAccumulator =
        mistakesAdded > 0 ? 0 : Math.round((totalNeglect % graceSeconds) * 100) / 100;
    } else {
      careMistakes += rawMistakesAdded;
      neglectSecondsAccumulator = Math.round((totalNeglect % graceSeconds) * 100) / 100;
    }
  }

  // Mise à jour automatique de needsCuddle et needsPlay
  const recentlyPetted =
    pet.lastPettedAt > 0 &&
    pet.lastUpdatedAt + deltaSeconds * 1000 - pet.lastPettedAt < 180_000;

  const longSinceLastPetOnline =
    !isOffline &&
    pet.lastPettedAt > 0 &&
    pet.lastUpdatedAt + deltaSeconds * 1000 - pet.lastPettedAt >= CUDDLE_NEGLECT_ONLINE_MS;

  const nextNeedsCuddle = pet.isSleeping || recentlyPetted
    ? false
    : Boolean(pet.needsCuddle) || nextNeeds.happiness < 55 || longSinceLastPetOnline;

  const recentlyPlayed =
    pet.careStats.lastPlayedAt > 0 &&
    pet.lastUpdatedAt + deltaSeconds * 1000 - pet.careStats.lastPlayedAt < 180_000;

  const nextNeedsPlay = pet.isSleeping || recentlyPlayed
    ? false
    : (Boolean(pet.needsPlay) || nextNeeds.happiness < 48) && nextNeeds.energy > 30;

  const updatedPet: PetState = {
    ...pet,
    ageSeconds: nextAgeSeconds,
    needs: nextNeeds,
    needsCuddle: nextNeedsCuddle,
    needsPlay: nextNeedsPlay,
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      careMistakes,
      neglectSecondsAccumulator,
    },
    ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
    equippedCosmetics: {
      ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
    },
  };

  return {
    pet: updatedPet,
    needsDelta,
    floorApplied,
  };
}
