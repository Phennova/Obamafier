import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

const root = resolve(__dirname, 'src/renderer');

export default defineConfig({
  plugins: [
    electron([
      {
        entry: resolve(__dirname, 'src/main/index.ts'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist/main'),
            rollupOptions: {
              external: ['sharp', 'electron'],
            },
          },
        },
      },
      {
        entry: resolve(__dirname, 'src/preload.ts'),
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist/preload'),
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
  },
  root,
});
