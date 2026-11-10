/**
 * Moteur d'animation par spritesheets (256x512 px, grille 4x8 de 64x64 px)
 * et système de particules & effets visuels sur Canvas 2D :
 * - Éclosion progressive de l'œuf (4 étapes de fissures + tremblement + confettis)
 * - Rendu visuel de la saleté sur le corps (taches de boue, effluves verdâtres, mouches)
 * - Curseur Éponge / Brosse savonneuse et bulles de mousse
 * - Bulles de pensée animées pour la faim (🍖/🍎), le besoin de câlin (🥺💖) et l'envie de jouer (🎾⭐)
 */

import type { AnimationState, FormId, StageId } from '../core/types';

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
  | 'confetti';

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
    this.state = newState;
    this.frameIndex = 0;
    this.frameTimer = 0;
  }

  /** Retourne l'état d'animation actif. */
  public getState(): AnimationState {
    return this.state;
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

    // 2. Affichage des petites saletés (poops) au sol autour du familier
    if (poopCount > 0 && formId !== 'egg') {
      this.renderPoops(ctx, x, shadowY - 6, halfSize, poopCount);
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

      ctx.save();
      ctx.translate(Math.round(renderX), Math.round(renderY));
      if (flipX && formId !== 'egg') {
        ctx.scale(-1, 1);
      }
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
      ctx.restore();
    }

    // 5. Rendu visuel de la saleté directement sur le corps du familier
    if (formId !== 'egg' && (cleanliness < 60 || poopCount > 0)) {
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
    const cleanDeficit = cleanliness < 60 ? (60 - cleanliness) / 60 : 0;
    const poopFactor = Math.min(1, poopCount * 0.32);
    const rawSeverity = Math.min(1, Math.max(0.38, cleanDeficit * 0.85 + poopFactor * 0.6));
    const scrubFade = Math.max(
      0.06,
      1 - Math.min(100, Math.max(0, cleaningProgress || 0)) / 100
    );
    const alpha = rawSeverity * scrubFade;

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

    // 2 à 3 petites mouches qui tourbillonnent autour du familier
    const flyCount = cleanliness < 30 || poopCount >= 2 ? 3 : 2;
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
}
