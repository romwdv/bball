/**
 * Génération des icônes de la PWA.
 *
 * Aucune dépendance, et c'est un choix. Les outils habituels — ImageMagick,
 * `sharp`, un convertisseur SVG — sont des binaires natifs ou des paquets lourds
 * qui cassent selon la plateforme : sur le VPS de build, sur un Mac en M1, sur
 * une CI Linux, le résultat n'est pas le même. Ici le PNG est écrit octet par
 * octet à partir de `node:zlib`, qui est partout. Le fichier est relisible, donc
 * une icône bizarre se corrige ici plutôt que dans un binaire opaque.
 *
 * ```
 * node scripts/make-icons.mjs
 * ```
 *
 * Le dessin est **procédural**, pas vectoriel : un ballon de basket est un
 * cercle, un fond et trois coutures, ce qui se calcule exactement par pixel.
 * Un SVG aurait exigé un moteur de rendu.
 *
 * Les icônes sont volontairement régénérées plutôt que versionnées en binaire :
 * `pnpm build` appelle ce script, donc l'icône ne peut pas diverger du thème.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** Thème dark de `globals.css`, redonné ici : le script ne doit pas lire le CSS. */
const SURFACE = [0x0b, 0x0f, 0x14];
/** Accent de l'application. Un ballon bleu plutôt qu'orange : cohérent avec le
 *  header et les boutons, et lisible en monochrome sur l'écran d'accueil iOS. */
const BALL = [0x3d, 0x8b, 0xfd];
/** Coutures : la surface, pas du noir — sur fond dark, un trait noir disparaît. */
const SEAM = [0x0b, 0x0f, 0x14];

/**
 * Rayon du fond arrondi, en fraction du côté.
 *
 * iOS applique lui-même son propre masque (superellipse) à `apple-touch-icon`.
 * Ce rayon ne concerne donc que les autres surfaces, et 22 % correspond au
 * standard Material, que reconnaissent d'un coup d'œil les utilisateurs d'Android.
 */
const CORNER = 0.22;

/**
 * Ballon : rayon en fraction du côté, et centre.
 *
 * `BALL_SCALE` de 0.72 sur les icônes classiques laisse respirer le ballon ;
 * le maskable descend à 0.58, car Android rogne jusqu'à 20 % de chaque bord sur
 * un cercle — un ballon à 72 % serait amputé.
 */
const BALL_SCALE = 0.72;
const MASKABLE_BALL_SCALE = 0.58;

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

/** CRC-32, table calculée une fois. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG signé : longueur, type, données, CRC — dans cet ordre, sinon refus. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode un buffer RGBA en PNG.
 *
 * Chaque ligne est préfixée par son type de filtre — `0`, aucun — puis compressée
 * en zlib. Sans le préfixe, le décodeur n'a pas d'endroit où lire la largeur, et
 * beaucoup d'implémentations le refusent.
 */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  // La signature PNG, puis le premier chunk IHDR.
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // 8 bits par canal
  header.writeUInt8(6, 9); // RGBA
  header.writeUInt8(0, 10); // compression : deflate
  header.writeUInt8(0, 11); // filtre : adaptatif
  header.writeUInt8(0, 12); // pas d'entrelacement

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * ICO contenant des images PNG.
 *
 * Windows et Safari acceptent ce format depuis Vista / iOS 8, et il évite d'écrire
 * un décodeur BMP pour les petites tailles. Une entrée = un PNG complet.
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // 0 : icône
  header.writeUInt16LE(1, 2); // 1 : image PNG
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    // Une dimension de 256 ne tient pas sur un octet : la valeur 0 signifie
    // 256 par convention. Sans cela, l'icône 256 serait annoncée comme nulle.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2); // couleurs du palier
    directory.writeUInt8(0, at + 3); // réservé
    directory.writeUInt16LE(1, at + 4); // plan couleur
    directory.writeUInt16LE(32, at + 6); // bits par pixel
    directory.writeUInt32BE(0, at + 8);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([
    header,
    directory,
    ...entries.map((entry) => entry.data),
  ]);
}

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

/**
 * Super-échantillonnage : 4×4 par pixel de sortie.
 *
 * Un cercle tracé à une résolution de 192 px a un contour en escalier visible.
 * Moyennant 16 échantillons par pixel, le bord est lisse à l'œil — c'est la
 * seule façon d'avoir un antialiasing correct sans moteur de rendu.
 */
const SAMPLES = 4;

/** Un point est-il dans un disque ? */
function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Coutures du ballon, en coordonnées **normalisées** (1 = rayon du ballon).
 *
 * Le calcul se fait dans ce repère et non en pixels, sinon les trois coutures
 * n'auraient pas la même épaisseur d'une taille à l'autre : à 512 px une couture
 * de 0,003 px est invisible, à 32 px elle mange le ballon entier.
 *
 * Les trois coutures d'un ballon de basket sont une ligne horizontale et deux
 * arcs verticaux. Chaque arc est une circonférence passant par le haut (0, -1) et
 * le bas (0, 1) du ballon, donc de centre (±ARC_OFFSET, 0) et de rayon
 * `sqrt(1 + ARC_OFFSET²)` — d'où la constante. Le décalage de 0,6 donne la
 * courbure usuelle : les arcs 'écartent vers les bords plutôt que de se coller à
 * l'axe.
 */
const ARC_OFFSET = 0.6;
const ARC_RADIUS = Math.sqrt(1 + ARC_OFFSET * ARC_OFFSET);

/** Épaisseur d'une couture, en fraction du rayon du ballon. */
const SEAM_WIDTH = 0.055;

/**
 * Distance d'un point — en coordonnées normalisées — à la couture la plus proche.
 *
 * Distance signée, donc l'appelant peut l'élargir selon l'échelle. Valeur nulle
 * sur une couture, croissante jusqu'à mi-chemin entre deux coutures.
 */
function distanceToSeam(x, y) {
  // Couture horizontale, passant par le centre.
  const horizontal = Math.abs(y);

  // Coutures verticales : distance à une circonférence = distance au centre moins
  // le rayon.
  //
  // Les deux centres sont testés, `+ARC_OFFSET` et `-ARC_OFFSET`. Un seul suffirait
  // si l'on avait le droit de ne garder que la moitié du ballon, mais ce serait un
  // ballon à deux coutures au lieu de trois — et un ballon de basket en a bien
  // trois. Un seul calcul donnerait un tracé asymétrique, immédiatement visible
  // sur une icône carrée.
  const rightArc = Math.abs(Math.hypot(x - ARC_OFFSET, y) - ARC_RADIUS);
  const leftArc = Math.abs(Math.hypot(x + ARC_OFFSET, y) - ARC_RADIUS);

  return Math.min(horizontal, rightArc, leftArc);
}

/**
 * Rend une icône.
 *
 * @param size côté en pixels
 * @param scale rayon du ballon, en fraction du côté
 * @param rounded fond arrondi, ou `false` pour un fond plein (maskable)
 */
function renderIcon(size, scale, rounded) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / SAMPLES;
  const offset = step / 2;

  const cornerRadius = rounded ? size * CORNER : 0;
  const center = size / 2;
  const ballRadius = (size * scale) / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = px + offset + sx * step;
          const y = py + offset + sy * step;

          // Couleur du fond. Le fond arrondi est mesuré sur les quatre coins :
          // le plus proche d'un centre d'arrondi décide, sinon les bords
          // vibreraient d'un pixel à l'autre.
          let inside = true;
          if (rounded) {
            const dx = Math.max(
              Math.abs(x - center) - (center - cornerRadius),
              0,
            );
            const dy = Math.max(
              Math.abs(y - center) - (center - cornerRadius),
              0,
            );
            inside = Math.hypot(dx, dy) <= cornerRadius;
          }

          let pixel;
          if (!inside) {
            pixel = [0, 0, 0, 0];
          } else if (inCircle(x, y, center, center, ballRadius)) {
            // Coutures : le point est ramené dans le repère du ballon, puis
            // l'écart au tracé le plus proche est comparé à la demi-épaisseur.
            // Les pixels à cheval sur le contour sont tranchés par le
            // super-échantillonnage, pas adoucis par un calcul de distance.
            const seam = distanceToSeam(
              (x - center) / ballRadius,
              (y - center) / ballRadius,
            );
            pixel =
              seam <= SEAM_WIDTH / 2
                ? [SEAM[0], SEAM[1], SEAM[2], 255]
                : [BALL[0], BALL[1], BALL[2], 255];
          } else {
            pixel = [SURFACE[0], SURFACE[1], SURFACE[2], 255];
          }

          // Moyenne non prémultipliée : les échantillons transparents
          // ramenés vers le noir sont invisibles une fois la couche posée.
          r += pixel[0];
          g += pixel[1];
          b += pixel[2];
          a += pixel[3];
        }
      }

      const total = SAMPLES * SAMPLES;
      const at = (py * size + px) * 4;
      rgba.writeUInt8(Math.round(r / total), at);
      rgba.writeUInt8(Math.round(g / total), at + 1);
      rgba.writeUInt8(Math.round(b / total), at + 2);
      rgba.writeUInt8(Math.round(a / total), at + 3);
    }
  }

  return encodePng(size, size, rgba);
}

// ---------------------------------------------------------------------------
// Sortie
// ---------------------------------------------------------------------------

/** `true` = fond plein, exigé par maskable. */
const ICONS = [
  { file: "icon-192.png", size: 192, scale: BALL_SCALE, rounded: true },
  { file: "icon-512.png", size: 512, scale: BALL_SCALE, rounded: true },
  {
    file: "icon-maskable-512.png",
    size: 512,
    scale: MASKABLE_BALL_SCALE,
    rounded: false,
  },
  {
    file: "apple-touch-icon.png",
    size: 180,
    scale: BALL_SCALE,
    rounded: false,
  },
];

const OUT = join(ROOT, "public", "icons");
mkdirSync(OUT, { recursive: true });

for (const icon of ICONS) {
  const png = renderIcon(icon.size, icon.scale, icon.rounded);
  writeFileSync(join(OUT, icon.file), png);
  console.log(`${icon.file}  ${icon.size}×${icon.size}  ${png.length} o`);
}

// Le favicon est un ICO multi-tailles : 16 pour les onglets, 32 pour le bureau,
// 48 pour le gestionnaire de fichiers de Windows. Un seul 32 fait un pixel
// illisible dans un onglet.
const ICO_SIZES = [16, 32, 48];
const ico = encodeIco(
  ICO_SIZES.map((size) => ({
    size,
    data: renderIcon(size, BALL_SCALE, true),
  })),
);
writeFileSync(join(ROOT, "src", "app", "favicon.ico"), ico);
console.log(`favicon.ico  ${ICO_SIZES.join("/")}  ${ico.length} o`);
