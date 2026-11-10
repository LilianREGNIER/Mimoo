import { describe, expect, it } from 'vitest';
import gameConfigJson from '../../data/game-config.json';
import foodsJson from '../../data/foods.json';
import speciesJson from '../../data/species.json';
import {
  applyMiniGameResult,
  cleanPet,
  feedPet,
  FULL_HUNGER_THRESHOLD,
  petCharacter,
  togglePetSleep,
} from '../../src/core/actionsSystem';
import { applyTickNeeds, clampNeed, getCriticalNeeds } from '../../src/core/needsSystem';
import { PetEngine } from '../../src/core/petEngine';
import { createInitialPetState, createInitialSaveData } from '../../src/core/saveSystem';
import type {
  FoodCategory,
  FoodItem,
  GameConfig,
  PetState,
  SpeciesFormDefinition,
} from '../../src/core/types';

const gameConfig = gameConfigJson as GameConfig;
const foods = foodsJson as FoodItem[];
const species = speciesJson as SpeciesFormDefinition[];

function createBabyPet(nowMs = 1_000_000): PetState {
  const base = createInitialPetState('Mochi', nowMs);
  return {
    ...base,
    formId: 'baby_blob',
    stage: 'baby',
    discoveredForms: ['egg', 'baby_blob'],
    needs: {
      hunger: 80,
      energy: 80,
      happiness: 80,
      cleanliness: 90,
    },
  };
}

describe('Système de besoins (needsSystem) et actions de soin (actionsSystem)', () => {
  describe('Dégradation temporelle des 4 besoins (éveillé vs endormi)', () => {
    it('dégrade les 4 jauges au rythme éveillé (decayPerMinuteAwake) et incrémente l’âge', () => {
      const pet = createBabyPet();
      // 10 minutes = 600 secondes
      const { pet: updated, needsDelta, floorApplied } = applyTickNeeds(
        pet,
        600,
        gameConfig
      );

      expect(floorApplied).toBe(false);
      // hunger: 80 - 0.6 * 10 = 74
      expect(updated.needs.hunger).toBeCloseTo(74, 2);
      expect(needsDelta.hunger).toBeCloseTo(-6, 2);

      // energy: 80 - 0.45 * 10 = 75.5
      expect(updated.needs.energy).toBeCloseTo(75.5, 2);
      expect(needsDelta.energy).toBeCloseTo(-4.5, 2);

      // happiness: 80 - 0.5 * 10 = 75
      expect(updated.needs.happiness).toBeCloseTo(75, 2);
      expect(needsDelta.happiness).toBeCloseTo(-5, 2);

      // cleanliness: 90 - 0.35 * 10 = 86.5
      expect(updated.needs.cleanliness).toBeCloseTo(86.5, 2);
      expect(needsDelta.cleanliness).toBeCloseTo(-3.5, 2);

      expect(updated.ageSeconds).toBe(600);
    });

    it('dégrade plus lentement la faim, le bonheur et la propreté lorsque le familier dort', () => {
      const awakePet = createBabyPet();
      const sleepingPet: PetState = {
        ...createBabyPet(),
        isSleeping: true,
        needs: {
          hunger: 80,
          energy: 50,
          happiness: 80,
          cleanliness: 90,
        },
      };

      const awakeTick = applyTickNeeds(awakePet, 600, gameConfig).pet;
      const asleepTick = applyTickNeeds(sleepingPet, 600, gameConfig).pet;

      // En dormant (10 min) : hunger -2 (78), happiness -1 (79), cleanliness -1 (89)
      expect(asleepTick.needs.hunger).toBeCloseTo(78, 2);
      expect(asleepTick.needs.happiness).toBeCloseTo(79, 2);
      expect(asleepTick.needs.cleanliness).toBeCloseTo(89, 2);

      expect(asleepTick.needs.hunger).toBeGreaterThan(awakeTick.needs.hunger);
      expect(asleepTick.needs.happiness).toBeGreaterThan(awakeTick.needs.happiness);
      expect(asleepTick.needs.cleanliness).toBeGreaterThan(awakeTick.needs.cleanliness);
    });

    it('récupère de l’énergie pendant le sommeil et plafonne strictement la jauge à 100', () => {
      const sleepingPet: PetState = {
        ...createBabyPet(),
        isSleeping: true,
        needs: {
          hunger: 80,
          energy: 50,
          happiness: 80,
          cleanliness: 90,
        },
      };

      // 10 minutes de sommeil : +2.4 * 10 = +24 points d'énergie -> 74
      const after10Min = applyTickNeeds(sleepingPet, 600, gameConfig);
      expect(after10Min.pet.needs.energy).toBeCloseTo(74, 2);
      expect(after10Min.needsDelta.energy).toBeCloseTo(24, 2);

      // 60 minutes supplémentaires : 74 + 2.4 * 60 = 218 -> plafonné à 100
      const after70Min = applyTickNeeds(after10Min.pet, 3600, gameConfig);
      expect(after70Min.pet.needs.energy).toBe(100);
    });

    it('bascule correctement le sommeil (togglePetSleep) sauf pour un œuf qui reste éveillé', () => {
      const egg = createInitialPetState('Mochi', 1_000);
      const eggToggle = togglePetSleep(egg, 2_000);
      expect(eggToggle.isSleeping).toBe(false);
      expect(eggToggle.pet.isSleeping).toBe(false);

      const baby = createBabyPet(1_000);
      const sleepOn = togglePetSleep(baby, 2_000);
      expect(sleepOn.isSleeping).toBe(true);
      expect(sleepOn.pet.isSleeping).toBe(true);

      const sleepOff = togglePetSleep(sleepOn.pet, 3_000);
      expect(sleepOff.isSleeping).toBe(false);
      expect(sleepOff.pet.isSleeping).toBe(false);
    });

    it('protège clampNeed et identifie correctement les besoins critiques', () => {
      expect(clampNeed(Number.NaN)).toBe(0);
      expect(clampNeed(Number.POSITIVE_INFINITY)).toBe(100);
      expect(clampNeed(Number.NEGATIVE_INFINITY)).toBe(0);
      expect(clampNeed(-12.5)).toBe(0);
      expect(clampNeed(142.8)).toBe(100);

      const critical = getCriticalNeeds(
        { hunger: 24.9, energy: 25, happiness: 10, cleanliness: 80 },
        gameConfig.criticalThreshold
      );
      expect(critical).toEqual(['hunger', 'happiness']);
    });
  });

  describe('Pénalité de saleté (poopCount) et action cleanPet', () => {
    it('applique la pénalité de propreté proportionnelle à poopCount et nettoie avec cleanPet', () => {
      const dirtyPet: PetState = {
        ...createBabyPet(),
        poopCount: 3,
        needs: {
          hunger: 80,
          energy: 80,
          happiness: 80,
          cleanliness: 60,
        },
      };

      // 10 minutes avec 3 salissures :
      // baisse de base = 0.35 * 10 = 3.5
      // pénalité poop = 3 * 0.4 * 10 = 12
      // total = 15.5 -> 60 - 15.5 = 44.5
      const ticked = applyTickNeeds(dirtyPet, 600, gameConfig).pet;
      expect(ticked.needs.cleanliness).toBeCloseTo(44.5, 2);

      // Action cleanPet : remet poopCount à 0, ajoute +35 de propreté (44.5 + 35 = 79.5)
      const cleanedResult = cleanPet(ticked, gameConfig, 2_000_000);
      expect(cleanedResult.cleaned).toBe(true);
      expect(cleanedResult.pet.poopCount).toBe(0);
      expect(cleanedResult.pet.needs.cleanliness).toBeCloseTo(79.5, 2);
      expect(cleanedResult.pet.careStats.totalCleans).toBe(1);
    });

    it('génère des salissures périodiques en ligne via PetEngine.tick (hors stade œuf et éveillé)', () => {
      const save = createInitialSaveData('Mochi', 1_000);
      save.pet.formId = 'baby_blob';
      save.pet.stage = 'baby';

      const engine = new PetEngine(save, gameConfig, foods, species);
      // poopIntervalSeconds = 900s
      const tickResult = engine.tick(1850, 1_851_000);
      expect(tickResult.pet.poopCount).toBe(2);

      const cleanResult = engine.clean(1_852_000);
      expect(cleanResult.cleaned).toBe(true);
      expect(cleanResult.pet.poopCount).toBe(0);
    });
  });

  describe('Alimentation (feedPet) et catalogue data/foods.json', () => {
    it('refuse de nourrir un œuf, un familier endormi ou un familier déjà rassasié (hunger >= 98)', () => {
      const apple = foods.find((f) => f.id === 'apple_fresh')!;

      // 1. Stade œuf
      const egg = createInitialPetState('Mochi', 1_000);
      const eggFeed = feedPet(egg, apple, 2_000);
      expect(eggFeed.accepted).toBe(false);
      expect(eggFeed.reason).toBe('egg_cannot_eat');

      // 2. Endormi
      const sleepingBaby: PetState = {
        ...createBabyPet(),
        isSleeping: true,
      };
      const sleepFeed = feedPet(sleepingBaby, apple, 2_000);
      expect(sleepFeed.accepted).toBe(false);
      expect(sleepFeed.reason).toBe('sleeping');

      // 3. Rassasié (hunger >= 98)
      const fullBaby: PetState = {
        ...createBabyPet(),
        needs: {
          hunger: FULL_HUNGER_THRESHOLD,
          energy: 70,
          happiness: 70,
          cleanliness: 70,
        },
      };
      const fullFeed = feedPet(fullBaby, apple, 2_000);
      expect(fullFeed.accepted).toBe(false);
      expect(fullFeed.reason).toBe('full');
    });

    it('applique les effets de chaque aliment de data/foods.json et comptabilise les catégories', () => {
      expect(foods.length).toBeGreaterThanOrEqual(5);

      let pet: PetState = {
        ...createBabyPet(1_000),
        needs: {
          hunger: 20,
          energy: 30,
          happiness: 30,
          cleanliness: 70,
        },
      };

      const expectedCounts: Record<FoodCategory, number> = {
        healthy: 0,
        snack: 0,
        energizing: 0,
        gourmet: 0,
      };

      for (const food of foods) {
        // Réduire la faim avant chaque repas pour éviter d'atteindre le seuil de satiété (98)
        pet = {
          ...pet,
          needs: {
            ...pet.needs,
            hunger: 30,
          },
        };

        const beforeNeeds = { ...pet.needs };
        const result = feedPet(pet, food, pet.lastUpdatedAt + 5_000);

        expect(result.accepted).toBe(true);
        expect(result.pet.needs.hunger).toBe(
          clampNeed(beforeNeeds.hunger + (food.effects.hunger ?? 0))
        );
        expect(result.pet.needs.energy).toBe(
          clampNeed(beforeNeeds.energy + (food.effects.energy ?? 0))
        );
        expect(result.pet.needs.happiness).toBe(
          clampNeed(beforeNeeds.happiness + (food.effects.happiness ?? 0))
        );
        expect(result.pet.needs.cleanliness).toBe(
          clampNeed(beforeNeeds.cleanliness + (food.effects.cleanliness ?? 0))
        );

        expectedCounts[food.category] += 1;
        pet = result.pet;
      }

      expect(pet.careStats.totalMeals).toBe(foods.length);
      expect(pet.careStats.foodCategoryCounts).toEqual(expectedCounts);
      expect(pet.careStats.foodCategoryCounts.healthy).toBe(2);
      expect(pet.careStats.foodCategoryCounts.energizing).toBe(1);
      expect(pet.careStats.foodCategoryCounts.snack).toBe(1);
      expect(pet.careStats.foodCategoryCounts.gourmet).toBe(1);
    });
  });

  describe('Action petCharacter (caresse et cooldown)', () => {
    it('octroie le bonus de bonheur et respecte strictement petCooldownMs', () => {
      const pet = createBabyPet(10_000);

      // Première caresse à t = 20_000ms
      const firstPet = petCharacter(pet, gameConfig, 20_000);
      expect(firstPet.bonusApplied).toBe(true);
      expect(firstPet.cooldownRemainingMs).toBe(0);
      expect(firstPet.pet.needs.happiness).toBe(80 + gameConfig.petHappinessBonus);
      expect(firstPet.pet.careStats.totalPets).toBe(1);

      // Deuxième caresse 5s plus tard (t = 25_000ms < 20_000 + 15_000)
      const secondPet = petCharacter(firstPet.pet, gameConfig, 25_000);
      expect(secondPet.bonusApplied).toBe(false);
      expect(secondPet.cooldownRemainingMs).toBe(10_000);
      expect(secondPet.pet.needs.happiness).toBe(firstPet.pet.needs.happiness);
      expect(secondPet.pet.careStats.totalPets).toBe(1);

      // Troisième caresse après expiration du cooldown (t = 35_000ms)
      const thirdPet = petCharacter(secondPet.pet, gameConfig, 35_000);
      expect(thirdPet.bonusApplied).toBe(true);
      expect(thirdPet.cooldownRemainingMs).toBe(0);
      expect(thirdPet.pet.needs.happiness).toBe(80 + gameConfig.petHappinessBonus * 2);
      expect(thirdPet.pet.careStats.totalPets).toBe(2);
    });

    it('n’applique pas de bonus de caresse si le familier dort', () => {
      const sleepingPet: PetState = {
        ...createBabyPet(10_000),
        isSleeping: true,
      };
      const result = petCharacter(sleepingPet, gameConfig, 30_000);
      expect(result.bonusApplied).toBe(false);
      expect(result.pet.careStats.totalPets).toBe(0);
    });
  });

  describe('Résultats des 2 mini-jeux (star_catch et rps_duel)', () => {
    it('applique le gain de bonheur, le coût d’énergie/faim et incrémente les victoires pour star_catch', () => {
      const pet = createBabyPet(50_000);
      const outcome = applyMiniGameResult(
        pet,
        {
          gameId: 'star_catch',
          score: 15,
          maxScore: 15,
          won: true,
        },
        60_000
      );

      // Score parfait + gagné => happinessGain = 10 + 12 = 22
      expect(outcome.happinessGain).toBe(22);
      expect(outcome.energyCost).toBe(6);
      expect(outcome.pet.needs.happiness).toBe(100); // 80 + 22 plafonné à 100
      expect(outcome.pet.needs.energy).toBe(74); // 80 - 6
      expect(outcome.pet.needs.hunger).toBe(76); // 80 - 4
      expect(outcome.pet.careStats.totalGamesPlayed).toBe(1);
      expect(outcome.pet.careStats.totalGamesWon).toBe(1);
    });

    it('gère une défaite à rps_duel avec bonus de participation et protège la faim sous le seuil 10', () => {
      const hungryPet: PetState = {
        ...createBabyPet(50_000),
        needs: {
          hunger: 12,
          energy: 40,
          happiness: 50,
          cleanliness: 80,
        },
      };

      const outcome = applyMiniGameResult(
        hungryPet,
        {
          gameId: 'rps_duel',
          score: 1,
          maxScore: 3,
          won: false,
        },
        60_000
      );

      expect(outcome.happinessGain).toBe(5);
      expect(outcome.energyCost).toBe(6);
      expect(outcome.pet.needs.happiness).toBe(55);
      expect(outcome.pet.needs.energy).toBe(34);
      // 12 - 4 est retenu à 10
      expect(outcome.pet.needs.hunger).toBe(10);
      expect(outcome.pet.careStats.totalGamesPlayed).toBe(1);
      expect(outcome.pet.careStats.totalGamesWon).toBe(0);
    });
  });
});
