import { describe, expect, it } from 'vitest';
import defaultGameConfigJson from '../../data/game-config.json';
import { createInitialSaveData } from '../../src/core/saveSystem';
import { PetEngine } from '../../src/core/petEngine';

function createTestEngine() {
  const save = createInitialSaveData('PomoTester');
  return new PetEngine({
    saveData: save,
    config: defaultGameConfigJson as any,
    foods: [],
    species: [],
  });
}

describe('Système Pomodoro (Focus & Productivité)', () => {
  it('initialise un état Pomodoro inactif par défaut', () => {
    const engine = createTestEngine();
    const state = engine.getPomodoroState();
    expect(state.isActive).toBe(false);
    expect(state.mode).toBe('idle');
    expect(state.totalWorkSessionsCompleted).toBe(0);
  });

  it('démarre une session de travail de 25 minutes', () => {
    const engine = createTestEngine();
    const state = engine.startPomodoro(25, 5);
    expect(state.isActive).toBe(true);
    expect(state.mode).toBe('work');
    expect(state.workDurationMinutes).toBe(25);
    expect(state.breakDurationMinutes).toBe(5);
    expect(state.remainingSeconds).toBe(1500);
  });

  it('gère la pause et la reprise de la session', () => {
    const engine = createTestEngine();
    engine.startPomodoro(25, 5);
    const paused = engine.pausePomodoro();
    expect(paused.mode).toBe('paused');

    // Le tick ne doit pas décrémenter le temps quand en pause
    const tickResult = engine.tickPomodoro(10);
    expect(tickResult.state.remainingSeconds).toBe(1500);

    const resumed = engine.resumePomodoro();
    expect(resumed.mode).toBe('work');

    const tickAfterResume = engine.tickPomodoro(10);
    expect(tickAfterResume.state.remainingSeconds).toBe(1490);
  });

  it('arrête proprement la session en cours', () => {
    const engine = createTestEngine();
    engine.startPomodoro(25, 5);
    engine.tickPomodoro(100);
    const stopped = engine.stopPomodoro();
    expect(stopped.isActive).toBe(false);
    expect(stopped.mode).toBe('idle');
    expect(stopped.remainingSeconds).toBe(1500);
  });

  it('attribue les récompenses et passe en pause lorsque la session de travail se termine', () => {
    const engine = createTestEngine();
    const initialCoins = engine.getState().tamaCoins;
    engine.startPomodoro(1, 1); // 1 minute travail, 1 minute pause

    // Avance de 60 secondes
    const result = engine.tickPomodoro(60);
    expect(result.phaseCompleted).toBe('work');
    expect(result.reward).toBeDefined();
    expect(result.reward?.coins).toBe(50);
    expect(engine.getState().tamaCoins).toBe(initialCoins + 50);

    const state = engine.getPomodoroState();
    expect(state.mode).toBe('break');
    expect(state.remainingSeconds).toBe(60);
    expect(state.totalWorkSessionsCompleted).toBe(1);

    // Fin de la pause
    const breakResult = engine.tickPomodoro(60);
    expect(breakResult.phaseCompleted).toBe('break');
    expect(engine.getPomodoroState().mode).toBe('idle');
    expect(engine.getPomodoroState().isActive).toBe(false);
  });
});
