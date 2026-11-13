#!/usr/bin/env node
/**
 * scripts/generate-placeholders.mjs
 *
 * Générateur autonome (zéro dépendance externe, uniquement fs, path, zlib natifs Node.js)
 * produisant :
 * - Les 19 spritesheets PNG RGBA 32-bits (256x512 px, grille 4x8 de cellules 64x64 px, fond transparent)
 *   dans assets/sprites/<formId>.png avec 19 archétypes morphologiques distincts (façon Tamagotchi) :
 *     1. egg                  -> mystic_egg
 *     2. Lignée Aquatique (aqua) :
 *        baby_aqua            -> droplet_slime
 *        child_aqua           -> axolotl_tadpole
 *        adult_aqua_coral     -> sea_angel
 *        adult_aqua_leviathan -> serpent_dragon
 *        adult_aqua_pearl     -> octopus
 *        adult_aqua_abyss     -> anglerfish
 *     3. Lignée Sylvestre (flora) :
 *        baby_flora           -> bulb_quadruped
 *        child_flora          -> biped_dino
 *        adult_flora_bloom    -> mametchi_ears
 *        adult_flora_raptor   -> raptor_bird
 *        adult_flora_truffle  -> kuchipatchi_mushroom
 *        adult_flora_thorn    -> carnivorous_vine
 *     4. Lignée Astrale / Flamme (ember) :
 *        baby_ember           -> star_spirit
 *        child_ember          -> winged_comet
 *        adult_ember_solar    -> phoenix
 *        adult_ember_comet    -> mecha_star
 *        adult_ember_magma    -> lava_golem
 *        adult_ember_eclipse  -> phantom_bat
 * - Le manifeste assets/sprites/sprites-manifest.json (8 lignes d'animation x 4 frames, 19 formes)
 * - Les icônes assets/icons/tray-icon.png (32x32), assets/icons/app-icon.png (256x256)
 *   et assets/icons/app-icon.ico (ICO Windows valide encapsulant le PNG 256x256).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SPRITES_DIR = path.join(ROOT_DIR, 'assets', 'sprites');
const ICONS_DIR = path.join(ROOT_DIR, 'assets', 'icons');

// ============================================================================
// 1. ENCODEUR PNG RGBA 32-BITS & ICO WINDOWS (100% NATIF NODE.JS)
// ============================================================================

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeStr, dataBuf) {
  const typeBuf = Buffer.from(typeStr, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataBuf.length, 0);

  const crcInput = Buffer.concat([typeBuf, dataBuf]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, dataBuf, crcBuf]);
}

/**
 * Encode un buffer RGBA (width * height * 4 octets) en fichier PNG RGBA 32-bits valide.
 */
function encodePNG(width, height, rgbaData) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // Bit depth: 8 bits per channel
  ihdr[9] = 6;  // Color type: 6 (Truecolor with alpha RGBA)
  ihdr[10] = 0; // Compression method: 0 (deflate)
  ihdr[11] = 0; // Filter method: 0
  ihdr[12] = 0; // Interlace method: 0 (no interlace)

  const stride = width * 4;
  const rawData = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawData[rowStart] = 0; // Filter type 0 (None)
    const srcOffset = y * stride;
    for (let i = 0; i < stride; i++) {
      rawData[rowStart + 1 + i] = rgbaData[srcOffset + i];
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', compressed);
  const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Encapsule un buffer PNG 256x256 dans un conteneur Windows ICO valide.
 */
function encodeICOFromPNG256(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved = 0
  header.writeUInt16LE(1, 2); // Type = 1 (ICO)
  header.writeUInt16LE(1, 4); // Count = 1 image

  const entry = Buffer.alloc(16);
  entry[0] = 0; // Width: 0 means 256 px
  entry[1] = 0; // Height: 0 means 256 px
  entry[2] = 0; // Color palette count (0 = no palette)
  entry[3] = 0; // Reserved = 0
  entry.writeUInt16LE(1, 4);  // Color planes = 1
  entry.writeUInt16LE(32, 6); // Bits per pixel = 32
  entry.writeUInt32LE(pngBuffer.length, 8); // Size of PNG data
  entry.writeUInt32LE(6 + 16, 12);          // Offset to PNG data (22)

  return Buffer.concat([header, entry, pngBuffer]);
}

// ============================================================================
// 2. OUTILS DE DESSIN PIXEL-ART & ARCHÉTYPES MORPHOLOGIQUES
// ============================================================================

function hexToRgba(hex, alpha = 255) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b, alpha];
}

class PixelCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  setPixelRaw(x, y, r, g, b, a = 255) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height || a <= 0) return;
    const idx = (iy * this.width + ix) * 4;
    if (a >= 255 || this.data[idx + 3] === 0) {
      this.data[idx] = r;
      this.data[idx + 1] = g;
      this.data[idx + 2] = b;
      this.data[idx + 3] = a;
    } else {
      const srcA = a / 255;
      const dstA = this.data[idx + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      this.data[idx] = Math.round((r * srcA + this.data[idx] * dstA * (1 - srcA)) / outA);
      this.data[idx + 1] = Math.round((g * srcA + this.data[idx + 1] * dstA * (1 - srcA)) / outA);
      this.data[idx + 2] = Math.round((b * srcA + this.data[idx + 2] * dstA * (1 - srcA)) / outA);
      this.data[idx + 3] = Math.round(outA * 255);
    }
  }

  fillBlock(x, y, scale, color) {
    if (!color) return;
    const [r, g, b, a = 255] = typeof color === 'string' ? hexToRgba(color) : color;
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        this.setPixelRaw(x + dx, y + dy, r, g, b, a);
      }
    }
  }

  toPNG() {
    return encodePNG(this.width, this.height, this.data);
  }
}

/**
 * Vue logique 32x32 pour une cellule 64x64 (chaque point logique = bloc 2x2 px).
 * Garantit un rendu pixel-art net, lisible et très expressif.
 */
class CellPainter {
  constructor(sheetCanvas, col, row, cellSize = 64, pixelScale = 2) {
    this.sheet = sheetCanvas;
    this.originX = col * cellSize;
    this.originY = row * cellSize;
    this.scale = pixelScale;
    this.gridSize = cellSize / pixelScale; // 32x32
  }

  dot(lx, ly, color) {
    const ix = Math.round(lx);
    const iy = Math.round(ly);
    if (ix < 0 || ix >= this.gridSize || iy < 0 || iy >= this.gridSize) return;
    this.sheet.fillBlock(
      this.originX + ix * this.scale,
      this.originY + iy * this.scale,
      this.scale,
      color
    );
  }

  rect(lx, ly, w, h, color) {
    const x0 = Math.round(lx);
    const y0 = Math.round(ly);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        this.dot(x0 + x, y0 + y, color);
      }
    }
  }

  line(x0, y0, x1, y1, color) {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      this.dot(ix0, iy0, color);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        ix0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  /**
   * Dessine une forme organique profilée ligne par ligne :
   * pour chaque coordonnée y entre yTop et yBottom, radiusFn(t) (avec t dans [0..1])
   * donne la demi-largeur rx(y) et centerOffsetFn(t) donne le décalage horizontal dx(y).
   */
  sculptedBody(cx, yTop, yBottom, radiusFn, palette, centerOffsetFn = () => 0) {
    const { outline, base, shade, highlight } = palette;
    const iyTop = Math.round(yTop);
    const iyBottom = Math.round(yBottom);
    const h = Math.max(1, iyBottom - iyTop);

    for (let y = iyTop; y <= iyBottom; y++) {
      const t = (y - iyTop) / h; // 0 en haut, 1 en bas
      const rx = radiusFn(t);
      if (rx <= 0) continue;
      const rowCx = cx + centerOffsetFn(t);
      const minX = Math.floor(rowCx - rx - 1);
      const maxX = Math.ceil(rowCx + rx + 1);

      for (let x = minX; x <= maxX; x++) {
        const nx = (x - rowCx) / rx;
        const absNx = Math.abs(nx);
        if (absNx <= 1.05) {
          const isTopOrBottom = y === iyTop || y === iyBottom;
          const isEdge = absNx >= 0.78 || isTopOrBottom;
          if (isEdge) {
            this.dot(x, y, outline);
          } else if (nx > 0.32 || t > 0.82) {
            this.dot(x, y, shade);
          } else if (nx < -0.22 && t > 0.15 && t < 0.55) {
            this.dot(x, y, highlight);
          } else {
            this.dot(x, y, base);
          }
        }
      }
    }
  }

  /**
   * Dessine un corps ovale/arrondi en pixel-art avec contour, couleur de base,
   * ombrage bas-droite et reflet haut-gauche.
   */
  shadedBody(cx, cy, rx, ry, palette, flattenBottom = 0) {
    const { outline, base, shade, highlight } = palette;
    const minX = Math.floor(cx - rx - 1);
    const maxX = Math.ceil(cx + rx + 1);
    const minY = Math.floor(cy - ry - 1);
    const maxY = Math.ceil(cy + ry + 1);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (flattenBottom > 0 && y > cy + ry - flattenBottom) continue;
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const dist = nx * nx + ny * ny;

        if (dist <= 1.08) {
          const isBottomFlatBorder = flattenBottom > 0 && y === Math.floor(cy + ry - flattenBottom);
          if (dist >= 0.74 || isBottomFlatBorder) {
            this.dot(x, y, outline);
          } else if (nx + ny > 0.38) {
            this.dot(x, y, shade);
          } else if (nx < -0.22 && ny < -0.22 && dist < 0.52) {
            this.dot(x, y, highlight);
          } else {
            this.dot(x, y, base);
          }
        }
      }
    }
  }

  /**
   * Ombre statique désactivée : l'ombre dynamique au sol est dessinée en temps réel par SpriteAnimator
   */
  groundShadow(_cx = 16, _cy = 28, _rx = 8, _ry = 1.8) {
    // Intentionnellement vide pour éviter une double ombre sous le familier
  }

  /**
   * Dessine les poses de besoins (ligne 6 : hungry gargouillis, ligne 7 : need_cuddle bras levés)
   * adaptées à la morphologie de chaque archétype.
   */
  drawNeedPoseOverlay(cx, cy, state, frame, palette, options = {}) {
    const { outline, base, highlight } = palette;
    const bellyY = options.bellyY ?? (cy + 3);
    const bellyRx = options.bellyRx ?? 7;
    const armY = options.armY ?? (cy - 2);
    const armSpan = options.armSpan ?? 8;

    if (state === 'hungry') {
      // Mains/pattes pressées sur le ventre qui gargouille
      const tremor = frame % 2;
      this.rect(cx - 5, bellyY + tremor, 3, 2, outline);
      this.rect(cx - 4, bellyY + tremor, 2, 1, highlight || base);
      this.rect(cx + 2, bellyY + tremor, 3, 2, outline);
      this.rect(cx + 2, bellyY + tremor, 2, 1, highlight || base);

      // Ondes de gargouillis vibrantes de part et d'autre du ventre
      const waveColor = '#FBBF24';
      const waveLight = '#FEF08A';
      if (frame % 2 === 0) {
        this.dot(cx - bellyRx - 1, bellyY, waveColor);
        this.dot(cx - bellyRx - 2, bellyY + 1, waveLight);
        this.dot(cx + bellyRx + 1, bellyY, waveColor);
        this.dot(cx + bellyRx + 2, bellyY + 1, waveLight);
      } else {
        this.dot(cx - bellyRx - 2, bellyY - 1, waveColor);
        this.dot(cx - bellyRx - 1, bellyY + 2, waveLight);
        this.dot(cx + bellyRx + 2, bellyY - 1, waveColor);
        this.dot(cx + bellyRx + 1, bellyY + 2, waveLight);
      }
    } else if (state === 'need_cuddle') {
      // Bras / appendices levés vers le haut pour réclamer un câlin
      const leftUp = frame % 2 === 0 ? -1 : 0;
      const rightUp = frame % 2 === 1 ? -1 : 0;
      this.rect(cx - armSpan - 2, armY + leftUp, 3, 3, outline);
      this.rect(cx - armSpan - 1, armY + 1 + leftUp, 2, 2, highlight || base);
      this.rect(cx + armSpan - 1, armY + rightUp, 3, 3, outline);
      this.rect(cx + armSpan - 1, armY + 1 + rightUp, 2, 2, highlight || base);
    }
  }

  /**
   * Visage expressif adapté à l'archétype (`eyeStyle`, `mouthStyle`) et aux 8 états :
   * idle, walk, eat, happy, sleep, sad, hungry, need_cuddle
   */
  drawFace(cx, cy, state, frame, options = {}) {
    const eyeColor = options.eyeColor || '#141B29';
    const eyeShine = options.eyeShine || '#FFFFFF';
    const cheekColor = options.cheekColor === undefined ? '#FF7EB6' : options.cheekColor;
    const mouthColor = options.mouthColor || '#9E2A47';
    const eyeSpan = options.eyeSpan ?? 4;
    const eyeStyle = options.eyeStyle || 'normal';
    const mouthStyle = options.mouthStyle || 'normal';

    const lx = Math.round(cx - eyeSpan);
    const rx = Math.round(cx + eyeSpan - 1);

    // Cas spécial : Casque à visière néon cyan (adult_ember_comet / mecha_star)
    if (eyeStyle === 'visor_cyan') {
      // Boîtier de visière sombre
      this.rect(cx - 6, cy - 2, 13, 4, '#090D16');
      const neon = '#00F5D4';
      const neonBright = '#E0FFFA';
      if (state === 'happy') {
        // ^ ^ numériques sur la visière
        this.dot(cx - 4, cy, neon);
        this.dot(cx - 3, cy - 1, neonBright);
        this.dot(cx - 2, cy, neon);
        this.dot(cx + 2, cy, neon);
        this.dot(cx + 3, cy - 1, neonBright);
        this.dot(cx + 4, cy, neon);
      } else if (state === 'sleep') {
        // Visière en veille (ligne pointillée basse)
        this.rect(cx - 4, cy, 3, 1, '#0284C7');
        this.rect(cx + 2, cy, 3, 1, '#0284C7');
      } else if (state === 'sad' || state === 'hungry') {
        // Yeux obliques d'alerte
        this.dot(cx - 4, cy - 1, '#FACC15');
        this.dot(cx - 3, cy, '#FACC15');
        this.dot(cx + 4, cy - 1, '#FACC15');
        this.dot(cx + 3, cy, '#FACC15');
      } else if (state === 'need_cuddle') {
        // Grands yeux pixels brillants sur l'écran
        this.rect(cx - 4, cy - 1, 3, 2, neon);
        this.dot(cx - 4, cy - 1, neonBright);
        this.rect(cx + 2, cy - 1, 3, 2, neon);
        this.dot(cx + 2, cy - 1, neonBright);
      } else {
        // Visière néon cyan futuriste avec reflet balayant
        this.rect(cx - 5, cy - 1, 11, 2, neon);
        const scanX = cx - 4 + (frame * 2);
        this.rect(scanX, cy - 1, 2, 1, neonBright);
      }
      return;
    }

    // Joues roses/colorées (plus vives sur need_cuddle et happy)
    if (cheekColor && state !== 'sad' && state !== 'hungry') {
      this.dot(lx - 2, cy + 2, cheekColor);
      this.dot(lx - 1, cy + 2, cheekColor);
      this.dot(rx + 2, cy + 2, cheekColor);
      this.dot(rx + 3, cy + 2, cheekColor);
    }

    // --- YEUX SELON L'ÉTAT ET L'ARCHÉTYPE ---
    if (state === 'happy') {
      this.dot(lx - 1, cy, eyeColor);
      this.dot(lx, cy - 1, eyeColor);
      this.dot(lx + 1, cy, eyeColor);

      this.dot(rx, cy, eyeColor);
      this.dot(rx + 1, cy - 1, eyeColor);
      this.dot(rx + 2, cy, eyeColor);
    } else if (state === 'sleep') {
      this.dot(lx - 1, cy + 1, eyeColor);
      this.dot(lx, cy + 1, eyeColor);
      this.dot(lx + 1, cy + 1, eyeColor);

      this.dot(rx, cy + 1, eyeColor);
      this.dot(rx + 1, cy + 1, eyeColor);
      this.dot(rx + 2, cy + 1, eyeColor);
    } else if (state === 'sad') {
      this.dot(lx, cy, eyeColor);
      this.dot(lx + 1, cy, eyeColor);
      this.dot(lx - 1, cy - 1, eyeColor);

      this.dot(rx, cy, eyeColor);
      this.dot(rx + 1, cy, eyeColor);
      this.dot(rx + 2, cy - 1, eyeColor);
      this.dot(lx - 1, cy + 1, '#5CE1E6');
    } else if (state === 'hungry') {
      this.rect(lx, cy, 2, 2, eyeColor);
      this.dot(lx, cy, eyeShine);
      this.dot(lx - 1, cy - 1, eyeColor);
      this.dot(lx, cy - 2, eyeColor);

      this.rect(rx, cy, 2, 2, eyeColor);
      this.dot(rx, cy, eyeShine);
      this.dot(rx + 2, cy - 1, eyeColor);
      this.dot(rx + 1, cy - 2, eyeColor);
    } else if (state === 'need_cuddle') {
      // Grands yeux suppliants (2x3 / 3x3 avec double reflet brillant)
      this.rect(lx - 1, cy - 1, 3, 3, eyeColor);
      this.dot(lx - 1, cy - 1, eyeShine);
      this.dot(lx + 1, cy + 1, eyeShine);

      this.rect(rx, cy - 1, 3, 3, eyeColor);
      this.dot(rx, cy - 1, eyeShine);
      this.dot(rx + 2, cy + 1, eyeShine);
    } else {
      // État normal (idle, walk, eat) : yeux propres au bodyArchetype !
      if (eyeStyle === 'liquid') {
        // Grands yeux ronds liquides 2x3 avec reflet aquatique cyan + blanc
        this.rect(lx, cy - 1, 2, 3, eyeColor);
        this.dot(lx, cy - 1, '#FFFFFF');
        this.dot(lx + 1, cy + 1, '#67E8F9');
        this.rect(rx, cy - 1, 2, 3, eyeColor);
        this.dot(rx, cy - 1, '#FFFFFF');
        this.dot(rx + 1, cy + 1, '#67E8F9');
      } else if (eyeStyle === 'slanted_fire') {
        // Yeux obliques ardents inclinés vers le centre !
        this.dot(lx - 1, cy - 1, '#FEF08A');
        this.rect(lx, cy - 1, 2, 2, eyeColor);
        this.dot(lx + 1, cy, '#FEF08A');

        this.dot(rx + 2, cy - 1, '#FEF08A');
        this.rect(rx, cy - 1, 2, 2, eyeColor);
        this.dot(rx, cy, '#FEF08A');
      } else if (eyeStyle === 'curious') {
        // Grands yeux curieux cerclés de blanc
        this.rect(lx - 1, cy - 1, 3, 3, '#FFFFFF');
        this.rect(lx, cy, 2, 2, eyeColor);
        this.dot(lx, cy - 1, eyeShine);
        this.rect(rx, cy - 1, 3, 3, '#FFFFFF');
        this.rect(rx, cy, 2, 2, eyeColor);
        this.dot(rx, cy - 1, eyeShine);
      } else if (eyeStyle === 'serene') {
        // Yeux d'ange des mers avec longs cils gracieux sur les côtés
        this.rect(lx, cy - 1, 2, 2, eyeColor);
        this.dot(lx, cy - 1, eyeShine);
        this.dot(lx - 1, cy - 1, eyeColor);
        this.rect(rx, cy - 1, 2, 2, eyeColor);
        this.dot(rx, cy - 1, eyeShine);
        this.dot(rx + 2, cy - 1, eyeColor);
      } else if (eyeStyle === 'fierce') {
        // Regard vif avec arcade sourcilière marquée
        this.rect(lx, cy, 2, 2, eyeColor);
        this.dot(lx, cy, eyeShine);
        this.dot(lx - 1, cy - 1, eyeColor);
        this.dot(lx, cy - 1, eyeColor);
        this.rect(rx, cy, 2, 2, eyeColor);
        this.dot(rx, cy, eyeShine);
        this.dot(rx + 1, cy - 1, eyeColor);
        this.dot(rx + 2, cy - 1, eyeColor);
      } else {
        // Yeux classiques Tamagotchi 2x2 brillants
        this.rect(lx, cy - 1, 2, 2, eyeColor);
        this.dot(lx, cy - 1, eyeShine);
        this.rect(rx, cy - 1, 2, 2, eyeColor);
        this.dot(rx, cy - 1, eyeShine);
      }
    }

    // --- BOUCHE / BEC / LÈVRES SELON L'ARCHÉTYPE ET L'ÉTAT ---
    const my = cy + 2;

    if (mouthStyle === 'kuchipatchi_lips') {
      // Gros bec / lèvres épaisses façon Kuchipatchi au centre du visage !
      const lipOutline = '#7C2D12';
      const lipFill = '#FB923C';
      const lipHighlight = '#FDE68A';
      const open = (state === 'eat' && frame % 2 === 0) || state === 'happy' || state === 'need_cuddle';
      this.rect(cx - 4, my, 9, open ? 4 : 3, lipOutline);
      this.rect(cx - 3, my, 7, 1, lipHighlight); // Lèvre supérieure bombée
      if (open) {
        this.rect(cx - 2, my + 1, 5, 2, '#991B1B'); // Intérieur bouche
        this.rect(cx - 1, my + 2, 3, 1, '#FDA4AF'); // Langue
        this.rect(cx - 3, my + 3, 7, 1, lipFill);   // Lèvre inférieure
      } else {
        this.rect(cx - 3, my + 1, 7, 1, lipFill);
        this.dot(cx - 2, my + 1, lipOutline);
        this.dot(cx + 2, my + 1, lipOutline);
      }
      return;
    }

    if (mouthStyle === 'octo_tube') {
      // Bouche en tube/ventouse ronde façon Takotchi / Poulpe
      const tubeY = (state === 'eat' && frame % 2 === 0) ? my - 1 : my;
      this.rect(cx - 2, tubeY, 5, 4, '#E11D48');
      this.rect(cx - 1, tubeY + 1, 3, 2, '#1E293B');
      this.dot(cx - 1, tubeY, '#FDA4AF');
      return;
    }

    if (mouthStyle === 'angler_teeth') {
      // Grande bouche de baudroie des abysses avec petites dents blanches rigolotes !
      const jawH = (state === 'eat' && frame % 2 === 0) ? 5 : 4;
      this.rect(cx - 6, my, 13, jawH, '#020617');
      this.rect(cx - 5, my + 1, 11, jawH - 2, '#1E1B4B');
      // Petites dents blanches en haut et en bas
      for (let tx = -4; tx <= 4; tx += 2) {
        if (tx === 0) continue;
        this.dot(cx + tx, my, '#FFFFFF');
        this.dot(cx + tx, my + jawH - 1, '#FFFFFF');
      }
      if (state === 'eat' && frame % 2 === 0) {
        this.rect(cx - 1, my + 2, 3, 2, '#00F5D4'); // Langue bioluminescente
      }
      return;
    }

    if (mouthStyle === 'beak') {
      // Bec d'oiseau/raptor ou de Phénix crochu jaune/doré
      const beakTop = '#FACC15';
      const beakShade = '#D97706';
      this.rect(cx - 2, my - 1, 5, 2, beakTop);
      this.rect(cx - 1, my + 1, 3, 1, beakShade);
      this.dot(cx, my + 2, beakShade); // Pointe crochue
      if ((state === 'eat' && frame % 2 === 0) || state === 'happy' || state === 'need_cuddle') {
        this.dot(cx, my + 1, '#EF4444'); // Bec entrouvert
      }
      return;
    }

    if (mouthStyle === 'stitched_vine') {
      // Sourire dentelé de plante carnivore
      this.rect(cx - 4, my + 1, 9, 2, '#090D16');
      this.dot(cx - 3, my + 1, '#FEF08A');
      this.dot(cx, my + 2, '#FEF08A');
      this.dot(cx + 3, my + 1, '#FEF08A');
      return;
    }

    if (mouthStyle === 'golem_jaw') {
      // Mâchoire de roche crénelée illuminée par la lave interne
      const lavaGlow = (state === 'eat' && frame % 2 === 0) ? '#FEF08A' : '#F97316';
      this.rect(cx - 4, my + 1, 9, 2, '#1C1917');
      this.dot(cx - 3, my + 1, lavaGlow);
      this.dot(cx - 1, my + 2, lavaGlow);
      this.dot(cx + 1, my + 1, lavaGlow);
      this.dot(cx + 3, my + 2, lavaGlow);
      return;
    }

    if (mouthStyle === 'fangs') {
      // Bouche espiègle à deux petites quenottes blanches de chauve-souris / Devilgotchi
      this.rect(cx - 3, my, 7, 1, eyeColor);
      this.dot(cx - 2, my + 1, '#FFFFFF');
      this.dot(cx + 2, my + 1, '#FFFFFF');
      if (state === 'eat' && frame % 2 === 0) {
        this.rect(cx - 1, my + 1, 3, 2, mouthColor);
      }
      return;
    }

    // Bouche standard adaptée à l'état
    if (state === 'eat') {
      if (frame % 2 === 0) {
        this.rect(cx - 1, my, 3, 2, mouthColor);
        this.dot(cx, my + 1, '#FF8FA3');
      } else {
        this.dot(cx - 1, my, eyeColor);
        this.dot(cx, my, eyeColor);
      }
    } else if (state === 'happy') {
      this.dot(cx - 1, my, eyeColor);
      this.dot(cx, my + 1, mouthColor);
      this.dot(cx + 1, my, eyeColor);
    } else if (state === 'sad') {
      this.dot(cx - 1, my + 1, eyeColor);
      this.dot(cx, my, eyeColor);
      this.dot(cx + 1, my + 1, eyeColor);
    } else if (state === 'hungry') {
      const w0 = frame % 2;
      const w1 = (frame + 1) % 2;
      this.dot(cx - 2, my + w0, mouthColor);
      this.dot(cx - 1, my + w1, eyeColor);
      this.dot(cx, my + w0, mouthColor);
      this.dot(cx + 1, my + w1, eyeColor);
    } else if (state === 'need_cuddle') {
      this.dot(cx - 2, my, eyeColor);
      this.dot(cx - 1, my + 1, mouthColor);
      this.dot(cx, my, eyeColor);
      this.dot(cx + 1, my + 1, mouthColor);
      this.dot(cx + 2, my, eyeColor);
    } else if (state === 'sleep') {
      this.dot(cx, my, eyeColor);
    } else if (mouthStyle === 'wide_axolotl') {
      // Grand sourire d'axolotl
      this.dot(cx - 3, my, eyeColor);
      this.rect(cx - 2, my + 1, 5, 1, eyeColor);
      this.dot(cx + 3, my, eyeColor);
    } else if (mouthStyle === 'cat') {
      // Petite bouche en 'w' de bourgeon/félin
      this.dot(cx - 2, my + 1, eyeColor);
      this.dot(cx - 1, my, eyeColor);
      this.dot(cx, my + 1, eyeColor);
      this.dot(cx + 1, my, eyeColor);
    } else {
      this.dot(cx - 1, my, eyeColor);
      this.dot(cx, my, eyeColor);
    }
  }

  /**
   * Effets visuels d'état :
   * - happy : cœur + étoiles
   * - sleep : Zzz
   * - eat : nourriture + miettes
   * - sad : goutte de sueur
   * - hungry : icône de faim (cuisse de poulet / bol)
   * - need_cuddle : cœurs d'appel + étoile de jeu rebondissante
   */
  drawStateEffects(state, frame) {
    if (state === 'happy') {
      const hy = 4 - (frame % 2);
      const hx = 25;
      const heartRed = '#FF3B6B';
      const heartLight = '#FF8FA3';
      this.dot(hx, hy, heartRed);
      this.dot(hx + 2, hy, heartRed);
      this.rect(hx - 1, hy + 1, 5, 1, heartRed);
      this.dot(hx, hy + 1, heartLight);
      this.rect(hx, hy + 2, 3, 1, heartRed);
      this.dot(hx + 1, hy + 3, heartRed);

      const sy = 6 + (frame % 2);
      this.dot(4, sy, '#FFE066');
      this.dot(3, sy + 1, '#FFF3B0');
      this.dot(5, sy + 1, '#FFE066');
      this.dot(4, sy + 2, '#FFE066');
    } else if (state === 'sleep') {
      const zColor = '#7CC6FE';
      const zLight = '#CBE8FF';
      const offset = frame % 2;
      const zx1 = 23;
      const zy1 = 9 - offset;
      this.rect(zx1, zy1, 3, 1, zColor);
      this.dot(zx1 + 1, zy1 + 1, zLight);
      this.rect(zx1, zy1 + 2, 3, 1, zColor);

      if (frame >= 1) {
        const zx2 = 26;
        const zy2 = 4 - offset;
        this.rect(zx2, zy2, 4, 1, zColor);
        this.dot(zx2 + 2, zy2 + 1, zLight);
        this.dot(zx2 + 1, zy2 + 2, zColor);
        this.rect(zx2, zy2 + 3, 4, 1, zColor);
      }
    } else if (state === 'eat') {
      const fx = 3;
      const fy = 18 + (frame % 2);
      if (frame < 3) {
        this.rect(fx, fy, 3, 3, '#FF4D4D');
        this.dot(fx + 1, fy - 1, '#52B788');
        this.dot(fx, fy, '#FF9999');
      }
      if (frame % 2 === 1) {
        this.dot(8, 17, '#FFD166');
        this.dot(24, 16, '#FFD166');
        this.dot(9, 21, '#F4A261');
      }
    } else if (state === 'sad') {
      const sy = 8 + frame;
      const sx = 26;
      this.dot(sx, sy, '#ADE8F4');
      this.rect(sx - 1, sy + 1, 3, 2, '#48CAE4');
      this.dot(sx, sy + 1, '#CAF0F8');
      this.dot(sx, sy + 3, '#0096C7');
    } else if (state === 'hungry') {
      const by = 3 + (frame % 2);
      const bx = 24;
      this.rect(bx - 1, by, 7, 6, '#FFFBEB');
      this.rect(bx, by - 1, 5, 8, '#FFFBEB');
      this.rect(bx, by + 1, 4, 3, '#D97706');
      this.dot(bx + 1, by + 1, '#FBBF24');
      this.rect(bx + 4, by + 2, 2, 1, '#FFFFFF');
      this.dot(bx + 5, by + 1, '#E2E8F0');
      this.dot(bx + 5, by + 3, '#E2E8F0');
      this.dot(bx - 2, by + 7, '#FDE68A');
    } else if (state === 'need_cuddle') {
      const bounce = frame % 2;
      const hx = 3;
      const hy = 5 - bounce;
      this.dot(hx, hy, '#FF4D8D');
      this.dot(hx + 2, hy, '#FF4D8D');
      this.rect(hx - 1, hy + 1, 5, 1, '#FF4D8D');
      this.rect(hx, hy + 2, 3, 1, '#FF85B3');
      this.dot(hx + 1, hy + 3, '#FF4D8D');

      const bx = 25;
      const by = 5 + bounce;
      this.rect(bx, by, 4, 4, '#38BDF8');
      this.rect(bx + 1, by + 1, 2, 2, '#FDE047');
      this.dot(bx, by, '#BAE6FD');
    }
  }
}

// ============================================================================
// 3. LES 19 ARCHÉTYPES MORPHOLOGIQUES (ŒUF + 3 STARTERS + 3 ENFANTS + 12 ADULTES)
// ============================================================================

const ROW_STATES = [
  'idle',
  'walk',
  'eat',
  'happy',
  'sleep',
  'sad',
  'hungry',
  'need_cuddle',
];

function getMotionOffsets(state, frame) {
  let dx = 0;
  let dy = 0;
  if (state === 'idle') {
    dy = [0, -1, 0, 1][frame];
  } else if (state === 'walk') {
    dx = [-1, 0, 1, 0][frame];
    dy = [0, -1, 0, -1][frame];
  } else if (state === 'eat') {
    dy = [0, -1, 0, -1][frame];
  } else if (state === 'happy') {
    dy = [-1, -3, -2, 0][frame];
  } else if (state === 'sleep') {
    dy = 2;
  } else if (state === 'sad') {
    dx = frame % 2 === 0 ? -1 : 1;
    dy = 1;
  } else if (state === 'hungry') {
    dx = frame % 2 === 0 ? -1 : 0;
    dy = [1, 0, 1, 0][frame];
  } else if (state === 'need_cuddle') {
    dx = [0, -1, 0, 1][frame];
    dy = [0, -2, -1, 0][frame];
  }
  return { dx, dy };
}

function drawWalkingFeet(cell, cx, cy, state, frame, outlineColor, fillColor, spread = 5, baseYOffset = 7) {
  const leftLift = (state === 'walk' || state === 'need_cuddle') && frame % 2 === 0 ? -1 : 0;
  const rightLift = (state === 'walk' || state === 'need_cuddle') && frame % 2 === 1 ? -1 : 0;
  cell.rect(cx - spread, cy + baseYOffset + leftLift, 3, 2, outlineColor);
  cell.rect(cx - spread + 1, cy + baseYOffset + leftLift, 2, 1, fillColor);
  cell.rect(cx + spread - 3, cy + baseYOffset + rightLift, 3, 2, outlineColor);
  cell.rect(cx + spread - 3, cy + baseYOffset + rightLift, 2, 1, fillColor);
}

// ----------------------------------------------------------------------------
// 3.0. STADE 0 : EGG (Archetype `mystic_egg`)
// ----------------------------------------------------------------------------

function drawEgg(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 7, 1.6);

  const outline = '#4A3B2C';
  const base = '#FFF8E7';
  const shade = '#E8D8B8';
  const highlight = '#FFFFFF';

  const rxBase = 7.4;
  const ry = 9.0;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    const ny = (y - cy) / ry;
    const taper = 1 - 0.25 * Math.max(-1, Math.min(1, -ny));
    const rx = rxBase * taper;
    for (let x = Math.floor(cx - rxBase - 1); x <= Math.ceil(cx + rxBase + 1); x++) {
      const nx = (x - cx) / rx;
      const dist = nx * nx + ny * ny;
      if (dist <= 1.06) {
        if (dist >= 0.76) {
          cell.dot(x, y, outline);
        } else if (nx + ny > 0.36) {
          cell.dot(x, y, shade);
        } else if (nx < -0.2 && ny < -0.2 && dist < 0.55) {
          cell.dot(x, y, highlight);
        } else {
          cell.dot(x, y, base);
        }
      }
    }
  }

  const goldSpot = '#F5B73B';
  const floraSpot = '#52B788';
  const aquaSpot = '#38BDF8';
  cell.rect(cx - 4, cy - 2, 2, 2, goldSpot);
  cell.rect(cx + 2, cy + 1, 2, 2, goldSpot);
  cell.dot(cx - 1, cy - 5, floraSpot);
  cell.dot(cx, cy - 5, goldSpot);
  cell.rect(cx - 3, cy + 3, 2, 2, aquaSpot);
  cell.dot(cx + 3, cy - 3, floraSpot);

  const crackLevel = state === 'idle' ? frame : (state === 'happy' || state === 'need_cuddle' ? 2 : 1);
  if (crackLevel >= 1) {
    cell.dot(cx - 1, cy - 4, outline);
    cell.dot(cx, cy - 3, outline);
    cell.dot(cx - 1, cy - 2, outline);
  }
  if (crackLevel >= 2) {
    cell.dot(cx, cy - 1, outline);
    cell.dot(cx + 1, cy - 1, outline);
    cell.dot(cx + 2, cy, outline);
    cell.dot(cx - 2, cy - 1, outline);
    cell.dot(cx - 3, cy, outline);
  }
  if (crackLevel >= 3) {
    cell.dot(cx + 1, cy + 1, outline);
    cell.dot(cx + 2, cy + 2, outline);
    cell.dot(cx - 2, cy + 1, outline);
    cell.dot(cx - 4, cy + 2, outline);
    cell.dot(cx, cy - 2, '#FFF3B0');
    cell.dot(cx + 1, cy, '#FFE066');
    cell.dot(cx - 1, cy, '#FFF3B0');
  }

  cell.drawStateEffects(state, frame);
}

// ----------------------------------------------------------------------------
// 3.1. LES 3 STARTERS (`baby_*`) — 3 SILHOUETTES RADICALEMENT DIFFÉRENTES
// ----------------------------------------------------------------------------

/**
 * 1. baby_aqua (Archetype `droplet_slime`) :
 * Forme de vraie goutte d'eau pointue en haut et plate/évasée en bas (sans jambes),
 * grands yeux ronds liquides et reflets aquatiques.
 */
function drawBabyAqua(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 9.5, 1.8);

  const palette = {
    outline: '#083344',
    base: '#22D3EE',
    shade: '#0891B2',
    highlight: '#CFFAFE',
  };

  // Silhouette de vraie goutte d'eau : sommet très pointu (rx=0.8) qui s'évase en flaque plate en bas (rx=9.5)
  const yTop = state === 'sleep' ? cy - 7 : cy - 11;
  const yBottom = cy + 7;
  const wobble = (frame % 2 === 0 ? 0.4 : -0.3);

  cell.sculptedBody(
    cx,
    yTop,
    yBottom,
    (t) => {
      if (t < 0.15) return 0.9 + t * 10;
      if (t < 0.86) return 2.2 + Math.sin(Math.pow((t - 0.12) / 0.76, 0.75) * (Math.PI * 0.62)) * (8.0 + wobble);
      return 9.6 + wobble; // Base plate et évasée façon slime aquatique (sans jambes)
    },
    palette,
    (t) => (t < 0.22 ? (frame % 2 === 0 ? 0.6 : -0.6) : 0)
  );

  // Ondulations d'écume liquide à la base plate
  cell.dot(cx - 7, yBottom - 1, palette.highlight);
  cell.dot(cx - 2, yBottom - 1, palette.highlight);
  cell.dot(cx + 4, yBottom - 1, palette.highlight);

  // Grand reflet aquatique arqué brillant sur le flanc gauche + petite bulle d'eau flottante
  cell.line(cx - 4, cy - 4, cx - 6, cy + 1, '#FFFFFF');
  cell.dot(cx - 5, cy - 5, '#FFFFFF');
  const bubbleY = cy - 7 - (frame % 2);
  cell.rect(cx + 7, bubbleY, 2, 2, '#A5F3FC');
  cell.dot(cx + 7, bubbleY, '#FFFFFF');

  cell.drawFace(cx, cy + 1, state, frame, {
    eyeStyle: 'liquid',
    cheekColor: '#38BDF8',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy + 1, state, frame, palette, { bellyY: cy + 4, bellyRx: 8 });
  cell.drawStateEffects(state, frame);
}

/**
 * 2. baby_flora (Archetype `bulb_quadruped`) :
 * Corps en forme de petit navet/bulbe trapu avec 4 petites pattes-racines qui marchent en bas,
 * grands yeux curieux et une double feuille sur le côté.
 */
function drawBabyFlora(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.7);

  const palette = {
    outline: '#1A2E05',
    base: '#BEF264',
    shade: '#65A30D',
    highlight: '#F7FEE7',
  };

  // 4 petites pattes-racines qui marchent en bas !
  const rootColor = '#713F12';
  const rootLight = '#A16207';
  const stepA = (state === 'walk' || state === 'happy' || state === 'need_cuddle') && frame % 2 === 0 ? -1 : 0;
  const stepB = (state === 'walk' || state === 'happy' || state === 'need_cuddle') && frame % 2 === 1 ? -1 : 0;
  const footX = [-7, -3, 2, 6];
  const footSteps = [stepA, stepB, stepA, stepB];
  for (let i = 0; i < 4; i++) {
    const fx = cx + footX[i];
    const fy = cy + 6 + footSteps[i];
    cell.rect(fx, fy, 2, 3, palette.outline);
    cell.rect(fx, fy, 2, 2, i % 2 === 0 ? rootLight : rootColor);
  }

  // Corps en forme de petit navet/bulbe trapu (collet étroit en haut, ventre très rebondi en bas)
  cell.sculptedBody(
    cx,
    cy - 7,
    cy + 6,
    (t) => {
      if (t < 0.25) return 3.2 + t * 8;
      if (t < 0.78) return 5.2 + Math.sin(((t - 0.2) / 0.65) * Math.PI) * 3.8;
      return 8.2 * (1 - (t - 0.78) * 1.4);
    },
    palette
  );

  // Stries de bulbe végétal sur le bas du ventre
  cell.dot(cx - 4, cy + 4, palette.shade);
  cell.dot(cx, cy + 4, palette.shade);
  cell.dot(cx + 4, cy + 4, palette.shade);

  // Double feuille asymétrique déployée sur le côté droit/haut du bulbe
  const leafSway = frame % 2 === 0 ? 0 : -1;
  const topY = cy - 8;
  cell.rect(cx, topY - 1, 2, 3, '#14532D');
  // Grande feuille latérale droite
  cell.rect(cx + 2, topY - 2 + leafSway, 6, 3, '#15803D');
  cell.rect(cx + 3, topY - 1 + leafSway, 4, 2, '#4ADE80');
  cell.dot(cx + 7, topY - 2 + leafSway, '#86EFAC');
  // Seconde feuille plus haute inclinée
  cell.rect(cx - 4, topY - 3 - leafSway, 4, 2, '#16A34A');
  cell.dot(cx - 3, topY - 3 - leafSway, '#BBF7D0');

  cell.drawFace(cx, cy, state, frame, {
    eyeStyle: 'curious',
    mouthStyle: 'cat',
    cheekColor: '#FB7185',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette, { bellyY: cy + 3, bellyRx: 8 });
  cell.drawStateEffects(state, frame);
}

/**
 * 3. baby_ember (Archetype `star_spirit`) :
 * Silhouette en étoile à 5 branches / flammèche flottante (sans pieds, lévite au-dessus du sol !),
 * avec des yeux obliques ardents !
 */
function drawBabyEmber(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  // Lévite haut au-dessus du sol !
  const floatOffset = frame % 2 === 0 ? -1 : 0;
  const cy = 15 + dy + floatOffset;

  // Petite ombre éloignée au sol prouvant la lévitation
  cell.groundShadow(16 + dx, 28, 5.5, 1.3);

  const palette = {
    outline: '#450A0A',
    base: '#FB923C',
    shade: '#EA580C',
    highlight: '#FEF08A',
  };

  // Silhouette en étoile à 5 branches / esprit-flamme :
  // Branche 1 : Pointe supérieure en flammèche ardente
  const flicker = frame % 2;
  cell.rect(cx - 1, cy - 11 - flicker, 3, 3, '#EF4444');
  cell.rect(cx, cy - 12 - flicker, 2, 2, '#FACC15');
  cell.rect(cx - 3, cy - 9, 7, 3, palette.outline);
  cell.rect(cx - 2, cy - 8, 5, 3, palette.highlight);

  // Branches 2 & 3 : Bras latéraux pointus d'étoile (gauche et droite)
  const armWave = frame % 2 === 0 ? -1 : 1;
  // Branche gauche
  cell.rect(cx - 11, cy - 2 + armWave, 5, 4, palette.outline);
  cell.rect(cx - 10, cy - 1 + armWave, 4, 2, palette.base);
  cell.dot(cx - 12, cy - 1 + armWave, '#FACC15');
  // Branche droite
  cell.rect(cx + 6, cy - 2 - armWave, 5, 4, palette.outline);
  cell.rect(cx + 6, cy - 1 - armWave, 4, 2, palette.base);
  cell.dot(cx + 11, cy - 1 - armWave, '#FACC15');

  // Branches 4 & 5 : Pointes inférieures d'étoile flottantes (sans pieds au sol)
  cell.rect(cx - 7, cy + 5, 4, 4, palette.outline);
  cell.rect(cx - 6, cy + 5, 3, 3, palette.shade);
  cell.dot(cx - 7, cy + 8, '#EF4444');

  cell.rect(cx + 3, cy + 5, 4, 4, palette.outline);
  cell.rect(cx + 3, cy + 5, 3, 3, palette.shade);
  cell.dot(cx + 6, cy + 8, '#EF4444');

  // Cœur central de l'étoile
  cell.shadedBody(cx, cy, 7.0, 6.2, palette);

  // Petites flammèches/braises qui lévitent sous l'étoile
  cell.dot(cx - 3, cy + 10 + flicker, '#FACC15');
  cell.dot(cx + 2, cy + 11 - flicker, '#EF4444');

  cell.drawFace(cx, cy, state, frame, {
    eyeStyle: 'slanted_fire',
    cheekColor: '#EF4444',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette, { bellyY: cy + 3, bellyRx: 7 });
  cell.drawStateEffects(state, frame);
}

// ----------------------------------------------------------------------------
// 3.2. LES 3 ENFANTS (`child_*`) — 3 SILHOUETTES RADICALEMENT DIFFÉRENTES
// ----------------------------------------------------------------------------

/**
 * 4. child_aqua (Archetype `axolotl_tadpole`) :
 * Corps amphibien large à 3 branchies externes déployées de chaque côté des joues
 * + une grande queue de têtard/sirène qui ondule sur le côté.
 */
function drawChildAqua(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 15 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#0C4A6E',
    base: '#38BDF8',
    shade: '#0284C7',
    highlight: '#E0F2FE',
  };

  // Grande queue de têtard/sirène translucide qui ondule largement sur le côté droit !
  const tailWave = frame % 2 === 0 ? -1 : 1;
  cell.rect(cx + 6, cy + 1 + tailWave, 8, 5, palette.outline);
  cell.rect(cx + 7, cy + 2 + tailWave, 6, 3, '#7DD3FC');
  cell.rect(cx + 11, cy + tailWave, 4, 4, '#67E8F9');
  cell.dot(cx + 13, cy + 1 + tailWave, '#FFFFFF');

  // 3 branchies externes plumeuses déployées de chaque côté des joues (rose corail & cyan)
  const gillFlutter = frame % 2;
  const gillOffsetsY = [-5, -2, 1];
  for (let i = 0; i < 3; i++) {
    const gy = cy + gillOffsetsY[i] + (i === 1 ? 0 : gillFlutter);
    // Branchie gauche
    cell.rect(cx - 12 - (i === 1 ? 1 : 0), gy, 4, 2, '#E11D48');
    cell.rect(cx - 11 - (i === 1 ? 1 : 0), gy, 3, 1, '#FB7185');
    // Branchie droite
    cell.rect(cx + 8 + (i === 1 ? 1 : 0), gy, 4, 2, '#E11D48');
    cell.rect(cx + 8 + (i === 1 ? 1 : 0), gy, 3, 1, '#FB7185');
  }

  // Petites pattes amphibiennes courtes
  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#0284C7', 5, 7);

  // Corps amphibien bas et tête d'axolotl très large
  cell.shadedBody(cx, cy + 3, 6.2, 4.5, palette);
  cell.shadedBody(cx, cy - 1, 8.8, 5.5, palette);

  // Ventre clair d'amphibien
  cell.rect(cx - 3, cy + 4, 7, 2, '#BAE6FD');

  cell.drawFace(cx, cy - 1, state, frame, {
    mouthStyle: 'wide_axolotl',
    cheekColor: '#FDA4AF',
    eyeSpan: 5,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette, { bellyY: cy + 4, bellyRx: 7 });
  cell.drawStateEffects(state, frame);
}

/**
 * 5. child_flora (Archetype `biped_dino`) :
 * Silhouette de petit dinosaure bipède debout, museau dessiné, ventre clair,
 * queue dressée et grande feuille-parasol.
 */
function drawChildFlora(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#064E3B',
    base: '#34D399',
    shade: '#059669',
    highlight: '#A7F3D0',
  };

  // Queue de dinosaure dressée et épaisse à gauche
  const tailWag = frame % 2 === 0 ? 0 : -1;
  cell.rect(cx - 11, cy + 1 + tailWag, 5, 4, palette.outline);
  cell.rect(cx - 10, cy + 2 + tailWag, 4, 2, palette.base);
  cell.rect(cx - 13, cy - 1 + tailWag, 3, 3, palette.outline);
  cell.rect(cx - 12, cy + tailWag, 2, 2, palette.highlight);

  // Pattes arrière robustes de dinosaure bipède
  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#10B981', 5, 7);

  // Corps de dinosaure debout : ventre rebondi en bas + cou + tête à museau en haut
  cell.shadedBody(cx, cy + 2, 6.8, 5.5, palette); // Torse/ventre
  cell.shadedBody(cx + 1, cy - 4, 6.2, 4.6, palette); // Tête avec museau légèrement avancé à droite

  // Ventre clair de petit dino avec stries
  cell.rect(cx - 3, cy + 2, 7, 4, '#ECFCCB');
  cell.line(cx - 2, cy + 3, cx + 2, cy + 3, '#BEF264');
  cell.line(cx - 2, cy + 5, cx + 2, cy + 5, '#BEF264');

  // Petits bras de dino devant le torse
  const armMove = frame % 2;
  cell.rect(cx - 6, cy + 1 + armMove, 2, 2, palette.outline);
  cell.rect(cx + 5, cy + 1 - armMove, 2, 2, palette.outline);

  // Grande feuille-parasol déployée au-dessus de la tête !
  const leafSway = frame % 2 === 0 ? 0 : 1;
  const stemTop = cy - 11;
  cell.rect(cx, stemTop, 2, 4, '#064E3B');
  // Dôme de feuille-parasol large (14 unités)
  cell.rect(cx - 7, stemTop - 2 + leafSway, 15, 3, '#065F46');
  cell.rect(cx - 6, stemTop - 3 + leafSway, 13, 3, '#10B981');
  cell.rect(cx - 4, stemTop - 3 + leafSway, 9, 1, '#A7F3D0');

  cell.drawFace(cx + 1, cy - 4, state, frame, {
    cheekColor: '#FB7185',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy + 1, state, frame, palette, { bellyY: cy + 3, bellyRx: 7 });
  cell.drawStateEffects(state, frame);
}

/**
 * 6. child_ember (Archetype `winged_comet`) :
 * Corps de lynx/comète ailée avec deux ailes de feu latérales bien visibles,
 * des oreilles pointues et une queue de braise.
 */
function drawChildEmber(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#450A0A',
    base: '#F97316',
    shade: '#DC2626',
    highlight: '#FEF08A',
  };

  // Deux grandes ailes de feu latérales bien visibles qui battent !
  const wingFlap = frame % 2 === 0 ? -1 : 1;
  // Aile de feu gauche
  cell.rect(cx - 14, cy - 4 + wingFlap, 7, 6, palette.outline);
  cell.rect(cx - 13, cy - 3 + wingFlap, 6, 4, '#EF4444');
  cell.rect(cx - 12, cy - 2 + wingFlap, 4, 2, '#FACC15');
  cell.dot(cx - 14, cy - 5 + wingFlap, '#FEF08A');
  // Aile de feu droite
  cell.rect(cx + 7, cy - 4 + wingFlap, 7, 6, palette.outline);
  cell.rect(cx + 7, cy - 3 + wingFlap, 6, 4, '#EF4444');
  cell.rect(cx + 8, cy - 2 + wingFlap, 4, 2, '#FACC15');
  cell.dot(cx + 13, cy - 5 + wingFlap, '#FEF08A');

  // Longue queue de braise sur le côté droit
  cell.rect(cx + 6, cy + 3, 5, 3, '#DC2626');
  cell.rect(cx + 10, cy + 1 - (frame % 2), 3, 3, '#FACC15');
  cell.dot(cx + 11, cy + 2 - (frame % 2), '#FFFFFF');

  // Grandes oreilles pointues de lynx ardent
  const earY = cy - 11;
  cell.rect(cx - 6, earY, 3, 5, palette.outline);
  cell.rect(cx - 5, earY + 1, 2, 3, '#FACC15');
  cell.dot(cx - 6, earY - 1, '#EF4444');

  cell.rect(cx + 3, earY, 3, 5, palette.outline);
  cell.rect(cx + 3, earY + 1, 2, 3, '#FACC15');
  cell.dot(cx + 5, earY - 1, '#EF4444');

  // Pattes félines agiles
  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#DC2626', 5, 7);

  // Corps svelte de lynx/comète
  cell.shadedBody(cx, cy, 7.2, 6.8, palette);

  // Touffe de fourrure stellaire sur le poitrail
  cell.rect(cx - 2, cy + 3, 5, 2, '#FEF08A');

  cell.drawFace(cx, cy - 1, state, frame, {
    eyeStyle: 'fierce',
    mouthStyle: 'cat',
    cheekColor: '#FACC15',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette, { bellyY: cy + 3, bellyRx: 7 });
  cell.drawStateEffects(state, frame);
}

// ----------------------------------------------------------------------------
// 3.3. LES 12 ADULTES (`adult_*`) — 12 MORPHOLOGIES UNIQUES FAÇON TAMAGOTCHI
// ----------------------------------------------------------------------------

/**
 * 7. adult_aqua_coral (Archetype `sea_angel`) :
 * Silhouette haute, fine et élancée d'ange des mers / sirène avec deux grandes
 * nageoires-voiles diaphanes sur les côtés et une couronne de corail.
 */
function drawAdultAquaCoral(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 16 + dy;

  cell.groundShadow(16 + dx, 28, 7.5, 1.6);

  const palette = {
    outline: '#115E59',
    base: '#2DD4BF',
    shade: '#0D9488',
    highlight: '#CCFBF1',
  };

  // Deux grandes nageoires-voiles diaphanes déployées sur les côtés (Ange des mers)
  const wingGlide = frame % 2 === 0 ? -1 : 1;
  // Voile gauche
  cell.rect(cx - 14, cy - 2 + wingGlide, 9, 8, '#FF6B8B');
  cell.rect(cx - 13, cy - 1 + wingGlide, 7, 6, '#FFC2D1');
  cell.rect(cx - 11, cy + wingGlide, 5, 4, '#99F6E4');
  // Voile droit
  cell.rect(cx + 5, cy - 2 + wingGlide, 9, 8, '#FF6B8B');
  cell.rect(cx + 6, cy - 1 + wingGlide, 7, 6, '#FFC2D1');
  cell.rect(cx + 6, cy + wingGlide, 5, 4, '#99F6E4');

  // Silhouette haute, fine et élancée d'ange des mers / sirène (tête ronde, taille fine, queue évasée en bas)
  cell.sculptedBody(
    cx,
    cy - 6,
    cy + 11,
    (t) => {
      if (t < 0.35) return 5.8 - t * 2.5; // Tête gracieuse
      if (t < 0.60) return 3.6;           // Taille très fine et élancée
      if (t < 0.88) return 3.6 + (t - 0.60) * 9.0; // Robe-nageoire de sirène
      return 6.8;                         // Nageoire caudale bifide
    },
    palette
  );

  // Collier de perles nacrées sur le buste
  cell.dot(cx - 2, cy + 1, '#FFF1F2');
  cell.dot(cx, cy + 2, '#FFE4E6');
  cell.dot(cx + 2, cy + 1, '#FFF1F2');

  // Grande couronne de corail rose lumineux ramifiée au sommet
  const crownY = cy - 9;
  cell.rect(cx - 4, crownY + 2, 9, 2, '#E11D48');
  cell.rect(cx - 6, crownY - 1, 2, 4, '#FF6B8B');
  cell.rect(cx - 1, crownY - 2, 3, 4, '#FF6B8B');
  cell.dot(cx, crownY - 1, '#FFF1F2');
  cell.rect(cx + 4, crownY - 1, 2, 4, '#FF6B8B');

  cell.drawFace(cx, cy - 3, state, frame, {
    eyeStyle: 'serene',
    cheekColor: '#FB7185',
    eyeSpan: 3,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette, { bellyY: cy + 3, bellyRx: 5, armY: cy - 1, armSpan: 6 });
  cell.drawStateEffects(state, frame);
}

/**
 * 8. adult_aqua_leviathan (Archetype `serpent_dragon` façon Nyorotchi) :
 * Long corps sinueux en S vertical, tête de dragon marin en haut,
 * ventre strié et crête dorsale !
 */
function drawAdultAquaLeviathan(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 16 + dy;

  cell.groundShadow(16 + dx, 28, 9.5, 1.8);

  const palette = {
    outline: '#172554',
    base: '#2563EB',
    shade: '#1D4ED8',
    highlight: '#93C5FD',
  };

  // Corps sinueux en S vertical façon Nyorotchi / Léviathan !
  const phase = frame * 0.8;
  const yTop = cy - 7;
  const yBottom = cy + 11;

  for (let y = yTop; y <= yBottom; y++) {
    const t = (y - yTop) / (yBottom - yTop); // 0 en haut (cou), 1 en bas (queue)
    const curveX = cx + Math.sin(t * Math.PI * 2.1 + (frame % 2) * 0.35) * 4.5;
    const rx = t < 0.25 ? 4.8 : (t > 0.85 ? 2.5 : 3.8);

    // Épine de crête dorsale cyan/or le long du dos du S
    if (y % 2 === 0 && t > 0.15) {
      const spineSide = Math.cos(t * Math.PI * 2.1) >= 0 ? -1 : 1;
      cell.rect(Math.round(curveX + spineSide * (rx + 1)), y, 2, 2, '#00F5D4');
    }

    for (let x = Math.floor(curveX - rx - 1); x <= Math.ceil(curveX + rx + 1); x++) {
      const nx = (x - curveX) / rx;
      const absNx = Math.abs(nx);
      if (absNx <= 1.05) {
        if (absNx >= 0.76 || y === yBottom) {
          cell.dot(x, y, palette.outline);
        } else if (Math.abs(nx) < 0.38 && t > 0.2) {
          // Ventre strié jaune/crème de dragon marin !
          cell.dot(x, y, y % 2 === 0 ? '#FEF08A' : '#38BDF8');
        } else if (nx > 0.25) {
          cell.dot(x, y, palette.shade);
        } else {
          cell.dot(x, y, palette.base);
        }
      }
    }
  }

  // Tête de dragon marin en haut du S
  const headX = cx;
  const headY = cy - 6;
  cell.shadedBody(headX, headY, 6.2, 4.6, palette);

  // Cornes / nageoires crâniennes hydrodynamiques cyan & or
  cell.rect(headX - 8, headY - 3, 3, 3, '#00F5D4');
  cell.dot(headX - 9, headY - 4, '#FACC15');
  cell.rect(headX + 5, headY - 3, 3, 3, '#00F5D4');
  cell.dot(headX + 8, headY - 4, '#FACC15');
  // Crête frontale
  cell.rect(headX - 1, headY - 7, 3, 3, '#00F5D4');
  cell.dot(headX, headY - 8, '#FACC15');

  cell.drawFace(headX, headY, state, frame, {
    eyeStyle: 'fierce',
    cheekColor: '#00F5D4',
    eyeSpan: 3,
  });
  cell.drawNeedPoseOverlay(cx, cy + 1, state, frame, palette, { bellyY: cy + 2, bellyRx: 6, armY: headY + 3, armSpan: 6 });
  cell.drawStateEffects(state, frame);
}

/**
 * 9. adult_aqua_pearl (Archetype `octopus` façon Takotchi) :
 * Tête en dôme nacré avec 6 tentacules recourbés et animés en bas
 * et une grosse perle brillante sur le front !
 */
function drawAdultAquaPearl(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 14 + dy;

  cell.groundShadow(16 + dx, 28, 10.5, 1.9);

  const palette = {
    outline: '#334155',
    base: '#E0F2FE',
    shade: '#7DD3FC',
    highlight: '#FFFFFF',
  };

  // 6 tentacules recourbés et animés en bas (façon Takotchi) !
  const tentacleBasesX = [-10, -6, -2, 2, 6, 10];
  for (let i = 0; i < 6; i++) {
    const tx = cx + tentacleBasesX[i];
    const wave = ((frame + i) % 2 === 0) ? -1 : 1;
    const curlOut = i < 3 ? -1 : 1;
    // Tige du tentacule
    cell.rect(tx - 1, cy + 6, 3, 6 + wave, palette.outline);
    cell.rect(tx, cy + 6, 2, 5 + wave, i % 2 === 0 ? '#F472B6' : '#7DD3FC');
    // Extrémité recourbée avec ventouse nacrée
    cell.rect(tx + curlOut, cy + 11 + wave, 2, 2, palette.outline);
    cell.dot(tx + curlOut, cy + 11 + wave, '#FFF1F2');
  }

  // Grande tête en dôme de poulpe nacré
  cell.shadedBody(cx, cy, 9.0, 7.2, palette, 1);

  // Grosse perle brillante sertie d'or sur le front !
  const pearlY = cy - 6;
  cell.rect(cx - 3, pearlY - 1, 7, 5, '#F59E0B'); // Coquille/sertissage doré
  cell.rect(cx - 2, pearlY - 2, 5, 5, '#FB7185'); // Perle rose nacrée géante
  cell.rect(cx - 1, pearlY - 1, 3, 3, '#FFF1F2');
  cell.dot(cx - 1, pearlY - 1, '#FFFFFF');

  cell.drawFace(cx, cy + 1, state, frame, {
    mouthStyle: 'octo_tube',
    cheekColor: '#F472B6',
    eyeSpan: 5,
  });
  cell.drawNeedPoseOverlay(cx, cy + 2, state, frame, palette, { bellyY: cy + 5, bellyRx: 8 });
  cell.drawStateEffects(state, frame);
}

/**
 * 10. adult_aqua_abyss (Archetype `anglerfish`) :
 * Silhouette large et trapue de baudroie des abysses avec une grande bouche
 * à petites dents blanches rigolotes et une longue antenne-lanterne lumineuse qui pend devant !
 */
function drawAdultAquaAbyss(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 10.5, 1.9);

  const palette = {
    outline: '#020617',
    base: '#1E1B4B',
    shade: '#0F172A',
    highlight: '#312E81',
  };

  // Nageoires pectorales épineuses et bioluminescentes sur les côtés
  const finBeat = frame % 2;
  cell.rect(cx - 14, cy - 2 + finBeat, 4, 5, palette.outline);
  cell.rect(cx - 13, cy - 1 + finBeat, 3, 3, '#00F5D4');
  cell.rect(cx + 10, cy - 2 + finBeat, 4, 5, palette.outline);
  cell.rect(cx + 10, cy - 1 + finBeat, 3, 3, '#00F5D4');

  // Silhouette très large et trapue de baudroie des abysses
  cell.shadedBody(cx, cy, 10.4, 7.2, palette, 1);

  // Longue antenne-lanterne arquée partant du haut et pendant devant !
  const glowShift = frame % 2;
  cell.line(cx, cy - 7, cx + 3, cy - 12, '#312E81');
  cell.line(cx + 3, cy - 12, cx + 9, cy - 10, '#312E81');
  cell.line(cx + 9, cy - 10, cx + 10, cy - 6 + glowShift, '#00F5D4');
  // Orbe de la lanterne bioluminescente qui pend
  const lx = cx + 9;
  const ly = cy - 6 + glowShift;
  cell.rect(lx - 1, ly, 4, 4, '#00F5D4');
  cell.rect(lx, ly + 1, 2, 2, '#FEF08A');
  cell.dot(lx, ly + 1, '#FFFFFF');

  cell.drawFace(cx, cy - 1, state, frame, {
    eyeColor: '#00F5D4',
    eyeShine: '#FFFFFF',
    cheekColor: null,
    mouthStyle: 'angler_teeth',
    eyeSpan: 5,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette, { bellyY: cy + 4, bellyRx: 9 });
  cell.drawStateEffects(state, frame);
}

/**
 * 11. adult_flora_bloom (Archetype `mametchi_ears` façon Mametchi/Mimitchi) :
 * Personnage bipède bien proportionné avec deux grandes oreilles dressées,
 * des bras et des jambes distincts, un torse bicolore et une grande fleur épanouie.
 */
function drawAdultFloraBloom(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 17 + dy;

  cell.groundShadow(16 + dx, 28, 8, 1.7);

  const headPalette = {
    outline: '#14532D',
    base: '#ECFCCB',
    shade: '#BEF264',
    highlight: '#FFFFFF',
  };
  const torsoPalette = {
    outline: '#14532D',
    base: '#65A30D',
    shade: '#3F6212',
    highlight: '#A3E635',
  };

  // Deux grandes oreilles dressées façon Mametchi / Mimitchi !
  const earWiggle = frame % 2 === 0 ? 0 : -1;
  cell.rect(cx - 6, cy - 13 + earWiggle, 4, 8, headPalette.outline);
  cell.rect(cx - 5, cy - 12 + earWiggle, 2, 6, headPalette.base);
  cell.dot(cx - 5, cy - 11 + earWiggle, '#FB7185');

  cell.rect(cx + 2, cy - 13 - earWiggle, 4, 8, headPalette.outline);
  cell.rect(cx + 3, cy - 12 - earWiggle, 2, 6, headPalette.base);
  cell.dot(cx + 4, cy - 11 - earWiggle, '#FB7185');

  // Jambes distinctes de personnage bipède
  drawWalkingFeet(cell, cx, cy + 2, state, frame, torsoPalette.outline, '#4D7C0F', 5, 7);

  // Bras distincts articulés de chaque côté du torse
  const armSwing = (state === 'walk' || state === 'happy') ? (frame % 2 === 0 ? -1 : 1) : 0;
  cell.rect(cx - 9, cy + 1 + armSwing, 3, 5, headPalette.outline);
  cell.rect(cx - 8, cy + 2 + armSwing, 2, 3, headPalette.base);
  cell.rect(cx + 6, cy + 1 - armSwing, 3, 5, headPalette.outline);
  cell.rect(cx + 6, cy + 2 - armSwing, 2, 3, headPalette.base);

  // Torse bicolore (salopette/tunique verte + plastron floral crème)
  cell.shadedBody(cx, cy + 4, 6.0, 4.8, torsoPalette);
  cell.rect(cx - 3, cy + 2, 7, 4, '#FEF9C3');
  cell.dot(cx, cy + 4, '#F43F5E');

  // Tête ronde distincte au-dessus du torse
  cell.shadedBody(cx, cy - 3, 6.8, 5.2, headPalette);

  // Grande fleur solaire épanouie entre les deux grandes oreilles
  const fy = cy - 9;
  cell.rect(cx - 3, fy, 7, 3, '#F43F5E');
  cell.rect(cx - 2, fy - 1, 5, 5, '#FB7185');
  cell.rect(cx - 1, fy, 3, 3, '#FACC15');
  cell.dot(cx, fy + 1, '#FEF08A');

  cell.drawFace(cx, cy - 3, state, frame, {
    cheekColor: '#FB7185',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy + 1, state, frame, headPalette, { bellyY: cy + 4, bellyRx: 6, armY: cy - 1, armSpan: 7 });
  cell.drawStateEffects(state, frame);
}

/**
 * 12. adult_flora_raptor (Archetype `raptor_bird`) :
 * Silhouette d'oiseau-raptor coureur à longues pattes, bec crochu jaune,
 * crête de plumes et ailes-feuilles.
 */
function drawAdultFloraRaptor(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 16 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.7);

  const palette = {
    outline: '#052E16',
    base: '#22C55E',
    shade: '#15803D',
    highlight: '#86EFAC',
  };

  // Longues pattes musclées d'oiseau-raptor coureur avec serres !
  const strideL = (state === 'walk' || state === 'happy' || state === 'need_cuddle') && frame % 2 === 0 ? -2 : 0;
  const strideR = (state === 'walk' || state === 'happy' || state === 'need_cuddle') && frame % 2 === 1 ? -2 : 0;
  // Patte gauche
  cell.rect(cx - 4, cy + 5, 2, 6 + strideL, '#EA580C');
  cell.rect(cx - 5, cy + 10 + strideL, 4, 2, '#FACC15');
  // Patte droite
  cell.rect(cx + 2, cy + 5, 2, 6 + strideR, '#EA580C');
  cell.rect(cx + 1, cy + 10 + strideR, 4, 2, '#FACC15');

  // Longue queue de vélociraptor à plumes-feuilles à gauche
  const tailSway = frame % 2 === 0 ? 0 : -1;
  cell.rect(cx - 13, cy + 1 + tailSway, 7, 3, '#15803D');
  cell.rect(cx - 14, cy + tailSway, 4, 2, '#F97316');
  cell.dot(cx - 14, cy + tailSway, '#FACC15');

  // Corps profilé d'oiseau-raptor + cou élancé + tête
  cell.shadedBody(cx - 1, cy + 2, 6.8, 4.5, palette);
  cell.shadedBody(cx + 1, cy - 4, 5.8, 4.5, palette);

  // Ailes-feuilles tranchantes sur les flancs
  const wingFlap = frame % 2;
  cell.rect(cx - 8, cy - 1 + wingFlap, 4, 5, '#166534');
  cell.rect(cx - 7, cy + wingFlap, 3, 3, '#4ADE80');
  cell.rect(cx + 5, cy - 1 + wingFlap, 4, 5, '#166534');
  cell.rect(cx + 5, cy + wingFlap, 3, 3, '#4ADE80');

  // Crête de plumes orange et or dressée sur la tête
  const crestY = cy - 11;
  cell.rect(cx - 3, crestY + 1, 2, 4, '#EA580C');
  cell.rect(cx, crestY, 2, 4, '#F97316');
  cell.rect(cx + 3, crestY + 1, 2, 4, '#FACC15');

  cell.drawFace(cx + 1, cy - 4, state, frame, {
    eyeStyle: 'fierce',
    mouthStyle: 'beak',
    cheekColor: '#FB923C',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy + 1, state, frame, palette, { bellyY: cy + 3, bellyRx: 6 });
  cell.drawStateEffects(state, frame);
}

/**
 * 13. adult_flora_truffle (Archetype `kuchipatchi_mushroom` façon Kuchipatchi) :
 * Silhouette très dodue en poire avec un gros bec/lèvres épaisses façon Kuchipatchi
 * et un immense chapeau de champignon tacheté qui dépasse largement de la tête !
 */
function drawAdultFloraTruffle(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 10.5, 1.9);

  const palette = {
    outline: '#432818',
    base: '#E6CCB2',
    shade: '#B08968',
    highlight: '#FAF0E6',
  };

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#65A30D', 6, 8);

  // Silhouette très dodue en poire façon Kuchipatchi (épaules étroites, gros bidon rebondi en bas)
  cell.sculptedBody(
    cx,
    cy - 5,
    cy + 8,
    (t) => 5.8 + Math.pow(t, 0.9) * 4.4, // S'élargit jusqu'à rx = 10.2 en bas !
    palette
  );

  // Petits bras ronds sur les côtés du ventre en poire
  cell.rect(cx - 10, cy + 2, 2, 3, palette.outline);
  cell.rect(cx + 9, cy + 2, 2, 3, palette.outline);

  // IMMENSE chapeau de champignon rouge tacheté qui dépasse largement de la tête (largeur 24 unités = 48 px !)
  const capY = cy - 11;
  cell.rect(cx - 12, capY + 4, 25, 3, palette.outline);
  cell.rect(cx - 11, capY + 2, 23, 4, '#DC2626');
  cell.rect(cx - 9, capY, 19, 3, '#EF4444');
  cell.rect(cx - 6, capY - 2, 13, 2, '#EF4444');
  // Rebord inférieur crème à lamelles sous le chapeau
  cell.rect(cx - 10, capY + 6, 21, 1, '#FEF3C7');
  // Gros pois crème sur le dôme du champignon
  cell.rect(cx - 8, capY + 2, 3, 3, '#FFFBEB');
  cell.rect(cx - 1, capY - 1, 3, 3, '#FFFBEB');
  cell.rect(cx + 5, capY + 2, 3, 3, '#FFFBEB');

  // Visage avec gros bec / lèvres épaisses façon Kuchipatchi !
  cell.drawFace(cx, cy - 1, state, frame, {
    mouthStyle: 'kuchipatchi_lips',
    cheekColor: '#F43F5E',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy + 2, state, frame, palette, { bellyY: cy + 5, bellyRx: 9 });
  cell.drawStateEffects(state, frame);
}

/**
 * 14. adult_flora_thorn (Archetype `carnivorous_vine` façon Kusatchi) :
 * Tige serpentine sortant d'un pot/racines en bas, grande tête à collerette dentelée
 * et cornes de ronces.
 */
function drawAdultFloraThorn(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 15 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const headPalette = {
    outline: '#1E1B4B',
    base: '#581C87',
    shade: '#3B0764',
    highlight: '#A855F7',
  };

  // Base de racines noueuses / pot d'écorce sombre en bas (y = 22..27)
  const baseY = 23;
  cell.rect(cx - 6, baseY, 13, 4, '#27170E');
  cell.rect(cx - 5, baseY + 1, 11, 2, '#4A3525');
  cell.rect(cx - 7, baseY + 3, 3, 2, '#14532D');
  cell.rect(cx + 5, baseY + 3, 3, 2, '#14532D');

  // Tige serpentine épineuse qui ondule entre les racines et la tête (façon Kusatchi) !
  const sway = frame % 2 === 0 ? -1 : 1;
  for (let y = cy + 4; y <= baseY; y++) {
    const sx = cx + Math.round(Math.sin((y - cy) * 0.6 + frame) * 2.2);
    cell.rect(sx - 1, y, 3, 1, '#14532D');
    cell.dot(sx, y, '#22C55E');
    if (y % 2 === 0) {
      // Épines sur la tige
      cell.dot(sx - 2, y, '#A855F7');
      cell.dot(sx + 2, y, '#A855F7');
    }
  }
  // Deux feuilles-lianes basses
  cell.rect(cx - 8, baseY - 2 + sway, 5, 2, '#15803D');
  cell.rect(cx + 4, baseY - 2 - sway, 5, 2, '#15803D');

  // Collerette dentelée verte et pourpre autour de la tête !
  const headY = cy - 2;
  for (let angle = 0; angle < 8; angle++) {
    const rad = (angle / 8) * Math.PI * 2;
    const px = Math.round(cx + Math.cos(rad) * 8);
    const py = Math.round(headY + Math.sin(rad) * 6);
    cell.rect(px - 1, py - 1, 3, 3, angle % 2 === 0 ? '#16A34A' : '#9333EA');
  }

  // Cornes de ronces au sommet
  cell.rect(cx - 6, headY - 8, 2, 4, '#3B0764');
  cell.dot(cx - 7, headY - 9, '#C084FC');
  cell.rect(cx + 4, headY - 8, 2, 4, '#3B0764');
  cell.dot(cx + 6, headY - 9, '#C084FC');

  // Grande tête de plante carnivore
  cell.shadedBody(cx, headY, 7.2, 5.5, headPalette);

  cell.drawFace(cx, headY - 1, state, frame, {
    eyeColor: '#FACC15',
    eyeShine: '#FFFFFF',
    cheekColor: null,
    mouthStyle: 'stitched_vine',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy + 2, state, frame, headPalette, { bellyY: cy + 5, bellyRx: 5, armY: headY + 1, armSpan: 8 });
  cell.drawStateEffects(state, frame);
}

/**
 * 15. adult_ember_solar (Archetype `phoenix`) :
 * Silhouette majestueuse de Phénix aux grandes ailes dorées déployées sur toute
 * la largeur (60 px = 30 unités logiques), serres d'oiseau et couronne solaire.
 */
function drawAdultEmberSolar(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16;
  const cy = 17 + dy;

  cell.groundShadow(16 + dx, 28, 10, 1.8);

  const palette = {
    outline: '#7C2D12',
    base: '#FACC15',
    shade: '#EA580C',
    highlight: '#FEF9C3',
  };

  // GRANDES AILES DORÉES DÉPLOYÉES SUR TOUTE LA LARGEUR (x = 1..30 soit 60 px !)
  const wingFlap = frame % 2 === 0 ? -1 : 1;
  for (let span = 5; span <= 14; span++) {
    const featherLen = 8 - Math.floor((span - 5) * 0.45);
    const wy = cy - 4 + wingFlap * Math.floor((span - 4) * 0.35);
    const lx = cx - span - 1;
    const rx = cx + span;

    // Rémiges dorées, cœur orange ardent et pointes blanches/rouges
    cell.rect(lx, wy, 1, featherLen, '#EA580C');
    cell.rect(lx, wy, 1, 2, '#FEF08A');
    cell.dot(lx, wy + featherLen - 1, '#DC2626');

    cell.rect(rx, wy, 1, featherLen, '#EA580C');
    cell.rect(rx, wy, 1, 2, '#FEF08A');
    cell.dot(rx, wy + featherLen - 1, '#DC2626');
  }

  // Panache caudal de Phénix (3 longues plumes de feu en bas)
  cell.rect(cx - 3, cy + 6, 2, 4, '#DC2626');
  cell.rect(cx, cy + 6, 2, 5, '#FACC15');
  cell.rect(cx + 2, cy + 6, 2, 4, '#DC2626');

  // Serres d'oiseau dorées
  const talonLift = (state === 'walk' || state === 'happy') && frame % 2 === 0 ? -1 : 0;
  cell.rect(cx - 4, cy + 6 + talonLift, 2, 3, '#7C2D12');
  cell.rect(cx + 2, cy + 6 - talonLift, 2, 3, '#7C2D12');

  // Corps et tête royale du Phénix
  cell.shadedBody(cx, cy + 1, 5.8, 5.2, palette);
  cell.shadedBody(cx, cy - 4, 5.2, 4.2, palette);

  // Couronne solaire flamboyante à 5 rayons au sommet
  const crownY = cy - 10;
  cell.rect(cx - 4, crownY + 1, 9, 2, '#EA580C');
  cell.dot(cx - 4, crownY, '#FACC15');
  cell.dot(cx - 2, crownY - 1, '#FEF08A');
  cell.rect(cx, crownY - 2, 1, 2, '#FFFFFF');
  cell.dot(cx + 2, crownY - 1, '#FEF08A');
  cell.dot(cx + 4, crownY, '#FACC15');

  cell.drawFace(cx, cy - 4, state, frame, {
    eyeStyle: 'fierce',
    mouthStyle: 'beak',
    cheekColor: '#EF4444',
    eyeSpan: 3,
  });
  cell.drawNeedPoseOverlay(cx, cy + 1, state, frame, palette, { bellyY: cy + 3, bellyRx: 6 });
  cell.drawStateEffects(state, frame);
}

/**
 * 16. adult_ember_comet (Archetype `mecha_star` façon Robot/Masktchi) :
 * Silhouette angulaire et robotique avec casque à visière néon cyan
 * (au lieu d'yeux classiques), épaulières et propulseurs !
 */
function drawAdultEmberComet(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 17 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#0F172A',
    base: '#3B82F6',
    shade: '#1D4ED8',
    highlight: '#93C5FD',
  };

  // Propulseurs dorsaux / latéraux avec flammes de plasma cyan et or !
  const jetFlicker = frame % 2;
  // Propulseur gauche
  cell.rect(cx - 12, cy - 1, 3, 5, '#1E293B');
  cell.rect(cx - 12, cy + 4, 3, 2 + jetFlicker, '#F97316');
  cell.dot(cx - 11, cy + 4, '#00F5D4');
  // Propulseur droit
  cell.rect(cx + 9, cy - 1, 3, 5, '#1E293B');
  cell.rect(cx + 9, cy + 4, 3, 2 + jetFlicker, '#F97316');
  cell.dot(cx + 10, cy + 4, '#00F5D4');

  // Épaulières angulaires dorées et cobalt (Mecha Pauldrons)
  cell.rect(cx - 11, cy - 3, 5, 3, palette.outline);
  cell.rect(cx - 10, cy - 2, 4, 2, '#FACC15');
  cell.rect(cx + 6, cy - 3, 5, 3, palette.outline);
  cell.rect(cx + 6, cy - 2, 4, 2, '#FACC15');

  // Bottes robotiques à réacteurs
  drawWalkingFeet(cell, cx, cy + 1, state, frame, palette.outline, '#00F5D4', 5, 7);

  // Torse blindé angulaire avec réacteur stellaire au centre
  cell.rect(cx - 6, cy - 1, 13, 8, palette.outline);
  cell.rect(cx - 5, cy, 11, 6, palette.shade);
  cell.rect(cx - 2, cy + 1, 5, 4, '#FACC15');
  cell.rect(cx - 1, cy + 2, 3, 2, '#00F5D4');

  // Casque robotique angulaire (façon Masktchi / Mecha) avec antennes en V
  const helmY = cy - 9;
  cell.rect(cx - 7, helmY, 15, 9, palette.outline);
  cell.rect(cx - 6, helmY + 1, 13, 7, palette.base);
  cell.rect(cx - 5, helmY + 1, 11, 1, palette.highlight);
  // Crête V-fin dorée de Mecha sur le front
  cell.rect(cx - 1, helmY - 2, 3, 3, '#FACC15');
  cell.line(cx - 1, helmY - 1, cx - 5, helmY - 3, '#FACC15');
  cell.line(cx + 1, helmY - 1, cx + 5, helmY - 3, '#FACC15');

  // Visière néon cyan futuriste (au lieu d'yeux classiques)
  cell.drawFace(cx, helmY + 4, state, frame, {
    eyeStyle: 'visor_cyan',
  });
  cell.drawNeedPoseOverlay(cx, cy + 1, state, frame, palette, { bellyY: cy + 3, bellyRx: 7 });
  cell.drawStateEffects(state, frame);
}

/**
 * 17. adult_ember_magma (Archetype `lava_golem`) :
 * Silhouette trapézoïdale massive de Golem de roche et lave, gros bras musclés
 * sur les côtés, fissures incandescentes sur le torse et cratère fumant sur la tête !
 */
function drawAdultEmberMagma(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 11, 2.0);

  const rockPalette = {
    outline: '#1C1917',
    base: '#44403C',
    shade: '#292524',
    highlight: '#78716C',
  };

  // Gros bras musclés de roche et lave sur les côtés (x = cx-13..cx+13) !
  const armPump = frame % 2 === 0 ? 0 : -1;
  // Bras massif gauche
  cell.rect(cx - 14, cy - 3 + armPump, 5, 9, rockPalette.outline);
  cell.rect(cx - 13, cy - 2 + armPump, 3, 7, rockPalette.base);
  cell.rect(cx - 13, cy + 2 + armPump, 3, 2, '#F97316'); // Poing de magma
  // Bras massif droit
  cell.rect(cx + 9, cy - 3 - armPump, 5, 9, rockPalette.outline);
  cell.rect(cx + 10, cy - 2 - armPump, 3, 7, rockPalette.base);
  cell.rect(cx + 10, cy + 2 - armPump, 3, 2, '#F97316');

  // Piliers de jambes rocheuses
  drawWalkingFeet(cell, cx, cy, state, frame, rockPalette.outline, '#EA580C', 6, 7);

  // Silhouette trapézoïdale massive (épaules très larges rx=9.5 en haut, taille rx=6.5 en bas)
  cell.sculptedBody(
    cx,
    cy - 7,
    cy + 6,
    (t) => (t < 0.2 ? 6.5 + t * 15 : 9.5 - (t - 0.2) * 3.5),
    rockPalette
  );

  // Fissures incandescentes de lave jaune/orange sur le torse rocheux !
  const lavaBright = frame % 2 === 0 ? '#FEF08A' : '#F97316';
  cell.line(cx - 5, cy + 1, cx - 1, cy + 3, '#EA580C');
  cell.line(cx - 1, cy + 3, cx + 4, cy + 1, '#EA580C');
  cell.dot(cx - 2, cy + 2, lavaBright);
  cell.dot(cx, cy + 3, lavaBright);
  cell.dot(cx + 2, cy + 2, lavaBright);
  cell.line(cx, cy + 3, cx, cy + 5, lavaBright);

  // Cratère volcanique fumant au sommet de la tête !
  const cratY = cy - 10;
  cell.rect(cx - 4, cratY + 1, 9, 3, rockPalette.outline);
  cell.rect(cx - 3, cratY + 1, 7, 2, rockPalette.base);
  cell.rect(cx - 2, cratY, 5, 2, '#EF4444'); // Lave en fusion dans le cratère
  cell.dot(cx, cratY - (frame % 2), '#FEF08A'); // Bulle de lave qui jaillit
  cell.rect(cx + 2, cratY - 2 - (frame % 2), 2, 2, '#A8A29E'); // Panache de fumée

  cell.drawFace(cx, cy - 3, state, frame, {
    eyeColor: '#FACC15',
    eyeShine: '#FFFFFF',
    cheekColor: '#EF4444',
    mouthStyle: 'golem_jaw',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, rockPalette, { bellyY: cy + 3, bellyRx: 8 });
  cell.drawStateEffects(state, frame);
}

/**
 * 18. adult_ember_eclipse (Archetype `phantom_bat` façon Devilgotchi) :
 * Silhouette de fantôme/chauve-souris cosmique à cape déchiquetée flottante (sans jambes),
 * grandes ailes de chauve-souris, cornes en croissant de lune et halo d'éclipse !
 */
function drawAdultEmberEclipse(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const floatY = frame % 2 === 0 ? -1 : 0;
  const cy = 16 + dy + floatY;

  cell.groundShadow(16 + dx, 28, 7.5, 1.5);

  const palette = {
    outline: '#0F0720',
    base: '#3B0764',
    shade: '#1E1B4B',
    highlight: '#7E22CE',
  };

  // Grandes ailes de chauve-souris festonnées sur les côtés (façon Devilgotchi) !
  const batFlap = frame % 2 === 0 ? -1 : 1;
  // Aile de chauve-souris gauche
  cell.rect(cx - 14, cy - 4 + batFlap, 8, 6, palette.outline);
  cell.rect(cx - 13, cy - 3 + batFlap, 6, 4, '#6B21A8');
  cell.dot(cx - 13, cy + 2 + batFlap, palette.outline);
  cell.dot(cx - 10, cy + 2 + batFlap, palette.outline);
  // Aile de chauve-souris droite
  cell.rect(cx + 6, cy - 4 + batFlap, 8, 6, palette.outline);
  cell.rect(cx + 7, cy - 3 + batFlap, 6, 4, '#6B21A8');
  cell.dot(cx + 9, cy + 2 + batFlap, palette.outline);
  cell.dot(cx + 12, cy + 2 + batFlap, palette.outline);

  // Halo d'éclipse solaire flottant au-dessus de la tête (disque noir cerclé d'or)
  const haloY = cy - 12;
  cell.rect(cx - 3, haloY, 7, 3, '#F59E0B');
  cell.rect(cx - 2, haloY + 1, 5, 1, '#090D16');

  // Cornes en croissant de lune dorées !
  const hornY = cy - 9;
  cell.rect(cx - 7, hornY, 2, 4, '#FACC15');
  cell.dot(cx - 8, hornY - 1, '#FEF08A');
  cell.rect(cx + 5, hornY, 2, 4, '#FACC15');
  cell.dot(cx + 7, hornY - 1, '#FEF08A');

  // Corps de fantôme cosmique en cape qui s'évase (sans jambes)
  cell.sculptedBody(
    cx,
    cy - 6,
    cy + 7,
    (t) => 5.5 + t * 3.0,
    palette
  );

  // Pan de cape déchiqueté flottant en bas (5 pointes spectrales animées, sans pieds)
  for (let i = -7; i <= 7; i += 3) {
    const wisp = (frame + Math.abs(i)) % 2;
    cell.rect(cx + i, cy + 7, 2, 2 + wisp, palette.outline);
    cell.dot(cx + i, cy + 7, '#581C87');
  }

  cell.drawFace(cx, cy - 1, state, frame, {
    eyeColor: '#FACC15',
    eyeShine: '#FFFFFF',
    cheekColor: '#A855F7',
    mouthStyle: 'fangs',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy + 1, state, frame, palette, { bellyY: cy + 4, bellyRx: 7 });
  cell.drawStateEffects(state, frame);
}

const FORM_DRAWERS = {
  egg: drawEgg,
  // Lignée Aquatique (aqua)
  baby_aqua: drawBabyAqua,
  child_aqua: drawChildAqua,
  adult_aqua_coral: drawAdultAquaCoral,
  adult_aqua_leviathan: drawAdultAquaLeviathan,
  adult_aqua_pearl: drawAdultAquaPearl,
  adult_aqua_abyss: drawAdultAquaAbyss,
  // Lignée Sylvestre (flora)
  baby_flora: drawBabyFlora,
  child_flora: drawChildFlora,
  adult_flora_bloom: drawAdultFloraBloom,
  adult_flora_raptor: drawAdultFloraRaptor,
  adult_flora_truffle: drawAdultFloraTruffle,
  adult_flora_thorn: drawAdultFloraThorn,
  // Lignée Astrale / Flamme (ember)
  baby_ember: drawBabyEmber,
  child_ember: drawChildEmber,
  adult_ember_solar: drawAdultEmberSolar,
  adult_ember_comet: drawAdultEmberComet,
  adult_ember_magma: drawAdultEmberMagma,
  adult_ember_eclipse: drawAdultEmberEclipse,
};

// ============================================================================
// 4. GÉNÉRATION DES 19 SPRITESHEETS (256x512 px) ET DES ICÔNES (TRAY & APP)
// ============================================================================

function generateFormSpritesheet(formId, drawFn) {
  const sheet = new PixelCanvas(256, 512); // 4 colonnes * 64px, 8 lignes * 64px

  for (let row = 0; row < ROW_STATES.length; row++) {
    const state = ROW_STATES[row];
    for (let col = 0; col < 4; col++) {
      const cell = new CellPainter(sheet, col, row, 64, 2);
      drawFn(cell, state, col);
    }
  }

  return sheet.toPNG();
}

/**
 * Dessine une icône Tamagotchi nette et contrastée (visible sur barre des tâches claire ou sombre)
 */
function generateTamagotchiIconCanvas(size, scale) {
  const canvas = new PixelCanvas(size, size);
  const cell = new CellPainter(canvas, 0, 0, size, scale);

  cell.shadedBody(16, 16, 13.5, 14.5, {
    outline: '#0F172A',
    base: '#FF6B8B',
    shade: '#D9386A',
    highlight: '#FFCAD4',
  });

  cell.rect(14, 1, 4, 1, '#FFE066');
  cell.rect(15, 0, 2, 1, '#FFE066');

  cell.rect(7, 7, 18, 14, '#1E293B');
  cell.rect(8, 8, 16, 12, '#E2F8DC');

  cell.rect(11, 11, 10, 8, '#0D4A56');
  cell.rect(12, 12, 8, 6, '#48E0E4');
  cell.dot(13, 14, '#0F172A');
  cell.dot(18, 14, '#0F172A');
  cell.dot(12, 15, '#FF7EB6');
  cell.dot(19, 15, '#FF7EB6');
  cell.rect(15, 16, 2, 1, '#0F172A');

  cell.rect(9, 23, 3, 2, '#FFE066');
  cell.rect(15, 24, 3, 2, '#FFE066');
  cell.rect(21, 23, 3, 2, '#FFE066');

  return canvas;
}

function main() {
  fs.mkdirSync(SPRITES_DIR, { recursive: true });
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const formsMeta = [
    // 1. Œuf commun
    { id: 'egg', stage: 'egg', stageIndex: 0, lineage: null, bodyArchetype: 'mystic_egg', name: 'Œuf Mystique' },

    // 2. Lignée Aquatique (aqua)
    { id: 'baby_aqua', stage: 'baby', stageIndex: 1, lineage: 'aqua', bodyArchetype: 'droplet_slime', name: "P'tit Goutte" },
    { id: 'child_aqua', stage: 'child', stageIndex: 2, lineage: 'aqua', bodyArchetype: 'axolotl_tadpole', name: 'Ondine Vive' },
    { id: 'adult_aqua_coral', stage: 'adult', stageIndex: 3, lineage: 'aqua', bodyArchetype: 'sea_angel', name: 'Corallia' },
    { id: 'adult_aqua_leviathan', stage: 'adult', stageIndex: 3, lineage: 'aqua', bodyArchetype: 'serpent_dragon', name: 'Léviathan Azur' },
    { id: 'adult_aqua_pearl', stage: 'adult', stageIndex: 3, lineage: 'aqua', bodyArchetype: 'octopus', name: 'Perle Gourmande' },
    { id: 'adult_aqua_abyss', stage: 'adult', stageIndex: 3, lineage: 'aqua', bodyArchetype: 'anglerfish', name: 'Abyssal' },

    // 3. Lignée Sylvestre (flora)
    { id: 'baby_flora', stage: 'baby', stageIndex: 1, lineage: 'flora', bodyArchetype: 'bulb_quadruped', name: "P'tit Bourgeon" },
    { id: 'child_flora', stage: 'child', stageIndex: 2, lineage: 'flora', bodyArchetype: 'biped_dino', name: 'Feuillu Curieux' },
    { id: 'adult_flora_bloom', stage: 'adult', stageIndex: 3, lineage: 'flora', bodyArchetype: 'mametchi_ears', name: 'Floramajesté' },
    { id: 'adult_flora_raptor', stage: 'adult', stageIndex: 3, lineage: 'flora', bodyArchetype: 'raptor_bird', name: 'Vélociflore' },
    { id: 'adult_flora_truffle', stage: 'adult', stageIndex: 3, lineage: 'flora', bodyArchetype: 'kuchipatchi_mushroom', name: 'Truffignon' },
    { id: 'adult_flora_thorn', stage: 'adult', stageIndex: 3, lineage: 'flora', bodyArchetype: 'carnivorous_vine', name: 'Ronce-Noire' },

    // 4. Lignée Astrale / Flamme (ember)
    { id: 'baby_ember', stage: 'baby', stageIndex: 1, lineage: 'ember', bodyArchetype: 'star_spirit', name: "P'tite Braise" },
    { id: 'child_ember', stage: 'child', stageIndex: 2, lineage: 'ember', bodyArchetype: 'winged_comet', name: 'Pyrolynx' },
    { id: 'adult_ember_solar', stage: 'adult', stageIndex: 3, lineage: 'ember', bodyArchetype: 'phoenix', name: 'Solarix' },
    { id: 'adult_ember_comet', stage: 'adult', stageIndex: 3, lineage: 'ember', bodyArchetype: 'mecha_star', name: 'Comète Fulgurante' },
    { id: 'adult_ember_magma', stage: 'adult', stageIndex: 3, lineage: 'ember', bodyArchetype: 'lava_golem', name: 'Magma-Chef' },
    { id: 'adult_ember_eclipse', stage: 'adult', stageIndex: 3, lineage: 'ember', bodyArchetype: 'phantom_bat', name: 'Éclipse Nocturne' },
  ];

  // 1. Générer les 19 spritesheets PNG (256x512)
  for (const form of formsMeta) {
    const drawFn = FORM_DRAWERS[form.id];
    const pngBuf = generateFormSpritesheet(form.id, drawFn);
    const outPath = path.join(SPRITES_DIR, `${form.id}.png`);
    fs.writeFileSync(outPath, pngBuf);
    console.log(`[OK] Spritesheet générée : assets/sprites/${form.id}.png [archetype=${form.bodyArchetype}] (${pngBuf.length} octets)`);
  }

  // 2. Générer le manifeste assets/sprites/sprites-manifest.json
  const spritesMap = {};
  for (const form of formsMeta) {
    spritesMap[form.id] = `assets/sprites/${form.id}.png`;
  }

  const manifest = {
    version: 3,
    sheetWidth: 256,
    sheetHeight: 512,
    frameWidth: 64,
    frameHeight: 64,
    columns: 4,
    framesPerRow: 4,
    rows: {
      idle: 0,
      walk: 1,
      eat: 2,
      happy: 3,
      sleep: 4,
      sad: 5,
      hungry: 6,
      need_cuddle: 7,
    },
    forms: formsMeta.map((f) => ({
      ...f,
      file: `${f.id}.png`,
      path: `assets/sprites/${f.id}.png`,
    })),
    sprites: spritesMap,
  };

  const manifestPath = path.join(SPRITES_DIR, 'sprites-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[OK] Manifeste généré : assets/sprites/sprites-manifest.json`);

  // 3. Générer les icônes Tray (32x32), App PNG (256x256) et App ICO (Windows)
  const trayCanvas = generateTamagotchiIconCanvas(32, 1);
  const trayPng = trayCanvas.toPNG();
  const trayPath = path.join(ICONS_DIR, 'tray-icon.png');
  fs.writeFileSync(trayPath, trayPng);
  console.log(`[OK] Icône Tray générée : assets/icons/tray-icon.png (${trayPng.length} octets)`);

  const appCanvas = generateTamagotchiIconCanvas(256, 8);
  const appPng = appCanvas.toPNG();
  const appPngPath = path.join(ICONS_DIR, 'app-icon.png');
  fs.writeFileSync(appPngPath, appPng);
  console.log(`[OK] Icône App PNG générée : assets/icons/app-icon.png (${appPng.length} octets)`);

  const appIco = encodeICOFromPNG256(appPng);
  const appIcoPath = path.join(ICONS_DIR, 'app-icon.ico');
  fs.writeFileSync(appIcoPath, appIco);
  console.log(`[OK] Icône App ICO générée : assets/icons/app-icon.ico (${appIco.length} octets)`);
}

main();
