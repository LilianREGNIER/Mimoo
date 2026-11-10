/**
 * Façade haut-niveau du moteur de jeu (`PetEngine`) orchestrant les besoins,
 * le rattrapage hors-ligne, les actions de soin, les mini-jeux et l'évolution.
 */

import {
  applyMiniGameResult,
  cleanPet,
  feedPet,
  petCharacter,
  togglePetSleep,
} from './actionsSystem';
import { clampPetPositionToWorkArea } from './displayUtils';
import { evaluateEvolution } from './evolutionSystem';
import { applyTickNeeds, getCriticalNeeds } from './needsSystem';
import { createInitialSaveData } from './saveSystem';
import { computeOfflineCatchup } from './timeSystem';
import type {
  FoodItem,
  FormId,
  GameConfig,
  MiniGameResult,
  NeedKey,
  NeedsState,
  OfflineCatchupReport,
  PetState,
  SaveDataV1,
  SpeciesFormDefinition,
  UserSettings,
} from './types';

/** Options de construction de `PetEngine` sous forme d'objet nommé. */
export interface PetEngineInitOptions {
  saveData: SaveDataV1;
  config: GameConfig;
  foods: FoodItem[];
  species: SpeciesFormDefinition[];
}

function isInitOptions(
  value: SaveDataV1 | PetEngineInitOptions
): value is PetEngineInitOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'saveData' in value &&
    'config' in value
  );
}

/**
 * Classe principale encapsulant l'état du familier et les règles d'équilibrage.
 * 100 % pur TypeScript, sans dépendance DOM, Node.js ou Electron.
 */
export class PetEngine {
  private saveData: SaveDataV1;
  private readonly config: GameConfig;
  private readonly foods: FoodItem[];
  private readonly species: SpeciesFormDefinition[];
  private poopSecondsAccumulator = 0;

  constructor(options: PetEngineInitOptions);
  constructor(
    saveData: SaveDataV1,
    config: GameConfig,
    foods: FoodItem[],
    species: SpeciesFormDefinition[]
  );
  constructor(
    saveDataOrOptions: SaveDataV1 | PetEngineInitOptions,
    config?: GameConfig,
    foods?: FoodItem[],
    species?: SpeciesFormDefinition[]
  ) {
    if (isInitOptions(saveDataOrOptions)) {
      this.saveData = structuredClone(saveDataOrOptions.saveData);
      this.config = saveDataOrOptions.config;
      this.foods = [...saveDataOrOptions.foods];
      this.species = [...saveDataOrOptions.species];
    } else {
      if (!config || !foods || !species) {
        throw new Error('PetEngine requires saveData, config, foods, and species.');
      }
      this.saveData = structuredClone(saveDataOrOptions);
      this.config = config;
      this.foods = [...foods];
      this.species = [...species];
    }
  }

  /** Retourne une copie de l'état courant du familier (`PetState`). */
  public getState(): PetState {
    return structuredClone(this.saveData.pet);
  }

  /** Retourne une copie complète de la sauvegarde (`SaveDataV1`). */
  public getSaveData(nowMs?: number): SaveDataV1 {
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }
    return structuredClone(this.saveData);
  }

  /** Retourne la configuration d'équilibrage active. */
  public getConfig(): GameConfig {
    return this.config;
  }

  /** Retourne le catalogue des aliments disponibles. */
  public getFoods(): FoodItem[] {
    return [...this.foods];
  }

  /** Retourne le catalogue des formes d'évolution. */
  public getSpecies(): SpeciesFormDefinition[] {
    return [...this.species];
  }

  /** Retourne la définition de la forme actuelle du familier. */
  public getCurrentSpeciesForm(): SpeciesFormDefinition | undefined {
    return this.species.find((item) => item.id === this.saveData.pet.formId);
  }

  /** Retourne la liste des besoins actuellement sous le seuil critique. */
  public getCriticalNeeds(): NeedKey[] {
    return getCriticalNeeds(this.saveData.pet.needs, this.config.criticalThreshold);
  }

  /**
   * Avance la simulation en ligne de `deltaSeconds` secondes.
   * Met à jour les jauges, l'apparition éventuelle de salissures et vérifie les évolutions.
   */
  public tick(
    deltaSeconds: number,
    nowMs?: number
  ): {
    pet: PetState;
    needsDelta: NeedsState;
    floorApplied: boolean;
    evolved: boolean;
    newForm: SpeciesFormDefinition | null;
    criticalNeeds: NeedKey[];
  } {
    const { pet: tickedPet, needsDelta, floorApplied } = applyTickNeeds(
      this.saveData.pet,
      deltaSeconds,
      this.config,
      { isOffline: false }
    );

    let nextPet = tickedPet;

    // Gestion de l'apparition de salissures quand le familier est éveillé (hors stade œuf)
    if (
      deltaSeconds > 0 &&
      nextPet.stage !== 'egg' &&
      !nextPet.isSleeping &&
      this.config.poopIntervalSeconds > 0
    ) {
      this.poopSecondsAccumulator += deltaSeconds;
      const newPoops = Math.floor(
        this.poopSecondsAccumulator / this.config.poopIntervalSeconds
      );
      if (newPoops > 0) {
        this.poopSecondsAccumulator %= this.config.poopIntervalSeconds;
        nextPet = {
          ...nextPet,
          poopCount: Math.min(5, nextPet.poopCount + newPoops),
        };
      }
    }

    const safeNow =
      typeof nowMs === 'number' && Number.isFinite(nowMs)
        ? nowMs
        : nextPet.lastUpdatedAt + Math.max(0, deltaSeconds) * 1000;

    nextPet = {
      ...nextPet,
      lastUpdatedAt: safeNow,
    };

    const evoResult = evaluateEvolution(nextPet, this.species);
    this.saveData.pet = evoResult.pet;
    this.saveData.savedAt = safeNow;

    return {
      pet: this.getState(),
      needsDelta,
      floorApplied,
      evolved: evoResult.evolved,
      newForm: evoResult.newForm,
      criticalNeeds: this.getCriticalNeeds(),
    };
  }

  /**
   * Applique le rattrapage hors-ligne à l'ouverture de l'application ou en sortie de veille.
   */
  public applyOfflineCatchup(nowMs: number = Date.now()): {
    pet: PetState;
    report: OfflineCatchupReport;
    evolved: boolean;
    newForm: SpeciesFormDefinition | null;
  } {
    const { pet: caughtUpPet, report } = computeOfflineCatchup(
      this.saveData.pet,
      nowMs,
      this.config
    );

    const evoResult = evaluateEvolution(caughtUpPet, this.species);
    this.saveData.pet = evoResult.pet;
    this.saveData.savedAt = nowMs;

    return {
      pet: this.getState(),
      report,
      evolved: evoResult.evolved,
      newForm: evoResult.newForm,
    };
  }

  /**
   * Nourrit le familier à partir d'un identifiant d'aliment ou d'un objet `FoodItem`.
   */
  public feed(
    foodOrId: string | FoodItem,
    nowMs?: number
  ): {
    pet: PetState;
    accepted: boolean;
    reason?: string;
    evolved: boolean;
    newForm: SpeciesFormDefinition | null;
  } {
    const foodItem =
      typeof foodOrId === 'string'
        ? this.foods.find((item) => item.id === foodOrId)
        : foodOrId;

    if (!foodItem) {
      return {
        pet: this.getState(),
        accepted: false,
        reason: 'unknown_food',
        evolved: false,
        newForm: null,
      };
    }

    const feedResult = feedPet(this.saveData.pet, foodItem, nowMs);
    if (!feedResult.accepted) {
      return {
        pet: this.getState(),
        accepted: false,
        reason: feedResult.reason,
        evolved: false,
        newForm: null,
      };
    }

    const evoResult = evaluateEvolution(feedResult.pet, this.species);
    this.saveData.pet = evoResult.pet;
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return {
      pet: this.getState(),
      accepted: true,
      evolved: evoResult.evolved,
      newForm: evoResult.newForm,
    };
  }

  /**
   * Caresse le familier (avec respect du cooldown).
   */
  public pet(nowMs: number = Date.now()): {
    pet: PetState;
    bonusApplied: boolean;
    cooldownRemainingMs: number;
  } {
    const result = petCharacter(this.saveData.pet, this.config, nowMs);
    this.saveData.pet = result.pet;
    this.saveData.savedAt = nowMs;

    return {
      pet: this.getState(),
      bonusApplied: result.bonusApplied,
      cooldownRemainingMs: result.cooldownRemainingMs,
    };
  }

  /**
   * Bascule l'état de sommeil du familier.
   */
  public toggleSleep(nowMs?: number): { pet: PetState; isSleeping: boolean } {
    const result = togglePetSleep(this.saveData.pet, nowMs);
    this.saveData.pet = result.pet;
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return {
      pet: this.getState(),
      isSleeping: result.isSleeping,
    };
  }

  /**
   * Nettoie les salissures et restaure la propreté du familier.
   */
  public clean(nowMs?: number): { pet: PetState; cleaned: boolean } {
    const result = cleanPet(this.saveData.pet, this.config, nowMs);
    this.saveData.pet = result.pet;
    this.poopSecondsAccumulator = 0;
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return {
      pet: this.getState(),
      cleaned: result.cleaned,
    };
  }

  /**
   * Enregistre le résultat d'un mini-jeu et vérifie si cela déclenche une évolution.
   */
  public completeMiniGame(
    result: MiniGameResult,
    nowMs?: number
  ): {
    pet: PetState;
    happinessGain: number;
    energyCost: number;
    evolved: boolean;
    newForm: SpeciesFormDefinition | null;
  } {
    const gameOutcome = applyMiniGameResult(this.saveData.pet, result, nowMs);
    const evoResult = evaluateEvolution(gameOutcome.pet, this.species);
    this.saveData.pet = evoResult.pet;
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return {
      pet: this.getState(),
      happinessGain: gameOutcome.happinessGain,
      energyCost: gameOutcome.energyCost,
      evolved: evoResult.evolved,
      newForm: evoResult.newForm,
    };
  }

  /**
   * Vérifie et applique immédiatement toute évolution éligible.
   */
  public checkEvolution(): {
    evolved: boolean;
    previousFormId: FormId;
    newForm: SpeciesFormDefinition | null;
    pet: PetState;
  } {
    const evoResult = evaluateEvolution(this.saveData.pet, this.species);
    this.saveData.pet = evoResult.pet;
    return {
      ...evoResult,
      pet: this.getState(),
    };
  }

  /**
   * Met à jour la position du familier, en la recalant dans `workArea` si fourni.
   */
  public setPosition(
    position: { x: number; y: number },
    workArea?: { x: number; y: number; width: number; height: number },
    spriteMargin?: number
  ): { x: number; y: number; wasClamped: boolean } {
    if (workArea) {
      const clamped = clampPetPositionToWorkArea(position, workArea, spriteMargin);
      this.saveData.pet.position = { x: clamped.x, y: clamped.y };
      return clamped;
    }

    this.saveData.pet.position = { x: position.x, y: position.y };
    return { x: position.x, y: position.y, wasClamped: false };
  }

  /**
   * Met à jour les préférences utilisateur stockées dans la sauvegarde.
   */
  public updateSettings(partial: Partial<UserSettings>): UserSettings {
    this.saveData.settings = {
      ...this.saveData.settings,
      ...partial,
    };
    return { ...this.saveData.settings };
  }

  /**
   * Réinitialise le familier avec un nouvel œuf tout en conservant les préférences utilisateur.
   */
  public reset(newPetName?: string, nowMs: number = Date.now()): SaveDataV1 {
    const currentSettings = { ...this.saveData.settings };
    const freshSave = createInitialSaveData(newPetName, nowMs);
    this.saveData = {
      ...freshSave,
      settings: currentSettings,
    };
    this.poopSecondsAccumulator = 0;
    return this.getSaveData();
  }
}
