#!/usr/bin/env node
/**
 * scripts/generate-placeholders.mjs
 *
 * Générateur autonome (zéro dépendance externe, uniquement fs, path, zlib natifs Node.js)
 * produisant :
 * - Les 19 spritesheets PNG RGBA 32-bits (256x512 px, grille 4x8 de cellules 64x64 px, fond transparent)
 *   dans assets/sprites/<formId>.png :
 *     1. egg
 *     2. Lignée Aquatique (aqua) :
 *        baby_aqua, child_aqua, adult_aqua_coral, adult_aqua_leviathan, adult_aqua_pearl, adult_aqua_abyss
 *     3. Lignée Sylvestre (flora) :
 *        baby_flora, child_flora, adult_flora_bloom, adult_flora_raptor, adult_flora_truffle, adult_flora_thorn
 *     4. Lignée Astrale / Flamme (ember) :
 *        baby_ember, child_ember, adult_ember_solar, adult_ember_comet, adult_ember_magma, adult_ember_eclipse
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
   * Dessine les petits bras/mains spécifiques aux animations de besoins (hungry / need_cuddle)
   */
  drawNeedPoseOverlay(cx, cy, state, frame, palette) {
    const { outline, base, highlight } = palette;
    if (state === 'hungry') {
      // Petites mains pressées sur le ventre qui gargouille
      const tremor = frame % 2;
      this.rect(cx - 5, cy + 3 + tremor, 3, 2, outline);
      this.rect(cx - 4, cy + 3 + tremor, 2, 1, highlight || base);
      this.rect(cx + 3, cy + 3 + tremor, 3, 2, outline);
      this.rect(cx + 3, cy + 3 + tremor, 2, 1, highlight || base);

      // Ondes de gargouillis sur le ventre
      const waveColor = '#FBBF24';
      if (frame % 2 === 0) {
        this.dot(cx - 8, cy + 3, waveColor);
        this.dot(cx - 9, cy + 4, waveColor);
        this.dot(cx + 8, cy + 3, waveColor);
        this.dot(cx + 9, cy + 4, waveColor);
      } else {
        this.dot(cx - 9, cy + 2, waveColor);
        this.dot(cx - 8, cy + 5, waveColor);
        this.dot(cx + 9, cy + 2, waveColor);
        this.dot(cx + 8, cy + 5, waveColor);
      }
    } else if (state === 'need_cuddle') {
      // Petits bras grands ouverts / levés vers le haut pour réclamer un câlin ou du jeu
      const leftUp = frame % 2 === 0 ? -1 : 0;
      const rightUp = frame % 2 === 1 ? -1 : 0;
      // Bras gauche tendu
      this.rect(cx - 10, cy - 2 + leftUp, 3, 3, outline);
      this.rect(cx - 9, cy - 1 + leftUp, 2, 2, base);
      // Bras droit tendu
      this.rect(cx + 7, cy - 2 + rightUp, 3, 3, outline);
      this.rect(cx + 7, cy - 1 + rightUp, 2, 2, base);
    }
  }

  /**
   * Visage expressif selon les 8 états d'animation :
   * idle, walk, eat, happy, sleep, sad, hungry, need_cuddle
   */
  drawFace(cx, cy, state, frame, options = {}) {
    const eyeColor = options.eyeColor || '#141B29';
    const eyeShine = options.eyeShine || '#FFFFFF';
    const cheekColor = options.cheekColor || '#FF7EB6';
    const mouthColor = options.mouthColor || '#9E2A47';
    const eyeSpan = options.eyeSpan || 4;

    const lx = cx - eyeSpan;
    const rx = cx + eyeSpan - 1;

    // Joues roses (plus vives sur need_cuddle et happy)
    if (cheekColor && state !== 'sad' && state !== 'hungry') {
      this.dot(lx - 2, cy + 2, cheekColor);
      this.dot(lx - 1, cy + 2, cheekColor);
      this.dot(rx + 2, cy + 2, cheekColor);
      this.dot(rx + 3, cy + 2, cheekColor);
    }

    // Yeux selon l'état
    if (state === 'happy') {
      // Yeux joyeux en arc ^ ^ avec éclat étoilé
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
    } else if (state === 'hungry') {
      // Yeux affamés avec sourcils inclinés vers le centre
      this.rect(lx, cy, 2, 2, eyeColor);
      this.dot(lx, cy, eyeShine);
      this.dot(lx - 1, cy - 1, eyeColor);
      this.dot(lx, cy - 2, eyeColor);

      this.rect(rx, cy, 2, 2, eyeColor);
      this.dot(rx, cy, eyeShine);
      this.dot(rx + 2, cy - 1, eyeColor);
      this.dot(rx + 1, cy - 2, eyeColor);
    } else if (state === 'need_cuddle') {
      // Grands yeux brillants suppliants (2x3 avec double reflet blanc !)
      this.rect(lx - 1, cy - 1, 3, 3, eyeColor);
      this.dot(lx - 1, cy - 1, eyeShine);
      this.dot(lx + 1, cy + 1, eyeShine);

      this.rect(rx, cy - 1, 3, 3, eyeColor);
      this.dot(rx, cy - 1, eyeShine);
      this.dot(rx + 2, cy + 1, eyeShine);
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
    } else if (state === 'hungry') {
      // Bouche tremblante en vaguelette
      const w0 = frame % 2;
      const w1 = (frame + 1) % 2;
      this.dot(cx - 2, my + w0, mouthColor);
      this.dot(cx - 1, my + w1, eyeColor);
      this.dot(cx, my + w0, mouthColor);
      this.dot(cx + 1, my + w1, eyeColor);
    } else if (state === 'need_cuddle') {
      // Petite bouche en "w" / appel affectueux
      this.dot(cx - 2, my, eyeColor);
      this.dot(cx - 1, my + 1, mouthColor);
      this.dot(cx, my, eyeColor);
      this.dot(cx + 1, my + 1, mouthColor);
      this.dot(cx + 2, my, eyeColor);
    } else if (state === 'sleep') {
      this.dot(cx, my, eyeColor);
    } else {
      // Petit sourire doux
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
      const fx = 5;
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
      // Grosse goutte de sueur bleue qui descend
      const sy = 9 + frame;
      const sx = 25;
      this.dot(sx, sy, '#ADE8F4');
      this.rect(sx - 1, sy + 1, 3, 2, '#48CAE4');
      this.dot(sx, sy + 1, '#CAF0F8');
      this.dot(sx, sy + 3, '#0096C7');
    } else if (state === 'hungry') {
      // Bulle d'envie de manger avec petite cuisse rôtie / icône de faim en haut à droite
      const by = 4 + (frame % 2);
      const bx = 23;
      // Fond de mini-bulle claire
      this.rect(bx - 1, by, 7, 6, '#FFFBEB');
      this.rect(bx, by - 1, 5, 8, '#FFFBEB');
      // Cuisse de poulet dorée + os blanc
      this.rect(bx, by + 1, 4, 3, '#D97706');
      this.dot(bx + 1, by + 1, '#FBBF24');
      this.rect(bx + 4, by + 2, 2, 1, '#FFFFFF');
      this.dot(bx + 5, by + 1, '#E2E8F0');
      this.dot(bx + 5, by + 3, '#E2E8F0');
      // Petits points de pensée
      this.dot(bx - 2, by + 7, '#FDE68A');
    } else if (state === 'need_cuddle') {
      // Double petit cœur rose à gauche + balle/étoile de jeu à droite
      const bounce = frame % 2;
      const hx = 4;
      const hy = 6 - bounce;
      this.dot(hx, hy, '#FF4D8D');
      this.dot(hx + 2, hy, '#FF4D8D');
      this.rect(hx - 1, hy + 1, 5, 1, '#FF4D8D');
      this.rect(hx, hy + 2, 3, 1, '#FF85B3');
      this.dot(hx + 1, hy + 3, '#FF4D8D');

      // Étoile / balle d'appel au jeu à droite
      const bx = 24;
      const by = 6 + bounce;
      this.rect(bx, by, 4, 4, '#38BDF8');
      this.rect(bx + 1, by + 1, 2, 2, '#FDE047');
      this.dot(bx, by, '#BAE6FD');
    }
  }
}

// ============================================================================
// 3. DESSIN DES 19 FORMES (ŒUF + 3 LIGNÉES : AQUA, FLORA, EMBER)
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
// 3.1. STADE 0 : EGG (Œuf mystique crème et doré avec fissures progressives)
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

  // Motifs mystiques dorés, émeraude et turquoise (rappelant les 3 lignées)
  const goldSpot = '#F5B73B';
  const floraSpot = '#52B788';
  const aquaSpot = '#38BDF8';
  cell.rect(cx - 4, cy - 2, 2, 2, goldSpot);
  cell.rect(cx + 2, cy + 1, 2, 2, goldSpot);
  cell.dot(cx - 1, cy - 5, floraSpot);
  cell.dot(cx, cy - 5, goldSpot);
  cell.rect(cx - 3, cy + 3, 2, 2, aquaSpot);
  cell.dot(cx + 3, cy - 3, floraSpot);

  // Progression des fissures :
  // Sur 'idle', frame 0 = intact, frame 1 = petite fissure, frame 2 = fissure moyenne, frame 3 = grande fissure lumineuse !
  const crackLevel = state === 'idle' ? frame : (state === 'happy' || state === 'need_cuddle' ? 2 : 1);

  if (crackLevel >= 1) {
    // Niveau 1 : première petite fissure près du sommet
    cell.dot(cx - 1, cy - 4, outline);
    cell.dot(cx, cy - 3, outline);
    cell.dot(cx - 1, cy - 2, outline);
  }
  if (crackLevel >= 2) {
    // Niveau 2 : fissure en zigzag qui s'étend au centre
    cell.dot(cx, cy - 1, outline);
    cell.dot(cx + 1, cy - 1, outline);
    cell.dot(cx + 2, cy, outline);
    cell.dot(cx - 2, cy - 1, outline);
    cell.dot(cx - 3, cy, outline);
  }
  if (crackLevel >= 3) {
    // Niveau 3 : grandes fissures ramifiées avec lueur dorée prête à éclore
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
// 3.2. LIGNÉE AQUATIQUE (AQUA)
// ----------------------------------------------------------------------------

/**
 * baby_aqua : P'tit Goutte turquoise mignon avec gouttelette sur la tête
 */
function drawBabyAqua(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#0B4650',
    base: '#48E0E4',
    shade: '#1CA7B0',
    highlight: '#BDFBFF',
  };

  const rx = state === 'sleep' ? 9.4 : 8.2;
  const ry = state === 'sleep' ? 6.2 : 7.2;
  cell.shadedBody(cx, cy, rx, ry, palette, 1);

  // Gouttelette d'eau sur le sommet de la tête
  const topY = Math.round(cy - ry);
  cell.rect(cx - 1, topY - 2, 2, 2, palette.base);
  cell.dot(cx, topY - 3, palette.highlight);
  cell.dot(cx - 1, topY - 3, palette.outline);
  cell.dot(cx + 1, topY - 2, palette.outline);

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#FF7EB6', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * child_aqua : Ondine Vive bleu azur avec petites nageoires-oreilles
 */
function drawChildAqua(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#0C4A6E',
    base: '#38BDF8',
    shade: '#0284C7',
    highlight: '#BAE6FD',
  };

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#0284C7', 5, 7);

  // Nageoires-oreilles latérales azur et cyan
  const finSway = frame % 2 === 0 ? 0 : -1;
  cell.rect(cx - 11, cy - 3 + finSway, 3, 4, palette.outline);
  cell.rect(cx - 10, cy - 2 + finSway, 2, 2, '#67E8F9');
  cell.rect(cx + 8, cy - 3 + finSway, 3, 4, palette.outline);
  cell.rect(cx + 8, cy - 2 + finSway, 2, 2, '#67E8F9');

  cell.shadedBody(cx, cy, 8.0, 7.2, palette);

  // Petite crête d'écume blanche au sommet
  cell.rect(cx - 1, cy - 9, 3, 2, '#E0F2FE');
  cell.dot(cx, cy - 10, palette.outline);

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#F472B6', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_aqua_coral : Corallia (bleu lagon et couronne de corail rose lumineux)
 */
function drawAdultAquaCoral(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#115E59',
    base: '#2DD4BF',
    shade: '#0D9488',
    highlight: '#99F6E4',
  };

  // Nageoires voilées rose corail sur les côtés
  const finFlap = frame % 2 === 0 ? 0 : -1;
  cell.rect(cx - 11, cy - 2 + finFlap, 3, 5, '#FF6B8B');
  cell.rect(cx - 10, cy - 1 + finFlap, 2, 3, '#FFC2D1');
  cell.rect(cx + 8, cy - 2 + finFlap, 3, 5, '#FF6B8B');
  cell.rect(cx + 8, cy - 1 + finFlap, 2, 3, '#FFC2D1');

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#0D9488', 5, 7);
  cell.shadedBody(cx, cy, 8.5, 7.6, palette);

  // Collier de perles nacrées sur le poitrail
  cell.dot(cx - 3, cy + 4, '#FFF1F2');
  cell.dot(cx, cy + 5, '#FFE4E6');
  cell.dot(cx + 3, cy + 4, '#FFF1F2');

  // Couronne de corail rose lumineux ramifiée au sommet
  const crownY = cy - 9;
  cell.rect(cx - 4, crownY, 9, 2, '#E11D48');
  cell.rect(cx - 3, crownY, 7, 1, '#FF8FA3');
  cell.rect(cx - 5, crownY - 2, 2, 2, '#FF6B8B');
  cell.rect(cx - 1, crownY - 3, 3, 3, '#FF6B8B');
  cell.dot(cx, crownY - 2, '#FFF1F2');
  cell.rect(cx + 4, crownY - 2, 2, 2, '#FF6B8B');

  cell.drawFace(cx, cy - 1, state, frame, { cheekColor: '#FB7185', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_aqua_leviathan : Léviathan Azur (bleu électrique sportif, crête hydrodynamique)
 */
function drawAdultAquaLeviathan(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#172554',
    base: '#2563EB',
    shade: '#1D4ED8',
    highlight: '#93C5FD',
  };

  // Ailerons hydrodynamiques acérés cyan/or
  const wingShift = frame % 2 === 0 ? 0 : 1;
  cell.rect(cx - 11, cy - 3 + wingShift, 3, 4, '#00F5D4');
  cell.dot(cx - 12, cy - 2 + wingShift, '#FACC15');
  cell.rect(cx + 8, cy - 3 + wingShift, 3, 4, '#00F5D4');
  cell.dot(cx + 11, cy - 2 + wingShift, '#FACC15');

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#00F5D4', 5, 7);
  cell.shadedBody(cx, cy, 8.2, 7.6, palette);

  // Crête dorsale/frontale hydrodynamique cyan et or
  const crestY = cy - 11;
  cell.rect(cx - 2, crestY + 1, 5, 3, '#00BBF9');
  cell.rect(cx - 1, crestY, 3, 3, '#00F5D4');
  cell.dot(cx, crestY - 1, '#FACC15');

  // Visière/marquage sportif jaune vif sur le front
  cell.rect(cx - 6, cy - 4, 13, 1, '#FACC15');

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#38BDF8', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_aqua_pearl : Perle Gourmande (rond nacré pastel avec coquillage/toque et perle)
 */
function drawAdultAquaPearl(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 9.5, 1.9);

  const palette = {
    outline: '#334155',
    base: '#E0F2FE',
    shade: '#7DD3FC',
    highlight: '#FFFFFF',
  };

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#F472B6', 6, 7);

  // Corps bien rond nacré
  cell.shadedBody(cx, cy, 9.2, 7.6, palette);

  // Bavoir coquillage pastel sur le ventre avec perle rose
  cell.rect(cx - 4, cy + 3, 9, 3, '#FFF1F2');
  cell.rect(cx - 3, cy + 6, 7, 1, '#FBCFE8');
  cell.rect(cx - 1, cy + 4, 2, 2, '#FF6B8B');

  // Toque-coquillage de chef sur la tête avec perle nacrée au centre
  const hatY = cy - 12;
  cell.rect(cx - 5, hatY + 1, 11, 4, palette.outline);
  cell.rect(cx - 4, hatY, 9, 4, '#FFFFFF');
  cell.rect(cx - 3, hatY + 4, 7, 1, '#38BDF8');
  cell.rect(cx - 1, hatY + 2, 3, 2, '#FF85A1'); // Perle rose sur la toque

  cell.drawFace(cx, cy - 1, state, frame, { cheekColor: '#F472B6', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_aqua_abyss : Abyssal (bleu nuit profond avec lanterne bioluminescente cyan)
 */
function drawAdultAquaAbyss(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#020617',
    base: '#1E1B4B',
    shade: '#0F172A',
    highlight: '#312E81',
  };

  // Nageoires spectrales bioluminescentes
  const glowShift = frame % 2;
  cell.rect(cx - 11, cy - 1 + glowShift, 2, 3, '#00F5D4');
  cell.rect(cx + 9, cy - 1 + glowShift, 2, 3, '#00F5D4');

  cell.shadedBody(cx, cy, 8.2, 7.6, palette);

  // Antenne recourbée d'abysses avec lanterne bioluminescente cyan/jaune
  const antY = cy - 11;
  cell.rect(cx - 1, antY + 1, 2, 3, '#312E81');
  cell.rect(cx, antY, 4, 1, '#312E81');
  // Lanterne brillante qui pulse
  const lanternX = cx + 4;
  const lanternY = antY + 1 + glowShift;
  cell.rect(lanternX - 1, lanternY, 3, 3, '#00F5D4');
  cell.dot(lanternX, lanternY + 1, '#FFFFFF');

  // Motifs bioluminescents sur le ventre
  cell.dot(cx - 3, cy + 5, '#00F5D4');
  cell.dot(cx + 3, cy + 5, '#00F5D4');

  cell.drawFace(cx, cy, state, frame, {
    eyeColor: '#00F5D4',
    eyeShine: '#FFFFFF',
    cheekColor: '#38BDF8',
    mouthColor: '#00F5D4',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

// ----------------------------------------------------------------------------
// 3.3. LIGNÉE SYLVESTRE (FLORA)
// ----------------------------------------------------------------------------

/**
 * baby_flora : P'tit Bourgeon vert tendre avec une petite pousse
 */
function drawBabyFlora(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#1A2E05',
    base: '#A3E635',
    shade: '#65A30D',
    highlight: '#ECFCCB',
  };

  const rx = state === 'sleep' ? 9.4 : 8.2;
  const ry = state === 'sleep' ? 6.2 : 7.2;
  cell.shadedBody(cx, cy, rx, ry, palette, 1);

  // Petite pousse unique verte au sommet
  const topY = Math.round(cy - ry);
  cell.rect(cx, topY - 3, 1, 3, '#1A2E05');
  cell.rect(cx + 1, topY - 4, 3, 2, '#4ADE80');
  cell.dot(cx + 2, topY - 4, '#DCFCE7');

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#FB7185', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * child_flora : Feuillu Curieux vert émeraude avec deux feuilles et petites pattes
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

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#059669', 5, 7);
  cell.shadedBody(cx, cy, 8.0, 7.2, palette);

  // Tige + double feuille sur la tête
  const stemY = cy - 9;
  const leafSway = frame % 2 === 0 ? 0 : 1;
  cell.rect(cx, stemY, 1, 3, palette.outline);
  cell.rect(cx - 4, stemY - 1 + leafSway, 4, 2, '#10B981');
  cell.dot(cx - 3, stemY - 1 + leafSway, '#A7F3D0');
  cell.rect(cx + 1, stemY - 2, 4, 2, '#10B981');
  cell.dot(cx + 2, stemY - 2, '#A7F3D0');

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#FF8CA3', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_flora_bloom : Floramajesté (vert doré avec grande fleur solaire épanouie sur la tête)
 */
function drawAdultFloraBloom(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#1E3A1E',
    base: '#84CC16',
    shade: '#4D7C0F',
    highlight: '#ECFCCB',
  };

  // Cape de pétales/feuilles dorées sur les côtés
  const petalFlap = frame % 2 === 0 ? 0 : -1;
  cell.rect(cx - 11, cy - 2 + petalFlap, 3, 5, '#65A30D');
  cell.rect(cx - 10, cy - 1 + petalFlap, 2, 3, '#BEF264');
  cell.rect(cx + 8, cy - 2 + petalFlap, 3, 5, '#65A30D');
  cell.rect(cx + 8, cy - 1 + petalFlap, 2, 3, '#BEF264');

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#4D7C0F', 5, 7);
  cell.shadedBody(cx, cy, 8.5, 7.6, palette);

  // Grande fleur solaire épanouie au sommet
  const flowerY = cy - 10;
  // Pétales roses et dorés
  cell.rect(cx - 5, flowerY, 11, 2, '#FB7185');
  cell.rect(cx - 3, flowerY - 2, 7, 4, '#F43F5E');
  // Cœur solaire doré de la fleur
  cell.rect(cx - 2, flowerY - 1, 5, 2, '#FACC15');
  cell.dot(cx, flowerY - 1, '#FEF08A');

  cell.drawFace(cx, cy - 1, state, frame, { cheekColor: '#FB7185', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_flora_raptor : Vélociflore (vert vif et orange, plumes/feuilles aérodynamiques)
 */
function drawAdultFloraRaptor(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#052E16',
    base: '#22C55E',
    shade: '#15803D',
    highlight: '#86EFAC',
  };

  // Queue de vélociraptor feuillue sur le côté
  const tailSway = frame % 2 === 0 ? 0 : -1;
  cell.rect(cx - 12, cy + 2 + tailSway, 4, 3, '#15803D');
  cell.rect(cx - 13, cy + 1 + tailSway, 2, 2, '#F97316');

  // Plumes/feuilles aérodynamiques orange et vert vif sur la tête
  const crestY = cy - 11;
  cell.rect(cx - 5, crestY + 1, 3, 4, '#F97316');
  cell.rect(cx - 1, crestY, 3, 4, '#FB923C');
  cell.rect(cx + 3, crestY + 1, 3, 4, '#F97316');

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#F97316', 5, 7);
  cell.shadedBody(cx, cy, 8.2, 7.6, palette);

  // Bandeau de chasseur sylvestre orange
  cell.rect(cx - 7, cy - 4, 15, 2, '#EA580C');
  cell.rect(cx - 5, cy - 4, 11, 1, '#FDBA74');

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#FB923C', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_flora_truffle : Truffignon (rond couleur noisette/mousse avec chapeau de champignon gourmand)
 */
function drawAdultFloraTruffle(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 9.5, 1.9);

  const palette = {
    outline: '#432818',
    base: '#D6C29F',
    shade: '#A68A64',
    highlight: '#F5EBE0',
  };

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#65A30D', 6, 7);
  cell.shadedBody(cx, cy, 9.2, 7.6, palette);

  // Bavoir mousse & noisette sur le ventre
  cell.rect(cx - 4, cy + 3, 9, 3, '#ECFCCB');
  cell.dot(cx, cy + 4, '#84CC16');

  // Grand chapeau de champignon rouge à pois crème façon toque gourmande
  const capY = cy - 12;
  cell.rect(cx - 6, capY + 2, 13, 3, palette.outline);
  cell.rect(cx - 5, capY, 11, 4, '#E63946');
  cell.rect(cx - 3, capY - 1, 7, 1, '#E63946');
  // Pois blancs/crème du champignon
  cell.rect(cx - 4, capY + 1, 2, 2, '#FFF8E7');
  cell.rect(cx + 2, capY + 1, 2, 2, '#FFF8E7');
  cell.dot(cx, capY, '#FFF8E7');

  cell.drawFace(cx, cy - 1, state, frame, { cheekColor: '#F43F5E', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_flora_thorn : Ronce-Noire (bois sombre et ronces violettes aux yeux ambrés)
 */
function drawAdultFloraThorn(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#120D0A',
    base: '#4A3525',
    shade: '#261C15',
    highlight: '#7F5539',
  };

  // Cornes de ronces violettes au sommet
  const hornY = cy - 10;
  cell.rect(cx - 6, hornY + 1, 2, 3, '#7E22CE');
  cell.dot(cx - 7, hornY, '#C084FC');
  cell.rect(cx + 4, hornY + 1, 2, 3, '#7E22CE');
  cell.dot(cx + 6, hornY, '#C084FC');

  // Ronces/feuilles nocturnes flottantes sur les côtés
  const vineY = cy - 1 + (frame % 2 === 0 ? -1 : 1);
  cell.rect(cx - 11, vineY, 2, 3, '#9333EA');
  cell.dot(cx - 11, vineY - 1, '#4ADE80');
  cell.rect(cx + 9, vineY, 2, 3, '#9333EA');
  cell.dot(cx + 10, vineY - 1, '#4ADE80');

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#7E22CE', 5, 7);
  cell.shadedBody(cx, cy, 8.2, 7.6, palette);

  cell.drawFace(cx, cy, state, frame, {
    eyeColor: '#F59E0B',
    eyeShine: '#FEF08A',
    cheekColor: '#A855F7',
    mouthColor: '#C084FC',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

// ----------------------------------------------------------------------------
// 3.4. LIGNÉE ASTRALE / FLAMME (EMBER)
// ----------------------------------------------------------------------------

/**
 * baby_ember : P'tite Braise orangée/rougeoyante avec flammèche sur la tête
 */
function drawBabyEmber(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#431407',
    base: '#FB923C',
    shade: '#EA580C',
    highlight: '#FDE047',
  };

  const rx = state === 'sleep' ? 9.4 : 8.2;
  const ry = state === 'sleep' ? 6.2 : 7.2;
  cell.shadedBody(cx, cy, rx, ry, palette, 1);

  // Petite flammèche dansante sur la tête
  const topY = Math.round(cy - ry);
  const flicker = frame % 2;
  cell.rect(cx - 1, topY - 3, 3, 3, '#EF4444');
  cell.rect(cx, topY - 4 - flicker, 2, 3, '#FACC15');
  cell.dot(cx, topY - 2, '#FFFBEB');

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#EF4444', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * child_ember : Pyrolynx ardent avec oreilles de flamme et queue étincelante
 */
function drawChildEmber(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 8.5, 1.8);

  const palette = {
    outline: '#450A0A',
    base: '#F97316',
    shade: '#DC2626',
    highlight: '#FEF08A',
  };

  // Queue de flamme étincelante sur le côté droit
  const tailFlicker = frame % 2;
  cell.rect(cx + 8, cy + 1 - tailFlicker, 3, 3, '#EF4444');
  cell.rect(cx + 9, cy - tailFlicker, 2, 2, '#FACC15');

  // Oreilles de lynx ardentes
  const earY = cy - 10;
  cell.rect(cx - 6, earY, 3, 4, palette.outline);
  cell.rect(cx - 5, earY + 1, 2, 2, '#FACC15');
  cell.rect(cx + 3, earY, 3, 4, palette.outline);
  cell.rect(cx + 3, earY + 1, 2, 2, '#FACC15');

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#DC2626', 5, 7);
  cell.shadedBody(cx, cy, 8.0, 7.2, palette);

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#FACC15', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_ember_solar : Solarix (or radieux, couronne solaire et ailes de lumière)
 */
function drawAdultEmberSolar(cell, state, frame) {
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

  // Ailes de lumière célestes sur les côtés
  const wingFlap = frame % 2 === 0 ? 0 : -1;
  cell.rect(cx - 11, cy - 3 + wingFlap, 3, 5, '#FFAE19');
  cell.rect(cx - 10, cy - 2 + wingFlap, 2, 3, '#FFF8D6');
  cell.rect(cx + 8, cy - 3 + wingFlap, 3, 5, '#FFAE19');
  cell.rect(cx + 8, cy - 2 + wingFlap, 2, 3, '#FFF8D6');

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#D97706', 5, 7);
  cell.shadedBody(cx, cy, 8.5, 7.8, palette);

  // Écusson ventral solaire
  cell.rect(cx - 3, cy + 3, 6, 3, '#FFF3B0');

  // Couronne solaire radieuse au sommet
  const crownY = cy - 9;
  cell.rect(cx - 4, crownY, 9, 2, '#FF7B00');
  cell.rect(cx - 3, crownY, 7, 1, '#FFF75E');
  cell.dot(cx - 4, crownY - 1, '#FF7B00');
  cell.dot(cx, crownY - 2, '#FFF75E');
  cell.dot(cx, crownY - 1, '#FF7B00');
  cell.dot(cx + 4, crownY - 1, '#FF7B00');

  cell.drawFace(cx, cy - 1, state, frame, { cheekColor: '#FF6B6B', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_ember_comet : Comète Fulgurante (bleu cosmique et feu doré, traînée d'étoiles)
 */
function drawAdultEmberComet(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 18 + dy;

  cell.groundShadow(16 + dx, 28, 9, 1.8);

  const palette = {
    outline: '#1E1B4B',
    base: '#3B82F6',
    shade: '#1D4ED8',
    highlight: '#93C5FD',
  };

  // Oreilles/ailerons de comète en feu doré
  const earY = cy - 11;
  cell.rect(cx - 6, earY, 3, 5, palette.outline);
  cell.rect(cx - 5, earY + 1, 2, 3, '#FACC15');
  cell.rect(cx + 3, earY, 3, 5, palette.outline);
  cell.rect(cx + 3, earY + 1, 2, 3, '#FACC15');

  // Traînée d'étoiles filantes derrière la comète
  const starShift = frame % 2;
  cell.rect(cx - 12, cy - 1 + starShift, 3, 2, '#FACC15');
  cell.dot(cx - 13, cy - 3 + starShift, '#FEF08A');
  cell.dot(cx + 10, cy - 2 + starShift, '#FACC15');

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#F97316', 5, 7);
  cell.shadedBody(cx, cy, 8.2, 7.6, palette);

  // Bandeau/crête de feu stellaire doré et orange
  cell.rect(cx - 7, cy - 4, 15, 2, '#F97316');
  cell.rect(cx - 5, cy - 4, 11, 1, '#FACC15');

  cell.drawFace(cx, cy, state, frame, { cheekColor: '#FACC15', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_ember_magma : Magma-Chef (rond rouge volcanique chaleureux avec toque de chef)
 */
function drawAdultEmberMagma(cell, state, frame) {
  const { dx, dy } = getMotionOffsets(state, frame);
  const cx = 16 + dx;
  const cy = 19 + dy;

  cell.groundShadow(16 + dx, 28, 9.5, 1.9);

  const palette = {
    outline: '#450A0A',
    base: '#EF4444',
    shade: '#B91C1C',
    highlight: '#FCA5A5',
  };

  drawWalkingFeet(cell, cx, cy, state, frame, palette.outline, '#F97316', 6, 7);
  cell.shadedBody(cx, cy, 9.2, 7.6, palette);

  // Tablier de chef blanc avec petite flamme dorée sur le ventre
  cell.rect(cx - 4, cy + 3, 9, 3, '#FFFFFF');
  cell.rect(cx - 3, cy + 6, 7, 1, '#FDE68A');
  cell.rect(cx - 1, cy + 4, 2, 2, '#F97316');

  // Toque de chef volcanique blanche et bande dorée au sommet
  const hatY = cy - 12;
  cell.rect(cx - 4, hatY, 9, 2, palette.outline);
  cell.rect(cx - 5, hatY + 1, 11, 4, palette.outline);
  cell.rect(cx - 4, hatY + 1, 9, 3, '#FFFFFF');
  cell.rect(cx - 3, hatY + 4, 7, 1, '#F59E0B');

  cell.drawFace(cx, cy - 1, state, frame, { cheekColor: '#FBBF24', eyeSpan: 4 });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
  cell.drawStateEffects(state, frame);
}

/**
 * adult_ember_eclipse : Éclipse Nocturne (violet cosmique sombre, halo d'éclipse et cornes astrales)
 */
function drawAdultEmberEclipse(cell, state, frame) {
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

  // Halo d'éclipse solaire (anneau doré/violet derrière le sommet)
  const haloY = cy - 11;
  cell.rect(cx - 4, haloY, 9, 1, '#F59E0B');
  cell.dot(cx - 5, haloY + 1, '#F59E0B');
  cell.dot(cx + 5, haloY + 1, '#F59E0B');

  // Cornes astrales violettes/lavande
  const hornY = cy - 10;
  cell.rect(cx - 6, hornY + 1, 2, 3, '#9D75E6');
  cell.dot(cx - 7, hornY, '#FACC15');
  cell.rect(cx + 4, hornY + 1, 2, 3, '#9D75E6');
  cell.dot(cx + 6, hornY, '#FACC15');

  // Flammes spectrales cosmiques flottantes
  const wispY = cy - 2 + (frame % 2 === 0 ? -1 : 1);
  cell.rect(cx - 11, wispY, 2, 3, '#8A4FFF');
  cell.dot(cx - 11, wispY - 1, '#FBBF24');
  cell.rect(cx + 9, wispY + 1, 2, 3, '#8A4FFF');
  cell.dot(cx + 10, wispY, '#FBBF24');

  cell.shadedBody(cx, cy, 8.2, 7.6, palette);

  // Base vaporeuse astrale
  for (let i = -6; i <= 6; i += 3) {
    const wave = (frame + Math.abs(i)) % 2;
    cell.rect(cx + i, cy + 6 + wave, 2, 2, '#2F1B52');
  }

  cell.drawFace(cx, cy, state, frame, {
    eyeColor: '#FFB703',
    eyeShine: '#FFF3B0',
    cheekColor: '#9D4EDD',
    mouthColor: '#FBBF24',
    eyeSpan: 4,
  });
  cell.drawNeedPoseOverlay(cx, cy, state, frame, palette);
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
    // 1. Œuf commun
    { id: 'egg', stage: 'egg', stageIndex: 0, lineage: null, name: 'Œuf Mystique' },

    // 2. Lignée Aquatique (aqua)
    { id: 'baby_aqua', stage: 'baby', stageIndex: 1, lineage: 'aqua', name: "P'tit Goutte" },
    { id: 'child_aqua', stage: 'child', stageIndex: 2, lineage: 'aqua', name: 'Ondine Vive' },
    { id: 'adult_aqua_coral', stage: 'adult', stageIndex: 3, lineage: 'aqua', name: 'Corallia' },
    { id: 'adult_aqua_leviathan', stage: 'adult', stageIndex: 3, lineage: 'aqua', name: 'Léviathan Azur' },
    { id: 'adult_aqua_pearl', stage: 'adult', stageIndex: 3, lineage: 'aqua', name: 'Perle Gourmande' },
    { id: 'adult_aqua_abyss', stage: 'adult', stageIndex: 3, lineage: 'aqua', name: 'Abyssal' },

    // 3. Lignée Sylvestre (flora)
    { id: 'baby_flora', stage: 'baby', stageIndex: 1, lineage: 'flora', name: "P'tit Bourgeon" },
    { id: 'child_flora', stage: 'child', stageIndex: 2, lineage: 'flora', name: 'Feuillu Curieux' },
    { id: 'adult_flora_bloom', stage: 'adult', stageIndex: 3, lineage: 'flora', name: 'Floramajesté' },
    { id: 'adult_flora_raptor', stage: 'adult', stageIndex: 3, lineage: 'flora', name: 'Vélociflore' },
    { id: 'adult_flora_truffle', stage: 'adult', stageIndex: 3, lineage: 'flora', name: 'Truffignon' },
    { id: 'adult_flora_thorn', stage: 'adult', stageIndex: 3, lineage: 'flora', name: 'Ronce-Noire' },

    // 4. Lignée Astrale / Flamme (ember)
    { id: 'baby_ember', stage: 'baby', stageIndex: 1, lineage: 'ember', name: "P'tite Braise" },
    { id: 'child_ember', stage: 'child', stageIndex: 2, lineage: 'ember', name: 'Pyrolynx' },
    { id: 'adult_ember_solar', stage: 'adult', stageIndex: 3, lineage: 'ember', name: 'Solarix' },
    { id: 'adult_ember_comet', stage: 'adult', stageIndex: 3, lineage: 'ember', name: 'Comète Fulgurante' },
    { id: 'adult_ember_magma', stage: 'adult', stageIndex: 3, lineage: 'ember', name: 'Magma-Chef' },
    { id: 'adult_ember_eclipse', stage: 'adult', stageIndex: 3, lineage: 'ember', name: 'Éclipse Nocturne' },
  ];

  // 1. Générer les 19 spritesheets PNG (256x512)
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
    version: 2,
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
