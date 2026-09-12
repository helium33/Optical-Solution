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
      const landsOnAttendance = env.VITE_DEFAULT_APP === 'attendance';
      console.log('');
      console.log('  Attendance app');
      console.log(`  \u279c  Kiosk:       ${base}/attendance/kiosk`);
      console.log(`  \u279c  My records:  ${base}/attendance/me`);
      console.log(`  \u279c  Preview:     ${base}/attendance/preview   (sample data)`);
      console.log('  \u279c  Admin:       type 7860 on any screen');
      console.log('');
      console.log(
        landsOnAttendance
          ? '  "/" redirects to the kiosk (VITE_DEFAULT_APP=attendance).'
          : '  "/" is the storefront. Set VITE_DEFAULT_APP=attendance to land on the kiosk.',
      );
      console.log('');
    };
  },
});

export default defineConfig({
  plugins: [react(), announceRoutes()],
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
})
