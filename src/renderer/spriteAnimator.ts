/**
 * Moteur d'animation par spritesheets (256x384 px, grille 4x6 de 64x64 px)
 * et système de particules légères sur Canvas 2D (cœurs, Zzz, étoiles, saletés).
 */

import type { AnimationState, FormId } from '../core/types';

export const SPRITE_FRAME_WIDTH = 64;
export const SPRITE_FRAME_HEIGHT = 64;
export const SPRITE_COLUMNS = 4;
export const SPRITE_ROWS = 6;

/** Correspondance entre un état d'animation et la ligne de la spritesheet (0 à 5). */
export const ANIMATION_ROW_MAP: Record<AnimationState, number> = {
  idle: 0,
  walk: 1,
  eat: 2,
  happy: 3,
  play: 3, // Ligne 'happy' avec effets lumineux dynamiques
  sleep: 4,
  sad: 5,
  evolve: 3, // Ligne 'happy' avec halo d'évolution et étincelles
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
};

export type ParticleKind = 'heart' | 'zzz' | 'star' | 'sparkle' | 'crumb' | 'clean';

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
}

const ALL_FORMS: readonly FormId[] = [
  'egg',
  'baby_blob',
  'child_sprout',
  'adult_solar',
  'adult_athletic',
  'adult_gourmet',
  'adult_shadow',
];

const FALLBACK_COLORS: Record<FormId, string> = {
  egg: '#fde047',
  baby_blob: '#38bdf8',
  child_sprout: '#4ade80',
  adult_solar: '#f59e0b',
  adult_athletic: '#ef4444',
  adult_gourmet: '#ec4899',
  adult_shadow: '#8b5cf6',
};

/**
 * Gère le chargement des spritesheets, l'avancement des frames d'animation,
 * le rendu pixel-art sans flou et les particules d'ambiance / d'interaction.
 */
export class SpriteAnimator {
  private readonly spriteCache = new Map<FormId, CanvasImageSource>();
  private state: AnimationState = 'idle';
  private frameIndex = 0;
  private frameTimer = 0;
  private temporaryStateRemainingMs = 0;
  private ambientTimer = 0;
  private totalTimeSeconds = 0;
  private particles: CanvasParticle[] = [];

  /**
   * Précharge les 7 spritesheets depuis `sprites/<formId>.png` (avec repli automatique).
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
   * Crée une spritesheet procédurale 256x384 en mémoire si le fichier PNG n'est pas accessible.
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
   * Génère des particules visuelles autour du familier.
   */
  public spawnParticles(
    kind: ParticleKind,
    originX: number,
    originY: number,
    count: number = 4
  ): void {
    const configs: Record<
      ParticleKind,
      { label: string; color: string; speedY: number; life: number }
    > = {
      heart: { label: '💖', color: '#f472b6', speedY: -42, life: 1.15 },
      zzz: { label: 'Zzz', color: '#93c5fd', speedY: -26, life: 1.6 },
      star: { label: '⭐', color: '#fde047', speedY: -50, life: 1.0 },
      sparkle: { label: '✨', color: '#fef08a', speedY: -45, life: 1.2 },
      crumb: { label: '🍎', color: '#fb923c', speedY: -35, life: 0.9 },
      clean: { label: '🫧', color: '#38bdf8', speedY: -40, life: 1.1 },
    };

    const cfg = configs[kind];
    for (let i = 0; i < count; i++) {
      const spreadX = (Math.random() - 0.5) * 52;
      const spreadY = (Math.random() - 0.5) * 24;
      this.particles.push({
        kind,
        x: originX + spreadX,
        y: originY - 18 + spreadY,
        vx: (Math.random() - 0.5) * 36,
        vy: cfg.speedY - Math.random() * 22,
        age: 0,
        lifetime: cfg.life + Math.random() * 0.35,
        size: kind === 'zzz' ? 13 : 15 + Math.random() * 4,
        color: cfg.color,
        label: cfg.label,
      });
    }
  }

  /**
   * Met à jour l'état d'animation, l'index de frame et la physique des particules.
   */
  public update(
    dtSeconds: number,
    context: {
      isSleeping: boolean;
      isCritical: boolean;
      isMoving: boolean;
      isPlayingGame: boolean;
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

    // Résolution automatique de l'état de base quand aucune animation temporaire n'est active
    if (this.temporaryStateRemainingMs <= 0) {
      let desiredState: AnimationState = 'idle';
      if (context.isSleeping) {
        desiredState = 'sleep';
      } else if (context.isPlayingGame) {
        desiredState = context.isMoving ? 'walk' : 'play';
      } else if (context.isMoving) {
        desiredState = 'walk';
      } else if (context.isCritical) {
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
   * Rend le familier, son ombre douce, les éventuelles saletés (poops) et les particules.
   */
  public render(params: RenderPetParams): void {
    const { ctx, formId, x, y, groundY, scale, flipX, poopCount } = params;
    const sheet = this.spriteCache.get(formId);

    const drawSize = Math.round(SPRITE_FRAME_WIDTH * 1.25 * scale);
    const halfSize = drawSize / 2;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // 1. Ombre douce sous le familier (au niveau du sol ou sous ses pieds)
    const liftDistance = Math.max(0, groundY - y);
    const shadowScale = Math.max(0.45, 1 - liftDistance / 320);
    const shadowY = Math.max(y + halfSize - 6, groundY + halfSize - 6);
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.32 * shadowScale).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(
      x,
      shadowY,
      halfSize * 0.66 * shadowScale,
      Math.max(5, halfSize * 0.2 * shadowScale),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // 2. Affichage des petites saletés (poops) autour du familier
    if (poopCount > 0) {
      this.renderPoops(ctx, x, shadowY - 6, halfSize, poopCount);
    }

    // 3. Effet lumineux spécial pour 'play' et 'evolve'
    if (this.state === 'evolve' || this.state === 'play') {
      const pulse = 0.75 + 0.25 * Math.sin(this.totalTimeSeconds * 8);
      const radius = halfSize * (this.state === 'evolve' ? 1.25 : 0.95) * pulse;
      const grad = ctx.createRadialGradient(x, y, 4, x, y, radius);
      if (this.state === 'evolve') {
        grad.addColorStop(0, 'rgba(250, 204, 21, 0.65)');
        grad.addColorStop(0.6, 'rgba(129, 140, 248, 0.35)');
        grad.addColorStop(1, 'rgba(129, 140, 248, 0)');
      } else {
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Dessin de la frame 64x64 de la spritesheet avec retournement horizontal (flipX)
    if (sheet) {
      const row = ANIMATION_ROW_MAP[this.state] ?? 0;
      const col = this.frameIndex % SPRITE_COLUMNS;
      const sx = col * SPRITE_FRAME_WIDTH;
      const sy = row * SPRITE_FRAME_HEIGHT;

      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      if (flipX) {
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

    // 5. Rendu des particules (cœurs, Zzz, étoiles, étincelles)
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
    const offsets = [-halfSize - 18, halfSize + 18, -halfSize - 42, halfSize + 42, -halfSize - 64];
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
   * Dessine un aperçu statique (frame 0 de la ligne 'idle') dans un petit canvas pour le Compendium.
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
