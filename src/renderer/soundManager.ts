/**
 * Gestionnaire audio désactivé (aucun bruitage dans le jeu, conformément au choix utilisateur).
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

export class SoundManager {
  public setEnabled(_enabled: boolean): void {}
  public isEnabled(): boolean {
    return false;
  }
  public playSimonTone(_padIndex: number): void {}
  public play(_kind: SoundEffectKind): void {}
}
