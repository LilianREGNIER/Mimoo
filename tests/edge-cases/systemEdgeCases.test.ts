import { describe, expect, it } from 'vitest';
import gameConfigJson from '../../data/game-config.json';
import foodsJson from '../../data/foods.json';
import speciesJson from '../../data/species.json';
import { clampPetPositionToWorkArea } from '../../src/core/displayUtils';
import { PetEngine } from '../../src/core/petEngine';
import {
  createInitialPetState,
  createInitialSaveData,
  LEGACY_FORM_MIGRATION,
  parseSaveDataJson,
  validateAndMigrateSaveData,
} from '../../src/core/saveSystem';
import { computeOfflineCatchup } from '../../src/core/timeSystem';
import type {
  FoodItem,
  GameConfig,
  PetState,
  SpeciesFormDefinition,
} from '../../src/core/types';

const gameConfig = gameConfigJson as GameConfig;
const foods = foodsJson as FoodItem[];
const species = speciesJson as SpeciesFormDefinition[];

const HOUR_MS = 3600 * 1000;

function createActivePet(nowMs = 1_700_000_000_000): PetState {
  const base = createInitialPetState('Mochi', nowMs);
  return {
    ...base,
    formId: 'child_flora',
    stage: 'child',
    lineage: 'flora',
    ageSeconds: 400,
    discoveredForms: ['egg', 'baby_flora', 'child_flora'],
    needs: {
      hunger: 85,
      energy: 90,
      happiness: 85,
      cleanliness: 95,
    },
    careStats: {
      ...base.careStats,
      eggClicks: 5,
    },
  };
}

describe('Cas limites système & QA (systemEdgeCases)', () => {
  describe('Cas limite 1 : Fermeture prolongée / Nuit complète (12h, 48h, 96h) et protection de l’œuf', () => {
    it('maintient tous les besoins au-dessus ou égaux au plancher offlineFloor (15) après 12h hors-ligne', () => {
      const startMs = 1_700_000_000_000;
      const pet = createActivePet(startMs);
      const after12hMs = startMs + 12 * HOUR_MS;

      const { pet: updated, report } = computeOfflineCatchup(pet, after12hMs, gameConfig);

      expect(report.clockSkewDetected).toBe(false);
      expect(report.elapsedMs).toBe(12 * HOUR_MS);
      expect(report.clampedMs).toBe(12 * HOUR_MS);
      expect(report.floorApplied).toBe(true);

      // La faim, le bonheur et la propreté ne tombent pas sous offlineFloor (15)
      expect(updated.needs.hunger).toBe(gameConfig.offlineFloor);
      // L'énergie se régénère quand l'application/PC est éteint (jusqu'à 100%)
      expect(updated.needs.energy).toBe(100);
      expect(updated.needs.happiness).toBe(gameConfig.offlineFloor);
      expect(updated.needs.cleanliness).toBe(gameConfig.offlineFloor);
      expect(updated.lastUpdatedAt).toBe(after12hMs);
      // Plafonné à max 1 erreur de soin par session hors-ligne
      expect(updated.careStats.careMistakes).toBeLessThanOrEqual(1);
    });

    it('protège le familier après 48h de fermeture et conserve une jauge déjà sous offlineFloor sans la baisser davantage', () => {
      const startMs = 1_700_000_000_000;
      const pet = createActivePet(startMs);
      pet.needs.hunger = 12; // Déjà sous le plancher (15) avant fermeture
      const after48hMs = startMs + 48 * HOUR_MS;

      const { pet: updated, report } = computeOfflineCatchup(pet, after48hMs, gameConfig);

      expect(report.floorApplied).toBe(true);
      expect(updated.needs.hunger).toBe(12); // Ne descend pas sous 12 et ne remonte pas artificiellement
      expect(updated.needs.energy).toBe(100); // L'énergie se régénère pendant l'extinction
      expect(updated.needs.happiness).toBe(gameConfig.offlineFloor);
      expect(updated.needs.cleanliness).toBe(gameConfig.offlineFloor);
    });

    it('plafonne la durée hors-ligne à maxOfflineHours (72h) lors d’une absence de 96h', () => {
      const startMs = 1_700_000_000_000;
      const pet = createActivePet(startMs);
      const after96hMs = startMs + 96 * HOUR_MS;

      const { pet: updated, report } = computeOfflineCatchup(pet, after96hMs, gameConfig);

      expect(report.elapsedMs).toBe(96 * HOUR_MS);
      expect(report.clampedMs).toBe(gameConfig.maxOfflineHours * HOUR_MS);
      expect(updated.ageSeconds).toBe(400 + gameConfig.maxOfflineHours * 3600);
    });

    it('n’altère ni les jauges ni le stade d’un œuf fermé pendant 24h (pas d’éclosion hors-ligne sans clics)', () => {
      const startMs = 1_700_000_000_000;
      const save = createInitialSaveData('Mochi', startMs);
      const engine = new PetEngine(save, gameConfig, foods, species);

      const { pet: after24h, evolved } = engine.applyOfflineCatchup(startMs + 24 * HOUR_MS);
      expect(evolved).toBe(false);
      expect(after24h.formId).toBe('egg');
      expect(after24h.stage).toBe('egg');
      expect(after24h.needs).toEqual(save.pet.needs);
    });

    it('restaure l\'énergie proportionnellement au temps d\'extinction du PC jusqu\'à 100%', () => {
      const startMs = 1_700_000_000_000;
      const pet = createActivePet(startMs);
      pet.needs.energy = 20;
      // 20 minutes hors-ligne : 20 * 2.4 = 48 points récupérés -> 20 + 48 = 68
      const after20minMs = startMs + 20 * 60 * 1000;

      const { pet: updated } = computeOfflineCatchup(pet, after20minMs, gameConfig);
      expect(updated.needs.energy).toBeCloseTo(68, 1);
    });
  });

  describe('Cas limite 2 : PC en veille (suspend / resume)', () => {
    it('gère un saut temporel de 6 heures en sortie de veille sans valeurs NaN ni mort subite', () => {
      const startMs = 1_700_000_000_000;
      const save = createInitialSaveData('Mochi', startMs);
      save.pet = createActivePet(startMs);

      const engine = new PetEngine(save, gameConfig, foods, species);
      const resumeMs = startMs + 6 * HOUR_MS;

      const { pet: resumedPet, report } = engine.applyOfflineCatchup(resumeMs);

      expect(report.clockSkewDetected).toBe(false);
      expect(report.floorApplied).toBe(true);

      for (const value of Object.values(resumedPet.needs)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Number.isNaN(value)).toBe(false);
        expect(value).toBeGreaterThanOrEqual(gameConfig.offlineFloor);
        expect(value).toBeLessThanOrEqual(100);
      }

      expect(Number.isFinite(resumedPet.ageSeconds)).toBe(true);
      expect(resumedPet.lastUpdatedAt).toBe(resumeMs);
    });
  });

  describe('Cas limite 3 : Horloge système modifiée (reculée dans le passé ou avancée de 10 ans)', () => {
    it('détecte un recul d’horloge (nowMs < lastUpdatedAt) avec clockSkewDetected === true sans modifier les jauges ni l’âge', () => {
      const lastUpdatedAt = 1_700_000_000_000;
      const pet = createActivePet(lastUpdatedAt);
      // Horloge reculée de 3 heures dans le passé
      const pastNowMs = lastUpdatedAt - 3 * HOUR_MS;

      const { pet: resynced, report } = computeOfflineCatchup(pet, pastNowMs, gameConfig);

      expect(report.clockSkewDetected).toBe(true);
      expect(report.elapsedMs).toBe(-3 * HOUR_MS);
      expect(report.clampedMs).toBe(0);
      expect(report.floorApplied).toBe(false);
      expect(report.needsDelta).toEqual({
        hunger: 0,
        energy: 0,
        happiness: 0,
        cleanliness: 0,
      });

      // Aucune jauge modifiée ni âge négatif
      expect(resynced.needs).toEqual(pet.needs);
      expect(resynced.ageSeconds).toBe(pet.ageSeconds);
      expect(resynced.ageSeconds).toBeGreaterThanOrEqual(0);
      // Resynchronisation de lastUpdatedAt sur la nouvelle horloge
      expect(resynced.lastUpdatedAt).toBe(pastNowMs);
    });

    it('plafonne un saut de 10 ans dans le futur à maxOfflineHours et respecte offlineFloor', () => {
      const startMs = 1_700_000_000_000;
      const pet = createActivePet(startMs);
      const tenYearsMs = 10 * 365 * 24 * HOUR_MS;
      const futureNowMs = startMs + tenYearsMs;

      const { pet: updated, report } = computeOfflineCatchup(
        pet,
        futureNowMs,
        gameConfig
      );

      expect(report.clockSkewDetected).toBe(false);
      expect(report.elapsedMs).toBe(tenYearsMs);
      expect(report.clampedMs).toBe(gameConfig.maxOfflineHours * HOUR_MS);
      expect(report.floorApplied).toBe(true);

      expect(updated.needs.hunger).toBe(gameConfig.offlineFloor);
      expect(updated.needs.energy).toBe(100); // L'énergie se régénère pendant l'extinction
      expect(updated.needs.happiness).toBe(gameConfig.offlineFloor);
      expect(updated.needs.cleanliness).toBe(gameConfig.offlineFloor);
      expect(updated.ageSeconds).toBe(pet.ageSeconds + gameConfig.maxOfflineHours * 3600);
      expect(updated.lastUpdatedAt).toBe(futureNowMs);
    });
  });

  describe('Cas limite 4 : Fichier de sauvegarde corrompu, ancienne version et migration LEGACY_FORM_MIGRATION', () => {
    it('récupère automatiquement sans exception sur une chaîne JSON tronquée, vide ou "null"', () => {
      const corruptedInputs = ['{not valid json', '', '   ', 'null', '[]', '42'];

      for (const payload of corruptedInputs) {
        expect(() => parseSaveDataJson(payload, 1_700_000_000_000)).not.toThrow();
        const result = parseSaveDataJson(payload, 1_700_000_000_000);

        expect(result.recoveredFromCorruption).toBe(true);
        expect(result.saveData.schemaVersion).toBe(1);
        expect(result.saveData.pet.formId).toBe('egg');
        expect(result.saveData.pet.stage).toBe('egg');
        expect(result.saveData.pet.lineage).toBe('none');
        expect(result.warnings.length).toBeGreaterThan(0);
      }
    });

    it('migre proprement une sauvegarde ancienne (schemaVersion: 0), assainit les jauges hors bornes (-50, 999) et migre baby_blob -> baby_aqua', () => {
      const legacyRawSave = {
        schemaVersion: 0,
        savedAt: 1_690_000_000_000,
        pet: {
          name: 'Kumo',
          formId: 'baby_blob',
          // stage manquant -> doit être déduit ('baby')
          bornAt: 1_690_000_000_000,
          lastUpdatedAt: 1_690_000_010_000,
          ageSeconds: 180,
          needs: {
            hunger: -50,
            energy: 999,
            happiness: Number.NaN,
            // cleanliness manquant -> valeur par défaut (100)
          },
          isSleeping: false,
          poopCount: -3,
          // discoveredForms et careStats manquants
        },
        // settings partiels / hors bornes
        settings: {
          petScale: 99,
        },
      };

      const result = validateAndMigrateSaveData(legacyRawSave, 1_700_000_000_000);

      expect(result.recoveredFromCorruption).toBe(false);
      expect(result.migrated).toBe(true);
      expect(result.saveData.schemaVersion).toBe(1);
      expect(result.saveData.pet.name).toBe('Kumo');
      expect(result.saveData.pet.formId).toBe('baby_aqua');
      expect(result.saveData.pet.stage).toBe('baby');
      expect(result.saveData.pet.lineage).toBe('aqua');

      // Jauges assainies dans [0, 100]
      expect(result.saveData.pet.needs.hunger).toBe(0);
      expect(result.saveData.pet.needs.energy).toBe(100);
      expect(result.saveData.pet.needs.happiness).toBe(0);
      expect(result.saveData.pet.needs.cleanliness).toBe(100);

      expect(result.saveData.pet.poopCount).toBe(0);
      expect(result.saveData.pet.discoveredForms).toContain('egg');
      expect(result.saveData.pet.discoveredForms).toContain('baby_aqua');
      expect(result.saveData.settings.petScale).toBe(1);
    });

    it('migre automatiquement tous les anciens identifiants de formes (baby_blob, child_sprout, adult_solar, etc.) vers les nouvelles lignées', () => {
      const legacyCases = [
        {
          oldId: 'baby_blob',
          expectedForm: 'baby_aqua',
          expectedStage: 'baby',
          expectedLineage: 'aqua',
        },
        {
          oldId: 'child_sprout',
          expectedForm: 'child_flora',
          expectedStage: 'child',
          expectedLineage: 'flora',
        },
        {
          oldId: 'adult_solar',
          expectedForm: 'adult_ember_solar',
          expectedStage: 'adult',
          expectedLineage: 'ember',
        },
        {
          oldId: 'adult_athletic',
          expectedForm: 'adult_ember_comet',
          expectedStage: 'adult',
          expectedLineage: 'ember',
        },
        {
          oldId: 'adult_gourmet',
          expectedForm: 'adult_ember_magma',
          expectedStage: 'adult',
          expectedLineage: 'ember',
        },
        {
          oldId: 'adult_shadow',
          expectedForm: 'adult_ember_eclipse',
          expectedStage: 'adult',
          expectedLineage: 'ember',
        },
      ] as const;

      for (const item of legacyCases) {
        expect(LEGACY_FORM_MIGRATION[item.oldId]).toBe(item.expectedForm);

        const raw = {
          schemaVersion: 1,
          savedAt: 1_700_000_000_000,
          pet: {
            name: 'Mochi',
            formId: item.oldId,
            bornAt: 1_700_000_000_000,
            lastUpdatedAt: 1_700_000_000_000,
            ageSeconds: 1000,
            needs: { hunger: 80, energy: 80, happiness: 80, cleanliness: 80 },
            isSleeping: false,
            poopCount: 0,
            lastPettedAt: 0,
            discoveredForms: ['egg', 'baby_blob', 'child_sprout', 'adult_solar'],
            position: { x: 200, y: 200 },
            careStats: {},
          },
          settings: {},
        };

        const migrated = validateAndMigrateSaveData(raw, 1_700_000_000_000);
        expect(migrated.migrated).toBe(true);
        expect(migrated.recoveredFromCorruption).toBe(false);
        expect(migrated.saveData.pet.formId).toBe(item.expectedForm);
        expect(migrated.saveData.pet.stage).toBe(item.expectedStage);
        expect(migrated.saveData.pet.lineage).toBe(item.expectedLineage);
        expect(migrated.saveData.pet.discoveredForms).toEqual(
          expect.arrayContaining([
            'egg',
            'baby_aqua',
            'child_flora',
            'adult_ember_solar',
          ])
        );
      }
    });
  });

  describe('Cas limite 5 : Multi-écrans & DPI (clampPetPositionToWorkArea)', () => {
    it('recale automatiquement un familier situé sur un second écran débranché (x: 2850, y: 950) dans le workArea principal (0, 0, 1920, 1040)', () => {
      const primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1040 };
      const disconnectedPosition = { x: 2850, y: 950 };

      const clamped = clampPetPositionToWorkArea(disconnectedPosition, primaryWorkArea);

      expect(clamped.wasClamped).toBe(true);
      expect(clamped.x).toBe(1920);
      expect(clamped.y).toBe(950);
      expect(clamped.x).toBeGreaterThanOrEqual(primaryWorkArea.x);
      expect(clamped.x).toBeLessThanOrEqual(primaryWorkArea.x + primaryWorkArea.width);
      expect(clamped.y).toBeGreaterThanOrEqual(primaryWorkArea.y);
      expect(clamped.y).toBeLessThanOrEqual(primaryWorkArea.y + primaryWorkArea.height);
    });

    it('respecte la marge du sprite (spriteMargin) et gère les coordonnées négatives ou NaN', () => {
      const primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1040 };

      const withMargin = clampPetPositionToWorkArea(
        { x: 2850, y: 1200 },
        primaryWorkArea,
        64
      );
      expect(withMargin.wasClamped).toBe(true);
      expect(withMargin.x).toBe(1920 - 64);
      expect(withMargin.y).toBe(1040 - 64);

      const inside = clampPetPositionToWorkArea({ x: 500, y: 400 }, primaryWorkArea, 64);
      expect(inside.wasClamped).toBe(false);
      expect(inside.x).toBe(500);
      expect(inside.y).toBe(400);

      const nanPos = clampPetPositionToWorkArea(
        { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        primaryWorkArea
      );
      expect(nanPos.wasClamped).toBe(true);
      expect(nanPos.x).toBe(960);
      expect(nanPos.y).toBe(520);
    });
  });
});
