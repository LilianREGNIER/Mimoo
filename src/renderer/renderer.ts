/**
 * Point d'entrée principal du processus Renderer (`src/renderer/renderer.ts`).
 * Orchestre `PetEngine`, la boucle de rendu Canvas 2D à FPS adaptatif (30 FPS actif / 5 FPS repos),
 * le click-through sélectif (`HitTester`), les déplacements (`PetActor`), les 2 mini-jeux et l'UI.
 */

import defaultFoodsJson from '../../data/foods.json';
import defaultGameConfigJson from '../../data/game-config.json';
import defaultSpeciesJson from '../../data/species.json';
import {
  createInitialSaveData,
  PetEngine,
  type BootstrapPayload,
  type DisplayBoundsInfo,
  type FoodCategory,
  type FoodItem,
  type FormId,
  type GameConfig,
  type MiniGameResult,
  type NeedKey,
  type PetState,
  type SpeciesFormDefinition,
  type TrayActionType,
} from '../core';
import { HitTester } from './hitTester';
import { MiniGamesController } from './miniGames';
import { PetActor } from './petActor';
import { SpriteAnimator } from './spriteAnimator';

const STAGE_LABELS: Record<string, string> = {
  egg: 'Œuf',
  baby: 'Bébé',
  child: 'Enfant',
  adult: 'Adulte',
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
    speech: "Je tombe de fatigue... Zzz 💤",
  },
  happiness: {
    title: 'Votre familier se sent seul ! 💖',
    speech: "On joue ensemble ? J'ai besoin d'un câlin 🥺",
  },
  cleanliness: {
    title: 'Un petit nettoyage est nécessaire ! ✨',
    speech: "Mon espace a besoin d'un coup de balai ! 🧹",
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
  private displays: DisplayBoundsInfo[] = [];

  // Cadence de rendu adaptative (30 FPS actif / 5 FPS éco repos)
  private isActiveFpsMode = true;
  private currentTargetFps = 30;
  private lastFrameTimestamp = 0;
  private lastLogicTickTimestamp = 0;
  private lastAutoSaveTimestamp = 0;
  private lastNotificationTimestamp = 0;
  private speechHideTimeout: number | null = null;

  // Références DOM principales
  private readonly hudEl = document.getElementById('pet-hud');
  private readonly drawerFoodsEl = document.getElementById('drawer-foods');
  private readonly drawerGamesEl = document.getElementById('drawer-games');
  private readonly statsModalEl = document.getElementById('stats-modal');
  private readonly speechBubbleEl = document.getElementById('pet-speech-bubble');
  private readonly speechTextEl = document.getElementById('pet-speech-text');

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
    });

    // 2. Initialisation du moteur de spritesheets
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
      onClick: () => this.toggleHudPanel(),
      onPetRub: (x, y) => this.handlePetAction(x, y, true),
      onPositionChanged: (x, y) => {
        this.engine.setPosition({ x, y });
        this.updateFloatingPanelsPosition();
        void this.persistSaveState();
      },
    });

    this.petActor.setScales(initialSpecies?.scale ?? 1, settings.petScale ?? 1);
    this.petActor.setWalkSpeed(initialSpecies?.walkSpeed ?? 0);

    // 4. Initialisation des 2 mini-jeux
    this.miniGames = new MiniGamesController(this.petActor, this.animator, {
      onGameComplete: (result) => this.handleMiniGameComplete(result),
      onSpeech: (msg) => this.showSpeechBubble(msg),
      onUiStateChanged: () => this.hitTester?.refresh(),
    });

    // 5. Initialisation du HitTester pour le click-through sélectif
    this.hitTester = new HitTester({
      petActor: this.petActor,
      isPointOverMiniGameStar: (cx, cy) => this.miniGames.isPointOverStar(cx, cy),
    });

    // 6. Construction des listes dynamiques et écouteurs d'événements UI / IPC
    this.renderFoodsDrawerList();
    this.populateDisplaysSelect();
    this.syncSettingsControls();
    this.bindPointerAndDomEvents();
    this.bindIpcListeners();

    this.refreshHudUI();
    this.hitTester.evaluateAt(-1000, -1000);

    // Message d'accueil ou de retour hors-ligne
    if (payload.offlineReport && payload.offlineReport.elapsedMs > 120_000) {
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
   * - Mode actif (~30 FPS) : marche, interaction souris, mini-jeu, animation temporaire, menu ouvert.
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
   */
  private updateAdaptiveFpsTarget(): void {
    const pet = this.engine.getState();
    const settings = this.engine.getSaveData().settings;

    const isAnyMenuOpen =
      !this.hudEl?.classList.contains('hidden') ||
      !this.statsModalEl?.classList.contains('hidden');

    const isSpeechVisible = !this.speechBubbleEl?.classList.contains('hidden');

    const isActive =
      this.petActor.isMoving ||
      this.petActor.isDragging ||
      this.petActor.isHovering ||
      this.miniGames.isPlaying() ||
      this.animator.isInTemporaryAnimation() ||
      this.animator.hasActiveParticles() ||
      isAnyMenuOpen ||
      isSpeechVisible;

    // Respecte la consigne stricte : ~30 FPS actif / 5 FPS repos
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
   * décrémente les besoins, vérifie l'évolution, envoie les alertes critiques et sauvegarde périodiquement.
   */
  private runOneSecondLogicTick(deltaSeconds: number): void {
    const prevFormId = this.engine.getState().formId;
    const tickResult = this.engine.tick(deltaSeconds, Date.now());
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
    if (tickResult.criticalNeeds.length > 0) {
      const now = Date.now();
      if (now - this.lastNotificationTimestamp > 180_000) {
        this.lastNotificationTimestamp = now;
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

    const canWalk =
      pet.stage !== 'egg' &&
      !pet.isSleeping &&
      !this.animator.isInTemporaryAnimation() &&
      this.miniGames.getActiveGame() !== 'rps_duel';

    this.petActor.update(dtSeconds, { canWalk });
    this.miniGames.update(dtSeconds);

    this.animator.update(dtSeconds, {
      isSleeping: pet.isSleeping,
      isCritical: criticalNeeds.length > 0 || pet.poopCount >= 3,
      isMoving: this.petActor.isMoving,
      isPlayingGame: this.miniGames.isPlaying(),
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
    });

    this.miniGames.render(this.ctx);
  }

  private bindPointerAndDomEvents(): void {
    // Événements globaux de souris sur la fenêtre pour le HitTester et le familier
    window.addEventListener('mousemove', (e) => {
      this.hitTester.evaluateAt(e.clientX, e.clientY);
      this.petActor.handlePointerMove(e.clientX, e.clientY);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.miniGames.handleCanvasMouseDown(e.clientX, e.clientY)) {
        return;
      }
      this.petActor.handlePointerDown(e.clientX, e.clientY, e.button);
    });

    window.addEventListener('mouseup', () => {
      this.petActor.handlePointerUp();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeAllPanels();
      }
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

    // 6 Actions principales du HUD
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
      case 'open-compendium':
        this.openStatsModal('tab-compendium');
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
      if (result.reason === 'stage_egg') {
        this.showSpeechBubble("Un œuf n'a pas encore de bouche ! 🥚");
      } else if (result.reason === 'pet_sleeping') {
        this.showSpeechBubble('Il dort profondément... Réveille-le pour manger 💤');
      } else if (result.reason === 'already_full') {
        this.showSpeechBubble("Je suis déjà complètement rassasié ! 😋");
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

    this.refreshHudUI();
    void this.persistSaveState();
  }

  private handlePetAction(x: number, y: number, fromCursorRub: boolean): void {
    const pet = this.engine.getState();
    if (pet.isSleeping) {
      if (!fromCursorRub) {
        this.showSpeechBubble('Il sourit dans son sommeil... Zzz 💤');
      }
      return;
    }

    const result = this.engine.pet(Date.now());
    this.animator.setState('happy', 1300);
    this.animator.spawnParticles('heart', x, y, result.bonusApplied ? 5 : 2);

    if (result.bonusApplied) {
      this.showSpeechBubble('Ronron... J’adore les caresses ! 💖');
      this.refreshHudUI();
      void this.persistSaveState();
    } else if (!fromCursorRub) {
      this.showSpeechBubble('Encore des câlins ! 🤗');
    }
  }

  private handleToggleSleep(): void {
    const pet = this.engine.getState();
    if (pet.stage === 'egg') {
      this.showSpeechBubble("L'œuf se repose déjà au chaud ! 🥚");
      return;
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

    this.refreshHudUI();
    void this.persistSaveState();
  }

  private handleCleanAction(): void {
    const result = this.engine.clean(Date.now());
    this.animator.setState('happy', 1300);
    this.animator.spawnParticles('clean', this.petActor.x, this.petActor.y, 5);
    this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 4);

    if (result.cleaned) {
      this.showSpeechBubble('Tout propre et étincelant ! ✨');
    } else {
      this.showSpeechBubble('C’est déjà impeccable ici ! ✨');
    }

    this.refreshHudUI();
    void this.persistSaveState();
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

    this.refreshHudUI();
    void this.persistSaveState();
  }

  private handleEvolutionTriggered(newForm: SpeciesFormDefinition): void {
    const settings = this.engine.getSaveData().settings;
    this.petActor.setScales(newForm.scale, settings.petScale);
    this.petActor.setWalkSpeed(newForm.walkSpeed);

    this.animator.setState('evolve', 2800);
    this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 10);
    this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 6);

    const msg = `Évolution en ${newForm.name} ! ✨`;
    this.showSpeechBubble(msg, 5000);
    if (settings.notificationsEnabled) {
      void window.petAPI?.notifyCriticalNeed('Évolution ! ✨', msg);
    }

    this.refreshHudUI();
    this.refreshStatsAndCompendiumUI();
    void this.persistSaveState();
  }

  private async handleResetPet(): Promise<void> {
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

    const species = this.engine.getCurrentSpeciesForm();
    const settings = this.engine.getSaveData().settings;
    this.petActor.setScales(species?.scale ?? 1, settings.petScale);
    this.petActor.setWalkSpeed(species?.walkSpeed ?? 0);
    this.petActor.centerOnScreen();

    this.animator.setState('evolve', 1800);
    this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 8);
    this.showSpeechBubble(`Un nouvel œuf (${customName}) vient d'apparaître ! 🥚✨`, 4000);

    this.refreshHudUI();
    this.refreshStatsAndCompendiumUI();
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
    this.hitTester.refresh();
  }

  private openStatsModal(initialTabId: string): void {
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
      `${pet.careStats.totalPets} 🤗 • ${pet.careStats.totalCleans} 🧹`
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

    // Rendu de la galerie Compendium (7 formes)
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
              : 'Continuez à prendre soin de votre familier pour découvrir cette forme.'
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
          const parts: string[] = [
            `Depuis ${parentForm.name}`,
            `Âge ≥ ${Math.round(c.minAgeSeconds / 60)} min`,
          ];
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
   * Positionne dynamiquement la bulle de dialogue et le panneau HUD au-dessus du familier.
   */
  private updateFloatingPanelsPosition(): void {
    if (!this.petActor) {
      return;
    }
    const petHalf = this.petActor.getDrawSize() / 2;

    if (this.speechBubbleEl && !this.speechBubbleEl.classList.contains('hidden')) {
      const bubbleX = Math.min(
        window.innerWidth - 110,
        Math.max(110, Math.round(this.petActor.x))
      );
      const bubbleY = Math.max(44, Math.round(this.petActor.y - petHalf - 14));
      this.speechBubbleEl.style.left = `${bubbleX}px`;
      this.speechBubbleEl.style.top = `${bubbleY}px`;
    }

    if (this.hudEl && !this.hudEl.classList.contains('hidden')) {
      const hudWidth = this.hudEl.offsetWidth || 320;
      const hudHeight = this.hudEl.offsetHeight || 220;

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
