/**
 * Physique, IA de déplacement autonome sur le bureau et interactions souris
 * (Glisser-déposer, caresse au curseur, brossage à l'éponge, clic simple et regard vers la souris).
 */

import type { ActiveWindowInfo } from '../core';
import { SPRITE_FRAME_WIDTH } from './spriteAnimator';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetActorCallbacks {
  /** Déclenché lors d'un clic simple sur le familier (éclosion de l'œuf ou ouverture/fermeture du HUD). */
  onClick: () => void;
  /** Déclenché lorsque l'utilisateur caresse le familier en frottant la souris dessus. */
  onPetRub: (x: number, y: number) => void;
  /** Déclenché lorsque l'utilisateur frotte le familier avec l'éponge en mode nettoyage. */
  onSpongeScrub?: (scrubDelta: number, cursorX: number, cursorY: number) => void;
  /** Déclenché à la fin d'un déplacement ou d'un glisser-déposer pour sauvegarder la position. */
  onPositionChanged: (x: number, y: number) => void;
  /** Déclenché lorsque le familier attrape la balle de tennis lancée. */
  onBallGrabbed?: () => void;
  /** Déclenché lorsque le familier rapporte la balle au joueur. */
  onBallReturned?: () => void;
  /** Déclenché lorsque l'utilisateur agite le curseur de souris devant le familier. */
  onCursorWiggleExcited?: () => void;
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
  public isSpongeMode = false;
  public hasActiveDemand = false;
  public lastCursorX = -1000;
  public lastCursorY = -1000;

  private speciesScale = 1.0;
  private userScale = 1.0;
  private walkSpeed = 50;

  // IA de marche autonome
  private targetX: number | null = null;
  private aiPauseTimer = 2.5;
  private vy = 0;
  private microStepRemaining = 0;
  private lastWanderDir = 1;

  // Interaction avec les fenêtres Windows (Perchoir / Plateforme active)
  private activeWindow: ActiveWindowInfo | null = null;
  private isPerchingOnWindow = false;
  private perchDecisionTimer = 14.0;

  // Jeu de la balle (Fetch)
  private isFetchingBall = false;
  private isCarryingBall = false;
  private ballTargetX = 0;
  private ballTargetY = 0;

  // Détection d'agitation ludique du curseur (Wiggle)
  private lastWiggleDirection = 0;
  private wiggleCounter = 0;
  private lastWiggleTimestamp = 0;

  // Suivi souris (Drag & Drop + Caresse par frottement + Brossage Éponge)
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
  private spongeDistanceAccumulator = 0;

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
   * Retourne la ligne de sol courante (sol du bureau ou rebord de la fenêtre active).
   */
  public getCurrentFloorY(): number {
    if (this.isPerchingOnWindow && this.activeWindow) {
      return Math.max(60, this.activeWindow.y - 10);
    }
    return this.getGroundY();
  }

  /**
   * Notifie l'acteur de la géométrie de la fenêtre active au premier plan sous Windows.
   */
  public setActiveWindow(info: ActiveWindowInfo | null): void {
    this.activeWindow = info;
    if (this.isPerchingOnWindow) {
      if (!info || info.y > this.getGroundY() - 75 || info.width < 220 || info.height < 150) {
        this.isPerchingOnWindow = false;
      }
    }
  }

  public getIsPerchingOnWindow(): boolean {
    return this.isPerchingOnWindow;
  }

  public getIsCarryingBall(): boolean {
    return this.isCarryingBall;
  }

  public startFetchingBall(ballX: number, ballY: number): void {
    this.isFetchingBall = true;
    this.isCarryingBall = false;
    this.ballTargetX = ballX;
    this.ballTargetY = ballY;
    this.targetX = this.clampX(ballX);
    this.isPerchingOnWindow = false; // Descend pour chercher la balle au sol
  }

  public updateBallTarget(ballX: number, ballY: number): void {
    if (this.isFetchingBall) {
      this.ballTargetX = ballX;
      this.ballTargetY = ballY;
      this.targetX = this.clampX(ballX);
    }
  }

  public stopFetchingBall(): void {
    this.isFetchingBall = false;
    this.isCarryingBall = false;
    this.targetX = null;
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
   * Interrompt immédiatement toute marche autonome en cours.
   */
  public stopWalking(): void {
    this.targetX = null;
    this.isMoving = false;
    this.microStepRemaining = 0;
    this.aiPauseTimer = 3.2;
  }

  /**
   * Définit si le familier est en manque de quelque chose ou réclame une action
   * (faim, saleté, câlin, jeu, sommeil). Si oui, le passage de la souris ne produit aucune réaction.
   */
  public setHasActiveDemand(hasDemand: boolean): void {
    this.hasActiveDemand = Boolean(hasDemand);
    if (this.hasActiveDemand) {
      this.isHovering = false;
      this.rubDistanceAccumulator = 0;
    }
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
    if (this.walkSpeed <= 0 || this.isDragging || this.isSpongeMode) {
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

    if (this.isSpongeMode) {
      if (this.containsPoint(clientX, clientY, 60)) {
        this.callbacks.onSpongeScrub?.(14, clientX, clientY);
        return true;
      }
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
   * Gère le déplacement du curseur (Drag & Drop, survol, caresse par frottement et éponge).
   */
  public handlePointerMove(clientX: number, clientY: number): void {
    const dx = clientX - this.lastMouseX;
    const dy = clientY - this.lastMouseY;
    this.lastMouseX = clientX;
    this.lastMouseY = clientY;
    this.lastCursorX = clientX;
    this.lastCursorY = clientY;

    // Mode Éponge / Brosse : simple passage en va-et-vient sur la zone du familier (sans clic requis)
    if (this.isSpongeMode) {
      this.isHovering = this.containsPoint(clientX, clientY, 90);
      const onPetScrubZone = this.containsPoint(clientX, clientY, 55);
      if (onPetScrubZone) {
        const stepDist = Math.hypot(dx, dy);
        if (stepDist > 1.2 && stepDist < 160) {
          this.spongeDistanceAccumulator += stepDist;
          if (this.spongeDistanceAccumulator >= 20) {
            const scrubDelta = Math.max(
              4,
              Math.min(18, Math.round((this.spongeDistanceAccumulator / 20) * 5.5))
            );
            this.spongeDistanceAccumulator = 0;
            this.callbacks.onSpongeScrub?.(scrubDelta, clientX, clientY);
          }
        }
      }
      return;
    }

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

    // Si le pet est en manque de quelque chose ou réclame une action (faim, saleté, câlin, jeu),
    // il ne se passe STRICTEMENT RIEN lorsqu'on passe la souris sur lui (pas de survol, pas de regard, pas de caresse) !
    if (this.hasActiveDemand) {
      this.isHovering = false;
      this.rubDistanceAccumulator = 0;
      return;
    }

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

    // Détection de secousse / agitation ludique du curseur devant le familier
    const distToCursor = Math.hypot(clientX - this.x, clientY - this.y);
    if (distToCursor < 140 && !this.pointerDown && !this.hasActiveDemand) {
      const now = performance.now();
      if (Math.abs(dx) > 3.5) {
        const wiggleDir = Math.sign(dx);
        if (wiggleDir !== this.lastWiggleDirection && this.lastWiggleDirection !== 0) {
          if (now - this.lastWiggleTimestamp < 450) {
            this.wiggleCounter++;
            if (this.wiggleCounter >= 3) {
              this.wiggleCounter = 0;
              this.vy = -160; // Petit bond joyeux
              this.callbacks.onCursorWiggleExcited?.();
            }
          } else {
            this.wiggleCounter = 1;
          }
          this.lastWiggleTimestamp = now;
        }
        this.lastWiggleDirection = wiggleDir;
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
    const floorY = this.getCurrentFloorY();

    if (this.isDragging) {
      this.isMoving = false;
      return;
    }

    // Redescente douce vers la ligne de sol courante (bureau ou perchoir de fenêtre)
    if (this.y < floorY - 1) {
      this.vy += 520 * safeDt;
      this.y += this.vy * safeDt;
      if (this.y >= floorY) {
        this.y = floorY;
        this.vy = 0;
        this.callbacks.onPositionChanged(this.x, this.y);
      }
    } else if (this.y > floorY + 1 && !this.isPerchingOnWindow) {
      this.y = floorY;
      this.vy = 0;
      this.callbacks.onPositionChanged(this.x, this.y);
    } else if (this.y >= floorY - 1) {
      this.y = floorY;
      this.vy = 0;
    }

    this.x = this.clampX(this.x);

    // 1) Si le familier court chercher la balle lancée (Sprint Fetch)
    if (this.isFetchingBall) {
      const sprintSpeed = Math.max(90, this.walkSpeed * 1.85);
      const diffX = this.ballTargetX - this.x;
      const absDiff = Math.abs(diffX);
      if (absDiff <= 16) {
        this.x = this.ballTargetX;
        this.isFetchingBall = false;
        this.isCarryingBall = true;
        this.targetX = null;
        this.isMoving = false;
        this.callbacks.onBallGrabbed?.();
        return;
      }
      const dir = Math.sign(diffX);
      this.flipX = dir < 0;
      this.isMoving = true;
      this.x = this.clampX(this.x + dir * Math.min(absDiff, sprintSpeed * safeDt));
      return;
    }

    // 2) Si le familier rapporte la balle au joueur
    if (this.isCarryingBall) {
      const sprintSpeed = Math.max(80, this.walkSpeed * 1.55);
      const returnTargetX =
        this.lastMouseX > 30 && this.lastMouseX < window.innerWidth - 30
          ? this.lastMouseX
          : window.innerWidth * 0.5;
      const diffX = returnTargetX - this.x;
      const absDiff = Math.abs(diffX);
      if (absDiff <= 28) {
        this.isCarryingBall = false;
        this.isMoving = false;
        this.targetX = null;
        this.aiPauseTimer = 2.4;
        this.callbacks.onBallReturned?.();
        return;
      }
      const dir = Math.sign(diffX);
      this.flipX = dir < 0;
      this.isMoving = true;
      this.x = this.clampX(this.x + dir * Math.min(absDiff, sprintSpeed * safeDt));
      return;
    }

    if (!options.canWalk || this.walkSpeed <= 0 || this.isSpongeMode) {
      this.isMoving = false;
      this.targetX = null;
      return;
    }

    // Décision autonome de percher / sauter sur la fenêtre active
    if (this.activeWindow && !this.isDragging) {
      this.perchDecisionTimer -= safeDt;
      if (this.perchDecisionTimer <= 0) {
        this.perchDecisionTimer = 16 + Math.random() * 20;
        const win = this.activeWindow;
        const isValidWindow =
          win.width >= 240 &&
          win.height >= 160 &&
          win.y >= 60 &&
          win.y < this.getGroundY() - 75;

        if (isValidWindow) {
          if (!this.isPerchingOnWindow && Math.random() < 0.65) {
            // Saut vers la bordure supérieure de la fenêtre active !
            this.isPerchingOnWindow = true;
            this.vy = -340;
            this.targetX = this.clampX(win.x + win.width * (0.25 + Math.random() * 0.5));
          } else if (this.isPerchingOnWindow && Math.random() < 0.5) {
            // Descente vers le sol du bureau
            this.isPerchingOnWindow = false;
          }
        } else if (this.isPerchingOnWindow) {
          this.isPerchingOnWindow = false;
        }
      }
    }

    // Déplacement vers la cible active
    if (this.targetX !== null) {
      const diffX = this.targetX - this.x;
      const absDiff = Math.abs(diffX);

      if (absDiff <= 4) {
        this.x = this.targetX;
        this.targetX = null;
        this.isMoving = false;
        if (this.microStepRemaining > 0) {
          this.aiPauseTimer = 0.5 + Math.random() * 0.8;
        } else {
          this.aiPauseTimer = 1.8 + Math.random() * 3.2;
        }
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

    // En pause (idle) : regarde vers le curseur si la souris s'approche (sauf s'il a une demande active !)
    this.isMoving = false;
    if (!this.hasActiveDemand) {
      const distToCursor = Math.hypot(this.lastMouseX - this.x, this.lastMouseY - this.y);
      if (distToCursor < 220 && Math.abs(this.lastMouseX - this.x) > 14) {
        this.flipX = this.lastMouseX < this.x;
      }
    }

    // Décompte avant la prochaine action autonome
    this.aiPauseTimer -= safeDt;
    if (this.aiPauseTimer <= 0) {
      const margin = this.getHorizontalMargin();
      const minX = margin;
      const maxX = Math.max(margin + 40, window.innerWidth - margin);

      // Si une série de micro-pas est en cours :
      if (this.microStepRemaining > 0) {
        this.microStepRemaining--;
        // 60% garde la même direction, 40% change pour faire un petit demi-tour mignon
        if (Math.random() < 0.4) {
          this.lastWanderDir = -this.lastWanderDir;
        }
        const stepDist = 18 + Math.random() * 38;
        this.targetX = this.clampX(this.x + this.lastWanderDir * stepDist);
        this.aiPauseTimer = 0.6 + Math.random() * 0.9;
        return;
      }

      // Décision comportementale variée :
      const roll = Math.random();

      if (roll < 0.45) {
        // 1) Quelques petits pas (micro-déplacement : 2 à 4 pas successifs de 20-45px)
        this.microStepRemaining = 1 + Math.floor(Math.random() * 3);
        this.lastWanderDir = Math.random() < 0.5 ? -1 : 1;
        const stepDist = 18 + Math.random() * 32;
        this.targetX = this.clampX(this.x + this.lastWanderDir * stepDist);
        this.aiPauseTimer = 0.7 + Math.random() * 0.8;
      } else if (roll < 0.75) {
        // 2) Trot / Marche moyenne (70 à 180 px dans une direction)
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.lastWanderDir = dir;
        const dist = 70 + Math.random() * 110;
        this.targetX = this.clampX(this.x + dir * dist);
        this.aiPauseTimer = 2.0 + Math.random() * 2.5;
      } else if (roll < 0.88) {
        // 3) Longue traversée (occasionnelle) vers une zone lointaine du bureau
        const target =
          this.x > (minX + maxX) / 2
            ? minX + Math.random() * ((maxX - minX) * 0.4)
            : maxX - Math.random() * ((maxX - minX) * 0.4);
        this.targetX = this.clampX(target);
        this.aiPauseTimer = 3.5 + Math.random() * 3.5;
      } else {
        // 4) Se retourne simplement pour observer sans bouger
        this.flipX = !this.flipX;
        this.targetX = null;
        this.aiPauseTimer = 1.5 + Math.random() * 2.0;
      }
    }
  }

  private getHorizontalMargin(): number {
    return Math.max(54, Math.round(this.getDrawSize() * 0.65));
  }

  private clampX(val: number): number {
    const margin = this.getHorizontalMargin();
    let min = margin;
    let max = Math.max(margin, window.innerWidth - margin);

    if (this.isPerchingOnWindow && this.activeWindow) {
      const winMin = Math.max(margin, this.activeWindow.x + 32);
      const winMax = Math.min(
        window.innerWidth - margin,
        this.activeWindow.x + this.activeWindow.width - 32
      );
      if (winMax > winMin + 20) {
        min = winMin;
        max = winMax;
      }
    }

    return Math.min(max, Math.max(min, Math.round(val)));
  }

  private clampY(val: number): number {
    const margin = Math.max(48, Math.round(this.getDrawSize() * 0.5));
    const max = this.getGroundY();
    return Math.min(max, Math.max(margin, Math.round(val)));
  }
}
