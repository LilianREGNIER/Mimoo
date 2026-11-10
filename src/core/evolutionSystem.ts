/**
 * Système d'évolution déterministe piloté par les définitions JSON (`data/species.json`).
 */

import type {
  EvolutionCondition,
  FoodCategory,
  FormId,
  PetState,
  SpeciesFormDefinition,
} from './types';

/** Ordre déterministe d'évaluation des catégories alimentaires. */
const FOOD_CATEGORIES: readonly FoodCategory[] = [
  'healthy',
  'snack',
  'energizing',
  'gourmet',
] as const;

/**
 * Détermine la catégorie alimentaire la plus consommée par le familier.
 * Retourne `null` si aucun repas n'a encore été donné.
 */
export function getDominantFoodCategory(
  counts: Record<FoodCategory, number>
): FoodCategory | null {
  let dominant: FoodCategory | null = null;
  let maxCount = 0;

  for (const category of FOOD_CATEGORIES) {
    const count = counts[category] ?? 0;
    if (Number.isFinite(count) && count > maxCount) {
      maxCount = count;
      dominant = category;
    }
  }

  return maxCount > 0 ? dominant : null;
}

/**
 * Vérifie si l'état courant du familier satisfait une condition d'évolution.
 */
export function isEvolutionConditionMet(
  pet: PetState,
  condition: EvolutionCondition
): boolean {
  if (pet.ageSeconds < condition.minAgeSeconds) {
    return false;
  }

  if (
    condition.maxCareMistakes !== undefined &&
    pet.careStats.careMistakes > condition.maxCareMistakes
  ) {
    return false;
  }

  if (
    condition.minCareMistakes !== undefined &&
    pet.careStats.careMistakes < condition.minCareMistakes
  ) {
    return false;
  }

  if (condition.preferredFoodCategory !== undefined) {
    const dominantCategory = getDominantFoodCategory(pet.careStats.foodCategoryCounts);
    if (dominantCategory !== condition.preferredFoodCategory) {
      return false;
    }
  }

  if (
    condition.minGamesPlayed !== undefined &&
    pet.careStats.totalGamesPlayed < condition.minGamesPlayed
  ) {
    return false;
  }

  if (
    condition.minHappiness !== undefined &&
    pet.needs.happiness < condition.minHappiness
  ) {
    return false;
  }

  return true;
}

/**
 * Évalue si le familier peut évoluer vers une nouvelle forme selon `speciesList`.
 * Trie les branches par `priority` décroissante et peut chaîner plusieurs évolutions
 * si l'âge cumulé franchit plusieurs stades d'un seul coup.
 */
export function evaluateEvolution(
  pet: PetState,
  speciesList: SpeciesFormDefinition[]
): {
  evolved: boolean;
  previousFormId: FormId;
  newForm: SpeciesFormDefinition | null;
  pet: PetState;
} {
  const previousFormId = pet.formId;
  let currentPet: PetState = {
    ...pet,
    needs: { ...pet.needs },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
    },
  };

  let evolved = false;
  let latestNewForm: SpeciesFormDefinition | null = null;
  const visitedForms = new Set<FormId>([currentPet.formId]);

  while (true) {
    const currentDef = speciesList.find((item) => item.id === currentPet.formId);
    if (!currentDef || !currentDef.evolutions || currentDef.evolutions.length === 0) {
      break;
    }

    const sortedBranches = [...currentDef.evolutions].sort(
      (a, b) => b.condition.priority - a.condition.priority
    );

    const matchingBranch = sortedBranches.find((branch) =>
      isEvolutionConditionMet(currentPet, branch.condition)
    );

    if (!matchingBranch) {
      break;
    }

    const targetForm = speciesList.find((item) => item.id === matchingBranch.targetFormId);
    if (!targetForm || visitedForms.has(targetForm.id)) {
      break;
    }

    visitedForms.add(targetForm.id);
    const updatedDiscovered = currentPet.discoveredForms.includes(targetForm.id)
      ? [...currentPet.discoveredForms]
      : [...currentPet.discoveredForms, targetForm.id];

    currentPet = {
      ...currentPet,
      formId: targetForm.id,
      stage: targetForm.stage,
      discoveredForms: updatedDiscovered,
    };

    evolved = true;
    latestNewForm = targetForm;
  }

  return {
    evolved,
    previousFormId,
    newForm: latestNewForm,
    pet: currentPet,
  };
}
