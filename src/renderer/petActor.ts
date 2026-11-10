/**
 * Physique, IA de déplacement autonome sur le bureau et interactions souris
 * (Glisser-déposer, caresse au curseur, clic simple et regard vers la souris).
 */

import { SPRITE_FRAME_WIDTH } from './spriteAnimator';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetActorCallbacks {
  /** Déclenché lors d'un clic simple sur le familier (ouvre/ferme le HUD). */
  onClick: () => void;
  /** Déclenché lorsque l'utilisateur caresse le familier en frottant la souris dessus. */
  onPetRub: (x: number, y: number) => void;
  /** Déclenché à la fin d'un déplacement ou d'un glisser-déposer pour sauvegarder la position. */
  onPositionChanged: (x: number, y: number) => void;
}

/**
 * Représente l'entité physique du familier évoluant en bas du bureau (`y = window.innerHeight - 95`).
 */
export class PetActor {
  public x: number;
  public y: number;
  public flipX = false;
  public isMoving = false;
  public isDragging = false;
  public isHovering = false;

  private speciesScale = 1.0;
  private userScale = 1.0;
  private walkSpeed = 50;

  // IA de marche autonome
  private targetX: number | null = null;
  private aiPauseTimer = 2.5;
  private vy = 0;

  // Suivi souris (Drag & Drop + Caresse par frottement)
  private pointerDown = false;
  private hasDragged = false;
  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private rubDistanceAccumulator = 0;
  private lastRubDirection = 0;
  private lastRubTimestamp = 0;

  private readonly callbacks: PetActorCallbacks;

  constructor(initialX: number, initialY: number, callbacks: PetActorCallbacks) {
    this.callbacks = callbacks;
    const groundY = this.getGroundY();
    this.x = this.clampX(Number.isFinite(initialX) ? initialX : window.innerWidth * 0.5);
    this.y = Number.isFinite(initialY) ? Math.min(groundY, Math.max(60, initialY)) : groundY;
    // Place par défaut sur la ligne de sol du bureau
    this.y = groundY;
  }

  /**
   * Coordonnée Y de référence en bas du bureau (`window.innerHeight - 95`).
   */
  public getGroundY(): number {
    return Math.max(80, window.innerHeight - 95);
  }

  /**
   * Facteur d'échelle combiné (espèce × préférence utilisateur).
   */
  public getEffectiveScale(): number {
    return this.speciesScale * this.userScale;
  }

  /**
   * Taille de rendu en pixels du côté du sprite.
   */
  public getDrawSize(): number {
    return Math.round(SPRITE_FRAME_WIDTH * 1.25 * this.getEffectiveScale());
  }

  /**
   * Met à jour les facteurs d'échelle du familier.
   */
  public setScales(speciesScale: number, userScale: number): void {
    if (Number.isFinite(speciesScale) && speciesScale > 0) {
      this.speciesScale = speciesScale;
    }
    if (Number.isFinite(userScale) && userScale > 0) {
      this.userScale = userScale;
    }
    this.x = this.clampX(this.x);
  }

  /**
   * Met à jour la vitesse de marche (pixels/seconde) selon la forme actuelle.
   */
  public setWalkSpeed(speed: number): void {
    this.walkSpeed = Number.isFinite(speed) && speed >= 0 ? speed : 0;
  }

  /**
   * Retourne le rectangle de collision du familier (avec une marge optionnelle confortable).
   */
  public getHitBox(margin: number = 14): BoundingBox {
    const size = this.getDrawSize();
    const half = size / 2;
    return {
      x: this.x - half - margin,
      y: this.y - half - margin,
      width: size + margin * 2,
      height: size + margin * 2,
    };
  }

  /**
   * Teste si le point `(clientX, clientY)` se trouve sur le familier.
   */
  public containsPoint(clientX: number, clientY: number, margin: number = 14): boolean {
    const box = this.getHitBox(margin);
    return (
      clientX >= box.x &&
      clientX <= box.x + box.width &&
      clientY >= box.y &&
      clientY <= box.y + box.height
    );
  }

  /**
   * Recentre le familier horizontalement en bas du bureau.
   */
  public centerOnScreen(): void {
    this.x = this.clampX(Math.round(window.innerWidth / 2));
    this.y = this.getGroundY();
    this.targetX = null;
    this.isMoving = false;
    this.vy = 0;
    this.callbacks.onPositionChanged(this.x, this.y);
  }

  /**
   * Ordonne au familier de marcher vers une coordonnée X (ex: pour attraper une étoile).
   */
  public walkToward(x: number): void {
    if (this.walkSpeed <= 0 || this.isDragging) {
      return;
    }
    this.targetX = this.clampX(x);
  }

  /**
   * Gère l'appui du bouton gauche de la souris.
   */
  public handlePointerDown(clientX: number, clientY: number, button: number): boolean {
    if (button !== 0) {
      return false;
    }
    if (!this.containsPoint(clientX, clientY, 12)) {
      return false;
    }

    this.pointerDown = true;
    this.hasDragged = false;
    this.dragStartClientX = clientX;
    this.dragStartClientY = clientY;
    this.dragOffsetX = this.x - clientX;
    this.dragOffsetY = this.y - clientY;
    this.vy = 0;
    return true;
  }

  /**
   * Gère le déplacement du curseur (Drag & Drop, survol et caresse par frottement).
   */
  public handlePointerMove(clientX: number, clientY: number): void {
    const dx = clientX - this.lastMouseX;
    const dy = clientY - this.lastMouseY;
    this.lastMouseX = clientX;
    this.lastMouseY = clientY;

    if (this.pointerDown) {
      const distFromStart = Math.hypot(
        clientX - this.dragStartClientX,
        clientY - this.dragStartClientY
      );
      if (distFromStart > 6) {
        this.isDragging = true;
        this.hasDragged = true;
        this.targetX = null;
        this.isMoving = false;
      }

      if (this.isDragging) {
        this.x = this.clampX(clientX + this.dragOffsetX);
        this.y = this.clampY(clientY + this.dragOffsetY);
        if (Math.abs(dx) > 1.5) {
          this.flipX = dx < 0;
        }
        return;
      }
    }

    const hoveringNow = this.containsPoint(clientX, clientY, 14);
    this.isHovering = hoveringNow;

    // Détection de la caresse au curseur (frotter la souris sur le familier)
    if (hoveringNow && !this.pointerDown) {
      const now = performance.now();
      const stepDist = Math.hypot(dx, dy);

      if (stepDist > 1.5 && stepDist < 120) {
        const currentDir = Math.abs(dx) >= 1 ? Math.sign(dx) : this.lastRubDirection;
        const directionBonus =
          currentDir !== 0 &&
          this.lastRubDirection !== 0 &&
          currentDir !== this.lastRubDirection
            ? 28
            : 0;

        if (now - this.lastRubTimestamp > 1400) {
          this.rubDistanceAccumulator = 0;
        }

        this.rubDistanceAccumulator += stepDist + directionBonus;
        this.lastRubDirection = currentDir;
        this.lastRubTimestamp = now;

        if (this.rubDistanceAccumulator >= 115) {
          this.rubDistanceAccumulator = 0;
          this.callbacks.onPetRub(this.x, this.y);
        }
      }
    }
  }

  /**
   * Gère le relâchement de la souris (fin de Drag & Drop ou clic simple).
   */
  public handlePointerUp(): void {
    if (!this.pointerDown) {
      return;
    }

    const wasDragged = this.hasDragged;
    this.pointerDown = false;
    this.isDragging = false;
    this.hasDragged = false;

    if (wasDragged) {
      this.callbacks.onPositionChanged(this.x, this.y);
    } else {
      this.callbacks.onClick();
    }
  }

  /**
   * Met à jour la physique (redescente douce au sol) et l'IA de marche autonome.
   */
  public update(dtSeconds: number, options: { canWalk: boolean }): void {
    const safeDt = Math.min(0.1, Math.max(0, dtSeconds));
    const groundY = this.getGroundY();

    if (this.isDragging) {
      this.isMoving = false;
      return;
    }

    // Redescente douce vers y = window.innerHeight - 95 si soulevé puis relâché
    if (this.y < groundY - 1) {
      this.vy += 520 * safeDt;
      this.y += this.vy * safeDt;
      if (this.y >= groundY) {
        this.y = groundY;
        this.vy = 0;
        this.callbacks.onPositionChanged(this.x, this.y);
      }
    } else {
      this.y = groundY;
      this.vy = 0;
    }

    this.x = this.clampX(this.x);

    if (!options.canWalk || this.walkSpeed <= 0) {
      this.isMoving = false;
      this.targetX = null;
      return;
    }

    // Déplacement vers la cible active
    if (this.targetX !== null) {
      const diffX = this.targetX - this.x;
      const absDiff = Math.abs(diffX);

      if (absDiff <= 4) {
        this.x = this.targetX;
        this.targetX = null;
        this.isMoving = false;
        this.aiPauseTimer = 2.4 + Math.random() * 4.2;
        this.callbacks.onPositionChanged(this.x, this.y);
      } else {
        const dir = Math.sign(diffX);
        this.flipX = dir < 0;
        this.isMoving = true;
        const step = Math.min(absDiff, this.walkSpeed * safeDt);
        this.x = this.clampX(this.x + dir * step);
      }
      return;
    }

    // En pause (idle) : regarde vers le curseur si la souris s'approche
    this.isMoving = false;
    const distToCursor = Math.hypot(this.lastMouseX - this.x, this.lastMouseY - this.y);
    if (distToCursor < 220 && Math.abs(this.lastMouseX - this.x) > 14) {
      this.flipX = this.lastMouseX < this.x;
    }

    // Décompte avant la prochaine balade autonome
    this.aiPauseTimer -= safeDt;
    if (this.aiPauseTimer <= 0) {
      const margin = this.getHorizontalMargin();
      const minX = margin;
      const maxX = Math.max(margin + 40, window.innerWidth - margin);
      const maxTravel = Math.min(280, (maxX - minX) * 0.45);
      const delta = (Math.random() * 2 - 1) * maxTravel;
      const candidateX = this.clampX(
        Math.abs(delta) < 55 ? this.x + (Math.random() < 0.5 ? -90 : 90) : this.x + delta
      );
      this.targetX = candidateX;
    }
  }

  private getHorizontalMargin(): number {
    return Math.max(54, Math.round(this.getDrawSize() * 0.65));
  }

  private clampX(val: number): number {
    const margin = this.getHorizontalMargin();
    const max = Math.max(margin, window.innerWidth - margin);
    return Math.min(max, Math.max(margin, Math.round(val)));
  }

  private clampY(val: number): number {
    const margin = Math.max(48, Math.round(this.getDrawSize() * 0.5));
    const max = this.getGroundY();
    return Math.min(max, Math.max(margin, Math.round(val)));
  }
}
