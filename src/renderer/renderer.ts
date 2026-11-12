/**
 * Point d'entrée principal du processus Renderer (`src/renderer/renderer.ts`).
 * Orchestre `PetEngine`, la boucle de rendu Canvas 2D à FPS adaptatif (30 FPS actif / 5 FPS repos),
 * l'éclosion interactive de l'œuf en 5 clics, le nettoyage à l'éponge, les animations de besoins
 * (faim, besoin de câlin, besoin de jouer), le suivi d'activité PC et le Menu Spécial Test / Sandbox.
 */

import defaultCosmeticsJson from '../../data/cosmetics.json';
import defaultFoodsJson from '../../data/foods.json';
import defaultGameConfigJson from '../../data/game-config.json';
import defaultSpeciesJson from '../../data/species.json';
import {
  createInitialSaveData,
  PetEngine,
  STARTER_FORM_IDS,
  type ActiveWindowInfo,
  type BootstrapPayload,
  type CosmeticItem,
  type DisplayBoundsInfo,
  type AnimationState,
  type FoodCategory,
  type FoodItem,
  type FormId,
  type FriendPetProfile,
  type GameConfig,
  type LineageId,
  type MiniGameResult,
  type NeedKey,
  type PetState,
  type PomodoroMode,
  type PomodoroState,
  type PomodoroTickResult,
  type SandboxConditionType,
  type SpeciesFormDefinition,
  type StarterFormId,
  type TrayActionType,
} from '../core';
import { BallEntity } from './ballEntity';
import { HitTester } from './hitTester';
import { MiniGamesController } from './miniGames';
import { OnlineManager } from './onlineManager';
import { PetActor } from './petActor';
import {
  type DialoguePropType,
  type ParticleKind,
  SpriteAnimator,
} from './spriteAnimator';

const STAGE_LABELS: Record<string, string> = {
  egg: 'Œuf',
  baby: 'Bébé',
  child: 'Enfant',
  adult: 'Adulte',
};

const LINEAGE_LABELS: Record<LineageId, string> = {
  none: 'Céleste',
  aqua: 'Aquatique 💧',
  flora: 'Sylvestre 🌱',
  ember: 'Astrale 🔥',
};

const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  healthy: 'Sain 🍎',
  energizing: 'Tonique 🫐',
  snack: 'Friandise 🍯',
  gourmet: 'Gourmet 🍣',
};

const NEED_ALERT_LABELS: Record<NeedKey, { title: string; speech: string }> = {
  hunger: {
    title: 'Votre familier a très faim ! 🍖',
    speech: "J'ai le ventre qui gargouille... 🍖",
  },
  energy: {
    title: 'Votre familier est épuisé ! ⚡',
    speech: 'Je tombe de fatigue... Zzz 💤',
  },
  happiness: {
    title: 'Votre familier se sent seul ! 💖',
    speech: "On joue ensemble ? J'ai besoin d'un câlin 🥺",
  },
  cleanliness: {
    title: 'Un petit coup d’éponge est nécessaire ! 🧽',
    speech: "J'ai besoin d'un bon brossage à l'éponge ! 🧽🫧",
  },
};

/**
 * Crée un payload d'initialisation autonome en mémoire si `window.petAPI` est absent (mode navigateur/test).
 */
function createFallbackBootstrap(): BootstrapPayload {
  const saveData = createInitialSaveData('Mochi', Date.now());
  return {
    saveData,
    gameConfig: defaultGameConfigJson as GameConfig,
    foods: defaultFoodsJson as FoodItem[],
    species: defaultSpeciesJson as SpeciesFormDefinition[],
    cosmetics: defaultCosmeticsJson as unknown as CosmeticItem[],
    offlineReport: {
      elapsedMs: 0,
      clampedMs: 0,
      clockSkewDetected: false,
      needsDelta: { hunger: 0, energy: 0, happiness: 0, cleanliness: 0 },
      floorApplied: false,
    },
    displays: [
      {
        id: 1,
        label: 'Écran Principal (Navigateur)',
        bounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        workArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        isPrimary: true,
      },
    ],
  };
}

class DesktopPetRendererApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private engine!: PetEngine;
  private animator!: SpriteAnimator;
  private petActor!: PetActor;
  private miniGames!: MiniGamesController;
  private hitTester!: HitTester;
  private onlineManager!: OnlineManager;
  private displays: DisplayBoundsInfo[] = [];

  // Mode Éponge / Brosse interactif
  private isSpongeMode = false;
  private isPlayingTogetherWithFriend = false;

  // Mode Balle & Mode Musique
  private readonly ballEntity = new BallEntity();
  private isBallThrowMode = false;
  private isDraggingBall = false;
  private ballDragHistory: { x: number; y: number; time: number }[] = [];
  private isMusicMode = false;

  // Mode Focus & Pomodoro
  private selectedPomodoroWorkMinutes = 25;
  private selectedPomodoroBreakMinutes = 5;

  // Cadence de rendu adaptative (30 FPS actif / 5 FPS éco repos)
  private isActiveFpsMode = true;
  private currentTargetFps = 30;
  private lastFrameTimestamp = 0;
  private lastLogicTickTimestamp = 0;
  private lastAutoSaveTimestamp = 0;
  private lastNotificationTimestamp = 0;
  private lastOverlayInputTimestamp = 0;
  private hasMainPcActivityHook = false;
  private speechHideTimeout: number | null = null;

  // Références DOM principales
  private readonly hudEl = document.getElementById('pet-hud');
  private readonly drawerFoodsEl = document.getElementById('drawer-foods');
  private readonly drawerGamesEl = document.getElementById('drawer-games');
  private readonly statsModalEl = document.getElementById('stats-modal');
  private readonly sandboxModalEl = document.getElementById('sandbox-modal');
  private readonly shopModalEl = document.getElementById('shop-modal');
  private readonly onlineModalEl = document.getElementById('online-modal');
  private readonly pomodoroModalEl = document.getElementById('pomodoro-modal');
  private readonly pomodoroPillEl = document.getElementById('pomodoro-pill');
  private readonly pomodoroTimerLabelEl = document.getElementById('pomodoro-timer-label');
  private readonly pomodoroModeBadgeEl = document.getElementById('pomodoro-mode-badge');
  private readonly pomodoroDisplayBigEl = document.getElementById('pomodoro-display-big');
  private readonly pomodoroPhaseBigEl = document.getElementById('pomodoro-phase-big');
  private readonly pomodoroSessionsCountEl = document.getElementById('pomodoro-sessions-count');
  private readonly btnPomodoroStartEl = document.getElementById('btn-pomodoro-start');
  private readonly btnPomodoroPauseEl = document.getElementById('btn-pomodoro-pause');
  private readonly btnPomodoroStopEl = document.getElementById('btn-pomodoro-stop');
  private readonly btnPomoToggleEl = document.getElementById('btn-pomo-toggle');
  private readonly btnPomoStopEl = document.getElementById('btn-pomo-stop');
  private readonly ballModeBannerEl = document.getElementById('ball-mode-banner');
  private isDevEdition = false;

  // Dialogues spontanés ("de temps en temps, juste comme ça")
  private lastAutonomousDialogueTimestamp = performance.now();
  private nextAutonomousDialogueDelayMs = 24_000 + Math.random() * 26_000;
  private lastKeyDialogueTimestamp = 0;
  private lastClickDialogueTimestamp = 0;
  private recentKeyPressesWindow: { count: number; timestamp: number }[] = [];
  private recentMouseClicksWindow: { count: number; timestamp: number }[] = [];
  private readonly shopItemsGridEl = document.getElementById('shop-items-grid');
  private readonly shopCoinsValEl = document.getElementById('shop-coins-val');
  private readonly hudCoinsCountEl = document.getElementById('hud-coins-count');
  private readonly speechBubbleEl = document.getElementById('pet-speech-bubble');
  private readonly speechTextEl = document.getElementById('pet-speech-text');

  private currentShopCategory = 'all';
  private currentShopTab: 'market' | 'inventory' = 'market';
  private shopModalPositioned = false;

  constructor() {
    const canvasEl = document.getElementById('pet-canvas') as HTMLCanvasElement | null;
    if (!canvasEl) {
      throw new Error('Élément <canvas id="pet-canvas"> introuvable.');
    }
    const context = canvasEl.getContext('2d');
    if (!context) {
      throw new Error('Impossible d’initialiser le contexte Canvas 2D.');
    }
    this.canvas = canvasEl;
    this.ctx = context;
  }

  public async init(): Promise<void> {
    this.resizeCanvas();
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.petActor?.setScales(
        this.engine?.getCurrentSpeciesForm()?.scale ?? 1,
        this.engine?.getSaveData().settings.petScale ?? 1
      );
      this.updateFloatingPanelsPosition();
    });

    // 1. Chargement initial via IPC (ou fallback autonome en mémoire)
    let payload: BootstrapPayload;
    try {
      payload = window.petAPI
        ? await window.petAPI.bootstrap()
        : createFallbackBootstrap();
    } catch {
      payload = createFallbackBootstrap();
    }

    this.displays = payload.displays ?? [];
    this.engine = new PetEngine({
      saveData: payload.saveData,
      config: payload.gameConfig,
      foods: payload.foods,
      species: payload.species,
      cosmetics: payload.cosmetics ?? (defaultCosmeticsJson as unknown as CosmeticItem[]),
    });

    // 2. Initialisation du moteur de spritesheets (19 formes, 8 lignes)
    this.animator = new SpriteAnimator();
    await this.animator.preloadAllSprites();

    // 3. Initialisation de l'acteur physique sur le bureau
    const initialPet = this.engine.getState();
    const initialSpecies = this.engine.getCurrentSpeciesForm();
    const settings = this.engine.getSaveData().settings;

    const startX =
      initialPet.position.x > 40 && initialPet.position.x < window.innerWidth - 40
        ? initialPet.position.x
        : Math.round(window.innerWidth * 0.5);

    this.petActor = new PetActor(startX, window.innerHeight - 95, {
      onClick: () => this.handlePetOrEggClick(),
      onPetRub: (x, y) => this.handlePetAction(x, y, true),
      onSpongeScrub: (delta, cx, cy) => this.handleSpongeScrub(delta, cx, cy),
      onPositionChanged: (x, y) => {
        this.engine.setPosition({ x, y });
        this.updateFloatingPanelsPosition();
        void this.persistSaveState();
      },
      onBallGrabbed: () => {
        this.ballEntity.state = 'carried';
        this.animator.setCarryingBall(true);
        this.showSpeechBubble("J'ai la balle ! 🎾 Je te la rapporte !", 2200);
      },
      onBallReturned: () => {
        this.ballEntity.reset();
        this.animator.setCarryingBall(false);
        this.engine.addCoins(10);
        this.engine.boostHappiness(15);
        this.animator.spawnParticles('heart', this.petActor.x, this.petActor.y - 15, 6);
        this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y - 20, 6);
        this.animator.setState('happy', 2000);
        this.showSpeechBubble("🎾 Bravo ! Tu m'as bien lancé la balle ! (+10 🪙)", 3500);
        this.refreshHudUI();
        void this.persistSaveState();
      },
      onCursorWiggleExcited: () => {
        this.animator.spawnParticles('heart', this.petActor.x, this.petActor.y - 20, 5);
        this.showSpeechBubble("Hihi ! Tu bouges vite ! 😄", 2000);
        this.engine.boostHappiness(2);
      },
      onPetDropped: (dropType, x, y) => this.handlePetDropped(dropType, x, y),
      onWindowPerchJump: (winTitle) => this.handleWindowPerchJump(winTitle),
      onWindowPerchLand: (winTitle) => this.handleWindowPerchLand(winTitle),
    });

    this.petActor.setScales(initialSpecies?.scale ?? 1, settings.petScale ?? 1);
    this.petActor.setWalkSpeed(initialSpecies?.walkSpeed ?? 0);
    this.petActor.setWindowJumpEnabled(settings.windowJumpEnabled ?? true);

    // 3.5 Initialisation du gestionnaire Mode Online & Amis
    this.onlineManager = new OnlineManager({
      onFriendArrival: (friend) => {
        this.showSpeechBubble(`Un ami arrive : ${friend.name} (${friend.ownerName}) ! 👋`, 4000);
        this.refreshOnlineUI();
      },
      onFriendDeparture: () => {
        this.showSpeechBubble('Au revoir mon ami ! 👋', 2500);
        this.refreshOnlineUI();
      },
      onPlayTogetherRequested: () => {
        this.triggerPlayTogetherAnimation();
      },
    });

    // 4. Initialisation des 2 mini-jeux
    this.miniGames = new MiniGamesController(this.petActor, this.animator, {
      onGameComplete: (result) => this.handleMiniGameComplete(result),
      onSpeech: (msg) => this.showSpeechBubble(msg),
      onUiStateChanged: () => this.hitTester?.refresh(),
    });

    // 5. Initialisation du HitTester pour le click-through sélectif (+90 px en mode éponge)
    this.hitTester = new HitTester({
      petActor: this.petActor,
      isPointOverMiniGameStar: (cx, cy) => this.miniGames.isPointOverStar(cx, cy),
      isSpongeModeActive: () => this.isSpongeMode,
      isPointOverFriendPet: (cx, cy) => {
        if (!this.onlineManager.hasVisitor()) return false;
        const dist = Math.hypot(cx - this.onlineManager.friendX, cy - this.onlineManager.friendY);
        return dist < 45;
      },
      isBallThrowModeActive: () => this.isBallThrowMode || this.isDraggingBall,
      isPointOverBall: (cx, cy) => {
        if (!this.ballEntity.active) return false;
        return this.ballEntity.isPointInside(cx, cy, 22);
      },
    });

    // 6. Construction des listes dynamiques et écouteurs d'événements UI / IPC
    this.renderFoodsDrawerList();
    this.populateDisplaysSelect();
    this.syncSettingsControls();
    this.initDraggableShopModal();
    this.bindPointerAndDomEvents();
    this.bindSandboxEvents();
    this.bindIpcListeners();

    this.refreshHudUI();
    this.refreshPomodoroUI();
    this.setDevEdition(Boolean(payload.isDevEdition));
    this.hitTester.evaluateAt(-1000, -1000);

    // Message d'accueil selon le stade (œuf à éclore ou familier éclos)
    if (initialPet.stage === 'egg') {
      const clicks = initialPet.careStats.eggClicks ?? 0;
      const req = this.engine.getConfig().eggClicksRequired || 5;
      this.showSpeechBubble(
        `🥚 Cliquez sur l'œuf pour le faire éclore ! (${clicks}/${req})`,
        4500
      );
    } else if (payload.offlineReport && payload.offlineReport.elapsedMs > 120_000) {
      const minutesAway = Math.round(payload.offlineReport.elapsedMs / 60000);
      this.showSpeechBubble(`Content de te revoir après ${minutesAway} min ! 💖`, 4000);
    } else {
      this.showSpeechBubble(`${initialPet.name} est prêt ! ✨`, 3000);
    }

    // 7. Démarrage de la boucle de rendu à FPS adaptatif
    const now = performance.now();
    this.lastFrameTimestamp = now;
    this.lastLogicTickTimestamp = now;
    this.lastAutoSaveTimestamp = now;
    requestAnimationFrame((ts) => this.animationLoop(ts));
  }

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * Boucle principale `requestAnimationFrame` avec limitation adaptative de FPS :
   * - Mode actif (~30 FPS) : marche, interaction souris, éponge, besoin actif, mini-jeu, menu ouvert.
   * - Mode repos (5 FPS) : familier immobile (`idle` ou `sleep`) et aucun panneau/mini-jeu ouvert.
   */
  private animationLoop(timestamp: number): void {
    requestAnimationFrame((ts) => this.animationLoop(ts));

    // Tick logique toutes les 1000 ms (indépendant du FPS graphique)
    if (timestamp - this.lastLogicTickTimestamp >= 1000) {
      const elapsedSeconds = Math.min(
        10,
        Math.max(1, Math.round((timestamp - this.lastLogicTickTimestamp) / 1000))
      );
      this.lastLogicTickTimestamp = timestamp;
      this.runOneSecondLogicTick(elapsedSeconds);
    }

    // Détermination du mode FPS adaptatif (actif vs 5 FPS repos)
    this.updateAdaptiveFpsTarget();

    const elapsedFrameMs = timestamp - this.lastFrameTimestamp;

    // En mode repos éco (5 FPS), on espace les frames pour préserver CPU & batterie.
    // En mode actif (vol balistique, lancer souris, escalade fenêtre, mini-jeux), aucun throttle
    // artificiel pour assurer un 60 FPS parfait à chaque cycle requestAnimationFrame sans perte de frames.
    if (!this.isActiveFpsMode) {
      const frameIntervalMs = 1000 / this.currentTargetFps;
      if (elapsedFrameMs < frameIntervalMs - 1) {
        return;
      }
    }

    const dtSeconds = Math.min(0.25, Math.max(0.001, elapsedFrameMs > 0 ? elapsedFrameMs / 1000 : 0.016));
    this.lastFrameTimestamp = timestamp;

    this.updateFrame(dtSeconds);
    this.renderFrame();
  }

  /**
   * Calcule si le moteur doit tourner à `fpsLimitActive` (~30 FPS) ou `fpsLimitIdle` (5 FPS).
   * Note performance : utilise une cadence fluide (30 FPS) quand le pet affiche une animation
   * de besoin (`hungry`, `need_cuddle`, `need_play`), tremble ou est en `isSpongeMode`.
   */
  private updateAdaptiveFpsTarget(): void {
    const pet = this.engine.getState();
    const settings = this.engine.getSaveData().settings;

    const isAnyMenuOpen =
      !this.hudEl?.classList.contains('hidden') ||
      !this.statsModalEl?.classList.contains('hidden') ||
      !this.shopModalEl?.classList.contains('hidden') ||
      !this.onlineModalEl?.classList.contains('hidden') ||
      !this.pomodoroModalEl?.classList.contains('hidden') ||
      !this.ballModeBannerEl?.classList.contains('hidden');

    const isSpeechVisible = !this.speechBubbleEl?.classList.contains('hidden');
    const animState = this.animator.getState();
    const isNeedAnimationActive =
      !pet.isSleeping &&
      pet.stage !== 'egg' &&
      (animState === 'hungry' ||
        animState === 'need_cuddle' ||
        animState === 'need_play' ||
        animState === 'cleaning' ||
        pet.needs.cleanliness < 60 ||
        pet.poopCount > 0);

    const isPhysicsActive =
      this.petActor.isAirborne ||
      this.petActor.isDragging ||
      this.petActor.getIsPerchingOnWindow() ||
      this.petActor.getIsJumpingToWindow() ||
      this.petActor.y < this.petActor.getGroundY() - 2 ||
      Math.abs(this.petActor.vx) > 5 ||
      Math.abs(this.petActor.vy) > 5 ||
      Math.abs(this.petActor.getDragStretchX() - 1.0) > 0.015 ||
      Math.abs(this.petActor.getDragStretchY() - 1.0) > 0.015 ||
      Math.abs(this.petActor.getDragAngle()) > 0.015;

    const isActive =
      isPhysicsActive ||
      this.isSpongeMode ||
      this.isBallThrowMode ||
      this.isDraggingBall ||
      this.ballEntity.active ||
      this.isMusicMode ||
      (this.engine.getPomodoroState()?.isActive ?? false) ||
      this.petActor.isMoving ||
      this.petActor.isHovering ||
      this.miniGames.isPlaying() ||
      this.animator.isInTemporaryAnimation() ||
      this.animator.isEggShaking() ||
      this.animator.hasActiveParticles() ||
      isNeedAnimationActive ||
      isAnyMenuOpen ||
      isSpeechVisible;

    const configuredActive = Math.min(60, Math.max(30, settings.fpsLimitActive || 60));
    const configuredIdle = Math.min(6, Math.max(4, Math.min(5, settings.fpsLimitIdle || 5)));

    const targetFps = isActive ? configuredActive : configuredIdle;
    if (this.isActiveFpsMode !== isActive || this.currentTargetFps !== targetFps) {
      this.isActiveFpsMode = isActive;
      this.currentTargetFps = targetFps;
      this.updateFpsBadgeUI();
    } else if (pet.isSleeping && !isActive) {
      this.currentTargetFps = configuredIdle;
    }
  }

  /**
   * Tick logique exécuté chaque seconde :
   * décrémente les besoins, vérifie l'évolution, met à jour l'activité PC et sauvegarde périodiquement.
   */
  private runOneSecondLogicTick(deltaSeconds: number): void {
    const nowMs = Date.now();

    // Si aucun hook IPC global n'envoie de lots, comptabilise les secondes actives suite aux interactions locales
    if (!this.hasMainPcActivityHook && nowMs - this.lastOverlayInputTimestamp < 5000) {
      this.engine.recordPcActivity(
        { mouseClicks: 0, keyPresses: 0, activeSeconds: deltaSeconds },
        nowMs
      );
    }

    const prevFormId = this.engine.getState().formId;
    const settings = this.engine.getSaveData().settings;
    const tickResult = this.engine.tick(deltaSeconds, nowMs);
    const evoCheck = this.engine.checkEvolution();

    // Tick du chronomètre Pomodoro / Focus
    const pomoTick = this.engine.tickPomodoro(deltaSeconds);
    if (pomoTick.phaseCompleted === 'work') {
      this.animator.setActiveDialogueProp('stretching', 4000);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y - 20, 10);
      this.showSpeechBubble("Session Focus terminée ! Bravo, on fait une petite pause méritée ! ☕ (+50 🪙)", 5000);
      if (settings.notificationsEnabled) {
        void window.petAPI?.notifyCriticalNeed(
          'Session Focus terminée ! ⏱️🎉',
          'Bravo ! Prenez 5 minutes de pause méritée. (+50 🪙)'
        );
      }
      void this.persistSaveState();
    } else if (pomoTick.phaseCompleted === 'break') {
      this.showSpeechBubble("Pause terminée ! Prêt(e) pour une nouvelle session de concentration ? 🚀", 4500);
      if (settings.notificationsEnabled) {
        void window.petAPI?.notifyCriticalNeed(
          'Pause terminée ! ☕',
          'Prêt(e) à relancer une session de concentration ?'
        );
      }
    }
    this.refreshPomodoroUI();

    const evolved = tickResult.evolved || evoCheck.evolved;
    const newForm = tickResult.newForm ?? evoCheck.newForm;

    if (evolved && newForm && newForm.id !== prevFormId) {
      this.handleEvolutionTriggered(newForm);
    }

    // Synchronisation de la vitesse et de l'échelle avec la forme courante
    const currentSpecies = this.engine.getCurrentSpeciesForm();
    if (currentSpecies) {
      this.petActor.setScales(currentSpecies.scale, settings.petScale);
      this.petActor.setWalkSpeed(currentSpecies.walkSpeed);
    }

    // Notification discrète en cas de besoin critique (avec anti-spam de 3 minutes)
    if (tickResult.criticalNeeds.length > 0 && tickResult.pet.stage !== 'egg') {
      if (nowMs - this.lastNotificationTimestamp > 180_000) {
        this.lastNotificationTimestamp = nowMs;
        const firstCritical = tickResult.criticalNeeds[0];
        const alertInfo = NEED_ALERT_LABELS[firstCritical];
        this.showSpeechBubble(alertInfo.speech, 4000);
        if (settings.notificationsEnabled) {
          void window.petAPI?.notifyCriticalNeed(
            `${tickResult.pet.name} — ${alertInfo.title}`,
            alertInfo.speech
          );
        }
      }
    }

    this.refreshHudUI();
    if (!this.statsModalEl?.classList.contains('hidden')) {
      this.refreshStatsAndCompendiumUI();
    }
    if (this.isDevEdition && !this.sandboxModalEl?.classList.contains('hidden')) {
      this.refreshSandboxMetricsUI();
    }

    const pet = tickResult.pet;

    // Dialogues autonomes spontanés ("de temps en temps, juste comme ça")
    const isAnyMenuOpen =
      !this.hudEl?.classList.contains('hidden') ||
      !this.drawerFoodsEl?.classList.contains('hidden') ||
      !this.drawerGamesEl?.classList.contains('hidden') ||
      !this.statsModalEl?.classList.contains('hidden') ||
      !this.shopModalEl?.classList.contains('hidden') ||
      !this.onlineModalEl?.classList.contains('hidden') ||
      !this.sandboxModalEl?.classList.contains('hidden');

    const canSpeakSpontaneously =
      pet.stage !== 'egg' &&
      !pet.isSleeping &&
      !this.isSpongeMode &&
      !this.miniGames.isPlaying() &&
      !isAnyMenuOpen &&
      Boolean(this.speechBubbleEl?.classList.contains('hidden')) &&
      tickResult.criticalNeeds.length === 0 &&
      pet.needs.hunger >= 45 &&
      !pet.needsCuddle &&
      !pet.needsPlay;

    if (canSpeakSpontaneously) {
      if (nowMs - this.lastAutonomousDialogueTimestamp >= this.nextAutonomousDialogueDelayMs) {
        this.lastAutonomousDialogueTimestamp = nowMs;
        this.nextAutonomousDialogueDelayMs = 28_000 + Math.random() * 32_000;
        this.triggerSpontaneousDialogue();
      }
    } else if (isAnyMenuOpen || pet.isSleeping || this.isSpongeMode || this.miniGames.isPlaying()) {
      this.lastAutonomousDialogueTimestamp = nowMs;
    }

    // Sauvegarde automatique toutes les 30 secondes
    const nowPerf = performance.now();
    if (nowPerf - this.lastAutoSaveTimestamp >= 30_000) {
      this.lastAutoSaveTimestamp = nowPerf;
      void this.persistSaveState();
    }
  }

  private updateFrame(dtSeconds: number): void {
    const pet = this.engine.getState();
    const criticalNeeds = this.engine.getCriticalNeeds();

    const hasPriorityNeedPose =
      pet.needs.hunger < 45 || pet.needsCuddle || pet.needsPlay;

    // Si le pet a un besoin actif ou est en manque, la souris au survol ne produit aucune réaction
    const hasDemand =
      pet.stage !== 'egg' &&
      (pet.needs.hunger < 45 ||
        pet.needs.cleanliness < 60 ||
        pet.poopCount > 0 ||
        pet.needsCuddle ||
        pet.needsPlay ||
        pet.needs.energy < 30);
    this.petActor.setHasActiveDemand(hasDemand);

    const isAnyMenuOpen =
      !this.hudEl?.classList.contains('hidden') ||
      !this.statsModalEl?.classList.contains('hidden') ||
      !this.shopModalEl?.classList.contains('hidden') ||
      !this.onlineModalEl?.classList.contains('hidden') ||
      !this.pomodoroModalEl?.classList.contains('hidden') ||
      !this.drawerFoodsEl?.classList.contains('hidden') ||
      !this.drawerGamesEl?.classList.contains('hidden');

    if (isAnyMenuOpen) {
      this.petActor.stopWalking();
    }

    const pomoState = this.engine.getPomodoroState();
    const isPomodoroFocus = Boolean(pomoState && pomoState.isActive && pomoState.mode === 'work');
    this.animator.setPomodoroFocus(isPomodoroFocus);

    const canWalk =
      pet.stage !== 'egg' &&
      !pet.isSleeping &&
      !this.isSpongeMode &&
      !this.isBallThrowMode &&
      !isPomodoroFocus &&
      !isAnyMenuOpen &&
      !this.animator.isInTemporaryAnimation() &&
      this.miniGames.getActiveGame() !== 'rps_duel' &&
      (this.miniGames.getActiveGame() === 'star_catch' || !hasPriorityNeedPose);

    // Mise à jour de la balle de tennis (rebonds, frottements, roulement)
    this.ballEntity.update(dtSeconds, this.petActor.getGroundY(), window.innerWidth);
    if (
      this.ballEntity.active &&
      (this.ballEntity.state === 'flying' ||
        this.ballEntity.state === 'rolling' ||
        this.ballEntity.state === 'stopped')
    ) {
      this.petActor.updateBallTarget(this.ballEntity.x, this.ballEntity.y);
    }
    this.animator.setCarryingBall(this.petActor.getIsCarryingBall());

    this.petActor.update(dtSeconds, { canWalk });
    this.miniGames.update(dtSeconds);

    // Mise à jour du pet ami en visite sur le bureau
    this.onlineManager.update(
      dtSeconds,
      this.isPlayingTogetherWithFriend
        ? this.petActor.x + (this.petActor.flipX ? 60 : -60)
        : null
    );

    this.animator.update(dtSeconds, {
      stage: pet.stage,
      isSleeping: pet.isSleeping,
      isCritical: criticalNeeds.length > 0 || pet.poopCount >= 2,
      isMoving: this.petActor.isMoving,
      isPlayingGame: this.miniGames.isPlaying(),
      isSpongeMode: this.isSpongeMode,
      hunger: pet.needs.hunger,
      cleanliness: pet.needs.cleanliness,
      poopCount: pet.poopCount,
      needsCuddle: pet.needsCuddle,
      needsPlay: pet.needsPlay,
      petX: this.petActor.x,
      petY: this.petActor.y,
    });

    this.updateFloatingPanelsPosition();
  }

  private renderFrame(): void {
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const pet = this.engine.getState();
    this.animator.render({
      ctx: this.ctx,
      formId: pet.formId,
      x: this.petActor.x,
      y: this.petActor.y,
      groundY: this.petActor.getGroundY(),
      scale: this.petActor.getEffectiveScale(),
      flipX: this.petActor.flipX,
      poopCount: pet.poopCount,
      cleanliness: pet.needs.cleanliness,
      cleaningProgress: pet.cleaningProgress,
      eggClicks: pet.careStats.eggClicks ?? 0,
      isSpongeMode: this.isSpongeMode,
      cursorX: this.petActor.lastCursorX,
      cursorY: this.petActor.lastCursorY,
      equippedCosmetics: pet.equippedCosmetics,
      dragScaleX: this.petActor.getDragStretchX(),
      dragScaleY: this.petActor.getDragStretchY(),
      dragAngle: this.petActor.getDragAngle(),
    });

    // Rendu du pet ami en visite sur le bureau
    const visitor = this.onlineManager.getVisitor();
    if (visitor) {
      this.animator.render({
        ctx: this.ctx,
        formId: visitor.formId,
        x: this.onlineManager.friendX,
        y: this.onlineManager.friendY,
        groundY: this.petActor.getGroundY(),
        scale: 1.0,
        flipX: this.onlineManager.friendFlipX,
        poopCount: 0,
        cleanliness: 100,
        cleaningProgress: 0,
        eggClicks: 5,
        equippedCosmetics: visitor.equippedCosmetics,
      });

      // Petite étiquette avec le nom au-dessus du pet ami
      this.ctx.save();
      this.ctx.font = 'bold 11.5px sans-serif';
      this.ctx.textAlign = 'center';
      const tagText = `${visitor.name} (${visitor.ownerName})`;
      const textWidth = this.ctx.measureText(tagText).width;
      this.ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      this.ctx.beginPath();
      this.ctx.roundRect
        ? this.ctx.roundRect(
            this.onlineManager.friendX - textWidth / 2 - 8,
            this.onlineManager.friendY - 54,
            textWidth + 16,
            20,
            6
          )
        : this.ctx.rect(
            this.onlineManager.friendX - textWidth / 2 - 8,
            this.onlineManager.friendY - 54,
            textWidth + 16,
            20
          );
      this.ctx.fill();
      this.ctx.fillStyle = '#86efac';
      this.ctx.fillText(tagText, this.onlineManager.friendX, this.onlineManager.friendY - 40);
      this.ctx.restore();
    }

    // Rendu de la balle de tennis interactive
    this.ballEntity.render(this.ctx);

    this.miniGames.render(this.ctx);
  }

  private bindPointerAndDomEvents(): void {
    let isTrackingWindowDrag = false;
    let dragLastMouseX = 0;
    let dragLastMouseY = 0;

    // Événements globaux de souris sur la fenêtre pour le HitTester et le familier
    window.addEventListener('mousemove', (e) => {
      this.hitTester.evaluateAt(e.clientX, e.clientY);
      this.petActor.handlePointerMove(e.clientX, e.clientY);

      // Déplacement de la balle à la souris (simulation de vrai lancer physique)
      if (this.isDraggingBall) {
        this.ballEntity.x = e.clientX;
        this.ballEntity.y = e.clientY;
        const now = performance.now();
        this.ballDragHistory.push({ x: e.clientX, y: e.clientY, time: now });
        if (this.ballDragHistory.length > 25) {
          this.ballDragHistory.shift();
        }
        this.renderFrame();
      }

      // Suivi direct à 0 ms de latence lorsque l'utilisateur déplace la fenêtre active à la souris
      if (this.petActor.getIsPerchingOnWindow()) {
        const win = this.petActor.getActiveWindow();
        if (win && e.buttons === 1) {
          if (!isTrackingWindowDrag) {
            const inTitleBar =
              e.clientX >= win.x - 20 &&
              e.clientX <= win.x + win.width + 20 &&
              e.clientY >= win.y - 40 &&
              e.clientY <= win.y + 60;
            if (inTitleBar) {
              isTrackingWindowDrag = true;
              dragLastMouseX = e.clientX;
              dragLastMouseY = e.clientY;
            }
          }

          if (isTrackingWindowDrag) {
            const dx = e.clientX - dragLastMouseX;
            const dy = e.clientY - dragLastMouseY;
            dragLastMouseX = e.clientX;
            dragLastMouseY = e.clientY;

            if (dx !== 0 || dy !== 0) {
              this.petActor.shiftPerchWindow(dx, dy);
              this.renderFrame();
              this.updateFloatingPanelsPosition();
            }
          }
        } else {
          isTrackingWindowDrag = false;
        }
      } else {
        isTrackingWindowDrag = false;
      }
    });

    window.addEventListener('mousedown', (e) => {
      this.recordLocalOverlayInput(1, 0);
      if (this.petActor.getIsPerchingOnWindow()) {
        const win = this.petActor.getActiveWindow();
        if (win) {
          const inTitleBar =
            e.clientX >= win.x - 20 &&
            e.clientX <= win.x + win.width + 20 &&
            e.clientY >= win.y - 40 &&
            e.clientY <= win.y + 60;
          if (inTitleBar) {
            isTrackingWindowDrag = true;
            dragLastMouseX = e.clientX;
            dragLastMouseY = e.clientY;
          }
        }
      }
    });

    window.addEventListener('mouseup', () => {
      isTrackingWindowDrag = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      // 1) Si on clique sur la balle (en mode lancer ou au sol), saisie pour un vrai lancer physique au geste
      if (
        e.button === 0 &&
        this.ballEntity.active &&
        (this.isBallThrowMode || this.ballEntity.state === 'stopped' || this.ballEntity.state === 'ready') &&
        this.ballEntity.isPointInside(e.clientX, e.clientY, 26)
      ) {
        this.isDraggingBall = true;
        this.ballEntity.state = 'dragging';
        this.ballEntity.x = e.clientX;
        this.ballEntity.y = e.clientY;
        this.ballDragHistory = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
        this.renderFrame();
        return;
      }

      // Si le mode Lancer de balle est actif et qu'on clique à distance, lancement balistique vers la cible
      if (this.isBallThrowMode) {
        const startX = this.ballEntity.active ? this.ballEntity.x : this.petActor.x;
        const startY = this.ballEntity.active ? this.ballEntity.y : this.petActor.y - 25;
        this.ballEntity.launch(startX, startY, e.clientX, e.clientY);
        this.petActor.startFetchingBall(e.clientX, e.clientY);
        this.isBallThrowMode = false;
        this.ballModeBannerEl?.classList.add('hidden');
        this.hitTester.refresh();
        this.showSpeechBubble("Attrape ! 🎾 Va chercher !", 2400);
        return;
      }

      if (this.miniGames.handleCanvasMouseDown(e.clientX, e.clientY)) {
        return;
      }
      this.petActor.handlePointerDown(e.clientX, e.clientY, e.button);
    });

    // Clic droit sur le familier ou l'œuf -> ouvre/ferme le HUD à tout moment
    this.canvas.addEventListener('contextmenu', (e) => {
      if (this.petActor.containsPoint(e.clientX, e.clientY, 24)) {
        e.preventDefault();
        this.toggleHudPanel();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingBall) {
        this.isDraggingBall = false;
        const now = performance.now();
        const recent = this.ballDragHistory.filter((p) => now - p.time <= 85);
        const points = recent.length >= 2 ? recent : this.ballDragHistory;
        let vx = 0;
        let vy = 0;
        if (points.length >= 2) {
          const first = points[0];
          const last = points[points.length - 1];
          const dt = Math.max(0.012, (last.time - first.time) / 1000);
          if (now - last.time < 180) {
            vx = (last.x - first.x) / dt;
            vy = (last.y - first.y) / dt;
          }
        }
        this.ballDragHistory = [];

        // Impulsion de projection (fling power)
        const FLING_BOOST = 1.35;
        vx *= FLING_BOOST;
        vy *= FLING_BOOST;

        const speed = Math.hypot(vx, vy);
        if (speed < 60) {
          this.ballEntity.throw(vx * 0.4, 45);
        } else {
          this.ballEntity.throw(vx, vy);
        }

        this.isBallThrowMode = false;
        this.ballModeBannerEl?.classList.add('hidden');
        this.petActor.startFetchingBall(this.ballEntity.x, this.ballEntity.y);
        this.showSpeechBubble("Attrape ! 🎾 Va chercher !", 2400);
        this.hitTester.refresh();
      }
      this.petActor.handlePointerUp();
    });

    window.addEventListener('keydown', (e) => {
      this.recordLocalOverlayInput(0, 1);

      if (e.key === 'Escape') {
        if (this.isSpongeMode) {
          this.stopSpongeMode();
        }
        if (this.isBallThrowMode) {
          this.cancelBallThrowMode();
        }
        this.closeAllPanels();
      } else if (e.key === 'F2') {
        if (this.isDevEdition) {
          this.toggleSandboxModal();
        }
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        this.setDevEdition(!this.isDevEdition);
        this.showSpeechBubble(
          this.isDevEdition ? '🧪 Mode Développeur / Sandbox ACTIVÉ' : 'Mode Développeur DÉSACTIVÉ',
          2500
        );
      }
    });

    // Bouton d'annulation du mode Éponge
    document.getElementById('btn-cancel-sponge')?.addEventListener('click', () => {
      this.stopSpongeMode();
    });

    // Boutons d'en-tête et de fermeture du HUD
    document.getElementById('btn-close-hud')?.addEventListener('click', () => {
      this.hideHudPanel();
    });
    document.getElementById('btn-close-foods')?.addEventListener('click', () => {
      this.drawerFoodsEl?.classList.add('hidden');
      this.hitTester.refresh();
    });
    document.getElementById('btn-close-games')?.addEventListener('click', () => {
      this.drawerGamesEl?.classList.add('hidden');
      this.hitTester.refresh();
    });

    // Actions principales du HUD
    document.getElementById('btn-action-feed')?.addEventListener('click', () => {
      this.drawerGamesEl?.classList.add('hidden');
      this.drawerFoodsEl?.classList.toggle('hidden');
      this.updateFloatingPanelsPosition();
      this.hitTester.refresh();
    });

    document.getElementById('btn-action-play')?.addEventListener('click', () => {
      this.drawerFoodsEl?.classList.add('hidden');
      this.drawerGamesEl?.classList.toggle('hidden');
      this.updateFloatingPanelsPosition();
      this.hitTester.refresh();
    });

    document.getElementById('btn-action-pet')?.addEventListener('click', () => {
      this.handlePetAction(this.petActor.x, this.petActor.y, false);
    });

    document.getElementById('btn-action-sleep')?.addEventListener('click', () => {
      this.handleToggleSleep();
    });

    document.getElementById('btn-action-clean')?.addEventListener('click', () => {
      this.handleCleanAction();
    });

    document.getElementById('btn-action-pomodoro')?.addEventListener('click', () => {
      this.openPomodoroModal();
    });

    document.getElementById('btn-action-music')?.addEventListener('click', () => {
      this.toggleMusicMode();
    });

    document.getElementById('btn-action-shop')?.addEventListener('click', () => {
      this.openShopModal();
    });

    document.getElementById('btn-close-shop')?.addEventListener('click', () => {
      this.closeShopModal();
    });

    document.getElementById('tab-btn-shop-market')?.addEventListener('click', () => {
      this.switchShopTab('market');
    });

    document.getElementById('tab-btn-shop-inventory')?.addEventListener('click', () => {
      this.switchShopTab('inventory');
    });

    document.getElementById('btn-unequip-hat')?.addEventListener('click', () => {
      this.engine.equipCosmetic('hat', null);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 4);
      this.refreshShopUI();
      void this.persistSaveState();
    });

    document.getElementById('btn-unequip-accessory')?.addEventListener('click', () => {
      this.engine.equipCosmetic('accessory', null);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 4);
      this.refreshShopUI();
      void this.persistSaveState();
    });

    document.getElementById('btn-unequip-aura')?.addEventListener('click', () => {
      this.engine.equipCosmetic('aura', null);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 4);
      this.refreshShopUI();
      void this.persistSaveState();
    });

    const shopFilterBtns = document.querySelectorAll<HTMLButtonElement>('.shop-filter-btn');
    shopFilterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        shopFilterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentShopCategory = btn.dataset.category || 'all';
        this.refreshShopUI();
      });
    });

    document.getElementById('btn-action-online')?.addEventListener('click', () => {
      this.openOnlineModal();
    });

    document.getElementById('btn-close-online')?.addEventListener('click', () => {
      this.closeOnlineModal();
    });

    document.getElementById('btn-copy-my-passport')?.addEventListener('click', async () => {
      const code = this.engine.exportPassport('Moi');
      try {
        await navigator.clipboard.writeText(code);
        this.showSpeechBubble('📋 Code Passeport copié dans le presse-papier !', 3000);
      } catch {
        this.showSpeechBubble(`📋 Votre code : ${code.slice(0, 24)}...`, 4000);
      }
    });

    document.getElementById('btn-import-friend-passport')?.addEventListener('click', () => {
      const input = document.getElementById('input-friend-passport') as HTMLInputElement | null;
      const code = input?.value.trim();
      if (!code) {
        this.showSpeechBubble('Veuillez entrer un code passeport TAMA-...', 2800);
        return;
      }
      const imported = this.engine.importPassport(code);
      if (imported) {
        this.onlineManager.setVisitor(imported);
        if (input) input.value = '';
        this.closeOnlineModal();
      } else {
        this.showSpeechBubble('❌ Code passeport invalide !', 3000);
      }
    });

    document.getElementById('btn-join-room')?.addEventListener('click', () => {
      const input = document.getElementById('input-room-code') as HTMLInputElement | null;
      const roomCode = input?.value.trim() || 'PETS-1';
      const myProfile: FriendPetProfile = {
        id: `local-${Date.now()}`,
        name: this.engine.getState().name,
        ownerName: 'Moi',
        formId: this.engine.getState().formId,
        stage: this.engine.getState().stage,
        lineage: this.engine.getState().lineage,
        equippedCosmetics: this.engine.getState().equippedCosmetics,
        happiness: this.engine.getState().needs.happiness,
        x: this.petActor.x,
        direction: this.petActor.flipX ? -1 : 1,
        animationState: 'idle',
      };
      this.onlineManager.joinRoom(roomCode, myProfile);
      this.showSpeechBubble(`⚡ Connecté au salon [${roomCode}] !`, 3500);
    });

    document.getElementById('btn-invite-simulated-friend')?.addEventListener('click', () => {
      const sim = this.onlineManager.spawnSimulatedFriend();
      this.showSpeechBubble(`🤖 Ami invité : ${sim.name} (${sim.ownerName}) est arrivé ! 🎉`, 4000);
      this.closeOnlineModal();
    });

    document.getElementById('btn-online-play-together')?.addEventListener('click', () => {
      this.triggerPlayTogetherAnimation();
    });

    document.getElementById('btn-online-say-goodbye')?.addEventListener('click', () => {
      this.onlineManager.removeVisitor();
      this.refreshOnlineUI();
    });

    document.getElementById('btn-action-stats')?.addEventListener('click', () => {
      this.openStatsModal('tab-stats');
    });

    document.getElementById('btn-action-sandbox')?.addEventListener('click', () => {
      this.openSandboxModal();
    });

    // Lancement des 2 mini-jeux
    document.getElementById('btn-start-star-catch')?.addEventListener('click', () => {
      if (!this.canStartMiniGame()) {
        return;
      }
      this.hideHudPanel();
      this.miniGames.startStarCatch();
    });

    document.getElementById('btn-start-rps-duel')?.addEventListener('click', () => {
      if (!this.canStartMiniGame()) {
        return;
      }
      this.hideHudPanel();
      this.miniGames.startRpsDuel(this.engine.getState().name);
    });

    // Interaction Mini-Jeu 🎾 Lancer de balle au bureau
    document.getElementById('btn-start-ball-fetch')?.addEventListener('click', () => {
      this.startBallThrowMode();
    });

    document.getElementById('btn-cancel-ball')?.addEventListener('click', () => {
      this.cancelBallThrowMode();
    });

    // Minuteur Focus / Pomodoro Modal & Widget Flottant
    document.getElementById('btn-close-pomodoro')?.addEventListener('click', () => {
      this.closePomodoroModal();
    });

    this.pomodoroPillEl?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.pomo-mini-btn')) {
        this.openPomodoroModal();
      }
    });

    this.btnPomoToggleEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePomodoroSession();
    });

    this.btnPomoStopEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.stopPomodoroSession();
    });

    this.btnPomodoroStartEl?.addEventListener('click', () => {
      this.startPomodoroSession(this.selectedPomodoroWorkMinutes, this.selectedPomodoroBreakMinutes);
    });

    this.btnPomodoroPauseEl?.addEventListener('click', () => {
      this.togglePomodoroSession();
    });

    this.btnPomodoroStopEl?.addEventListener('click', () => {
      this.stopPomodoroSession();
    });

    const pomodoroPresets = document.querySelectorAll<HTMLButtonElement>('.pomodoro-preset-btn');
    pomodoroPresets.forEach((btn) => {
      btn.addEventListener('click', () => {
        pomodoroPresets.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const work = parseFloat(btn.dataset.work || '25');
        const brk = parseFloat(btn.dataset.break || '5');
        this.selectedPomodoroWorkMinutes = work;
        this.selectedPomodoroBreakMinutes = brk;

        const pState = this.engine.getPomodoroState();
        if (!pState || !pState.isActive) {
          const totalSec = Math.round(work * 60);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
          if (this.pomodoroDisplayBigEl) {
            this.pomodoroDisplayBigEl.textContent = timeStr;
          }
        }
      });
    });

    // Fenêtre Statistiques, Compendium & Réglages
    document.getElementById('btn-close-stats')?.addEventListener('click', () => {
      this.statsModalEl?.classList.add('hidden');
      this.hitTester.refresh();
    });

    const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        if (targetTab) {
          this.switchModalTab(targetTab);
        }
      });
    });

    // Contrôles des réglages
    const autoStartInput = document.getElementById('toggle-autostart') as HTMLInputElement | null;
    autoStartInput?.addEventListener('change', () => {
      this.updateUserSetting({ autoStartEnabled: autoStartInput.checked });
    });

    const notifInput = document.getElementById('toggle-notifications') as HTMLInputElement | null;
    notifInput?.addEventListener('change', () => {
      this.updateUserSetting({ notificationsEnabled: notifInput.checked });
    });

    const windowJumpInput = document.getElementById('toggle-window-jump') as HTMLInputElement | null;
    windowJumpInput?.addEventListener('change', () => {
      const enabled = windowJumpInput.checked;
      this.updateUserSetting({ windowJumpEnabled: enabled });
      this.petActor.setWindowJumpEnabled(enabled);
      if (!enabled) {
        this.showSpeechBubble("D'accord, je reste sur le bureau ! 🐾", 3000);
      }
    });

    const scaleButtons = document.querySelectorAll<HTMLButtonElement>('#scale-selector .seg-btn');
    scaleButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const scaleVal = Number(btn.dataset.scale);
        if (Number.isFinite(scaleVal) && scaleVal > 0) {
          this.updateUserSetting({ petScale: scaleVal });
          this.petActor.setScales(
            this.engine.getCurrentSpeciesForm()?.scale ?? 1,
            scaleVal
          );
          this.syncSettingsControls();
        }
      });
    });

    const displaySelect = document.getElementById('select-display') as HTMLSelectElement | null;
    displaySelect?.addEventListener('change', async () => {
      const val = displaySelect.value;
      const displayId = val ? Number(val) : null;
      this.updateUserSetting({ preferredDisplayId: displayId });
      if (displayId !== null && window.petAPI) {
        await window.petAPI.moveToDisplay(displayId);
        this.petActor.centerOnScreen();
      }
    });

    document.getElementById('btn-save-name')?.addEventListener('click', () => {
      const inputEl = document.getElementById('input-pet-name') as HTMLInputElement | null;
      const newName = inputEl?.value.trim();
      if (newName && newName.length > 0) {
        const save = this.engine.getSaveData();
        save.pet.name = newName.slice(0, 18);
        this.engine = new PetEngine({
          saveData: save,
          config: this.engine.getConfig(),
          foods: this.engine.getFoods(),
          species: this.engine.getSpecies(),
        });
        this.refreshHudUI();
        this.refreshStatsAndCompendiumUI();
        this.showSpeechBubble(`Je m'appelle désormais ${save.pet.name} ! ✨`);
        void this.persistSaveState();
      }
    });

    document.getElementById('btn-reset-pet')?.addEventListener('click', () => {
      void this.handleResetPet();
    });
  }

  private bindIpcListeners(): void {
    window.petAPI?.onTrayAction((action: TrayActionType) => {
      this.handleTrayAction(action);
    });

    window.petAPI?.onDisplayChanged((displays: DisplayBoundsInfo[]) => {
      this.displays = displays;
      this.populateDisplaysSelect();
      this.petActor.centerOnScreen();
    });

    window.petAPI?.onActiveWindowChanged?.((windowInfo: ActiveWindowInfo | null) => {
      this.petActor.setActiveWindow(windowInfo);
      if (this.petActor.getIsPerchingOnWindow()) {
        this.renderFrame();
        this.updateFloatingPanelsPosition();
      }
    });

    window.petAPI?.onMusicStateChanged?.((isPlaying: boolean) => {
      this.toggleMusicMode(isPlaying);
    });

    window.petAPI?.onPcActivityBatch?.((batch) => {
      this.hasMainPcActivityHook = true;
      if (batch.activeWindow !== undefined) {
        this.petActor.setActiveWindow(batch.activeWindow);
        if (this.petActor.getIsPerchingOnWindow()) {
          this.renderFrame();
          this.updateFloatingPanelsPosition();
        }
      }
      if (batch.isMusicPlaying !== undefined && batch.isMusicPlaying !== this.isMusicMode) {
        this.toggleMusicMode(batch.isMusicPlaying);
      }

      // Commentaires contextuels réactifs en temps réel selon l'activité mesurée
      const now = Date.now();
      this.evaluateActivityDialogues(batch.mouseClicks, batch.keyPresses, now);

      const res = this.engine.recordPcActivity(batch, Date.now());
      if (res.evolved && res.newForm) {
        this.handleEvolutionTriggered(res.newForm);
      }
      this.refreshHudUI();
      if (!this.statsModalEl?.classList.contains('hidden')) {
        this.refreshStatsAndCompendiumUI();
      }
      if (this.isDevEdition && !this.sandboxModalEl?.classList.contains('hidden')) {
        this.refreshSandboxMetricsUI();
      }
    });
  }

  private evaluateActivityDialogues(mouseClicks: number, keyPresses: number, now: number): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg' || pet.isSleeping) {
      return;
    }

    if (keyPresses > 0) {
      this.recentKeyPressesWindow.push({ count: keyPresses, timestamp: now });
    }
    if (mouseClicks > 0) {
      this.recentMouseClicksWindow.push({ count: mouseClicks, timestamp: now });
    }

    // Conservation d'une fenêtre glissante de 8 secondes
    this.recentKeyPressesWindow = this.recentKeyPressesWindow.filter((i) => now - i.timestamp <= 8000);
    this.recentMouseClicksWindow = this.recentMouseClicksWindow.filter((i) => now - i.timestamp <= 8000);

    const totalKeys = this.recentKeyPressesWindow.reduce((acc, i) => acc + i.count, 0);
    const totalClicks = this.recentMouseClicksWindow.reduce((acc, i) => acc + i.count, 0);

    // Déclencheur Clavier : au moins 8 frappes en 8 secondes, cooldown de 35s
    if (totalKeys >= 8 && now - this.lastKeyDialogueTimestamp > 35_000) {
      this.lastKeyDialogueTimestamp = now;
      this.recentKeyPressesWindow = [];
      this.animator.spawnDialogueProp('keyboard', 3200);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y - 15, 6);
      const keyboardDialogues = [
        "Wouah, tu tapes super vite sur ton clavier ! ⌨️✨",
        "Tac tac tac ! Tu écris à toute vitesse ! ⌨️💨",
        "Quelle cadence sur le clavier, impressionnant ! ⌨️🔥",
      ];
      this.showSpeechBubble(keyboardDialogues[Math.floor(Math.random() * keyboardDialogues.length)], 3600);
      return;
    }

    // Déclencheur Souris : au moins 6 clics en 8 secondes, cooldown de 35s
    if (totalClicks >= 6 && now - this.lastClickDialogueTimestamp > 35_000) {
      this.lastClickDialogueTimestamp = now;
      this.recentMouseClicksWindow = [];
      this.animator.spawnDialogueProp('dance', 3000);
      this.animator.spawnParticles('star', this.petActor.x, this.petActor.y - 15, 6);
      const mouseDialogues = [
        "Clic clic clic ! Tu es hyper rapide avec ta souris ! 🖱️💨",
        "Wouah, quelle rafale de clics ! C'est ultra vif ! 🖱️⚡",
        "Clic clic ! Tes réflexes à la souris sont géniaux ! 🖱️✨",
      ];
      this.showSpeechBubble(mouseDialogues[Math.floor(Math.random() * mouseDialogues.length)], 3600);
    }
  }

  private recordLocalOverlayInput(mouseClicks: number, keyPresses: number): void {
    const now = Date.now();
    this.lastOverlayInputTimestamp = now;
    this.evaluateActivityDialogues(mouseClicks, keyPresses, now);
    if (this.hasMainPcActivityHook) {
      return;
    }
    const res = this.engine.recordPcActivity(
      { mouseClicks, keyPresses, activeSeconds: 0 },
      now
    );
    if (res.evolved && res.newForm) {
      this.handleEvolutionTriggered(res.newForm);
    }
    this.refreshHudUI();
  }

  private handleTrayAction(action: TrayActionType): void {
    switch (action) {
      case 'open-hud':
        this.showHudPanel();
        break;
      case 'feed':
        this.showHudPanel();
        this.drawerGamesEl?.classList.add('hidden');
        this.drawerFoodsEl?.classList.remove('hidden');
        this.updateFloatingPanelsPosition();
        break;
      case 'play':
        this.showHudPanel();
        this.drawerFoodsEl?.classList.add('hidden');
        this.drawerGamesEl?.classList.remove('hidden');
        this.updateFloatingPanelsPosition();
        break;
      case 'play-fetch':
        this.startBallThrowMode();
        break;
      case 'toggle-pomodoro':
        this.togglePomodoroSession();
        break;
      case 'start-pomodoro':
        this.startPomodoroSession(25, 5);
        break;
      case 'stop-pomodoro':
        this.stopPomodoroSession();
        break;
      case 'jump-active-window':
        this.petActor.forcePerchOnActiveWindow();
        break;
      case 'toggle-sleep':
        this.handleToggleSleep();
        break;
      case 'clean':
        this.handleCleanAction();
        break;
      case 'open-shop':
        this.openShopModal();
        break;
      case 'open-online':
        this.openOnlineModal();
        break;
      case 'open-compendium':
        this.openStatsModal('tab-compendium');
        break;
      case 'open-sandbox':
        this.setDevEdition(true);
        this.openSandboxModal();
        break;
      case 'center-pet':
        this.petActor.centerOnScreen();
        this.showSpeechBubble('Me revoilà au centre du bureau ! 👋');
        break;
      case 'reset-pet':
        void this.handleResetPet();
        break;
    }
    this.hitTester.refresh();
  }

  /**
   * Gère le clic sur le familier :
   * - Si c'est un œuf (`stage === 'egg'`), déclenche `engine.clickEgg()`, fait trembler l'œuf,
   *   projette des éclats/étoiles et, au 5ème clic, déclenche l'éclosion festive !
   * - Sinon, ouvre ou ferme la bulle HUD.
   */
  private handlePetOrEggClick(): void {
    const currentPet = this.engine.getState();

    if (currentPet.stage === 'egg' || currentPet.formId === 'egg') {
      const result = this.engine.clickEgg(Date.now());
      this.animator.triggerEggShake(350);
      this.animator.spawnParticles('egg_shard', this.petActor.x, this.petActor.y, 6);
      this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 4);

      if (!result.hatched) {
        this.showSpeechBubble(
          `Craaac ! (${result.eggClicks}/${result.clicksRequired} clics pour éclore) 🥚`,
          3000
        );
      } else if (result.hatchedForm) {
        this.syncActorWithCurrentForm();
        this.animator.setState('evolve', 2800);
        this.animator.spawnParticles('confetti', this.petActor.x, this.petActor.y, 16);
        this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 12);
        this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 10);

        const lineageLabel =
          LINEAGE_LABELS[result.pet.lineage] ?? result.pet.lineage;
        this.showSpeechBubble(
          `🎉 Éclosion ! Voici ${result.hatchedForm.name} (Lignée ${lineageLabel}) !`,
          5200
        );
        this.showHudPanel();
      }

      this.refreshAllPanelsUI();
      void this.persistSaveState();
      return;
    }

    this.toggleHudPanel();
  }

  private canStartMiniGame(): boolean {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') {
      this.showSpeechBubble("L'œuf doit d'abord éclore avant de jouer ! 🥚");
      return false;
    }
    if (pet.isSleeping) {
      this.showSpeechBubble('Chut... Réveille ton familier avant de jouer ! 💤');
      return false;
    }
    if (pet.needs.energy < 10) {
      this.showSpeechBubble('Trop fatigué pour jouer... Un petit dodo ou une baie ? ⚡');
      return false;
    }
    return true;
  }

  private handleFeedFood(food: FoodItem): void {
    const result = this.engine.feed(food.id, Date.now());
    if (!result.accepted) {
      if (result.reason === 'no_stock') {
        this.showSpeechBubble(`Plus de ${food.name} ! Achète-en à la Boutique 🛍️`, 3200);
      } else if (result.reason === 'egg_cannot_eat' || result.reason === 'stage_egg') {
        this.showSpeechBubble("Un œuf n'a pas encore de bouche ! Cliquez dessus pour l'éclore 🥚");
      } else if (result.reason === 'sleeping' || result.reason === 'pet_sleeping') {
        this.showSpeechBubble('Il dort profondément... Réveille-le pour manger 💤');
      } else if (result.reason === 'full' || result.reason === 'already_full') {
        this.showSpeechBubble('Je suis déjà complètement rassasié ! 😋');
      }
      return;
    }

    this.animator.setState('eat', 1800);
    this.animator.spawnParticles('crumb', this.petActor.x, this.petActor.y, 4);
    this.animator.spawnParticles('heart', this.petActor.x, this.petActor.y, 3);
    this.showSpeechBubble(`Miam ! ${food.name} ${food.icon}`);

    if (result.evolved && result.newForm) {
      this.handleEvolutionTriggered(result.newForm);
    }

    this.renderFoodsDrawerList();
    this.refreshAllPanelsUI();
    void this.persistSaveState();
  }

  private handlePetAction(x: number, y: number, fromCursorRub: boolean): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') {
      if (!fromCursorRub) {
        this.handlePetOrEggClick();
      }
      return;
    }

    if (pet.isSleeping) {
      if (!fromCursorRub) {
        this.showSpeechBubble('Il sourit dans son sommeil... Zzz 💤');
      }
      return;
    }

    const result = this.engine.pet(Date.now());
    this.animator.setState('happy', 1400);
    this.animator.spawnParticles('heart', x, y, result.bonusApplied ? 6 : 4);
    if (fromCursorRub) {
      this.animator.spawnParticles('sparkle', x, y - 10, 3);
    }

    if (fromCursorRub) {
      const caressPhrases = [
        'Ronron... 💕 C’est tellement doux tes caresses !',
        'Mmh, pile derrière les oreilles ! 🥰',
        'Hihi, ça chatouille un peu mais j’adore ! ✨',
        'Encore des papouilles s’il te plaît ! 💖',
      ];
      this.showSpeechBubble(caressPhrases[Math.floor(Math.random() * caressPhrases.length)], 2800);
    } else if (result.bonusApplied) {
      this.showSpeechBubble('Ronron... J’adore les caresses ! 💖');
    } else {
      this.showSpeechBubble('Merci pour ce câlin tout doux ! 🤗💖');
    }

    this.refreshAllPanelsUI();
    void this.persistSaveState();
  }

  private handlePetDropped(dropType: 'gentle' | 'fast' | 'shake', x: number, y: number): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') return;

    if (dropType === 'shake') {
      this.animator.setState('sad', 2400);
      this.animator.spawnParticles('star', x, y - 20, 8);
      this.animator.spawnDialogueProp('coffee_cup', 2200);
      const shakePhrases = [
        "Ouh là là, ça tourne... J'ai le tournis ! 🌀😵",
        "Wouah ! Doucement les secousses, mes pattes tournent ! 😵💫",
        "Pfiou... la terre tourne encore un peu ! 🌀",
      ];
      this.showSpeechBubble(shakePhrases[Math.floor(Math.random() * shakePhrases.length)], 3500);
    } else if (dropType === 'fast') {
      this.animator.setState('play', 2000);
      this.animator.spawnParticles('sparkle', x, y - 15, 6);
      this.animator.spawnDialogueProp('tennis_ball', 2000);
      const fastPhrases = [
        "Wouah, ça c'était rapide ! 💨 Atterrissage contrôlé !",
        "Vitesse maximale atteinte ! 🚀 Merci pour le voyage express !",
        "Hop là ! Vol supersonique réussi ! 💨✨",
      ];
      this.showSpeechBubble(fastPhrases[Math.floor(Math.random() * fastPhrases.length)], 3500);
    } else {
      this.animator.setState('happy', 1800);
      this.animator.spawnParticles('heart', x, y - 20, 4);
      const gentlePhrases = [
        "Hop là, merci de me déposer ici en douceur ! ✨",
        "Parfait, ce petit coin de bureau me va très bien ! 🌸",
        "Atterrissage tout doux réussi ! 💕",
      ];
      this.showSpeechBubble(gentlePhrases[Math.floor(Math.random() * gentlePhrases.length)], 3200);
    }
    this.hitTester.refresh();
  }

  private handleWindowPerchJump(windowTitle: string): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') return;
    this.animator.setState('play', 1200);
    this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y - 15, 5);
    const shortTitle = windowTitle.length > 25 ? windowTitle.slice(0, 22) + '...' : windowTitle;
    this.showSpeechBubble(`Hop là ! Je saute sur ta fenêtre « ${shortTitle} » ! 🐾`, 2600);
  }

  private handleWindowPerchLand(windowTitle: string): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') return;
    this.animator.setState('happy', 2200);
    this.animator.spawnParticles('star', this.petActor.x, this.petActor.y - 20, 6);
    const shortTitle = windowTitle.length > 25 ? windowTitle.slice(0, 22) + '...' : windowTitle;
    this.showSpeechBubble(`Me voilà bien perché au-dessus de « ${shortTitle} » ! 👀✨`, 3400);
  }

  private handleToggleSleep(): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') {
      this.showSpeechBubble("L'œuf se repose déjà au chaud ! Cliquez dessus pour l'éclore 🥚");
      return;
    }

    if (this.isSpongeMode) {
      this.stopSpongeMode();
    }

    const result = this.engine.toggleSleep(Date.now());
    if (result.isSleeping) {
      this.animator.setState('sleep');
      this.animator.spawnParticles('zzz', this.petActor.x, this.petActor.y, 3);
      this.showSpeechBubble('Bonne nuit... Zzz 💤');
    } else {
      this.animator.setState('happy', 1100);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 3);
      this.showSpeechBubble('Coucou ! Bien dormi ☀️');
    }

    this.refreshAllPanelsUI();
    void this.persistSaveState();
  }

  /**
   * Active ou désactive le Mode Éponge / Brosse interactif (`isSpongeMode`).
   */
  private handleCleanAction(): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') {
      this.showSpeechBubble("L'œuf est déjà tout propre ! 🥚✨");
      return;
    }

    if (this.isSpongeMode) {
      this.stopSpongeMode();
      return;
    }

    this.startSpongeMode();
  }

  private startSpongeMode(): void {
    const pet = this.engine.getState();
    if (pet.isSleeping) {
      this.engine.toggleSleep(Date.now());
    }

    this.isSpongeMode = true;
    this.petActor.isSpongeMode = true;
    this.petActor.stopWalking();
    document.body.classList.add('sponge-mode');

    this.hideHudPanel();
    this.showSpeechBubble("🧽 Frottez l'éponge sur votre familier pour le nettoyer !", 3500);
    this.updateFloatingPanelsPosition();
    this.hitTester.refresh();
  }

  private stopSpongeMode(): void {
    this.isSpongeMode = false;
    this.petActor.isSpongeMode = false;
    document.body.classList.remove('sponge-mode');
    this.hitTester.refresh();
  }

  /**
   * Appelé lorsque l'utilisateur frotte le familier en va-et-vient avec le curseur Éponge.
   */
  private handleSpongeScrub(scrubDelta: number, cursorX: number, cursorY: number): void {
    if (!this.isSpongeMode) {
      return;
    }

    const prevFormId = this.engine.getState().formId;
    const result = this.engine.scrubClean(scrubDelta, Date.now());

    // Fait jaillir des bulles de savon et de la mousse blanche à l'endroit du curseur
    this.animator.spawnParticles('bubble', cursorX, cursorY, 2);
    this.animator.spawnParticles('foam', cursorX, cursorY, 2);
    this.animator.setState('cleaning', 550);

    this.refreshHudUI();

    if (result.completed) {
      this.stopSpongeMode();
      this.animator.setState('happy', 1800);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 10);
      this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 6);
      this.animator.spawnParticles('clean', this.petActor.x, this.petActor.y, 6);
      this.showSpeechBubble('✨ Tout propre et étincelant !', 3600);

      const currentForm = this.engine.getCurrentSpeciesForm();
      if (currentForm && currentForm.id !== prevFormId) {
        this.handleEvolutionTriggered(currentForm);
      }

      this.refreshAllPanelsUI();
      void this.persistSaveState();
    }
  }

  private handleMiniGameComplete(result: MiniGameResult): void {
    const outcome = this.engine.completeMiniGame(result, Date.now());
    this.animator.setState('happy', 1800);
    this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 6);
    this.animator.spawnParticles('heart', this.petActor.x, this.petActor.y, 4);

    if (result.gameId === 'star_catch' && result.score > 0) {
      // 2 pièces par étoile attrapée !
      const bonusCoins = result.score * 2;
      this.engine.addCoins(bonusCoins);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y - 15, 6);
    }

    if (outcome.evolved && outcome.newForm) {
      this.handleEvolutionTriggered(outcome.newForm);
    } else if (result.gameId === 'star_catch') {
      const bonusCoins = result.score * 2;
      this.showSpeechBubble(
        `⭐ ${result.score} étoiles attrapées en 10s ! +${Math.round(outcome.happinessGain)} 💖 (+${bonusCoins} 🪙)`,
        4000
      );
    } else if (result.won) {
      this.showSpeechBubble(
        `Victoire (${result.score}/${result.maxScore}) ! +${Math.round(outcome.happinessGain)} 💖 (+20 🪙)`,
        3800
      );
    } else {
      this.showSpeechBubble(
        `Bien joué (${result.score}/${result.maxScore}) ! +${Math.round(outcome.happinessGain)} 💖 (+8 🪙)`,
        3500
      );
    }

    this.refreshAllPanelsUI();
    void this.persistSaveState();
  }

  private handleEvolutionTriggered(newForm: SpeciesFormDefinition): void {
    this.syncActorWithCurrentForm();

    this.animator.setState('evolve', 2800);
    this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 10);
    this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 6);

    const msg = `Évolution en ${newForm.name} ! ✨`;
    this.showSpeechBubble(msg, 5000);
    const settings = this.engine.getSaveData().settings;
    if (settings.notificationsEnabled) {
      void window.petAPI?.notifyCriticalNeed('Évolution ! ✨', msg);
    }

    this.refreshAllPanelsUI();
    void this.persistSaveState();
  }

  private syncActorWithCurrentForm(): void {
    const species = this.engine.getCurrentSpeciesForm();
    const settings = this.engine.getSaveData().settings;
    this.petActor.setScales(species?.scale ?? 1, settings.petScale);
    this.petActor.setWalkSpeed(species?.walkSpeed ?? 0);
  }

  /**
   * Déclenche un petit dialogue autonome et spontané du familier sur le bureau,
   * accompagné d'animations, d'accessoires thématiques (verre d'eau, café, bouclier, danse)
   * et de gerbes de particules adaptées.
   */
  private triggerSpontaneousDialogue(): void {
    const pet = this.engine.getState();
    const hour = new Date().getHours();

    interface DialogueScenario {
      text: string;
      animState?: AnimationState;
      prop?: DialoguePropType;
      particleKind?: ParticleKind;
      particleCount?: number;
      durationMs?: number;
    }

    const generalScenarios: DialogueScenario[] = [
      {
        text: 'Un petit verre d’eau ? Reste bien hydraté(e) ! 💧',
        animState: 'eat',
        prop: 'water_glass',
        particleKind: 'water',
        particleCount: 6,
        durationMs: 3800,
      },
      {
        text: 'Regarde mes super petits pas de danse ! 💃',
        animState: 'happy',
        prop: 'dance',
        particleKind: 'music',
        particleCount: 8,
        durationMs: 4000,
      },
      {
        text: 'Tu travailles bien ? Pense à faire une pause et t’étirer un peu ! ☕',
        animState: 'happy',
        prop: 'coffee_cup',
        particleKind: 'coffee',
        particleCount: 6,
        durationMs: 3800,
      },
      {
        text: 'Si tu as besoin d’une pause, je suis toujours prêt pour jouer ! 🎾',
        animState: 'play',
        prop: 'tennis_ball',
        particleKind: 'tennis',
        particleCount: 6,
        durationMs: 3600,
      },
      {
        text: 'Je garde un œil sur ton bureau pendant que tu es concentré ! 🛡️',
        animState: 'happy',
        prop: 'shield',
        particleKind: 'shield',
        particleCount: 6,
        durationMs: 3600,
      },
      {
        text: 'La météo du bureau : 100% de mignonnerie garantie ! ☀️',
        animState: 'happy',
        prop: 'sun',
        particleKind: 'sun',
        particleCount: 6,
        durationMs: 3600,
      },
      {
        text: 'C’est tellement douillet ici sur ce bureau... (˘◡˘) 💕',
        animState: 'happy',
        particleKind: 'heart',
        particleCount: 6,
        durationMs: 3600,
      },
      {
        text: 'Une grande respiration... et on repart du bon pied ! 🌸',
        animState: 'happy',
        prop: 'sun',
        particleKind: 'sparkle',
        particleCount: 5,
        durationMs: 3600,
      },
      {
        text: `Il fait bon sur ce bureau avec toi, ${pet.name} veille au grain ! ✨`,
        animState: 'happy',
        particleKind: 'sparkle',
        particleCount: 5,
        durationMs: 3600,
      },
      {
        text: 'Merci de prendre si bien soin de moi ! 💖',
        animState: 'happy',
        particleKind: 'heart',
        particleCount: 6,
        durationMs: 3600,
      },
      {
        text: 'Chut... j’explore un nouveau recoin de l’écran ! 🗺️',
        animState: 'walk',
        particleKind: 'sparkle',
        particleCount: 4,
        durationMs: 3400,
      },
    ];

    const timeScenarios: DialogueScenario[] = [];
    if (hour >= 6 && hour < 12) {
      timeScenarios.push(
        {
          text: 'Un bon petit café ou thé pour commencer la journée ? ☕',
          animState: 'eat',
          prop: 'coffee_cup',
          particleKind: 'coffee',
          particleCount: 6,
          durationMs: 3800,
        },
        {
          text: 'Coucou ! Bien dormi ? Passe une merveilleuse journée ! 🌅',
          animState: 'happy',
          prop: 'sun',
          particleKind: 'sun',
          particleCount: 6,
          durationMs: 3800,
        },
        {
          text: 'Prêt pour une belle matinée productive ! ☀️',
          animState: 'happy',
          particleKind: 'star',
          particleCount: 6,
          durationMs: 3600,
        }
      );
    } else if (hour >= 12 && hour < 18) {
      timeScenarios.push(
        {
          text: 'Courage pour ton après-midi ! Tu es formidable ! 🌟',
          animState: 'happy',
          particleKind: 'star',
          particleCount: 6,
          durationMs: 3600,
        },
        {
          text: 'Une petite pause l’après-midi, ça fait toujours du bien ! 🍪',
          animState: 'eat',
          particleKind: 'crumb',
          particleCount: 6,
          durationMs: 3600,
        }
      );
    } else if (hour >= 18 && hour < 23) {
      timeScenarios.push(
        {
          text: 'La journée touche à sa fin, repose tes yeux un peu ! 🌙',
          animState: 'happy',
          particleKind: 'sparkle',
          particleCount: 5,
          durationMs: 3600,
        },
        {
          text: 'Belle soirée ! On forme une sacrée équipe tous les deux ! ✨',
          animState: 'happy',
          particleKind: 'heart',
          particleCount: 6,
          durationMs: 3600,
        }
      );
    } else {
      timeScenarios.push(
        {
          text: 'Encore debout à cette heure ? N’oublie pas de dormir un peu ! 🌌😴',
          animState: 'sleep',
          particleKind: 'zzz',
          particleCount: 6,
          durationMs: 3800,
        },
        {
          text: 'Chut... tout le monde dort, mais moi je veille sur toi ! 🌙💤',
          animState: 'sleep',
          particleKind: 'zzz',
          particleCount: 5,
          durationMs: 3600,
        }
      );
    }

    const allScenarios = [...generalScenarios, ...timeScenarios];
    const picked = allScenarios[Math.floor(Math.random() * allScenarios.length)];
    const duration = picked.durationMs ?? 3600;

    this.showSpeechBubble(picked.text, duration);

    if (picked.animState) {
      this.animator.setState(picked.animState, duration);
    }
    if (picked.prop) {
      this.animator.setActiveDialogueProp(picked.prop, duration);
    }
    if (picked.particleKind) {
      this.animator.spawnParticles(
        picked.particleKind,
        this.petActor.x,
        this.petActor.y - 14,
        picked.particleCount ?? 6
      );
    }
  }

  private async handleResetPet(): Promise<void> {
    if (this.isSpongeMode) {
      this.stopSpongeMode();
    }

    const inputEl = document.getElementById('input-pet-name') as HTMLInputElement | null;
    const customName = inputEl?.value.trim() || 'Mochi';

    if (window.petAPI) {
      const freshSave = await window.petAPI.resetSave(customName);
      this.engine = new PetEngine({
        saveData: freshSave,
        config: this.engine.getConfig(),
        foods: this.engine.getFoods(),
        species: this.engine.getSpecies(),
      });
    } else {
      this.engine.reset(customName, Date.now());
    }

    this.syncActorWithCurrentForm();
    this.petActor.centerOnScreen();

    this.animator.forceState('idle');
    this.animator.triggerEggShake(350);
    this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 8);
    this.showSpeechBubble(
      `🥚 Nouvel œuf (${customName}) ! Cliquez 5 fois dessus pour le faire éclore !`,
      4200
    );

    this.refreshAllPanelsUI();
  }

  private renderFoodsDrawerList(): void {
    const listEl = document.getElementById('foods-list');
    if (!listEl) {
      return;
    }
    listEl.innerHTML = '';
    const inv = this.engine.getFoodInventory();

    for (const food of this.engine.getFoods()) {
      const count = inv[food.id] ?? 0;
      const isOutOfStock = count <= 0;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `food-item-btn ${isOutOfStock ? 'out-of-stock' : ''}`;

      const effectsParts: string[] = [];
      if (food.effects.hunger) {
        effectsParts.push(`+${food.effects.hunger}🍖`);
      }
      if (food.effects.energy) {
        effectsParts.push(`+${food.effects.energy}⚡`);
      }
      if (food.effects.happiness) {
        effectsParts.push(`+${food.effects.happiness}💖`);
      }
      if (food.effects.cleanliness) {
        const sign = food.effects.cleanliness > 0 ? '+' : '';
        effectsParts.push(`${sign}${food.effects.cleanliness}✨`);
      }

      const countBadge = isOutOfStock
        ? `<span class="food-count-badge zero">0 (🪙${food.price ?? 5})</span>`
        : `<span class="food-count-badge">x${count}</span>`;

      btn.innerHTML = `
        <span class="food-emoji">${food.icon}</span>
        <div class="food-details">
          <div class="food-title-row">
            <span class="food-name">${food.name}</span>
            ${countBadge}
          </div>
          <div class="food-effects">${effectsParts.join(' ')}</div>
          <div class="food-desc">${food.description}</div>
        </div>
      `;

      btn.addEventListener('click', () => {
        if (isOutOfStock) {
          this.showSpeechBubble(`Plus de ${food.name} ! Ouverture de la Boutique pour en acheter 🛍️`, 3200);
          this.openShopModal();
          this.switchShopTab('market');
          const foodCatBtn = document.querySelector<HTMLButtonElement>('.shop-filter-btn[data-category="food"]');
          foodCatBtn?.click();
        } else {
          this.handleFeedFood(food);
        }
      });

      listEl.appendChild(btn);
    }
  }

  private refreshAllPanelsUI(): void {
    this.refreshHudUI();
    this.refreshStatsAndCompendiumUI();
    if (this.hudCoinsCountEl) {
      this.hudCoinsCountEl.textContent = String(this.engine.getState().tamaCoins);
    }
    if (this.shopModalEl && !this.shopModalEl.classList.contains('hidden')) {
      this.refreshShopUI();
    }
    if (this.onlineModalEl && !this.onlineModalEl.classList.contains('hidden')) {
      this.refreshOnlineUI();
    }
    if (this.isDevEdition) {
      this.refreshSandboxMetricsUI();
      if (!this.sandboxModalEl?.classList.contains('hidden')) {
        this.renderSandboxLineagesGrid();
      }
    }
  }

  private getTotalCareActions(pet: PetState): number {
    return (
      (pet.careStats.totalMeals ?? 0) +
      (pet.careStats.totalGamesPlayed ?? 0) +
      (pet.careStats.totalPets ?? 0) +
      (pet.careStats.totalCleans ?? 0)
    );
  }

  private refreshHudUI(): void {
    const pet = this.engine.getState();
    const species = this.engine.getCurrentSpeciesForm();
    const threshold = this.engine.getConfig().criticalThreshold;

    const nameEl = document.getElementById('hud-pet-name');
    if (nameEl) {
      nameEl.textContent = pet.name;
    }

    const stageEl = document.getElementById('hud-pet-stage');
    if (stageEl) {
      stageEl.textContent = species
        ? `${species.name} (${STAGE_LABELS[pet.stage] ?? pet.stage})`
        : pet.formId;
    }

    this.updateNeedBar('hunger', pet.needs.hunger, threshold);
    this.updateNeedBar('energy', pet.needs.energy, threshold);
    this.updateNeedBar('happiness', pet.needs.happiness, threshold);
    this.updateNeedBar('cleanliness', pet.needs.cleanliness, threshold);

    const sleepIconEl = document.getElementById('icon-action-sleep');
    const sleepLabelEl = document.getElementById('label-action-sleep');
    if (sleepIconEl && sleepLabelEl) {
      sleepIconEl.textContent = pet.isSleeping ? '☀️' : '💤';
      sleepLabelEl.textContent = pet.isSleeping ? 'Réveiller' : 'Dormir';
    }

    const poopBadgeEl = document.getElementById('badge-poop-count');
    if (poopBadgeEl) {
      if (pet.poopCount > 0) {
        poopBadgeEl.textContent = String(pet.poopCount);
        poopBadgeEl.classList.remove('hidden');
      } else {
        poopBadgeEl.classList.add('hidden');
      }
    }

    const marathonInputsEl = document.getElementById('hud-marathon-inputs');
    if (marathonInputsEl) {
      const clicks = (pet.careStats.pcMouseClicks ?? 0).toLocaleString('fr-FR');
      const keys = (pet.careStats.pcKeyPresses ?? 0).toLocaleString('fr-FR');
      marathonInputsEl.textContent = `⌨️ PC : ${clicks} clics • ${keys} touches`;
    }

    const marathonCareEl = document.getElementById('hud-marathon-care');
    if (marathonCareEl) {
      marathonCareEl.textContent = `🫧 Soins : ${this.getTotalCareActions(pet)}`;
    }

    this.updateFpsBadgeUI();
  }

  private updateNeedBar(key: NeedKey, value: number, criticalThreshold: number): void {
    const rounded = Math.round(value);
    const valEl = document.getElementById(`val-${key}`);
    const barEl = document.getElementById(`bar-${key}`);
    const cardEl = document.getElementById(`need-card-${key}`);

    if (valEl) {
      valEl.textContent = `${rounded}%`;
    }
    if (barEl) {
      barEl.style.width = `${Math.max(0, Math.min(100, rounded))}%`;
    }
    if (cardEl) {
      cardEl.classList.toggle('critical', value < criticalThreshold);
    }
  }

  private updateFpsBadgeUI(): void {
    const badgeEl = document.getElementById('hud-fps-badge');
    if (!badgeEl) {
      return;
    }
    if (this.isActiveFpsMode) {
      badgeEl.textContent = `⚡ ${this.currentTargetFps} FPS Actif`;
      badgeEl.classList.add('active-mode');
    } else {
      badgeEl.textContent = `🍃 ${this.currentTargetFps} FPS Éco`;
      badgeEl.classList.remove('active-mode');
    }
  }

  private toggleHudPanel(): void {
    if (!this.hudEl) {
      return;
    }
    if (this.hudEl.classList.contains('hidden')) {
      this.showHudPanel();
    } else {
      this.hideHudPanel();
    }
  }

  private showHudPanel(): void {
    if (!this.hudEl) {
      return;
    }
    this.petActor.stopWalking();
    this.refreshHudUI();
    this.hudEl.classList.remove('hidden');
    this.updateFloatingPanelsPosition();
    this.hitTester.refresh();
  }

  private hideHudPanel(): void {
    this.hudEl?.classList.add('hidden');
    this.drawerFoodsEl?.classList.add('hidden');
    this.drawerGamesEl?.classList.add('hidden');
    this.hitTester.refresh();
  }

  private closeAllPanels(): void {
    this.hideHudPanel();
    this.statsModalEl?.classList.add('hidden');
    this.shopModalEl?.classList.add('hidden');
    this.onlineModalEl?.classList.add('hidden');
    this.sandboxModalEl?.classList.add('hidden');
    this.pomodoroModalEl?.classList.add('hidden');
    if (this.isBallThrowMode) {
      this.cancelBallThrowMode();
    }
    this.hitTester.refresh();
  }

  private startBallThrowMode(): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') {
      this.showSpeechBubble("L'œuf doit d'abord éclore avant de jouer à la balle ! 🥚", 3000);
      return;
    }
    if (pet.isSleeping) {
      this.showSpeechBubble("Zzz... Votre familier dort paisiblement ! 💤", 2500);
      return;
    }
    if (this.isSpongeMode) {
      this.stopSpongeMode();
    }
    this.closeAllPanels();
    this.isBallThrowMode = true;
    this.isDraggingBall = false;
    this.ballDragHistory = [];
    this.ballModeBannerEl?.classList.remove('hidden');

    const spawnX = Math.max(70, Math.min(window.innerWidth - 70, this.petActor.x + (this.petActor.flipX ? -75 : 75)));
    const spawnY = this.petActor.getGroundY() + 10;
    this.ballEntity.spawn(spawnX, spawnY);
    this.showSpeechBubble("Attrape la balle à la souris et lance-la avec élan ! 🎾", 3200);
    this.hitTester.refresh();
  }

  private cancelBallThrowMode(): void {
    this.isBallThrowMode = false;
    this.isDraggingBall = false;
    this.ballDragHistory = [];
    this.ballEntity.reset();
    this.ballModeBannerEl?.classList.add('hidden');
    this.hitTester.refresh();
  }

  private toggleMusicMode(force?: boolean): void {
    const nextMode = force !== undefined ? force : !this.isMusicMode;
    if (nextMode === this.isMusicMode) return;
    this.isMusicMode = nextMode;
    this.animator.setMusicMode(this.isMusicMode);

    const pet = this.engine.getState();
    if (pet.stage === 'egg') {
      return;
    }

    if (this.isMusicMode) {
      this.showSpeechBubble("J'adore cette musique ! 🎧🎶 En rythme !", 3400);
      this.animator.spawnDialogueProp('headphones', 3000);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y - 30, 8);
    } else {
      this.showSpeechBubble("Musique terminée, casque rangé ! 🎧", 2200);
    }
  }

  private openPomodoroModal(): void {
    this.closeAllPanels();
    this.refreshPomodoroUI();
    this.pomodoroModalEl?.classList.remove('hidden');
    this.hitTester.refresh();
  }

  private closePomodoroModal(): void {
    this.pomodoroModalEl?.classList.add('hidden');
    this.hitTester.refresh();
  }

  private startPomodoroSession(workMin = 25, breakMin = 5): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') {
      this.showSpeechBubble("L'œuf doit d'abord éclore avant d'étudier avec vous ! 🥚", 3000);
      return;
    }
    this.engine.startPomodoro(workMin, breakMin);
    this.refreshPomodoroUI();
    this.closePomodoroModal();
    this.showSpeechBubble(`C'est parti pour ${workMin} min de concentration ! Bon travail ! 💻✨`, 4000);
    void this.persistSaveState();
  }

  private togglePomodoroSession(): void {
    const pState = this.engine.getPomodoroState();
    if (!pState || !pState.isActive) {
      this.startPomodoroSession(this.selectedPomodoroWorkMinutes, this.selectedPomodoroBreakMinutes);
      return;
    }
    if (pState.mode === 'paused') {
      this.engine.resumePomodoro();
      this.showSpeechBubble("Session Focus reprise ! 💻", 2200);
    } else {
      this.engine.pausePomodoro();
      this.showSpeechBubble("Session Focus en pause. ⏸", 2200);
    }
    this.refreshPomodoroUI();
    void this.persistSaveState();
  }

  private stopPomodoroSession(): void {
    this.engine.stopPomodoro();
    this.refreshPomodoroUI();
    this.showSpeechBubble("Session Focus terminée. ⏹", 2500);
    void this.persistSaveState();
  }

  private refreshPomodoroUI(): void {
    const pState = this.engine.getPomodoroState();
    const isActive = Boolean(pState && pState.isActive);

    if (isActive && pState) {
      this.pomodoroPillEl?.classList.remove('hidden');

      const totalSec = pState.remainingSeconds;
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

      if (this.pomodoroTimerLabelEl) {
        this.pomodoroTimerLabelEl.textContent = timeStr;
      }
      if (this.pomodoroDisplayBigEl) {
        this.pomodoroDisplayBigEl.textContent = timeStr;
      }

      if (this.pomodoroModeBadgeEl) {
        this.pomodoroModeBadgeEl.className = 'pomodoro-badge';
        if (pState.mode === 'work') {
          this.pomodoroModeBadgeEl.classList.add('badge-work');
          this.pomodoroModeBadgeEl.textContent = 'Focus';
        } else if (pState.mode === 'break') {
          this.pomodoroModeBadgeEl.classList.add('badge-break');
          this.pomodoroModeBadgeEl.textContent = 'Pause ☕';
        } else {
          this.pomodoroModeBadgeEl.classList.add('badge-paused');
          this.pomodoroModeBadgeEl.textContent = 'En pause ⏸';
        }
      }

      if (this.pomodoroPhaseBigEl) {
        if (pState.mode === 'work') {
          this.pomodoroPhaseBigEl.textContent = 'Session de concentration en cours... Restez focus !';
        } else if (pState.mode === 'break') {
          this.pomodoroPhaseBigEl.textContent = 'Pause méritée — étirez-vous, buvez un verre d’eau ! ☕';
        } else {
          this.pomodoroPhaseBigEl.textContent = 'Session en pause ⏸';
        }
      }

      if (this.btnPomoToggleEl) {
        this.btnPomoToggleEl.textContent = pState.mode === 'paused' ? '▶' : '⏸';
      }

      if (this.btnPomodoroStartEl) this.btnPomodoroStartEl.classList.add('hidden');
      if (this.btnPomodoroPauseEl) {
        this.btnPomodoroPauseEl.classList.remove('hidden');
        this.btnPomodoroPauseEl.textContent = pState.mode === 'paused' ? '▶ Reprendre' : '⏸ Mettre en pause';
      }
      if (this.btnPomodoroStopEl) this.btnPomodoroStopEl.classList.remove('hidden');
    } else {
      this.pomodoroPillEl?.classList.add('hidden');

      const workSec = Math.round(this.selectedPomodoroWorkMinutes * 60);
      const mins = Math.floor(workSec / 60);
      const secs = workSec % 60;
      const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

      if (this.pomodoroDisplayBigEl) {
        this.pomodoroDisplayBigEl.textContent = timeStr;
      }
      if (this.pomodoroPhaseBigEl) {
        this.pomodoroPhaseBigEl.textContent = 'Prêt pour une session de concentration';
      }
      if (this.btnPomodoroStartEl) this.btnPomodoroStartEl.classList.remove('hidden');
      if (this.btnPomodoroPauseEl) this.btnPomodoroPauseEl.classList.add('hidden');
      if (this.btnPomodoroStopEl) this.btnPomodoroStopEl.classList.add('hidden');
    }

    if (this.pomodoroSessionsCountEl) {
      this.pomodoroSessionsCountEl.textContent = String(pState?.totalWorkSessionsCompleted ?? 0);
    }
  }

  private initDraggableShopModal(): void {
    const modal = this.shopModalEl;
    if (!modal) return;
    const header = modal.querySelector('.modal-header') as HTMLElement | null;
    if (!header) return;

    let isDragging = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let modalInitialLeft = 0;
    let modalInitialTop = 0;

    header.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      isDragging = true;
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      const rect = modal.getBoundingClientRect();
      modalInitialLeft = rect.left;
      modalInitialTop = rect.top;
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;
      const width = modal.offsetWidth || 560;
      const height = modal.offsetHeight || 420;

      const newLeft = Math.max(8, Math.min(window.innerWidth - width - 8, modalInitialLeft + dx));
      const newTop = Math.max(8, Math.min(window.innerHeight - height - 8, modalInitialTop + dy));

      modal.style.left = `${newLeft}px`;
      modal.style.top = `${newTop}px`;
      modal.style.transform = 'none';
      this.hitTester.refresh();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'grab';
        this.hitTester.refresh();
      }
    });
  }

  private openShopModal(): void {
    this.hideHudPanel();
    this.statsModalEl?.classList.add('hidden');
    this.onlineModalEl?.classList.add('hidden');
    this.sandboxModalEl?.classList.add('hidden');
    this.petActor.stopWalking();

    if (this.shopModalEl) {
      if (!this.shopModalPositioned) {
        const width = Math.min(560, window.innerWidth - 32);
        const height = Math.min(520, window.innerHeight - 60);
        const left = Math.max(16, Math.round((window.innerWidth - width) / 2));
        const top = Math.max(16, Math.round((window.innerHeight - height) / 2));
        this.shopModalEl.style.left = `${left}px`;
        this.shopModalEl.style.top = `${top}px`;
        this.shopModalEl.style.transform = 'none';
        this.shopModalPositioned = true;
      }
      this.refreshShopUI();
      this.shopModalEl.classList.remove('hidden');
    }
    this.hitTester.refresh();
  }

  private closeShopModal(): void {
    this.shopModalEl?.classList.add('hidden');
    this.hitTester.refresh();
  }

  private switchShopTab(tab: 'market' | 'inventory'): void {
    this.currentShopTab = tab;
    const marketBtn = document.getElementById('tab-btn-shop-market');
    const invBtn = document.getElementById('tab-btn-shop-inventory');
    marketBtn?.classList.toggle('active', tab === 'market');
    invBtn?.classList.toggle('active', tab === 'inventory');
    this.refreshShopUI();
  }

  private refreshShopUI(): void {
    const pet = this.engine.getState();
    const allCosmetics = this.engine.getCosmetics();

    if (this.shopCoinsValEl) {
      this.shopCoinsValEl.textContent = String(pet.tamaCoins);
    }
    if (this.hudCoinsCountEl) {
      this.hudCoinsCountEl.textContent = String(pet.tamaCoins);
    }

    const foodInv = this.engine.getFoodInventory();
    const totalFoodCount = Object.values(foodInv).reduce((a, b) => a + b, 0);

    const ownedCountEl = document.getElementById('shop-owned-count');
    if (ownedCountEl) {
      ownedCountEl.textContent = String(pet.ownedCosmetics.length + totalFoodCount);
    }

    // Résumé de l'équipement actuel
    const summaryEl = document.getElementById('shop-equipped-summary');
    if (summaryEl) {
      summaryEl.classList.toggle('hidden', this.currentShopTab !== 'inventory' || this.currentShopCategory === 'food');
    }

    const hatItem = allCosmetics.find((c) => c.id === pet.equippedCosmetics.hat);
    const accItem = allCosmetics.find((c) => c.id === pet.equippedCosmetics.accessory);
    const auraItem = allCosmetics.find((c) => c.id === pet.equippedCosmetics.aura);

    const hatLabel = document.getElementById('summary-hat-name');
    const hatBtn = document.getElementById('btn-unequip-hat');
    const hatPill = document.getElementById('slot-summary-hat');
    if (hatLabel && hatBtn && hatPill) {
      hatLabel.textContent = hatItem ? `Chapeau : ${hatItem.name}` : 'Chapeau : Aucun';
      hatBtn.classList.toggle('hidden', !hatItem);
      hatPill.classList.toggle('active', !!hatItem);
    }

    const accLabel = document.getElementById('summary-acc-name');
    const accBtn = document.getElementById('btn-unequip-accessory');
    const accPill = document.getElementById('slot-summary-accessory');
    if (accLabel && accBtn && accPill) {
      accLabel.textContent = accItem ? `Accessoire : ${accItem.name}` : 'Accessoire : Aucun';
      accBtn.classList.toggle('hidden', !accItem);
      accPill.classList.toggle('active', !!accItem);
    }

    const auraLabel = document.getElementById('summary-aura-name');
    const auraBtn = document.getElementById('btn-unequip-aura');
    const auraPill = document.getElementById('slot-summary-aura');
    if (auraLabel && auraBtn && auraPill) {
      auraLabel.textContent = auraItem ? `Aura : ${auraItem.name}` : 'Aura : Aucune';
      auraBtn.classList.toggle('hidden', !auraItem);
      auraPill.classList.toggle('active', !!auraItem);
    }

    if (!this.shopItemsGridEl) return;
    this.shopItemsGridEl.innerHTML = '';

    const allFoods = this.engine.getFoods();
    const isFoodCategory = this.currentShopCategory === 'food';
    const isAllCategory = this.currentShopCategory === 'all';
    let totalCardsAdded = 0;

    // 1) Rendu des cartes de nourriture si la catégorie courante est 'food' ou 'all'
    if (isFoodCategory || isAllCategory) {
      const foodsToDisplay = this.currentShopTab === 'inventory'
        ? allFoods.filter((f) => (foodInv[f.id] ?? 0) > 0)
        : allFoods;

      for (const food of foodsToDisplay) {
        const count = foodInv[food.id] ?? 0;
        const card = document.createElement('div');
        card.className = `shop-item-card food-item-card ${count > 0 ? 'owned' : ''}`;

        const iconDiv = document.createElement('div');
        iconDiv.className = 'shop-item-icon';
        iconDiv.textContent = food.icon;

        const nameDiv = document.createElement('div');
        nameDiv.className = 'shop-item-name';
        nameDiv.textContent = food.name;

        const descDiv = document.createElement('div');
        descDiv.className = 'shop-item-desc';
        const effectsParts: string[] = [];
        if (food.effects.hunger) effectsParts.push(`+${food.effects.hunger}🍖`);
        if (food.effects.energy) effectsParts.push(`+${food.effects.energy}⚡`);
        if (food.effects.happiness) effectsParts.push(`+${food.effects.happiness}💖`);
        if (food.effects.cleanliness) effectsParts.push(`${food.effects.cleanliness > 0 ? '+' : ''}${food.effects.cleanliness}✨`);
        descDiv.innerHTML = `${food.description}<div style="margin-top:4px; font-weight:600; color:#a5b4fc;">${effectsParts.join(' ')}</div>`;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'shop-item-actions';

        if (this.currentShopTab === 'inventory') {
          // Mode Inventaire : bouton pour donner à manger directement
          const feedBtn = document.createElement('button');
          feedBtn.type = 'button';
          feedBtn.className = 'shop-action-btn equip';
          feedBtn.textContent = `🍖 Donner (x${count})`;
          feedBtn.addEventListener('click', () => {
            this.handleFeedFood(food);
            this.refreshShopUI();
          });
          actionsDiv.appendChild(feedBtn);
        } else {
          // Mode Boutique : bouton d'achat
          const price = food.price ?? 5;
          const buyBtn = document.createElement('button');
          buyBtn.type = 'button';
          buyBtn.className = 'shop-action-btn buy';
          buyBtn.textContent = `🪙 ${price} Acheter (${count > 0 ? `Stock: ${count}` : '0'})`;
          const canAfford = pet.tamaCoins >= price;
          if (!canAfford) {
            buyBtn.disabled = true;
            buyBtn.title = 'Pas assez de pièces TamaCoins !';
          }
          buyBtn.addEventListener('click', () => {
            const res = this.engine.buyFood(food.id);
            if (res.purchased) {
              this.refreshShopUI();
              this.renderFoodsDrawerList();
              this.animator.spawnParticles('confetti', this.petActor.x, this.petActor.y, 8);
              this.showSpeechBubble(`Acheté : 1x ${food.name} ${food.icon} ! 😋`, 2800);
              void this.persistSaveState();
            } else {
              this.showSpeechBubble('Pas assez de pièces TamaCoins ! 🪙');
            }
          });
          actionsDiv.appendChild(buyBtn);
        }

        card.appendChild(iconDiv);
        card.appendChild(nameDiv);
        card.appendChild(descDiv);
        card.appendChild(actionsDiv);

        this.shopItemsGridEl.appendChild(card);
        totalCardsAdded++;
      }
    }

    // 2) Rendu des objets cosmétiques si la catégorie n'est pas strictement 'food'
    if (!isFoodCategory) {
      let cosmeticsToDisplay = allCosmetics;
      if (this.currentShopTab === 'inventory') {
        cosmeticsToDisplay = allCosmetics.filter((item) => pet.ownedCosmetics.includes(item.id));
      }

      if (this.currentShopCategory !== 'all') {
        cosmeticsToDisplay = cosmeticsToDisplay.filter((item) => item.slot === this.currentShopCategory);
      }

      for (const item of cosmeticsToDisplay) {
        const isOwned = pet.ownedCosmetics.includes(item.id);
        const isEquipped = pet.equippedCosmetics[item.slot] === item.id;

        const card = document.createElement('div');
        card.className = `shop-item-card ${isEquipped ? 'is-equipped' : isOwned ? 'owned' : ''}`;

        const iconDiv = document.createElement('div');
        iconDiv.className = 'shop-item-icon';
        iconDiv.textContent = item.icon;

        const nameDiv = document.createElement('div');
        nameDiv.className = 'shop-item-name';
        nameDiv.textContent = item.name;

        const descDiv = document.createElement('div');
        descDiv.className = 'shop-item-desc';
        descDiv.textContent = item.description;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'shop-item-actions';

        if (this.currentShopTab === 'inventory') {
          // Mode Inventaire : bouton Équiper / Déséquiper
          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = `shop-action-btn ${isEquipped ? 'buy' : 'equip'}`;
          toggleBtn.textContent = isEquipped ? 'Déséquiper' : 'Équiper';
          toggleBtn.addEventListener('click', () => {
            if (isEquipped) {
              this.engine.equipCosmetic(item.slot, null);
              this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 4);
            } else {
              this.engine.equipCosmetic(item.slot, item.id);
              this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 6);
              this.showSpeechBubble(`Équipé : ${item.name} ${item.icon} ! ✨`, 2800);
            }
            this.refreshShopUI();
            void this.persistSaveState();
          });
          actionsDiv.appendChild(toggleBtn);
        } else {
          // Mode Boutique : achat
          if (isOwned) {
            const ownedBtn = document.createElement('button');
            ownedBtn.type = 'button';
            ownedBtn.className = `shop-action-btn ${isEquipped ? 'buy' : 'equip'}`;
            ownedBtn.textContent = isEquipped ? '✓ Équipé' : '✓ Possédé (Équiper)';
            ownedBtn.addEventListener('click', () => {
              if (isEquipped) {
                this.engine.equipCosmetic(item.slot, null);
              } else {
                this.engine.equipCosmetic(item.slot, item.id);
                this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 6);
                this.showSpeechBubble(`Équipé : ${item.name} ${item.icon} ! ✨`, 2800);
              }
              this.refreshShopUI();
              void this.persistSaveState();
            });
            actionsDiv.appendChild(ownedBtn);
          } else {
            const buyBtn = document.createElement('button');
            buyBtn.type = 'button';
            buyBtn.className = 'shop-action-btn buy';
            buyBtn.textContent = `🪙 ${item.price} Acheter`;
            const canAfford = pet.tamaCoins >= item.price;
            if (!canAfford) {
              buyBtn.disabled = true;
              buyBtn.title = 'Pas assez de pièces TamaCoins !';
            }
            buyBtn.addEventListener('click', () => {
              const res = this.engine.buyCosmetic(item.id);
              if (res.purchased) {
                this.engine.equipCosmetic(item.slot, item.id);
                this.refreshShopUI();
                this.animator.spawnParticles('confetti', this.petActor.x, this.petActor.y, 10);
                this.showSpeechBubble(`Acheté et équipé : ${item.name} ${item.icon} ! 🎉`, 3200);
                void this.persistSaveState();
              } else {
                this.showSpeechBubble('Pas assez de pièces TamaCoins ! 🪙');
              }
            });
            actionsDiv.appendChild(buyBtn);
          }
        }

        card.appendChild(iconDiv);
        card.appendChild(nameDiv);
        card.appendChild(descDiv);
        card.appendChild(actionsDiv);

        this.shopItemsGridEl.appendChild(card);
        totalCardsAdded++;
      }
    }

    if (totalCardsAdded === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'shop-empty-state';
      if (this.currentShopTab === 'inventory') {
        emptyDiv.innerHTML = `
          <div>🎒 Vous ne possédez aucun article dans cette catégorie pour l'instant.</div>
          <button type="button" class="shop-action-btn equip" id="btn-goto-market" style="width: auto; padding: 7px 16px; margin-top: 10px;">
            🛍️ Ouvrir la Boutique pour en acheter
          </button>
        `;
        emptyDiv.querySelector('#btn-goto-market')?.addEventListener('click', () => {
          this.switchShopTab('market');
        });
      } else {
        emptyDiv.textContent = '✨ Aucun article trouvé.';
      }
      this.shopItemsGridEl.appendChild(emptyDiv);
    }
  }

  private openOnlineModal(): void {
    this.hideHudPanel();
    this.petActor.stopWalking();
    this.statsModalEl?.classList.add('hidden');
    this.shopModalEl?.classList.add('hidden');
    this.sandboxModalEl?.classList.add('hidden');
    this.refreshOnlineUI();
    this.onlineModalEl?.classList.remove('hidden');
    this.hitTester.refresh();
  }

  private closeOnlineModal(): void {
    this.onlineModalEl?.classList.add('hidden');
    this.hitTester.refresh();
  }

  public refreshOnlineUI(): void {
    const passportInput = document.getElementById('input-my-passport') as HTMLInputElement | null;
    if (passportInput) {
      passportInput.value = this.engine.exportPassport('Moi');
    }

    const visitorCard = document.getElementById('online-visitor-card');
    const visitorDetails = document.getElementById('visitor-details');
    const visitor = this.onlineManager.getVisitor();

    if (visitor && visitorCard && visitorDetails) {
      visitorCard.classList.remove('hidden');
      visitorDetails.textContent = `${visitor.name} (${visitor.ownerName}) — ${visitor.formId}`;
    } else if (visitorCard) {
      visitorCard.classList.add('hidden');
    }
  }

  public triggerPlayTogetherAnimation(): void {
    const visitor = this.onlineManager.getVisitor();
    if (!visitor) {
      this.showSpeechBubble("Aucun ami n'est en visite pour jouer ! Invitez un ami d'abord. 🌐", 3200);
      return;
    }

    this.isPlayingTogetherWithFriend = true;
    const result = this.engine.playWithFriend(Date.now());

    this.animator.setState('happy', 3500);
    this.animator.spawnParticles('heart', this.petActor.x, this.petActor.y, 8);
    this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 8);
    this.animator.spawnParticles('heart', this.onlineManager.friendX, this.onlineManager.friendY, 8);
    this.animator.spawnParticles('sparkle', this.onlineManager.friendX, this.onlineManager.friendY, 8);

    this.showSpeechBubble(
      `🎉 ${this.engine.getState().name} et ${visitor.name} jouent ensemble ! (+${result.coinsEarned} 🪙)`,
      4000
    );
    this.refreshAllPanelsUI();
    void this.persistSaveState();

    window.setTimeout(() => {
      this.isPlayingTogetherWithFriend = false;
    }, 3500);
  }

  private openStatsModal(initialTabId: string): void {
    this.hideHudPanel();
    this.petActor.stopWalking();
    this.shopModalEl?.classList.add('hidden');
    this.onlineModalEl?.classList.add('hidden');
    this.sandboxModalEl?.classList.add('hidden');
    this.refreshStatsAndCompendiumUI();
    this.syncSettingsControls();
    this.switchModalTab(initialTabId);
    this.statsModalEl?.classList.remove('hidden');
    this.hitTester.refresh();
  }

  private switchModalTab(tabId: string): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    const contents = document.querySelectorAll<HTMLElement>('.tab-content');
    contents.forEach((panel) => {
      const isMatch = panel.id === tabId;
      panel.classList.toggle('active', isMatch);
      panel.classList.toggle('hidden', !isMatch);
    });
  }

  private refreshStatsAndCompendiumUI(): void {
    const pet = this.engine.getState();
    const speciesList = this.engine.getSpecies();
    const currentSpecies = this.engine.getCurrentSpeciesForm();
    const totalCare = this.getTotalCareActions(pet);

    const setText = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = text;
      }
    };

    setText('stat-age', this.formatAge(pet.ageSeconds));
    setText('stat-form', currentSpecies?.name ?? pet.formId);
    setText('stat-meals', String(pet.careStats.totalMeals));
    setText('stat-fav-food', this.getFavoriteFoodCategoryLabel(pet));
    setText(
      'stat-games',
      `${pet.careStats.totalGamesWon} / ${pet.careStats.totalGamesPlayed}`
    );
    setText(
      'stat-care-actions',
      `${pet.careStats.totalPets} 🤗 • ${pet.careStats.totalCleans} 🧽`
    );
    setText(
      'stat-pc-inputs',
      `${(pet.careStats.pcMouseClicks ?? 0).toLocaleString('fr-FR')} 🖱️ • ${(
        pet.careStats.pcKeyPresses ?? 0
      ).toLocaleString('fr-FR')} ⌨️`
    );
    setText(
      'stat-pc-time-care',
      `${this.formatAge(pet.careStats.pcActiveSeconds ?? 0)} • ${totalCare} soins`
    );
    setText('stat-mistakes', String(pet.careStats.careMistakes));
    setText(
      'stat-discovered',
      `${pet.discoveredForms.length} / ${speciesList.length}`
    );

    setText('stat-cat-healthy', String(pet.careStats.foodCategoryCounts.healthy));
    setText('stat-cat-energizing', String(pet.careStats.foodCategoryCounts.energizing));
    setText('stat-cat-snack', String(pet.careStats.foodCategoryCounts.snack));
    setText('stat-cat-gourmet', String(pet.careStats.foodCategoryCounts.gourmet));

    // Rendu de la galerie Compendium (19 formes)
    const compendiumGrid = document.getElementById('compendium-grid');
    if (!compendiumGrid) {
      return;
    }
    compendiumGrid.innerHTML = '';

    for (const form of speciesList) {
      const isDiscovered = pet.discoveredForms.includes(form.id);
      const isCurrent = pet.formId === form.id;

      const card = document.createElement('div');
      card.className = `compendium-card${isDiscovered ? '' : ' locked'}${
        isCurrent ? ' current-form' : ''
      }`;

      const spriteBox = document.createElement('div');
      spriteBox.className = 'compendium-sprite-box';

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 44;
      thumbCanvas.height = 44;
      thumbCanvas.className = 'compendium-sprite-canvas';
      this.animator.drawFormThumbnail(thumbCanvas, form.id);
      spriteBox.appendChild(thumbCanvas);

      const conditionDesc = this.describeEvolutionConditionForTarget(
        form.id,
        speciesList
      );

      const infoDiv = document.createElement('div');
      infoDiv.className = 'compendium-info';
      infoDiv.innerHTML = `
        <div class="compendium-title-row">
          <span class="compendium-name">
            ${isDiscovered ? form.name : `??? (${form.name})`}
            ${isCurrent ? ' • Actuel' : isDiscovered ? ' ✅' : ' 🔒'}
          </span>
          <span class="compendium-stage-pill">${STAGE_LABELS[form.stage] ?? form.stage}</span>
        </div>
        <div class="compendium-desc">
          ${
            isDiscovered
              ? form.description
              : 'Continuez à prendre soin de votre familier (ou utilisez le Labo) pour découvrir cette forme.'
          }
        </div>
        <div class="compendium-condition">Condition : ${conditionDesc}</div>
      `;

      card.appendChild(spriteBox);
      card.appendChild(infoDiv);
      compendiumGrid.appendChild(card);
    }
  }

  private describeEvolutionConditionForTarget(
    targetFormId: FormId,
    speciesList: SpeciesFormDefinition[]
  ): string {
    if (targetFormId === 'egg') {
      return 'Forme de départ à la naissance.';
    }

    for (const parentForm of speciesList) {
      for (const branch of parentForm.evolutions) {
        if (branch.targetFormId === targetFormId) {
          const c = branch.condition;
          const parts: string[] = [`Depuis ${parentForm.name}`];
          if (typeof c.minEggClicks === 'number') {
            parts.push(`${c.minEggClicks} clics sur l'œuf`);
          }
          if (c.minAgeSeconds > 0) {
            parts.push(`Âge ≥ ${Math.round(c.minAgeSeconds / 3600)} h`);
          }
          if (typeof c.minPcInputs === 'number') {
            parts.push(`≥ ${c.minPcInputs.toLocaleString('fr-FR')} entrées PC`);
          }
          if (typeof c.minCareActions === 'number') {
            parts.push(`≥ ${c.minCareActions} soins`);
          }
          if (typeof c.maxCareMistakes === 'number') {
            parts.push(`≤ ${c.maxCareMistakes} erreur(s)`);
          }
          if (typeof c.minHappiness === 'number') {
            parts.push(`Bonheur ≥ ${c.minHappiness}%`);
          }
          if (typeof c.minGamesPlayed === 'number') {
            parts.push(`≥ ${c.minGamesPlayed} mini-jeux`);
          }
          if (c.preferredFoodCategory) {
            parts.push(`Repas favori : ${FOOD_CATEGORY_LABELS[c.preferredFoodCategory]}`);
          } else if (c.allowedCategories && c.allowedCategories.length > 0) {
            parts.push(
              `Repas : ${c.allowedCategories
                .map((cat) => FOOD_CATEGORY_LABELS[cat])
                .join(' / ')}`
            );
          }
          return parts.join(' • ');
        }
      }
    }
    return 'Évolution spéciale';
  }

  private formatAge(ageSeconds: number): string {
    const totalMinutes = Math.floor(ageSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const secs = Math.floor(ageSeconds % 60);

    if (hours > 0) {
      return `${hours} h ${mins} min`;
    }
    if (mins > 0) {
      return `${mins} min ${secs} s`;
    }
    return `${secs} s`;
  }

  private getFavoriteFoodCategoryLabel(pet: PetState): string {
    const counts = pet.careStats.foodCategoryCounts;
    let bestCat: FoodCategory | null = null;
    let bestCount = 0;

    (Object.keys(counts) as FoodCategory[]).forEach((cat) => {
      if (counts[cat] > bestCount) {
        bestCount = counts[cat];
        bestCat = cat;
      }
    });

    return bestCat ? `${FOOD_CATEGORY_LABELS[bestCat]} (${bestCount})` : 'Aucune';
  }

  private populateDisplaysSelect(): void {
    const selectEl = document.getElementById('select-display') as HTMLSelectElement | null;
    if (!selectEl) {
      return;
    }
    selectEl.innerHTML = '';

    const preferredId = this.engine.getSaveData().settings.preferredDisplayId;
    for (const disp of this.displays) {
      const opt = document.createElement('option');
      opt.value = String(disp.id);
      opt.textContent = `${disp.label}${disp.isPrimary ? ' (Principal)' : ''} — ${disp.workArea.width}×${disp.workArea.height}`;
      if (preferredId === disp.id || (preferredId === null && disp.isPrimary)) {
        opt.selected = true;
      }
      selectEl.appendChild(opt);
    }
  }

  private syncSettingsControls(): void {
    const save = this.engine.getSaveData();
    const settings = save.settings;

    const autoStartEl = document.getElementById('toggle-autostart') as HTMLInputElement | null;
    if (autoStartEl) {
      autoStartEl.checked = settings.autoStartEnabled;
    }

    const notifEl = document.getElementById('toggle-notifications') as HTMLInputElement | null;
    if (notifEl) {
      notifEl.checked = settings.notificationsEnabled;
    }

    const windowJumpEl = document.getElementById('toggle-window-jump') as HTMLInputElement | null;
    if (windowJumpEl) {
      windowJumpEl.checked = settings.windowJumpEnabled ?? true;
    }

    const nameInputEl = document.getElementById('input-pet-name') as HTMLInputElement | null;
    if (nameInputEl) {
      nameInputEl.value = save.pet.name;
    }

    const scaleButtons = document.querySelectorAll<HTMLButtonElement>('#scale-selector .seg-btn');
    scaleButtons.forEach((btn) => {
      const val = Number(btn.dataset.scale);
      btn.classList.toggle('active', Math.abs(val - settings.petScale) < 0.02);
    });
  }

  private updateUserSetting(partial: Partial<BootstrapPayload['saveData']['settings']>): void {
    if (partial.windowJumpEnabled !== undefined) {
      this.petActor.setWindowJumpEnabled(partial.windowJumpEnabled);
    }
    this.engine.updateSettings(partial);
    void window.petAPI?.updateSettings(partial);
    void this.persistSaveState();
  }

  private showSpeechBubble(text: string, durationMs: number = 3200): void {
    if (!this.speechBubbleEl || !this.speechTextEl) {
      return;
    }
    this.speechTextEl.textContent = text;
    this.speechBubbleEl.classList.remove('hidden');
    this.updateFloatingPanelsPosition();

    if (this.speechHideTimeout !== null) {
      window.clearTimeout(this.speechHideTimeout);
    }
    this.speechHideTimeout = window.setTimeout(() => {
      this.speechBubbleEl?.classList.add('hidden');
      this.speechHideTimeout = null;
    }, durationMs);
  }

  /**
   * Positionne dynamiquement la bulle de dialogue et le panneau HUD.
   * Si le menu HUD est ouvert, la bulle est décalée au-dessus du menu (ou sous le pet)
   * pour ne JAMAIS être masquée ou cachée derrière le menu.
   */
  private updateFloatingPanelsPosition(): void {
    if (!this.petActor) {
      return;
    }
    const isHudOpen = Boolean(this.hudEl && !this.hudEl.classList.contains('hidden'));
    const isSpeechVisible = Boolean(this.speechBubbleEl && !this.speechBubbleEl.classList.contains('hidden'));

    if (!isHudOpen && !isSpeechVisible) {
      return;
    }

    const petHalf = this.petActor.getDrawSize() / 2;
    let hudLeft = 0;
    let hudTop = 0;
    let hudWidth = 332;
    let hudHeight = 250;

    if (isHudOpen && this.hudEl) {
      hudWidth = this.hudEl.offsetWidth || 332;
      hudHeight = this.hudEl.offsetHeight || 250;

      hudLeft = Math.min(
        window.innerWidth - hudWidth - 16,
        Math.max(16, Math.round(this.petActor.x - hudWidth / 2))
      );
      hudTop = Math.max(
        16,
        Math.min(
          window.innerHeight - hudHeight - 16,
          Math.round(this.petActor.y - petHalf - hudHeight - 20)
        )
      );

      this.hudEl.style.left = `${hudLeft}px`;
      this.hudEl.style.top = `${hudTop}px`;
    }

    if (isSpeechVisible && this.speechBubbleEl) {
      let bubbleX = Math.min(
        window.innerWidth - 120,
        Math.max(120, Math.round(this.petActor.x))
      );
      let bubbleY = 0;
      let isFlipped = false;

      // Si le menu HUD est ouvert, on décale impérativement la bulle pour qu'elle reste toujours visible et au premier plan
      if (isHudOpen) {
        if (hudTop >= 50) {
          // Assez d'espace au-dessus du menu HUD : bulle au-dessus du menu !
          bubbleY = Math.round(hudTop - 12);
          bubbleX = Math.min(
            window.innerWidth - 120,
            Math.max(120, Math.round(hudLeft + hudWidth / 2))
          );
        } else {
          // Si le menu touche le haut de l'écran, on place la bulle sous le familier
          bubbleY = Math.min(
            window.innerHeight - 34,
            Math.round(this.petActor.y + petHalf + 24)
          );
          isFlipped = true;
        }
      } else {
        // Menu HUD fermé :
        // Si le familier est perché sur une fenêtre ou se trouve près du haut de l'écran,
        // l'espace au-dessus est trop restreint et masquerait le familier.
        // On place alors intelligemment la bulle EN DESSOUS du familier !
        if (this.petActor.y - petHalf < 68) {
          bubbleY = Math.min(
            window.innerHeight - 34,
            Math.round(this.petActor.y + petHalf + 22)
          );
          isFlipped = true;
        } else {
          bubbleY = Math.max(44, Math.round(this.petActor.y - petHalf - 14));
          isFlipped = false;
        }
      }

      if (isFlipped) {
        this.speechBubbleEl.classList.add('bubble-flipped');
      } else {
        this.speechBubbleEl.classList.remove('bubble-flipped');
      }

      this.speechBubbleEl.style.left = `${bubbleX}px`;
      this.speechBubbleEl.style.top = `${bubbleY}px`;
    }
  }

  public setDevEdition(enabled: boolean): void {
    this.isDevEdition = enabled;
    const btn = document.getElementById('btn-action-sandbox');
    if (btn) {
      if (enabled) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
    if (enabled) {
      this.renderSandboxLineagesGrid();
      this.refreshSandboxMetricsUI();
    }
  }

  private openSandboxModal(): void {
    this.hideHudPanel();
    this.petActor.stopWalking();
    this.statsModalEl?.classList.add('hidden');
    this.shopModalEl?.classList.add('hidden');
    this.onlineModalEl?.classList.add('hidden');
    this.refreshSandboxMetricsUI();
    this.renderSandboxLineagesGrid();
    this.sandboxModalEl?.classList.remove('hidden');
    this.hitTester.refresh();
  }

  private closeSandboxModal(): void {
    this.sandboxModalEl?.classList.add('hidden');
    this.hitTester.refresh();
  }

  private toggleSandboxModal(): void {
    if (this.sandboxModalEl?.classList.contains('hidden')) {
      this.openSandboxModal();
    } else {
      this.closeSandboxModal();
    }
  }

  private applySandboxForm(formId: FormId, customSpeech?: string): void {
    this.engine.forceSetForm(formId, Date.now());
    const formDef = this.engine.getCurrentSpeciesForm();
    if (formDef) {
      const userScale = this.engine.getSaveData().settings.petScale ?? 1;
      this.petActor.setScales(formDef.scale, userScale);
      this.petActor.setWalkSpeed(formDef.walkSpeed);
    }
    this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 10);
    this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 6);
    this.animator.setState('happy', 2500);

    const speech =
      customSpeech ||
      `Transformation Sandbox : je suis devenu ${formDef?.name ?? formId} ! 🧪✨`;
    this.showSpeechBubble(speech, 3500);

    this.refreshAllPanelsUI();
    void this.persistSaveState();
  }

  private runSandboxSimulation(type: SandboxConditionType, speechMsg: string): void {
    this.engine.simulateCondition(type, Date.now());

    switch (type) {
      case 'dirty':
        this.animator.spawnParticles('crumb', this.petActor.x, this.petActor.y, 10);
        this.animator.setState('sad', 3000);
        break;
      case 'hungry':
        this.animator.spawnParticles('crumb', this.petActor.x, this.petActor.y, 8);
        this.animator.setState('sad', 3000);
        break;
      case 'need_cuddle':
        this.animator.spawnParticles('heart', this.petActor.x, this.petActor.y, 8);
        this.animator.setState('sad', 3000);
        break;
      case 'need_play':
        this.animator.spawnParticles('tennis', this.petActor.x, this.petActor.y, 6);
        this.animator.setState('idle', 1000);
        break;
      case 'tired':
        this.animator.spawnParticles('zzz', this.petActor.x, this.petActor.y, 6);
        this.animator.setState('sleep', 4000);
        break;
      case 'full_restore':
        this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 12);
        this.animator.spawnParticles('confetti', this.petActor.x, this.petActor.y, 8);
        this.animator.setState('happy', 3000);
        break;
      case 'boost_marathon':
        this.animator.spawnParticles('keyboard', this.petActor.x, this.petActor.y, 8);
        this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 10);
        this.animator.setState('happy', 3000);
        break;
      case 'add_coins':
        this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 8);
        this.animator.setState('happy', 2500);
        break;
    }

    this.showSpeechBubble(speechMsg, 3500);
    this.refreshAllPanelsUI();
    void this.persistSaveState();
  }

  private refreshSandboxMetricsUI(): void {
    const pet = this.engine.getState();
    const stats = pet.careStats;

    const clicksEl = document.getElementById('sb-pc-clicks');
    if (clicksEl) clicksEl.textContent = (stats.pcMouseClicks ?? 0).toLocaleString('fr-FR');

    const keysEl = document.getElementById('sb-pc-keys');
    if (keysEl) keysEl.textContent = (stats.pcKeyPresses ?? 0).toLocaleString('fr-FR');

    const activeEl = document.getElementById('sb-pc-active');
    if (activeEl) {
      const sec = Math.round(stats.pcActiveSeconds ?? 0);
      if (sec < 60) {
        activeEl.textContent = `${sec} s`;
      } else if (sec < 3600) {
        activeEl.textContent = `${Math.floor(sec / 60)}m ${sec % 60}s`;
      } else {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        activeEl.textContent = `${h}h ${m}m`;
      }
    }

    const careEl = document.getElementById('sb-care-total');
    if (careEl) careEl.textContent = String(this.getTotalCareActions(pet));

    const eggEl = document.getElementById('sb-egg-clicks');
    if (eggEl) {
      const required = this.engine.getConfig().eggClicksRequired || 5;
      eggEl.textContent = `${stats.eggClicks ?? 0} / ${required}`;
    }

    const ageEl = document.getElementById('sb-pet-age');
    if (ageEl) {
      const sec = Math.round(pet.ageSeconds);
      if (sec < 60) {
        ageEl.textContent = `${sec} s`;
      } else if (sec < 3600) {
        ageEl.textContent = `${Math.floor(sec / 60)} min`;
      } else {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        ageEl.textContent = `${h}h ${m}m`;
      }
    }
  }

  private renderSandboxLineagesGrid(): void {
    const container = document.getElementById('sandbox-lineages-container');
    if (!container) return;
    container.innerHTML = '';

    const pet = this.engine.getState();
    const allSpecies = this.engine.getSpecies();

    const lineageGroups: { id: LineageId; title: string; forms: SpeciesFormDefinition[] }[] = [
      {
        id: 'none',
        title: '🥚 Stade Origine (Œuf)',
        forms: allSpecies.filter((s) => s.lineage === 'none' || s.id === 'egg'),
      },
      {
        id: 'aqua',
        title: "💧 Lignée Aquatique (P'tit Goutte)",
        forms: allSpecies.filter((s) => s.lineage === 'aqua' && s.id !== 'egg'),
      },
      {
        id: 'flora',
        title: "🌱 Lignée Végétale (P'tit Bourgeon)",
        forms: allSpecies.filter((s) => s.lineage === 'flora' && s.id !== 'egg'),
      },
      {
        id: 'ember',
        title: "🔥 Lignée Embrasée (P'tite Braise)",
        forms: allSpecies.filter((s) => s.lineage === 'ember' && s.id !== 'egg'),
      },
    ];

    for (const group of lineageGroups) {
      if (group.forms.length === 0) continue;

      const groupDiv = document.createElement('div');
      groupDiv.className = 'lineage-group';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'lineage-group-title';
      titleDiv.textContent = group.title;
      groupDiv.appendChild(titleDiv);

      const gridDiv = document.createElement('div');
      gridDiv.className = 'lineage-forms-grid';

      for (const form of group.forms) {
        const isCurrent = pet.formId === form.id;
        const card = document.createElement('div');
        card.className = `sandbox-form-card${isCurrent ? ' active-form' : ''}`;

        const leftDiv = document.createElement('div');
        leftDiv.className = 'sandbox-form-left';

        const canvas = document.createElement('canvas');
        canvas.width = 34;
        canvas.height = 34;
        canvas.className = 'sandbox-thumb-canvas';
        this.animator.drawFormThumbnail(canvas, form.id);
        leftDiv.appendChild(canvas);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'sandbox-form-meta';
        metaDiv.innerHTML = `
          <span class="sandbox-form-name">${form.name}${isCurrent ? ' (Actuel)' : ''}</span>
          <span class="sandbox-form-stage">${STAGE_LABELS[form.stage] ?? form.stage}</span>
        `;
        leftDiv.appendChild(metaDiv);
        card.appendChild(leftDiv);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sandbox-transform-btn';
        btn.textContent = isCurrent ? 'Actif' : 'Choisir';
        btn.dataset.formId = form.id;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.applySandboxForm(form.id);
        });

        card.appendChild(btn);
        card.addEventListener('click', () => {
          this.applySandboxForm(form.id);
        });

        gridDiv.appendChild(card);
      }

      groupDiv.appendChild(gridDiv);
      container.appendChild(groupDiv);
    }
  }

  private bindSandboxEvents(): void {
    // Bouton de fermeture
    document.getElementById('btn-close-sandbox')?.addEventListener('click', () => {
      this.closeSandboxModal();
    });

    // 1) Starters
    document.getElementById('btn-sb-starter-egg')?.addEventListener('click', () => {
      this.applySandboxForm('egg', "🥚 Réinitialisé en œuf ! Cliquez 5 fois dessus pour le faire éclore !");
    });
    document.getElementById('btn-sb-starter-aqua')?.addEventListener('click', () => {
      this.applySandboxForm('baby_aqua', "💧 Starter Eau sélectionné : P'tit Goutte !");
    });
    document.getElementById('btn-sb-starter-flora')?.addEventListener('click', () => {
      this.applySandboxForm('baby_flora', "🌱 Starter Plante sélectionné : P'tit Bourgeon !");
    });
    document.getElementById('btn-sb-starter-ember')?.addEventListener('click', () => {
      this.applySandboxForm('baby_ember', "🔥 Starter Feu sélectionné : P'tite Braise !");
    });
    document.getElementById('btn-sb-starter-random')?.addEventListener('click', () => {
      const idx = Math.floor(Math.random() * STARTER_FORM_IDS.length);
      const randomStarter = STARTER_FORM_IDS[idx] || 'baby_aqua';
      this.applySandboxForm(randomStarter, "🎲 Éclosion aléatoire immédiate !");
    });

    // 2) Simulations de besoins
    document.getElementById('btn-sb-sim-hungry')?.addEventListener('click', () => {
      this.runSandboxSimulation('hungry', "🍖 Faim simulée (15%) ! Le familier réclame à manger !");
    });
    document.getElementById('btn-sb-sim-dirty')?.addEventListener('click', () => {
      this.runSandboxSimulation('dirty', "🧽 Saleté simulée (15% + 3 crottes) ! L'éponge est prête !");
    });
    document.getElementById('btn-sb-sim-cuddle')?.addEventListener('click', () => {
      this.runSandboxSimulation('need_cuddle', "🤗 Demande de câlin activée !");
    });
    document.getElementById('btn-sb-sim-play')?.addEventListener('click', () => {
      this.runSandboxSimulation('need_play', "🎾 Demande de jeu activée !");
    });
    document.getElementById('btn-sb-sim-tired')?.addEventListener('click', () => {
      this.runSandboxSimulation('tired', "💤 Fatigue simulée (12% énergie) !");
    });
    document.getElementById('btn-sb-sim-marathon')?.addEventListener('click', () => {
      this.runSandboxSimulation('boost_marathon', "⌨️ Boost marathon appliqué : +15 000 clics/touches PC & +40h !");
    });
    document.getElementById('btn-sb-add-coins')?.addEventListener('click', () => {
      this.runSandboxSimulation('add_coins', "🪙 +1 000 TamaCoins ajoutés à votre tirelire !");
    });
    document.getElementById('btn-sb-jump-window')?.addEventListener('click', () => {
      const jumped = this.petActor.forcePerchOnActiveWindow();
      if (!jumped) {
        this.showSpeechBubble("Aucune fenêtre active détectée sous Windows pour y sauter !", 3000);
      }
    });
    document.getElementById('btn-sb-toggle-music')?.addEventListener('click', () => {
      this.toggleMusicMode();
    });
    document.getElementById('btn-sb-sim-restore')?.addEventListener('click', () => {
      this.runSandboxSimulation('full_restore', "✨ Toutes les jauges ont été restaurées à 100% !");
    });

    // 3) Évolution forcée
    document.getElementById('btn-sb-force-evolve')?.addEventListener('click', () => {
      const res = this.engine.forceEvolve(undefined, Date.now());
      if (res.evolved && res.newForm) {
        this.handleEvolutionTriggered(res.newForm);
        this.refreshAllPanelsUI();
        void this.persistSaveState();
      } else {
        this.showSpeechBubble("Aucune évolution ultérieure pour cette forme !", 3000);
      }
    });
  }

  private async persistSaveState(): Promise<void> {
    if (!window.petAPI) {
      return;
    }
    try {
      await window.petAPI.saveState(this.engine.getSaveData(Date.now()));
    } catch {
      // Ignoré silencieusement côté UI
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new DesktopPetRendererApp();
  void app.init();
});
