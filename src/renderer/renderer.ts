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
  type BootstrapPayload,
  type CosmeticItem,
  type DisplayBoundsInfo,
  type FoodCategory,
  type FoodItem,
  type FormId,
  type FriendPetProfile,
  type GameConfig,
  type LineageId,
  type MiniGameResult,
  type NeedKey,
  type PetState,
  type SpeciesFormDefinition,
  type StarterFormId,
  type TrayActionType,
} from '../core';
import { HitTester } from './hitTester';
import { MiniGamesController } from './miniGames';
import { OnlineManager } from './onlineManager';
import { PetActor } from './petActor';
import { SpriteAnimator } from './spriteAnimator';

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
  private readonly shopModalEl = document.getElementById('shop-modal');
  private readonly onlineModalEl = document.getElementById('online-modal');

  // Dialogues spontanés ("de temps en temps, juste comme ça")
  private lastAutonomousDialogueTimestamp = performance.now();
  private nextAutonomousDialogueDelayMs = 24_000 + Math.random() * 26_000;
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
    });

    this.petActor.setScales(initialSpecies?.scale ?? 1, settings.petScale ?? 1);
    this.petActor.setWalkSpeed(initialSpecies?.walkSpeed ?? 0);

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
    });

    // 6. Construction des listes dynamiques et écouteurs d'événements UI / IPC
    this.renderFoodsDrawerList();
    this.populateDisplaysSelect();
    this.syncSettingsControls();
    this.initDraggableShopModal();
    this.bindPointerAndDomEvents();
    this.bindIpcListeners();

    this.refreshHudUI();
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

    // Détermination du mode FPS adaptatif (30 FPS actif vs 5 FPS repos)
    this.updateAdaptiveFpsTarget();
    const frameIntervalMs = 1000 / this.currentTargetFps;
    const elapsedFrameMs = timestamp - this.lastFrameTimestamp;

    if (elapsedFrameMs < frameIntervalMs - 1) {
      return;
    }

    const dtSeconds = Math.min(0.25, elapsedFrameMs / 1000);
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
      !this.onlineModalEl?.classList.contains('hidden');

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

    const isActive =
      this.isSpongeMode ||
      this.petActor.isMoving ||
      this.petActor.isDragging ||
      this.petActor.isHovering ||
      this.miniGames.isPlaying() ||
      this.animator.isInTemporaryAnimation() ||
      this.animator.isEggShaking() ||
      this.animator.hasActiveParticles() ||
      isNeedAnimationActive ||
      isAnyMenuOpen ||
      isSpeechVisible;

    const configuredActive = Math.min(30, Math.max(24, settings.fpsLimitActive || 30));
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
    const tickResult = this.engine.tick(deltaSeconds, nowMs);
    const evoCheck = this.engine.checkEvolution();

    const evolved = tickResult.evolved || evoCheck.evolved;
    const newForm = tickResult.newForm ?? evoCheck.newForm;

    if (evolved && newForm && newForm.id !== prevFormId) {
      this.handleEvolutionTriggered(newForm);
    }

    // Synchronisation de la vitesse et de l'échelle avec la forme courante
    const currentSpecies = this.engine.getCurrentSpeciesForm();
    const settings = this.engine.getSaveData().settings;
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

    const pet = tickResult.pet;

    // Dialogues autonomes spontanés ("de temps en temps, juste comme ça")
    const isAnyMenuOpen =
      !this.hudEl?.classList.contains('hidden') ||
      !this.drawerFoodsEl?.classList.contains('hidden') ||
      !this.drawerGamesEl?.classList.contains('hidden') ||
      !this.statsModalEl?.classList.contains('hidden') ||
      !this.shopModalEl?.classList.contains('hidden') ||
      !this.onlineModalEl?.classList.contains('hidden');

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
      !this.drawerFoodsEl?.classList.contains('hidden') ||
      !this.drawerGamesEl?.classList.contains('hidden');

    if (isAnyMenuOpen) {
      this.petActor.stopWalking();
    }

    const canWalk =
      pet.stage !== 'egg' &&
      !pet.isSleeping &&
      !this.isSpongeMode &&
      !isAnyMenuOpen &&
      !this.animator.isInTemporaryAnimation() &&
      this.miniGames.getActiveGame() !== 'rps_duel' &&
      (this.miniGames.getActiveGame() === 'star_catch' || !hasPriorityNeedPose);

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

    this.miniGames.render(this.ctx);
  }

  private bindPointerAndDomEvents(): void {
    // Événements globaux de souris sur la fenêtre pour le HitTester et le familier
    window.addEventListener('mousemove', (e) => {
      this.hitTester.evaluateAt(e.clientX, e.clientY);
      this.petActor.handlePointerMove(e.clientX, e.clientY);
    });

    window.addEventListener('mousedown', () => {
      this.recordLocalOverlayInput(1, 0);
    });

    this.canvas.addEventListener('mousedown', (e) => {
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
      this.petActor.handlePointerUp();
    });

    window.addEventListener('keydown', (e) => {
      this.recordLocalOverlayInput(0, 1);

      if (e.key === 'Escape') {
        if (this.isSpongeMode) {
          this.stopSpongeMode();
        }
        this.closeAllPanels();
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

    window.petAPI?.onPcActivityBatch?.((batch) => {
      this.hasMainPcActivityHook = true;
      const res = this.engine.recordPcActivity(batch, Date.now());
      if (res.evolved && res.newForm) {
        this.handleEvolutionTriggered(res.newForm);
      }
      this.refreshHudUI();
      if (!this.statsModalEl?.classList.contains('hidden')) {
        this.refreshStatsAndCompendiumUI();
      }
    });
  }

  private recordLocalOverlayInput(mouseClicks: number, keyPresses: number): void {
    const now = Date.now();
    this.lastOverlayInputTimestamp = now;
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
      if (result.reason === 'egg_cannot_eat' || result.reason === 'stage_egg') {
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
    this.animator.setState('happy', 1300);
    this.animator.spawnParticles('heart', x, y, result.bonusApplied ? 5 : 3);

    if (result.bonusApplied) {
      this.showSpeechBubble('Ronron... J’adore les caresses ! 💖');
    } else if (!fromCursorRub) {
      this.showSpeechBubble('Merci pour ce câlin tout doux ! 🤗💖');
    }

    this.refreshAllPanelsUI();
    void this.persistSaveState();
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

    if (outcome.evolved && outcome.newForm) {
      this.handleEvolutionTriggered(outcome.newForm);
    } else if (result.won) {
      this.showSpeechBubble(
        `Victoire (${result.score}/${result.maxScore}) ! +${Math.round(outcome.happinessGain)} 💖`,
        3800
      );
    } else {
      this.showSpeechBubble(
        `Bien joué (${result.score}/${result.maxScore}) ! +${Math.round(outcome.happinessGain)} 💖`,
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
   * Déclenche un petit dialogue autonome et spontané du familier sur le bureau.
   */
  private triggerSpontaneousDialogue(): void {
    const pet = this.engine.getState();
    const hour = new Date().getHours();

    const generalQuotes = [
      `Il fait bon sur ce bureau avec toi, ${pet.name} veille au grain ! ✨`,
      'Tu travailles bien ? Pense à faire une pause et t’étirer un peu ! ☕',
      'J’adore regarder ta souris voyager sur l’écran ! 🐭',
      'Je garde un œil sur ton bureau pendant que tu es concentré ! 🛡️',
      'Un petit verre d’eau pour toi aussi ? Reste bien hydraté(e) ! 💧',
      'Qu’est-ce qu’on fait de beau aujourd’hui ? 🐾',
      'C’est tellement douillet ici sur ce bureau... (˘◡˘) 💕',
      'Tu tapes super vite sur ton clavier ! ⌨️✨',
      'Si tu as besoin d’une pause, je suis toujours prêt pour jouer ! 🎾',
      'La météo du bureau : 100% de mignonnerie garantie ! ☀️',
      'Chut... j’explore un nouveau recoin de l’écran ! 🗺️',
      'Merci de prendre si bien soin de moi ! 💖',
      'Petite sieste visuelle... non je rigole, je suis en pleine forme ! 🌟',
      'Regarde mes super petits pas de danse ! 💃',
      'Tu as toute mon admiration pour tes projets ! 🚀',
      'Je suis tellement bien installé à côté de toi ! 🍀',
    ];

    const timeQuotes: string[] = [];
    if (hour >= 6 && hour < 12) {
      timeQuotes.push(
        'Coucou ! Bien dormi ? Passe une merveilleuse journée ! 🌅',
        'Prêt pour une belle matinée productive ! ☀️',
        'Un bon petit café ou thé pour commencer la journée ? ☕'
      );
    } else if (hour >= 12 && hour < 18) {
      timeQuotes.push(
        'Courage pour ton après-midi ! Tu es formidable ! 🌟',
        'Une petite pause l’après-midi, ça fait toujours du bien ! 🍪',
        'Le temps passe vite quand on s’amuse sur le bureau ! ⏳'
      );
    } else if (hour >= 18 && hour < 23) {
      timeQuotes.push(
        'La journée touche à sa fin, repose tes yeux un peu ! 🌙',
        'Belle soirée ! On forme une sacrée équipe tous les deux ! ✨',
        'Une bonne soirée détente bien méritée ! 🛋️'
      );
    } else {
      timeQuotes.push(
        'Encore debout à cette heure ? N’oublie pas de dormir un peu ! 🌌😴',
        'Chut... tout le monde dort, mais moi je veille sur toi ! 🌙💤',
        'La nuit est paisible sur le bureau... 🌠'
      );
    }

    const allQuotes = [...generalQuotes, ...timeQuotes];
    const pickedQuote = allQuotes[Math.floor(Math.random() * allQuotes.length)];

    this.showSpeechBubble(pickedQuote, 3600);
    this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y - 15, 4);
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

    for (const food of this.engine.getFoods()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'food-item-btn';

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

      btn.innerHTML = `
        <span class="food-emoji">${food.icon}</span>
        <div class="food-details">
          <div class="food-title-row">
            <span class="food-name">${food.name}</span>
            <span class="food-effects">${effectsParts.join(' ')}</span>
          </div>
          <div class="food-desc">${food.description}</div>
        </div>
      `;

      btn.addEventListener('click', () => {
        this.handleFeedFood(food);
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
    this.hitTester.refresh();
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

    const ownedCountEl = document.getElementById('shop-owned-count');
    if (ownedCountEl) {
      ownedCountEl.textContent = String(pet.ownedCosmetics.length);
    }

    // Résumé de l'équipement actuel
    const summaryEl = document.getElementById('shop-equipped-summary');
    if (summaryEl) {
      summaryEl.classList.toggle('hidden', this.currentShopTab !== 'inventory');
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

    // Filtrage par onglet (Boutique ou Inventaire) et catégorie
    let itemsToDisplay = allCosmetics;
    if (this.currentShopTab === 'inventory') {
      itemsToDisplay = allCosmetics.filter((item) => pet.ownedCosmetics.includes(item.id));
    }

    if (this.currentShopCategory !== 'all') {
      itemsToDisplay = itemsToDisplay.filter((item) => item.slot === this.currentShopCategory);
    }

    if (itemsToDisplay.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'shop-empty-state';
      if (this.currentShopTab === 'inventory') {
        emptyDiv.innerHTML = `
          <div>🎒 Vous ne possédez aucun cosmétique dans cette catégorie pour l'instant.</div>
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
      return;
    }

    for (const item of itemsToDisplay) {
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
    }
  }

  private openOnlineModal(): void {
    this.hideHudPanel();
    this.petActor.stopWalking();
    this.statsModalEl?.classList.add('hidden');
    this.shopModalEl?.classList.add('hidden');
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
   * Positionne dynamiquement la bulle de dialogue, la jauge d'éponge et le panneau HUD au-dessus du familier.
   */
  private updateFloatingPanelsPosition(): void {
    if (!this.petActor) {
      return;
    }
    const petHalf = this.petActor.getDrawSize() / 2;

    if (this.speechBubbleEl && !this.speechBubbleEl.classList.contains('hidden')) {
      const bubbleX = Math.min(
        window.innerWidth - 120,
        Math.max(120, Math.round(this.petActor.x))
      );
      const bubbleY = Math.max(
        44,
        Math.round(this.petActor.y - petHalf - 46)
      );
      this.speechBubbleEl.style.left = `${bubbleX}px`;
      this.speechBubbleEl.style.top = `${bubbleY}px`;
    }

    if (this.hudEl && !this.hudEl.classList.contains('hidden')) {
      const hudWidth = this.hudEl.offsetWidth || 332;
      const hudHeight = this.hudEl.offsetHeight || 250;

      const left = Math.min(
        window.innerWidth - hudWidth - 16,
        Math.max(16, Math.round(this.petActor.x - hudWidth / 2))
      );
      const top = Math.max(
        16,
        Math.min(
          window.innerHeight - hudHeight - 16,
          Math.round(this.petActor.y - petHalf - hudHeight - 20)
        )
      );

      this.hudEl.style.left = `${left}px`;
      this.hudEl.style.top = `${top}px`;
    }
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
