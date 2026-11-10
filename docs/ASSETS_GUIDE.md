# Guide des Assets Graphiques (`ASSETS_GUIDE.md`)

Ce document détaille la spécification technique des spritesheets, des icônes et du manifeste graphique du **Desktop Pet (Tamagotchi Windows)**, ainsi que la procédure pas-à-pas pour remplacer un visuel existant ou ajouter une nouvelle forme d'évolution **sans modifier une seule ligne de code TypeScript**.

---

## 1. Spécification Technique des Spritesheets

Chaque stade d'évolution ou forme adulte possède sa propre feuille de sprites (*spritesheet*) située dans `assets/sprites/<formId>.png`.

| Propriété | Valeur requise |
| :--- | :--- |
| **Format de fichier** | PNG RGBA 32-bits (8 bits par canal : R, G, B, Alpha) |
| **Fond** | 100 % transparent (`rgba(0, 0, 0, 0)`, canal `alpha = 0`) |
| **Dimensions totales** | **`256 × 384` pixels** |
| **Dimensions d'une cellule (frame)** | **`64 × 64` pixels** |
| **Grille** | **4 colonnes** (frames `0` à `3`) × **6 lignes** (états d'animation `0` à `5`) |
| **Rendu CSS / Canvas** | `image-rendering: pixelated` (aucun flou bilinéaire lors du redimensionnement) |
| **Ligne de sol recommandée** | Environ `y = 54..58` px dans chaque cellule de `64 × 64` px (laisse `6..10` px en bas pour l'ombre portée) |

### Schéma de découpage d'une cellule `(col, row)`

Pour une colonne `col ∈ [0..3]` et une ligne `row ∈ [0..5]`, le rectangle source dans l'image `256 × 384` est :
- `sourceX = col * 64`
- `sourceY = row * 64`
- `sourceWidth = 64`
- `sourceHeight = 64`

---

## 2. Tableau des 6 Lignes d'Animation et des 4 Frames

Chaque spritesheet `256 × 384` px est organisée selon l'ordre strict suivant des 6 lignes d'états d'animation :

| Ligne (`row`) | État (`state`) | Coordonnée `Y` (px) | Description de l'animation sur les 4 colonnes (`col = 0..3`) |
| :---: | :--- | :---: | :--- |
| **Ligne 0** | `idle` | `0 .. 63` | **Repos / Respiration** : léger rebond vertical ou oscillation calme sur place (Frame 0 : neutre, Frame 1 : haute, Frame 2 : neutre, Frame 3 : basse). |
| **Ligne 1** | `walk` | `64 .. 127` | **Marche / Déplacement** : cycle de marche en 4 temps avec alternance pied gauche / pied droit (retourné horizontalement par le moteur selon la direction). |
| **Ligne 2** | `eat` | `128 .. 191` | **Repas (`Miam`)** : bouche ouverte et fermée en alternance avec aliment croqué, petites miettes et étoiles de satisfaction. |
| **Ligne 3** | `happy` | `192 .. 255` | **Joie / Jeu / Caresse** : bond joyeux, yeux rieurs en arc (`^ ^`), petit cœur flottant et étincelles. |
| **Ligne 4** | `sleep` | `256 .. 319` | **Sommeil** : posture allongée ou assoupie, yeux fermés paisibles et bulles `"Zzz"` qui s'élèvent progressivement sur les frames `0` à `3`. |
| **Ligne 5** | `sad` | `320 .. 383` | **Triste / Faim ou Propreté critique** : posture abattue ou tremblante, regard triste et goutte de sueur/larme descendante. |

### Détail des 4 Colonnes (Frames par ligne)

| Colonne (`col`) | Coordonnée `X` (px) | Rôle dans le cycle |
| :---: | :---: | :--- |
| **Frame 0** | `0 .. 63` | Pose clé initiale (contact / début du cycle) |
| **Frame 1** | `64 .. 127` | Extension / anticipation haute (ou bouche ouverte sur `eat`) |
| **Frame 2** | `128 .. 191` | Pose clé médiane / retour |
| **Frame 3** | `192 .. 255` | Amorti / fin de cycle bouclant fluidement vers la Frame 0 |

---

## 3. Liste des Fichiers par Stade et par Forme

### 3.1. Feuilles de Sprites (`assets/sprites/`)

| Fichier | Identifiant (`formId`) | Stade | Description visuelle |
| :--- | :--- | :--- | :--- |
| `assets/sprites/egg.png` | `egg` | **Stade 0 — Œuf** | Œuf couleur crème tacheté de vert émeraude et d'or qui oscille doucement et se fendille de joie avant l'éclosion. |
| `assets/sprites/baby_blob.png` | `baby_blob` | **Stade 1 — Bébé** | Petit slime/goutte turquoise rebondissant avec de grands yeux brillants et des joues roses. |
| `assets/sprites/child_sprout.png` | `child_sprout` | **Stade 2 — Enfant** | Créature vert tendre curieuse dotée de petites pattes et d'une double feuille sur le sommet de la tête. |
| `assets/sprites/adult_solar.png` | `adult_solar` | **Stade 3 — Adulte (Solaire)** | Forme radieuse dorée obtenue par des soins réguliers et équilibrés, portant une couronne solaire et de petites ailes célestes. |
| `assets/sprites/adult_athletic.png` | `adult_athletic` | **Stade 3 — Adulte (Athlétique)** | Forme vive bleu électrique et orange obtenue par beaucoup de jeu et d'exercice, avec oreilles dressées et bandeau sportif. |
| `assets/sprites/adult_gourmet.png` | `adult_gourmet` | **Stade 3 — Adulte (Gourmet)** | Forme ronde couleur pêche/fraise obtenue par la gastronomie et les friandises, portant une toque de chef et un bavoir. |
| `assets/sprites/adult_shadow.png` | `adult_shadow` | **Stade 3 — Adulte (Ombre)** | Forme nocturne violette mystérieuse (liée aux erreurs de soin ou au mode nocturne) avec yeux ambrés lumineux, petites cornes et flammes spectrales. |
| `assets/sprites/sprites-manifest.json` | — | **Manifeste** | Décrit les dimensions de la grille (`64x64`, `4` colonnes, `6` lignes) et la table de correspondance des formes. |

### 3.2. Icônes Système et Application (`assets/icons/`)

| Fichier | Dimensions | Usage |
| :--- | :---: | :--- |
| `assets/icons/tray-icon.png` | `32 × 32` px (RGBA) | Icône de la zone de notification Windows (*System Tray*), avec contour contrasté lisible sur barre des tâches claire ou sombre. |
| `assets/icons/app-icon.png` | `256 × 256` px (RGBA) | Icône haute résolution de l'application (coque Tamagotchi en pixel-art). |
| `assets/icons/app-icon.ico` | `256 × 256` px (ICO) | Conteneur ICO Windows natif encapsulant le PNG `256 × 256` pour l'exécutable Electron / `electron-builder`. |

---

## 4. Comment Remplacer un Visuel Existant

Pour remplacer l'apparence d'un stade ou d'une forme existante (par exemple `adult_solar`) :

1. Dans votre logiciel de pixel-art (Aseprite, LibreSprite, Piskel, Photoshop, etc.), créez un canevas de **`256 × 384` pixels** avec fond **transparent**.
2. Activez une grille de **`64 × 64` pixels** (4 colonnes × 6 lignes).
3. Dessinez vos 4 frames pour chacune des 6 lignes dans l'ordre (`idle`, `walk`, `eat`, `happy`, `sleep`, `sad`).
4. Exportez le fichier en **PNG 32-bits RGBA** sous le nom exact dans `assets/sprites/<formId>.png` (ex. `assets/sprites/adult_solar.png`).
5. Relancez l'application : le nouveau sprite est immédiatement chargé sans aucune modification de code.

---

## 5. Comment Ajouter une Toute Nouvelle Forme Adulte (Data-Driven)

L'architecture du projet est pilotée par les données (*data-driven*). Vous pouvez ajouter une nouvelle forme adulte (par exemple `adult_cyber`) **sans toucher au code TypeScript** :

### Étape 1 : Ajouter la spritesheet PNG
Placez votre feuille de sprites `256 × 384` px (grille `4 × 6` de cellules `64 × 64` px) dans :
```text
assets/sprites/adult_cyber.png
```

### Étape 2 : Déclarer la forme dans `data/species.json`
Ouvrez `data/species.json` et ajoutez l'entrée de votre nouvelle forme adulte (avec son chemin de sprite `assets/sprites/adult_cyber.png` et ses conditions d'évolution) dans la liste des formes adultes / règles d'évolution :
```json
{
  "id": "adult_cyber",
  "name": "Adulte Cyber",
  "stage": "adult",
  "sprite": "assets/sprites/adult_cyber.png",
  "conditions": {
    "minHappiness": 80,
    "minDiscipline": 70
  }
}
```

### Étape 3 : (Optionnel) Référencer la forme dans `assets/sprites/sprites-manifest.json`
Ajoutez l'entrée `"adult_cyber": "assets/sprites/adult_cyber.png"` dans l'objet `sprites` et dans le tableau `forms` de `assets/sprites/sprites-manifest.json`.

---

## 6. Régénérer les Assets Placeholders par Défaut

Si vous souhaitez restaurer ou modifier par script les spritesheets placeholders et les icônes :

```bash
node scripts/generate-placeholders.mjs
```

Ce script autonome utilise uniquement les modules natifs Node.js (`node:fs`, `node:path`, `node:zlib`) et régénère l'intégralité du dossier `assets/sprites/` et `assets/icons/`.
