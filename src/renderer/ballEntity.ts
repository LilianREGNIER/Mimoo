/**
 * Entité physique 2D pour la balle de tennis interactive ("Lancer de balle au bureau").
 * Gère la balistique, les rebonds avec restitution élastique sur le sol/bords de l'écran,
 * le roulement et la rotation de la balle sur le Canvas.
 */

export type BallState = 'idle' | 'ready' | 'dragging' | 'flying' | 'rolling' | 'stopped' | 'carried' | 'returned';

export class BallEntity {
  public x = 0;
  public y = 0;
  public vx = 0;
  public vy = 0;
  public radius = 8;
  public state: BallState = 'idle';
  public rotation = 0;
  public active = false;
  private trail: { x: number; y: number; alpha: number }[] = [];

  /**
   * Place la balle sur le terrain en position d'attente, prête à être attrapée et lancée par le joueur.
   */
  public spawn(startX: number, startY: number): void {
    this.x = startX;
    this.y = startY;
    this.vx = 0;
    this.vy = 0;
    this.active = true;
    this.state = 'ready';
    this.trail = [];
  }

  /**
   * Projette la balle avec une vélocité physique calculée lors du relâchement (flick / throw).
   */
  public throw(vx: number, vy: number): void {
    this.active = true;
    this.state = 'flying';
    this.vx = Math.max(-1800, Math.min(1800, vx));
    this.vy = Math.max(-1600, Math.min(1400, vy));
    this.trail = [];
  }

  /**
   * Teste si un point du curseur survole la balle.
   */
  public isPointInside(px: number, py: number, padding = 16): boolean {
    if (!this.active || this.state === 'idle' || this.state === 'carried' || this.state === 'returned') {
      return false;
    }
    return Math.hypot(px - this.x, py - this.y) <= this.radius + padding;
  }

  /**
   * Lance la balle depuis `(startX, startY)` vers `(targetX, targetY)` avec un arc balistique.
   */
  public launch(startX: number, startY: number, targetX: number, targetY: number): void {
    this.x = startX;
    this.y = startY;
    this.active = true;
    this.state = 'flying';
    this.trail = [];

    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.hypot(dx, dy);

    // Calcul de la vitesse initiale proportionnelle à la distance
    const speed = Math.max(340, Math.min(880, dist * 2.3));
    // Inclinaison vers le haut pour une belle trajectoire en cloche
    const angle = Math.atan2(dy - 130, dx);

    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
  }

  /**
   * Réinitialise et désactive la balle.
   */
  public reset(): void {
    this.active = false;
    this.state = 'idle';
    this.vx = 0;
    this.vy = 0;
    this.trail = [];
  }

  /**
   * Met à jour la physique (gravité, friction, rebonds sur le sol et les parois latérales).
   */
  public update(dtSeconds: number, groundY: number, screenWidth: number): void {
    if (
      !this.active ||
      this.state === 'idle' ||
      this.state === 'ready' ||
      this.state === 'dragging' ||
      this.state === 'carried' ||
      this.state === 'returned'
    ) {
      return;
    }

    const safeDt = Math.min(0.08, Math.max(0, dtSeconds));
    const gravity = 880; // px/s²
    const floorY = groundY + 14;

    // Si la balle est déjà au sol en roulement ou arrêtée
    if (this.state === 'rolling' || this.state === 'stopped') {
      this.vy = 0;
      this.y = floorY;
      this.x += this.vx * safeDt;
      this.rotation += this.vx * safeDt * 0.12;

      // Décélération par frottement au sol
      this.vx *= Math.pow(0.88, safeDt * 60);

      // Rebonds sur les parois latérales pendant le roulement
      const minX = this.radius + 10;
      const maxX = screenWidth - this.radius - 10;
      if (this.x < minX) {
        this.x = minX;
        this.vx = Math.abs(this.vx) * 0.8;
      } else if (this.x > maxX) {
        this.x = maxX;
        this.vx = -Math.abs(this.vx) * 0.8;
      }

      if (Math.abs(this.vx) < 14) {
        this.vx = 0;
        this.state = 'stopped';
      }
      return;
    }

    // Trajectoire balistique aérienne (state === 'flying')
    this.vy += gravity * safeDt;
    this.x += this.vx * safeDt;
    this.y += this.vy * safeDt;

    // Rotation proportionnelle au déplacement horizontal
    this.rotation += this.vx * safeDt * 0.12;

    // Traînée visuelle
    if (Math.abs(this.vx) > 30 || Math.abs(this.vy) > 30) {
      this.trail.unshift({ x: this.x, y: this.y, alpha: 0.55 });
      if (this.trail.length > 5) {
        this.trail.pop();
      }
    }
    for (const t of this.trail) {
      t.alpha -= safeDt * 2.8;
    }
    this.trail = this.trail.filter((t) => t.alpha > 0);

    // Rebond sur le bord supérieur de l'écran (plafond)
    const minY = this.radius + 8;
    if (this.y < minY) {
      this.y = minY;
      this.vy = Math.abs(this.vy) * 0.78;
    }

    // Rebonds latéraux sur les bords d'écran (gauche et droite)
    const minX = this.radius + 10;
    const maxX = screenWidth - this.radius - 10;
    if (this.x < minX) {
      this.x = minX;
      this.vx = Math.abs(this.vx) * 0.8;
    } else if (this.x > maxX) {
      this.x = maxX;
      this.vx = -Math.abs(this.vx) * 0.8;
    }

    // Rebond au sol
    if (this.y >= floorY) {
      this.y = floorY;
      if (Math.abs(this.vy) > 60) {
        this.vy = -Math.abs(this.vy) * 0.72; // Restitution élastique franche
        this.vx *= 0.9; // Léger frottement au rebond
        this.state = 'flying';
      } else {
        this.vy = 0;
        this.vx *= 0.9;
        if (Math.abs(this.vx) < 14) {
          this.vx = 0;
          this.state = 'stopped';
        } else {
          this.state = 'rolling';
        }
      }
    }
  }

  /**
   * Rendu visuel de la balle et de sa traînée sur le canvas 2D.
   */
  public render(ctx: CanvasRenderingContext2D): void {
    if (!this.active || this.state === 'idle' || this.state === 'carried' || this.state === 'returned') {
      return;
    }

    // Traînée lumineuse de vitesse
    for (const t of this.trail) {
      if (t.alpha <= 0) continue;
      ctx.fillStyle = `rgba(190, 242, 100, ${Math.max(0, t.alpha * 0.45)})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, this.radius * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ombre portée au sol
    ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + this.radius - 1, this.radius * 0.95, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Corps de la balle de tennis
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    ctx.fillStyle = '#bef264';
    ctx.strokeStyle = '#4d7c0f';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Coutures blanches arrondies
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(-2.5, 0, this.radius * 0.7, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // Halo d'interaction si prête à être lancée ou tenue en main
    if (this.state === 'ready' || this.state === 'dragging' || this.state === 'stopped') {
      ctx.strokeStyle = this.state === 'dragging' ? 'rgba(250, 204, 21, 0.9)' : 'rgba(190, 242, 100, 0.65)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
}
