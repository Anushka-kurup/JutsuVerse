import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const protocolSrc = fileURLToPath(new URL("../packages/protocol/src/index.ts", import.meta.url));
const entry = (name: string) => fileURLToPath(new URL(`./${name}`, import.meta.url));

export default defineConfig({
  resolve: {
    // import the protocol package straight from its .ts source so Vite transforms it
    alias: { "@jutsu/protocol": protocolSrc },
  },
  // the app plus the standalone detection labs (served at /sixseven.html, /meme.html)
  build: {
    rollupOptions: {
      input: {
        main: entry("index.html"),
        sixseven: entry("sixseven.html"),
        meme: entry("meme.html"),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    // src/types.ts imports ../../shared/*.ts and ../../packages/* — allow outside frontend/
    fs: { allow: [repoRoot] },
    // same-origin `/ws` so LAN clients never type a server URL
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
      "/health": "http://127.0.0.1:8080",
    },
  },
  // onnxruntime-web ships its own wasm loader; pre-bundling it breaks that
  optimizeDeps: { exclude: ["onnxruntime-web", "@jutsu/protocol"] },
});
