import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// base is the GitHub Pages sub-path: https://<user>.github.io/watch-pick/
export default defineConfig({
  base: '/watch-pick/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'What to Watch',
        short_name: 'Watch',
        description: 'Three picks for tonight that we will both like, from Prime Video and Plex',
        // Absolute and with its own id: the sleep app lives on the same
        // origin, and a phone must not take this for the same app.
        id: '/watch-pick/',
        start_url: '/watch-pick/',
        scope: '/watch-pick/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f3ef',
        theme_color: '#7a2e3a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // The shell is cached so the app opens with no signal; the last picks are kept in localStorage.
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true
      }
    })
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
});
