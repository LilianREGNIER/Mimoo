import { describe, expect, it } from 'vitest';
import {
  advanceDailyQuest,
  claimDailyQuestReward,
  createDailyQuestsForDate,
  ensureDailyQuests,
} from '../../src/core/questsSystem';

describe('Système de défis quotidiens (questsSystem)', () => {
  it('génère 3 quêtes distinctes par date et les conserve sur la même journée', () => {
    const q1 = createDailyQuestsForDate('2026-11-13');
    expect(q1.quests).toHaveLength(3);
    const kinds = new Set(q1.quests.map((q) => q.kind));
    expect(kinds.size).toBe(3);

    const ensured = ensureDailyQuests(q1, new Date('2026-11-13T15:00:00Z').getTime());
    expect(ensured.dateKey).toBe('2026-11-13');
    expect(ensured.quests).toHaveLength(3);
  });

  it('fait progresser une quête et verse la récompense une seule fois', () => {
    const dayMs = new Date('2026-11-13T12:00:00Z').getTime();
    let state = createDailyQuestsForDate('2026-11-13');
    const targetQuest = state.quests[0];

    for (let i = 0; i < targetQuest.target + 2; i++) {
      state = advanceDailyQuest(state, targetQuest.kind, 1, dayMs);
    }

    const updated = state.quests.find((q) => q.id === targetQuest.id)!;
    expect(updated.progress).toBe(targetQuest.target);

    const claim1 = claimDailyQuestReward(state, targetQuest.id, dayMs);
    expect(claim1.claimed).toBe(true);
    expect(claim1.coinsEarned).toBe(targetQuest.rewardCoins);

    // Impossible de réclamer deux fois
    const claim2 = claimDailyQuestReward(claim1.state, targetQuest.id, dayMs);
    expect(claim2.claimed).toBe(false);
    expect(claim2.coinsEarned).toBe(0);
  });
});
