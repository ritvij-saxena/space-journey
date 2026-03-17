import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import glsl from "vite-plugin-glsl";
import topLevelAwait from "vite-plugin-top-level-await";
import { resolve } from "path";

export default defineConfig(({ command }) => ({
  // Base path for GitHub Pages - change 'space-journey' to your repo name
  base: command === "build" ? "/space-journey/" : "/",

  plugins: [
    wasm(),
    topLevelAwait(),
    glsl({
      include: [
        "**/*.glsl",
        "**/*.wgsl",
        "**/*.vert",
        "**/*.frag",
        "**/*.vs",
        "**/*.fs",
      ],
      compress: false,
    }),
  ],

  resolve: {
    alias: {
      // Alias for WASM package to ensure it's bundled correctly
      "space-journey-wasm": resolve(__dirname, "../rust-wasm/pkg"),
    },
  },

  server: {
    port: 3000,
    open: true,
    fs: {
      allow: [".", "../rust-wasm/pkg"],
    },
  },

  build: {
    outDir: "dist",
    minify: "terser",
    target: "esnext",
    // Ensure WASM files are included as assets
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Ensure consistent asset naming for caching
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },

  optimizeDeps: {
    exclude: ["space-journey-wasm"],
  },
}));
