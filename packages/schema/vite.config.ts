import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: "esm",
    platform: "node",
    fixedExtension: false,
    dts: true,
    sourcemap: true,
    clean: true,
  },
});
