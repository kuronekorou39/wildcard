import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * GitHub Pages のプロジェクトページは /<repo>/ 配下に出るので base を合わせる。
 * ローカル開発では '/' のままにしたいので、build のときだけ付ける。
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/wildcard/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      // エンジンはビルド済みパッケージではなくソースを直接参照する。
      // 型もそのまま効き、エンジンを直したら即反映される。
      '@wildcard/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
    },
  },
}));
