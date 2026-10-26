import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "arobase.chat",
        short_name: "arobase.chat",
        description: "Réseau social décentralisé et résistant à la censure",
        theme_color: "#0b0d12",
        background_color: "#0b0d12",
        display: "standalone",
        start_url: ".",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "index.html",
        importScripts: ["push-sw.js"],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/ },
            { name: "query", test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: "viem", test: /node_modules[\\/](viem|abitype|ox|@noble|@scure)[\\/]/ },
            { name: "dexie", test: /node_modules[\\/](dexie|idb-keyval)[\\/]/ },
          ],
        },
      },
    },
  },
  server: { port: 5173 },
});
