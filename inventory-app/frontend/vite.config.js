import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Inventory Field App",
        short_name: "Inventory",
        description: "Warehouse and jobsite asset tracking with tag scanning",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        // App shell is cached for offline launch. API calls are handled by our
        // own Dexie outbox queue, so we deliberately do NOT cache /api here.
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png}"]
      }
    })
  ]
});
