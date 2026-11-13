import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BallEntity } from '../../src/renderer/ballEntity';
import { PetActor } from '../../src/renderer/petActor';

describe('BallEntity - Balle de tennis et rebonds', () => {
  it('initialise et positionne la balle correctement', () => {
    const ball = new BallEntity();
    expect(ball.active).toBe(false);
    expect(ball.state).toBe('idle');

    ball.spawn(300, 500);
    expect(ball.active).toBe(true);
    expect(ball.state).toBe('ready');
    expect(ball.x).toBe(300);
    expect(ball.y).toBe(500);
  });

  it('rebondit sur le bord gauche de l écran', () => {
    const ball = new BallEntity();
    ball.spawn(10, 300);
    ball.throw(-400, 0); // Vitesse dirigée vers la gauche

    ball.update(0.016, 800, 1920);

    // La balle doit avoir rebondi vers la droite (vx positif)
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.x).toBeGreaterThanOrEqual(ball.radius + 10);
  });

  it('rebondit sur le bord droit de l écran', () => {
    const ball = new BallEntity();
    ball.spawn(1915, 300);
    ball.throw(500, 0); // Vitesse dirigée vers la droite

    ball.update(0.016, 800, 1920);

    // La balle doit avoir rebondi vers la gauche (vx négatif)
    expect(ball.vx).toBeLessThan(0);
    expect(ball.x).toBeLessThanOrEqual(1920 - ball.radius - 10);
  });

  it('rebondit sur le bord supérieur (plafond)', () => {
    const ball = new BallEntity();
    ball.spawn(400, 5);
    ball.throw(100, -600); // Vitesse projetée vers le haut

    ball.update(0.016, 800, 1920);

    // La balle doit avoir rebondi vers le bas (vy positif)
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.y).toBeGreaterThanOrEqual(ball.radius + 8);
  });

  it('rebondit sur le sol avec restitution élastique puis roule et s arrête', () => {
    const ball = new BallEntity();
    const groundY = 800;
    // Positionnée juste au-dessus du sol (floorY = 814)
    ball.spawn(400, 810);
    ball.throw(150, 400); // Vers le sol

    // 1 frame pour franchir floorY (814)
    ball.update(0.02, groundY, 1920);

    // Doit avoir rebondi vers le haut
    expect(ball.vy).toBeLessThan(0);
    expect(ball.state).toBe('flying');

    // Simule la retombée et l amortissement jusqu à l arrêt
    for (let i = 0; i < 200; i++) {
      ball.update(0.05, groundY, 1920);
    }
    expect(ball.state).toBe('stopped');
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
  });

  it('détecte correctement le survol du curseur', () => {
    const ball = new BallEntity();
    ball.spawn(200, 200);

    expect(ball.isPointInside(200, 200)).toBe(true);
    expect(ball.isPointInside(215, 200)).toBe(true);
    expect(ball.isPointInside(400, 400)).toBe(false);

    ball.reset();
    expect(ball.isPointInside(200, 200)).toBe(false);
  });
});

describe('PetActor - Comportement du jeu de balle et condition de capture réelle', () => {
  let onBallGrabbed: ReturnType<typeof vi.fn>;
  let onBallReturned: ReturnType<typeof vi.fn>;
  let pet: PetActor;

  beforeEach(() => {
    // Setup minimal window mock pour node environment
    vi.stubGlobal('window', {
      innerWidth: 1920,
      innerHeight: 1080,
    });

    onBallGrabbed = vi.fn();
    onBallReturned = vi.fn();

    pet = new PetActor(500, 800, {
      onClick: vi.fn(),
      onPetRub: vi.fn(),
      onPositionChanged: vi.fn(),
      onBallGrabbed,
      onBallReturned,
    });
    pet.setWalkSpeed(60);
    pet.setPosition(500, pet.getGroundY());
  });

  it('ne capture PAS la balle si elle passe au-dessus en altitude dans les airs', () => {
    const groundY = pet.getGroundY();
    // Balle lancée en cloche : elle passe exactement au-dessus du familier (X=500), mais à Y=200 (en plein vol)
    pet.startFetchingBall(500, 200);

    // Plusieurs frames de mise à jour
    pet.update(0.05, { canWalk: true });
    pet.update(0.05, { canWalk: true });
    pet.update(0.05, { canWalk: true });
    pet.update(0.1, { canWalk: true }); // timer > 0.2s

    // La balle est en l air à Y=200 alors que le familier est au sol à Y=groundY (~1000)
    expect(onBallGrabbed).not.toHaveBeenCalled();
    expect(pet.getIsFetchingBall()).toBe(true);
    expect(pet.getIsCarryingBall()).toBe(false);
  });

  it('ne capture PAS la balle immédiatement à t=0 dès le lâcher', () => {
    const groundY = pet.getGroundY();
    pet.startFetchingBall(500, groundY);

    // Première frame ultra-rapide (t < 0.2s)
    pet.update(0.016, { canWalk: true });

    expect(onBallGrabbed).not.toHaveBeenCalled();
    expect(pet.getIsFetchingBall()).toBe(true);
  });

  it('attrape pour de vrai la balle quand le familier l atteint au sol après le lancer', () => {
    const groundY = pet.getGroundY();
    // Balle atterrie au sol à X=600
    pet.startFetchingBall(600, groundY);

    // Le familier court vers la balle pendant plus de 0.2s
    for (let i = 0; i < 15; i++) {
      pet.update(0.05, { canWalk: true });
      if (onBallGrabbed.mock.calls.length > 0) break;
    }

    // Le familier a atteint la balle au sol et l attrape réellement
    expect(onBallGrabbed).toHaveBeenCalledTimes(1);
    expect(pet.getIsCarryingBall()).toBe(true);
    expect(pet.getIsFetchingBall()).toBe(false);
    expect(pet.x).toBe(600);
  });

  it('rapporte la balle attrapée vers le joueur et déclenche onBallReturned', () => {
    const groundY = pet.getGroundY();
    pet.startFetchingBall(600, groundY);

    // Course vers la balle et capture
    for (let i = 0; i < 15; i++) {
      pet.update(0.05, { canWalk: true });
    }
    expect(pet.getIsCarryingBall()).toBe(true);

    // Déplacement de la souris du joueur vers X=700
    pet.handlePointerMove(700, groundY);

    // Le familier court rapporter la balle au joueur (distance de 100px)
    for (let i = 0; i < 30; i++) {
      pet.update(0.05, { canWalk: true });
      if (onBallReturned.mock.calls.length > 0) break;
    }

    expect(onBallReturned).toHaveBeenCalledTimes(1);
    expect(pet.getIsCarryingBall()).toBe(false);
  });

  it('reste totalement immobile et annule la poursuite lorsqu il dort', () => {
    const groundY = pet.getGroundY();
    pet.startFetchingBall(780, groundY);
    pet.update(0.05, { canWalk: true, isSleeping: false });
    expect(pet.getIsFetchingBall()).toBe(true);

    const xWhenPutToSleep = pet.x;
    for (let i = 0; i < 10; i++) {
      pet.update(0.05, { canWalk: false, isSleeping: true });
    }

    expect(pet.getIsFetchingBall()).toBe(false);
    expect(pet.getIsCarryingBall()).toBe(false);
    expect(pet.isMoving).toBe(false);
    expect(pet.x).toBe(xWhenPutToSleep);
  });
});
