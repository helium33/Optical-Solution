import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
/**
 * Print where the attendance app actually is.
 *
 * Vite advertises one URL — the root — and the root is the storefront that was
 * already in this repository. Someone starting the dev server to work on the
 * attendance app clicks that link, sees sunglasses, and reasonably concludes
 * nothing was installed. Saying it plainly at startup costs nothing.
 */
const announceRoutes = () => ({
  name: 'announce-attendance-routes',
  configureServer(server) {
    const printed = server.printUrls;
    server.printUrls = () => {
      printed();
      const base = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') ?? '';
      /* loadEnv, not process.env: Vite reads .env into import.meta.env for the
         app but does not put it on process.env, so the config has to ask. */
      const env = loadEnv(server.config.mode, process.cwd(), 'VITE_');
      const landsOnStorefront = env.VITE_DEFAULT_APP === 'storefront';
      console.log('');
      console.log('  Attendance app');
      console.log(`  \u279c  Kiosk:        ${base}/attendance/kiosk`);
      console.log(`  \u279c  Admin:        ${base}/attendance/admin   (type 7860 on any screen)`);
      console.log(`  \u279c  Diagnostics:  ${base}/attendance/diagnostics`);
      console.log(`  \u279c  Preview:      ${base}/attendance/preview   (sample data)`);
      console.log('');
      console.log(
        landsOnStorefront
          ? '  "/" is the storefront (VITE_DEFAULT_APP=storefront).'
          : '  "/" redirects to the kiosk. Set VITE_DEFAULT_APP=storefront for the old storefront-first behaviour.',
      );
      console.log('');
    };
  },
});

/**
 * Installable kiosk.
 *
 * The tablet in the shop should open on the roster, not in a browser with an
 * address bar a staff member can wander out of, so `start_url` points at the
 * kiosk rather than `/` and the display mode is standalone.
 *
 * `autoUpdate` rather than a prompt: nobody is going to tap "a new version is
 * available" on a wall-mounted tablet, and a shop running last week's punch
 * rules because an update was never accepted is worse than a reload.
 *
 * The storefront's hero photograph is deliberately NOT precached — it is 1.3 MB
 * the kiosk never shows. Firestore is left alone too: it keeps its own offline
 * store in IndexedDB, and a service worker caching its responses on top would
 * be a second, staler answer to the same question.
 */
/**
 * Loaded at call time rather than imported at the top, and allowed to fail.
 *
 * A service worker is a production concern: it does nothing during
 * `npm run dev`, and Netlify installs from the lockfile so the build always
 * has it. But a top-level import of a package whose own dependency tree is
 * incomplete — a half-finished `npm install`, which happens — takes the whole
 * config down, and with it the dev server, for a feature that was not being
 * used at that moment. A shop cannot run its kiosk because an optional plugin
 * did not unpack cleanly is the wrong failure.
 *
 * So: try to load it, say plainly what to do if it is not there, carry on.
 */
const pwa = async () => {
  let VitePWA;
  try {
    ({ VitePWA } = await import('vite-plugin-pwa'));
  } catch (error) {
    console.warn(
      '\n  [pwa] vite-plugin-pwa could not be loaded, so the app will run WITHOUT ' +
        'offline support and cannot be installed to a home screen.\n' +
        '        Everything else works. To fix it: npm install\n' +
        `        (${error?.message ?? error})\n`,
    );
    return [];
  }

  return VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['apple-touch-icon.png', 'logo.svg'],
    manifest: {
      name: 'Attendence-muse-app',
      short_name: 'Attendance',
      description: 'Staff attendance for Win Vision, Pwint Eyewear and Yangon Eyewear.',
      start_url: '/attendance/kiosk',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f6f7fb',
      theme_color: '#f6f7fb',
      lang: 'my',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      navigateFallback: '/index.html',
      runtimeCaching: [
        {
          /* Burmese has no fallback on most devices: without Noto Sans Myanmar
             every label renders as empty boxes, so the font is worth holding
             onto across an outage even though the rest of the app is not. */
          urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'google-fonts',
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
  });
};

export default defineConfig(async () => ({
  plugins: [react(), announceRoutes(), await pwa()],
  optimizeDeps: {
    /**
     * Scan only the real entry point.
     *
     * Vite's dependency scanner globs every .html in the project by default.
     * `preview/artifact-page.html` is not an entry — it is the wrapper used to
     * host the built preview bundle, so it references `attendance-preview.js`,
     * a BUILD OUTPUT that does not exist in source. Left to its default the
     * scanner tries to resolve it and `npm run dev` fails to start with
     * "The following dependencies are imported but could not be resolved".
     */
    entries: ['index.html'],
  },
}))
