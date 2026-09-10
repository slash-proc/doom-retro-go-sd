// Runs one conversion off the main thread.
//
// The Worker exists for two reasons. It keeps a long conversion from freezing
// the page, and it is the cancellation mechanism: the ABI has no cancel flag
// and cannot have one, so a host aborts a run by terminating the worker.
// Progress arrives as messages posted between stages.
//
// One worker per WAD, not one for the whole selection. Doom II costs the module
// around 220 MiB and wasm memory only ever grows, so a single instance
// converting four IWADs in turn would hold the high-water mark of the largest
// until the page was closed. Terminating the worker is the only way to give
// that back, which makes "one run, one worker" the cheap answer as well as the
// one that gives every WAD its own timeout.

import { extract } from "./extract.mjs";

self.onmessage = async (ev) => {
  const { wasmBytes, input, flags, expectedOutputs, maxOutputBytes } = ev.data;
  try {
    const { outputs, warnings, ms } = await extract(wasmBytes, input, {
      flags,
      expectedOutputs,
      maxOutputBytes,
      onProgress: (p) => self.postMessage({ type: "progress", ...p }),
    });
    // Transfer rather than copy: a .whd is a dozen megabytes.
    self.postMessage({ type: "done", outputs, warnings, ms },
      outputs.map((o) => o.data.buffer));
  } catch (e) {
    self.postMessage({ type: "error", message: String(e?.message ?? e) });
  }
};
