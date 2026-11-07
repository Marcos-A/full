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

// A separate bundle for the tests, starting from its own entry point so that nothing it adds can
// reach the website's bundle. See e2e/native/fakeHost.ts.
const NATIVE_FAKE_MODE = 'native-fake';

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
            handler: (html: string) => (mode === NATIVE_FAKE_MODE ? html.replace('/src/main.tsx', '/e2e/native/main.ts') : html),
          },
        },
      ],
      worker: { format: 'es' },
      build: {
        target: 'es2022',
        chunkSizeWarningLimit: 2000,
        outDir: mode === NATIVE_FAKE_MODE ? 'dist-native-fake' : 'dist',
      },
      preview: { headers: SECURITY_HEADERS },
      test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', allowOnly: false },
    }) as never,
);
