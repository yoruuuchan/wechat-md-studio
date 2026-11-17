import devServer from "@hono/vite-dev-server"
import fs from "fs"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/|skill\.md$).*$/] }),
    inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  define: {
    // Whether scripts/motion/pack-motion.mjs put the motion composer's page in
    // public/motion/ for this build; src/lib/motion.ts turns it into the entry.
    __REED_MOTION__: JSON.stringify(fs.existsSync(path.resolve(__dirname, "public/motion/index.html"))),
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    // Font slices stay separate files: the browser fetches only the
    // unicode-range slices the text uses, while an inlined slice would be
    // downloaded with the entry stylesheet whether it is used or not.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
});
