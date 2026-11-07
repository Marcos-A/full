import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { APP_NAME } from './src/config.ts';

// Same policy as deploy/nginx.conf, so that preview and the e2e tests run under the real CSP.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// Other bundles, each starting from its own entry point so that nothing it adds can reach the
// website's bundle. The tests' is described in e2e/native/fakeHost.ts.
const OTHER_BUNDLES: Record<string, { entry: string; outDir: string }> = {
  'native-fake': { entry: '/e2e/native/main.ts', outDir: 'dist-native-fake' },
  desktop: { entry: '/src/desktop/main.ts', outDir: 'dist-desktop' },
};

export default defineConfig(
  ({ mode }) =>
    ({
      plugins: [
        react(),
        {
          name: 'app-name',
          transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', APP_NAME),
        },
        {
          name: 'entry-point',
          transformIndexHtml: {
            order: 'pre',
            handler: (html: string) => (OTHER_BUNDLES[mode] ? html.replace('/src/main.tsx', OTHER_BUNDLES[mode].entry) : html),
          },
        },
      ],
      worker: { format: 'es' },
      build: {
        target: 'es2022',
        chunkSizeWarningLimit: 2000,
        outDir: OTHER_BUNDLES[mode]?.outDir ?? 'dist',
      },
      preview: { headers: SECURITY_HEADERS },
      test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', allowOnly: false },
    }) as never,
);
