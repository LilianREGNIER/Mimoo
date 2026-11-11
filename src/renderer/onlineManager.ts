/**
 * Gestionnaire du Mode Online pour le Tamagotchi Desktop Pet :
 * - Visite d'un pet ami sur le bureau Windows (se déplace sur toute la largeur de l'écran avec ses cosmétiques)
 * - Partage et importation de Codes Passeport Tamagotchi (TAMA-...)
 * - Salon temps réel par BroadcastChannel / canal réseau
 * - Simulation instantanée d'ami pour tester immédiatement
 * - Interaction "Faire jouer les 2 pets ensemble" (les deux se rejoignent, sautent de joie, étoiles/cœurs)
 */

import type { FormId, FriendPetProfile, LineageId, StageId } from '../core/types';
import { SPRITE_FRAME_WIDTH } from './spriteAnimator';

export interface OnlineManagerCallbacks {
  onFriendArrival: (friend: FriendPetProfile) => void;
  onFriendDeparture: () => void;
  onPlayTogetherRequested: () => void;
}

const SIMULATED_FRIEND_NAMES = [
  'Lili', 'Piko', 'Pixel', 'Bubulle', 'Kumo', 'Nori', 'Toby', 'Chibi', 'Yuki', 'Koko'
];

const SIMULATED_OWNER_NAMES = [
  'Alex', 'Camille', 'Sam', 'Sacha', 'Robin', 'Max', 'Lou', 'Noa', 'Charlie', 'Morgan'
];

const STARTER_FORMS: FormId[] = [
  'baby_aqua', 'baby_flora', 'baby_ember',
  'child_aqua', 'child_flora', 'child_ember',
  'adult_aqua_coral', 'adult_flora_bloom', 'adult_ember_solar',
  'adult_aqua_leviathan', 'adult_flora_truffle', 'adult_ember_eclipse'
];

export class OnlineManager {
  private friendPet: FriendPetProfile | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private currentRoomCode: string | null = null;
  private readonly callbacks: OnlineManagerCallbacks;

  // Déplacement autonome du pet ami sur le bureau
  public friendX = 300;
  public friendY = window.innerHeight - 95;
  public friendFlipX = false;
  public friendTargetX: number | null = null;
  public friendIsMoving = false;
  public friendStateTimer = 2.0;

  constructor(callbacks: OnlineManagerCallbacks) {
    this.callbacks = callbacks;
    this.friendY = Math.max(80, window.innerHeight - 95);
  }

  public getVisitor(): FriendPetProfile | null {
    return this.friendPet;
  }

  public hasVisitor(): boolean {
    return this.friendPet !== null;
  }

  public setVisitor(profile: FriendPetProfile | null): void {
    this.friendPet = profile;
    if (profile) {
      this.friendX = Math.round(
        Math.max(80, Math.min(window.innerWidth - 80, window.innerWidth * 0.75))
      );
      this.friendY = Math.max(80, window.innerHeight - 95);
      this.friendTargetX = null;
      this.friendIsMoving = false;
      this.callbacks.onFriendArrival(profile);
    } else {
      this.callbacks.onFriendDeparture();
    }
  }

  public removeVisitor(): void {
    this.setVisitor(null);
  }

  /**
   * Crée un pet ami simulé aléatoire équipé d'accessoires pour tester le mode en solo.
   */
  public spawnSimulatedFriend(): FriendPetProfile {
    const randomForm = STARTER_FORMS[Math.floor(Math.random() * STARTER_FORMS.length)];
    const randomName = SIMULATED_FRIEND_NAMES[Math.floor(Math.random() * SIMULATED_FRIEND_NAMES.length)];
    const randomOwner = SIMULATED_OWNER_NAMES[Math.floor(Math.random() * SIMULATED_OWNER_NAMES.length)];

    const hats = [null, 'hat_crown', 'hat_tophat', 'hat_bow', 'hat_wizard', 'hat_cap', 'hat_halo'];
    const accs = [null, 'acc_sunglasses', 'acc_monocle', 'acc_star_glasses', 'acc_blush_hearts'];
    const auras = [null, 'aura_rainbow', 'aura_music', 'aura_sakura', 'aura_cyber'];

    const chosenHat = hats[Math.floor(Math.random() * hats.length)];
    const chosenAcc = accs[Math.floor(Math.random() * accs.length)];
    const chosenAura = auras[Math.floor(Math.random() * auras.length)];

    let stage: StageId = 'adult';
    let lineage: LineageId = 'aqua';
    if (randomForm.startsWith('baby_')) {
      stage = 'baby';
    } else if (randomForm.startsWith('child_')) {
      stage = 'child';
    }
    if (randomForm.includes('flora')) lineage = 'flora';
    else if (randomForm.includes('ember')) lineage = 'ember';

    const simulated: FriendPetProfile = {
      id: `sim-${Date.now()}`,
      name: randomName,
      ownerName: randomOwner,
      formId: randomForm,
      stage,
      lineage,
      equippedCosmetics: {
        hat: chosenHat,
        accessory: chosenAcc,
        aura: chosenAura,
      },
      happiness: 88,
      x: this.friendX,
      direction: 1,
      animationState: 'idle',
    };

    this.setVisitor(simulated);
    return simulated;
  }

  /**
   * Rejoint ou crée un salon temps réel par code.
   */
  public joinRoom(roomCode: string, myProfile: FriendPetProfile): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    const cleanCode = roomCode.trim().toUpperCase() || 'PETS-1';
    this.currentRoomCode = cleanCode;

    try {
      this.broadcastChannel = new BroadcastChannel(`desktop-pet-room-${cleanCode}`);
      this.broadcastChannel.onmessage = (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'hello' || data.type === 'sync') {
          if (data.profile && data.profile.id !== myProfile.id) {
            this.setVisitor(data.profile);
            // Répondre avec notre profil
            if (data.type === 'hello') {
              this.broadcastChannel?.postMessage({
                type: 'sync',
                profile: myProfile,
              });
            }
          }
        } else if (data.type === 'play-together') {
          this.callbacks.onPlayTogetherRequested();
        } else if (data.type === 'goodbye') {
          if (this.friendPet && this.friendPet.id === data.senderId) {
            this.removeVisitor();
          }
        }
      };

      // Annonce notre présence sur le canal
      this.broadcastChannel.postMessage({
        type: 'hello',
        profile: myProfile,
      });
    } catch {
      // Si BroadcastChannel indisponible dans cet environnement
    }
  }

  public notifyPlayTogether(): void {
    if (this.broadcastChannel && this.friendPet) {
      this.broadcastChannel.postMessage({
        type: 'play-together',
        senderId: 'local',
      });
    }
    this.callbacks.onPlayTogetherRequested();
  }

  public leaveRoom(myId?: string): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'goodbye',
          senderId: myId || 'local',
        });
        this.broadcastChannel.close();
      } catch {
        // Ignorer
      }
      this.broadcastChannel = null;
    }
    this.currentRoomCode = null;
    this.removeVisitor();
  }

  /**
   * Met à jour la physique et la marche autonome du pet ami sur l'écran.
   */
  public update(dtSeconds: number, targetNearLocalPetX?: number | null): void {
    if (!this.friendPet) return;

    const safeDt = Math.min(0.1, Math.max(0, dtSeconds));
    const margin = Math.max(54, Math.round(SPRITE_FRAME_WIDTH * 1.25 * 0.65));
    const minX = margin;
    const maxX = Math.max(margin + 40, window.innerWidth - margin);
    const speed = 45;

    // Si on demande de rejoindre le pet local (interaction de jeu à 2)
    if (typeof targetNearLocalPetX === 'number') {
      const diff = targetNearLocalPetX - this.friendX;
      if (Math.abs(diff) > 8) {
        const dir = Math.sign(diff);
        this.friendFlipX = dir < 0;
        this.friendIsMoving = true;
        this.friendX = Math.min(maxX, Math.max(minX, this.friendX + dir * speed * 1.4 * safeDt));
      } else {
        this.friendIsMoving = false;
      }
      return;
    }

    if (this.friendTargetX !== null) {
      const diff = this.friendTargetX - this.friendX;
      if (Math.abs(diff) <= 6) {
        this.friendX = this.friendTargetX;
        this.friendTargetX = null;
        this.friendIsMoving = false;
        this.friendStateTimer = 2.5 + Math.random() * 4.0;
      } else {
        const dir = Math.sign(diff);
        this.friendFlipX = dir < 0;
        this.friendIsMoving = true;
        this.friendX = Math.min(maxX, Math.max(minX, this.friendX + dir * speed * safeDt));
      }
      return;
    }

    this.friendIsMoving = false;
    this.friendStateTimer -= safeDt;
    if (this.friendStateTimer <= 0) {
      // Choisit une destination autonome sur toute la largeur de l'écran
      const roll = Math.random();
      let target: number;
      if (roll < 0.45) {
        target = this.friendX > (minX + maxX) / 2
          ? minX + Math.random() * ((maxX - minX) * 0.4)
          : maxX - Math.random() * ((maxX - minX) * 0.4);
      } else {
        target = minX + Math.random() * (maxX - minX);
      }
      this.friendTargetX = Math.round(Math.min(maxX, Math.max(minX, target)));
    }
  }
}
