/**
 * Système d'actions de soin et d'interactions avec le familier :
 * éclosion interactive de l'œuf, alimentation, caresses, sommeil,
 * nettoyage (classique et à l'éponge) et résultats de mini-jeux.
 */

import { clampNeed } from './needsSystem';
import { FORM_TO_LINEAGE, FORM_TO_STAGE, isValidFormId } from './saveSystem';
import type {
  CosmeticItem,
  CosmeticSlot,
  FoodItem,
  FriendPetProfile,
  GameConfig,
  MiniGameResult,
  NeedsState,
  PetState,
  SpeciesFormDefinition,
  StarterFormId,
} from './types';

/** Seuil de satiété à partir duquel le familier refuse de manger davantage. */
export const FULL_HUNGER_THRESHOLD = 98;

/** Liste des 3 starters bébés possibles lors de l'éclosion de l'œuf. */
export const STARTER_FORM_IDS: readonly StarterFormId[] = [
  'baby_aqua',
  'baby_flora',
  'baby_ember',
] as const;

/**
 * Clique sur l'œuf pour le faire osciller et fissurer jusqu'à l'éclosion.
 * - Si `pet.stage !== 'egg'`, retourne `hatched: false`.
 * - Incrémente `careStats.eggClicks`.
 * - Lorsque `eggClicks >= (config.eggClicksRequired || 5)`, choisit un starter aléatoire
 *   parmi `['baby_aqua', 'baby_flora', 'baby_ember']` via `rng ?? Math.random`.
 */
export function clickEgg(
  pet: PetState,
  speciesList: SpeciesFormDefinition[],
  config: GameConfig,
  nowMs?: number,
  rng?: () => number
): {
  pet: PetState;
  hatched: boolean;
  eggClicks: number;
  clicksRequired: number;
  hatchedForm: SpeciesFormDefinition | null;
} {
  const clicksRequired =
    typeof config.eggClicksRequired === 'number' &&
    Number.isFinite(config.eggClicksRequired) &&
    config.eggClicksRequired > 0
      ? Math.floor(config.eggClicksRequired)
      : 5;

  const currentClicks =
    typeof pet.careStats.eggClicks === 'number' &&
    Number.isFinite(pet.careStats.eggClicks) &&
    pet.careStats.eggClicks >= 0
      ? Math.floor(pet.careStats.eggClicks)
      : 0;

  if (pet.stage !== 'egg') {
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
      hatched: false,
      eggClicks: currentClicks,
      clicksRequired,
      hatchedForm: null,
    };
  }

  const safeNow =
    nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt;
  const nextEggClicks = currentClicks + 1;

  if (nextEggClicks < clicksRequired) {
    const updatedEgg: PetState = {
      ...pet,
      lastUpdatedAt: safeNow,
      needs: { ...pet.needs },
      discoveredForms: [...pet.discoveredForms],
      position: { ...pet.position },
      careStats: {
        ...pet.careStats,
        foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
        eggClicks: nextEggClicks,
      },
    };

    return {
      pet: updatedEgg,
      hatched: false,
      eggClicks: nextEggClicks,
      clicksRequired,
      hatchedForm: null,
    };
  }

  const randomFn = rng ?? Math.random;
  const rawRandom = randomFn();
  const normalizedRandom = Number.isFinite(rawRandom)
    ? Math.min(0.999999, Math.max(0, rawRandom))
    : 0;
  const starterIndex = Math.floor(normalizedRandom * STARTER_FORM_IDS.length);
  const chosenStarterId: StarterFormId = STARTER_FORM_IDS[starterIndex] ?? 'baby_aqua';

  const hatchedForm = speciesList.find((item) => item.id === chosenStarterId) ?? null;
  const nextLineage = hatchedForm?.lineage ?? FORM_TO_LINEAGE[chosenStarterId];
  const updatedDiscovered = pet.discoveredForms.includes(chosenStarterId)
    ? [...pet.discoveredForms]
    : [...pet.discoveredForms, chosenStarterId];

  const hatchedPet: PetState = {
    ...pet,
    formId: chosenStarterId,
    stage: hatchedForm?.stage ?? 'baby',
    lineage: nextLineage,
    isSleeping: false,
    lastUpdatedAt: safeNow,
    needs: { ...pet.needs },
    discoveredForms: updatedDiscovered,
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      eggClicks: nextEggClicks,
    },
  };

  return {
    pet: hatchedPet,
    hatched: true,
    eggClicks: nextEggClicks,
    clicksRequired,
    hatchedForm,
  };
}

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

  if (pet.foodInventory && typeof pet.foodInventory[food.id] === 'number') {
    if (pet.foodInventory[food.id] <= 0) {
      return { pet, accepted: false, reason: 'no_stock' };
    }
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
    tamaCoins: (pet.tamaCoins ?? 0) + 5,
    foodInventory:
      pet.foodInventory && typeof pet.foodInventory[food.id] === 'number'
        ? { ...pet.foodInventory, [food.id]: Math.max(0, pet.foodInventory[food.id] - 1) }
        : pet.foodInventory,
    ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
    equippedCosmetics: {
      ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
    },
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
 * Achète des portions de nourriture dans la boutique avec des pièces `tamaCoins`.
 */
export function buyFoodItem(
  pet: PetState,
  food: FoodItem,
  quantity = 1
): {
  pet: PetState;
  purchased: boolean;
  reason?: 'insufficient_coins' | 'invalid_quantity';
} {
  const safeQty = Math.max(1, Math.floor(quantity));
  const price = typeof food.price === 'number' && food.price > 0 ? food.price : 5;
  const totalPrice = price * safeQty;

  const currentCoins = Number.isFinite(pet.tamaCoins) ? pet.tamaCoins : 0;
  if (currentCoins < totalPrice) {
    return { pet, purchased: false, reason: 'insufficient_coins' };
  }

  const inventory = { ...(pet.foodInventory ?? {}) };
  const currentCount = inventory[food.id] ?? 0;
  inventory[food.id] = currentCount + safeQty;

  const updatedPet: PetState = {
    ...pet,
    tamaCoins: currentCoins - totalPrice,
    foodInventory: inventory,
  };

  return {
    pet: updatedPet,
    purchased: true,
  };
}

/**
 * Caresse le familier. Octroie un bonus de bonheur si le familier ne dort pas
 * et que le délai de recharge (`config.petCooldownMs`) est écoulé ou que `pet.needsCuddle === true`.
 * Apaise systématiquement `needsCuddle = false` lorsque le familier est éveillé.
 */
export function petCharacter(
  pet: PetState,
  config: GameConfig,
  nowMs: number
): { pet: PetState; bonusApplied: boolean; cooldownRemainingMs: number } {
  const safeNow = Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt;
  const cooldownMs = Math.max(0, config.petCooldownMs);
  const elapsed = safeNow - pet.lastPettedAt;

  if (pet.isSleeping && !pet.needsCuddle) {
    const remaining =
      pet.lastPettedAt > 0 ? Math.max(0, cooldownMs - Math.max(0, elapsed)) : 0;
    return {
      pet,
      bonusApplied: false,
      cooldownRemainingMs: remaining,
    };
  }

  const isCooldownElapsed =
    Boolean(pet.needsCuddle) || pet.lastPettedAt <= 0 || elapsed >= cooldownMs;
  if (!isCooldownElapsed) {
    const appeasedPet: PetState = {
      ...pet,
      needsCuddle: false,
      needs: { ...pet.needs },
      discoveredForms: [...pet.discoveredForms],
      position: { ...pet.position },
      ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
      equippedCosmetics: {
        ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
      },
      careStats: {
        ...pet.careStats,
        foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      },
    };
    return {
      pet: appeasedPet,
      bonusApplied: false,
      cooldownRemainingMs: Math.max(0, cooldownMs - Math.max(0, elapsed)),
    };
  }

  const happinessBonus = Math.max(
    config.petHappinessBonus,
    pet.needsCuddle ? 18 : 8
  );

  const updatedPet: PetState = {
    ...pet,
    isSleeping: false,
    lastUpdatedAt: safeNow,
    lastPettedAt: safeNow,
    needsCuddle: false,
    needs: {
      ...pet.needs,
      happiness: clampNeed(pet.needs.happiness + happinessBonus),
    },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    tamaCoins: (pet.tamaCoins ?? 0) + 4,
    ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
    equippedCosmetics: {
      ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
    },
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
 * remet `poopCount` et `cleaningProgress` à `0`, augmente la propreté et incrémente `careStats.totalCleans`.
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
    cleaningProgress: 0,
    lastUpdatedAt:
      nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt,
    needs: {
      ...pet.needs,
      cleanliness: nextCleanliness,
    },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    tamaCoins: (pet.tamaCoins ?? 0) + 10,
    ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
    equippedCosmetics: {
      ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
    },
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
 * Frotte le familier avec l'éponge interactive :
 * - Augmente `pet.cleaningProgress` de `scrubDelta` et augmente progressivement `needs.cleanliness`.
 * - Lorsque `cleaningProgress >= 100`, remet `cleaningProgress = 0`, `poopCount = 0`,
 *   `needs.cleanliness = 100`, incrémente `careStats.totalCleans` et retourne `completed: true`.
 */
export function scrubCleanPet(
  pet: PetState,
  scrubDelta: number,
  config: GameConfig,
  nowMs?: number
): { pet: PetState; progress: number; completed: boolean } {
  const safeNow =
    nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt;
  const safeDelta =
    typeof scrubDelta === 'number' && Number.isFinite(scrubDelta) && scrubDelta > 0
      ? scrubDelta
      : 20;

  const currentProgress =
    typeof pet.cleaningProgress === 'number' &&
    Number.isFinite(pet.cleaningProgress) &&
    pet.cleaningProgress >= 0
      ? pet.cleaningProgress
      : 0;

  const rawProgress = currentProgress + safeDelta;

  if (rawProgress >= 100) {
    const completedPet: PetState = {
      ...pet,
      poopCount: 0,
      cleaningProgress: 0,
      lastUpdatedAt: safeNow,
      needs: {
        ...pet.needs,
        cleanliness: 100,
      },
      discoveredForms: [...pet.discoveredForms],
      position: { ...pet.position },
      tamaCoins: (pet.tamaCoins ?? 0) + 10,
      ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
      equippedCosmetics: {
        ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
      },
      careStats: {
        ...pet.careStats,
        foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
        totalCleans: pet.careStats.totalCleans + 1,
      },
    };

    return {
      pet: completedPet,
      progress: 100,
      completed: true,
    };
  }

  const nextProgress = Math.min(99, Math.round(rawProgress * 100) / 100);
  const baseBonus = Math.max(35, config.cleanlinessBonusPerClean || 35);
  const progressiveGain = (safeDelta / 100) * baseBonus;
  const nextCleanliness = clampNeed(pet.needs.cleanliness + progressiveGain);

  const inProgressPet: PetState = {
    ...pet,
    cleaningProgress: nextProgress,
    lastUpdatedAt: safeNow,
    needs: {
      ...pet.needs,
      cleanliness: nextCleanliness,
    },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
    equippedCosmetics: {
      ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
    },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
    },
  };

  return {
    pet: inProgressPet,
    progress: nextProgress,
    completed: false,
  };
}

/**
 * Applique les effets d'une session de mini-jeu :
 * - Gain de bonheur proportionnel au score (`+10` à `+22` si gagné, `+5` si participé).
 * - Coût d'énergie (`6` points) et de faim (`4` points sans descendre sous `10`).
 * - Remet `needsPlay = false` et met à jour `careStats.lastPlayedAt = safeNow`.
 * - Incrémente `totalGamesPlayed` et éventuellement `totalGamesWon`.
 * - Ajoute `+20` `tamaCoins` en cas de victoire ou `+8` `tamaCoins` en cas de participation.
 */
export function applyMiniGameResult(
  pet: PetState,
  result: MiniGameResult,
  nowMs?: number
): { pet: PetState; happinessGain: number; energyCost: number } {
  const safeNow =
    nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt;
  const safeMax = Number.isFinite(result.maxScore) && result.maxScore > 0 ? result.maxScore : 1;
  const safeScore = Number.isFinite(result.score) ? Math.max(0, result.score) : 0;
  const ratio = Math.min(1, Math.max(0, safeScore / safeMax));

  const happinessGain = result.won ? Math.round(10 + ratio * 12) : 5;
  const energyCost = 6;
  const hungerCost = 4;
  const coinsReward = result.won ? 20 : 8;

  const currentHunger = clampNeed(pet.needs.hunger);
  const nextHunger =
    currentHunger > 10 ? Math.max(10, clampNeed(currentHunger - hungerCost)) : currentHunger;

  const updatedPet: PetState = {
    ...pet,
    lastUpdatedAt: safeNow,
    needsPlay: false,
    needs: {
      ...pet.needs,
      hunger: nextHunger,
      energy: clampNeed(pet.needs.energy - energyCost),
      happiness: clampNeed(pet.needs.happiness + happinessGain),
    },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    tamaCoins: (pet.tamaCoins ?? 0) + coinsReward,
    ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
    equippedCosmetics: {
      ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
    },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      totalGamesPlayed: pet.careStats.totalGamesPlayed + 1,
      totalGamesWon: pet.careStats.totalGamesWon + (result.won ? 1 : 0),
      lastPlayedAt: safeNow,
    },
  };

  return {
    pet: updatedPet,
    happinessGain,
    energyCost,
  };
}

/**
 * Achète un objet cosmétique dans la boutique avec des `tamaCoins` et l'équipe automatiquement.
 */
export function buyCosmeticItem(
  pet: PetState,
  item: CosmeticItem
): {
  pet: PetState;
  purchased: boolean;
  reason?: 'already_owned' | 'insufficient_coins';
} {
  const owned = Array.isArray(pet.ownedCosmetics) ? pet.ownedCosmetics : [];
  if (owned.includes(item.id)) {
    return { pet, purchased: false, reason: 'already_owned' };
  }

  const currentCoins = Number.isFinite(pet.tamaCoins) ? pet.tamaCoins : 0;
  if (currentCoins < item.price) {
    return { pet, purchased: false, reason: 'insufficient_coins' };
  }

  const currentEquipped = pet.equippedCosmetics ?? {
    hat: null,
    accessory: null,
    aura: null,
  };

  const updatedPet: PetState = {
    ...pet,
    needs: { ...pet.needs },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
    },
    tamaCoins: Math.max(0, currentCoins - item.price),
    ownedCosmetics: [...owned, item.id],
    equippedCosmetics: {
      ...currentEquipped,
      [item.slot]: item.id,
    },
  };

  return {
    pet: updatedPet,
    purchased: true,
  };
}

/**
 * Équipe ou déséquipe (`itemId === null`) un objet cosmétique sur un emplacement donné.
 */
export function equipCosmeticItem(
  pet: PetState,
  slot: CosmeticSlot,
  itemId: string | null
): { pet: PetState; equipped: boolean } {
  const owned = Array.isArray(pet.ownedCosmetics) ? pet.ownedCosmetics : [];
  const currentEquipped = pet.equippedCosmetics ?? {
    hat: null,
    accessory: null,
    aura: null,
  };

  if (itemId === null) {
    const updatedPet: PetState = {
      ...pet,
      needs: { ...pet.needs },
      discoveredForms: [...pet.discoveredForms],
      position: { ...pet.position },
      careStats: {
        ...pet.careStats,
        foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      },
      ownedCosmetics: [...owned],
      equippedCosmetics: {
        ...currentEquipped,
        [slot]: null,
      },
    };
    return { pet: updatedPet, equipped: true };
  }

  if (!owned.includes(itemId)) {
    return { pet, equipped: false };
  }

  const updatedPet: PetState = {
    ...pet,
    needs: { ...pet.needs },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
    },
    ownedCosmetics: [...owned],
    equippedCosmetics: {
      ...currentEquipped,
      [slot]: itemId,
    },
  };

  return { pet: updatedPet, equipped: true };
}

/**
 * Fait jouer le familier avec le Tamagotchi d'un ami en visite (Salon Online ou Code Passeport).
 * Octroie `+22` de bonheur, `+25` `tamaCoins`, apaise `needsPlay` et `needsCuddle`,
 * et incrémente `totalGamesPlayed` ainsi que `totalGamesWon`.
 */
export function playTogetherWithFriend(
  pet: PetState,
  nowMs?: number
): { pet: PetState; happinessGain: number; coinsEarned: number } {
  const safeNow =
    nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : pet.lastUpdatedAt;
  const happinessGain = 22;
  const coinsEarned = 25;

  const updatedPet: PetState = {
    ...pet,
    isSleeping: false,
    lastUpdatedAt: safeNow,
    needsPlay: false,
    needsCuddle: false,
    needs: {
      ...pet.needs,
      happiness: clampNeed(pet.needs.happiness + happinessGain),
    },
    discoveredForms: [...pet.discoveredForms],
    position: { ...pet.position },
    tamaCoins: (pet.tamaCoins ?? 0) + coinsEarned,
    ownedCosmetics: [...(pet.ownedCosmetics ?? [])],
    equippedCosmetics: {
      ...(pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null }),
    },
    careStats: {
      ...pet.careStats,
      foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
      totalGamesPlayed: pet.careStats.totalGamesPlayed + 1,
      totalGamesWon: pet.careStats.totalGamesWon + 1,
      lastPlayedAt: safeNow,
    },
  };

  return {
    pet: updatedPet,
    happinessGain,
    coinsEarned,
  };
}

/** Alias de `playTogetherWithFriend`. */
export const playWithFriendPet = playTogetherWithFriend;

/**
 * Encode le profil du familier en un Code Passeport Tamagotchi portable (`TAMA-...`).
 * Utilise `btoa(encodeURIComponent(json))` pour être 100 % compatible navigateur et Node sans `Buffer`.
 */
export function encodeFriendPassport(pet: PetState, ownerName?: string): string {
  const safeOwner =
    typeof ownerName === 'string' && ownerName.trim().length > 0
      ? ownerName.trim()
      : 'Ami';

  const payload = {
    n: pet.name || 'Mochi',
    o: safeOwner,
    f: pet.formId,
    s: pet.stage,
    l: pet.lineage,
    c: pet.equippedCosmetics ?? { hat: null, accessory: null, aura: null },
    h: Math.round(clampNeed(pet.needs.happiness)),
  };

  const json = JSON.stringify(payload);
  const b64 = btoa(encodeURIComponent(json));
  return `TAMA-${b64}`;
}

/** Alias de `encodeFriendPassport`. */
export const exportPassportCode = encodeFriendPassport;

/**
 * Décode un Code Passeport Tamagotchi (`TAMA-...`) en un `FriendPetProfile` valide,
 * ou retourne `null` si le code est invalide ou corrompu.
 */
export function decodeFriendPassport(code: string): FriendPetProfile | null {
  if (typeof code !== 'string') {
    return null;
  }

  const trimmed = code.trim();
  if (!trimmed.toUpperCase().startsWith('TAMA-')) {
    return null;
  }

  const b64 = trimmed.slice(5).trim();
  if (!b64) {
    return null;
  }

  try {
    const json = decodeURIComponent(atob(b64));
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (!isValidFormId(record.f)) {
      return null;
    }

    const formId = record.f;
    const rawName =
      typeof record.n === 'string' && record.n.trim().length > 0
        ? record.n.trim()
        : 'Mochi';
    const rawOwner =
      typeof record.o === 'string' && record.o.trim().length > 0
        ? record.o.trim()
        : 'Ami';

    const rawCosmetics =
      typeof record.c === 'object' && record.c !== null && !Array.isArray(record.c)
        ? (record.c as Record<string, unknown>)
        : {};

    return {
      id: `passport_${formId}_${rawName}`,
      name: rawName,
      ownerName: rawOwner,
      formId,
      stage: FORM_TO_STAGE[formId],
      lineage: FORM_TO_LINEAGE[formId],
      equippedCosmetics: {
        hat: typeof rawCosmetics.hat === 'string' ? rawCosmetics.hat : null,
        accessory:
          typeof rawCosmetics.accessory === 'string'
            ? rawCosmetics.accessory
            : null,
        aura: typeof rawCosmetics.aura === 'string' ? rawCosmetics.aura : null,
      },
      happiness: clampNeed(typeof record.h === 'number' ? record.h : 85),
      animationState: 'happy',
    };
  } catch {
    return null;
  }
}

/** Alias de `decodeFriendPassport`. */
export const importPassportCode = decodeFriendPassport;
