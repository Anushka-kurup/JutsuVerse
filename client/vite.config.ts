import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@jutsu/protocol": path.resolve(root, "../packages/protocol/src/index.ts"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
      "/health": "http://127.0.0.1:8080",
    },
  },
});
