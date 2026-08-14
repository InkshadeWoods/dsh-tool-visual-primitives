import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// entryPoint is the plugin root index.mjs (backend), but we only want to build the client
const clientEntry = join(__dirname, "..", "client", "index.js");
const outfile = join(__dirname, "..", "lib", "client.js");

await esbuild.build({
  entryPoints: [clientEntry],
  bundle: true,
  format: "iife",
  outfile,
  platform: "browser",
  target: "es2020",
  logLevel: "silent",
});

console.log("build ok ->", outfile);
