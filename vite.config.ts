import { defineConfig } from 'vite';

/**
 * Configuration Vite pour le processus Renderer d'Electron (Canvas 2D + UI).
 * Le dossier public pointe vers `../../assets` afin d'exposer les sprites et icônes
 * directement à la racine du build renderer (`dist/renderer/`).
 */
export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: '../../assets',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true
  }
});
