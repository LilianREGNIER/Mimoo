/**
 * Physique, IA de déplacement autonome sur le bureau et interactions souris
 * (Glisser-déposer réaliste avec étirement/rebond, caresse au curseur par va-et-vient,
 * brossage à l'éponge, lancer de balle et escalade sur les fenêtres actives Windows).
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
  /** Déclenché lorsque l'utilisateur caresse le familier en frottant la souris dessus avec un vrai va-et-vient. */
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
  /** Déclenché lors du relâchement après un Drag & Drop (déplacement doux, rapide ou secoué). */
  onPetDropped?: (dropType: 'gentle' | 'fast' | 'shake', x: number, y: number) => void;
  /** Déclenché lorsque le familier saute pour percher sur une fenêtre active. */
  onWindowPerchJump?: (windowTitle: string) => void;
  /** Déclenché lorsque le familier atterrit avec succès sur une fenêtre active. */
  onWindowPerchLand?: (windowTitle: string) => void;
}

/**
 * Représente l'entité physique du familier évoluant en bas du bureau ou perché sur les fenêtres.
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
  private isSleepingState = false;
  public lastCursorX = -1000;
  public lastCursorY = -1000;

  private speciesScale = 1.0;
  private userScale = 1.0;
  private walkSpeed = 50;

  // IA de marche autonome
  private targetX: number | null = null;
  private aiPauseTimer = 2.5;
  public vx = 0;
  public vy = 0;
  public isAirborne = false;
  private microStepRemaining = 0;
  private lastWanderDir = 1;

  // Interaction avec les fenêtres Windows (Perchoir / Plateforme active)
  private activeWindow: ActiveWindowInfo | null = null;
  private isPerchingOnWindow = false;
  private isJumpingToWindow = false;
  private targetPerchY = 0;
  private perchOffsetX = 80;
  private perchDecisionTimer = 35.0;
  private perchDurationTimer = 0;
  private windowJumpEnabled = true;

  // Jeu de la balle (Fetch)
  private isFetchingBall = false;
  private isCarryingBall = false;
  private ballTargetX = 0;
  private ballTargetY = 0;
  private fetchElapsedTimer = 0;

  // Détection d'agitation ludique du curseur (Wiggle)
  private lastWiggleDirection = 0;
  private wiggleCounter = 0;
  private lastWiggleTimestamp = 0;
  private lastWiggleTriggeredAt = 0;

  // Suivi souris (Drag & Drop + Étirement / Rebond réaliste)
  private pointerDown = false;
  private hasDragged = false;
  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private dragStretchX = 1.0;
  private dragStretchY = 1.0;
  private dragAngle = 0;
  private dragSpeeds: number[] = [];
  private dragShakeCounter = 0;
  private lastDragDeltaDir = 0;
  private lastDragDeltaTimestamp = 0;
  private dragHistory: { x: number; y: number; time: number }[] = [];
  private pendingDropType: 'shake' | 'fast' | 'gentle' | null = null;
  private dangleTimer = 0;

  // Caresse par frottement (mouvement réel de va-et-vient requis)
  private caressStrokeCount = 0;
  private lastCaressDirection = 0;
  private lastCaressDirectionY = 0;
  private lastCaressTimestamp = 0;
  private caressDistanceAccumulator = 0;
  private spongeDistanceAccumulator = 0;

  private readonly callbacks: PetActorCallbacks;

  constructor(initialX: number, initialY: number, callbacks: PetActorCallbacks) {
    this.callbacks = callbacks;
    const groundY = this.getGroundY();
    this.x = this.clampX(Number.isFinite(initialX) ? initialX : window.innerWidth * 0.5);
    this.y = Number.isFinite(initialY) ? Math.min(groundY, Math.max(60, initialY)) : groundY;
    this.y = groundY;
  }

  /**
   * Coordonnée Y de référence en bas du bureau (`window.innerHeight - 95`).
   */
  public getGroundY(): number {
    return Math.max(80, window.innerHeight - 95);
  }

  /**
   * Calcule la hauteur d'atterrissage sur la bordure supérieure de la fenêtre active.
   */
  public getPerchY(win: ActiveWindowInfo): number {
    return Math.max(0, Math.min(this.getGroundY() - 40, win.y));
  }

  /**
   * Retourne la ligne de sol courante (sol du bureau ou rebord de la fenêtre active).
   */
  public getCurrentFloorY(): number {
    if (this.isPerchingOnWindow && this.activeWindow && this.isValidPerchWindow(this.activeWindow)) {
      return this.getPerchY(this.activeWindow);
    }
    return this.getGroundY();
  }

  /**
   * Vérifie si les dimensions et le titre de la fenêtre active correspondent à une vraie fenêtre utilisateur.
   */
  public isValidPerchWindow(win: ActiveWindowInfo | null): boolean {
    if (!win) return false;
    if (win.width < 160 || win.height < 100) return false;
    // Vérifie que la barre de titre de la fenêtre est réellement visible sur l'écran actif du familier
    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const screenH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    if (win.y < 20 || win.y > screenH - 95) return false;
    const visibleWidth = Math.min(win.x + win.width, screenW) - Math.max(win.x, 0);
    if (visibleWidth < 120) return false;
    const title = win.title.trim();
    if (!title || title === 'Program Manager' || title === 'Desktop') return false;
    if (title.indexOf('Mimoo') >= 0 || title.indexOf('Tamagotchi') >= 0) return false;
    return true;
  }

  /**
   * Notifie l'acteur de la géométrie de la fenêtre active au premier plan sous Windows.
   */
  public setActiveWindow(info: ActiveWindowInfo | null): void {
    if (info && this.isValidPerchWindow(info)) {
      this.activeWindow = info;
      if (this.isPerchingOnWindow && !this.isDragging && !this.isAirborne) {
        // Suit instantanément le déplacement de la fenêtre en temps réel au pixel près
        // sans dériver ni subir de clamping artificiel contre les bords de l'écran
        if (this.perchOffsetX > info.width - 35) {
          this.perchOffsetX = Math.max(35, info.width - 35);
        }
        this.x = Math.round(info.x + this.perchOffsetX);
        this.y = this.getPerchY(info);
      }
    } else {
      this.activeWindow = null;
      if (this.isPerchingOnWindow) {
        this.hopDownFromWindow();
      }
    }
  }

  public getIsPerchingOnWindow(): boolean {
    return this.isPerchingOnWindow;
  }

  public getActiveWindow(): ActiveWindowInfo | null {
    return this.activeWindow;
  }

  public shiftPerchWindow(dx: number, dy: number): void {
    if (!this.isPerchingOnWindow || !this.activeWindow) return;
    this.activeWindow.x += dx;
    this.activeWindow.y += dy;
    this.x += dx;
    this.y += dy;
  }

  public setWindowJumpEnabled(enabled: boolean): void {
    this.windowJumpEnabled = enabled;
    if (!enabled && (this.isPerchingOnWindow || this.isJumpingToWindow)) {
      this.hopDownFromWindow();
    }
  }

  public getWindowJumpEnabled(): boolean {
    return this.windowJumpEnabled;
  }

  public getIsJumpingToWindow(): boolean {
    return this.isJumpingToWindow;
  }

  public getIsFetchingBall(): boolean {
    return this.isFetchingBall;
  }

  public getIsCarryingBall(): boolean {
    return this.isCarryingBall;
  }

  public getDragStretchX(): number {
    return this.dragStretchX;
  }

  public getDragStretchY(): number {
    return this.dragStretchY;
  }

  public getDragAngle(): number {
    return this.dragAngle;
  }

  /**
   * Fait bondir le familier sur le bord supérieur de la fenêtre active via une trajectoire parabolique cinématique fluide.
   */
  public jumpToWindow(win: ActiveWindowInfo): void {
    if (!this.isValidPerchWindow(win)) return;
    const targetY = this.getPerchY(win);

    const minX = Math.max(30, win.x + 35);
    const maxX = Math.min(window.innerWidth - 30, win.x + win.width - 35);
    const targetWinX = minX < maxX ? minX + Math.random() * (maxX - minX) : win.x + win.width / 2;
    const targetX = this.clampX(targetWinX);
    this.perchOffsetX = Math.max(35, Math.min(win.width - 35, targetX - win.x));

    const startX = this.x;
    const startY = this.y;
    const deltaY = startY - targetY;
    const gravity = 980;

    // Hauteur d'apex au-dessus du point le plus haut de la trajectoire
    const hopApex = Math.max(45, Math.min(160, Math.max(0, deltaY) * 0.18 + 45));
    const apexY = Math.min(startY, targetY) - hopApex;

    // Vitesse verticale initiale pour atteindre apexY
    const initialVy = -Math.sqrt(2 * gravity * Math.max(12, startY - apexY));

    // Durée de montée et de descente
    const tUp = Math.abs(initialVy) / gravity;
    const tDown = Math.sqrt((2 * Math.max(12, targetY - apexY)) / gravity);
    const totalDuration = Math.max(0.3, tUp + tDown);

    // Vitesse horizontale constante synchronisée sur la durée exacte du saut
    const initialVx = (targetX - startX) / totalDuration;

    this.vx = initialVx;
    this.vy = initialVy;
    this.targetPerchY = targetY;
    this.targetX = targetX;
    this.isJumpingToWindow = true;
    this.isPerchingOnWindow = false;
    this.isAirborne = false;
    this.flipX = this.vx < 0;
    this.perchDurationTimer = 16 + Math.random() * 14;
    this.callbacks.onWindowPerchJump?.(win.title);
  }

  /**
   * Fait redescendre le familier vers le sol du bureau.
   */
  public hopDownFromWindow(): void {
    this.isPerchingOnWindow = false;
    this.isJumpingToWindow = false;
    this.perchDecisionTimer = 45 + Math.random() * 45; // Cooldown généreux de 45 à 90s avant de pouvoir remonter
    this.vy = 40;
  }

  /**
   * Déclenche immédiatement l'escalade sur la fenêtre active (utile pour tests / boutons).
   */
  public forcePerchOnActiveWindow(): boolean {
    if (!this.activeWindow || !this.isValidPerchWindow(this.activeWindow)) {
      return false;
    }
    this.jumpToWindow(this.activeWindow);
    return true;
  }

  public startFetchingBall(ballX: number, ballY: number): void {
    this.isFetchingBall = true;
    this.isCarryingBall = false;
    this.fetchElapsedTimer = 0;
    this.ballTargetX = ballX;
    this.ballTargetY = ballY;
    this.targetX = this.clampX(ballX);
    this.isPerchingOnWindow = false;
    this.isJumpingToWindow = false;
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
    this.fetchElapsedTimer = 0;
  }

  public setScales(speciesScale: number, userScale: number): void {
    this.speciesScale = Number.isFinite(speciesScale) && speciesScale > 0 ? speciesScale : 1.0;
    this.userScale = Number.isFinite(userScale) && userScale > 0 ? userScale : 1.0;
  }

  public setWalkSpeed(speed: number): void {
    this.walkSpeed = Number.isFinite(speed) && speed > 0 ? speed : 50;
  }

  public getEffectiveScale(): number {
    return this.speciesScale * this.userScale;
  }

  public getDrawSize(): number {
    return Math.round(SPRITE_FRAME_WIDTH * 1.25 * this.getEffectiveScale());
  }

  public getBoundingBox(padding = 0): BoundingBox {
    const size = this.getDrawSize() + padding * 2;
    return {
      x: Math.round(this.x - size / 2),
      y: Math.round(this.y - size / 2),
      width: size,
      height: size,
    };
  }

  public containsPoint(clientX: number, clientY: number, padding = 0): boolean {
    const box = this.getBoundingBox(padding);
    return (
      clientX >= box.x &&
      clientX <= box.x + box.width &&
      clientY >= box.y &&
      clientY <= box.y + box.height
    );
  }

  public stopWalking(): void {
    this.targetX = null;
    this.isMoving = false;
    this.aiPauseTimer = 2.0;
  }

  public centerOnScreen(): void {
    this.x = Math.round(window.innerWidth * 0.5);
    this.y = this.getGroundY();
    this.targetX = null;
    this.isMoving = false;
    this.isPerchingOnWindow = false;
    this.isJumpingToWindow = false;
    this.vy = 0;
    this.callbacks.onPositionChanged(this.x, this.y);
  }

  public setPosition(x: number, y?: number): void {
    this.x = this.clampX(x);
    if (typeof y === 'number' && Number.isFinite(y)) {
      this.y = this.clampY(y);
    }
    this.targetX = null;
    this.isMoving = false;
  }

  public moveTo(x: number): void {
    if (this.isDragging) {
      return;
    }
    this.targetX = this.clampX(x);
  }

  public walkToward(x: number): void {
    this.moveTo(x);
  }

  public setHasActiveDemand(value: boolean): void {
    this.hasActiveDemand = value;
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
    this.dragSpeeds = [];
    this.dragShakeCounter = 0;
    this.lastDragDeltaDir = 0;
    this.lastDragDeltaTimestamp = performance.now();
    this.dragHistory = [{ x: clientX, y: clientY, time: performance.now() }];
    this.vx = 0;
    this.vy = 0;
    this.isAirborne = false;
    return true;
  }

  /**
   * Gère le déplacement du curseur (Drag & Drop, survol, caresse douce et éponge).
   */
  public handlePointerMove(clientX: number, clientY: number): void {
    const dx = clientX - this.lastMouseX;
    const dy = clientY - this.lastMouseY;
    this.lastMouseX = clientX;
    this.lastMouseY = clientY;
    this.lastCursorX = clientX;
    this.lastCursorY = clientY;

    // Mode Éponge / Brosse : simple passage en va-et-vient sur la zone du familier
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

    // Gestion du Glisser-Déposer (Drag & Drop)
    if (this.pointerDown) {
      const now = performance.now();
      const distFromStart = Math.hypot(
        clientX - this.dragStartClientX,
        clientY - this.dragStartClientY
      );
      if (distFromStart > 5) {
        this.isDragging = true;
        this.hasDragged = true;
        this.targetX = null;
        this.isMoving = false;
        this.isPerchingOnWindow = false;
        this.isJumpingToWindow = false;
        this.isAirborne = false;
      }

      if (this.isDragging) {
        this.x = this.clampX(clientX + this.dragOffsetX);
        this.y = this.clampY(clientY + this.dragOffsetY);

        // Historique temporel pour vitesse de lancer (Throw / Fling)
        this.dragHistory.push({ x: clientX, y: clientY, time: now });
        if (this.dragHistory.length > 16) {
          this.dragHistory.shift();
        }

        const instantSpeed = Math.hypot(dx, dy);
        this.dragSpeeds.push(instantSpeed);
        if (this.dragSpeeds.length > 8) {
          this.dragSpeeds.shift();
        }

        let cursorVx = 0;
        let cursorVy = 0;
        if (this.dragHistory.length >= 2) {
          const first = this.dragHistory[0];
          const last = this.dragHistory[this.dragHistory.length - 1];
          const dtSec = Math.max(0.016, (last.time - first.time) / 1000);
          cursorVx = (last.x - first.x) / dtSec;
          cursorVy = (last.y - first.y) / dtSec;
        }

        const speed = Math.hypot(cursorVx, cursorVy);

        // Dynamique d'étirement élastique et organique (type gelée / mochi) :
        if (speed > 80) {
          const horizFactor = Math.min(0.22, Math.abs(cursorVx) * 0.0002);
          const vertFactor = Math.min(0.24, Math.abs(cursorVy) * 0.00022);
          const targetStretchX = Math.max(0.72, Math.min(1.28, 1.0 + horizFactor - vertFactor * 0.65));
          const targetStretchY = Math.max(0.72, Math.min(1.28, 1.0 + vertFactor - horizFactor * 0.65));
          // En Canvas 2D, un angle positif incline le haut vers la droite et fait traîner le bas vers la gauche
          const targetAngle = Math.max(-0.32, Math.min(0.32, cursorVx * 0.00028));
          this.dragStretchY += (targetStretchY - this.dragStretchY) * 0.35;
          this.dragStretchX += (targetStretchX - this.dragStretchX) * 0.35;
          this.dragAngle += (targetAngle - this.dragAngle) * 0.35;
        } else {
          // Suspendu presque immobile dans les airs : petit balancement mignon
          this.dangleTimer += 0.09;
          const dangleSway = Math.sin(this.dangleTimer * 4.5) * 0.06;
          const targetStretchY = 1.08;
          const targetStretchX = 0.94;
          this.dragStretchY += (targetStretchY - this.dragStretchY) * 0.18;
          this.dragStretchX += (targetStretchX - this.dragStretchX) * 0.18;
          this.dragAngle += (dangleSway - this.dragAngle) * 0.22;
        }

        // Détection de secousses (va-et-vient rapides gauche/droite)
        if (Math.abs(dx) >= 7) {
          const dir = Math.sign(dx);
          if (dir !== this.lastDragDeltaDir && this.lastDragDeltaDir !== 0) {
            if (now - this.lastDragDeltaTimestamp < 380) {
              this.dragShakeCounter++;
            }
          }
          this.lastDragDeltaDir = dir;
          this.lastDragDeltaTimestamp = now;
        }

        if (Math.abs(dx) > 1.2) {
          this.flipX = dx < 0;
        }
        return;
      }
    }

    const hoveringNow = this.containsPoint(clientX, clientY, 14);

    if (this.hasActiveDemand) {
      this.isHovering = false;
      this.caressDistanceAccumulator = 0;
      this.caressStrokeCount = 0;
      return;
    }

    this.isHovering = hoveringNow;

    // Détection de la vraie caresse au curseur :
    // Nécessite un va-et-vient horizontal, vertical ou diagonal (avec tolérance si on sort un peu du cadre)
    const distToCursorForCaress = Math.hypot(clientX - this.x, clientY - this.y);
    const totalScale = Math.max(0.75, this.speciesScale * this.userScale);
    const isCaressZone =
      hoveringNow ||
      ((this.caressStrokeCount > 0 || this.caressDistanceAccumulator > 0) &&
        distToCursorForCaress <= 72 * totalScale);

    if (isCaressZone && !this.pointerDown) {
      const now = performance.now();
      const stepDist = Math.hypot(dx, dy);

      if (stepDist >= 1.2 && stepDist <= 38) {
        if (Math.abs(dx) >= 2.5) {
          const currentDirX = Math.sign(dx);
          if (currentDirX !== this.lastCaressDirection && this.lastCaressDirection !== 0) {
            if (now - this.lastCaressTimestamp < 1200) {
              this.caressStrokeCount++;
            }
          }
          this.lastCaressDirection = currentDirX;
          this.lastCaressTimestamp = now;
        }
        if (Math.abs(dy) >= 2.5) {
          const currentDirY = Math.sign(dy);
          if (currentDirY !== this.lastCaressDirectionY && this.lastCaressDirectionY !== 0) {
            if (now - this.lastCaressTimestamp < 1200) {
              this.caressStrokeCount++;
            }
          }
          this.lastCaressDirectionY = currentDirY;
          this.lastCaressTimestamp = now;
        }

        if (now - this.lastCaressTimestamp > 1800) {
          this.caressDistanceAccumulator = 0;
          this.caressStrokeCount = 0;
        }

        this.caressDistanceAccumulator += stepDist;

        if (this.caressStrokeCount >= 3 && this.caressDistanceAccumulator >= 160) {
          this.caressStrokeCount = 0;
          this.caressDistanceAccumulator = 0;
          this.callbacks.onPetRub(this.x, this.y);
        }
      }
    }

    // Détection d'agitation ludique du curseur devant le familier (Wiggle)
    // Uniquement à l'extérieur du corps du familier (sinon les caresses déclenchent aussi le wiggle)
    const distToCursor = Math.hypot(clientX - this.x, clientY - this.y);
    if (hoveringNow || isCaressZone) {
      this.wiggleCounter = 0;
      this.lastWiggleDirection = 0;
    } else if (distToCursor < 140 && !this.pointerDown && !this.hasActiveDemand && !this.isSleepingState) {
      const now = performance.now();
      if (
        now - this.lastCaressTimestamp >= 1500 &&
        now - this.lastWiggleTriggeredAt >= 6000 &&
        Math.abs(dx) > 3.5
      ) {
        const wiggleDir = Math.sign(dx);
        if (wiggleDir !== this.lastWiggleDirection && this.lastWiggleDirection !== 0) {
          if (now - this.lastWiggleTimestamp < 450) {
            this.wiggleCounter++;
            if (this.wiggleCounter >= 3) {
              this.wiggleCounter = 0;
              this.lastWiggleTriggeredAt = now;
              this.vy = -160;
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
    const shakeCount = this.dragShakeCounter;
    const maxSpeed = this.dragSpeeds.length > 0 ? Math.max(...this.dragSpeeds) : 0;
    const floorY = this.getCurrentFloorY();

    this.pointerDown = false;
    this.isDragging = false;
    this.hasDragged = false;
    this.dragShakeCounter = 0;
    this.dragSpeeds = [];

    if (wasDragged) {
      let throwVx = 0;
      let throwVy = 0;
      const now = performance.now();
      // On prend les points récents des dernières 85 ms pour capter fidèlement le coup de poignet (flick) de relâchement
      const recentPoints = this.dragHistory.filter((p) => now - p.time <= 85);
      const pointsToUse = recentPoints.length >= 2 ? recentPoints : this.dragHistory;

      if (pointsToUse.length >= 2) {
        const first = pointsToUse[0];
        const last = pointsToUse[pointsToUse.length - 1];
        const dtSec = Math.max(0.012, (last.time - first.time) / 1000);
        if (now - last.time < 160) {
          throwVx = (last.x - first.x) / dtSec;
          throwVy = (last.y - first.y) / dtSec;
        }
      }
      this.dragHistory = [];

      // Multiplicateur dynamique pour amplifier la sensation de lancer (throw fling power)
      const FLING_BOOST = 1.45;
      throwVx *= FLING_BOOST;
      throwVy *= FLING_BOOST;

      const throwSpeed = Math.hypot(throwVx, throwVy);
      let dropType: 'shake' | 'fast' | 'gentle' = 'gentle';
      if (shakeCount >= 4) {
        dropType = 'shake';
      } else if (throwSpeed > 420 || maxSpeed > 16) {
        dropType = 'fast';
      } else {
        dropType = 'gentle';
      }
      this.pendingDropType = dropType;

      const isThrownOrHigh = throwSpeed > 75 || this.y < floorY - 10;
      if (isThrownOrHigh) {
        // ENTRÉE EN VOL BALISTIQUE SOUS GRAVITÉ (Lancé / Jeté) !
        this.isAirborne = true;
        this.vx = Math.max(-1850, Math.min(1850, throwVx));
        this.vy = Math.max(-1750, Math.min(1500, throwVy));
        if (Math.abs(this.vx) > 25) {
          this.flipX = this.vx < 0;
        }
      } else {
        // Posé calmement au sol
        this.y = floorY;
        this.vx = 0;
        this.vy = 0;
        this.isAirborne = false;
        this.perchDecisionTimer = 50 + Math.random() * 30; // Long cooldown après avoir été posé au sol
        this.dragStretchY = 0.76;
        this.dragStretchX = 1.24;
        this.callbacks.onPositionChanged(this.x, this.y);
        this.callbacks.onPetDropped?.(dropType, this.x, this.y);
        this.pendingDropType = null;
      }
    } else {
      this.callbacks.onClick();
    }
  }

  /**
   * Met à jour la physique (vol balistique avec gravité, chute, rebonds et IA autonome).
   */
  public update(dtSeconds: number, options: { canWalk: boolean; isSleeping?: boolean }): void {
    const safeDt = Math.min(0.1, Math.max(0, dtSeconds));
    const floorY = this.getCurrentFloorY();
    this.isSleepingState = Boolean(options.isSleeping);

    // Retour progressif des dimensions de squash & stretch vers 1.0
    if (!this.isDragging) {
      const springK = Math.min(1, 12 * safeDt);
      this.dragStretchX += (1.0 - this.dragStretchX) * springK;
      this.dragStretchY += (1.0 - this.dragStretchY) * springK;
      this.dragAngle += (0 - this.dragAngle) * Math.min(1, 12 * safeDt);
    }

    if (this.isDragging) {
      this.isMoving = false;
      return;
    }

    // 0) Physique de vol libre & gravité réelle (familier jeté / lancé ou en chute)
    if (this.isAirborne) {
      const gravity = 920; // px/s^2
      this.vy += gravity * safeDt;
      this.vx *= Math.pow(0.86, safeDt * 10);

      this.x += this.vx * safeDt;
      this.y += this.vy * safeDt;

      // Rebond élastique sur les parois latérales de l'écran
      const minX = 35;
      const maxX = window.innerWidth - 35;
      if (this.x <= minX) {
        this.x = minX;
        this.vx = -this.vx * 0.65;
        this.dragStretchX = 0.72;
        this.dragStretchY = 1.28;
      } else if (this.x >= maxX) {
        this.x = maxX;
        this.vx = -this.vx * 0.65;
        this.dragStretchX = 0.72;
        this.dragStretchY = 1.28;
      }

      // Rebond sur le haut de l'écran
      if (this.y <= 30) {
        this.y = 30;
        this.vy = Math.abs(this.vy) * 0.55;
      }

      // Déformation dynamique selon la trajectoire de vol
      const flightSpeed = Math.hypot(this.vx, this.vy);
      const targetStretchY = 1.0 + Math.min(0.38, flightSpeed * 0.0003);
      const targetStretchX = Math.max(0.66, 1.0 / targetStretchY);
      const targetAngle = Math.max(-0.45, Math.min(0.45, this.vx * 0.00032));
      this.dragStretchY += (targetStretchY - this.dragStretchY) * Math.min(1, 14 * safeDt);
      this.dragStretchX += (targetStretchX - this.dragStretchX) * Math.min(1, 14 * safeDt);
      this.dragAngle += (targetAngle - this.dragAngle) * Math.min(1, 14 * safeDt);
      if (Math.abs(this.vx) > 20) {
        this.flipX = this.vx < 0;
      }

      // Détection d'atterrissage sur le perchoir de la fenêtre active
      if (this.activeWindow && this.isValidPerchWindow(this.activeWindow) && this.vy > 0) {
        const perchY = this.getPerchY(this.activeWindow);
        const winMinX = Math.max(20, this.activeWindow.x);
        const winMaxX = Math.min(window.innerWidth - 20, this.activeWindow.x + this.activeWindow.width);
        if (Math.abs(this.y - perchY) <= 22 && this.x >= winMinX && this.x <= winMaxX) {
          this.y = perchY;
          this.vy = 0;
          this.vx = 0;
          this.isAirborne = false;
          this.isPerchingOnWindow = true;
          this.targetPerchY = perchY;
          this.perchOffsetX = Math.max(35, Math.min(this.activeWindow.width - 35, this.x - this.activeWindow.x));
          this.perchDurationTimer = 16 + Math.random() * 12;
          this.dragStretchY = 0.74;
          this.dragStretchX = 1.26;
          this.callbacks.onPositionChanged(this.x, this.y);
          this.callbacks.onWindowPerchLand?.(this.activeWindow.title);
          this.pendingDropType = null;
          return;
        }
      }

      // Atterrissage et rebond sur le sol
      if (this.y >= floorY) {
        this.y = floorY;
        if (Math.abs(this.vy) > 130) {
          // Rebond comique et élastique
          this.vy = -this.vy * 0.42;
          this.vx *= 0.62;
          this.dragStretchY = Math.max(0.52, 1.0 - Math.abs(this.vy) * 0.001);
          this.dragStretchX = Math.min(1.48, 1.0 + Math.abs(this.vy) * 0.001);
        } else {
          // Stabilisation au sol
          this.vy = 0;
          this.vx = 0;
          this.isAirborne = false;
          this.perchDecisionTimer = 45 + Math.random() * 30; // Long cooldown après atterrissage au sol
          this.dragStretchY = 0.76;
          this.dragStretchX = 1.24;
          this.callbacks.onPositionChanged(this.x, this.y);
          if (this.pendingDropType) {
            this.callbacks.onPetDropped?.(this.pendingDropType, this.x, this.y);
            this.pendingDropType = null;
          }
        }
      }
      return;
    }

    // Immobilisation complète pendant le sommeil (aucune marche, poursuite de balle ou saut autonome)
    if (this.isSleepingState) {
      this.isFetchingBall = false;
      this.isCarryingBall = false;
      this.fetchElapsedTimer = 0;
      this.targetX = null;
      this.microStepRemaining = 0;
      this.isMoving = false;
      this.vx = 0;
      if (this.isJumpingToWindow) {
        this.isJumpingToWindow = false;
        this.isAirborne = this.y < floorY;
      }
      if (!this.isPerchingOnWindow && !this.isAirborne && this.y !== floorY) {
        this.y = floorY;
      }
      return;
    }

    // 1) Saut en arc parabolique cinématique fluide vers le perchoir de la fenêtre active
    if (this.isJumpingToWindow) {
      const gravity = 980;
      this.vy += gravity * safeDt;
      this.x += this.vx * safeDt;
      this.y += this.vy * safeDt;

      // Orientation fluide selon la direction horizontale
      if (Math.abs(this.vx) > 10) {
        this.flipX = this.vx < 0;
      }

      // Squash and stretch dynamique pendant le saut
      const jumpSpeed = Math.hypot(this.vx, this.vy);
      const targetStretchY = 1.0 + Math.min(0.28, jumpSpeed * 0.00025);
      const targetStretchX = Math.max(0.72, 1.0 / targetStretchY);
      this.dragStretchY += (targetStretchY - this.dragStretchY) * Math.min(1, 14 * safeDt);
      this.dragStretchX += (targetStretchX - this.dragStretchX) * Math.min(1, 14 * safeDt);

      // Si la fenêtre bouge pendant le saut, on maintient la hauteur du perchoir à jour
      if (this.activeWindow && this.isValidPerchWindow(this.activeWindow)) {
        this.targetPerchY = this.getPerchY(this.activeWindow);
      }

      // Atterrissage fluide dès que la descente atteint ou dépasse le haut de la fenêtre
      if (this.vy >= 0 && this.y >= this.targetPerchY) {
        this.y = this.targetPerchY;
        if (this.activeWindow && this.isValidPerchWindow(this.activeWindow)) {
          this.x = Math.round(this.activeWindow.x + this.perchOffsetX);
        } else if (this.targetX !== null) {
          this.x = this.targetX;
        }
        this.vx = 0;
        this.vy = 0;
        this.isJumpingToWindow = false;
        this.isPerchingOnWindow = true;
        this.targetX = null;
        this.dragStretchY = 0.78;
        this.dragStretchX = 1.22;
        this.callbacks.onPositionChanged(this.x, this.y);
        this.callbacks.onWindowPerchLand?.(this.activeWindow?.title ?? '');
      }
      return;
    }

    // 2) Si le familier est perché sur la fenêtre active
    if (this.isPerchingOnWindow) {
      if (!this.activeWindow || !this.isValidPerchWindow(this.activeWindow)) {
        this.hopDownFromWindow();
      } else {
        // Suit fidèlement la fenêtre (X et Y) lors de son déplacement en direct
        this.targetPerchY = this.getPerchY(this.activeWindow);
        this.y = this.targetPerchY;
        this.x = Math.round(this.activeWindow.x + this.perchOffsetX);

        this.perchDurationTimer -= safeDt;
        if (this.perchDurationTimer <= 0) {
          this.hopDownFromWindow();
        }
      }
      this.isMoving = false;
      this.targetX = null;
      return;
    } else {
      // 3) Redescente douce vers le sol du bureau
      if (this.y < floorY - 1) {
        this.vy += 650 * safeDt;
        this.y += this.vy * safeDt;
        if (this.y >= floorY) {
          this.y = floorY;
          this.vy = 0;
          this.callbacks.onPositionChanged(this.x, this.y);
        }
      } else if (this.y > floorY + 1) {
        this.y = floorY;
        this.vy = 0;
        this.callbacks.onPositionChanged(this.x, this.y);
      } else {
        this.y = floorY;
        this.vy = 0;
      }
    }

    this.x = this.clampX(this.x);

    // 4) Si le familier court chercher la balle lancée (Sprint Fetch)
    if (this.isFetchingBall) {
      this.fetchElapsedTimer += safeDt;
      const sprintSpeed = Math.max(140, this.walkSpeed * 2.4);
      const diffX = this.ballTargetX - this.x;
      const diffY = this.ballTargetY - this.y;
      const absDiffX = Math.abs(diffX);
      const absDiffY = Math.abs(diffY);
      const distToBall = Math.hypot(diffX, diffY);

      // Condition physique réelle pour attraper la balle :
      // 1. Un délai minimum de 0.20s s'est écoulé depuis le lancer (évite l'interception instantanée dès le lâcher)
      // 2. La balle est à portée physique directe du familier (au sol ou rase-motte, JAMAIS en altitude au-dessus)
      const isReachable =
        this.fetchElapsedTimer >= 0.2 &&
        (distToBall <= 30 || (absDiffX <= 22 && absDiffY <= 32));

      if (isReachable) {
        this.x = this.clampX(this.ballTargetX);
        this.isFetchingBall = false;
        this.isCarryingBall = true;
        this.targetX = null;
        this.isMoving = false;
        this.callbacks.onBallGrabbed?.();
        return;
      }

      // Si la balle n'est pas encore attrapable (ex: elle vole haut dans les airs au-dessus de lui),
      // le familier court en sprint vers la coordonnée X de la balle pour la suivre et se poster à sa retombée !
      const dir = Math.sign(diffX);
      if (dir !== 0) {
        this.flipX = dir < 0;
      }
      this.isMoving = true;
      if (absDiffX > 8) {
        this.x = this.clampX(this.x + dir * Math.min(absDiffX, sprintSpeed * safeDt));
      }
      return;
    }

    // 5) Si le familier rapporte la balle au joueur
    if (this.isCarryingBall) {
      const sprintSpeed = Math.max(100, this.walkSpeed * 1.85);
      const hasMousePos = this.lastMouseX > 0 || this.lastMouseY > 0;
      const returnTargetX =
        hasMousePos && this.lastMouseX > 40 && this.lastMouseX < window.innerWidth - 40
          ? this.lastMouseX
          : window.innerWidth * 0.5;
      const diffX = returnTargetX - this.x;
      const absDiff = Math.abs(diffX);
      const totalScale = Math.max(0.75, this.speciesScale * this.userScale);
      const touchRadiusX = 32 * totalScale;
      const touchRadiusY = 40 * totalScale;
      const isMouseTouchingPet =
        hasMousePos &&
        Math.abs(this.lastMouseX - this.x) <= touchRadiusX &&
        Math.abs(this.lastMouseY - this.y) <= touchRadiusY;

      if (isMouseTouchingPet) {
        this.isCarryingBall = false;
        this.isMoving = false;
        this.targetX = null;
        this.aiPauseTimer = 2.4;
        this.callbacks.onBallReturned?.();
        return;
      }

      if (absDiff <= 10) {
        // Arrivé sous le curseur : attend que la souris descende réellement toucher le familier
        this.isMoving = false;
        return;
      }

      const dir = Math.sign(diffX);
      if (dir !== 0) {
        this.flipX = dir < 0;
      }
      this.isMoving = true;
      this.x = this.clampX(this.x + dir * Math.min(absDiff, sprintSpeed * safeDt));
      return;
    }

    if (!options.canWalk || this.walkSpeed <= 0 || this.isSpongeMode) {
      this.isMoving = false;
      this.targetX = null;
      this.microStepRemaining = 0;
      return;
    }

    // 6) Décision autonome de grimper sur la fenêtre active (rare et naturelle)
    if (
      this.windowJumpEnabled &&
      this.activeWindow &&
      !this.isDragging &&
      !this.isPerchingOnWindow &&
      !this.isJumpingToWindow
    ) {
      if (this.isValidPerchWindow(this.activeWindow)) {
        this.perchDecisionTimer -= safeDt;
        if (this.perchDecisionTimer <= 0) {
          // Prochaine tentative dans 35 à 70 secondes
          this.perchDecisionTimer = 35 + Math.random() * 35;
          // Seulement 35 % de chance de monter (événement occasionnel, pas systématique)
          if (Math.random() < 0.35) {
            this.jumpToWindow(this.activeWindow);
            return;
          }
        }
      }
    }

    // 7) Déplacement vers la cible active
    if (this.targetX !== null) {
      const diffX = this.targetX - this.x;
      const absDiff = Math.abs(diffX);

      if (absDiff <= 4) {
        this.x = this.targetX;
        this.targetX = null;
        this.isMoving = false;
        if (this.microStepRemaining > 0) {
          this.aiPauseTimer = 0.4 + Math.random() * 0.6;
        } else {
          this.aiPauseTimer = 1.1 + Math.random() * 1.9;
        }
        this.callbacks.onPositionChanged(this.x, this.y);
      } else {
        const dir = Math.sign(diffX);
        this.flipX = dir < 0;
        this.isMoving = true;
        const effectiveSpeed = Math.max(48, this.walkSpeed);
        const step = Math.min(absDiff, effectiveSpeed * safeDt);
        this.x = this.clampX(this.x + dir * step);
      }
      return;
    }

    // En pause (idle) : regarde vers le curseur si la souris s'approche
    this.isMoving = false;
    if (!this.hasActiveDemand) {
      const distToCursor = Math.hypot(this.lastMouseX - this.x, this.lastMouseY - this.y);
      if (distToCursor < 220 && Math.abs(this.lastMouseX - this.x) > 14) {
        this.flipX = this.lastMouseX < this.x;
      }
    }

    // Décompte avant la prochaine action de marche ou saut autonome
    this.aiPauseTimer -= safeDt;
    if (this.aiPauseTimer <= 0) {
      const margin = this.getHorizontalMargin();
      const minX = margin;
      const maxX = Math.max(margin + 40, window.innerWidth - margin);

      if (this.microStepRemaining > 0) {
        this.microStepRemaining--;
        if (Math.random() < 0.35) {
          this.lastWanderDir = -this.lastWanderDir;
        }
        const stepDist = 45 + Math.random() * 65;
        this.targetX = this.clampX(this.x + this.lastWanderDir * stepDist);
        this.aiPauseTimer = 0.5 + Math.random() * 0.7;
        return;
      }

      const roll = Math.random();

      if (roll < 0.22 && !this.isPerchingOnWindow && !this.isJumpingToWindow) {
        // Petit saut joyeux autonome sur le bureau
        const jumpDir = Math.random() < 0.5 ? -1 : 1;
        this.flipX = jumpDir < 0;
        this.lastWanderDir = jumpDir;
        this.vx = jumpDir * (65 + Math.random() * 75);
        this.vy = -(260 + Math.random() * 110);
        this.isAirborne = true;
        this.isMoving = false;
        this.targetX = null;
        this.aiPauseTimer = 1.4 + Math.random() * 1.6;
      } else if (roll < 0.52) {
        this.microStepRemaining = 1 + Math.floor(Math.random() * 2);
        this.lastWanderDir = Math.random() < 0.5 ? -1 : 1;
        const stepDist = 55 + Math.random() * 75;
        this.targetX = this.clampX(this.x + this.lastWanderDir * stepDist);
        this.aiPauseTimer = 0.6 + Math.random() * 0.7;
      } else if (roll < 0.85) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.lastWanderDir = dir;
        const dist = 110 + Math.random() * 180;
        this.targetX = this.clampX(this.x + dir * dist);
        this.aiPauseTimer = 1.6 + Math.random() * 1.8;
      } else {
        const target =
          this.x > (minX + maxX) / 2
            ? minX + Math.random() * ((maxX - minX) * 0.4)
            : maxX - Math.random() * ((maxX - minX) * 0.4);
        this.targetX = this.clampX(target);
        this.aiPauseTimer = 2.0 + Math.random() * 2.2;
      }
    }
  }

  private getHorizontalMargin(): number {
    return Math.max(54, Math.round(this.getDrawSize() * 0.65));
  }

  private clampX(val: number): number {
    const margin = this.getHorizontalMargin();
    const min = margin;
    const max = Math.max(margin, window.innerWidth - margin);
    return Math.min(max, Math.max(min, val));
  }

  private clampY(val: number): number {
    const margin = Math.max(48, Math.round(this.getDrawSize() * 0.5));
    const max = this.getGroundY();
    return Math.min(max, Math.max(margin, val));
  }
}
