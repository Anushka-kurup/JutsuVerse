import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const protocolSrc = fileURLToPath(new URL("../packages/protocol/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    // import the protocol package straight from its .ts source so Vite transforms it
    alias: { "@jutsu/protocol": protocolSrc },
  },
  server: {
    // src/types.ts imports ../../shared/*.ts and ../../packages/* — allow outside frontend/
    fs: { allow: [repoRoot] },
  },
  // onnxruntime-web ships its own wasm loader; pre-bundling it breaks that
  optimizeDeps: { exclude: ["onnxruntime-web", "@jutsu/protocol"] },
});
