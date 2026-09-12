import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
