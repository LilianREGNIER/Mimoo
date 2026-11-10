/**
 * Contrats de données partagés pour le projet Tamagotchi Desktop Pet.
 * Ce module appartient à `src/core/` et ne dépend d'aucune API DOM, Node.js ou Electron.
 */

/** Stades du cycle de vie du familier. */
export type StageId = 'egg' | 'baby' | 'child' | 'adult';

/** Identifiants uniques des 7 formes d'évolution disponibles dans `data/species.json`. */
export type FormId =
  | 'egg'
  | 'baby_blob'
  | 'child_sprout'
  | 'adult_solar'
  | 'adult_athletic'
  | 'adult_gourmet'
  | 'adult_shadow';

/** États de la machine à états d'animation du familier sur le Canvas 2D. */
export type AnimationState =
  | 'idle'
  | 'walk'
  | 'eat'
  | 'happy'
  | 'play'
  | 'sleep'
  | 'sad'
  | 'evolve';

/** Clés des 4 jauges de besoins fondamentaux. */
export type NeedKey = 'hunger' | 'energy' | 'happiness' | 'cleanliness';

/**
 * État des 4 besoins fondamentaux du familier.
 * Chaque valeur est bornée dans l'intervalle [0, 100].
 */
export interface NeedsState {
  /** Satiété (0 = affamé, 100 = rassasié). */
  hunger: number;
  /** Énergie (0 = épuisé, 100 = pleine forme). */
  energy: number;
  /** Bonheur / Humeur (0 = triste, 100 = comblé). */
  happiness: number;
  /** Propreté / Hygiène (0 = très sale, 100 = impeccable). */
  cleanliness: number;
}

/** Catégories nutritionnelles influençant les branches d'évolution. */
export type FoodCategory = 'healthy' | 'snack' | 'energizing' | 'gourmet';

/** Définition d'un aliment issu de `data/foods.json`. */
export interface FoodItem {
  /** Identifiant unique de l'aliment (ex: 'apple_fresh'). */
  id: string;
  /** Nom affiché dans l'interface utilisateur. */
  name: string;
  /** Emoji ou chemin d'icône associé. */
  icon: string;
  /** Description courte des effets de l'aliment. */
  description: string;
  /** Catégorie nutritionnelle comptabilisée dans `CareStats.foodCategoryCounts`. */
  category: FoodCategory;
  /** Effets appliqués aux jauges de besoins lors de la consommation. */
  effects: Partial<NeedsState>;
  /** Temps de recharge optionnel en millisecondes. */
  cooldownMs?: number;
}

/** Identifiants des mini-jeux jouables avec le familier. */
export type MiniGameId = 'star_catch' | 'rps_duel';

/** Résultat d'une session de mini-jeu. */
export interface MiniGameResult {
  /** Identifiant du mini-jeu terminé. */
  gameId: MiniGameId;
  /** Score obtenu par le joueur. */
  score: number;
  /** Score maximal possible ou cible de la partie. */
  maxScore: number;
  /** Indique si la partie est considérée comme gagnée. */
  won: boolean;
}

/** Statistiques cumulées de soin déterminant les branches d'évolution. */
export interface CareStats {
  /** Nombre total de repas donnés au familier. */
  totalMeals: number;
  /** Répartition des repas par catégorie alimentaire. */
  foodCategoryCounts: Record<FoodCategory, number>;
  /** Nombre total de mini-jeux joués. */
  totalGamesPlayed: number;
  /** Nombre total de mini-jeux remportés. */
  totalGamesWon: number;
  /** Nombre total de caresses validées. */
  totalPets: number;
  /** Nombre total de nettoyages effectués. */
  totalCleans: number;
  /** Nombre d'erreurs de soin (négligence prolongée sous le seuil critique). */
  careMistakes: number;
  /** Accumulateur (en secondes) du temps passé avec au moins un besoin sous le seuil critique. */
  neglectSecondsAccumulator: number;
}

/** Condition déterministe permettant d'évoluer vers une forme cible. */
export interface EvolutionCondition {
  /** Âge minimum requis en secondes pour déclencher cette évolution. */
  minAgeSeconds: number;
  /** Nombre maximal d'erreurs de soin tolérées (inclusif). */
  maxCareMistakes?: number;
  /** Nombre minimal d'erreurs de soin requis (inclusif). */
  minCareMistakes?: number;
  /** Catégorie alimentaire devant être la plus fréquente (ou privilégiée). */
  preferredFoodCategory?: FoodCategory;
  /** Nombre minimal de parties de mini-jeux jouées. */
  minGamesPlayed?: number;
  /** Niveau minimal de bonheur requis au moment de l'évaluation. */
  minHappiness?: number;
  /** Priorité d'évaluation (plus la valeur est élevée, plus la branche est testée tôt). */
  priority: number;
}

/** Branche d'évolution reliant une forme actuelle à une forme cible. */
export interface EvolutionBranch {
  /** Identifiant de la forme atteinte si la condition est remplie. */
  targetFormId: FormId;
  /** Condition d'accès à cette branche. */
  condition: EvolutionCondition;
}

/** Définition complète d'une forme d'espèce issue de `data/species.json`. */
export interface SpeciesFormDefinition {
  /** Identifiant unique de la forme. */
  id: FormId;
  /** Nom affiché de la forme. */
  name: string;
  /** Stade de vie correspondant. */
  stage: StageId;
  /** Description encyclopédique pour le Compendium. */
  description: string;
  /** Chemin relatif vers la sprite sheet ou l'asset de la forme. */
  spriteSheet: string;
  /** Facteur d'échelle par défaut du rendu. */
  scale: number;
  /** Vitesse de déplacement horizontal sur le bureau (pixels par seconde). */
  walkSpeed: number;
  /** Liste des évolutions possibles depuis cette forme. */
  evolutions: EvolutionBranch[];
}

/** Paramètres globaux d'équilibrage chargés depuis `data/game-config.json`. */
export interface GameConfig {
  /** Taux de baisse par minute pour chaque besoin lorsque le familier est éveillé. */
  decayPerMinuteAwake: NeedsState;
  /** Taux de baisse par minute pour chaque besoin lorsque le familier dort. */
  decayPerMinuteAsleep: NeedsState;
  /** Points d'énergie récupérés par minute de sommeil. */
  sleepEnergyRecoveryPerMinute: number;
  /** Plancher hors-ligne : aucun besoin ne descend sous cette valeur pendant que l'app est fermée. */
  offlineFloor: number;
  /** Durée maximale (en heures) prise en compte lors du rattrapage hors-ligne. */
  maxOfflineHours: number;
  /** Seuil critique (sur 100) en dessous duquel un besoin déclenche une alerte et de la négligence. */
  criticalThreshold: number;
  /** Durée cumulée (en secondes) en état critique avant d'incrémenter `careMistakes`. */
  careMistakeGraceSeconds: number;
  /** Temps de recharge (en ms) entre deux caresses octroyant un bonus de bonheur. */
  petCooldownMs: number;
  /** Bonus de bonheur octroyé par une caresse valide. */
  petHappinessBonus: number;
  /** Gain de propreté octroyé par une action de nettoyage. */
  cleanlinessBonusPerClean: number;
  /** Pénalité supplémentaire de propreté par minute pour chaque salissure présente. */
  poopPenaltyPerMinute: number;
  /** Intervalle en secondes entre l'apparition de deux salissures (quand éveillé). */
  poopIntervalSeconds: number;
}

/** Préférences utilisateur persistées dans la sauvegarde. */
export interface UserSettings {
  /** Démarrage automatique avec Windows. */
  autoStartEnabled: boolean;
  /** Activation des notifications système Windows (toasts). */
  notificationsEnabled: boolean;
  /** Limite de FPS en mode repos (idle/sleep) pour économiser le CPU/GPU. */
  fpsLimitIdle: number;
  /** Limite de FPS en mode actif (interaction, marche, mini-jeu). */
  fpsLimitActive: number;
  /** Identifiant de l'écran préféré (ou `null` pour l'écran principal). */
  preferredDisplayId: number | null;
  /** Multiplicateur d'échelle d'affichage du familier choisi par l'utilisateur. */
  petScale: number;
}

/** État dynamique complet du familier persisté dans la sauvegarde. */
export interface PetState {
  /** Nom donné au familier. */
  name: string;
  /** Forme actuelle du familier. */
  formId: FormId;
  /** Stade actuel du cycle de vie. */
  stage: StageId;
  /** Timestamp UTC (ms) de naissance du familier. */
  bornAt: number;
  /** Timestamp UTC (ms) de la dernière mise à jour d'état. */
  lastUpdatedAt: number;
  /** Âge cumulé du familier en secondes. */
  ageSeconds: number;
  /** Valeurs courantes des 4 jauges de besoins. */
  needs: NeedsState;
  /** Indique si le familier est actuellement endormi. */
  isSleeping: boolean;
  /** Nombre de salissures présentes autour du familier. */
  poopCount: number;
  /** Timestamp UTC (ms) de la dernière caresse prise en compte. */
  lastPettedAt: number;
  /** Liste des formes déjà découvertes (Compendium). */
  discoveredForms: FormId[];
  /** Position actuelle (coordonnées logiques sur la zone de travail). */
  position: { x: number; y: number };
  /** Statistiques cumulées d'élevage et de soin. */
  careStats: CareStats;
}

/** Format de sauvegarde locale versionné (Schéma v1). */
export interface SaveDataV1 {
  /** Version du schéma de sauvegarde pour le système de migration. */
  schemaVersion: 1;
  /** Timestamp UTC (ms) de l'écriture de la sauvegarde. */
  savedAt: number;
  /** État complet du familier. */
  pet: PetState;
  /** Préférences de l'utilisateur. */
  settings: UserSettings;
}

/** Rapport détaillé généré lors du calcul de rattrapage hors-ligne (offline catch-up). */
export interface OfflineCatchupReport {
  /** Temps réel écoulé en millisecondes depuis `lastUpdatedAt`. */
  elapsedMs: number;
  /** Temps effectif appliqué après plafonnement (`maxOfflineHours`) et protection anti-recul d'horloge. */
  clampedMs: number;
  /** Indique si une anomalie d'horloge système (delta négatif) a été détectée. */
  clockSkewDetected: boolean;
  /** Variation appliquée à chaque besoin pendant la période hors-ligne. */
  needsDelta: NeedsState;
  /** Indique si le plancher `offlineFloor` a protégé au moins un besoin. */
  floorApplied: boolean;
}

/** Informations géométriques d'un moniteur Windows pour le support multi-écrans. */
export interface DisplayBoundsInfo {
  /** Identifiant unique de l'écran fourni par Electron Screen API. */
  id: number;
  /** Libellé lisible de l'écran. */
  label: string;
  /** Dimensions totales de l'écran. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Zone de travail utile (hors barre des tâches Windows). */
  workArea: { x: number; y: number; width: number; height: number };
  /** Indique s'il s'agit du moniteur principal. */
  isPrimary: boolean;
}

/** Actions pouvant être déclenchées depuis le menu du System Tray Windows. */
export type TrayActionType =
  | 'open-hud'
  | 'feed'
  | 'play'
  | 'toggle-sleep'
  | 'clean'
  | 'open-compendium'
  | 'center-pet'
  | 'reset-pet';

/** Charge utile initiale renvoyée au Renderer lors de l'initialisation IPC. */
export interface BootstrapPayload {
  /** Sauvegarde chargée (et migrée + rattrapée hors-ligne). */
  saveData: SaveDataV1;
  /** Configuration d'équilibrage du jeu. */
  gameConfig: GameConfig;
  /** Catalogue des aliments disponibles. */
  foods: FoodItem[];
  /** Catalogue des formes et règles d'évolution. */
  species: SpeciesFormDefinition[];
  /** Rapport du rattrapage hors-ligne calculé à l'ouverture. */
  offlineReport: OfflineCatchupReport;
  /** Liste des écrans détectés. */
  displays: DisplayBoundsInfo[];
}

/**
 * Contrat de l'API IPC sécurisée exposée dans `window.petAPI` par `src/preload/preload.ts`.
 */
export interface PetIPCContract {
  /** Récupère les données initiales (sauvegarde, configurations JSON, écrans, rapport offline). */
  bootstrap(): Promise<BootstrapPayload>;
  /** Persiste l'intégralité de la sauvegarde sur le disque de manière atomique. */
  saveState(saveData: SaveDataV1): Promise<boolean>;
  /** Réinitialise la partie avec un nouvel œuf et retourne la nouvelle sauvegarde. */
  resetSave(newPetName?: string): Promise<SaveDataV1>;
  /** Active ou désactive le click-through sur les zones transparentes de la fenêtre. */
  setIgnoreMouseEvents(ignore: boolean, forward?: boolean): Promise<void>;
  /** Met à jour les préférences utilisateur (auto-start, notifications, FPS, échelle, écran). */
  updateSettings(settings: Partial<UserSettings>): Promise<UserSettings>;
  /** Retourne la liste actualisée des écrans connectés. */
  getDisplays(): Promise<DisplayBoundsInfo[]>;
  /** Déplace l'overlay vers l'écran correspondant à `displayId`. */
  moveToDisplay(displayId: number): Promise<DisplayBoundsInfo | null>;
  /** Envoie une notification native Windows (avec anti-spam côté Main). */
  notifyCriticalNeed(title: string, body: string): Promise<void>;
  /** Écoute les commandes déclenchées depuis l'icône du System Tray Windows. */
  onTrayAction(callback: (action: TrayActionType) => void): () => void;
  /** Écoute les changements de topologie d'écrans (ajout/retrait/résolution). */
  onDisplayChanged(callback: (displays: DisplayBoundsInfo[]) => void): () => void;
}

declare global {
  interface Window {
    petAPI?: PetIPCContract;
  }
}
