import { createServer } from "vite";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import electron from "electron";
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
const server = await createServer();
await server.listen();
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: server.resolvedUrls.local[0],
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], { stdio: "inherit", env });
const stop = async () => {
  child.kill("SIGTERM");
  await server.close();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.once("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
