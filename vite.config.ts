import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  build: {
    // Keep the browser bundle parseable by older Android Chromium/WebView.
    // The Cloudflare Worker build remains controlled by its own runtime.
    target: "es2019",
  },
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    react(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
  ],
});
