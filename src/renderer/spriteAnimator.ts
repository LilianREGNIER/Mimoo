/**
 * Moteur d'animation par spritesheets (256x512 px, grille 4x8 de 64x64 px)
 * et système de particules & effets visuels sur Canvas 2D :
 * - Éclosion progressive de l'œuf (4 étapes de fissures + tremblement + confettis)
 * - Rendu visuel de la saleté sur le corps (taches de boue, effluves verdâtres, mouches)
 * - Curseur Éponge / Brosse savonneuse et bulles de mousse
 * - Bulles de pensée animées pour la faim (🍖/🍎), le besoin de câlin (🥺💖) et l'envie de jouer (🎾⭐)
 */

import type { AnimationState, FormId, StageId } from '../core/types';
import spritesManifestJson from '../../assets/sprites/sprites-manifest.json';

interface FrameAnchor {
  eyeX: number;
  eyeY: number;
  eyeSpan: number;
  headX: number;
  headY: number;
}

const FRAME_ANCHORS: Partial<Record<FormId, FrameAnchor[][]>> =
  (spritesManifestJson as unknown as { frameAnchors?: Partial<Record<FormId, FrameAnchor[][]>> }).frameAnchors ?? {};

export const SPRITE_FRAME_WIDTH = 64;
export const SPRITE_FRAME_HEIGHT = 64;
export const SPRITE_COLUMNS = 4;
export const SPRITE_ROWS = 8;

/** Correspondance entre un état d'animation et la ligne de la spritesheet (0 à 7). */
export const ANIMATION_ROW_MAP: Record<AnimationState, number> = {
  idle: 0,
  walk: 1,
  eat: 2,
  happy: 3,
  play: 3, // Ligne 'happy' avec halo lumineux dynamique
  sleep: 4,
  sad: 5,
  evolve: 3, // Ligne 'happy' avec halo d'évolution et étincelles
  hungry: 6, // Ligne 6 : se tient le ventre qui gargouille
  need_cuddle: 7, // Ligne 7 : bras tendus + yeux suppliants
  need_play: 7, // Ligne 7 avec rebond dynamique d'impatience
  cleaning: 3, // Ligne 3 'happy' avec bulles de savon
};

/** Durée d'affichage d'une frame (en secondes) selon l'état d'animation. */
const FRAME_DURATION_SECONDS: Record<AnimationState, number> = {
  idle: 0.35,
  walk: 0.14,
  eat: 0.18,
  happy: 0.15,
  play: 0.13,
  sleep: 0.55,
  sad: 0.38,
  evolve: 0.11,
  hungry: 0.22,
  need_cuddle: 0.24,
  need_play: 0.15,
  cleaning: 0.14,
};

export type ParticleKind =
  | 'heart'
  | 'zzz'
  | 'star'
  | 'sparkle'
  | 'crumb'
  | 'clean'
  | 'bubble'
  | 'foam'
  | 'egg_shard'
  | 'confetti'
  | 'water'
  | 'music'
  | 'coffee'
  | 'keyboard'
  | 'shield'
  | 'tennis'
  | 'sun';

export type DialoguePropType =
  | 'water_glass'
  | 'coffee_cup'
  | 'shield'
  | 'tennis_ball'
  | 'dance'
  | 'keyboard'
  | 'sun'
  | 'laptop'
  | 'headphones'
  | 'stretching';

export interface CanvasParticle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
  size: number;
  color: string;
  label: string;
}

export interface RenderPetParams {
  ctx: CanvasRenderingContext2D;
  formId: FormId;
  x: number;
  y: number;
  groundY: number;
  scale: number;
  flipX: boolean;
  poopCount: number;
  cleanliness: number;
  cleaningProgress: number;
  eggClicks: number;
  isSpongeMode?: boolean;
  cursorX?: number;
  cursorY?: number;
  equippedCosmetics?: {
    hat: string | null;
    accessory: string | null;
    aura: string | null;
  };
  dragScaleX?: number;
  dragScaleY?: number;
  dragAngle?: number;
}

export const ALL_FORMS: readonly FormId[] = [
  'egg',
  // Lignée Aquatique
  'baby_aqua',
  'child_aqua',
  'adult_aqua_coral',
  'adult_aqua_leviathan',
  'adult_aqua_pearl',
  'adult_aqua_abyss',
  // Lignée Sylvestre
  'baby_flora',
  'child_flora',
  'adult_flora_bloom',
  'adult_flora_raptor',
  'adult_flora_truffle',
  'adult_flora_thorn',
  // Lignée Astrale
  'baby_ember',
  'child_ember',
  'adult_ember_solar',
  'adult_ember_comet',
  'adult_ember_magma',
  'adult_ember_eclipse',
];

export interface FormCosmeticAnchor {
  hatOffset: { x: number; y: number; scale?: number };
  accOffset: { x: number; y: number; scale?: number };
  auraRadius?: number;
}

/**
 * Coordonnées d'ancrage précises (en unités de pixels du sprite 32x32) pour que les chapeaux,
 * accessoires (lunettes, blush...) et auras s'ajustent parfaitement à l'anatomie de chaque pet.
 */
export const COSMETIC_ANCHORS: Record<string, FormCosmeticAnchor> = {
  baby_aqua: {
    hatOffset: { x: 0, y: -7.5, scale: 0.85 },
    accOffset: { x: 0, y: 1.0, scale: 0.88 },
    auraRadius: 18,
  },
  baby_flora: {
    hatOffset: { x: 0, y: -7.2, scale: 0.85 },
    accOffset: { x: 0, y: 0.2, scale: 0.88 },
    auraRadius: 18,
  },
  baby_ember: {
    hatOffset: { x: 0, y: -8.5, scale: 0.85 },
    accOffset: { x: 0, y: 0.0, scale: 0.88 },
    auraRadius: 18,
  },
  child_aqua: {
    hatOffset: { x: 0, y: -8.0, scale: 0.95 },
    accOffset: { x: 0, y: -1.0, scale: 0.95 },
    auraRadius: 22,
  },
  child_flora: {
    hatOffset: { x: 1.2, y: -9.8, scale: 0.92 },
    accOffset: { x: 1.2, y: -4.0, scale: 0.92 },
    auraRadius: 22,
  },
  child_ember: {
    hatOffset: { x: 0, y: -8.8, scale: 0.92 },
    accOffset: { x: 0, y: -1.0, scale: 0.92 },
    auraRadius: 22,
  },
  adult_aqua_coral: {
    hatOffset: { x: 0, y: -9.5, scale: 0.95 },
    accOffset: { x: 0, y: -3.0, scale: 0.92 },
    auraRadius: 25,
  },
  adult_aqua_leviathan: {
    hatOffset: { x: 0, y: -11.5, scale: 1.0 },
    accOffset: { x: 0, y: -5.8, scale: 1.05 },
    auraRadius: 27,
  },
  adult_aqua_pearl: {
    hatOffset: { x: 0, y: -9.8, scale: 1.05 },
    accOffset: { x: 0, y: 1.0, scale: 1.05 },
    auraRadius: 26,
  },
  adult_aqua_abyss: {
    hatOffset: { x: 0, y: -9.2, scale: 1.0 },
    accOffset: { x: 0, y: -1.0, scale: 1.05 },
    auraRadius: 26,
  },
  adult_flora_bloom: {
    hatOffset: { x: 0, y: -9.5, scale: 0.92 },
    accOffset: { x: 0, y: -3.0, scale: 0.95 },
    auraRadius: 26,
  },
  adult_flora_raptor: {
    hatOffset: { x: 1.5, y: -10.2, scale: 0.95 },
    accOffset: { x: 1.5, y: -4.0, scale: 0.95 },
    auraRadius: 26,
  },
  adult_flora_truffle: {
    hatOffset: { x: 0, y: -10.2, scale: 1.15 },
    accOffset: { x: 0, y: -1.0, scale: 1.0 },
    auraRadius: 26,
  },
  adult_flora_thorn: {
    hatOffset: { x: 0, y: -10.0, scale: 1.0 },
    accOffset: { x: 0, y: -2.0, scale: 0.95 },
    auraRadius: 26,
  },
  adult_ember_solar: {
    hatOffset: { x: 0, y: -10.8, scale: 0.95 },
    accOffset: { x: 0, y: -4.0, scale: 0.92 },
    auraRadius: 26,
  },
  adult_ember_comet: {
    hatOffset: { x: 0, y: -10.0, scale: 1.0 },
    accOffset: { x: 0, y: 0.0, scale: 1.0 },
    auraRadius: 26,
  },
  adult_ember_magma: {
    hatOffset: { x: 0, y: -10.5, scale: 1.15 },
    accOffset: { x: 0, y: -3.0, scale: 1.05 },
    auraRadius: 28,
  },
  adult_ember_eclipse: {
    hatOffset: { x: 0, y: -10.0, scale: 0.95 },
    accOffset: { x: 0, y: -1.0, scale: 0.95 },
    auraRadius: 26,
  },
};

const FALLBACK_COLORS: Record<FormId, string> = {
  egg: '#fde047',
  baby_aqua: '#38bdf8',
  child_aqua: '#0ea5e9',
  adult_aqua_coral: '#22d3ee',
  adult_aqua_leviathan: '#2563eb',
  adult_aqua_pearl: '#f472b6',
  adult_aqua_abyss: '#6366f1',
  baby_flora: '#4ade80',
  child_flora: '#22c55e',
  adult_flora_bloom: '#10b981',
  adult_flora_raptor: '#84cc16',
  adult_flora_truffle: '#a3e635',
  adult_flora_thorn: '#15803d',
  baby_ember: '#fb923c',
  child_ember: '#f97316',
  adult_ember_solar: '#f59e0b',
  adult_ember_comet: '#ef4444',
  adult_ember_magma: '#dc2626',
  adult_ember_eclipse: '#a855f7',
};

/**
 * Calcule l'index de colonne (0..3) de l'œuf selon le nombre de clics reçus.
 * - 0 clic -> frame 0 (intacte)
 * - 1-2 clics -> frame 1 (fendillée)
 * - 3 clics -> frame 2 (fissurée)
 * - 4+ clics -> frame 3 (très fissurée lumineuse)
 */
export function getEggCrackFrameIndex(eggClicks: number): number {
  const clicks = Number.isFinite(eggClicks) ? Math.max(0, Math.floor(eggClicks)) : 0;
  if (clicks <= 0) {
    return 0;
  }
  if (clicks <= 2) {
    return 1;
  }
  if (clicks === 3) {
    return 2;
  }
  return 3;
}

/**
 * Gère le chargement des 19 spritesheets (256x512), l'avancement des frames d'animation,
 * le rendu pixel-art sans flou, la saleté visuelle, les bulles de besoin et les particules.
 */
export class SpriteAnimator {
  private readonly spriteCache = new Map<FormId, CanvasImageSource>();
  private state: AnimationState = 'idle';
  private frameIndex = 0;
  private frameTimer = 0;
  private temporaryStateRemainingMs = 0;
  private eggShakeRemainingMs = 0;
  private ambientTimer = 0;
  private totalTimeSeconds = 0;
  private particles: CanvasParticle[] = [];
  private activeDialogueProp: DialoguePropType | null = null;
  private dialoguePropRemainingMs = 0;
  private isPomodoroFocus = false;
  private isMusicMode = false;
  private isCarryingBall = false;

  public setPomodoroFocus(focus: boolean): void {
    this.isPomodoroFocus = focus;
  }

  public setMusicMode(music: boolean): void {
    this.isMusicMode = music;
  }

  public setCarryingBall(carrying: boolean): void {
    this.isCarryingBall = carrying;
  }

  /**
   * Précharge les 19 spritesheets depuis `sprites/<formId>.png` (avec repli automatique).
   */
  public async preloadAllSprites(): Promise<void> {
    await Promise.all(ALL_FORMS.map((formId) => this.loadFormSprite(formId)));
  }

  /**
   * Charge la spritesheet d'une forme spécifique.
   */
  public async loadFormSprite(formId: FormId): Promise<CanvasImageSource> {
    const cached = this.spriteCache.get(formId);
    if (cached) {
      return cached;
    }

    const candidateUrls = [
      `./sprites/${formId}.png`,
      `sprites/${formId}.png`,
      `../../assets/sprites/${formId}.png`,
    ];

    for (const url of candidateUrls) {
      try {
        const img = await this.loadImageElement(url);
        this.spriteCache.set(formId, img);
        return img;
      } catch {
        // Essaie le chemin suivant
      }
    }

    const fallbackCanvas = this.createProceduralFallbackSheet(formId);
    this.spriteCache.set(formId, fallbackCanvas);
    return fallbackCanvas;
  }

  private loadImageElement(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  }

  /**
   * Crée une spritesheet procédurale 256x512 en mémoire si le fichier PNG n'est pas accessible.
   */
  private createProceduralFallbackSheet(formId: FormId): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_FRAME_WIDTH * SPRITE_COLUMNS;
    canvas.height = SPRITE_FRAME_HEIGHT * SPRITE_ROWS;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return canvas;
    }

    const color = FALLBACK_COLORS[formId] ?? '#60a5fa';
    for (let row = 0; row < SPRITE_ROWS; row++) {
      for (let col = 0; col < SPRITE_COLUMNS; col++) {
        const ox = col * SPRITE_FRAME_WIDTH;
        const oy = row * SPRITE_FRAME_HEIGHT;
        const bounce = col % 2 === 0 ? 0 : -3;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(ox + 32, oy + 36 + bounce, 20, 0, Math.PI * 2);
        ctx.fill();

        // Yeux pixel-art
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(ox + 24, oy + 30 + bounce, 4, 5);
        ctx.fillRect(ox + 36, oy + 30 + bounce, 4, 5);
      }
    }
    return canvas;
  }

  /**
   * Déclenche un tremblement horizontal/vertical de l'œuf (par défaut 350 ms).
   */
  public triggerEggShake(durationMs: number = 350): void {
    this.eggShakeRemainingMs = Math.max(this.eggShakeRemainingMs, durationMs);
  }

  /** Indique si l'œuf est actuellement en train de trembler suite à un clic. */
  public isEggShaking(): boolean {
    return this.eggShakeRemainingMs > 0;
  }

  /**
   * Définit l'état d'animation courant, avec une durée optionnelle (ex: repas, câlin, évolution).
   */
  public setState(newState: AnimationState, durationMs: number = 0): void {
    if (durationMs > 0) {
      this.state = newState;
      this.temporaryStateRemainingMs = Math.max(this.temporaryStateRemainingMs, durationMs);
      this.frameIndex = 0;
      this.frameTimer = 0;
      return;
    }

    if (this.temporaryStateRemainingMs > 0) {
      return;
    }

    if (this.state !== newState) {
      this.state = newState;
      this.frameIndex = 0;
      this.frameTimer = 0;
    }
  }

  /**
   * Force immédiatement un état d'animation en annulant toute animation temporaire en cours.
   */
  public forceState(newState: AnimationState): void {
    this.temporaryStateRemainingMs = 0;
    if (newState === 'sleep') {
      this.activeDialogueProp = null;
      this.dialoguePropRemainingMs = 0;
    }
    this.state = newState;
    this.frameIndex = 0;
    this.frameTimer = 0;
  }

  /** Retourne l'état d'animation actif. */
  public getState(): AnimationState {
    return this.state;
  }

  /**
   * Active un accessoire ou comportement visuel lié à un dialogue (ex: verre d'eau, danse, tasse de café).
   */
  public setActiveDialogueProp(type: DialoguePropType, durationMs: number = 3600): void {
    this.activeDialogueProp = type;
    this.dialoguePropRemainingMs = durationMs;
  }

  public spawnDialogueProp(type: DialoguePropType, durationMs: number = 3600): void {
    this.setActiveDialogueProp(type, durationMs);
  }

  /** Retourne l'accessoire de dialogue actuellement affiché, le cas échéant. */
  public getActiveDialogueProp(): DialoguePropType | null {
    return this.activeDialogueProp && this.dialoguePropRemainingMs > 0
      ? this.activeDialogueProp
      : null;
  }

  /** Indique si une animation temporaire (repas, joie, évolution) est en cours. */
  public isInTemporaryAnimation(): boolean {
    return this.temporaryStateRemainingMs > 0;
  }

  /** Indique s'il reste des particules actives à animer sur le Canvas. */
  public hasActiveParticles(): boolean {
    return this.particles.length > 0;
  }

  /**
   * Génère des particules visuelles autour du familier ou sous le curseur.
   */
  public spawnParticles(
    kind: ParticleKind,
    originX: number,
    originY: number,
    count: number = 4
  ): void {
    const configs: Record<
      ParticleKind,
      { labels: string[]; colors: string[]; speedY: number; spread: number; life: number }
    > = {
      heart: {
        labels: ['💖', '💕'],
        colors: ['#f472b6', '#ec4899'],
        speedY: -44,
        spread: 52,
        life: 1.15,
      },
      zzz: {
        labels: ['Zzz'],
        colors: ['#93c5fd'],
        speedY: -26,
        spread: 24,
        life: 1.6,
      },
      star: {
        labels: ['⭐', '🌟'],
        colors: ['#fde047', '#facc15'],
        speedY: -54,
        spread: 60,
        life: 1.05,
      },
      sparkle: {
        labels: ['✨'],
        colors: ['#fef08a', '#fde047'],
        speedY: -46,
        spread: 56,
        life: 1.2,
      },
      crumb: {
        labels: ['🍎', '🍖', '✨'],
        colors: ['#fb923c'],
        speedY: -36,
        spread: 44,
        life: 0.9,
      },
      clean: {
        labels: ['🫧', '✨'],
        colors: ['#38bdf8'],
        speedY: -42,
        spread: 52,
        life: 1.1,
      },
      bubble: {
        labels: ['🫧'],
        colors: ['#7dd3fc', '#bae6fd'],
        speedY: -38,
        spread: 36,
        life: 0.95,
      },
      foam: {
        labels: ['☁️', '🫧', '✨'],
        colors: ['#ffffff', '#e0f2fe'],
        speedY: -24,
        spread: 30,
        life: 0.75,
      },
      egg_shard: {
        labels: ['🥚', '✨', '⭐'],
        colors: ['#fef08a', '#fde047', '#ffffff'],
        speedY: -58,
        spread: 64,
        life: 0.95,
      },
      confetti: {
        labels: ['🎉', '🎊', '⭐', '✨', '💫'],
        colors: ['#fde047', '#f472b6', '#38bdf8', '#4ade80', '#a855f7'],
        speedY: -72,
        spread: 90,
        life: 1.45,
      },
      water: {
        labels: ['💧', '🫧', '🧊', '✨'],
        colors: ['#38bdf8', '#0284c7', '#bae6fd'],
        speedY: -35,
        spread: 42,
        life: 1.1,
      },
      music: {
        labels: ['🎵', '🎶', '✨', '💃'],
        colors: ['#f472b6', '#c084fc', '#fde047'],
        speedY: -45,
        spread: 55,
        life: 1.3,
      },
      coffee: {
        labels: ['☕', '♨️', '✨'],
        colors: ['#d97706', '#92400e', '#ffffff'],
        speedY: -32,
        spread: 35,
        life: 1.2,
      },
      keyboard: {
        labels: ['⌨️', '⚡', '✨', '💫'],
        colors: ['#38bdf8', '#fbbf24', '#ffffff'],
        speedY: -48,
        spread: 50,
        life: 1.1,
      },
      shield: {
        labels: ['🛡️', '⭐', '✨', '🌟'],
        colors: ['#f59e0b', '#fbbf24', '#60a5fa'],
        speedY: -40,
        spread: 45,
        life: 1.2,
      },
      tennis: {
        labels: ['🎾', '⭐', '✨'],
        colors: ['#84cc16', '#a3e635', '#fde047'],
        speedY: -55,
        spread: 50,
        life: 1.2,
      },
      sun: {
        labels: ['☀️', '✨', '🌈', '🌟'],
        colors: ['#f59e0b', '#fbbf24', '#fde047'],
        speedY: -40,
        spread: 50,
        life: 1.3,
      },
    };

    const cfg = configs[kind];
    for (let i = 0; i < count; i++) {
      const spreadX = (Math.random() - 0.5) * cfg.spread;
      const spreadY = (Math.random() - 0.5) * 24;
      const label = cfg.labels[i % cfg.labels.length] ?? cfg.labels[0];
      const color = cfg.colors[i % cfg.colors.length] ?? cfg.colors[0];

      this.particles.push({
        kind,
        x: originX + spreadX,
        y: originY - 12 + spreadY,
        vx: (Math.random() - 0.5) * (kind === 'confetti' ? 95 : 44),
        vy: cfg.speedY - Math.random() * 26,
        age: 0,
        lifetime: cfg.life + Math.random() * 0.35,
        size: kind === 'zzz' ? 13 : kind === 'foam' ? 12 : 15 + Math.random() * 5,
        color,
        label,
      });
    }
  }

  /**
   * Met à jour l'état d'animation prioritaire, l'index de frame et la physique des particules.
   */
  public update(
    dtSeconds: number,
    context: {
      stage: StageId;
      isSleeping: boolean;
      isCritical: boolean;
      isMoving: boolean;
      isPlayingGame: boolean;
      isSpongeMode: boolean;
      hunger: number;
      cleanliness: number;
      poopCount: number;
      needsCuddle: boolean;
      needsPlay: boolean;
      petX: number;
      petY: number;
    }
  ): void {
    const safeDt = Math.min(0.25, Math.max(0, dtSeconds));
    this.totalTimeSeconds += safeDt;

    if (this.temporaryStateRemainingMs > 0) {
      this.temporaryStateRemainingMs = Math.max(
        0,
        this.temporaryStateRemainingMs - safeDt * 1000
      );
    }

    if (this.eggShakeRemainingMs > 0) {
      this.eggShakeRemainingMs = Math.max(0, this.eggShakeRemainingMs - safeDt * 1000);
    }

    if (this.dialoguePropRemainingMs > 0) {
      this.dialoguePropRemainingMs = Math.max(0, this.dialoguePropRemainingMs - safeDt * 1000);
      if (this.dialoguePropRemainingMs === 0) {
        this.activeDialogueProp = null;
      }
    }

    // Résolution automatique de l'état d'animation prioritaire quand aucune animation temporaire n'est active
    if (this.temporaryStateRemainingMs <= 0) {
      let desiredState: AnimationState = 'idle';

      if (context.stage === 'egg') {
        desiredState = 'idle';
      } else if (context.isSleeping) {
        desiredState = 'sleep';
      } else if (context.isSpongeMode) {
        desiredState = 'cleaning';
      } else if (context.isPlayingGame) {
        desiredState = context.isMoving ? 'walk' : 'play';
      } else if (context.isMoving) {
        desiredState = 'walk';
      } else if (context.hunger < 45) {
        desiredState = 'hungry';
      } else if (context.needsCuddle) {
        desiredState = 'need_cuddle';
      } else if (context.needsPlay) {
        desiredState = 'need_play';
      } else if (
        context.cleanliness < 40 ||
        context.poopCount >= 2 ||
        context.isCritical
      ) {
        desiredState = 'sad';
      } else {
        desiredState = 'idle';
      }

      if (this.state !== desiredState) {
        this.state = desiredState;
        this.frameIndex = 0;
        this.frameTimer = 0;
      }
    }

    // Avancement de la frame sur la ligne active (4 colonnes)
    const frameDuration = FRAME_DURATION_SECONDS[this.state] ?? 0.25;
    this.frameTimer += safeDt;
    if (this.frameTimer >= frameDuration) {
      const steps = Math.floor(this.frameTimer / frameDuration);
      this.frameTimer %= frameDuration;
      this.frameIndex = (this.frameIndex + steps) % SPRITE_COLUMNS;
    }

    // Particules ambiantes (Zzz pendant le sommeil, étincelles pendant evolve/play)
    this.ambientTimer += safeDt;
    if (this.state === 'sleep' && this.ambientTimer >= 1.8) {
      this.ambientTimer = 0;
      this.spawnParticles('zzz', context.petX + 14, context.petY - 24, 1);
    } else if (this.state === 'evolve' && this.ambientTimer >= 0.22) {
      this.ambientTimer = 0;
      this.spawnParticles('sparkle', context.petX, context.petY, 2);
    }

    // Mise à jour des particules actives
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += safeDt;
      if (p.age >= p.lifetime) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
    }
  }

  /**
   * Rend le familier, ses fissures d'œuf, sa saleté corporelle, ses bulles de pensée,
   * les saletés au sol, les particules et le curseur Éponge savonneuse.
   */
  public render(params: RenderPetParams): void {
    const {
      ctx,
      formId,
      x,
      y,
      groundY,
      scale,
      flipX,
      poopCount,
      cleanliness,
      cleaningProgress,
      eggClicks,
      isSpongeMode,
      cursorX,
      cursorY,
    } = params;

    const sheet = this.spriteCache.get(formId);
    const drawSize = Math.round(SPRITE_FRAME_WIDTH * 1.25 * scale);
    const halfSize = drawSize / 2;

    // Calcul des décalages dynamiques (tremblement d'œuf, rebond d'impatience need_play, etc.)
    let offsetX = 0;
    let offsetY = 0;

    if (this.eggShakeRemainingMs > 0) {
      const intensity = Math.min(1, this.eggShakeRemainingMs / 120);
      offsetX += Math.sin(this.totalTimeSeconds * 85) * 6.5 * intensity;
      offsetY += Math.cos(this.totalTimeSeconds * 110) * 3.5 * intensity;
    } else if (
      (this.activeDialogueProp === 'dance' || this.isMusicMode) &&
      formId !== 'egg' &&
      this.state !== 'sleep'
    ) {
      // Danse rythmée joyeuse : balancement gauche/droite et petits sauts en cadence (jamais pendant le sommeil)
      offsetX += Math.sin(this.totalTimeSeconds * 16) * 5.5;
      offsetY -= Math.abs(Math.sin(this.totalTimeSeconds * 11)) * 9;
    } else if (this.state === 'need_play' && formId !== 'egg') {
      offsetY -= Math.abs(Math.sin(this.totalTimeSeconds * 9.5)) * 10;
    } else if (this.state === 'hungry' && formId !== 'egg') {
      offsetX += Math.sin(this.totalTimeSeconds * 26) * 1.5;
    } else if (this.state === 'need_cuddle' && formId !== 'egg') {
      offsetX += Math.sin(this.totalTimeSeconds * 5.5) * 2.2;
    }

    const renderX = x + offsetX;
    const renderY = y + offsetY;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // 1. Ombre douce sous le familier (au niveau du sol ou sous ses pieds)
    ctx.save();
    const liftDistance = Math.max(0, groundY - renderY);
    const shadowScale = Math.max(0.45, 1 - liftDistance / 320);
    const shadowY = Math.max(y + halfSize - 6, groundY + halfSize - 6);
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.32 * shadowScale).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(
      renderX,
      shadowY,
      halfSize * 0.66 * shadowScale,
      Math.max(5, halfSize * 0.2 * shadowScale),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    // 2. Affichage des petites saletés (poops) au sol autour du familier
    if (poopCount > 0 && formId !== 'egg') {
      this.renderPoops(ctx, x, shadowY - 6, halfSize, poopCount);
    }

    const anchor = COSMETIC_ANCHORS[formId] ?? {
      hatOffset: { x: 0, y: -8.5, scale: 1.0 },
      accOffset: { x: 0, y: -0.5, scale: 1.0 },
      auraRadius: 24,
    };
    const pixelUnit = drawSize / 32;

    // 2.5 Aura cosmétique équipée (dessinée derrière le familier)
    if (formId !== 'egg' && params.equippedCosmetics?.aura) {
      this.renderAuraCosmetic(
        ctx,
        renderX,
        renderY,
        params.equippedCosmetics.aura,
        (anchor.auraRadius ?? 24) * (drawSize / 40)
      );
    }

    // 3. Effet lumineux spécial pour 'play', 'evolve', 'cleaning' ou œuf sur le point d'éclore
    const isGlowingEgg = formId === 'egg' && eggClicks >= 4;
    if (
      this.state === 'evolve' ||
      this.state === 'play' ||
      this.state === 'cleaning' ||
      isGlowingEgg
    ) {
      const pulse = 0.75 + 0.25 * Math.sin(this.totalTimeSeconds * 8);
      const radius =
        halfSize * (this.state === 'evolve' || isGlowingEgg ? 1.28 : 0.98) * pulse;
      const grad = ctx.createRadialGradient(renderX, renderY, 4, renderX, renderY, radius);
      if (this.state === 'evolve' || isGlowingEgg) {
        grad.addColorStop(0, 'rgba(250, 204, 21, 0.7)');
        grad.addColorStop(0.6, 'rgba(129, 140, 248, 0.35)');
        grad.addColorStop(1, 'rgba(129, 140, 248, 0)');
      } else if (this.state === 'cleaning') {
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.42)');
        grad.addColorStop(0.65, 'rgba(186, 230, 253, 0.22)');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      } else {
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(renderX, renderY, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Dessin de la frame 64x64 de la spritesheet avec retournement horizontal (flipX)
    if (sheet) {
      const row = formId === 'egg' ? 0 : (ANIMATION_ROW_MAP[this.state] ?? 0);
      const col =
        formId === 'egg'
          ? getEggCrackFrameIndex(eggClicks)
          : this.frameIndex % SPRITE_COLUMNS;
      const sx = col * SPRITE_FRAME_WIDTH;
      const sy = row * SPRITE_FRAME_HEIGHT;

      const dragScaleX = params.dragScaleX ?? 1;
      const dragScaleY = params.dragScaleY ?? 1;
      const dragAngle = params.dragAngle ?? 0;

      ctx.save();
      ctx.translate(Math.round(renderX), Math.round(renderY));
      if (dragAngle !== 0) {
        ctx.rotate(dragAngle);
      }
      const scaleXSign = flipX && formId !== 'egg' ? -1 : 1;
      ctx.scale(scaleXSign * dragScaleX, dragScaleY);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        sheet,
        sx,
        sy,
        SPRITE_FRAME_WIDTH,
        SPRITE_FRAME_HEIGHT,
        -halfSize,
        -halfSize,
        drawSize,
        drawSize
      );

      // 5.5 Accessoire et Chapeau cosmétiques dessinés DANS le repère transformé du familier
      // avec suivi pixel-par-pixel de la tête et des yeux pour chaque frame d'animation.
      if (formId !== 'egg') {
        const frameAnchor = FRAME_ANCHORS[formId]?.[row]?.[col];
        const eyeX = frameAnchor ? frameAnchor.eyeX - 16 : anchor.accOffset.x;
        const eyeY = frameAnchor ? frameAnchor.eyeY - 16 : anchor.accOffset.y;
        const headX = frameAnchor ? frameAnchor.headX - 16 : anchor.hatOffset.x;
        const headY = frameAnchor ? frameAnchor.headY - 16 : anchor.hatOffset.y;

        if (params.equippedCosmetics?.accessory) {
          const accLocalX = eyeX * pixelUnit;
          const accLocalY = eyeY * pixelUnit;
          const accScale = frameAnchor
            ? scale * Math.max(0.75, frameAnchor.eyeSpan / 4)
            : scale * (anchor.accOffset.scale ?? 1.0);
          this.renderAccessoryCosmetic(
            ctx,
            accLocalX,
            accLocalY,
            params.equippedCosmetics.accessory,
            accScale
          );
        }
        if (params.equippedCosmetics?.hat) {
          const hatLocalX = headX * pixelUnit;
          const hatLocalY = headY * pixelUnit + (frameAnchor ? 2 * scale : 0);
          const hatScale = scale * (anchor.hatOffset.scale ?? 1.0);
          this.renderHatCosmetic(
            ctx,
            hatLocalX,
            hatLocalY,
            params.equippedCosmetics.hat,
            hatScale
          );
        }
      }
      ctx.restore();
    }

    // 5. Rendu visuel de la saleté directement sur le corps du familier
    if (formId !== 'egg' && (cleanliness < 45 || poopCount >= 2)) {
      this.renderBodyDirtOverlay(
        ctx,
        renderX,
        renderY,
        halfSize,
        cleanliness,
        poopCount,
        cleaningProgress
      );
    }

    // 5.8 Accessoire/Prop de dialogue spontané (verre d'eau, tasse de café, bouclier, clavier, etc.)
    if (formId !== 'egg' && this.activeDialogueProp && this.activeDialogueProp !== 'dance') {
      this.renderDialogueProp(
        ctx,
        renderX,
        renderY,
        this.activeDialogueProp,
        flipX
      );
    }

    // 5.9 Accessoires d'état persistant (Focus Pomodoro, Casque Musique, Balle de tennis rapportée)
    if (formId !== 'egg' && this.state !== 'sleep') {
      if (this.isPomodoroFocus) {
        this.renderLaptopProp(ctx, renderX, renderY, flipX);
        this.renderStudyGlassesProp(ctx, renderX, renderY, flipX);
      }
      if (this.isMusicMode) {
        this.renderHeadphonesProp(ctx, renderX, renderY, flipX);
      }
      if (this.isCarryingBall) {
        this.renderCarriedBallProp(ctx, renderX, renderY, flipX);
      }
    }

    // 6. Bulle de pensée animée au-dessus du familier (faim, besoin de câlin, besoin de jouer, saleté)
    if (formId !== 'egg' && !isSpongeMode) {
      this.renderNeedThoughtBubble(
        ctx,
        renderX,
        renderY - halfSize - 14,
        cleanliness,
        poopCount
      );
    }

    // 7. Rendu des particules (cœurs, Zzz, étoiles, bulles de savon, confettis)
    for (const p of this.particles) {
      const progress = p.age / p.lifetime;
      const alpha = Math.max(0, 1 - progress * progress);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${Math.round(p.size)}px "Segoe UI Emoji", "Segoe UI", sans-serif`;
      ctx.fillStyle = p.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, p.x, p.y);
      ctx.restore();
    }

    // 8. Rendu du curseur Éponge / Brosse savonneuse en mode nettoyage
    if (
      isSpongeMode &&
      typeof cursorX === 'number' &&
      typeof cursorY === 'number' &&
      cursorX >= 0 &&
      cursorY >= 0
    ) {
      this.renderSpongeCursor(ctx, cursorX, cursorY);
    }

    ctx.restore();
  }

  /**
   * Dessine directement sur le corps du familier des taches de boue/poussière brunes,
   * des effluves verdâtres ondulantes et des petites mouches tourbillonnantes.
   * L'opacité diminue progressivement à mesure que `cleaningProgress` monte de 0 à 100.
   */
  private renderBodyDirtOverlay(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    halfSize: number,
    cleanliness: number,
    poopCount: number,
    cleaningProgress: number
  ): void {
    const cleanDeficit = cleanliness < 45 ? (45 - cleanliness) / 45 : 0;
    const poopFactor = Math.min(1, poopCount * 0.32);
    const rawSeverity = Math.min(1, Math.max(0.38, cleanDeficit * 0.85 + poopFactor * 0.6));
    // Estompage doux et continu des taches sous l'éponge jusqu'à disparition complète à 100%
    const scrubFade = Math.max(
      0,
      1 - Math.min(100, Math.max(0, cleaningProgress || 0)) / 100
    );
    const alpha = rawSeverity * scrubFade;
    if (alpha <= 0.01) {
      return;
    }

    ctx.save();

    // Taches de boue / poussière brunes semi-transparentes sur le corps
    const spots: Array<{ dx: number; dy: number; rx: number; ry: number; rot: number }> = [
      { dx: -0.26, dy: 0.16, rx: 0.18, ry: 0.12, rot: -0.3 },
      { dx: 0.24, dy: 0.22, rx: 0.16, ry: 0.11, rot: 0.4 },
      { dx: -0.14, dy: -0.12, rx: 0.13, ry: 0.09, rot: 0.2 },
      { dx: 0.19, dy: -0.06, rx: 0.14, ry: 0.1, rot: -0.25 },
      { dx: 0.02, dy: 0.28, rx: 0.2, ry: 0.11, rot: 0.1 },
    ];

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const sx = centerX + s.dx * halfSize;
      const sy = centerY + s.dy * halfSize;
      ctx.fillStyle =
        i % 2 === 0
          ? `rgba(101, 62, 33, ${(alpha * 0.72).toFixed(2)})`
          : `rgba(76, 46, 23, ${(alpha * 0.64).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(
        sx,
        sy,
        Math.max(4, s.rx * halfSize),
        Math.max(3, s.ry * halfSize),
        s.rot,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // 3 lignes d'effluves verdâtres ondulantes au-dessus du corps
    ctx.strokeStyle = `rgba(132, 204, 22, ${(alpha * 0.78).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const fumeOffsets = [-halfSize * 0.36, 0, halfSize * 0.36];
    for (let i = 0; i < fumeOffsets.length; i++) {
      const fx = centerX + fumeOffsets[i];
      const fy = centerY - halfSize * 0.35;
      const wave = Math.sin(this.totalTimeSeconds * 5 + i * 1.8) * 5;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(fx + wave, fy - 11, fx - wave * 0.6, fy - 22);
      ctx.stroke();
    }

    // 0 à 3 petites mouches qui tourbillonnent autour du familier selon le niveau de saleté
    const flyCount = cleanliness < 25 || poopCount >= 3 ? 3 : cleanliness < 40 || poopCount >= 2 ? 2 : 0;
    for (let i = 0; i < flyCount; i++) {
      const angle = this.totalTimeSeconds * (4.2 + i * 0.7) + i * 2.1;
      const flyX = centerX + Math.cos(angle) * (halfSize * 0.75);
      const flyY =
        centerY -
        halfSize * 0.25 +
        Math.sin(angle * 2) * (halfSize * 0.28);

      // Ailes minuscules
      ctx.fillStyle = `rgba(226, 232, 240, ${(alpha * 0.85).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(flyX - 2, flyY - 2, 1.8, 0, Math.PI * 2);
      ctx.arc(flyX + 2, flyY - 2, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Corps de la mouche
      ctx.fillStyle = `rgba(15, 23, 42, ${(alpha * 0.95).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(flyX, flyY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Dessine une bulle de pensée animée au-dessus du familier lorsqu'il a faim,
   * réclame un câlin, veut jouer ou a besoin d'être nettoyé.
   */
  private renderNeedThoughtBubble(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    topY: number,
    cleanliness: number,
    poopCount: number
  ): void {
    let iconText = '';
    let borderColor = 'rgba(255, 255, 255, 0.35)';

    if (this.state === 'hungry') {
      iconText = Math.floor(this.totalTimeSeconds * 2) % 2 === 0 ? '🍖 🍎' : '🍎 🍖';
      borderColor = 'rgba(249, 115, 22, 0.75)';
    } else if (this.state === 'need_cuddle') {
      iconText = '🥺 💖';
      borderColor = 'rgba(236, 72, 153, 0.75)';
    } else if (this.state === 'need_play') {
      iconText = '🎾 ⭐';
      borderColor = 'rgba(250, 204, 21, 0.8)';
    } else if (this.state === 'sad' && (cleanliness < 40 || poopCount >= 2)) {
      iconText = '🧽 🫧';
      borderColor = 'rgba(6, 182, 212, 0.75)';
    } else {
      return;
    }

    const pulse = 1 + 0.08 * Math.sin(this.totalTimeSeconds * 6.5);
    const bubbleY = Math.max(28, topY - 12);

    ctx.save();
    ctx.translate(centerX, bubbleY);
    ctx.scale(pulse, pulse);

    // Petits ronds de bulle de pensée
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.arc(-6, 16, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-2, 10, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Nuage / capsule principale
    const w = 58;
    const h = 28;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2 - 4, w, h, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = '14px "Segoe UI Emoji", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(iconText, 0, -4);

    ctx.restore();
  }

  /**
   * Dessine sous le curseur de la souris une belle éponge jaune savonneuse entourée de bulles.
   */
  private renderSpongeCursor(
    ctx: CanvasRenderingContext2D,
    cursorX: number,
    cursorY: number
  ): void {
    const wobble = Math.sin(this.totalTimeSeconds * 10) * 0.08;

    ctx.save();
    ctx.translate(cursorX, cursorY);
    ctx.rotate(-0.2 + wobble);

    // Mousse blanche savonneuse autour de l'éponge
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    const foamCircles = [
      { x: -16, y: -12, r: 7 },
      { x: -6, y: -15, r: 8 },
      { x: 6, y: -14, r: 7.5 },
      { x: 16, y: -11, r: 6.5 },
      { x: -18, y: 8, r: 6 },
      { x: 17, y: 9, r: 6.5 },
    ];
    for (const fc of foamCircles) {
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, fc.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Corps de l'éponge jaune
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(-20, -13, 40, 26, 7);
    ctx.fill();
    ctx.stroke();

    // Pores de l'éponge
    ctx.fillStyle = '#d97706';
    const pores = [
      { x: -11, y: -5, r: 2.5 },
      { x: -2, y: -6, r: 2 },
      { x: 9, y: -4, r: 2.8 },
      { x: -8, y: 4, r: 2.2 },
      { x: 3, y: 5, r: 2.5 },
      { x: 12, y: 4, r: 1.8 },
    ];
    for (const pore of pores) {
      ctx.beginPath();
      ctx.arc(pore.x, pore.y, pore.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Petites bulles irisées flottant autour du curseur
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.95)';
    ctx.fillStyle = 'rgba(224, 242, 254, 0.45)';
    ctx.lineWidth = 1.4;
    const bubbles = [
      { x: -24, y: -18, r: 4.5 },
      { x: 23, y: -16, r: 5.5 },
      { x: 26, y: 2, r: 3.5 },
    ];
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Dessine les petites saletés à nettoyer près du familier.
   */
  private renderPoops(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    groundY: number,
    halfSize: number,
    poopCount: number
  ): void {
    const offsets = [
      -halfSize - 18,
      halfSize + 18,
      -halfSize - 42,
      halfSize + 42,
      -halfSize - 64,
    ];
    const visibleCount = Math.min(5, Math.max(0, poopCount));

    ctx.save();
    ctx.font = '18px "Segoe UI Emoji", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < visibleCount; i++) {
      const px = centerX + offsets[i];
      const py = groundY - 4;
      const wave = Math.sin(this.totalTimeSeconds * 4 + i) * 2;
      ctx.fillText('💩', px, py);

      // Petites lignes d'odeur au-dessus
      ctx.strokeStyle = 'rgba(163, 230, 53, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 3, py - 12);
      ctx.quadraticCurveTo(px - 5 + wave, py - 17, px - 2, py - 21);
      ctx.moveTo(px + 4, py - 11);
      ctx.quadraticCurveTo(px + 6 - wave, py - 16, px + 3, py - 20);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Dessine un aperçu statique (frame 0 de la ligne 'idle') dans un petit canvas pour le Compendium et le Labo.
   */
  public drawFormThumbnail(canvas: HTMLCanvasElement, formId: FormId): void {
    const ctx = canvas.getContext('2d');
    const sheet = this.spriteCache.get(formId);
    if (!ctx || !sheet) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sheet,
      0,
      0,
      SPRITE_FRAME_WIDTH,
      SPRITE_FRAME_HEIGHT,
      0,
      0,
      canvas.width,
      canvas.height
    );
  }

  /**
   * Rendu visuel d'une aura cosmétique animée autour du familier.
   */
  private renderAuraCosmetic(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    auraId: string,
    radius: number
  ): void {
    ctx.save();
    const t = this.totalTimeSeconds;
    if (auraId === 'aura_rainbow') {
      const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6'];
      for (let i = 0; i < 6; i++) {
        const ang = t * 2.2 + (i * Math.PI * 2) / 6;
        const dist = radius * (1.1 + 0.15 * Math.sin(t * 3 + i));
        const px = x + Math.cos(ang) * dist;
        const py = y + Math.sin(ang) * (dist * 0.55);
        ctx.fillStyle = colors[i];
        ctx.font = '14px "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', px, py);
      }
    } else if (auraId === 'aura_music') {
      const notes = ['♪', '♫', '♬'];
      for (let i = 0; i < 3; i++) {
        const phase = (t * 1.5 + i * 0.8) % 3;
        const px = x + Math.sin(t * 2 + i * 2) * (radius * 0.85);
        const py = y - (phase * radius * 0.75);
        const alpha = Math.max(0, 1 - phase / 3);
        ctx.fillStyle = `rgba(168, 85, 247, ${alpha.toFixed(2)})`;
        ctx.font = 'bold 16px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(notes[i], px, py);
      }
    } else if (auraId === 'aura_sakura') {
      for (let i = 0; i < 5; i++) {
        const ang = -t * 1.8 + (i * Math.PI * 2) / 5;
        const dist = radius * (1.05 + 0.1 * Math.cos(t * 2 + i));
        const px = x + Math.cos(ang) * dist;
        const py = y + Math.sin(ang) * (dist * 0.5);
        ctx.font = '13px "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🌸', px, py);
      }
    } else if (auraId === 'aura_cyber') {
      ctx.strokeStyle = `rgba(6, 182, 212, ${(0.5 + 0.3 * Math.sin(t * 4)).toFixed(2)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, y + radius * 0.65, radius * 1.15, radius * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(236, 72, 153, ${(0.5 + 0.3 * Math.cos(t * 4)).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 0.9, radius * 0.9, t * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Rendu visuel d'un chapeau cosmétique sur le sommet de la tête du familier.
   */
  private renderHatCosmetic(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    hatId: string,
    scale: number
  ): void {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(x, y);
    const s = Math.max(0.75, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (hatId === 'hat_crown') {
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-11 * s, 0);
      ctx.lineTo(-12 * s, -12 * s);
      ctx.lineTo(-5 * s, -6 * s);
      ctx.lineTo(0, -14 * s);
      ctx.lineTo(5 * s, -6 * s);
      ctx.lineTo(12 * s, -12 * s);
      ctx.lineTo(11 * s, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(0, -4 * s, 2 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (hatId === 'hat_tophat') {
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#020617';
      ctx.lineWidth = 1.8;
      ctx.fillRect(-14 * s, -3 * s, 28 * s, 4 * s);
      ctx.strokeRect(-14 * s, -3 * s, 28 * s, 4 * s);
      ctx.fillRect(-9 * s, -17 * s, 18 * s, 14 * s);
      ctx.strokeRect(-9 * s, -17 * s, 18 * s, 14 * s);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-9 * s, -6 * s, 18 * s, 3 * s);
    } else if (hatId === 'hat_bow') {
      ctx.fillStyle = '#f472b6';
      ctx.strokeStyle = '#831843';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -3 * s);
      ctx.lineTo(-10 * s, -9 * s);
      ctx.lineTo(-10 * s, 3 * s);
      ctx.closePath();
      ctx.moveTo(0, -3 * s);
      ctx.lineTo(10 * s, -9 * s);
      ctx.lineTo(10 * s, 3 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ec4899';
      ctx.beginPath();
      ctx.arc(0, -3 * s, 3 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (hatId === 'hat_wizard') {
      ctx.fillStyle = '#7c3aed';
      ctx.strokeStyle = '#2e1065';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, 15 * s, 4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9 * s, -1 * s);
      ctx.lineTo(2 * s, -20 * s);
      ctx.lineTo(9 * s, -1 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(0, -8 * s, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (hatId === 'hat_cap') {
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, -2 * s, 11 * s, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.ellipse(8 * s, -2 * s, 8 * s, 2.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (hatId === 'hat_halo') {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3.2 * s;
      ctx.shadowColor = '#facc15';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.ellipse(0, -8 * s, 11 * s, 3.5 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Rendu visuel d'un accessoire cosmétique sur le visage/yeux du familier.
   */
  private renderAccessoryCosmetic(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    accId: string,
    scale: number
  ): void {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(x, y);
    const s = Math.max(0.75, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (accId === 'acc_sunglasses') {
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.4;
      ctx.fillRect(-12 * s, -4 * s, 10 * s, 7 * s);
      ctx.strokeRect(-12 * s, -4 * s, 10 * s, 7 * s);
      ctx.fillRect(2 * s, -4 * s, 10 * s, 7 * s);
      ctx.strokeRect(2 * s, -4 * s, 10 * s, 7 * s);
      ctx.fillRect(-2 * s, -2 * s, 4 * s, 2 * s);
    } else if (accId === 'acc_monocle') {
      ctx.strokeStyle = '#facc15';
      ctx.fillStyle = 'rgba(186, 230, 253, 0.35)';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(6 * s, 0, 5.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(11 * s, 2 * s);
      ctx.quadraticCurveTo(13 * s, 9 * s, 10 * s, 14 * s);
      ctx.stroke();
    } else if (accId === 'acc_star_glasses') {
      ctx.fillStyle = '#f472b6';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.6;
      for (const cx of [-7 * s, 7 * s]) {
        ctx.beginPath();
        ctx.arc(cx, 0, 5.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillRect(-2 * s, -1.5 * s, 4 * s, 2 * s);
    } else if (accId === 'acc_blush_hearts') {
      ctx.fillStyle = '#fb7185';
      ctx.beginPath();
      ctx.ellipse(-10 * s, 3 * s, 4 * s, 2.5 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(10 * s, 3 * s, 4 * s, 2.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Rendu des objets thématiques animés qui accompagnent les dialogues spontanés.
   */
  private renderDialogueProp(
    ctx: CanvasRenderingContext2D,
    renderX: number,
    renderY: number,
    propType: DialoguePropType,
    flipX: boolean
  ): void {
    switch (propType) {
      case 'water_glass':
        this.renderWaterGlassProp(ctx, renderX, renderY, flipX);
        break;
      case 'coffee_cup':
        this.renderCoffeeCupProp(ctx, renderX, renderY, flipX);
        break;
      case 'shield':
        this.renderShieldProp(ctx, renderX, renderY, flipX);
        break;
      case 'tennis_ball':
        this.renderTennisBallProp(ctx, renderX, renderY, flipX);
        break;
      case 'keyboard':
        this.renderKeyboardProp(ctx, renderX, renderY, flipX);
        break;
      case 'sun':
        this.renderSunProp(ctx, renderX, renderY);
        break;
      case 'laptop':
        this.renderLaptopProp(ctx, renderX, renderY, flipX);
        break;
      case 'headphones':
        this.renderHeadphonesProp(ctx, renderX, renderY, flipX);
        break;
      case 'stretching':
        break;
    }
  }

  private renderWaterGlassProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    const bob = Math.sin(this.totalTimeSeconds * 5) * 3;
    const px = x + (flipX ? -28 : 28);
    const py = y + 2 + bob;

    ctx.save();
    ctx.translate(px, py);

    // Corps du verre en verre translucide
    ctx.fillStyle = 'rgba(224, 242, 254, 0.55)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(-9, -14);
    ctx.lineTo(9, -14);
    ctx.lineTo(7, 14);
    ctx.lineTo(-7, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Eau fraîche à l'intérieur
    ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
    ctx.beginPath();
    ctx.moveTo(-8, -6 + Math.sin(this.totalTimeSeconds * 8) * 1.5);
    ctx.lineTo(8, -6 - Math.sin(this.totalTimeSeconds * 8) * 1.5);
    ctx.lineTo(6.5, 12);
    ctx.lineTo(-6.5, 12);
    ctx.closePath();
    ctx.fill();

    // Glaçon flottant
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(-4, -4, 4, 4);

    // Paille colorée inclinée
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(2, 6);
    ctx.lineTo(7, -18);
    ctx.stroke();

    // Reflet brillant sur le verre
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, -10);
    ctx.lineTo(-5, 8);
    ctx.stroke();

    ctx.restore();
  }

  private renderCoffeeCupProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    const bob = Math.sin(this.totalTimeSeconds * 4) * 2;
    const px = x + (flipX ? -26 : 26);
    const py = y + 4 + bob;

    ctx.save();
    ctx.translate(px, py);

    // Anse de la tasse
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(flipX ? -9 : 9, 0, 5, -Math.PI / 2, Math.PI / 2, !flipX);
    ctx.stroke();

    // Corps de la tasse
    ctx.fillStyle = '#fef08a';
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-8, -8, 16, 16);
    ctx.fill();
    ctx.stroke();

    // Surface du café chaud
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.ellipse(0, -6, 6.5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Vapeur montante animée
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const steamOffset = (this.totalTimeSeconds * 12) % 18;
    ctx.moveTo(-2, -10 - steamOffset);
    ctx.bezierCurveTo(-5, -14 - steamOffset, 1, -18 - steamOffset, -2, -22 - steamOffset);
    ctx.stroke();

    ctx.restore();
  }

  private renderShieldProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    const px = x + (flipX ? -24 : 24);
    const py = y + 1;

    ctx.save();
    ctx.translate(px, py);

    // Bouclier héroïque doré
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, -10);
    ctx.lineTo(8, 6);
    ctx.lineTo(0, 14);
    ctx.lineTo(-8, 6);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Emblème étoile au centre
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⭐', 0, 0);

    ctx.restore();
  }

  private renderTennisBallProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    // Rebond dynamique de la balle
    const bounce = Math.abs(Math.sin(this.totalTimeSeconds * 8)) * 14;
    const px = x + (flipX ? -26 : 26);
    const py = y + 8 - bounce;

    ctx.save();
    ctx.translate(px, py);

    ctx.fillStyle = '#bef264';
    ctx.strokeStyle = '#4d7c0f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Coutures de la balle de tennis
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(-2, 0, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.restore();
  }

  private renderKeyboardProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    const px = x + (flipX ? -24 : 24);
    const py = y + 6;

    ctx.save();
    ctx.translate(px, py);

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-12, -7, 24, 14);
    ctx.fill();
    ctx.stroke();

    // Touches rétroéclairées
    ctx.fillStyle = '#38bdf8';
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillRect(-9 + c * 5, -4 + r * 5, 3.5, 3);
      }
    }

    ctx.restore();
  }

  private renderSunProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number
  ): void {
    const py = y - 36;
    ctx.save();
    ctx.translate(x, py);

    // Rayons tournants
    const rot = this.totalTimeSeconds * 1.5;
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = rot + (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 10, Math.sin(angle) * 10);
      ctx.lineTo(Math.cos(angle) * 15, Math.sin(angle) * 15);
      ctx.stroke();
    }

    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();

    // Sourire mignon sur le soleil
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.arc(-3, -2, 1, 0, Math.PI * 2);
    ctx.arc(3, -2, 1, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 1, 3.5, 0.2, Math.PI - 0.2);
    ctx.stroke();

    ctx.restore();
  }

  private renderLaptopProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    const px = x + (flipX ? -26 : 26);
    const py = y + 8;

    ctx.save();
    ctx.translate(px, py);

    // Base clavier
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-11, 4);
    ctx.lineTo(11, 4);
    ctx.lineTo(9, 8);
    ctx.lineTo(-9, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Écran incliné ouvert
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-9, 4);
    ctx.lineTo(9, 4);
    ctx.lineTo(10, -10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Dalle d'écran cyan lumineuse
    ctx.fillStyle = 'rgba(6, 182, 212, 0.85)';
    ctx.fillRect(-8, -8, 16, 10);

    // Lignes de code en blanc
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-6, -6, 7, 1.5);
    ctx.fillRect(-6, -3.5, 11, 1.5);
    ctx.fillRect(-6, -1, 5, 1.5);

    // Curseur clignotant
    if (Math.sin(this.totalTimeSeconds * 8) > 0) {
      ctx.fillStyle = '#a5f3fc';
      ctx.fillRect(0, -1, 2, 2);
    }

    ctx.restore();
  }

  private renderStudyGlassesProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    const py = y - 6;
    const px = x;

    ctx.save();
    ctx.translate(px, py);

    ctx.strokeStyle = '#fbbf24'; // Monture dorée
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';

    // Verre gauche
    ctx.beginPath();
    ctx.arc(-7, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Verre droit
    ctx.beginPath();
    ctx.arc(7, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Pont nasal
    ctx.beginPath();
    ctx.moveTo(-2.5, -0.5);
    ctx.lineTo(2.5, -0.5);
    ctx.stroke();

    // Reflet blanc sur les verres
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, -2);
    ctx.lineTo(-6, -4);
    ctx.moveTo(5, -2);
    ctx.lineTo(8, -4);
    ctx.stroke();

    ctx.restore();
  }

  private renderHeadphonesProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    const py = y - 9;
    const px = x;

    ctx.save();
    ctx.translate(px, py);

    // Arceau au-dessus de la tête
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -9, 16, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    // Écouteur gauche (coussinet rose néon)
    ctx.fillStyle = '#ec4899';
    ctx.strokeStyle = '#be185d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(-15, -5, 4.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Écouteur droit
    ctx.beginPath();
    ctx.ellipse(15, -5, 4.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Détail métallique
    ctx.fillStyle = '#f472b6';
    ctx.fillRect(-16, -6, 2, 3);
    ctx.fillRect(14, -6, 2, 3);

    ctx.restore();
  }

  private renderCarriedBallProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    flipX: boolean
  ): void {
    const px = x + (flipX ? -14 : 14);
    const py = y + 3;

    ctx.save();
    ctx.translate(px, py);

    ctx.fillStyle = '#bef264';
    ctx.strokeStyle = '#4d7c0f';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(-2, 0, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.restore();
  }
}
