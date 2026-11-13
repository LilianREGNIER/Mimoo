/**
 * Gestionnaire de bruitages mignons et rétro générés via Web Audio API (zéro fichier externe).
 */

export type SoundEffectKind =
  | 'click'
  | 'feed'
  | 'pet'
  | 'clean'
  | 'jump'
  | 'coin'
  | 'win'
  | 'lose'
  | 'emote'
  | 'snowball'
  | 'evolve';

const SIMON_FREQS = [523.25, 659.25, 783.99, 1046.5]; // Do5, Mi5, Sol5, Do6

export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') {
      return null;
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'sine',
    volume: number = 0.08,
    delaySec: number = 0,
    endFreq?: number
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + durationSec);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  public playSimonTone(padIndex: number): void {
    const freq = SIMON_FREQS[padIndex % SIMON_FREQS.length] ?? 523.25;
    this.playTone(freq, 0.24, 'triangle', 0.1);
  }

  public play(kind: SoundEffectKind): void {
    if (!this.enabled) return;

    switch (kind) {
      case 'click':
        this.playTone(640, 0.06, 'sine', 0.04, 0, 760);
        break;
      case 'feed':
        this.playTone(440, 0.08, 'triangle', 0.07, 0, 580);
        this.playTone(580, 0.1, 'triangle', 0.07, 0.08, 720);
        break;
      case 'pet':
        this.playTone(520, 0.14, 'sine', 0.06, 0, 680);
        this.playTone(680, 0.14, 'sine', 0.05, 0.1, 820);
        break;
      case 'clean':
        this.playTone(720, 0.09, 'sine', 0.05, 0, 980);
        this.playTone(980, 0.1, 'sine', 0.05, 0.07, 1180);
        break;
      case 'jump':
        this.playTone(320, 0.13, 'sine', 0.06, 0, 620);
        break;
      case 'coin':
        this.playTone(987.77, 0.08, 'square', 0.04, 0);
        this.playTone(1318.51, 0.18, 'square', 0.04, 0.08);
        break;
      case 'emote':
        this.playTone(587.33, 0.1, 'triangle', 0.07, 0);
        this.playTone(880, 0.16, 'triangle', 0.07, 0.09);
        break;
      case 'snowball':
        this.playTone(480, 0.12, 'sawtooth', 0.035, 0, 220);
        break;
      case 'win':
        this.playTone(523.25, 0.1, 'triangle', 0.08, 0);
        this.playTone(659.25, 0.1, 'triangle', 0.08, 0.1);
        this.playTone(783.99, 0.1, 'triangle', 0.08, 0.2);
        this.playTone(1046.5, 0.24, 'triangle', 0.09, 0.3);
        break;
      case 'lose':
        this.playTone(392, 0.14, 'triangle', 0.07, 0);
        this.playTone(311.13, 0.22, 'triangle', 0.07, 0.14);
        break;
      case 'evolve':
        this.playTone(440, 0.1, 'triangle', 0.08, 0);
        this.playTone(554.37, 0.1, 'triangle', 0.08, 0.1);
        this.playTone(659.25, 0.1, 'triangle', 0.08, 0.2);
        this.playTone(880, 0.14, 'triangle', 0.09, 0.3);
        this.playTone(1108.73, 0.28, 'triangle', 0.09, 0.44);
        break;
    }
  }
}
