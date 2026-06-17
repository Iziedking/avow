import { defineConfig } from "tsup";

// A single ESM CLI entry. The shebang in src/cli.ts is preserved so the built file runs as a
// bin. Dependencies stay external.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  target: "node20",
});
