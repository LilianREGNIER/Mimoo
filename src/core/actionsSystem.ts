/**
 * Système d'actions de soin et d'interactions avec le familier :
 * alimentation, caresses, sommeil, nettoyage et résultats de mini-jeux.
 */

import { clampNeed } from './needsSystem';
import type { FoodItem, GameConfig, MiniGameResult, NeedsState, PetState } from './types';

/** Seuil de satiété à partir duquel le familier refuse de manger davantage. */
export const FULL_HUNGER_THRESHOLD = 98;

/**
 * Nourrit le familier avec un aliment donné.
 * Refuse si le familier est au stade d'œuf (`egg_cannot_eat`), s'il dort (`sleeping`),
 * ou s'il est déjà rassasié (`full` lorsque `hunger >= 98`).
 */
export function feedPet(
  pet: PetState,
  food: FoodItem,
  nowMs?: number
): { pet: PetState; accepted: boolean; reason?: string } {
  if (pet.stage === 'egg') {
    return { pet, accepted: false, reason: 'egg_cannot_eat' };
  }
  if (pet.isSleeping) {
    return { pet, accepted: false, reason: 'sleeping' };
  }
  if (pet.needs.hunger >= FULL_HUNGER_THRESHOLD) {
    return { pet, accepted: false, reason: 'full' };
  }

  const nextNeeds: NeedsState = {
    hunger: clampNeed(pet.needs.hunger + (food.effects.hunger ?? 0)),
    energy: clampNeed(pet.needs.energy + (food.effects.energy ?? 0)),
    happiness: clampNeed(pet.needs.happiness + (food.effects.happiness ?? 0)),
    cleanliness: clampNeed(pet.needs.cleanliness + (food.effects.cleanliness ?? 0)),
  };

  const currentCategoryCount = pet.careStats.foodCategoryCounts[food.category] ?? 0;

  const updatedPet: PetState = {
    ...pet,
    lastUpdatedAt:
      nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt,
    needs: nextNeeds,
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      totalMeals: pet.careStats.totalMeals + 1,
      foodCategoryCounts: {
        ...pet.careStats.foodCategoryCounts,
        [food.category]: currentCategoryCount + 1,
      },
    },
  };

  return {
    pet: updatedPet,
    accepted: true,
  };
}

/**
 * Caresse le familier. Octroie un bonus de bonheur si le familier ne dort pas
 * et que le délai de recharge (`config.petCooldownMs`) est écoulé.
 */
export function petCharacter(
  pet: PetState,
  config: GameConfig,
  nowMs: number
): { pet: PetState; bonusApplied: boolean; cooldownRemainingMs: number } {
  const safeNow = Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt;
  const cooldownMs = Math.max(0, config.petCooldownMs);
  const elapsed = safeNow - pet.lastPettedAt;

  if (pet.isSleeping) {
    const remaining =
      pet.lastPettedAt > 0 ? Math.max(0, cooldownMs - Math.max(0, elapsed)) : 0;
    return {
      pet,
      bonusApplied: false,
      cooldownRemainingMs: remaining,
    };
  }

  const isCooldownElapsed = pet.lastPettedAt <= 0 || elapsed >= cooldownMs;
  if (!isCooldownElapsed) {
    return {
      pet,
      bonusApplied: false,
      cooldownRemainingMs: Math.max(0, cooldownMs - Math.max(0, elapsed)),
    };
  }

  const updatedPet: PetState = {
    ...pet,
    lastUpdatedAt: safeNow,
    lastPettedAt: safeNow,
    needs: {
      ...pet.needs,
      happiness: clampNeed(pet.needs.happiness + config.petHappinessBonus),
    },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      totalPets: pet.careStats.totalPets + 1,
    },
  };

  return {
    pet: updatedPet,
    bonusApplied: true,
    cooldownRemainingMs: 0,
  };
}

/**
 * Bascule l'état de sommeil du familier.
 * Un œuf (`stage === 'egg'`) reste toujours éveillé.
 */
export function togglePetSleep(
  pet: PetState,
  nowMs?: number
): { pet: PetState; isSleeping: boolean } {
  if (pet.stage === 'egg') {
    const awakeEgg: PetState = {
      ...pet,
      isSleeping: false,
      lastUpdatedAt:
        nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt,
    };
    return { pet: awakeEgg, isSleeping: false };
  }

  const nextSleeping = !pet.isSleeping;
  const updatedPet: PetState = {
    ...pet,
    isSleeping: nextSleeping,
    lastUpdatedAt:
      nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt,
    needs: { ...pet.needs },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
    },
  };

  return {
    pet: updatedPet,
    isSleeping: nextSleeping,
  };
}

/**
 * Nettoie le familier et son environnement :
 * remet `poopCount` à `0`, augmente la propreté et incrémente `careStats.totalCleans`.
 */
export function cleanPet(
  pet: PetState,
  config: GameConfig,
  nowMs?: number
): { pet: PetState; cleaned: boolean } {
  const bonus = Math.max(0, config.cleanlinessBonusPerClean);
  const nextCleanliness = clampNeed(pet.needs.cleanliness + bonus);

  const updatedPet: PetState = {
    ...pet,
    poopCount: 0,
    lastUpdatedAt:
      nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt,
    needs: {
      ...pet.needs,
      cleanliness: nextCleanliness,
    },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      totalCleans: pet.careStats.totalCleans + 1,
    },
  };

  return {
    pet: updatedPet,
    cleaned: true,
  };
}

/**
 * Applique les effets d'une session de mini-jeu :
 * - Gain de bonheur proportionnel au score (`+10` à `+22` si gagné, `+5` si participé).
 * - Coût d'énergie (`6` points) et de faim (`4` points sans descendre sous `10`).
 * - Incrémente `totalGamesPlayed` et éventuellement `totalGamesWon`.
 */
export function applyMiniGameResult(
  pet: PetState,
  result: MiniGameResult,
  nowMs?: number
): { pet: PetState; happinessGain: number; energyCost: number } {
  const safeMax = Number.isFinite(result.maxScore) && result.maxScore > 0 ? result.maxScore : 1;
  const safeScore = Number.isFinite(result.score) ? Math.max(0, result.score) : 0;
  const ratio = Math.min(1, Math.max(0, safeScore / safeMax));

  const happinessGain = result.won ? Math.round(10 + ratio * 12) : 5;
  const energyCost = 6;
  const hungerCost = 4;

  const currentHunger = clampNeed(pet.needs.hunger);
  const nextHunger =
    currentHunger > 10 ? Math.max(10, clampNeed(currentHunger - hungerCost)) : currentHunger;

  const updatedPet: PetState = {
    ...pet,
    lastUpdatedAt:
      nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt,
    needs: {
      ...pet.needs,
      hunger: nextHunger,
      energy: clampNeed(pet.needs.energy - energyCost),
      happiness: clampNeed(pet.needs.happiness + happinessGain),
    },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      totalGamesPlayed: pet.careStats.totalGamesPlayed + 1,
      totalGamesWon: pet.careStats.totalGamesWon + (result.won ? 1 : 0),
    },
  };

  return {
    pet: updatedPet,
    happinessGain,
    energyCost,
  };
}
