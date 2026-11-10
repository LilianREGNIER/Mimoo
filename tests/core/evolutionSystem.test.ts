import { describe, expect, it } from 'vitest';
import speciesJson from '../../data/species.json';
import {
  evaluateEvolution,
  getDominantFoodCategory,
  isEvolutionConditionMet,
} from '../../src/core/evolutionSystem';
import { createInitialPetState } from '../../src/core/saveSystem';
import type { PetState, SpeciesFormDefinition } from '../../src/core/types';

const speciesList = speciesJson as SpeciesFormDefinition[];

function createChildSproutState(): PetState {
  const base = createInitialPetState('Mochi', 1_000_000);
  return {
    ...base,
    formId: 'child_sprout',
    stage: 'child',
    ageSeconds: 900,
    discoveredForms: ['egg', 'baby_blob', 'child_sprout'],
    needs: {
      hunger: 80,
      energy: 80,
      happiness: 80,
      cleanliness: 80,
    },
  };
}

describe('Système d’évolution déterministe (evolutionSystem)', () => {
  describe('Transitions de base : egg -> baby_blob -> child_sprout', () => {
    it('maintient le stade egg tant que ageSeconds < 60, puis éclot en baby_blob à 60s', () => {
      const egg = createInitialPetState('Mochi', 1_000);
      egg.ageSeconds = 59;

      const beforeHatch = evaluateEvolution(egg, speciesList);
      expect(beforeHatch.evolved).toBe(false);
      expect(beforeHatch.pet.formId).toBe('egg');
      expect(beforeHatch.pet.stage).toBe('egg');

      egg.ageSeconds = 60;
      const hatched = evaluateEvolution(egg, speciesList);
      expect(hatched.evolved).toBe(true);
      expect(hatched.previousFormId).toBe('egg');
      expect(hatched.newForm?.id).toBe('baby_blob');
      expect(hatched.pet.formId).toBe('baby_blob');
      expect(hatched.pet.stage).toBe('baby');
      expect(hatched.pet.discoveredForms).toEqual(['egg', 'baby_blob']);
    });

    it('fait évoluer baby_blob vers child_sprout lorsque ageSeconds >= 300', () => {
      const baby: PetState = {
        ...createInitialPetState('Mochi', 1_000),
        formId: 'baby_blob',
        stage: 'baby',
        ageSeconds: 300,
        discoveredForms: ['egg', 'baby_blob'],
      };

      const evolved = evaluateEvolution(baby, speciesList);
      expect(evolved.evolved).toBe(true);
      expect(evolved.previousFormId).toBe('baby_blob');
      expect(evolved.newForm?.id).toBe('child_sprout');
      expect(evolved.pet.formId).toBe('child_sprout');
      expect(evolved.pet.stage).toBe('child');
      expect(evolved.pet.discoveredForms).toEqual(['egg', 'baby_blob', 'child_sprout']);
    });

    it('chaîne automatiquement egg -> baby_blob -> child_sprout si l’âge franchit deux seuils', () => {
      const egg = createInitialPetState('Mochi', 1_000);
      egg.ageSeconds = 350;

      const result = evaluateEvolution(egg, speciesList);
      expect(result.evolved).toBe(true);
      expect(result.previousFormId).toBe('egg');
      expect(result.pet.formId).toBe('child_sprout');
      expect(result.pet.stage).toBe('child');
      expect(result.pet.discoveredForms).toEqual(['egg', 'baby_blob', 'child_sprout']);
    });
  });

  describe('Branches adultes déterministes (adult_solar, adult_athletic, adult_gourmet, adult_shadow)', () => {
    it('évolue vers adult_solar (priorité 100) si careMistakes <= 1 et happiness >= 75', () => {
      const child = createChildSproutState();
      child.careStats.careMistakes = 1;
      child.needs.happiness = 85;
      // Même si les conditions d'athletic ou gourmet sont aussi remplies, adult_solar a la priorité 100
      child.careStats.totalGamesPlayed = 5;
      child.careStats.foodCategoryCounts.gourmet = 4;

      const result = evaluateEvolution(child, speciesList);
      expect(result.evolved).toBe(true);
      expect(result.pet.formId).toBe('adult_solar');
      expect(result.pet.stage).toBe('adult');
    });

    it('évolue vers adult_athletic (priorité 80) si careMistakes <= 3 et totalGamesPlayed >= 3 (hors solar)', () => {
      const child = createChildSproutState();
      child.careStats.careMistakes = 2; // Exclut adult_solar (maxCareMistakes: 1)
      child.needs.happiness = 80;
      child.careStats.totalGamesPlayed = 3;
      child.careStats.foodCategoryCounts.gourmet = 5; // Priorité 80 > Priorité 60 (gourmet)

      const result = evaluateEvolution(child, speciesList);
      expect(result.evolved).toBe(true);
      expect(result.pet.formId).toBe('adult_athletic');
      expect(result.pet.stage).toBe('adult');
    });

    it('évolue vers adult_gourmet (priorité 60) si careMistakes <= 3 et preferredFoodCategory === "gourmet"', () => {
      const child = createChildSproutState();
      child.careStats.careMistakes = 2; // Exclut adult_solar
      child.careStats.totalGamesPlayed = 1; // Exclut adult_athletic (minGamesPlayed: 3)
      child.careStats.foodCategoryCounts = {
        healthy: 1,
        snack: 2,
        energizing: 0,
        gourmet: 5,
      };

      expect(getDominantFoodCategory(child.careStats.foodCategoryCounts)).toBe('gourmet');

      const result = evaluateEvolution(child, speciesList);
      expect(result.evolved).toBe(true);
      expect(result.pet.formId).toBe('adult_gourmet');
      expect(result.pet.stage).toBe('adult');
    });

    it('évolue vers adult_shadow (priorité 10, repli) en cas de négligence (careMistakes > 3) ou critères non remplis', () => {
      const neglectedChild = createChildSproutState();
      neglectedChild.careStats.careMistakes = 5;
      neglectedChild.needs.happiness = 40;
      neglectedChild.careStats.totalGamesPlayed = 0;

      const result = evaluateEvolution(neglectedChild, speciesList);
      expect(result.evolved).toBe(true);
      expect(result.pet.formId).toBe('adult_shadow');
      expect(result.pet.stage).toBe('adult');
    });

    it('retourne null pour getDominantFoodCategory quand aucun repas n’a été consommé et valide minCareMistakes', () => {
      const emptyCounts = { healthy: 0, snack: 0, energizing: 0, gourmet: 0 };
      expect(getDominantFoodCategory(emptyCounts)).toBeNull();

      const child = createChildSproutState();
      child.careStats.careMistakes = 1;
      expect(
        isEvolutionConditionMet(child, {
          minAgeSeconds: 900,
          minCareMistakes: 3,
          priority: 10,
        })
      ).toBe(false);
    });
  });

  describe('Enregistrement sans doublon dans discoveredForms (Compendium)', () => {
    it('n’ajoute jamais de doublon dans discoveredForms si la forme cible a déjà été découverte', () => {
      const child = createChildSproutState();
      child.careStats.careMistakes = 0;
      child.needs.happiness = 95;
      // Simule une forme déjà découverte lors d'une génération précédente
      child.discoveredForms = ['egg', 'baby_blob', 'child_sprout', 'adult_solar'];

      const result = evaluateEvolution(child, speciesList);
      expect(result.evolved).toBe(true);
      expect(result.pet.formId).toBe('adult_solar');

      const solarOccurrences = result.pet.discoveredForms.filter(
        (id) => id === 'adult_solar'
      ).length;
      expect(solarOccurrences).toBe(1);
      expect(result.pet.discoveredForms).toEqual([
        'egg',
        'baby_blob',
        'child_sprout',
        'adult_solar',
      ]);
    });
  });
});
