/**
 * Système de défis quotidiens (quêtes) pour Mimoo.
 * Génère 3 quêtes par jour et suit leur progression et récompenses en TamaCoins.
 */

import type { DailyQuest, DailyQuestKind, DailyQuestsState } from './types';

interface QuestTemplate {
  kind: DailyQuestKind;
  title: string;
  target: number;
  rewardCoins: number;
}

const QUEST_POOL: QuestTemplate[] = [
  { kind: 'feed', title: 'Nourrir Mimoo 3 fois', target: 3, rewardCoins: 20 },
  { kind: 'play', title: 'Jouer à 2 mini-jeux', target: 2, rewardCoins: 25 },
  { kind: 'pet', title: 'Faire 3 câlins', target: 3, rewardCoins: 15 },
  { kind: 'clean', title: 'Nettoyer Mimoo 1 fois', target: 1, rewardCoins: 15 },
  { kind: 'pomodoro', title: 'Terminer 1 session Focus', target: 1, rewardCoins: 30 },
];

export function getTodayDateKey(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function createDailyQuestsForDate(dateKey: string): DailyQuestsState {
  // Sélection déterministe de 3 quêtes distinctes selon la date
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }

  const picked: QuestTemplate[] = [];
  for (let offset = 0; picked.length < 3 && offset < QUEST_POOL.length; offset++) {
    const idx = (hash + offset * 2) % QUEST_POOL.length;
    const candidate = QUEST_POOL[idx];
    if (!picked.some((q) => q.kind === candidate.kind)) {
      picked.push(candidate);
    }
  }

  const quests: DailyQuest[] = picked.map((tpl, i) => ({
    id: `${dateKey}_${tpl.kind}_${i}`,
    kind: tpl.kind,
    title: tpl.title,
    target: tpl.target,
    progress: 0,
    rewardCoins: tpl.rewardCoins,
    claimed: false,
  }));

  return { dateKey, quests };
}

export function ensureDailyQuests(
  current: DailyQuestsState | undefined,
  nowMs: number = Date.now()
): DailyQuestsState {
  const today = getTodayDateKey(nowMs);
  if (current && current.dateKey === today && Array.isArray(current.quests) && current.quests.length > 0) {
    return {
      dateKey: current.dateKey,
      quests: current.quests.map((q) => ({ ...q })),
    };
  }
  return createDailyQuestsForDate(today);
}

export function advanceDailyQuest(
  current: DailyQuestsState | undefined,
  kind: DailyQuestKind,
  amount: number = 1,
  nowMs: number = Date.now()
): DailyQuestsState {
  const state = ensureDailyQuests(current, nowMs);
  return {
    dateKey: state.dateKey,
    quests: state.quests.map((q) =>
      q.kind === kind
        ? { ...q, progress: Math.min(q.target, q.progress + Math.max(0, amount)) }
        : q
    ),
  };
}

export function claimDailyQuestReward(
  current: DailyQuestsState | undefined,
  questId: string,
  nowMs: number = Date.now()
): { state: DailyQuestsState; coinsEarned: number; claimed: boolean } {
  const state = ensureDailyQuests(current, nowMs);
  let coinsEarned = 0;
  let claimed = false;

  const nextQuests = state.quests.map((q) => {
    if (q.id === questId && !q.claimed && q.progress >= q.target) {
      coinsEarned = q.rewardCoins;
      claimed = true;
      return { ...q, claimed: true };
    }
    return q;
  });

  return {
    state: { dateKey: state.dateKey, quests: nextQuests },
    coinsEarned,
    claimed,
  };
}
