import { describe, expect, it } from 'vitest';
import gameConfigJson from '../../data/game-config.json';
import foodsJson from '../../data/foods.json';
import speciesJson from '../../data/species.json';
import {
  evaluateEvolution,
  getDominantFoodCategory,
  isEvolutionConditionMet,
} from '../../src/core/evolutionSystem';
import { PetEngine } from '../../src/core/petEngine';
import {
  createInitialPetState,
  createInitialSaveData,
  FORM_TO_LINEAGE,
  VALID_FORM_IDS,
} from '../../src/core/saveSystem';
import type {
  FoodItem,
  FormId,
  GameConfig,
  LineageId,
  PetState,
  SpeciesFormDefinition,
  StarterFormId,
} from '../../src/core/types';

const gameConfig = gameConfigJson as GameConfig;
const foods = foodsJson as FoodItem[];
const speciesList = speciesJson as SpeciesFormDefinition[];

function createStarterBabyState(starterId: StarterFormId): PetState {
  const base = createInitialPetState('Mochi', 1_000_000);
  const lineage = FORM_TO_LINEAGE[starterId];
  return {
    ...base,
    formId: starterId,
    stage: 'baby',
    lineage,
    ageSeconds: 36_000,
    discoveredForms: ['egg', starterId],
    needs: {
      hunger: 85,
      energy: 85,
      happiness: 85,
      cleanliness: 85,
    },
    careStats: {
      ...base.careStats,
      eggClicks: 5,
      totalMeals: 4,
      totalGamesPlayed: 2,
      totalPets: 2,
      totalCleans: 2,
      pcMouseClicks: 5000,
      pcKeyPresses: 5000,
    },
  };
}

function createChildState(
  childFormId: 'child_aqua' | 'child_flora' | 'child_ember'
): PetState {
  const base = createInitialPetState('Mochi', 1_000_000);
  const lineage: LineageId = FORM_TO_LINEAGE[childFormId];
  const babyId: StarterFormId =
    lineage === 'aqua'
      ? 'baby_aqua'
      : lineage === 'flora'
        ? 'baby_flora'
        : 'baby_ember';

  return {
    ...base,
    formId: childFormId,
    stage: 'child',
    lineage,
    ageSeconds: 144_000,
    discoveredForms: ['egg', babyId, childFormId],
    needs: {
      hunger: 85,
      energy: 85,
      happiness: 85,
      cleanliness: 85,
    },
    careStats: {
      ...base.careStats,
      eggClicks: 5,
      totalMeals: 15,
      totalGamesPlayed: 10,
      totalPets: 6,
      totalCleans: 6,
      pcMouseClicks: 20_000,
      pcKeyPresses: 20_000,
    },
  };
}

describe('Système d’évolution déterministe : 19 formes, 3 lignées et paliers Marathon (evolutionSystem)', () => {
  describe('Catalogue data/species.json (19 formes complètes)', () => {
    it('contient exactement les 19 formes attendues avec leurs stades et lignées', () => {
      expect(speciesList).toHaveLength(19);
      const ids = speciesList.map((s) => s.id);
      expect(ids).toEqual(VALID_FORM_IDS);

      for (const def of speciesList) {
        expect(def.lineage).toBe(FORM_TO_LINEAGE[def.id]);
      }
    });
  });

  describe('Stade Œuf : pas d’éclosion automatique au temps sans les 5 clics', () => {
    it('ne fait jamais éclore l’œuf tout seul même après 100 heures si eggClicks < 5', () => {
      const egg = createInitialPetState('Mochi', 1_000);
      egg.ageSeconds = 360_000; // 100 heures
      egg.careStats.eggClicks = 0;

      const res0 = evaluateEvolution(egg, speciesList);
      expect(res0.evolved).toBe(false);
      expect(res0.pet.formId).toBe('egg');
      expect(res0.pet.stage).toBe('egg');

      // Même à 4 clics, l'œuf n'éclot pas
      egg.careStats.eggClicks = 4;
      const res4 = evaluateEvolution(egg, speciesList);
      expect(res4.evolved).toBe(false);
      expect(res4.pet.formId).toBe('egg');

      // À 5 clics, la condition d'éclosion est remplie
      egg.careStats.eggClicks = 5;
      const res5 = evaluateEvolution(egg, speciesList);
      expect(res5.evolved).toBe(true);
      expect(res5.pet.stage).toBe('baby');
    });
  });

  describe('Paliers Marathon Baby -> Child (minAgeSeconds: 36000, minPcInputs: 10000, minCareActions: 10)', () => {
    const babyToChildCases: Array<{
      starter: StarterFormId;
      child: FormId;
      lineage: LineageId;
    }> = [
      { starter: 'baby_aqua', child: 'child_aqua', lineage: 'aqua' },
      { starter: 'baby_flora', child: 'child_flora', lineage: 'flora' },
      { starter: 'baby_ember', child: 'child_ember', lineage: 'ember' },
    ];

    it.each(babyToChildCases)(
      'bloque l’évolution de $starter vers $child si les entrées PC (pcMouseClicks + pcKeyPresses < 10000) sont insuffisantes même si l’âge est atteint',
      ({ starter, child }) => {
        const baby = createStarterBabyState(starter);
        baby.ageSeconds = 50_000; // > 36000
        baby.careStats.pcMouseClicks = 4999;
        baby.careStats.pcKeyPresses = 5000; // total = 9999 < 10000

        const blockedPc = evaluateEvolution(baby, speciesList);
        expect(blockedPc.evolved).toBe(false);
        expect(blockedPc.pet.formId).toBe(starter);

        // Bloqué si l'âge est inférieur à 36000 malgré 20000 entrées PC
        const youngBaby = createStarterBabyState(starter);
        youngBaby.ageSeconds = 35_999;
        youngBaby.careStats.pcMouseClicks = 10_000;
        youngBaby.careStats.pcKeyPresses = 10_000;
        expect(evaluateEvolution(youngBaby, speciesList).evolved).toBe(false);

        // Bloqué si moins de 10 actions de soin
        const neglectedCareBaby = createStarterBabyState(starter);
        neglectedCareBaby.careStats.totalMeals = 2;
        neglectedCareBaby.careStats.totalGamesPlayed = 2;
        neglectedCareBaby.careStats.totalPets = 2;
        neglectedCareBaby.careStats.totalCleans = 3; // total = 9 < 10
        expect(evaluateEvolution(neglectedCareBaby, speciesList).evolved).toBe(false);

        // Évolue dès que les 3 critères Marathon sont réunis
        const readyBaby = createStarterBabyState(starter);
        const evolved = evaluateEvolution(readyBaby, speciesList);
        expect(evolved.evolved).toBe(true);
        expect(evolved.previousFormId).toBe(starter);
        expect(evolved.newForm?.id).toBe(child);
        expect(evolved.pet.formId).toBe(child);
        expect(evolved.pet.stage).toBe('child');
      }
    );

    it('déclenche l’évolution Marathon via PetEngine.recordPcActivity lorsque le seuil de 10 000 entrées PC est franchi', () => {
      const save = createInitialSaveData('Mochi', 1_000);
      save.pet = createStarterBabyState('baby_aqua');
      save.pet.careStats.pcMouseClicks = 4800;
      save.pet.careStats.pcKeyPresses = 5000; // 9800 < 10000

      const engine = new PetEngine(save, gameConfig, foods, speciesList);
      expect(engine.checkEvolution().evolved).toBe(false);

      const activityResult = engine.recordPcActivity(
        { mouseClicks: 150, keyPresses: 100, activeSeconds: 60 },
        2_000
      );
      expect(activityResult.evolved).toBe(true);
      expect(activityResult.newForm?.id).toBe('child_aqua');
      expect(activityResult.pet.formId).toBe('child_aqua');
      expect(activityResult.pet.careStats.pcMouseClicks).toBe(4950);
      expect(activityResult.pet.careStats.pcKeyPresses).toBe(5100);
    });
  });

  describe('Branches adultes déterministes pour les 3 lignées (12 formes adultes)', () => {
    const lineageBranches: Array<{
      lineage: LineageId;
      childForm: 'child_aqua' | 'child_flora' | 'child_ember';
      perfectHealthyForm: FormId;
      athleticForm: FormId;
      gourmetForm: FormId;
      rebelMistakeForm: FormId;
    }> = [
      {
        lineage: 'aqua',
        childForm: 'child_aqua',
        perfectHealthyForm: 'adult_aqua_coral',
        athleticForm: 'adult_aqua_leviathan',
        gourmetForm: 'adult_aqua_pearl',
        rebelMistakeForm: 'adult_aqua_abyss',
      },
      {
        lineage: 'flora',
        childForm: 'child_flora',
        perfectHealthyForm: 'adult_flora_bloom',
        athleticForm: 'adult_flora_raptor',
        gourmetForm: 'adult_flora_truffle',
        rebelMistakeForm: 'adult_flora_thorn',
      },
      {
        lineage: 'ember',
        childForm: 'child_ember',
        perfectHealthyForm: 'adult_ember_solar',
        athleticForm: 'adult_ember_comet',
        gourmetForm: 'adult_ember_magma',
        rebelMistakeForm: 'adult_ember_eclipse',
      },
    ];

    it.each(lineageBranches)(
      'lignée $lineage : évolue de $childForm vers $perfectHealthyForm (priorité 100 : soins parfaits + healthy)',
      ({ lineage, childForm, perfectHealthyForm }) => {
        const child = createChildState(childForm);
        child.careStats.careMistakes = 1;
        child.needs.happiness = 85;
        child.careStats.foodCategoryCounts = {
          healthy: 8,
          snack: 2,
          energizing: 2,
          gourmet: 3,
        };

        const result = evaluateEvolution(child, speciesList);
        expect(result.evolved).toBe(true);
        expect(result.pet.formId).toBe(perfectHealthyForm);
        expect(result.pet.stage).toBe('adult');
        expect(result.pet.lineage).toBe(lineage);
      }
    );

    it.each(lineageBranches)(
      'lignée $lineage : évolue de $childForm vers $athleticForm (priorité 85/80 : sportif/jeux >= 8 ou nourriture energizing)',
      ({ lineage, childForm, athleticForm }) => {
        // Cas 1 : via minGamesPlayed >= 8 (avec careMistakes = 2 pour exclure la branche priorité 100)
        const sportyByGames = createChildState(childForm);
        sportyByGames.careStats.careMistakes = 2;
        sportyByGames.careStats.totalGamesPlayed = 8;
        sportyByGames.careStats.foodCategoryCounts = {
          healthy: 5,
          snack: 5,
          energizing: 1,
          gourmet: 4,
        };

        const resGames = evaluateEvolution(sportyByGames, speciesList);
        expect(resGames.evolved).toBe(true);
        expect(resGames.pet.formId).toBe(athleticForm);
        expect(resGames.pet.stage).toBe('adult');
        expect(resGames.pet.lineage).toBe(lineage);

        // Cas 2 : via preferredFoodCategory === 'energizing' (priorité 80, même avec < 8 jeux)
        const sportyByFood = createChildState(childForm);
        sportyByFood.careStats.careMistakes = 2;
        sportyByFood.careStats.totalGamesPlayed = 3;
        sportyByFood.careStats.totalMeals = 25; // Assure >= 35 actions de soin au total
        sportyByFood.careStats.foodCategoryCounts = {
          healthy: 2,
          snack: 2,
          energizing: 12,
          gourmet: 1,
        };

        const resFood = evaluateEvolution(sportyByFood, speciesList);
        expect(resFood.evolved).toBe(true);
        expect(resFood.pet.formId).toBe(athleticForm);
      }
    );

    it.each(lineageBranches)(
      'lignée $lineage : évolue de $childForm vers $gourmetForm (priorité 60 : catégorie dominante gourmet ou snack)',
      ({ lineage, childForm, gourmetForm }) => {
        // Dominante gourmet
        const gourmetChild = createChildState(childForm);
        gourmetChild.careStats.careMistakes = 2; // Exclut priorité 100
        gourmetChild.careStats.totalGamesPlayed = 3; // Exclut priorité 85 (< 8 jeux)
        gourmetChild.careStats.totalMeals = 25;
        gourmetChild.careStats.foodCategoryCounts = {
          healthy: 2,
          snack: 3,
          energizing: 1,
          gourmet: 10,
        };

        expect(getDominantFoodCategory(gourmetChild.careStats.foodCategoryCounts)).toBe(
          'gourmet'
        );

        const resGourmet = evaluateEvolution(gourmetChild, speciesList);
        expect(resGourmet.evolved).toBe(true);
        expect(resGourmet.pet.formId).toBe(gourmetForm);
        expect(resGourmet.pet.stage).toBe('adult');
        expect(resGourmet.pet.lineage).toBe(lineage);

        // Dominante snack (autorisée via allowedCategories: ["gourmet", "snack"])
        const snackChild = createChildState(childForm);
        snackChild.careStats.careMistakes = 2;
        snackChild.careStats.totalGamesPlayed = 3;
        snackChild.careStats.totalMeals = 25;
        snackChild.careStats.foodCategoryCounts = {
          healthy: 2,
          snack: 11,
          energizing: 1,
          gourmet: 2,
        };

        const resSnack = evaluateEvolution(snackChild, speciesList);
        expect(resSnack.evolved).toBe(true);
        expect(resSnack.pet.formId).toBe(gourmetForm);
      }
    );

    it.each(lineageBranches)(
      'lignée $lineage : évolue de $childForm vers $rebelMistakeForm (priorité 10 : erreurs de soin > 3)',
      ({ lineage, childForm, rebelMistakeForm }) => {
        const neglectedChild = createChildState(childForm);
        neglectedChild.careStats.careMistakes = 5;
        neglectedChild.needs.happiness = 40;
        neglectedChild.careStats.totalGamesPlayed = 2;
        neglectedChild.careStats.totalMeals = 25;

        const result = evaluateEvolution(neglectedChild, speciesList);
        expect(result.evolved).toBe(true);
        expect(result.pet.formId).toBe(rebelMistakeForm);
        expect(result.pet.stage).toBe('adult');
        expect(result.pet.lineage).toBe(lineage);
      }
    );

    it('bloque le passage à l’âge adulte si minPcInputs (40 000) n’est pas atteint', () => {
      const child = createChildState('child_ember');
      child.careStats.pcMouseClicks = 15_000;
      child.careStats.pcKeyPresses = 15_000; // 30_000 < 40_000

      const result = evaluateEvolution(child, speciesList);
      expect(result.evolved).toBe(false);
      expect(result.pet.formId).toBe('child_ember');
    });

    it('retourne null pour getDominantFoodCategory quand aucun repas n’a été consommé et valide minCareMistakes', () => {
      const emptyCounts = { healthy: 0, snack: 0, energizing: 0, gourmet: 0 };
      expect(getDominantFoodCategory(emptyCounts)).toBeNull();

      const child = createChildState('child_flora');
      child.careStats.careMistakes = 1;
      expect(
        isEvolutionConditionMet(child, {
          minAgeSeconds: 144_000,
          minCareMistakes: 3,
          priority: 10,
        })
      ).toBe(false);
    });
  });

  describe('Enregistrement sans doublon dans discoveredForms (Compendium)', () => {
    it('n’ajoute jamais de doublon dans discoveredForms si la forme cible a déjà été découverte', () => {
      const child = createChildState('child_ember');
      child.careStats.careMistakes = 0;
      child.needs.happiness = 95;
      child.careStats.foodCategoryCounts.healthy = 10;
      child.discoveredForms = [
        'egg',
        'baby_ember',
        'child_ember',
        'adult_ember_solar',
      ];

      const result = evaluateEvolution(child, speciesList);
      expect(result.evolved).toBe(true);
      expect(result.pet.formId).toBe('adult_ember_solar');

      const solarOccurrences = result.pet.discoveredForms.filter(
        (id) => id === 'adult_ember_solar'
      ).length;
      expect(solarOccurrences).toBe(1);
      expect(result.pet.discoveredForms).toEqual([
        'egg',
        'baby_ember',
        'child_ember',
        'adult_ember_solar',
      ]);
    });
  });
});
