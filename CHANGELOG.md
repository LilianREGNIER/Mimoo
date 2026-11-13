# Changelog — Mimoo

## v1.0.5
- **Salon Online social** : chat rapide dans le salon, émotes & cadeaux (`❤️ Câlin`, `🍎 Friandise +5 🪙`, `❄️ Boule de neige`, `🎉 Confettis`) et duel Pierre-Feuille-Ciseaux en direct (`+15 🪙` en cas de victoire).
- **Défis Quotidiens** : 3 quêtes journalières générées chaque jour dans **Journal → Statistiques** avec récompenses en MimooCoins.
- **Décorations de bureau** : Panier douillet, Gamelle étoilée, Plante de bureau et Petite lampe (qui s'illumine la nuit) achetables en boutique et affichées sur le bureau.
- **Mini-jeu Simon Musical** : jeu de mémoire à 5 manches avec pads lumineux et notes musicales.
- **Bruitages mignons (Web Audio API)** : effets sonores doux/rétro désactivables dans **Réglages → Bruitages mignons**.
- **Réactions contextuelles & Météo** : réactions selon l'application active (VS Code, YouTube/Netflix, Discord, Spotify) et météo réelle (`wttr.in`).

## v1.0.4
- **Correction téléchargement auto-updater (`404`)** : noms d'artefacts sans espaces (`Mimoo-Setup-1.0.4.exe`) pour correspondre exactement à `latest.yml` sur GitHub Releases, et distinction entre erreur `404` et erreur d'authentification (`401`/`403`).

## v1.0.3
- **Correction balle fantôme** : suppression de l'apparition parasite de la balle de tennis lorsqu'on lance le familier sur l'écran ou lors d'un dialogue spontané.

## v1.0.2
- **Dépôt public & auto-update sans compte GitHub** : vérification automatique des mises à jour au démarrage sans aucun jeton requis.

## v1.0.1
- **Mises à jour intégrées (`electron-updater`)** : vérification, téléchargement et installation des nouvelles versions directement depuis **Réglages → Mises à jour Mimoo** (avec prise en charge d'un jeton GitHub pour le dépôt privé).
- **Hygiène & digestion réalistes** :
  - Les salissures (`poopCount`) sont désormais liées à la digestion des repas (`digestionCharge`) au lieu d'apparaître en continu à jeun (intervalle porté à `1800 s`).
  - Baisse passive de propreté fortement réduite (`0.12/min` éveillé, `0.03/min` endormi) et légère baisse réaliste après les mini-jeux (`-1` à `-4`).
  - Effets visuels de saleté sur le sprite déclenchés uniquement en dessous de `45%` de propreté ou à partir de `2` salissures.

## v1.0.0
- Renommage complet du jeu en **Mimoo** (`Mimoo`, `MimooCoins`, codes passeport `MIMO-...` rétrocompatibles `TAMA-...`).
- Migration automatique des sauvegardes existantes vers `%APPDATA%\Mimoo` (et conservation entre mises à jour/installateurs).
- Salons en ligne temps réel multi-PC via WebSocket/MQTT (`wss://broker.emqx.io:8084/mqtt` / fallback `hivemq`) + `BroadcastChannel` local.
- Correction de l'interface du Mode Online (affichage de la carte visiteur, liste des amis, bouton **Dire au revoir / Quitter le salon 👋**, clic droit sur un pet ami).
- Correction du démarrage automatique Windows (`PORTABLE_EXECUTABLE_FILE`, chemin entre guillemets dans le registre Windows, synchronisation Tray ↔ UI).
- Immobilisation complète du familier pendant le sommeil (arrêt de la danse musique, du fetch de balle et des micro-pas).
- Suppression de l'ombre statique intégrée aux spritesheets (conservation de l'ombre dynamique au sol uniquement).
- Prévention du déclenchement immédiat de `needsCuddle` au démarrage après une absence hors-ligne quand le bonheur est élevé/rempli.
