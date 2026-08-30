import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      // Forces every react/react-dom import — including from packages
      // hoisted to the monorepo root that only this app depends on
      // (@clerk/clerk-react, input-otp, @radix-ui/*) — onto this app's OWN
      // nested React 19 copy, never onto apps/web's React 18 copy hoisted
      // at the root. Without this, npm's workspace hoisting causes two
      // React instances in one page ("Invalid hook call") — the same class
      // of issue tsconfig.json's `paths` fixes for *types*; this is the
      // runtime/bundler-resolution equivalent, needed separately.
      react: path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: 3100,
    strictPort: false,
    host: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL || "http://localhost:8080",
        changeOrigin: true,
      },
      "/pdfs": {
        target: process.env.VITE_API_BASE_URL || "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
