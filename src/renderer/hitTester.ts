/**
 * Système de Hit-Testing pour le click-through sélectif sur l'overlay transparent Electron.
 * N'appelle `window.petAPI.setIgnoreMouseEvents` que lors d'un changement d'état (`isInteractive`)
 * afin d'éliminer tout trafic IPC superflu.
 */

import type { PetActor } from './petActor';

export interface HitTestTargetProvider {
  /** Référence vers l'acteur du familier. */
  petActor: PetActor;
  /** Teste si le curseur survole une étoile active du mini-jeu Attrape-Étoile. */
  isPointOverMiniGameStar: (clientX: number, clientY: number) => boolean;
}

/**
 * Contrôle dynamiquement si la fenêtre transparente laisse passer les clics vers le bureau Windows
 * ou capture les événements souris sur le familier, les étoiles de mini-jeu et les panneaux UI.
 */
export class HitTester {
  private readonly provider: HitTestTargetProvider;
  private lastInteractiveState: boolean | null = null;
  private lastClientX = -1000;
  private lastClientY = -1000;

  constructor(provider: HitTestTargetProvider) {
    this.provider = provider;
  }

  /**
   * Évalue si la coordonnée `(clientX, clientY)` correspond à une zone interactive
   * et synchronise `window.petAPI.setIgnoreMouseEvents(!isInteractive, true)` si nécessaire.
   */
  public evaluateAt(clientX: number, clientY: number): boolean {
    this.lastClientX = clientX;
    this.lastClientY = clientY;

    const isInteractive = this.computeIsInteractive(clientX, clientY);
    this.applyInteractiveState(isInteractive);
    return isInteractive;
  }

  /**
   * Réévalue l'état d'interactivité à la dernière position connue du curseur
   * (utile à l'ouverture ou à la fermeture d'un panneau UI).
   */
  public refresh(): boolean {
    return this.evaluateAt(this.lastClientX, this.lastClientY);
  }

  /**
   * Force immédiatement l'état interactif ou click-through (uniquement si différent de l'état actuel).
   */
  public applyInteractiveState(isInteractive: boolean): void {
    if (this.lastInteractiveState === isInteractive) {
      return;
    }
    this.lastInteractiveState = isInteractive;
    void window.petAPI?.setIgnoreMouseEvents(!isInteractive, true);
  }

  /**
   * Retourne le dernier état d'interactivité calculé.
   */
  public isCurrentlyInteractive(): boolean {
    return this.lastInteractiveState === true;
  }

  private computeIsInteractive(clientX: number, clientY: number): boolean {
    const { petActor, isPointOverMiniGameStar } = this.provider;

    // 1. Pendant un glisser-déposer du familier, la fenêtre reste toujours interactive
    if (petActor.isDragging) {
      return true;
    }

    // 2. Rectangle de collision du familier avec une marge confortable (18 px)
    if (petActor.containsPoint(clientX, clientY, 18)) {
      return true;
    }

    // 3. Étoile active du mini-jeu Attrape-Étoile
    if (isPointOverMiniGameStar(clientX, clientY)) {
      return true;
    }

    // 4. Élément UI visible (.ui-interactive non masqué)
    return this.isPointOverInteractiveUI(clientX, clientY);
  }

  private isPointOverInteractiveUI(clientX: number, clientY: number): boolean {
    if (clientX < 0 || clientY < 0) {
      return false;
    }

    // Test direct via le DOM sous le curseur
    const topElement = document.elementFromPoint(clientX, clientY);
    if (topElement && topElement.closest('.ui-interactive:not(.hidden)')) {
      return true;
    }

    // Vérification géométrique de secours sur tous les panneaux .ui-interactive visibles
    const panels = document.querySelectorAll<HTMLElement>('.ui-interactive:not(.hidden)');
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return true;
      }
    }

    return false;
  }
}
