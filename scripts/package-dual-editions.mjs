/**
 * Script d'empaquetage automatisé des deux éditions Windows :
 * 1) Standard / Release Edition : Pour les autres joueurs / un autre PC (expérience propre, sans mode test).
 * 2) Spéciale Développeur / Sandbox Edition : Pour le créateur / testeur (bouton Labo, raccourci F2, menu Tray sandbox, starters, simulations de besoins, 19 formes en 1 clic).
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const devEditionDataFile = path.join(rootDir, 'data', 'dev-edition.json');
const devEditionDistFile = path.join(rootDir, 'dist', 'data', 'dev-edition.json');

function cleanupDevMarker() {
  if (fs.existsSync(devEditionDataFile)) {
    fs.unlinkSync(devEditionDataFile);
  }
  if (fs.existsSync(devEditionDistFile)) {
    fs.unlinkSync(devEditionDistFile);
  }
}

function runCommand(cmd, stepTitle) {
  console.log(`\n======================================================`);
  console.log(`▶ ${stepTitle}`);
  console.log(`   $ ${cmd}`);
  console.log(`======================================================\n`);
  execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
}

async function packageDualEditions() {
  console.log('🚀 Démarrage de la génération des DEUX installateurs Windows...\n');

  try {
    // -------------------------------------------------------------
    // 1) ÉDITION DÉVELOPPEUR / SPÉCIALE (construite en premier pour que latest.yml reste celui de l'édition Standard)
    // -------------------------------------------------------------
    console.log('🧪 Étape 1/2 : Construction de l\'Édition Spéciale Développeur / Labo...');
    const devConfig = {
      isDevEdition: true,
      buildTimestamp: new Date().toISOString(),
      editionName: 'Special Developer & Sandbox Edition'
    };
    fs.writeFileSync(devEditionDataFile, JSON.stringify(devConfig, null, 2), 'utf8');

    runCommand('npm run build', 'Recompilation avec le marqueur Dev Edition');
    runCommand(
      'npx electron-builder --win --x64 --publish never -c.productName="Mimoo (Dev Edition)" -c.appId="com.mimoo.desktoppet.devedition" -c.nsis.artifactName="Mimoo-Dev-Setup-${version}.${ext}" -c.portable.artifactName="Mimoo-Dev-Portable-${version}.${ext}"',
      'Empaquetage NSIS & Portable (Dev Edition)'
    );

    const latestYmlPath = path.join(rootDir, 'release', 'latest.yml');
    if (fs.existsSync(latestYmlPath)) {
      fs.unlinkSync(latestYmlPath);
    }

    // -------------------------------------------------------------
    // 2) ÉDITION STANDARD / PUBLIQUE (génère le latest.yml officiel pour l'auto-updater)
    // -------------------------------------------------------------
    console.log('\n📦 Étape 2/2 : Construction de l\'Édition Standard (Grand Public)...');
    cleanupDevMarker();

    runCommand('npm run build', 'Compilation TypeScript, Vite & Assets (Standard)');
    runCommand('npx electron-builder --win --x64 --publish never', 'Empaquetage NSIS & Portable (Standard)');

    console.log('\n🎉 Les deux éditions ont été générées avec succès dans release/ !\n');
  } finally {
    // Nettoyage pour laisser le répertoire propre
    cleanupDevMarker();
  }

  // Résumé des fichiers générés
  const releaseDir = path.join(rootDir, 'release');
  if (fs.existsSync(releaseDir)) {
    console.log('📂 Contenu de release/ :');
    const files = fs.readdirSync(releaseDir);
    for (const f of files) {
      if (f.endsWith('.exe')) {
        const stat = fs.statSync(path.join(releaseDir, f));
        const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
        console.log(`   - ${f} (${sizeMb} Mo)`);
      }
    }
  }
}

packageDualEditions().catch((err) => {
  cleanupDevMarker();
  console.error('\n❌ Échec du packaging :', err);
  process.exit(1);
});
