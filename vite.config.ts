import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// EC_OFFLINE=1 npm run dev  -> no remote bindings (Workers AI calls fail, everything else works).
export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: process.env.EC_OFFLINE !== "1" })],
});
