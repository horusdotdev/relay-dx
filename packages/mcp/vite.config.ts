import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/cli.ts"],
    format: "esm",
    platform: "node",
    fixedExtension: false,
    dts: true,
    sourcemap: true,
    clean: true,
  },
});
