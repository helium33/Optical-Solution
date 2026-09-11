import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build for the standalone, offline preview (`npm run preview:build`).
 *
 * Two aliases do all the work. The application source is untouched — the
 * preview swaps only the modules that talk to something this build cannot
 * have: Google's servers, and a location sensor.
 */
export default defineConfig({
  root: 'preview',
  /* Relative asset URLs, so the bundle works wherever it is hosted. */
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^firebase\/(app|auth|firestore|functions)$/,
        replacement: path.resolve(here, 'preview/firebase-stub.js'),
      },
      {
        find: /^.*\/hooks\/useGeoFence$/,
        replacement: path.resolve(here, 'preview/geofence-stub.js'),
      },
    ],
  },
  define: {
    /* Drives the app down its real client-side punch fallback, so a clock-out
       in the preview runs the genuine overtime calculation. */
    'import.meta.env.VITE_ALLOW_CLIENT_PUNCH': '"true"',
    'import.meta.env.VITE_DEV_BRANCH_PIN': '"1234"',
    /* Placeholder Firebase values. The SDK is stubbed, so these are never
       used for anything — they exist so `isFirebaseConfigured` is true and the
       preview console is not littered with a misconfiguration error.
       Critically, this also keeps the REAL credentials in .env out of a bundle
       that gets published publicly. */
    'import.meta.env.VITE_FIREBASE_API_KEY': '"preview-stub"',
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': '"preview-stub"',
    'import.meta.env.VITE_FIREBASE_APP_ID': '"preview-stub"',
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': '"preview-stub"',
    'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': '"preview-stub"',
    'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': '"preview-stub"',
    'import.meta.env.VITE_FIREBASE_REGION': '"preview-stub"',
    'import.meta.env.VITE_IP_ECHO_URL': '""',
  },
  build: {
    outDir: path.resolve(here, 'dist-preview'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /* One JS file and one CSS file. The preview gets hosted as a static
           artifact, and a single bundle means no dynamic-import paths to get
           wrong wherever it lands. */
        inlineDynamicImports: true,
        entryFileNames: 'attendance-preview.js',
        assetFileNames: 'attendance-preview.[ext]',
      },
    },
  },
});
