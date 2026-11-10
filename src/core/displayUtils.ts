/**
 * Utilitaires géométriques purs pour le positionnement multi-écrans et le recalage (clamping)
 * des coordonnées du familier dans la zone de travail (`workArea`).
 */

/**
 * Recale proprement les coordonnées du familier à l'intérieur du `workArea` actif.
 * Indispensable lorsqu'un écran secondaire est débranché ou que la résolution / DPI change.
 */
export function clampPetPositionToWorkArea(
  position: { x: number; y: number },
  workArea: { x: number; y: number; width: number; height: number },
  spriteMargin: number = 0
): { x: number; y: number; wasClamped: boolean } {
  const safeMargin =
    typeof spriteMargin === 'number' && Number.isFinite(spriteMargin) && spriteMargin >= 0
      ? spriteMargin
      : 0;

  const safeWidth = Math.max(0, Number.isFinite(workArea.width) ? workArea.width : 0);
  const safeHeight = Math.max(0, Number.isFinite(workArea.height) ? workArea.height : 0);
  const originX = Number.isFinite(workArea.x) ? workArea.x : 0;
  const originY = Number.isFinite(workArea.y) ? workArea.y : 0;

  const effectiveMarginX = Math.min(safeMargin, Math.floor(safeWidth / 2));
  const effectiveMarginY = Math.min(safeMargin, Math.floor(safeHeight / 2));

  const minX = originX + effectiveMarginX;
  const maxX = originX + Math.max(effectiveMarginX, safeWidth - effectiveMarginX);
  const minY = originY + effectiveMarginY;
  const maxY = originY + Math.max(effectiveMarginY, safeHeight - effectiveMarginY);

  const rawX = position.x;
  const rawY = position.y;

  const isXFinite = typeof rawX === 'number' && Number.isFinite(rawX);
  const isYFinite = typeof rawY === 'number' && Number.isFinite(rawY);

  const clampedX = isXFinite
    ? Math.min(maxX, Math.max(minX, rawX))
    : Math.round(originX + safeWidth / 2);
  const clampedY = isYFinite
    ? Math.min(maxY, Math.max(minY, rawY))
    : Math.round(originY + safeHeight / 2);

  const wasClamped = !isXFinite || !isYFinite || clampedX !== rawX || clampedY !== rawY;

  return {
    x: clampedX,
    y: clampedY,
    wasClamped,
  };
}
