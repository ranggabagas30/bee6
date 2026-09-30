/**
 * Vendored capture-asset paths. All VAD/ONNX assets are served from our own
 * origin (no CDN) so the shop device works on a locked-down network and nothing
 * loads from a third-party host (decision 2 in docs/tasks/R-03.md). The files are
 * copied out of node_modules into `public/vendor/capture/` by
 * `scripts/vendor-capture-assets.mjs` (npm run vendor:capture, wired into
 * prebuild). See THIRD_PARTY_NOTICES.md for licences.
 */

export const VENDOR_BASE = "/vendor/capture";

/** Silero worklet bundle + `silero_vad_<model>.onnx` weights. */
export const VAD_ASSET_PATH = `${VENDOR_BASE}/vad/`;

/** onnxruntime-web wasm binaries. */
export const ORT_WASM_PATH = `${VENDOR_BASE}/ort/`;

/** Silero model revision used by the VAD. */
export const VAD_MODEL = "v5" as const;
