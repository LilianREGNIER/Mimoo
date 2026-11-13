# Mimoo — Desktop Pet (Windows 10/11)

Un compagnon virtuel vivant directement sur votre bureau Windows, toujours accessible en surimpression transparente, avec gestion complète des besoins, évolutions multiples pilotées par JSON, mini-jeux et System Tray.

---

## Fonctionnalités principales

- **Intégration Bureau Windows 10/11** :
  - Fenêtre transparente sans bordure, toujours au premier plan (`screen-saver` level).
  - **Click-through sélectif dynamique** : seuls le familier, ses menus ouverts et les étoiles de mini-jeux captent la souris ; le reste du bureau laisse passer tous vos clics vers Windows.
  - **System Tray** complet : *Nourrir*, *Jouer*, *Dormir / Réveiller*, *Nettoyer*, *Statistiques & Réglages*, *Recentrer*, *Démarrage auto Windows*, *Notifications*, *Quitter*.
  - Support **multi-écrans** et recalage automatique en cas de débranchement d'écran ou changement de DPI.
- **Moteur de besoins & Temps hors-ligne** :
  - 4 jauges (`0` à `100`) : **Faim** 🍖, **Énergie** ⚡, **Bonheur** 💖, **Propreté** ✨.
  - Calcul du temps écoulé même application fermée à partir de `lastUpdatedAt`, avec **plancher de sécurité hors-ligne (`15/100`)** garantissant que votre compagnon ne meurt jamais pendant la nuit.
  - Protection contre les modifications de l'horloge système (recul dans le passé ou saut extrême dans le futur) et la mise en veille du PC.
- **Actions & Interactions souris** :
  - **Nourrir** : 5 aliments aux effets variés définis dans [`data/foods.json`](./data/foods.json) (*Pomme Croquante*, *Baie Tonique*, *Gâteau au Miel*, *Plateau Gourmet*, *Bouillon d'Herbes*).
  - **Jouer** : 2 mini-jeux directement sur le bureau (*Attrape-Étoile rebondissante* et *Duel Pierre-Feuille-Ciseaux en 3 manches*).
  - **Câliner** : caresser le familier au curseur (ou via le bouton dédié) fait apparaître des cœurs et augmente son bonheur.
  - **Glisser-déposer (Drag & Drop)** : déplacez votre compagnon où vous le souhaitez sur l'écran.
  - **Dormir & Nettoyer** : récupération d'énergie pendant le sommeil et nettoyage des saletés.
- **Arbre d'évolution 100 % piloté par JSON** ([`data/species.json`](./data/species.json)) :
  - **Stade 0 — Œuf** : `egg` (*Œuf Étoilé*)
  - **Stade 1 — Bébé** : `baby_blob` (*P'tit Goutte*)
  - **Stade 2 — Enfant** : `child_sprout` (*Bourgeon Vif*)
  - **Stade 3 — 4 Formes Adultes selon vos soins** :
    - `adult_solar` (*Solarix* — soins réguliers, zéro ou très peu d'erreurs de soin, bonheur élevé)
    - `adult_athletic` (*Voltigeur* — nombreuses sessions de mini-jeux)
    - `adult_gourmet` (*Bistronome* — alimentation gastronomique privilégiée)
    - `adult_shadow` (*Noctambule* — forme mystérieuse en cas de négligences)
- **Faible consommation CPU/RAM** :
  - Rendu Canvas 2D à **FPS adaptatif** : `30 FPS` lors d'une interaction, d'une marche ou d'un mini-jeu, abaissé automatiquement à `5 FPS` lorsque le familier est au repos ou dort.

---

## Commandes rapides

### 1. Installer les dépendances
```powershell
npm.cmd install
```

### 2. Lancer l'application en développement / usage direct
```powershell
npm.cmd start
```

### 3. Lancer les tests unitaires et cas limites (Vitest)
```powershell
npm.cmd test
```

### 4. Vérifier le typage TypeScript
```powershell
npm.cmd run typecheck
```

### 5. Générer l'installeur Windows (`.exe`)
```powershell
npm.cmd run dist:win
```
Les exécutables Windows (installeur NSIS `Mimoo Setup 1.0.0.exe` et version portable `Mimoo 1.0.0.exe`) sont générés dans le dossier `release/`.

---

## Personnalisation (Données & Graphismes)

- **Ajouter ou modifier des aliments** : éditez [`data/foods.json`](./data/foods.json).
- **Ajouter ou modifier des stades / formes d'évolution** : éditez [`data/species.json`](./data/species.json).
- **Ajuster la vitesse de baisse des jauges ou le plancher hors-ligne** : éditez [`data/game-config.json`](./data/game-config.json).
- **Remplacer les sprites placeholders par vos propres visuels** : consultez le guide complet [`docs/ASSETS_GUIDE.md`](./docs/ASSETS_GUIDE.md).
- **Emplacement de la sauvegarde locale** : `%APPDATA%\mimoo\save.json` (avec backup automatique `save.backup.json`).
