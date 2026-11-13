/**
 * Gestionnaire du Mode Online pour le Tamagotchi Desktop Pet :
 * - Visite de pets amis sur le bureau Windows (plusieurs amis simultanés dans un même salon)
 * - Partage et importation de Codes Passeport Tamagotchi (TAMA-...)
 * - Salon temps réel multi-PC via WebSocket/MQTT (wss://broker.emqx.io / hivemq) + miroir local BroadcastChannel
 * - Simulation instantanée d'ami pour tester en solo
 * - Interaction "Faire jouer les pets ensemble"
 */

import type { FormId, FriendPetProfile, LineageId, StageId } from '../core/types';
import { MqttRoomClient, type RoomTransportStatus } from './mqttRoomClient';
import { SPRITE_FRAME_WIDTH } from './spriteAnimator';

export interface OnlineManagerCallbacks {
  onFriendArrival: (friend: FriendPetProfile) => void;
  onFriendDeparture: (friend?: FriendPetProfile) => void;
  onPlayTogetherRequested: () => void;
  onRoomStatusChanged?: (status: RoomTransportStatus, roomCode: string | null) => void;
}

export interface FriendVisitorRuntime {
  id: string;
  profile: FriendPetProfile;
  source: 'room' | 'passport' | 'simulated';
  x: number;
  y: number;
  flipX: boolean;
  targetX: number | null;
  isMoving: boolean;
  stateTimer: number;
  lastSeenAt: number;
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

const ROOM_PEER_TIMEOUT_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 4_000;
const MOTION_THROTTLE_MS = 280;

export class OnlineManager {
  private visitors = new Map<string, FriendVisitorRuntime>();
  private broadcastChannel: BroadcastChannel | null = null;
  private mqttClient: MqttRoomClient | null = null;
  private currentRoomCode: string | null = null;
  private roomStatus: RoomTransportStatus = 'idle';
  private localProfile: FriendPetProfile | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMotionBroadcastAt = 0;
  private lastBroadcastNx = -1;
  private lastBroadcastDir = 0;
  private readonly callbacks: OnlineManagerCallbacks;

  // Propriétés rétro-compatibles pointant vers le visiteur principal
  public friendX = 300;
  public friendY = typeof window !== 'undefined' ? window.innerHeight - 95 : 800;
  public friendFlipX = false;
  public friendTargetX: number | null = null;
  public friendIsMoving = false;
  public friendStateTimer = 2.0;

  constructor(callbacks: OnlineManagerCallbacks) {
    this.callbacks = callbacks;
    const screenH = typeof window !== 'undefined' ? window.innerHeight : 900;
    this.friendY = Math.max(80, screenH - 95);
  }

  public getVisitor(): FriendPetProfile | null {
    const first = this.visitors.values().next();
    return first.done ? null : first.value.profile;
  }

  public getVisitors(): FriendVisitorRuntime[] {
    return Array.from(this.visitors.values());
  }

  public hasVisitor(): boolean {
    return this.visitors.size > 0;
  }

  public getCurrentRoomCode(): string | null {
    return this.currentRoomCode;
  }

  public getRoomStatus(): RoomTransportStatus {
    return this.roomStatus;
  }

  public setVisitor(
    profile: FriendPetProfile | null,
    source: 'room' | 'passport' | 'simulated' = 'passport'
  ): void {
    if (!profile) {
      const hadAny = this.visitors.size > 0;
      const first = this.getVisitor() ?? undefined;
      this.visitors.clear();
      if (hadAny) {
        this.callbacks.onFriendDeparture(first);
      }
      return;
    }

    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const screenH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const defaultY = Math.max(80, screenH - 95);

    const existing = this.visitors.get(profile.id);
    if (existing) {
      existing.profile = profile;
      existing.lastSeenAt = Date.now();
      if (typeof profile.x === 'number' && Number.isFinite(profile.x)) {
        const target =
          profile.x >= 0 && profile.x <= 1
            ? Math.round(Math.max(80, Math.min(screenW - 80, profile.x * screenW)))
            : Math.round(Math.max(80, Math.min(screenW - 80, profile.x)));
        existing.targetX = target;
      }
      this.syncPrimaryCompatFields();
      return;
    }

    // Pour un visiteur importé ou simulé, on remplace un éventuel autre visiteur hors-salon
    if (source !== 'room') {
      for (const [id, v] of this.visitors.entries()) {
        if (v.source !== 'room') {
          this.visitors.delete(id);
        }
      }
    }

    const initialX =
      typeof profile.x === 'number' && Number.isFinite(profile.x)
        ? profile.x >= 0 && profile.x <= 1
          ? Math.round(Math.max(80, Math.min(screenW - 80, profile.x * screenW)))
          : Math.round(Math.max(80, Math.min(screenW - 80, profile.x)))
        : Math.round(
            Math.max(
              80,
              Math.min(screenW - 80, screenW * (0.68 + (this.visitors.size % 3) * 0.08))
            )
          );

    const runtime: FriendVisitorRuntime = {
      id: profile.id,
      profile,
      source,
      x: initialX,
      y: defaultY,
      flipX: profile.direction === -1,
      targetX: null,
      isMoving: false,
      stateTimer: 1.8 + Math.random() * 2.5,
      lastSeenAt: Date.now(),
    };

    this.visitors.set(profile.id, runtime);
    this.syncPrimaryCompatFields();
    this.callbacks.onFriendArrival(profile);
  }

  public removeVisitor(id?: string): void {
    if (id) {
      const target = this.visitors.get(id);
      if (target) {
        this.visitors.delete(id);
        this.syncPrimaryCompatFields();
        this.callbacks.onFriendDeparture(target.profile);
      }
      return;
    }
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

    this.setVisitor(simulated, 'simulated');
    return simulated;
  }

  /**
   * Rejoint ou crée un salon temps réel multi-PC par code (MQTT sur WebSocket + BroadcastChannel local).
   */
  public joinRoom(roomCode: string, myProfile: FriendPetProfile): void {
    this.disconnectRoomTransports(false);

    const cleanCode = roomCode.trim().toUpperCase() || 'PETS-1';
    this.currentRoomCode = cleanCode;
    this.localProfile = { ...myProfile };
    this.setRoomStatus('connecting');

    const handlePacket = (raw: unknown): void => {
      if (!raw || typeof raw !== 'object') return;
      const data = raw as Record<string, unknown>;
      const senderProfile = data.profile as FriendPetProfile | undefined;

      if (data.type === 'hello' || data.type === 'sync') {
        if (senderProfile && senderProfile.id && senderProfile.id !== this.localProfile?.id) {
          this.setVisitor(senderProfile, 'room');
          if (data.type === 'hello' && this.localProfile) {
            this.publishRoomMessage({
              type: 'sync',
              profile: this.localProfile,
            });
          }
        }
      } else if (data.type === 'play-together') {
        if (data.senderId !== this.localProfile?.id) {
          this.callbacks.onPlayTogetherRequested();
        }
      } else if (data.type === 'goodbye') {
        if (typeof data.senderId === 'string' && data.senderId !== this.localProfile?.id) {
          this.removeVisitor(data.senderId);
        }
      }
    };

    // 1) Canal local instantané (même machine / fenêtres locales)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel(`desktop-pet-room-${cleanCode}`);
        this.broadcastChannel.onmessage = (event) => {
          handlePacket(event.data);
        };
      } catch {
        this.broadcastChannel = null;
      }
    }

    // 2) Canal réseau Internet/LAN multi-joueurs (MQTT over WSS)
    const topic = `mimoo-desktop-pet/v1/rooms/${encodeURIComponent(cleanCode)}`;
    this.mqttClient = new MqttRoomClient({
      clientId: `mimoo-${myProfile.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 18)}-${Math.random().toString(36).slice(2, 6)}`,
      topic,
      onMessage: (payloadText) => {
        try {
          handlePacket(JSON.parse(payloadText));
        } catch {
          // Paquet JSON ignoré
        }
      },
      onStatusChange: (status) => {
        this.setRoomStatus(status);
        if (status === 'connected' && this.localProfile) {
          this.publishRoomMessage({
            type: 'hello',
            profile: this.localProfile,
          });
        }
      },
    });
    this.mqttClient.connect();

    // Annonce immédiate locale + battement de cœur régulier pour garder la présence à jour
    this.publishRoomMessage({
      type: 'hello',
      profile: this.localProfile,
    });

    this.heartbeatTimer = setInterval(() => {
      if (!this.currentRoomCode || !this.localProfile) return;
      this.publishRoomMessage({
        type: 'sync',
        profile: this.localProfile,
      });
      this.pruneStaleRoomVisitors();
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Met à jour l'état local (position normalisée 0..1, direction, cosmétiques) et le diffuse aux pairs du salon.
   */
  public broadcastLocalState(profile: FriendPetProfile): void {
    this.localProfile = { ...profile };
    if (!this.currentRoomCode) return;

    const now = Date.now();
    const nx = typeof profile.x === 'number' ? profile.x : 0.5;
    const dir = profile.direction ?? 1;
    const movedEnough =
      Math.abs(nx - this.lastBroadcastNx) >= 0.02 || dir !== this.lastBroadcastDir;

    if (movedEnough && now - this.lastMotionBroadcastAt >= MOTION_THROTTLE_MS) {
      this.lastMotionBroadcastAt = now;
      this.lastBroadcastNx = nx;
      this.lastBroadcastDir = dir;
      this.publishRoomMessage({
        type: 'sync',
        profile: this.localProfile,
      });
    }
  }

  public notifyPlayTogether(): void {
    if (this.currentRoomCode && this.visitors.size > 0) {
      this.publishRoomMessage({
        type: 'play-together',
        senderId: this.localProfile?.id || 'local',
      });
    }
    this.callbacks.onPlayTogetherRequested();
  }

  public leaveRoom(myId?: string): void {
    const senderId = myId || this.localProfile?.id || 'local';
    if (this.currentRoomCode) {
      this.publishRoomMessage({
        type: 'goodbye',
        senderId,
      });
    }
    this.disconnectRoomTransports(true);
    this.removeVisitor();
  }

  private publishRoomMessage(payload: Record<string, unknown>): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(payload);
      } catch {
        // Ignorer
      }
    }
    if (this.mqttClient && this.mqttClient.getIsConnected()) {
      this.mqttClient.publish(JSON.stringify(payload));
    }
  }

  private disconnectRoomTransports(removeRoomPeers: boolean): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {
        // Ignorer
      }
      this.broadcastChannel = null;
    }
    if (this.mqttClient) {
      this.mqttClient.disconnect();
      this.mqttClient = null;
    }
    this.currentRoomCode = null;
    this.setRoomStatus('idle');

    if (removeRoomPeers) {
      for (const [id, v] of this.visitors.entries()) {
        if (v.source === 'room') {
          this.visitors.delete(id);
        }
      }
      this.syncPrimaryCompatFields();
    }
  }

  private pruneStaleRoomVisitors(): void {
    const now = Date.now();
    let removedAny = false;
    let lastRemoved: FriendPetProfile | undefined;

    for (const [id, v] of this.visitors.entries()) {
      if (v.source === 'room' && now - v.lastSeenAt > ROOM_PEER_TIMEOUT_MS) {
        lastRemoved = v.profile;
        this.visitors.delete(id);
        removedAny = true;
      }
    }

    if (removedAny) {
      this.syncPrimaryCompatFields();
      this.callbacks.onFriendDeparture(lastRemoved);
    }
  }

  private setRoomStatus(status: RoomTransportStatus): void {
    this.roomStatus = status;
    this.callbacks.onRoomStatusChanged?.(status, this.currentRoomCode);
  }

  private syncPrimaryCompatFields(): void {
    const first = this.visitors.values().next();
    if (first.done) return;
    const primary = first.value;
    this.friendX = primary.x;
    this.friendY = primary.y;
    this.friendFlipX = primary.flipX;
    this.friendTargetX = primary.targetX;
    this.friendIsMoving = primary.isMoving;
    this.friendStateTimer = primary.stateTimer;
  }

  /**
   * Met à jour la physique et la marche autonome de tous les pets amis présents sur l'écran.
   */
  public update(dtSeconds: number, targetNearLocalPetX?: number | null): void {
    if (this.visitors.size === 0) return;

    const screenW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const screenH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const safeDt = Math.min(0.1, Math.max(0, dtSeconds));
    const margin = Math.max(54, Math.round(SPRITE_FRAME_WIDTH * 1.25 * 0.65));
    const minX = margin;
    const maxX = Math.max(margin + 40, screenW - margin);
    const speed = 55;

    let idx = 0;
    for (const visitor of this.visitors.values()) {
      visitor.y = Math.max(80, screenH - 95);

      if (typeof targetNearLocalPetX === 'number') {
        const offset = (idx % 2 === 0 ? 1 : -1) * (42 + Math.floor(idx / 2) * 34);
        const goalX = Math.min(maxX, Math.max(minX, targetNearLocalPetX + offset));
        const diff = goalX - visitor.x;
        if (Math.abs(diff) > 8) {
          const dir = Math.sign(diff);
          visitor.flipX = dir < 0;
          visitor.isMoving = true;
          visitor.x = Math.min(maxX, Math.max(minX, visitor.x + dir * speed * 1.4 * safeDt));
        } else {
          visitor.isMoving = false;
        }
        idx++;
        continue;
      }

      if (visitor.targetX !== null) {
        const diff = visitor.targetX - visitor.x;
        if (Math.abs(diff) <= 6) {
          visitor.x = visitor.targetX;
          visitor.targetX = null;
          visitor.isMoving = false;
          visitor.stateTimer = 2.5 + Math.random() * 4.0;
        } else {
          const dir = Math.sign(diff);
          visitor.flipX = dir < 0;
          visitor.isMoving = true;
          visitor.x = Math.min(maxX, Math.max(minX, visitor.x + dir * speed * safeDt));
        }
        idx++;
        continue;
      }

      visitor.isMoving = false;
      // Les visiteurs simulés ou par Passeport se promènent librement ; les visiteurs en salon suivent la position du vrai joueur
      if (visitor.source !== 'room') {
        visitor.stateTimer -= safeDt;
        if (visitor.stateTimer <= 0) {
          const roll = Math.random();
          let target: number;
          if (roll < 0.45) {
            target =
              visitor.x > (minX + maxX) / 2
                ? minX + Math.random() * ((maxX - minX) * 0.4)
                : maxX - Math.random() * ((maxX - minX) * 0.4);
          } else {
            target = minX + Math.random() * (maxX - minX);
          }
          visitor.targetX = Math.round(Math.min(maxX, Math.max(minX, target)));
        }
      }
      idx++;
    }

    this.syncPrimaryCompatFields();
  }
}
