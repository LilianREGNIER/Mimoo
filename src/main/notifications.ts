/**
 * Gestionnaire de notifications natives Windows 10/11 avec mécanisme anti-spam (cooldown par alerte).
 */

import { Notification } from 'electron';
import type { UserSettings } from '../core/types';

/** Cooldown par défaut entre deux notifications portant sur le même besoin (10 minutes). */
export const DEFAULT_NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000;

export class NotificationManager {
  private readonly cooldownMs: number;
  private readonly lastNotifiedByTitle = new Map<string, number>();

  constructor(cooldownMs: number = DEFAULT_NOTIFICATION_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * Émet une notification système discrète si `settings.notificationsEnabled` est actif,
   * que la plateforme supporte les notifications et que le délai anti-spam est écoulé.
   */
  public notify(
    title: string,
    body: string,
    settings: Pick<UserSettings, 'notificationsEnabled'>,
    nowMs: number = Date.now()
  ): boolean {
    if (!settings.notificationsEnabled) {
      return false;
    }

    if (!Notification.isSupported()) {
      return false;
    }

    const safeTitle = title.trim() || 'Mimoo';
    const safeBody = body.trim();
    const cooldownKey = safeTitle.toLowerCase();

    const lastSentAt = this.lastNotifiedByTitle.get(cooldownKey);
    if (typeof lastSentAt === 'number' && nowMs - lastSentAt < this.cooldownMs) {
      return false;
    }

    this.lastNotifiedByTitle.set(cooldownKey, nowMs);

    try {
      const notification = new Notification({
        title: safeTitle,
        body: safeBody,
        silent: false,
      });
      notification.show();
      return true;
    } catch (error) {
      console.warn('[notifications] Impossible d\'afficher la notification Windows :', error);
      return false;
    }
  }

  /**
   * Réinitialise l'historique des cooldowns (utile lors d'une réinitialisation du familier).
   */
  public resetCooldowns(): void {
    this.lastNotifiedByTitle.clear();
  }
}
