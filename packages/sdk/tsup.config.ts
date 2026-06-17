import { defineConfig } from "tsup";

// ESM-only on purpose: the @mysten/sui, @mysten/seal, and @mysten/walrus packages are
// ESM-only, so a CommonJS build of this SDK could not load them. Dependencies stay external
// so consumers resolve a single copy.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  treeshake: true,
});
