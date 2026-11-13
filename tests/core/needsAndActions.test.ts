import { describe, expect, it } from 'vitest';
import gameConfigJson from '../../data/game-config.json';
import foodsJson from '../../data/foods.json';
import speciesJson from '../../data/species.json';
import {
  applyMiniGameResult,
  buyFoodItem,
  cleanPet,
  clickEgg,
  feedPet,
  FULL_HUNGER_THRESHOLD,
  petCharacter,
  scrubCleanPet,
  togglePetSleep,
} from '../../src/core/actionsSystem';
import {
  applyTickNeeds,
  clampNeed,
  CUDDLE_NEGLECT_ONLINE_MS,
  getCriticalNeeds,
} from '../../src/core/needsSystem';
import { PetEngine } from '../../src/core/petEngine';
import {
  createInitialPetState,
  createInitialSaveData,
  FORM_TO_LINEAGE,
  FORM_TO_STAGE,
  VALID_FORM_IDS,
} from '../../src/core/saveSystem';
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
    formId: 'baby_aqua',
    stage: 'baby',
    lineage: 'aqua',
    discoveredForms: ['egg', 'baby_aqua'],
    needs: {
      hunger: 80,
      energy: 80,
      happiness: 80,
      cleanliness: 90,
    },
    careStats: {
      ...base.careStats,
      eggClicks: 5,
    },
  };
}

describe('Système de besoins (needsSystem), actions (actionsSystem) et Sandbox (PetEngine)', () => {
  describe('Dégradation temporelle des 4 besoins (œuf, éveillé, endormi)', () => {
    it('ne fait pas baisser les jauges tant que le familier est au stade d’œuf (stage === "egg")', () => {
      const egg = createInitialPetState('Mochi', 1_000);
      const { pet: updatedEgg, needsDelta, floorApplied } = applyTickNeeds(
        egg,
        3600,
        gameConfig
      );

      expect(floorApplied).toBe(false);
      expect(needsDelta).toEqual({
        hunger: 0,
        energy: 0,
        happiness: 0,
        cleanliness: 0,
      });
      expect(updatedEgg.needs).toEqual(egg.needs);
      expect(updatedEgg.ageSeconds).toBe(3600);
      expect(updatedEgg.needsCuddle).toBe(false);
      expect(updatedEgg.needsPlay).toBe(false);
    });

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

      // cleanliness: 90 - 0.12 * 10 = 88.8
      expect(updated.needs.cleanliness).toBeCloseTo(88.8, 2);
      expect(needsDelta.cleanliness).toBeCloseTo(-1.2, 2);

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

      // En dormant (10 min) : hunger -2 (78), happiness -1 (79), cleanliness -0.3 (89.7)
      expect(asleepTick.needs.hunger).toBeCloseTo(78, 2);
      expect(asleepTick.needs.happiness).toBeCloseTo(79, 2);
      expect(asleepTick.needs.cleanliness).toBeCloseTo(89.7, 2);

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

    it('active automatiquement needsCuddle et needsPlay lorsque le bonheur baisse ou après négligence affective', () => {
      const sadPet: PetState = {
        ...createBabyPet(1_000_000),
        needs: {
          hunger: 80,
          energy: 60,
          happiness: 45,
          cleanliness: 80,
        },
      };

      const ticked = applyTickNeeds(sadPet, 60, gameConfig).pet;
      expect(ticked.needsCuddle).toBe(true);
      expect(ticked.needsPlay).toBe(true);

      // Si le familier manque de caresses en ligne depuis >= 20 min malgré un bonheur élevé
      const lonelyPet: PetState = {
        ...createBabyPet(1_000_000),
        lastPettedAt: 1_000_000,
        lastUpdatedAt: 1_000_000 + CUDDLE_NEGLECT_ONLINE_MS,
        needs: {
          hunger: 90,
          energy: 90,
          happiness: 90,
          cleanliness: 90,
        },
      };
      const lonelyTick = applyTickNeeds(lonelyPet, 10, gameConfig).pet;
      expect(lonelyTick.needsCuddle).toBe(true);

      // Si le bonheur est rempli (>= 95%), ne réclame pas de câlins même après 20 min
      const blissfulPet: PetState = {
        ...lonelyPet,
        needs: {
          ...lonelyPet.needs,
          happiness: 98,
        },
      };
      const blissfulTick = applyTickNeeds(blissfulPet, 10, gameConfig).pet;
      expect(blissfulTick.needsCuddle).toBe(false);
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

  describe('Éclosion interactive de l’œuf (clickEgg & engine.clickEgg)', () => {
    it('incrémente eggClicks de 1 à 4 sans éclore, puis éclot au 5ème clic selon le rng fourni (aqua, flora, ember)', () => {
      let egg = createInitialPetState('Mochi', 1_000);

      for (let click = 1; click <= 4; click += 1) {
        const res = clickEgg(egg, species, gameConfig, 1_000 + click * 100);
        expect(res.hatched).toBe(false);
        expect(res.eggClicks).toBe(click);
        expect(res.clicksRequired).toBe(5);
        expect(res.hatchedForm).toBeNull();
        expect(res.pet.formId).toBe('egg');
        expect(res.pet.stage).toBe('egg');
        expect(res.pet.lineage).toBe('none');
        egg = res.pet;
      }

      // 5ème clic avec rng -> 0.1 (index 0 => baby_aqua)
      const hatchAqua = clickEgg(egg, species, gameConfig, 2_000, () => 0.1);
      expect(hatchAqua.hatched).toBe(true);
      expect(hatchAqua.eggClicks).toBe(5);
      expect(hatchAqua.pet.formId).toBe('baby_aqua');
      expect(hatchAqua.pet.stage).toBe('baby');
      expect(hatchAqua.pet.lineage).toBe('aqua');
      expect(hatchAqua.hatchedForm?.id).toBe('baby_aqua');
      expect(hatchAqua.pet.discoveredForms).toEqual(['egg', 'baby_aqua']);

      // 5ème clic avec rng -> 0.5 (index 1 => baby_flora)
      const hatchFlora = clickEgg(egg, species, gameConfig, 2_000, () => 0.5);
      expect(hatchFlora.hatched).toBe(true);
      expect(hatchFlora.pet.formId).toBe('baby_flora');
      expect(hatchFlora.pet.stage).toBe('baby');
      expect(hatchFlora.pet.lineage).toBe('flora');
      expect(hatchFlora.hatchedForm?.id).toBe('baby_flora');
      expect(hatchFlora.pet.discoveredForms).toEqual(['egg', 'baby_flora']);

      // 5ème clic avec rng -> 0.9 (index 2 => baby_ember)
      const hatchEmber = clickEgg(egg, species, gameConfig, 2_000, () => 0.9);
      expect(hatchEmber.hatched).toBe(true);
      expect(hatchEmber.pet.formId).toBe('baby_ember');
      expect(hatchEmber.pet.stage).toBe('baby');
      expect(hatchEmber.pet.lineage).toBe('ember');
      expect(hatchEmber.hatchedForm?.id).toBe('baby_ember');
      expect(hatchEmber.pet.discoveredForms).toEqual(['egg', 'baby_ember']);
    });

    it('ignore clickEgg si le familier n’est plus au stade d’œuf et fonctionne via PetEngine.clickEgg', () => {
      const save = createInitialSaveData('Mochi', 1_000);
      const engine = new PetEngine(save, gameConfig, foods, species);

      for (let i = 1; i <= 4; i += 1) {
        const step = engine.clickEgg(1_000 + i * 100, () => 0.5);
        expect(step.hatched).toBe(false);
        expect(step.eggClicks).toBe(i);
      }

      const fifth = engine.clickEgg(2_000, () => 0.5);
      expect(fifth.hatched).toBe(true);
      expect(fifth.pet.formId).toBe('baby_flora');
      expect(fifth.pet.lineage).toBe('flora');

      // Un clic supplémentaire une fois éclos ne change pas la forme
      const afterHatch = engine.clickEgg(3_000, () => 0.1);
      expect(afterHatch.hatched).toBe(false);
      expect(afterHatch.pet.formId).toBe('baby_flora');
    });
  });

  describe('Pénalité de saleté (poopCount), cleanPet et nettoyage progressif à l’éponge (scrubCleanPet)', () => {
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
      // baisse de base = 0.12 * 10 = 1.2
      // pénalité poop = 3 * 0.2 * 10 = 6
      // total = 7.2 -> 60 - 7.2 = 52.8
      const ticked = applyTickNeeds(dirtyPet, 600, gameConfig).pet;
      expect(ticked.needs.cleanliness).toBeCloseTo(52.8, 2);

      // Action cleanPet : remet poopCount à 0, ajoute +35 de propreté (52.8 + 35 = 87.8)
      const cleanedResult = cleanPet(ticked, gameConfig, 2_000_000);
      expect(cleanedResult.cleaned).toBe(true);
      expect(cleanedResult.pet.poopCount).toBe(0);
      expect(cleanedResult.pet.cleaningProgress).toBe(0);
      expect(cleanedResult.pet.needs.cleanliness).toBeCloseTo(87.8, 2);
      expect(cleanedResult.pet.careStats.totalCleans).toBe(1);
    });

    it('nettoie progressivement à l’éponge (4 passages de 25%) jusqu’à 100% avec remise à zéro des crottes', () => {
      const save = createInitialSaveData('Mochi', 1_000);
      save.pet = {
        ...createBabyPet(1_000),
        poopCount: 3,
        cleaningProgress: 0,
        needs: {
          hunger: 80,
          energy: 80,
          happiness: 80,
          cleanliness: 20,
        },
      };

      const engine = new PetEngine(save, gameConfig, foods, species);

      // Passages 1 à 3 (25%, 50%, 75%)
      const scrub1 = engine.scrubClean(25, 1_100);
      expect(scrub1.completed).toBe(false);
      expect(scrub1.progress).toBe(25);
      expect(scrub1.pet.cleaningProgress).toBe(25);
      expect(scrub1.pet.poopCount).toBe(3);
      expect(scrub1.pet.needs.cleanliness).toBeGreaterThan(20);
      expect(scrub1.pet.careStats.totalCleans).toBe(0);

      const scrub2 = engine.scrubClean(25, 1_200);
      expect(scrub2.completed).toBe(false);
      expect(scrub2.progress).toBe(50);
      expect(scrub2.pet.cleaningProgress).toBe(50);

      const scrub3 = engine.scrubClean(25, 1_300);
      expect(scrub3.completed).toBe(false);
      expect(scrub3.progress).toBe(75);
      expect(scrub3.pet.cleaningProgress).toBe(75);

      // Passage 4 (100%) -> nettoyage terminé
      const scrub4 = engine.scrubClean(25, 1_400);
      expect(scrub4.completed).toBe(true);
      expect(scrub4.progress).toBe(100);
      expect(scrub4.pet.cleaningProgress).toBe(0);
      expect(scrub4.pet.poopCount).toBe(0);
      expect(scrub4.pet.needs.cleanliness).toBe(100);
      expect(scrub4.pet.careStats.totalCleans).toBe(1);

      // Test direct de scrubCleanPet avec valeur de repli si delta invalide
      const fallbackScrub = scrubCleanPet(createBabyPet(1_000), 0, gameConfig, 2_000);
      expect(fallbackScrub.progress).toBe(20);
      expect(fallbackScrub.completed).toBe(false);
    });

    it('génère des salissures en ligne uniquement après avoir mangé (digestion) via PetEngine.tick', () => {
      const save = createInitialSaveData('Mochi', 1_000);
      save.pet.formId = 'baby_aqua';
      save.pet.stage = 'baby';
      save.pet.lineage = 'aqua';
      save.pet.needs.hunger = 20;
      save.pet.foodInventory = { royal_sushi: 2, apple_fresh: 2 };

      const engine = new PetEngine(save, gameConfig, foods, species);
      // Sans avoir mangé, aucune salissure ne doit apparaître même après 1h
      const emptyTick = engine.tick(3600, 3_601_000);
      expect(emptyTick.pet.poopCount).toBe(0);

      // On nourrit le familier (Sushi Royal +32 + Pomme +22 => digestionCharge = 1.35 >= 1)
      engine.feed('royal_sushi', 3_602_000);
      engine.feed('apple_fresh', 3_603_000);
      // poopIntervalSeconds = 1800s -> 1 salissure après digestion
      const tickResult = engine.tick(1850, 5_453_000);
      expect(tickResult.pet.poopCount).toBe(1);

      const cleanResult = engine.clean(5_453_000);
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

    it('gère l’achat de nourriture (buyFoodItem), les stocks et le refus lorsque le stock est épuisé', () => {
      const apple = foods.find((f) => f.id === 'apple_fresh')!;
      let pet: PetState = {
        ...createBabyPet(10_000),
        tamaCoins: 20,
        foodInventory: {
          apple_fresh: 0,
        },
      };

      // 1. Refus de nourrir si stock = 0
      const failedFeed = feedPet(pet, apple);
      expect(failedFeed.accepted).toBe(false);
      expect(failedFeed.reason).toBe('no_stock');

      // 2. Achat de 2 pommes pour 10 coins (5 coins par pomme)
      const buyResult = buyFoodItem(pet, apple, 2);
      expect(buyResult.purchased).toBe(true);
      expect(buyResult.pet.tamaCoins).toBe(10);
      expect(buyResult.pet.foodInventory?.apple_fresh).toBe(2);

      // 3. Consommation de la première pomme -> stock passe à 1
      const hungryPet = { ...buyResult.pet, needs: { ...buyResult.pet.needs, hunger: 30 } };
      const firstFeed = feedPet(hungryPet, apple);
      expect(firstFeed.accepted).toBe(true);
      expect(firstFeed.pet.foodInventory?.apple_fresh).toBe(1);

      // 4. Consommation de la seconde pomme -> stock passe à 0
      const hungryPet2 = { ...firstFeed.pet, needs: { ...firstFeed.pet.needs, hunger: 30 } };
      const secondFeed = feedPet(hungryPet2, apple);
      expect(secondFeed.accepted).toBe(true);
      expect(secondFeed.pet.foodInventory?.apple_fresh).toBe(0);

      // 5. Troisième tentative -> rejet pour stock épuisé
      const hungryPet3 = { ...secondFeed.pet, needs: { ...secondFeed.pet.needs, hunger: 30 } };
      const thirdFeed = feedPet(hungryPet3, apple);
      expect(thirdFeed.accepted).toBe(false);
      expect(thirdFeed.reason).toBe('no_stock');

      // 6. Refus d'achat si pièces insuffisantes (2 pommes = 10 coins, or solde restant = 0)
      const poorPet: PetState = { ...secondFeed.pet, tamaCoins: 3 };
      const poorBuy = buyFoodItem(poorPet, apple, 1);
      expect(poorBuy.purchased).toBe(false);
      expect(poorBuy.reason).toBe('insufficient_coins');
    });

    it('permet l’achat et la consultation d’inventaire via PetEngine', () => {
      const engine = new PetEngine(
        createInitialSaveData('TestEngine'),
        gameConfig,
        foods,
        species
      );

      // Vérifie l'inventaire initial
      const initialInv = engine.getFoodInventory();
      expect(initialInv.apple_fresh).toBeGreaterThan(0);

      // Achat via l'engine
      const coinsBefore = engine.getState().tamaCoins;
      const buyRes = engine.buyFood('apple_fresh', 2);
      expect(buyRes.purchased).toBe(true);
      expect(buyRes.pet.tamaCoins).toBe(coinsBefore - 10);
      expect(engine.getFoodInventory().apple_fresh).toBe(initialInv.apple_fresh + 2);
    });
  });

  describe('Action petCharacter (caresse, cooldown et apaisement de needsCuddle)', () => {
    it('octroie le bonus de bonheur, apaise needsCuddle et respecte strictement petCooldownMs', () => {
      const pet: PetState = {
        ...createBabyPet(10_000),
        needsCuddle: true,
      };

      // Première caresse à t = 20_000ms
      const firstPet = petCharacter(pet, gameConfig, 20_000);
      expect(firstPet.bonusApplied).toBe(true);
      expect(firstPet.cooldownRemainingMs).toBe(0);
      expect(firstPet.pet.needsCuddle).toBe(false);
      expect(firstPet.pet.needs.happiness).toBe(80 + 18);
      expect(firstPet.pet.careStats.totalPets).toBe(1);

      // Deuxième caresse 5s plus tard (t = 25_000ms < 20_000 + 15_000) sans needsCuddle
      const secondPet = petCharacter(
        firstPet.pet,
        gameConfig,
        25_000
      );
      expect(secondPet.bonusApplied).toBe(false);
      expect(secondPet.pet.needsCuddle).toBe(false);
      expect(secondPet.cooldownRemainingMs).toBe(10_000);
      expect(secondPet.pet.needs.happiness).toBe(firstPet.pet.needs.happiness);
      expect(secondPet.pet.careStats.totalPets).toBe(1);

      // Troisième caresse après expiration du cooldown (t = 35_000ms)
      const thirdPet = petCharacter(secondPet.pet, gameConfig, 35_000);
      expect(thirdPet.bonusApplied).toBe(true);
      expect(thirdPet.cooldownRemainingMs).toBe(0);
      expect(thirdPet.pet.needs.happiness).toBe(100);
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
    it('applique le gain de bonheur, apaise needsPlay, met à jour lastPlayedAt et incrémente les victoires pour star_catch', () => {
      const pet: PetState = {
        ...createBabyPet(50_000),
        needsPlay: true,
      };
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
      expect(outcome.pet.needsPlay).toBe(false);
      expect(outcome.pet.needs.happiness).toBe(100); // 80 + 22 plafonné à 100
      expect(outcome.pet.needs.energy).toBe(74); // 80 - 6
      expect(outcome.pet.needs.hunger).toBe(76); // 80 - 4
      expect(outcome.pet.careStats.totalGamesPlayed).toBe(1);
      expect(outcome.pet.careStats.totalGamesWon).toBe(1);
      expect(outcome.pet.careStats.lastPlayedAt).toBe(60_000);
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

  describe('Méthodes Sandbox / Menu Test de PetEngine (simulateCondition, forceSetForm, forceEvolve)', () => {
    it('configure exactement les états attendus via simulateCondition', () => {
      const save = createInitialSaveData('Mochi', 1_000);
      const engine = new PetEngine(save, gameConfig, foods, species);
      engine.forceSetForm('baby_aqua', 1_100);

      // 1. hungry
      const hungryState = engine.simulateCondition('hungry', 2_000);
      expect(hungryState.needs.hunger).toBe(15);
      expect(hungryState.isSleeping).toBe(false);

      // 2. dirty
      const dirtyState = engine.simulateCondition('dirty', 3_000);
      expect(dirtyState.needs.cleanliness).toBe(15);
      expect(dirtyState.poopCount).toBe(3);
      expect(dirtyState.cleaningProgress).toBe(0);

      // 3. need_cuddle
      const cuddleState = engine.simulateCondition('need_cuddle', 4_000);
      expect(cuddleState.needsCuddle).toBe(true);
      expect(cuddleState.needs.happiness).toBe(42);
      expect(cuddleState.lastPettedAt).toBe(0);

      // 4. need_play
      const playState = engine.simulateCondition('need_play', 5_000);
      expect(playState.needsPlay).toBe(true);
      expect(playState.needs.happiness).toBe(38);
      expect(playState.needs.energy).toBeGreaterThanOrEqual(50);

      // 5. tired
      const tiredState = engine.simulateCondition('tired', 6_000);
      expect(tiredState.needs.energy).toBe(12);
      expect(tiredState.needsPlay).toBe(false);

      // 6. boost_marathon
      const beforeBoost = engine.getState();
      const boostedState = engine.simulateCondition('boost_marathon', 7_000);
      expect(boostedState.ageSeconds).toBe(beforeBoost.ageSeconds + 40 * 3600);
      expect(boostedState.careStats.pcMouseClicks).toBe(
        beforeBoost.careStats.pcMouseClicks + 7500
      );
      expect(boostedState.careStats.pcKeyPresses).toBe(
        beforeBoost.careStats.pcKeyPresses + 7500
      );
      expect(boostedState.careStats.totalMeals).toBe(beforeBoost.careStats.totalMeals + 5);
      expect(boostedState.careStats.totalGamesPlayed).toBe(
        beforeBoost.careStats.totalGamesPlayed + 3
      );
      expect(boostedState.careStats.totalPets).toBe(beforeBoost.careStats.totalPets + 4);
      expect(boostedState.careStats.totalCleans).toBe(beforeBoost.careStats.totalCleans + 3);

      // 7. full_restore
      const restoredState = engine.simulateCondition('full_restore', 8_000);
      expect(restoredState.needs).toEqual({
        hunger: 100,
        energy: 100,
        happiness: 100,
        cleanliness: 100,
      });
      expect(restoredState.poopCount).toBe(0);
      expect(restoredState.cleaningProgress).toBe(0);
      expect(restoredState.needsCuddle).toBe(false);
      expect(restoredState.needsPlay).toBe(false);
      expect(restoredState.isSleeping).toBe(false);
    });

    it('permet de passer à chacune des 19 formes via forceSetForm et d’évoluer immédiatement via forceEvolve', () => {
      const save = createInitialSaveData('Mochi', 1_000);
      const engine = new PetEngine(save, gameConfig, foods, species);

      expect(VALID_FORM_IDS).toHaveLength(19);

      for (const formId of VALID_FORM_IDS) {
        const state = engine.forceSetForm(formId, 2_000);
        expect(state.formId).toBe(formId);
        expect(state.stage).toBe(FORM_TO_STAGE[formId]);
        expect(state.lineage).toBe(FORM_TO_LINEAGE[formId]);
        expect(state.discoveredForms).toContain(formId);
        if (formId === 'egg') {
          expect(state.careStats.eggClicks).toBe(0);
        } else {
          expect(state.careStats.eggClicks).toBeGreaterThanOrEqual(5);
        }
      }

      // Test de forceEvolve sans attendre le palier Marathon
      engine.forceSetForm('egg', 3_000);
      const evolvedFromEgg = engine.forceEvolve(undefined, 3_100);
      expect(evolvedFromEgg.evolved).toBe(true);
      expect(['baby_aqua', 'baby_flora', 'baby_ember']).toContain(
        evolvedFromEgg.pet.formId
      );

      engine.forceSetForm('baby_ember', 3_200);
      const evolvedToChild = engine.forceEvolve(undefined, 3_300);
      expect(evolvedToChild.evolved).toBe(true);
      expect(evolvedToChild.pet.formId).toBe('child_ember');
      expect(evolvedToChild.pet.stage).toBe('child');
      expect(evolvedToChild.pet.lineage).toBe('ember');

      const evolvedToAdult = engine.forceEvolve('adult_ember_eclipse', 3_400);
      expect(evolvedToAdult.evolved).toBe(true);
      expect(evolvedToAdult.pet.formId).toBe('adult_ember_eclipse');
      expect(evolvedToAdult.pet.stage).toBe('adult');
      expect(evolvedToAdult.pet.lineage).toBe('ember');
    });
  });
});
