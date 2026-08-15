import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../..");

export default defineConfig({
  root: ".",
  resolve: {
    alias: {
      "@xrkseek/web-runtime": path.join(
        repo,
        "packages/web-runtime/src/index.ts",
      ),
      "@xrkseek/protocol": path.join(repo, "packages/protocol/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
      },
      "/health": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
