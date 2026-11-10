#!/usr/bin/env node
/**
 * scripts/generate-placeholders.mjs
 *
 * Générateur autonome (zéro dépendance externe, uniquement fs, path, zlib natifs Node.js)
 * produisant :
 * - Les 7 spritesheets PNG RGBA 32-bits (256x384 px, grille 4x6 de cellules 64x64 px, fond transparent)
 *   dans assets/sprites/<formId>.png :
 *     egg, baby_blob, child_sprout, adult_solar, adult_athletic, adult_gourmet, adult_shadow
 * - Le manifeste assets/sprites/sprites-manifest.json
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

  // IHDR chunk (13 bytes)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // Bit depth: 8 bits per channel
  ihdr[9] = 6;  // Color type: 6 (Truecolor with alpha RGBA)
  ihdr[10] = 0; // Compression method: 0 (deflate)
  ihdr[11] = 0; // Filter method: 0
  ihdr[12] = 0; // Interlace method: 0 (no interlace)

  // Raw scanlines with filter byte 0 (None) at start of each row
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
// 2. OUTILS DE DESSIN PIXEL-ART
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
    this.data = new Uint8Array(width * height * 4); // Initialisé à 0 (100% transparent)
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
      // Alpha blending standard
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
 * Garantit un rendu pixel-art net, lisible et charmant.
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
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        this.dot(lx + x, ly + y, color);
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
   * Ombre portée douce au sol sous le personnage
   */
  groundShadow(cx = 16, cy = 28, rx = 8, ry = 1.8) {
    const shadowColor = [15, 23, 42, 75];
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1.0) {
          this.dot(x, y, shadowColor);
        }
      }
    }
  }

  /**
   * Visage expressif selon l'état d'animation (idle, walk, eat, happy, sleep, sad)
   */
  drawFace(cx, cy, state, frame, options = {}) {
    const eyeColor = options.eyeColor || '#141B29';
    const eyeShine = options.eyeShine || '#FFFFFF';
    const cheekColor = options.cheekColor || '#FF7EB6';
    const mouthColor = options.mouthColor || '#9E2A47';
    const eyeSpan = options.eyeSpan || 4;

    const lx = cx - eyeSpan;
    const rx = cx + eyeSpan - 1;

    // Joues roses
    if (cheekColor && state !== 'sad') {
      this.dot(lx - 2, cy + 2, cheekColor);
      this.dot(lx - 1, cy + 2, cheekColor);
      this.dot(rx + 2, cy + 2, cheekColor);
      this.dot(rx + 3, cy + 2, cheekColor);
    }

    // Yeux selon l'état
    if (state === 'happy') {
      // Yeux joyeux en arc ^ ^
      this.dot(lx - 1, cy, eyeColor);
      this.dot(lx, cy - 1, eyeColor);
      this.dot(lx + 1, cy, eyeColor);

      this.dot(rx, cy, eyeColor);
      this.dot(rx + 1, cy - 1, eyeColor);
      this.dot(rx + 2, cy, eyeColor);
    } else if (state === 'sleep') {
      // Yeux fermés paisibles
      this.dot(lx - 1, cy + 1, eyeColor);
      this.dot(lx, cy + 1, eyeColor);
      this.dot(lx + 1, cy + 1, eyeColor);

      this.dot(rx, cy + 1, eyeColor);
      this.dot(rx + 1, cy + 1, eyeColor);
      this.dot(rx + 2, cy + 1, eyeColor);
    } else if (state === 'sad') {
      // Yeux tristes tombants
      this.dot(lx, cy, eyeColor);
      this.dot(lx + 1, cy, eyeColor);
      this.dot(lx - 1, cy - 1, eyeColor);

      this.dot(rx, cy, eyeColor);
      this.dot(rx + 1, cy, eyeColor);
      this.dot(rx + 2, cy - 1, eyeColor);
      // Petite larme au coin de l'œil
      this.dot(lx - 1, cy + 1, '#5CE1E6');
    } else {
      // Yeux grands ouverts brillants (2x2 logiques avec éclat blanc)
      this.rect(lx, cy - 1, 2, 2, eyeColor);
      this.dot(lx, cy - 1, eyeShine);

      this.rect(rx, cy - 1, 2, 2, eyeColor);
      this.dot(rx, cy - 1, eyeShine);
    }

    // Bouche selon l'état
    const my = cy + 2;
    if (state === 'eat') {
      if (frame % 2 === 0) {
        // Grande bouche ouverte "Miam"
        this.rect(cx - 1, my, 3, 2, mouthColor);
        this.dot(cx, my + 1, '#FF8FA3'); // Langue
      } else {
        // Mâche
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
    } else if (state === 'sleep') {
      this.dot(cx, my, eyeColor);
    } else {
      // Petit sourire doux
      this.dot(cx - 1, my, eyeColor);
      this.dot(cx, my, eyeColor);
    }
  }

  /**
   * Effets visuels d'état : cœur (happy), Zzz (sleep), nourriture/miettes (eat), goutte de sueur (sad)
   */
  drawStateEffects(state, frame) {
    if (state === 'happy') {
      // Petit cœur flottant qui monte
      const hy = 5 - (frame % 2);
      const hx = 24;
      const heartRed = '#FF3B6B';
      const heartLight = '#FF8FA3';
      this.dot(hx, hy, heartRed);
      this.dot(hx + 2, hy, heartRed);
      this.rect(hx - 1, hy + 1, 5, 1, heartRed);
      this.dot(hx, hy + 1, heartLight);
      this.rect(hx, hy + 2, 3, 1, heartRed);
      this.dot(hx + 1, hy + 3, heartRed);

      // Étoiles scintillantes
      const sy = 7 + (frame % 2);
      this.dot(5, sy, '#FFE066');
      this.dot(4, sy + 1, '#FFF3B0');
      this.dot(6, sy + 1, '#FFE066');
      this.dot(5, sy + 2, '#FFE066');
    } else if (state === 'sleep') {
      // Petits "Zzz" flottants
      const zColor = '#7CC6FE';
      const zLight = '#CBE8FF';
      const offset = frame % 2;
      // Petit z
      const zx1 = 22;
      const zy1 = 10 - offset;
      this.rect(zx1, zy1, 3, 1, zColor);
      this.dot(zx1 + 1, zy1 + 1, zLight);
      this.rect(zx1, zy1 + 2, 3, 1, zColor);

      // Grand Z
      if (frame >= 1) {
        const zx2 = 25;
        const zy2 = 5 - offset;
        this.rect(zx2, zy2, 4, 1, zColor);
        this.dot(zx2 + 2, zy2 + 1, zLight);
        this.dot(zx2 + 1, zy2 + 2, zColor);
        this.rect(zx2, zy2 + 3, 4, 1, zColor);
      }
    } else if (state === 'eat') {
      // Pomme / biscuit croqué + petites miettes/étoiles
      const fx = 6;
      const fy = 18 + (frame % 2);
      if (frame < 3) {
        this.rect(fx, fy, 3, 3, '#FF4D4D');
        this.dot(fx + 1, fy - 1, '#52B788'); // Petite feuille
        this.dot(fx, fy, '#FF9999');
      }
      // Miettes / étoiles de délice
      if (frame % 2 === 1) {
        this.dot(9, 17, '#FFD166');
        this.dot(23, 16, '#FFD166');
        this.dot(10, 21, '#F4A261');
      }
    } else if (state === 'sad') {
      // Grosse goutte de sueur bleue qui descend + petit nuage gris
      const sy = 9 + frame;
      const sx = 25;
      this.dot(sx, sy, '#ADE8F4');
      this.rect(sx - 1, sy + 1, 3, 2, '#48CAE4');
      this.dot(sx, sy + 1, '#CAF0F8');
      this.dot(sx, sy + 3, '#0096C7');
    }
  }
}

// ============================================================================
// 3. DESSIN DES 7 FORMES (STADES 0 À 3)
// ============================================================================

const ROW_STATES = ['idle', 'walk', 'eat', 'happy', 'sleep', 'sad'];

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
  }
  return { dx, dy };
}

/**
 * 1. EGG : Œuf crème tacheté de vert/doré qui oscille
 */
function drawEgg(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 7, 1.6);

  const outline = '#4A3B2C';
  const base = '#FFF8E7';
  const shade = '#E8D8B8';
  const highlight = '#FFFFFF';

  // Forme d'œuf continue (plus étroite vers le sommet, plus ronde à la base)
  const rxBase = 7.4;
  const ry = 9.0;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    const ny = (y - cy) / ry;
    // Rétrécissement progressif vers le haut de l'œuf
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

  // Taches vert émeraude et dorées caractéristiques
  const greenSpot = '#52B788';
  const goldSpot = '#F5B73B';
  cell.rect(cx - 4, cy - 2, 2, 2, greenSpot);
  cell.rect(cx + 2, cy + 1, 2, 2, goldSpot);
  cell.dot(cx - 1, cy - 5, goldSpot);
  cell.dot(cx, cy - 5, goldSpot);
  cell.rect(cx - 3, cy + 3, 2, 2, goldSpot);
  cell.dot(cx + 3, cy - 3, greenSpot);

  // Petits fendillements joyeux sur happy ou idle frame 2
  if (state === 'happy' || (state === 'idle' && frame === 2)) {
    cell.dot(cx - 2, cy - 1, outline);
    cell.dot(cx - 1, cy, outline);
    cell.dot(cx, cy - 1, outline);
    cell.dot(cx + 1, cy, outline);
  }

  cell.drawStateEffects(state, frame);
}

/**
 * 2. BABY_BLOB : Petit slime/boule turquoise mignon avec grands yeux brillants et joues roses
 */
function drawBabyBlob(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#0D4A56',
    base: '#48E0E4',
    shade: '#20B2B8',
    highlight: '#B4FAFC',
  };

  const rx = state === 'sleep' ? 9.5 : 8.2;
  const ry = state === 'sleep' ? 6.2 : 7.2;
  cell.shadedBody(cx, cy, rx, ry, palette, 1);

  // Petite houppe / goutte gélatineuse sur le sommet
  const topY = Math.round(cy - ry);
  cell.rect(cx - 1, topY - 2, 2, 2, palette.base);
  cell.dot(cx - 1, topY - 3, palette.outline);
  cell.dot(cx, topY - 3, palette.outline);

  cell.drawFace(cx, cy, state, frame, {
    cheekColor: '#FF7EB6',
    eyeSpan: 4,
  });
  cell.drawStateEffects(state, frame);
}

/**
 * 3. CHILD_SPROUT : Créature vert tendre avec une petite feuille sur la tête et des petites pattes
 */
function drawChildSprout(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#1D4726',
    base: '#8CE668',
    shade: '#5BBF40',
    highlight: '#C9FCAD',
  };

  // Petites pattes alternées pour la marche
  const leftFootY = cy + 7 + (state === 'walk' && frame % 2 === 0 ? -1 : 0);
  const rightFootY = cy + 7 + (state === 'walk' && frame % 2 === 1 ? -1 : 0);
  cell.rect(cx - 5, leftFootY, 3, 2, '#1D4726');
  cell.rect(cx - 4, leftFootY, 2, 1, '#459E30');
  cell.rect(cx + 2, rightFootY, 3, 2, '#1D4726');
  cell.rect(cx + 2, rightFootY, 2, 1, '#459E30');

  // Corps rond
  cell.shadedBody(cx, cy, 8.0, 7.2, palette);

  // Petite tige + double feuille sur la tête
  const stemY = cy - 9;
  const leafSway = frame % 2 === 0 ? 0 : 1;
  cell.rect(cx, stemY, 1, 3, '#1D4726');
  // Feuille gauche
  cell.rect(cx - 4, stemY - 1 + leafSway, 4, 2, '#2B9348');
  cell.dot(cx - 3, stemY - 1 + leafSway, '#80ED99');
  // Feuille droite
  cell.rect(cx + 1, stemY - 2, 4, 2, '#2B9348');
  cell.dot(cx + 2, stemY - 2, '#80ED99');

  cell.drawFace(cx, cy, state, frame, {
    cheekColor: '#FF8CA3',
    eyeSpan: 4,
  });
  cell.drawStateEffects(state, frame);
}

/**
 * 4. ADULT_SOLAR : Créature dorée/solaire radieuse avec couronne lumineuse et ailes/auréole
 */
function drawAdultSolar(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#6B3710',
    base: '#FFD447',
    shade: '#F29F24',
    highlight: '#FFF8B8',
  };

  // Ailes célestes sur les côtés (battement doux)
  const wingFlap = frame % 2 === 0 ? 0 : -1;
  const wingLight = '#FFF8D6';
  const wingGold = '#FFAE19';
  // Aile gauche
  cell.rect(cx - 11, cy - 3 + wingFlap, 3, 5, wingGold);
  cell.rect(cx - 10, cy - 2 + wingFlap, 2, 3, wingLight);
  // Aile droite
  cell.rect(cx + 8, cy - 3 + wingFlap, 3, 5, wingGold);
  cell.rect(cx + 8, cy - 2 + wingFlap, 2, 3, wingLight);

  // Petits pieds dorés
  const lfY = cy + 7 + (state === 'walk' && frame % 2 === 0 ? -1 : 0);
  const rfY = cy + 7 + (state === 'walk' && frame % 2 === 1 ? -1 : 0);
  cell.rect(cx - 5, lfY, 3, 2, '#D97706');
  cell.rect(cx + 2, rfY, 3, 2, '#D97706');

  // Corps solaire
  cell.shadedBody(cx, cy, 8.5, 7.8, palette);

  // Écusson ventral lumineux
  cell.rect(cx - 3, cy + 3, 6, 3, '#FFF3B0');

  // Couronne solaire / auréole radieuse au sommet
  const crownY = cy - 9;
  cell.rect(cx - 4, crownY, 9, 2, '#FF7B00');
  cell.rect(cx - 3, crownY, 7, 1, '#FFF75E');
  // Pointes de la couronne
  cell.dot(cx - 4, crownY - 1, '#FF7B00');
  cell.dot(cx, crownY - 2, '#FFF75E');
  cell.dot(cx, crownY - 1, '#FF7B00');
  cell.dot(cx + 4, crownY - 1, '#FF7B00');

  cell.drawFace(cx, cy - 1, state, frame, {
    cheekColor: '#FF6B6B',
    eyeSpan: 4,
  });
  cell.drawStateEffects(state, frame);
}

/**
 * 5. ADULT_ATHLETIC : Créature dynamique bleu électrique/orange avec bandeau sportif et oreilles dressées
 */
function drawAdultAthletic(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#142858',
    base: '#2B7FFF',
    shade: '#1A56C4',
    highlight: '#82BFFF',
  };

  // Oreilles dressées énergiques (bleues à pointes orange)
  const earY = cy - 11;
  cell.rect(cx - 6, earY, 3, 5, palette.outline);
  cell.rect(cx - 5, earY + 1, 2, 3, '#FF8C00');
  cell.rect(cx + 3, earY, 3, 5, palette.outline);
  cell.rect(cx + 3, earY + 1, 2, 3, '#FF8C00');

  // Jambes sportives avec baskets orange
  const lfY = cy + 7 + (state === 'walk' && frame % 2 === 0 ? -2 : 0);
  const rfY = cy + 7 + (state === 'walk' && frame % 2 === 1 ? -2 : 0);
  cell.rect(cx - 5, lfY, 3, 2, '#FF5722');
  cell.rect(cx + 2, rfY, 3, 2, '#FF5722');

  // Corps athlétique
  cell.shadedBody(cx, cy, 8.2, 7.6, palette);

  // Bandeau sportif orange vif sur le front + ruban flottant à gauche
  const bandY = cy - 4;
  cell.rect(cx - 7, bandY, 15, 2, '#FF5722');
  cell.rect(cx - 5, bandY, 11, 1, '#FF9E00');
  // Pans du bandeau qui flottent au vent
  const tailShift = frame % 2 === 0 ? 0 : 1;
  cell.rect(cx - 10, bandY + tailShift, 3, 2, '#FF5722');

  cell.drawFace(cx, cy, state, frame, {
    cheekColor: '#FF9E00',
    eyeSpan: 4,
  });
  cell.drawStateEffects(state, frame);
}

/**
 * 6. ADULT_GOURMET : Créature ronde couleur pêche/fraise avec petite toque de chef et bavoir gourmand
 */
function drawAdultGourmet(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 9.5, 1.9);

  const palette = {
    outline: '#5E2135',
    base: '#FF9EAA',
    shade: '#E86F82',
    highlight: '#FFD6DE',
  };

  // Petits pieds ronds
  const lfY = cy + 7 + (state === 'walk' && frame % 2 === 0 ? -1 : 0);
  const rfY = cy + 7 + (state === 'walk' && frame % 2 === 1 ? -1 : 0);
  cell.rect(cx - 6, lfY, 3, 2, '#5E2135');
  cell.rect(cx + 3, rfY, 3, 2, '#5E2135');

  // Corps bien dodu
  cell.shadedBody(cx, cy, 9.2, 7.6, palette);

  // Bavoir blanc gourmand sur le ventre avec petit motif fraise/cœur
  cell.rect(cx - 4, cy + 3, 9, 3, '#FFFFFF');
  cell.rect(cx - 3, cy + 6, 7, 1, '#E2E8F0');
  cell.dot(cx, cy + 4, '#E63946');

  // Toque de chef pâtissier blanche sur la tête (avec contour sombre net)
  const hatY = cy - 12;
  cell.rect(cx - 4, hatY, 9, 2, '#5E2135');     // Bord haut de la toque
  cell.rect(cx - 5, hatY + 1, 11, 4, '#5E2135'); // Contour extérieur
  cell.rect(cx - 4, hatY + 1, 9, 3, '#FFFFFF');  // Dôme blanc de la toque
  cell.rect(cx - 3, hatY + 4, 7, 1, '#F4A261');  // Bande dorée/orangée de la toque
  cell.dot(cx - 1, hatY + 1, '#E2E8F0');         // Pli de la toque
  cell.dot(cx + 2, hatY + 1, '#E2E8F0');         // Pli de la toque

  cell.drawFace(cx, cy - 1, state, frame, {
    cheekColor: '#FF4D6D',
    eyeSpan: 4,
  });
  cell.drawStateEffects(state, frame);
}

/**
 * 7. ADULT_SHADOW : Créature violette/nocturne mystérieuse avec yeux ambrés lumineux et petites cornes/flammes
 */
function drawAdultShadow(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#160C28',
    base: '#4A2E7A',
    shade: '#2F1B52',
    highlight: '#7C58B8',
  };

  // Petites cornes mystiques violettes/lavande
  const hornY = cy - 10;
  cell.rect(cx - 6, hornY + 1, 2, 3, '#9D75E6');
  cell.dot(cx - 7, hornY, '#C8B2F8');
  cell.rect(cx + 4, hornY + 1, 2, 3, '#9D75E6');
  cell.dot(cx + 6, hornY, '#C8B2F8');

  // Flammes spectrales flottantes autour de la créature
  const wispY = cy - 2 + (frame % 2 === 0 ? -1 : 1);
  cell.rect(cx - 11, wispY, 2, 3, '#8A4FFF');
  cell.dot(cx - 11, wispY - 1, '#38BDF8');
  cell.rect(cx + 9, wispY + 1, 2, 3, '#8A4FFF');
  cell.dot(cx + 10, wispY, '#38BDF8');

  // Corps nocturne
  cell.shadedBody(cx, cy, 8.2, 7.6, palette);

  // Base vaporeuse fantomatique
  for (let i = -6; i <= 6; i += 3) {
    const wave = (frame + Math.abs(i)) % 2;
    cell.rect(cx + i, cy + 6 + wave, 2, 2, '#2F1B52');
  }

  // Visage avec yeux ambrés lumineux
  cell.drawFace(cx, cy, state, frame, {
    eyeColor: '#FFB703',
    eyeShine: '#FFF3B0',
    cheekColor: '#9D4EDD',
    mouthColor: '#38BDF8',
    eyeSpan: 4,
  });
  cell.drawStateEffects(state, frame);
}

const FORM_DRAWERS = {
  egg: drawEgg,
  baby_blob: drawBabyBlob,
  child_sprout: drawChildSprout,
  adult_solar: drawAdultSolar,
  adult_athletic: drawAdultAthletic,
  adult_gourmet: drawAdultGourmet,
  adult_shadow: drawAdultShadow,
};

// ============================================================================
// 4. GÉNÉRATION DES SPRITESHEETS (256x384 px) ET DES ICÔNES (TRAY 32x32 & APP 256x256)
// ============================================================================

function generateFormSpritesheet(formId, drawFn) {
  const sheet = new PixelCanvas(256, 384); // 4 colonnes * 64px, 6 lignes * 64px

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

  // Coque d'œuf Tamagotchi avec bordure sombre et anneau clair pour visibilité universelle
  cell.shadedBody(16, 16, 13.5, 14.5, {
    outline: '#0F172A',
    base: '#FF6B8B',
    shade: '#D9386A',
    highlight: '#FFCAD4',
  });

  // Anneau blanc/doré extérieur fin pour contraste sur thème sombre
  cell.rect(14, 1, 4, 1, '#FFE066');
  cell.rect(15, 0, 2, 1, '#FFE066');

  // Écran LCD central clair
  cell.rect(7, 7, 18, 14, '#1E293B');
  cell.rect(8, 8, 16, 12, '#E2F8DC');

  // Petit compagnon turquoise mignon au centre de l'écran
  cell.rect(11, 11, 10, 8, '#0D4A56');
  cell.rect(12, 12, 8, 6, '#48E0E4');
  cell.dot(13, 14, '#0F172A'); // Œil gauche
  cell.dot(18, 14, '#0F172A'); // Œil droit
  cell.dot(12, 15, '#FF7EB6'); // Joue gauche
  cell.dot(19, 15, '#FF7EB6'); // Joue droite
  cell.rect(15, 16, 2, 1, '#0F172A'); // Sourire

  // 3 petits boutons jaunes en bas de la coque Tamagotchi
  cell.rect(9, 23, 3, 2, '#FFE066');
  cell.rect(15, 24, 3, 2, '#FFE066');
  cell.rect(21, 23, 3, 2, '#FFE066');

  return canvas;
}

function main() {
  fs.mkdirSync(SPRITES_DIR, { recursive: true });
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const formsMeta = [
    { id: 'egg', stage: 'egg', stageIndex: 0, name: 'Œuf Mystère' },
    { id: 'baby_blob', stage: 'baby', stageIndex: 1, name: 'Bébé Blob' },
    { id: 'child_sprout', stage: 'child', stageIndex: 2, name: 'Jeune Pousse' },
    { id: 'adult_solar', stage: 'adult', stageIndex: 3, name: 'Adulte Solaire' },
    { id: 'adult_athletic', stage: 'adult', stageIndex: 3, name: 'Adulte Athlétique' },
    { id: 'adult_gourmet', stage: 'adult', stageIndex: 3, name: 'Adulte Gourmet' },
    { id: 'adult_shadow', stage: 'adult', stageIndex: 3, name: 'Adulte Ombre' },
  ];

  // 1. Générer les 7 spritesheets PNG (256x384)
  for (const form of formsMeta) {
    const drawFn = FORM_DRAWERS[form.id];
    const pngBuf = generateFormSpritesheet(form.id, drawFn);
    const outPath = path.join(SPRITES_DIR, `${form.id}.png`);
    fs.writeFileSync(outPath, pngBuf);
    console.log(`[OK] Spritesheet générée : assets/sprites/${form.id}.png (${pngBuf.length} octets)`);
  }

  // 2. Générer le manifeste assets/sprites/sprites-manifest.json
  const spritesMap = {};
  for (const form of formsMeta) {
    spritesMap[form.id] = `assets/sprites/${form.id}.png`;
  }

  const manifest = {
    version: 1,
    sheetWidth: 256,
    sheetHeight: 384,
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
