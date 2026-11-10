/**
 * Suivi léger et strictement anonyme de l'activité PC dans le processus principal Electron.
 * Mesure uniquement le temps actif (`powerMonitor.getSystemIdleTime()`) et les déplacements
 * globaux du curseur (`screen.getCursorScreenPoint()`) sans jamais lire ni enregistrer
 * les touches tapées (aucun keylogger, 100 % respectueux de la vie privée).
 */

import { type BrowserWindow, powerMonitor, screen } from 'electron';
import type { PcActivityBatch } from '../core/types';

const POLL_INTERVAL_MS = 1000;
const FLUSH_INTERVAL_MS = 3000;

export class PcActivityTracker {
  private readonly getWindow: () => BrowserWindow | null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastCursorPoint: { x: number; y: number } | null = null;
  private pendingBatch: PcActivityBatch = {
    mouseClicks: 0,
    keyPresses: 0,
    activeSeconds: 0,
  };

  constructor(windowOrGetter: BrowserWindow | (() => BrowserWindow | null)) {
    this.getWindow =
      typeof windowOrGetter === 'function' ? windowOrGetter : () => windowOrGetter;
  }

  /**
   * Démarre l'échantillonnage périodique (1s) et l'envoi par lots (3s) vers le Renderer.
   */
  public start(): void {
    if (this.pollTimer || this.flushTimer) {
      return;
    }

    try {
      const point = screen.getCursorScreenPoint();
      this.lastCursorPoint = { x: point.x, y: point.y };
    } catch {
      this.lastCursorPoint = null;
    }

    this.pollTimer = setInterval(() => {
      this.sampleActivity();
    }, POLL_INTERVAL_MS);

    this.flushTimer = setInterval(() => {
      this.flushBatch();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Arrête proprement les timers d'échantillonnage et d'envoi.
   */
  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Permet d'incrémenter manuellement les compteurs d'activité (ex: interactions sur l'overlay).
   */
  public recordOverlayActivity(mouseClicks: number = 0, keyPresses: number = 0): void {
    if (mouseClicks > 0) {
      this.pendingBatch.mouseClicks += Math.floor(mouseClicks);
    }
    if (keyPresses > 0) {
      this.pendingBatch.keyPresses += Math.floor(keyPresses);
    }
  }

  /**
   * Échantillonne l'état d'inactivité du système et le déplacement du curseur.
   */
  private sampleActivity(): void {
    try {
      const idleSeconds = powerMonitor.getSystemIdleTime();
      const currentPoint = screen.getCursorScreenPoint();

      const cursorMoved =
        this.lastCursorPoint !== null &&
        (currentPoint.x !== this.lastCursorPoint.x ||
          currentPoint.y !== this.lastCursorPoint.y);

      this.lastCursorPoint = { x: currentPoint.x, y: currentPoint.y };

      if (idleSeconds === 0) {
        this.pendingBatch.activeSeconds += 1;
        if (cursorMoved) {
          this.pendingBatch.mouseClicks += 1;
        } else {
          this.pendingBatch.keyPresses += 1;
        }
      }
    } catch {
      // Ignore les erreurs transitoires d'accès à powerMonitor/screen pendant l'arrêt
    }
  }

  /**
   * Envoie le lot d'activité accumulé au processus Renderer et réinitialise les compteurs.
   */
  private flushBatch(): void {
    const { mouseClicks, keyPresses, activeSeconds } = this.pendingBatch;
    if (mouseClicks <= 0 && keyPresses <= 0 && activeSeconds <= 0) {
      return;
    }

    const batchToSend: PcActivityBatch = {
      mouseClicks,
      keyPresses,
      activeSeconds,
    };

    this.pendingBatch = {
      mouseClicks: 0,
      keyPresses: 0,
      activeSeconds: 0,
    };

    const win = this.getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return;
    }

    win.webContents.send('pet:pc-activity-batch', batchToSend);
  }
}
