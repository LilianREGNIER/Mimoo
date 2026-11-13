/**
 * Gestion du temps et calcul du rattrapage hors-ligne (offline catch-up)
 * avec protection contre les reculs d'horloge système et plancher de survie.
 */

import { applyTickNeeds } from './needsSystem';
import type { GameConfig, OfflineCatchupReport, PetState } from './types';

/**
 * Calcule et applique le rattrapage hors-ligne entre `pet.lastUpdatedAt` et `nowMs`.
 * - Si l'horloge a reculé (`nowMs < pet.lastUpdatedAt`), aucun besoin ni âge n'est altéré
 *   et `clockSkewDetected` passe à `true`.
 * - Si la durée dépasse `config.maxOfflineHours`, le temps pris en compte est plafonné.
 * - Applique le plancher `config.offlineFloor` via `applyTickNeeds(..., { isOffline: true })`.
 */
export function computeOfflineCatchup(
  pet: PetState,
  nowMs: number,
  config: GameConfig
): { pet: PetState; report: OfflineCatchupReport } {
  const safeLastUpdated = Number.isFinite(pet.lastUpdatedAt) ? pet.lastUpdatedAt : nowMs;
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : safeLastUpdated;
  const rawElapsedMs = safeNowMs - safeLastUpdated;

  if (rawElapsedMs < 0) {
    const resyncedPet: PetState = {
      ...pet,
      lastUpdatedAt: safeNowMs,
      needs: { ...pet.needs },
      discoveredForms: [...pet.discoveredForms],
      position: { ...pet.position },
      careStats: {
        ...pet.careStats,
        foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      },
    };

    return {
      pet: resyncedPet,
      report: {
        elapsedMs: rawElapsedMs,
        clampedMs: 0,
        clockSkewDetected: true,
        needsDelta: {
          hunger: 0,
          energy: 0,
          happiness: 0,
          cleanliness: 0,
        },
        floorApplied: false,
      },
    };
  }

  const maxOfflineMs = Math.max(0, config.maxOfflineHours) * 3600 * 1000;
  const clampedMs = Math.min(rawElapsedMs, maxOfflineMs);
  const deltaSeconds = clampedMs / 1000;

  const { pet: tickedPet, needsDelta, floorApplied } = applyTickNeeds(
    pet,
    deltaSeconds,
    config,
    { isOffline: true }
  );

  const returningAfterOffline = rawElapsedMs > 60_000;
  const keepHappyStartupCalm = returningAfterOffline && tickedPet.needs.happiness >= 75;

  const updatedPet: PetState = {
    ...tickedPet,
    lastUpdatedAt: safeNowMs,
    // Évite que le temps passé app fermée déclenche immédiatement l'alerte en ligne de 20 min sans caresse
    lastPettedAt:
      returningAfterOffline && tickedPet.needs.happiness >= 55
        ? safeNowMs
        : tickedPet.lastPettedAt,
    needsCuddle: keepHappyStartupCalm ? false : tickedPet.needsCuddle,
    needsPlay: keepHappyStartupCalm ? false : tickedPet.needsPlay,
  };

  return {
    pet: updatedPet,
    report: {
      elapsedMs: rawElapsedMs,
      clampedMs,
      clockSkewDetected: false,
      needsDelta,
      floorApplied,
    },
  };
}
