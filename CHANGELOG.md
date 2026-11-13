# Changelog — Mimoo

## v1.0.0
- Renommage complet du jeu en **Mimoo** (`Mimoo`, `MimooCoins`, codes passeport `MIMO-...` rétrocompatibles `TAMA-...`).
- Migration automatique des sauvegardes existantes vers `%APPDATA%\Mimoo` (et conservation entre mises à jour/installateurs).
- Salons en ligne temps réel multi-PC via WebSocket/MQTT (`wss://broker.emqx.io:8084/mqtt` / fallback `hivemq`) + `BroadcastChannel` local.
- Correction de l'interface du Mode Online (affichage de la carte visiteur, liste des amis, bouton **Dire au revoir / Quitter le salon 👋**, clic droit sur un pet ami).
- Correction du démarrage automatique Windows (`PORTABLE_EXECUTABLE_FILE`, chemin entre guillemets dans le registre Windows, synchronisation Tray ↔ UI).
- Immobilisation complète du familier pendant le sommeil (arrêt de la danse musique, du fetch de balle et des micro-pas).
- Suppression de l'ombre statique intégrée aux spritesheets (conservation de l'ombre dynamique au sol uniquement).
- Prévention du déclenchement immédiat de `needsCuddle` au démarrage après une absence hors-ligne quand le bonheur est élevé/rempli.
