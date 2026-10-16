import { build } from "esbuild";
await build({
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  bundle: true,
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
});
