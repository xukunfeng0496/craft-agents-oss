import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// NOTE: Source map upload to Sentry is intentionally disabled.
// To re-enable, uncomment the sentryVitePlugin below and add SENTRY_AUTH_TOKEN,
// SENTRY_ORG, SENTRY_PROJECT to CI secrets. See CLAUDE.md "Sentry Error Tracking" section.
// import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          // Jotai HMR support: caches atom instances in globalThis.jotaiAtomCache
          // so that HMR module re-execution returns stable atom references
          // instead of creating new (empty) atoms that orphan existing data.
          'jotai/babel/plugin-debug-label',
          ['jotai/babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }],
        ],
      },
    }),
    tailwindcss(),
    // Sentry source map upload — intentionally disabled. See CLAUDE.md for re-enabling instructions.
    // sentryVitePlugin({
    //   org: process.env.SENTRY_ORG,
    //   project: process.env.SENTRY_PROJECT,
    //   authToken: process.env.SENTRY_AUTH_TOKEN,
    //   disable: !process.env.SENTRY_AUTH_TOKEN,
    //   sourcemaps: {
    //     filesToDeleteAfterUpload: ['**/*.map'],
    //   },
    // }),
  ],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyDirBeforeWrite: true,
    sourcemap: true,  // Source maps generated for debugging. Not uploaded to Sentry (see CLAUDE.md).
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        playground: resolve(__dirname, 'src/renderer/playground.html'),
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@config': resolve(__dirname, '../../packages/shared/src/config'),
      // Force all React imports to use the root node_modules React
      // Bun hoists deps to root. This prevents "multiple React copies" error from @work-agent/ui
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai', 'pdfjs-dist'],
    exclude: ['@work-agent/ui'],
    esbuildOptions: {
      supported: { 'top-level-await': true },
      target: 'esnext',
      plugins: [
        {
          // electron-log's node transports reference Node.js built-ins (https, fs, etc.)
          // which can't be resolved in the browser context during Vite dep pre-bundling.
          // Stub them out so esbuild can finish bundling electron-log/renderer.
          name: 'node-builtins-external',
          setup(build) {
            const builtins = new Set([
              'https', 'http', 'fs', 'path', 'os', 'util', 'events',
              'stream', 'electron', 'original-fs', 'child_process', 'net',
            ])
            build.onResolve({ filter: /.*/ }, (args) => {
              if (builtins.has(args.path)) {
                return { path: args.path, namespace: 'node-builtin-stub' }
              }
            })
            build.onLoad({ filter: /.*/, namespace: 'node-builtin-stub' }, () => {
              return { contents: 'export default {}', loader: 'js' }
            })
          },
        },
      ],
    }
  },
  server: {
    port: 5173,
    open: false
  }
})
