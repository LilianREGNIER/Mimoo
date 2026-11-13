/**
 * Mini-jeu rapide "Simon Musical" directement sur le bureau.
 * 4 pads colorés jouent une séquence de notes à mémoriser et répéter jusqu'à 5 manches.
 */

import type { SoundManager } from './soundManager';

export interface SimonGameCallbacks {
  onComplete: (score: number, maxScore: number, won: boolean) => void;
  onCancel: () => void;
}

export class SimonGame {
  private readonly maxRounds = 5;
  private sequence: number[] = [];
  private playerIndex = 0;
  private isPlayingSequence = false;
  private active = false;
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(
    private readonly sound: SoundManager,
    private readonly callbacks: SimonGameCallbacks
  ) {}

  public isActive(): boolean {
    return this.active;
  }

  public start(): void {
    this.clearTimers();
    this.active = true;
    this.sequence = [];
    this.playerIndex = 0;
    this.bindPadHandlers();
    const overlay = document.getElementById('simon-overlay');
    overlay?.classList.remove('hidden');
    this.nextRound();
  }

  public stop(): void {
    this.clearTimers();
    this.active = false;
    document.getElementById('simon-overlay')?.classList.add('hidden');
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private bindPadHandlers(): void {
    for (let i = 0; i < 4; i++) {
      const btn = document.getElementById(`simon-pad-${i}`);
      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => this.handlePadClick(i));
      }
    }
    const closeBtn = document.getElementById('btn-close-simon');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', () => {
        this.stop();
        this.callbacks.onCancel();
      });
    }
  }

  private nextRound(): void {
    if (!this.active) return;
    this.sequence.push(Math.floor(Math.random() * 4));
    this.playerIndex = 0;
    this.updateStatus(`Manche ${this.sequence.length}/${this.maxRounds} — Écoute bien !`);
    this.playSequence();
  }

  private playSequence(): void {
    this.isPlayingSequence = true;
    const baseDelay = 420;
    this.sequence.forEach((pad, idx) => {
      const t = setTimeout(() => {
        if (!this.active) return;
        this.flashPad(pad);
        this.sound.playSimonTone(pad);
      }, 350 + idx * baseDelay);
      this.timers.push(t);
    });

    const endTimer = setTimeout(() => {
      if (!this.active) return;
      this.isPlayingSequence = false;
      this.updateStatus(`À toi ! (${this.sequence.length}/${this.maxRounds})`);
    }, 350 + this.sequence.length * baseDelay + 120);
    this.timers.push(endTimer);
  }

  private handlePadClick(padIndex: number): void {
    if (!this.active || this.isPlayingSequence) return;
    this.flashPad(padIndex);
    this.sound.playSimonTone(padIndex);

    const expected = this.sequence[this.playerIndex];
    if (padIndex !== expected) {
      const cleared = Math.max(0, this.sequence.length - 1);
      this.sound.play('lose');
      this.updateStatus(`Oups ! Score : ${cleared}/${this.maxRounds}`);
      this.isPlayingSequence = true;
      this.timers.push(
        setTimeout(() => {
          this.stop();
          this.callbacks.onComplete(cleared, this.maxRounds, false);
        }, 900)
      );
      return;
    }

    this.playerIndex += 1;
    if (this.playerIndex >= this.sequence.length) {
      if (this.sequence.length >= this.maxRounds) {
        this.sound.play('win');
        this.updateStatus(`Parfait ! ${this.maxRounds}/${this.maxRounds} 🎉`);
        this.isPlayingSequence = true;
        this.timers.push(
          setTimeout(() => {
            this.stop();
            this.callbacks.onComplete(this.maxRounds, this.maxRounds, true);
          }, 900)
        );
      } else {
        this.isPlayingSequence = true;
        this.updateStatus('Bravo ! Manche suivante…');
        this.timers.push(setTimeout(() => this.nextRound(), 650));
      }
    }
  }

  private flashPad(padIndex: number): void {
    const pad = document.getElementById(`simon-pad-${padIndex}`);
    if (!pad) return;
    pad.classList.add('lit');
    this.timers.push(setTimeout(() => pad.classList.remove('lit'), 240));
  }

  private updateStatus(text: string): void {
    const el = document.getElementById('simon-status');
    if (el) el.textContent = text;
  }
}
