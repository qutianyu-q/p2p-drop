import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径资产：同时兼容根域名（Cloudflare Pages 等）与子路径（GitHub Pages 项目页）
  base: './',
  server: { host: true },
});
