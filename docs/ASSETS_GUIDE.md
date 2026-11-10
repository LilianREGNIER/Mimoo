# Guide des Assets Graphiques (`ASSETS_GUIDE.md`)

Ce document détaille la spécification technique des spritesheets, des icônes et du manifeste graphique du **Desktop Pet (Tamagotchi Windows)**, couvrant les **19 formes** (l'Œuf mystique + les **3 lignées d'évolution complètes** : *Aquatique*, *Sylvestre* et *Astrale / Flamme*) ainsi que les **8 lignes d'animation** incluant les animations de besoins (`hungry`, `need_cuddle`).

---

## 1. Spécification Technique des Spritesheets

Chaque stade d'évolution ou forme adulte possède sa propre feuille de sprites (*spritesheet*) située dans `assets/sprites/<formId>.png`.

| Propriété | Valeur requise |
| :--- | :--- |
| **Format de fichier** | PNG RGBA 32-bits (8 bits par canal : R, G, B, Alpha) |
| **Fond** | 100 % transparent (`rgba(0, 0, 0, 0)`, canal `alpha = 0`) |
| **Dimensions totales** | **`256 × 512` pixels** |
| **Dimensions d'une cellule (frame)** | **`64 × 64` pixels** |
| **Grille** | **4 colonnes** (frames `0` à `3`) × **8 lignes** (états d'animation `0` à `7`) |
| **Rendu CSS / Canvas** | `image-rendering: pixelated` (aucun flou bilinéaire lors du redimensionnement) |
| **Ligne de sol recommandée** | Environ `y = 54..58` px dans chaque cellule de `64 × 64` px (laisse `6..10` px en bas pour l'ombre portée) |

### Schéma de découpage d'une cellule `(col, row)`

Pour une colonne `col ∈ [0..3]` et une ligne `row ∈ [0..7]`, le rectangle source dans l'image `256 × 512` est :
- `sourceX = col * 64`
- `sourceY = row * 64`
- `sourceWidth = 64`
- `sourceHeight = 64`

---

## 2. Tableau des 8 Lignes d'Animation et des 4 Frames

Chaque spritesheet `256 × 512` px est organisée selon l'ordre strict suivant des **8 lignes d'états d'animation** :

| Ligne (`row`) | État (`state`) | Coordonnée `Y` (px) | Description de l'animation sur les 4 colonnes (`col = 0..3`) |
| :---: | :--- | :---: | :--- |
| **Ligne 0** | `idle` | `0 .. 63` | **Repos / Respiration** : léger rebond vertical calme sur place. **Spécificité `egg`** : les frames `0..3` montrent l'œuf intact (`col = 0`), puis de plus en plus fendillé (`col = 1..2`), jusqu'aux grandes fissures lumineuses annonçant l'éclosion (`col = 3`). |
| **Ligne 1** | `walk` | `64 .. 127` | **Marche / Déplacement** : cycle de marche dynamique gauche/droite en 4 temps avec alternance pied gauche / pied droit (retourné horizontalement par le moteur selon la direction). |
| **Ligne 2** | `eat` | `128 .. 191` | **Repas (`Miam`)** : bouche grande ouverte et mâchouillement en alternance avec aliment croqué, petites miettes et étoiles de délice. |
| **Ligne 3** | `happy` | `192 .. 255` | **Joie / Caresse** : saut de joie dynamique, yeux rieurs en arc (`^ ^`), petit cœur flottant et étoiles scintillantes. |
| **Ligne 4** | `sleep` | `256 .. 319` | **Sommeil** : posture allongée ou assoupie, yeux fermés paisibles et bulles `"Zzz"` qui s'élèvent progressivement sur les frames `0` à `3`. |
| **Ligne 5** | `sad` | `320 .. 383` | **Triste / Propreté ou Moral critique** : mine abattue ou tremblante, regard triste, petite larme et grosse goutte de sueur descendante. |
| **Ligne 6** | `hungry` | `384 .. 447` | **Faim (`Besoin de repas`)** : le compagnon se tient le ventre qui gargouille (ondes vibrantes sur les côtés), bouche tremblante, sourcils inquiets et bulle de faim (cuisse rôtie) flottante. |
| **Ligne 7** | `need_cuddle` | `448 .. 511` | **Besoin de câlin / jeu (`need_cuddle` / `need_play`)** : petits bras tendus vers l'utilisateur, sautillement d'appel enthousiaste, très grands yeux brillants suppliants (double reflet), bouche en `w` et icônes cœur + balle de jeu. |

### Détail des 4 Colonnes (Frames par ligne)

| Colonne (`col`) | Coordonnée `X` (px) | Rôle dans le cycle |
| :---: | :---: | :--- |
| **Frame 0** | `0 .. 63` | Pose clé initiale (contact / œuf intact sur `egg.idle`) |
| **Frame 1** | `64 .. 127` | Extension / anticipation haute (ou première fissure sur `egg.idle`) |
| **Frame 2** | `128 .. 191` | Pose clé médiane / retour (ou fissure médiane sur `egg.idle`) |
| **Frame 3** | `192 .. 255` | Amorti / fin de cycle (ou grandes fissures lumineuses d'éclosion sur `egg.idle`) |

---

## 3. Liste des 19 Formes par Stade et par Lignée

### 3.1. Stade 0 — Œuf Commun (`egg`)

| Fichier | Identifiant (`formId`) | Archétype (`bodyArchetype`) | Nom | Description morphologique |
| :--- | :--- | :--- | :--- | :--- |
| `assets/sprites/egg.png` | `egg` | `mystic_egg` | **Œuf Mystique** | Œuf crème aux taches dorées, émeraude et azur dont la coquille se fendille progressivement sur les frames `0..3` de la ligne `idle`. |

### 3.2. Lignée Aquatique (`aqua`) — 6 Formes

| Fichier | Identifiant (`formId`) | Stade | Archétype (`bodyArchetype`) | Nom | Description morphologique (façon Tamagotchi) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `assets/sprites/baby_aqua.png` | `baby_aqua` | Stade 1 (Bébé) | `droplet_slime` | **P'tit Goutte** | Vraie goutte d'eau pointue au sommet et plate/évasée à la base (sans jambes), grands yeux ronds liquides et reflets aquatiques. |
| `assets/sprites/child_aqua.png` | `child_aqua` | Stade 2 (Enfant) | `axolotl_tadpole` | **Ondine Vive** | Corps amphibien large d'axolotl à 3 branchies externes déployées de chaque côté des joues et grande queue de têtard/sirène ondulante. |
| `assets/sprites/adult_aqua_coral.png` | `adult_aqua_coral` | Stade 3 (Adulte) | `sea_angel` | **Corallia** | Silhouette haute, fine et élancée d'ange des mers / sirène avec deux grandes nageoires-voiles diaphanes latérales et couronne de corail. |
| `assets/sprites/adult_aqua_leviathan.png` | `adult_aqua_leviathan` | Stade 3 (Adulte) | `serpent_dragon` | **Léviathan Azur** | Long corps sinueux en **S vertical** (façon *Nyorotchi*), tête de dragon marin en haut, ventre strié et crête dorsale cyan/or. |
| `assets/sprites/adult_aqua_pearl.png` | `adult_aqua_pearl` | Stade 3 (Adulte) | `octopus` | **Perle Gourmande** | Tête en dôme nacré (façon *Takotchi*) avec **6 tentacules recourbés et animés** en bas, bouche en ventouse et grosse perle brillante sur le front. |
| `assets/sprites/adult_aqua_abyss.png` | `adult_aqua_abyss` | Stade 3 (Adulte) | `anglerfish` | **Abyssal** | Silhouette large et trapue de baudroie des abysses avec grande bouche à petites dents blanches et longue antenne-lanterne bioluminescente pendante. |

### 3.3. Lignée Sylvestre (`flora`) — 6 Formes

| Fichier | Identifiant (`formId`) | Stade | Archétype (`bodyArchetype`) | Nom | Description morphologique (façon Tamagotchi) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `assets/sprites/baby_flora.png` | `baby_flora` | Stade 1 (Bébé) | `bulb_quadruped` | **P'tit Bourgeon** | Corps en forme de petit navet/bulbe trapu marchant sur **4 petites pattes-racines**, grands yeux curieux et double feuille latérale. |
| `assets/sprites/child_flora.png` | `child_flora` | Stade 2 (Enfant) | `biped_dino` | **Feuillu Curieux** | Petit dinosaure bipède debout, museau dessiné, ventre clair strié, queue dressée et grande feuille-parasol au-dessus de la tête. |
| `assets/sprites/adult_flora_bloom.png` | `adult_flora_bloom` | Stade 3 (Adulte) | `mametchi_ears` | **Floramajesté** | Personnage bipède bien proportionné (façon *Mametchi* / *Mimitchi*) avec deux grandes oreilles dressées, bras et jambes distincts, torse bicolore et grande fleur épanouie. |
| `assets/sprites/adult_flora_raptor.png` | `adult_flora_raptor` | Stade 3 (Adulte) | `raptor_bird` | **Vélociflore** | Oiseau-raptor coureur à longues pattes musclées, bec crochu jaune, crête de plumes orange et ailes-feuilles. |
| `assets/sprites/adult_flora_truffle.png` | `adult_flora_truffle` | Stade 3 (Adulte) | `kuchipatchi_mushroom` | **Truffignon** | Silhouette très dodue en poire (façon *Kuchipatchi*) avec gros bec/lèvres épaisses et immense chapeau de champignon rouge tacheté dépassant largement de la tête. |
| `assets/sprites/adult_flora_thorn.png` | `adult_flora_thorn` | Stade 3 (Adulte) | `carnivorous_vine` | **Ronce-Noire** | Tige serpentine épineuse sortant d'un pot/racines en bas (façon *Kusatchi*), grande tête à collerette dentelée verte/pourpre et cornes de ronces. |

### 3.4. Lignée Astrale / Flamme (`ember`) — 6 Formes

| Fichier | Identifiant (`formId`) | Stade | Archétype (`bodyArchetype`) | Nom | Description morphologique (façon Tamagotchi) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `assets/sprites/baby_ember.png` | `baby_ember` | Stade 1 (Bébé) | `star_spirit` | **P'tite Braise** | Silhouette en **étoile à 5 branches / flammèche flottante** (sans pieds, lévite au-dessus du sol) avec des yeux obliques ardents. |
| `assets/sprites/child_ember.png` | `child_ember` | Stade 2 (Enfant) | `winged_comet` | **Pyrolynx** | Corps de lynx/comète ailée avec **deux ailes de feu latérales bien visibles**, grandes oreilles pointues et queue de braise. |
| `assets/sprites/adult_ember_solar.png` | `adult_ember_solar` | Stade 3 (Adulte) | `phoenix` | **Solarix** | Silhouette majestueuse de **Phénix aux grandes ailes dorées déployées** sur toute la largeur (`60 px`), serres d'oiseau, bec doré et couronne solaire. |
| `assets/sprites/adult_ember_comet.png` | `adult_ember_comet` | Stade 3 (Adulte) | `mecha_star` | **Comète Fulgurante** | Silhouette angulaire et robotique (façon *Robot* / *Masktchi*) avec **casque à visière néon cyan**, épaulières dorées et propulseurs latéraux. |
| `assets/sprites/adult_ember_magma.png` | `adult_ember_magma` | Stade 3 (Adulte) | `lava_golem` | **Magma-Chef** | Silhouette **trapézoïdale massive de Golem de roche et lave**, gros bras musclés sur les côtés, fissures incandescentes sur le torse et cratère volcanique fumant sur la tête. |
| `assets/sprites/adult_ember_eclipse.png` | `adult_ember_eclipse` | Stade 3 (Adulte) | `phantom_bat` | **Éclipse Nocturne** | Fantôme/chauve-souris cosmique (façon *Devilgotchi*) à **cape déchiquetée flottante** (sans jambes), grandes ailes de chauve-souris, cornes en croissant de lune et halo d'éclipse. |

### 3.5. Manifeste et Icônes (`assets/sprites/` & `assets/icons/`)

| Fichier | Dimensions | Usage |
| :--- | :---: | :--- |
| `assets/sprites/sprites-manifest.json` | — | Manifeste JSON décrivant la grille `256 × 512` (`4` colonnes × `8` lignes) et répertoriant les 19 formes. |
| `assets/icons/tray-icon.png` | `32 × 32` px (RGBA) | Icône de la zone de notification Windows (*System Tray*), avec contour contrasté lisible sur barre des tâches claire ou sombre. |
| `assets/icons/app-icon.png` | `256 × 256` px (RGBA) | Icône haute résolution de l'application (coque Tamagotchi en pixel-art). |
| `assets/icons/app-icon.ico` | `256 × 256` px (ICO) | Conteneur ICO Windows natif encapsulant le PNG `256 × 256` pour l'exécutable Electron / `electron-builder`. |

---

## 4. Comment Remplacer un Visuel Existant

Pour remplacer l'apparence d'un stade ou d'une forme existante (par exemple `adult_aqua_coral`) :

1. Dans votre logiciel de pixel-art (Aseprite, LibreSprite, Piskel, Photoshop, etc.), créez un canevas de **`256 × 512` pixels** avec fond **transparent**.
2. Activez une grille de **`64 × 64` pixels** (4 colonnes × 8 lignes).
3. Dessinez vos 4 frames pour chacune des 8 lignes dans l'ordre (`idle`, `walk`, `eat`, `happy`, `sleep`, `sad`, `hungry`, `need_cuddle`).
4. Exportez le fichier en **PNG 32-bits RGBA** sous le nom exact dans `assets/sprites/<formId>.png` (ex. `assets/sprites/adult_aqua_coral.png`).
5. Relancez l'application : le nouveau sprite est immédiatement chargé sans aucune modification de code.

---

## 5. Comment Ajouter une Nouvelle Forme (Data-Driven)

L'architecture du projet est pilotée par les données (*data-driven*). Vous pouvez ajouter une nouvelle forme (par exemple `adult_aqua_kraken`) **sans toucher au code TypeScript** :

1. Placez votre feuille de sprites `256 × 512` px (grille `4 × 8` de cellules `64 × 64` px) dans `assets/sprites/adult_aqua_kraken.png`.
2. Déclarez la forme et ses conditions d'évolution dans `data/species.json` avec `"spriteSheet": "sprites/adult_aqua_kraken.png"`.
3. Référencez la forme dans `assets/sprites/sprites-manifest.json`.

---

## 6. Régénérer les 19 Assets Placeholders par Défaut

Pour régénérer par script les 19 spritesheets `256 × 512` px, le manifeste `sprites-manifest.json` et les icônes :

```bash
node scripts/generate-placeholders.mjs
```

Ce script autonome utilise uniquement les modules natifs Node.js (`node:fs`, `node:path`, `node:zlib`) et régénère l'intégralité du dossier `assets/sprites/` et `assets/icons/`.
