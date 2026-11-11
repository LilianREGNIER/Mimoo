/**
 * Suivi léger et strictement anonyme de l'activité PC dans le processus principal Electron.
 * Utilise un mini-hook Windows natif (assets/bin/activity-hook.exe) qui écoute les événements réels
 * de clics (WM_LBUTTONDOWN) et de touches (WM_KEYDOWN) sans JAMAIS enregistrer les caractères tapés
 * (strictement un compteur de volume, 100 % respectueux de la vie privée).
 */

import { type BrowserWindow, powerMonitor, screen } from 'electron';
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PcActivityBatch } from '../core/types';

const POLL_INTERVAL_MS = 1000;
const FLUSH_INTERVAL_MS = 2000;

function resolveHookExecutable(): string | null {
  const candidates = [
    path.join(__dirname, '..', '..', 'assets', 'bin', 'activity-hook.exe'),
    path.join(__dirname, '..', 'assets', 'bin', 'activity-hook.exe'),
    path.join(process.cwd(), 'assets', 'bin', 'activity-hook.exe'),
    path.join(process.cwd(), 'dist', 'assets', 'bin', 'activity-hook.exe'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

export class PcActivityTracker {
  private readonly getWindow: () => BrowserWindow | null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private hookProcess: ChildProcess | null = null;
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
   * Démarre l'échantillonnage périodique, le hook natif Windows et l'envoi par lots vers le Renderer.
   */
  public start(): void {
    if (this.pollTimer || this.flushTimer) {
      return;
    }

    this.spawnHookProcess();

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
   * Lance en arrière-plan le processus natif de comptage des clics et touches réels.
   */
  private spawnHookProcess(): void {
    if (this.hookProcess) {
      return;
    }
    const exePath = resolveHookExecutable();
    if (!exePath) {
      return;
    }

    try {
      this.hookProcess = spawn(exePath, [], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      let buffer = '';
      this.hookProcess.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) {
            continue;
          }
          try {
            const parsed = JSON.parse(trimmed) as { clicks?: number; keys?: number };
            if (typeof parsed.clicks === 'number' && parsed.clicks > 0) {
              this.pendingBatch.mouseClicks += parsed.clicks;
            }
            if (typeof parsed.keys === 'number' && parsed.keys > 0) {
              this.pendingBatch.keyPresses += parsed.keys;
            }
          } catch {
            // Ignorer les lignes tronquées ou malformées
          }
        }
      });

      this.hookProcess.on('exit', () => {
        this.hookProcess = null;
      });

      this.hookProcess.on('error', () => {
        this.hookProcess = null;
      });
    } catch {
      this.hookProcess = null;
    }
  }

  /**
   * Arrête proprement les timers et le sous-processus de hook natif.
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
    if (this.hookProcess) {
      try {
        this.hookProcess.kill();
      } catch {
        // Ignorer
      }
      this.hookProcess = null;
    }
  }

  /**
   * Permet d'incrémenter manuellement les compteurs d'activité (ex: interactions locales sur l'overlay).
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
   * Échantillonne l'état d'inactivité du système et le déplacement du curseur pour mesurer le temps actif.
   * NOTE : Ne simule JAMAIS de clics ou de touches quand la souris bouge ou quand l'utilisateur est inactif !
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

      // Seul le temps actif réel (secondes actives) est comptabilisé ici :
      const isSystemActive =
        idleSeconds <= 1 ||
        cursorMoved ||
        this.pendingBatch.mouseClicks > 0 ||
        this.pendingBatch.keyPresses > 0;

      if (isSystemActive) {
        this.pendingBatch.activeSeconds += 1;
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
