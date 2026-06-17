import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps asset paths relative, which a Walrus Site needs since it is served from a
// base36 subdomain path rather than the domain root.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
