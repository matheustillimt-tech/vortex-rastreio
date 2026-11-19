import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // cada arquivo de banco sobe Postgres em WASM (PGlite); em paralelo a memória WASM estoura → um arquivo por vez
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});
