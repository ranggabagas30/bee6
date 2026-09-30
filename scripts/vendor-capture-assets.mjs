// Copies the VAD + ONNX Runtime Web assets out of node_modules into
// public/vendor/capture/ so the /capture page serves them from our own origin
// (no CDN — decision 2 in docs/tasks/R-03.md, hard rule #8). Idempotent; run via
// `npm run vendor:capture` and automatically before `next build` (prebuild).
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vadDist = join(root, "node_modules", "@ricky0123", "vad-web", "dist");
const ortDist = join(root, "node_modules", "onnxruntime-web", "dist");
const outVad = join(root, "public", "vendor", "capture", "vad");
const outOrt = join(root, "public", "vendor", "capture", "ort");

// VAD worklet + Silero v5 weights (matches VAD_MODEL in lib/capture/browser/assets.ts).
const vadFiles = ["vad.worklet.bundle.min.js", "silero_vad_v5.onnx"];
// ONNX Runtime Web wasm binaries + their loader modules (all variants, so the
// runtime can pick simd/threaded/jsep at load time).
const ortFiles = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
];

function copyInto(files, srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    const src = join(srcDir, file);
    if (!existsSync(src)) {
      throw new Error(
        `Missing vendored asset: ${src}. Run "npm install" first.`,
      );
    }
    cpSync(src, join(destDir, file));
  }
}

copyInto(vadFiles, vadDist, outVad);
copyInto(ortFiles, ortDist, outOrt);
console.log(
  `vendor:capture — copied ${vadFiles.length + ortFiles.length} assets into public/vendor/capture/`,
);
