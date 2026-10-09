// Used when you run this project on your own computer (`npm install && npm run dev`).
// Plexo builds with its own copy of this config, so changes here don't affect your live site.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": `${import.meta.dirname}/src` } },
  server: {
    // Talk to your live Plexo app's backend while developing locally.
    proxy: process.env.PLEXO_URL ? { "/__plexo": { target: process.env.PLEXO_URL, changeOrigin: true } } : undefined,
  },
});
