/**
 * Contrats de données partagés pour le projet Tamagotchi Desktop Pet.
 * Ce module appartient à `src/core/` et ne dépend d'aucune API DOM, Node.js ou Electron.
 */

/** Stades du cycle de vie du familier. */
export type StageId = 'egg' | 'baby' | 'child' | 'adult';

/** Lignées élémentaires disponibles pour le familier ('none' au stade d'œuf). */
export type LineageId = 'none' | 'aqua' | 'flora' | 'ember';

/** Identifiants des 3 starters bébés possibles à l'éclosion de l'œuf. */
export type StarterFormId = 'baby_aqua' | 'baby_flora' | 'baby_ember';

/** Identifiants uniques des 19 formes d'évolution disponibles dans `data/species.json`. */
export type FormId =
  | 'egg'
  // Lignée Aquatique (aqua)
  | 'baby_aqua'
  | 'child_aqua'
  | 'adult_aqua_coral'
  | 'adult_aqua_leviathan'
  | 'adult_aqua_pearl'
  | 'adult_aqua_abyss'
  // Lignée Sylvestre (flora)
  | 'baby_flora'
  | 'child_flora'
  | 'adult_flora_bloom'
  | 'adult_flora_raptor'
  | 'adult_flora_truffle'
  | 'adult_flora_thorn'
  // Lignée Astrale / Flamme (ember)
  | 'baby_ember'
  | 'child_ember'
  | 'adult_ember_solar'
  | 'adult_ember_comet'
  | 'adult_ember_magma'
  | 'adult_ember_eclipse';

/** États de la machine à états d'animation du familier sur le Canvas 2D. */
export type AnimationState =
  | 'idle'
  | 'walk'
  | 'eat'
  | 'happy'
  | 'play'
  | 'sleep'
  | 'sad'
  | 'evolve'
  | 'hungry'
  | 'need_cuddle'
  | 'need_play'
  | 'cleaning';

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

/** Emplacements d'équipement cosmétique disponibles sur le familier. */
export type CosmeticSlot = 'hat' | 'accessory' | 'aura';

/** Identifiant unique d'un objet cosmétique. */
export type CosmeticId = string;

/** Définition d'un objet cosmétique issu de `data/cosmetics.json`. */
export interface CosmeticItem {
  id: string;
  name: string;
  slot: CosmeticSlot;
  icon: string;
  description: string;
  price: number;
}

/** Cosmétiques actuellement équipés sur les 3 emplacements du familier. */
export interface EquippedCosmetics {
  hat: string | null;
  accessory: string | null;
  aura: string | null;
}

/** Profil d'un familier ami reçu en visite Online (Salon Temps Réel) ou par Code Passeport. */
export interface FriendPetProfile {
  id: string;
  name: string;
  ownerName: string;
  formId: FormId;
  stage: StageId;
  lineage: LineageId;
  equippedCosmetics: EquippedCosmetics;
  happiness: number;
  x?: number;
  direction?: 1 | -1;
  animationState?: AnimationState;
}

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
  /** Prix en pièces TamaCoins dans la boutique (ex: 5 pour une pomme). */
  price?: number;
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

/** Statistiques cumulées de soin et d'activité PC déterminant les branches d'évolution. */
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
  /** Clics effectués sur l'œuf (éclot à `eggClicksRequired`, par défaut 5). */
  eggClicks: number;
  /** Nombre cumulé de clics souris détectés sur le PC. */
  pcMouseClicks: number;
  /** Nombre cumulé de touches clavier pressées sur le PC (compteur anonyme). */
  pcKeyPresses: number;
  /** Secondes cumulées d'activité PC. */
  pcActiveSeconds: number;
  /** Timestamp UTC (ms) du dernier mini-jeu joué pour détecter le besoin de jouer. */
  lastPlayedAt: number;
}

/** Condition déterministe permettant d'évoluer vers une forme cible. */
export interface EvolutionCondition {
  /** Âge minimum requis en secondes pour déclencher cette évolution. */
  minAgeSeconds: number;
  /** Nombre minimal de clics sur l'œuf requis pour l'éclosion. */
  minEggClicks?: number;
  /** Nombre minimal d'entrées PC requis (`pcMouseClicks + pcKeyPresses`). */
  minPcInputs?: number;
  /** Nombre minimal d'actions de soin requis (`totalMeals + totalGamesPlayed + totalPets + totalCleans`). */
  minCareActions?: number;
  /** Nombre maximal d'erreurs de soin tolérées (inclusif). */
  maxCareMistakes?: number;
  /** Nombre minimal d'erreurs de soin requis (inclusif). */
  minCareMistakes?: number;
  /** Catégorie alimentaire devant être la plus fréquente (ou privilégiée). */
  preferredFoodCategory?: FoodCategory;
  /** Catégories alimentaires alternatives acceptées comme dominantes (en complément de `preferredFoodCategory`). */
  allowedCategories?: FoodCategory[];
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
  /** Lignée élémentaire à laquelle appartient cette forme. */
  lineage?: LineageId;
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
  /** Nombre de clics requis sur l'œuf pour déclencher son éclosion interactive. */
  eggClicksRequired: number;
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
  /** Gain de propreté octroyé par une action de nettoyage complet. */
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
  /** Permet au familier de sauter occasionnellement sur les fenêtres actives. */
  windowJumpEnabled: boolean;
}

/** État dynamique complet du familier persisté dans la sauvegarde. */
export interface PetState {
  /** Nom donné au familier. */
  name: string;
  /** Forme actuelle du familier. */
  formId: FormId;
  /** Stade actuel du cycle de vie. */
  stage: StageId;
  /** Lignée élémentaire du familier ('none' tant qu'il est un œuf). */
  lineage: LineageId;
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
  /** Progression du brossage à l'éponge en cours (0 à 100). */
  cleaningProgress: number;
  /** Indique si le familier réclame actuellement un câlin. */
  needsCuddle: boolean;
  /** Indique si le familier réclame actuellement de jouer. */
  needsPlay: boolean;
  /** Timestamp UTC (ms) de la dernière caresse prise en compte. */
  lastPettedAt: number;
  /** Liste des formes déjà découvertes (Compendium). */
  discoveredForms: FormId[];
  /** Position actuelle (coordonnées logiques sur la zone de travail). */
  position: { x: number; y: number };
  /** Statistiques cumulées d'élevage et de soin. */
  careStats: CareStats;
  /** Monnaie TamaCoins gagnée en prenant soin du familier et en jouant aux mini-jeux. */
  tamaCoins: number;
  /** Liste des identifiants d'objets cosmétiques débloqués/achetés. */
  ownedCosmetics: string[];
  /** Objets cosmétiques actuellement équipés sur le familier. */
  equippedCosmetics: EquippedCosmetics;
  /** Inventaire des portions de nourriture achetées en boutique { [foodId]: quantity }. */
  foodInventory?: Record<string, number>;
  /** État du minuteur Focus / Pomodoro pour la productivité. */
  pomodoro?: PomodoroState;
}

/** Informations de géométrie de la fenêtre active au premier plan sous Windows. */
export interface ActiveWindowInfo {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Modes du système Pomodoro de productivité. */
export type PomodoroMode = 'idle' | 'work' | 'break' | 'paused';

/** État complet du minuteur Pomodoro. */
export interface PomodoroState {
  isActive: boolean;
  mode: PomodoroMode;
  workDurationMinutes: number;
  breakDurationMinutes: number;
  remainingSeconds: number;
  totalWorkSessionsCompleted: number;
}

/** Résultat de l'avancée d'une seconde du minuteur Pomodoro. */
export interface PomodoroTickResult {
  state: PomodoroState;
  phaseCompleted?: 'work' | 'break';
  reward?: {
    coins: number;
    happiness: number;
    energy: number;
  };
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
  | 'open-shop'
  | 'open-online'
  | 'open-compendium'
  | 'open-sandbox'
  | 'start-pomodoro'
  | 'toggle-pomodoro'
  | 'stop-pomodoro'
  | 'play-fetch'
  | 'jump-active-window'
  | 'center-pet'
  | 'reset-pet';

/** Lot d'activité PC agrégé et anonymisé envoyé par le processus principal Electron. */
export interface PcActivityBatch {
  mouseClicks: number;
  keyPresses: number;
  activeSeconds: number;
  activeWindow?: ActiveWindowInfo | null;
  isMusicPlaying?: boolean;
}

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
  /** Catalogue des objets cosmétiques de la boutique. */
  cosmetics: CosmeticItem[];
  /** Rapport du rattrapage hors-ligne calculé à l'ouverture. */
  offlineReport: OfflineCatchupReport;
  /** Liste des écrans détectés. */
  displays: DisplayBoundsInfo[];
  /** Indique si l'application est exécutée en édition Développeur / Sandbox. */
  isDevEdition?: boolean;
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
  /** Écoute les lots périodiques d'activité PC (clics souris, frappes clavier anonymes, secondes actives, fenêtre active). */
  onPcActivityBatch?(
    callback: (batch: PcActivityBatch) => void
  ): () => void;
  /** Écoute spécifiquement les changements de la fenêtre active au premier plan sous Windows. */
  onActiveWindowChanged?(callback: (windowInfo: ActiveWindowInfo | null) => void): () => void;
  /** Écoute les changements d'état d'écoute musicale (YouTube Music, Spotify, etc.). */
  onMusicStateChanged?(callback: (isPlaying: boolean) => void): () => void;
}

declare global {
  interface Window {
    petAPI?: PetIPCContract;
  }
}
