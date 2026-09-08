import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Точное имя папки репозитория (GitHub Pages отдаёт сайт по этому пути)
const base = '/js-mxmp-editor/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'icon-maskable.svg'],
      manifest: {
        name: 'JS MXMP Editor',
        short_name: 'MXMP Editor',
        description:
          'Быстрый мобильный редактор и песочница для JavaScript-кода прямо в браузере.',
        lang: 'ru',
        dir: 'ltr',
        theme_color: '#1e1e1e',
        background_color: '#1e1e1e',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: './',
        id: './',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Офлайн-доступ к корню приложения (важно для PWA на GitHub Pages)
        navigateFallback: base + 'index.html',
      },
    }),
  ],
});
