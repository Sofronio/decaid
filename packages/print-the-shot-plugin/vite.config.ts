import { defineConfig } from "vite";
import { resolve } from "path";
import { mkdirSync, copyFileSync } from "fs";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/plugin.ts"),
      name: "createPlugin",
      formats: ["iife"],
      fileName: () => "plugin.js",
    },
    outDir: resolve(__dirname, "../../assets/plugins/print-the-shot.reaplugin"),
    emptyOutDir: false,
    minify: false,
  },
  plugins: [
    {
      name: "copy-manifest",
      closeBundle() {
        const outDir = resolve(
          __dirname,
          "../../assets/plugins/print-the-shot.reaplugin"
        );
        mkdirSync(outDir, { recursive: true });
        copyFileSync(
          resolve(__dirname, "manifest.json"),
          resolve(outDir, "manifest.json")
        );
      },
    },
  ],
});
