/**
 * Implémentation des 2 mini-jeux interactifs :
 * 1. Attrape-Étoile (`star_catch`) : 5 étoiles dorées rebondissent pendant 12 secondes sur le bureau.
 * 2. Duel Réflexe / Pierre-Feuille-Ciseaux (`rps_duel`) : duel en 3 manches contre le familier.
 */

import type { MiniGameId, MiniGameResult } from '../core/types';
import type { PetActor } from './petActor';
import type { SpriteAnimator } from './spriteAnimator';

export interface BouncingStar {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  caught: boolean;
}

type RpsMove = 'rock' | 'paper' | 'scissors';

const RPS_EMOJI: Record<RpsMove, string> = {
  rock: '✊',
  paper: '✋',
  scissors: '✌️',
};

const RPS_LABEL: Record<RpsMove, string> = {
  rock: 'Pierre',
  paper: 'Feuille',
  scissors: 'Ciseaux',
};

export interface MiniGamesCallbacks {
  onGameComplete: (result: MiniGameResult) => void;
  onSpeech: (message: string) => void;
  onUiStateChanged: () => void;
}

/**
 * Contrôleur unifié des deux mini-jeux (`star_catch` sur Canvas 2D et `rps_duel` en panneau flottant).
 */
export class MiniGamesController {
  private readonly petActor: PetActor;
  private readonly animator: SpriteAnimator;
  private readonly callbacks: MiniGamesCallbacks;

  private activeGame: MiniGameId | null = null;

  // État Mini-jeu 1 : Attrape-Étoile (10s chrono, étoiles en mouvement continu avec rebonds et respawn)
  private stars: BouncingStar[] = [];
  private starCatchTimeRemaining = 0;
  private starCatchScore = 0;
  private readonly starCatchSimultaneousStars = 6;
  private readonly starCatchDurationSeconds = 10;
  private nextStarId = 1;

  // État Mini-jeu 2 : Pierre-Feuille-Ciseaux (3 manches)
  private rpsRound = 1;
  private rpsPlayerScore = 0;
  private rpsPetScore = 0;
  private rpsBusy = false;
  private rpsTiesInRow = 0;

  // Éléments DOM
  private readonly starBannerEl: HTMLElement | null;
  private readonly starScoreEl: HTMLElement | null;
  private readonly starTimerEl: HTMLElement | null;
  private readonly rpsModalEl: HTMLElement | null;
  private readonly rpsRoundBadgeEl: HTMLElement | null;
  private readonly rpsPlayerMoveEl: HTMLElement | null;
  private readonly rpsPetMoveEl: HTMLElement | null;
  private readonly rpsPlayerScoreEl: HTMLElement | null;
  private readonly rpsPetScoreEl: HTMLElement | null;
  private readonly rpsStatusTextEl: HTMLElement | null;
  private readonly rpsPetLabelEl: HTMLElement | null;

  constructor(
    petActor: PetActor,
    animator: SpriteAnimator,
    callbacks: MiniGamesCallbacks
  ) {
    this.petActor = petActor;
    this.animator = animator;
    this.callbacks = callbacks;

    this.starBannerEl = document.getElementById('star-catch-banner');
    this.starScoreEl = document.getElementById('star-catch-score');
    this.starTimerEl = document.getElementById('star-catch-timer');

    this.rpsModalEl = document.getElementById('rps-modal');
    this.rpsRoundBadgeEl = document.getElementById('rps-round-badge');
    this.rpsPlayerMoveEl = document.getElementById('rps-player-move');
    this.rpsPetMoveEl = document.getElementById('rps-pet-move');
    this.rpsPlayerScoreEl = document.getElementById('rps-player-score');
    this.rpsPetScoreEl = document.getElementById('rps-pet-score');
    this.rpsStatusTextEl = document.getElementById('rps-status-text');
    this.rpsPetLabelEl = document.getElementById('rps-pet-label');

    this.bindDomEvents();
  }

  private bindDomEvents(): void {
    const cancelStarBtn = document.getElementById('btn-cancel-star-catch');
    cancelStarBtn?.addEventListener('click', () => {
      if (this.activeGame === 'star_catch') {
        this.finishStarCatch();
      }
    });

    const closeRpsBtn = document.getElementById('btn-close-rps');
    closeRpsBtn?.addEventListener('click', () => {
      this.cancelActiveGame();
    });

    const rpsButtons = document.querySelectorAll<HTMLButtonElement>('.rps-choice-btn');
    rpsButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const move = btn.dataset.move as RpsMove | undefined;
        if (move) {
          this.playRpsRound(move);
        }
      });
    });
  }

  /** Indique si un mini-jeu est actuellement en cours. */
  public isPlaying(): boolean {
    return this.activeGame !== null;
  }

  /** Retourne l'identifiant du mini-jeu actif ou `null`. */
  public getActiveGame(): MiniGameId | null {
    return this.activeGame;
  }

  private spawnStar(initial = false): BouncingStar {
    const margin = 50;
    const minX = margin;
    const maxX = Math.max(minX + 120, window.innerWidth - margin);
    const minY = 50;
    const maxY = Math.max(minY + 120, this.petActor.getGroundY() - 30);

    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);

    // Vitesse fluide et dynamique dans toutes les directions pour rebondir en continu
    const speed = 130 + Math.random() * 130;
    const angle = Math.random() * Math.PI * 2;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    return {
      id: this.nextStarId++,
      x,
      y,
      vx,
      vy,
      radius: 22,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() < 0.5 ? -1 : 1) * (2.0 + Math.random() * 2.5),
      caught: false,
    };
  }

  /**
   * Démarre le mini-jeu Attrape-Étoile (`star_catch`) pour 10 secondes chrono avec des étoiles rebondissantes.
   */
  public startStarCatch(): void {
    this.cancelActiveGame();
    this.activeGame = 'star_catch';
    this.starCatchTimeRemaining = this.starCatchDurationSeconds;
    this.starCatchScore = 0;
    this.stars = [];

    for (let i = 0; i < this.starCatchSimultaneousStars; i++) {
      this.stars.push(this.spawnStar(true));
    }

    this.updateStarBanner();
    this.starBannerEl?.classList.remove('hidden');
    this.animator.setState('play', 1200);
    this.callbacks.onSpeech('Attrape un maximum d\'étoiles en 10 secondes ! ⭐');
    this.callbacks.onUiStateChanged();
  }

  /**
   * Démarre le mini-jeu Pierre-Feuille-Ciseaux (`rps_duel`) en 3 manches.
   */
  public startRpsDuel(petName: string): void {
    this.cancelActiveGame();
    this.activeGame = 'rps_duel';
    this.rpsRound = 1;
    this.rpsPlayerScore = 0;
    this.rpsPetScore = 0;
    this.rpsBusy = false;
    this.rpsTiesInRow = 0;

    if (this.rpsPetLabelEl) {
      this.rpsPetLabelEl.textContent = petName;
    }
    if (this.rpsRoundBadgeEl) {
      this.rpsRoundBadgeEl.textContent = 'Manche 1 / 3';
    }
    if (this.rpsPlayerMoveEl) {
      this.rpsPlayerMoveEl.textContent = '❔';
    }
    if (this.rpsPetMoveEl) {
      this.rpsPetMoveEl.textContent = '🐾';
    }
    if (this.rpsPlayerScoreEl) {
      this.rpsPlayerScoreEl.textContent = '0';
    }
    if (this.rpsPetScoreEl) {
      this.rpsPetScoreEl.textContent = '0';
    }
    if (this.rpsStatusTextEl) {
      this.rpsStatusTextEl.textContent = 'Choisis Pierre, Feuille ou Ciseaux !';
    }

    this.setRpsButtonsDisabled(false);
    this.positionRpsModalNearPet();
    this.rpsModalEl?.classList.remove('hidden');
    this.animator.setState('play', 1000);
    this.callbacks.onSpeech('En garde pour 3 manches ! ✊✋✌️');
    this.callbacks.onUiStateChanged();
  }

  /**
   * Positionne la fenêtre Pierre-Feuille-Ciseaux à proximité du familier.
   */
  public positionRpsModalNearPet(): void {
    if (!this.rpsModalEl) {
      return;
    }
    const panelWidth = 310;
    const panelHeight = 225;
    const petSize = this.petActor.getDrawSize();

    const left = Math.min(
      window.innerWidth - panelWidth - 16,
      Math.max(16, Math.round(this.petActor.x - panelWidth / 2))
    );
    const top = Math.max(
      20,
      Math.min(
        window.innerHeight - panelHeight - 20,
        Math.round(this.petActor.y - petSize / 2 - panelHeight - 18)
      )
    );

    this.rpsModalEl.style.left = `${left}px`;
    this.rpsModalEl.style.top = `${top}px`;
  }

  /**
   * Annule proprement tout mini-jeu actif sans attribuer de récompense.
   */
  public cancelActiveGame(): void {
    this.activeGame = null;
    this.stars = [];
    this.starBannerEl?.classList.add('hidden');
    this.rpsModalEl?.classList.add('hidden');
    this.callbacks.onUiStateChanged();
  }

  /**
   * Teste si le curseur `(clientX, clientY)` survole une étoile active d'Attrape-Étoile.
   */
  public isPointOverStar(clientX: number, clientY: number, extraMargin: number = 14): boolean {
    if (this.activeGame !== 'star_catch') {
      return false;
    }
    for (const star of this.stars) {
      if (star.caught) {
        continue;
      }
      const dist = Math.hypot(clientX - star.x, clientY - star.y);
      if (dist <= star.radius + extraMargin) {
        return true;
      }
    }
    return false;
  }

  /**
   * Gère un clic sur le Canvas pendant le mini-jeu Attrape-Étoile.
   * Retourne `true` si une étoile a été cliquée ou si le familier a été guidé.
   */
  public handleCanvasMouseDown(clientX: number, clientY: number): boolean {
    if (this.activeGame !== 'star_catch') {
      return false;
    }

    for (const star of this.stars) {
      if (star.caught) {
        continue;
      }
      const dist = Math.hypot(clientX - star.x, clientY - star.y);
      if (dist <= star.radius + 16) {
        this.captureStar(star);
        this.petActor.walkToward(star.x);
        return true;
      }
    }

    return false;
  }

  /**
   * Met à jour la physique des étoiles dorées et la collision avec le familier.
   */
  public update(dtSeconds: number): void {
    if (this.activeGame === 'rps_duel') {
      this.positionRpsModalNearPet();
      return;
    }

    if (this.activeGame !== 'star_catch') {
      return;
    }

    const safeDt = Math.min(0.1, Math.max(0, dtSeconds));
    this.starCatchTimeRemaining = Math.max(0, this.starCatchTimeRemaining - safeDt);

    const minX = 36;
    const maxX = Math.max(minX + 60, window.innerWidth - 36);
    const minY = 36;
    const maxY = Math.max(minY + 60, this.petActor.getGroundY() + 18);
    const petHitRadius = this.petActor.getDrawSize() * 0.52;

    for (const star of this.stars) {
      if (star.caught) {
        continue;
      }

      // Mouvement fluide continu dans toutes les directions
      star.x += star.vx * safeDt;
      star.y += star.vy * safeDt;
      star.rotation += star.rotationSpeed * safeDt;

      // Rebonds sur les 4 bords de l'écran en continu
      if (star.x <= minX) {
        star.x = minX;
        star.vx = Math.abs(star.vx);
      } else if (star.x >= maxX) {
        star.x = maxX;
        star.vx = -Math.abs(star.vx);
      }

      if (star.y <= minY) {
        star.y = minY;
        star.vy = Math.abs(star.vy);
      } else if (star.y >= maxY) {
        star.y = maxY;
        star.vy = -Math.abs(star.vy);
      }

      // Capture automatique si le familier passe sous/contre l'étoile
      const distToPet = Math.hypot(star.x - this.petActor.x, star.y - this.petActor.y);
      if (distToPet <= petHitRadius + star.radius) {
        this.captureStar(star);
      }
    }

    this.updateStarBanner();

    if (this.starCatchTimeRemaining <= 0) {
      this.finishStarCatch();
    }
  }

  /**
   * Dessine les étoiles dorées rebondissantes sur le Canvas 2D.
   */
  public render(ctx: CanvasRenderingContext2D): void {
    if (this.activeGame !== 'star_catch') {
      return;
    }

    for (const star of this.stars) {
      if (star.caught) {
        continue;
      }

      ctx.save();
      ctx.translate(star.x, star.y);
      ctx.rotate(star.rotation);

      // Halo lumineux doré
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, star.radius * 1.45);
      glow.addColorStop(0, 'rgba(254, 240, 138, 0.85)');
      glow.addColorStop(0.55, 'rgba(250, 204, 21, 0.35)');
      glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, star.radius * 1.45, 0, Math.PI * 2);
      ctx.fill();

      // Forme d'étoile à 5 branches
      this.drawFivePointStar(ctx, 0, 0, 5, star.radius * 0.9, star.radius * 0.42);
      ctx.fillStyle = '#fde047';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ca8a04';
      ctx.stroke();

      ctx.restore();
    }
  }

  private drawFivePointStar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    spikes: number,
    outerRadius: number,
    innerRadius: number
  ): void {
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
  }

  private captureStar(star: BouncingStar): void {
    if (star.caught) {
      return;
    }
    star.caught = true;
    this.starCatchScore += 1;
    this.animator.spawnParticles('star', star.x, star.y, 6);
    this.animator.spawnParticles('sparkle', star.x, star.y, 5);
    this.animator.setState('happy', 600);

    // L'étoile disparaît et une autre réapparaît immédiatement à un endroit aléatoire
    this.stars = this.stars.filter((s) => s.id !== star.id);
    this.stars.push(this.spawnStar());

    this.updateStarBanner();
  }

  private updateStarBanner(): void {
    if (this.starScoreEl) {
      this.starScoreEl.textContent = `${this.starCatchScore} ⭐`;
    }
    if (this.starTimerEl) {
      this.starTimerEl.textContent = `${Math.max(0, this.starCatchTimeRemaining).toFixed(1)}s`;
    }
  }

  private finishStarCatch(): void {
    const score = this.starCatchScore;
    const maxScore = Math.max(10, score);
    const won = score >= 5;

    this.activeGame = null;
    this.stars = [];
    this.starBannerEl?.classList.add('hidden');
    this.callbacks.onUiStateChanged();

    this.callbacks.onGameComplete({
      gameId: 'star_catch',
      score,
      maxScore,
      won,
    });
  }

  private playRpsRound(playerMove: RpsMove): void {
    if (this.activeGame !== 'rps_duel' || this.rpsBusy) {
      return;
    }

    const moves: readonly RpsMove[] = ['rock', 'paper', 'scissors'];
    const petMove = moves[Math.floor(Math.random() * moves.length)];

    if (this.rpsPlayerMoveEl) {
      this.rpsPlayerMoveEl.textContent = RPS_EMOJI[playerMove];
    }
    if (this.rpsPetMoveEl) {
      this.rpsPetMoveEl.textContent = RPS_EMOJI[petMove];
    }

    // Gestion d'une égalité (rejoue la manche jusqu'à 2 fois, puis accorde le point d'effort)
    if (playerMove === petMove && this.rpsTiesInRow < 2) {
      this.rpsTiesInRow += 1;
      if (this.rpsStatusTextEl) {
        this.rpsStatusTextEl.textContent = `Égalité (${RPS_LABEL[playerMove]}) ! Rejoue ⚡`;
      }
      this.animator.setState('play', 600);
      this.animator.spawnParticles('sparkle', this.petActor.x, this.petActor.y, 3);
      return;
    }

    this.rpsTiesInRow = 0;
    const playerWonRound =
      playerMove === petMove ||
      (playerMove === 'rock' && petMove === 'scissors') ||
      (playerMove === 'paper' && petMove === 'rock') ||
      (playerMove === 'scissors' && petMove === 'paper');

    if (playerWonRound) {
      this.rpsPlayerScore += 1;
      if (this.rpsStatusTextEl) {
        this.rpsStatusTextEl.textContent = `${RPS_LABEL[playerMove]} bat ${RPS_LABEL[petMove]} ! 🎉`;
      }
      this.animator.setState('happy', 850);
      this.animator.spawnParticles('heart', this.petActor.x, this.petActor.y, 4);
    } else {
      this.rpsPetScore += 1;
      if (this.rpsStatusTextEl) {
        this.rpsStatusTextEl.textContent = `${RPS_LABEL[petMove]} bat ${RPS_LABEL[playerMove]} ! 🐾`;
      }
      this.animator.setState('play', 850);
      this.animator.spawnParticles('star', this.petActor.x, this.petActor.y, 3);
    }

    if (this.rpsPlayerScoreEl) {
      this.rpsPlayerScoreEl.textContent = String(this.rpsPlayerScore);
    }
    if (this.rpsPetScoreEl) {
      this.rpsPetScoreEl.textContent = String(this.rpsPetScore);
    }

    if (this.rpsRound >= 3) {
      this.rpsBusy = true;
      this.setRpsButtonsDisabled(true);
      const finalScore = this.rpsPlayerScore;
      const won = this.rpsPlayerScore > this.rpsPetScore;

      window.setTimeout(() => {
        this.activeGame = null;
        this.rpsModalEl?.classList.add('hidden');
        this.rpsBusy = false;
        this.callbacks.onUiStateChanged();

        this.callbacks.onGameComplete({
          gameId: 'rps_duel',
          score: finalScore,
          maxScore: 3,
          won,
        });
      }, 950);
    } else {
      this.rpsRound += 1;
      if (this.rpsRoundBadgeEl) {
        this.rpsRoundBadgeEl.textContent = `Manche ${this.rpsRound} / 3`;
      }
    }
  }

  private setRpsButtonsDisabled(disabled: boolean): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.rps-choice-btn');
    buttons.forEach((btn) => {
      btn.disabled = disabled;
    });
  }
}
