import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const watch = process.argv.includes("--watch");

async function buildEntry({
  input,
  name,
  format = "es",
  emptyOutDir = false,
  copyPublicDir = false,
}) {
  return build({
    configFile: false,
    root: projectRoot,
    publicDir: copyPublicDir ? "public" : false,
    build: {
      codeSplitting: false,
      copyPublicDir,
      emptyOutDir,
      outDir: "dist",
      rollupOptions: {
        input: resolve(projectRoot, input),
        output: {
          entryFileNames: `assets/${name}.js`,
          format,
        },
      },
      sourcemap: false,
      watch: watch ? {} : null,
    },
  });
}

await buildEntry({
  input: "src/content.ts",
  name: "content",
  format: "iife",
  emptyOutDir: true,
  copyPublicDir: true,
});
await buildEntry({
  input: "src/service-worker.ts",
  name: "service-worker",
});
await buildEntry({
  input: "src/web-bridge.ts",
  name: "web-bridge",
  format: "iife",
});
await buildEntry({
  input: "popup.html",
  name: "popup",
});
