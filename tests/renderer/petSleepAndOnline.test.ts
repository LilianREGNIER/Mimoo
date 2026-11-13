import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineManager } from '../../src/renderer/onlineManager';

describe('OnlineManager - Invitation et renvoi d un pet ami', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      innerWidth: 1920,
      innerHeight: 1080,
    });
  });

  it('permet d inviter un compagnon puis de le renvoyer proprement via leaveRoom / removeVisitor', () => {
    const onArrival = vi.fn();
    const onDeparture = vi.fn();

    const online = new OnlineManager({
      onFriendArrival: onArrival,
      onFriendDeparture: onDeparture,
      onPlayTogetherRequested: vi.fn(),
    });

    expect(online.hasVisitor()).toBe(false);
    expect(online.getVisitor()).toBeNull();

    const simulated = online.spawnSimulatedFriend();
    expect(online.hasVisitor()).toBe(true);
    expect(online.getVisitor()?.id).toBe(simulated.id);
    expect(onArrival).toHaveBeenCalledTimes(1);

    online.leaveRoom('Mochi');
    expect(online.hasVisitor()).toBe(false);
    expect(online.getVisitor()).toBeNull();
    expect(online.getCurrentRoomCode()).toBeNull();
    expect(onDeparture).toHaveBeenCalledTimes(1);
  });

  it('supporte plusieurs amis simultanés dans un salon sans collision', () => {
    const online = new OnlineManager({
      onFriendArrival: vi.fn(),
      onFriendDeparture: vi.fn(),
      onPlayTogetherRequested: vi.fn(),
    });

    online.setVisitor(
      {
        id: 'peer-a',
        name: 'Lili',
        ownerName: 'Alex',
        formId: 'baby_aqua',
        stage: 'baby',
        lineage: 'aqua',
        equippedCosmetics: { hat: null, accessory: null, aura: null },
        happiness: 90,
        x: 0.3,
        direction: 1,
      },
      'room'
    );
    online.setVisitor(
      {
        id: 'peer-b',
        name: 'Piko',
        ownerName: 'Sam',
        formId: 'child_ember',
        stage: 'child',
        lineage: 'ember',
        equippedCosmetics: { hat: 'hat_crown', accessory: null, aura: null },
        happiness: 95,
        x: 0.7,
        direction: -1,
      },
      'room'
    );

    expect(online.getVisitors()).toHaveLength(2);
    online.removeVisitor('peer-a');
    expect(online.getVisitors()).toHaveLength(1);
    expect(online.getVisitors()[0].profile.id).toBe('peer-b');
  });
});
