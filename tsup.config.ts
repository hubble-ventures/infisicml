import { defineConfig } from "tsup";

// Two build targets from one core:
//
//  1. The library + CLI — ESM, published to npm. `yaml`/`zod` stay external
//     (declared runtime deps); consumers get a slim, tree-shakeable package.
//  2. The GitHub Action — a single self-contained CommonJS file committed to the
//     repo so `uses: hubble-ventures/infisicml@v3` runs with no install step.
//     Everything (including @actions/*) is bundled in.
export default defineConfig([
  {
    entry: { index: "src/index.ts", cli: "src/cli.ts" },
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    // Declarations are emitted separately by the native TS compiler
    // (`tsc -p tsconfig.build.json`) — faster and avoids tsup's bundled-dts
    // plugin, which lags the current TypeScript.
    dts: false,
    sourcemap: true,
    clean: true,
    splitting: false,
  },
  {
    entry: { index: "src/action.ts" },
    format: ["cjs"],
    target: "node22",
    outDir: "action",
    outExtension: () => ({ js: ".cjs" }),
    noExternal: [/.*/],
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
  },
]);
