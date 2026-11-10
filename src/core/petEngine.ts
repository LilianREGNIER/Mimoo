/**
 * Façade haut-niveau du moteur de jeu (`PetEngine`) orchestrant les besoins,
 * le rattrapage hors-ligne, les actions de soin, l'activité PC, les mini-jeux,
 * l'évolution et les outils Sandbox / Menu Test.
 */

import {
  applyMiniGameResult,
  buyCosmeticItem,
  cleanPet,
  clickEgg,
  decodeFriendPassport,
  encodeFriendPassport,
  equipCosmeticItem,
  feedPet,
  petCharacter,
  playTogetherWithFriend,
  scrubCleanPet,
  STARTER_FORM_IDS,
  togglePetSleep,
} from './actionsSystem';
import { clampPetPositionToWorkArea } from './displayUtils';
import { evaluateEvolution } from './evolutionSystem';
import { applyTickNeeds, getCriticalNeeds } from './needsSystem';
import {
  createInitialSaveData,
  FORM_TO_LINEAGE,
  FORM_TO_STAGE,
} from './saveSystem';
import { computeOfflineCatchup } from './timeSystem';
import type {
  CosmeticItem,
  CosmeticSlot,
  FoodItem,
  FormId,
  FriendPetProfile,
  GameConfig,
  MiniGameResult,
  NeedKey,
  NeedsState,
  OfflineCatchupReport,
  PcActivityBatch,
  PetState,
  SaveDataV1,
  SpeciesFormDefinition,
  StarterFormId,
  UserSettings,
} from './types';

/** Types de simulations disponibles dans le menu Sandbox / Test. */
export type SandboxConditionType =
  | 'hungry'
  | 'dirty'
  | 'need_cuddle'
  | 'need_play'
  | 'tired'
  | 'full_restore'
  | 'boost_marathon'
  | 'add_coins';

/** Options de construction de `PetEngine` sous forme d'objet nommé. */
export interface PetEngineInitOptions {
  saveData: SaveDataV1;
  config: GameConfig;
  foods: FoodItem[];
  species: SpeciesFormDefinition[];
  cosmetics?: CosmeticItem[];
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
  private readonly cosmetics: CosmeticItem[];
  private poopSecondsAccumulator = 0;

  constructor(options: PetEngineInitOptions);
  constructor(
    saveData: SaveDataV1,
    config: GameConfig,
    foods: FoodItem[],
    species: SpeciesFormDefinition[],
    cosmetics?: CosmeticItem[]
  );
  constructor(
    saveDataOrOptions: SaveDataV1 | PetEngineInitOptions,
    config?: GameConfig,
    foods?: FoodItem[],
    species?: SpeciesFormDefinition[],
    cosmetics: CosmeticItem[] = []
  ) {
    if (isInitOptions(saveDataOrOptions)) {
      this.saveData = structuredClone(saveDataOrOptions.saveData);
      this.config = saveDataOrOptions.config;
      this.foods = [...saveDataOrOptions.foods];
      this.species = [...saveDataOrOptions.species];
      this.cosmetics = [...(saveDataOrOptions.cosmetics ?? [])];
    } else {
      if (!config || !foods || !species) {
        throw new Error('PetEngine requires saveData, config, foods, and species.');
      }
      this.saveData = structuredClone(saveDataOrOptions);
      this.config = config;
      this.foods = [...foods];
      this.species = [...species];
      this.cosmetics = [...cosmetics];
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

  /** Retourne le catalogue des objets cosmétiques de la boutique. */
  public getCosmetics(): CosmeticItem[] {
    return [...this.cosmetics];
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
   * Clique sur l'œuf pour progresser vers l'éclosion interactive (5 clics par défaut).
   */
  public clickEgg(
    nowMs?: number,
    rng?: () => number
  ): {
    pet: PetState;
    hatched: boolean;
    eggClicks: number;
    clicksRequired: number;
    hatchedForm: SpeciesFormDefinition | null;
  } {
    const result = clickEgg(
      this.saveData.pet,
      this.species,
      this.config,
      nowMs,
      rng
    );
    this.saveData.pet = result.pet;
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return {
      pet: this.getState(),
      hatched: result.hatched,
      eggClicks: result.eggClicks,
      clicksRequired: result.clicksRequired,
      hatchedForm: result.hatchedForm,
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
   * Caresse le familier (avec respect du cooldown et apaisement immédiat de `needsCuddle`).
   */
  public pet(nowMs: number = Date.now()): {
    pet: PetState;
    bonusApplied: boolean;
    cooldownRemainingMs: number;
  } {
    const result = petCharacter(this.saveData.pet, this.config, nowMs);
    const evoResult = evaluateEvolution(result.pet, this.species);
    this.saveData.pet = evoResult.pet;
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
   * Nettoie instantanément les salissures et restaure la propreté du familier.
   */
  public clean(nowMs?: number): { pet: PetState; cleaned: boolean } {
    const result = cleanPet(this.saveData.pet, this.config, nowMs);
    const evoResult = evaluateEvolution(result.pet, this.species);
    this.saveData.pet = evoResult.pet;
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
   * Nettoie progressivement le familier avec l'éponge interactive (`scrubDelta`).
   */
  public scrubClean(
    scrubDelta: number,
    nowMs?: number
  ): {
    pet: PetState;
    progress: number;
    completed: boolean;
  } {
    const result = scrubCleanPet(
      this.saveData.pet,
      scrubDelta,
      this.config,
      nowMs
    );

    if (result.completed) {
      this.poopSecondsAccumulator = 0;
      const evoResult = evaluateEvolution(result.pet, this.species);
      this.saveData.pet = evoResult.pet;
    } else {
      this.saveData.pet = result.pet;
    }

    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return {
      pet: this.getState(),
      progress: result.progress,
      completed: result.completed,
    };
  }

  /**
   * Enregistre un lot d'activité PC (clics souris, frappes clavier anonymes, secondes actives)
   * dans `careStats` et vérifie si une évolution est débloquée.
   */
  public recordPcActivity(
    batch: PcActivityBatch,
    nowMs?: number
  ): {
    pet: PetState;
    evolved: boolean;
    newForm: SpeciesFormDefinition | null;
  } {
    const addMouseClicks =
      typeof batch?.mouseClicks === 'number' &&
      Number.isFinite(batch.mouseClicks) &&
      batch.mouseClicks > 0
        ? Math.floor(batch.mouseClicks)
        : 0;
    const addKeyPresses =
      typeof batch?.keyPresses === 'number' &&
      Number.isFinite(batch.keyPresses) &&
      batch.keyPresses > 0
        ? Math.floor(batch.keyPresses)
        : 0;
    const addActiveSeconds =
      typeof batch?.activeSeconds === 'number' &&
      Number.isFinite(batch.activeSeconds) &&
      batch.activeSeconds > 0
        ? batch.activeSeconds
        : 0;

    const totalBatchInputs = addMouseClicks + addKeyPresses;
    const coinsEarned =
      totalBatchInputs > 0 ? Math.max(1, Math.floor(totalBatchInputs / 20)) : 0;

    const currentStats = this.saveData.pet.careStats;
    this.saveData.pet = {
      ...this.saveData.pet,
      tamaCoins: (this.saveData.pet.tamaCoins ?? 0) + coinsEarned,
      lastUpdatedAt:
        typeof nowMs === 'number' && Number.isFinite(nowMs)
          ? nowMs
          : this.saveData.pet.lastUpdatedAt,
      careStats: {
        ...currentStats,
        foodCategoryCounts: { ...currentStats.foodCategoryCounts },
        pcMouseClicks: (currentStats.pcMouseClicks ?? 0) + addMouseClicks,
        pcKeyPresses: (currentStats.pcKeyPresses ?? 0) + addKeyPresses,
        pcActiveSeconds:
          Math.round(((currentStats.pcActiveSeconds ?? 0) + addActiveSeconds) * 100) /
          100,
      },
    };

    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    const evoResult = this.checkEvolution();
    return {
      pet: evoResult.pet,
      evolved: evoResult.evolved,
      newForm: evoResult.newForm,
    };
  }

  /**
   * Achète un objet cosmétique de la boutique et l'équipe automatiquement.
   */
  public buyCosmetic(
    cosmeticOrId: string | CosmeticItem,
    nowMs?: number
  ): {
    pet: PetState;
    purchased: boolean;
    reason?: 'already_owned' | 'insufficient_coins' | 'unknown_cosmetic';
  } {
    const item =
      typeof cosmeticOrId === 'string'
        ? this.cosmetics.find((c) => c.id === cosmeticOrId)
        : cosmeticOrId;

    if (!item) {
      return {
        pet: this.getState(),
        purchased: false,
        reason: 'unknown_cosmetic',
      };
    }

    const result = buyCosmeticItem(this.saveData.pet, item);
    if (!result.purchased) {
      return {
        pet: this.getState(),
        purchased: false,
        reason: result.reason,
      };
    }

    this.saveData.pet = result.pet;
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.pet.lastUpdatedAt = nowMs;
      this.saveData.savedAt = nowMs;
    }

    return {
      pet: this.getState(),
      purchased: true,
    };
  }

  /**
   * Équipe ou déséquipe (`cosmeticId === null`) un objet cosmétique sur le slot indiqué.
   */
  public equipCosmetic(
    slot: CosmeticSlot,
    cosmeticId: string | null,
    nowMs?: number
  ): {
    pet: PetState;
    equipped: boolean;
  } {
    const result = equipCosmeticItem(this.saveData.pet, slot, cosmeticId);
    if (result.equipped) {
      this.saveData.pet = result.pet;
      if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
        this.saveData.pet.lastUpdatedAt = nowMs;
        this.saveData.savedAt = nowMs;
      }
    }

    return {
      pet: this.getState(),
      equipped: result.equipped,
    };
  }

  /**
   * Joue avec le familier d'un ami en visite (Salon Temps Réel ou Code Passeport).
   */
  public playWithFriend(
    nowMs?: number
  ): {
    pet: PetState;
    happinessGain: number;
    coinsEarned: number;
    evolved: boolean;
    newForm: SpeciesFormDefinition | null;
  } {
    const result = playTogetherWithFriend(this.saveData.pet, nowMs);
    const evoResult = evaluateEvolution(result.pet, this.species);
    this.saveData.pet = evoResult.pet;
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return {
      pet: this.getState(),
      happinessGain: result.happinessGain,
      coinsEarned: result.coinsEarned,
      evolved: evoResult.evolved,
      newForm: evoResult.newForm,
    };
  }

  /** Alias de `playWithFriend`. */
  public playWithFriendPet(nowMs?: number) {
    return this.playWithFriend(nowMs);
  }

  /**
   * Exporte le Code Passeport Tamagotchi (`TAMA-...`) du familier actuel.
   */
  public exportPassport(ownerName?: string): string {
    return encodeFriendPassport(this.saveData.pet, ownerName);
  }

  /** Alias de `exportPassport`. */
  public exportPassportCode(ownerName?: string): string {
    return this.exportPassport(ownerName);
  }

  /**
   * Importe et valide un Code Passeport Tamagotchi (`TAMA-...`) d'un ami.
   */
  public importPassport(code: string): FriendPetProfile | null {
    return decodeFriendPassport(code);
  }

  /** Alias de `importPassport`. */
  public importPassportCode(code: string): FriendPetProfile | null {
    return this.importPassport(code);
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
   * [Sandbox / Menu Test] Change immédiatement le familier vers n'importe laquelle des 19 formes.
   * Met à jour `stage`, `lineage`, `discoveredForms`, remet `eggClicks = 0` si `'egg'` et réveille le pet.
   */
  public forceSetForm(formId: FormId, nowMs?: number): PetState {
    const speciesDef = this.species.find((item) => item.id === formId);
    const nextStage = speciesDef?.stage ?? FORM_TO_STAGE[formId] ?? 'egg';
    const nextLineage = speciesDef?.lineage ?? FORM_TO_LINEAGE[formId] ?? 'none';

    const discovered = this.saveData.pet.discoveredForms.includes(formId)
      ? [...this.saveData.pet.discoveredForms]
      : [...this.saveData.pet.discoveredForms, formId];

    const safeNow =
      typeof nowMs === 'number' && Number.isFinite(nowMs)
        ? nowMs
        : this.saveData.pet.lastUpdatedAt;

    const requiredClicks = this.config.eggClicksRequired || 5;
    const nextEggClicks =
      formId === 'egg'
        ? 0
        : Math.max(this.saveData.pet.careStats.eggClicks ?? 0, requiredClicks);

    this.saveData.pet = {
      ...this.saveData.pet,
      formId,
      stage: nextStage,
      lineage: nextLineage,
      isSleeping: false,
      poopCount: formId === 'egg' ? 0 : this.saveData.pet.poopCount,
      cleaningProgress: formId === 'egg' ? 0 : this.saveData.pet.cleaningProgress,
      needsCuddle: formId === 'egg' ? false : this.saveData.pet.needsCuddle,
      needsPlay: formId === 'egg' ? false : this.saveData.pet.needsPlay,
      lastUpdatedAt: safeNow,
      discoveredForms: discovered,
      careStats: {
        ...this.saveData.pet.careStats,
        foodCategoryCounts: { ...this.saveData.pet.careStats.foodCategoryCounts },
        eggClicks: nextEggClicks,
      },
    };

    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return this.getState();
  }

  /**
   * [Sandbox / Menu Test] Fait évoluer immédiatement le familier vers `targetFormId`
   * (ou vers la 1ère évolution disponible de sa forme actuelle, ou un starter aléatoire s'il est un œuf),
   * sans bloquer sur les compteurs de temps ou de clics.
   */
  public forceEvolve(
    targetFormId?: FormId,
    nowMs?: number
  ): {
    evolved: boolean;
    newForm: SpeciesFormDefinition | null;
    pet: PetState;
  } {
    let resolvedTargetId: FormId | undefined = targetFormId;

    if (!resolvedTargetId) {
      if (this.saveData.pet.stage === 'egg' || this.saveData.pet.formId === 'egg') {
        const index = Math.floor(Math.random() * STARTER_FORM_IDS.length);
        const randomStarter: StarterFormId =
          STARTER_FORM_IDS[index] ?? 'baby_aqua';
        resolvedTargetId = randomStarter;
      } else {
        const currentDef = this.getCurrentSpeciesForm();
        if (currentDef && currentDef.evolutions && currentDef.evolutions.length > 0) {
          resolvedTargetId = currentDef.evolutions[0].targetFormId;
        }
      }
    }

    if (!resolvedTargetId) {
      return {
        evolved: false,
        newForm: null,
        pet: this.getState(),
      };
    }

    const targetForm =
      this.species.find((item) => item.id === resolvedTargetId) ?? null;
    if (!targetForm) {
      return {
        evolved: false,
        newForm: null,
        pet: this.getState(),
      };
    }

    const updatedPet = this.forceSetForm(targetForm.id, nowMs);
    return {
      evolved: true,
      newForm: targetForm,
      pet: updatedPet,
    };
  }

  /**
   * [Sandbox / Menu Test] Simule à la demande un état de besoin ou un boost marathon :
   * - `'hungry'` : faim à 15
   * - `'dirty'` : propreté à 15 + 3 crottes
   * - `'need_cuddle'` : `needsCuddle = true`, bonheur à 40
   * - `'need_play'` : `needsPlay = true`, bonheur à 38
   * - `'tired'` : énergie à 12
   * - `'full_restore'` : toutes les jauges à 100%, 0 crotte, besoins apaisés
   * - `'boost_marathon'` : +15 000 clics/touches PC, +40h d'âge, +15 soins
   */
  public simulateCondition(
    type: SandboxConditionType,
    nowMs?: number
  ): PetState {
    const safeNow =
      typeof nowMs === 'number' && Number.isFinite(nowMs)
        ? nowMs
        : this.saveData.pet.lastUpdatedAt;

    const pet = this.saveData.pet;

    switch (type) {
      case 'hungry': {
        this.saveData.pet = {
          ...pet,
          isSleeping: false,
          lastUpdatedAt: safeNow,
          needs: {
            ...pet.needs,
            hunger: 15,
          },
        };
        break;
      }
      case 'dirty': {
        this.saveData.pet = {
          ...pet,
          isSleeping: false,
          poopCount: 3,
          cleaningProgress: 0,
          lastUpdatedAt: safeNow,
          needs: {
            ...pet.needs,
            cleanliness: 15,
          },
        };
        break;
      }
      case 'need_cuddle': {
        this.saveData.pet = {
          ...pet,
          isSleeping: false,
          needsCuddle: true,
          lastPettedAt: 0,
          lastUpdatedAt: safeNow,
          needs: {
            ...pet.needs,
            happiness: 42,
          },
        };
        break;
      }
      case 'need_play': {
        this.saveData.pet = {
          ...pet,
          isSleeping: false,
          needsPlay: true,
          lastUpdatedAt: safeNow,
          needs: {
            ...pet.needs,
            happiness: 38,
            energy: Math.max(50, pet.needs.energy),
          },
          careStats: {
            ...pet.careStats,
            foodCategoryCounts: { ...pet.careStats.foodCategoryCounts },
            lastPlayedAt: 0,
          },
        };
        break;
      }
      case 'tired': {
        this.saveData.pet = {
          ...pet,
          needsPlay: false,
          lastUpdatedAt: safeNow,
          needs: {
            ...pet.needs,
            energy: 12,
          },
        };
        break;
      }
      case 'full_restore': {
        this.poopSecondsAccumulator = 0;
        this.saveData.pet = {
          ...pet,
          isSleeping: false,
          poopCount: 0,
          cleaningProgress: 0,
          needsCuddle: false,
          needsPlay: false,
          lastUpdatedAt: safeNow,
          needs: {
            hunger: 100,
            energy: 100,
            happiness: 100,
            cleanliness: 100,
          },
        };
        break;
      }
      case 'boost_marathon': {
        const stats = pet.careStats;
        this.saveData.pet = {
          ...pet,
          ageSeconds: Math.round((pet.ageSeconds + 40 * 3600) * 100) / 100,
          lastUpdatedAt: safeNow,
          careStats: {
            ...stats,
            totalMeals: stats.totalMeals + 5,
            foodCategoryCounts: {
              ...stats.foodCategoryCounts,
              healthy: (stats.foodCategoryCounts.healthy ?? 0) + 5,
            },
            totalGamesPlayed: stats.totalGamesPlayed + 3,
            totalGamesWon: stats.totalGamesWon + 2,
            totalPets: stats.totalPets + 4,
            totalCleans: stats.totalCleans + 3,
            pcMouseClicks: (stats.pcMouseClicks ?? 0) + 7500,
            pcKeyPresses: (stats.pcKeyPresses ?? 0) + 7500,
            pcActiveSeconds: (stats.pcActiveSeconds ?? 0) + 36000,
          },
        };
        break;
      }
      case 'add_coins': {
        this.saveData.pet = {
          ...pet,
          tamaCoins: (pet.tamaCoins ?? 0) + 1000,
          lastUpdatedAt: safeNow,
        };
        break;
      }
    }

    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
      this.saveData.savedAt = nowMs;
    }

    return this.getState();
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
