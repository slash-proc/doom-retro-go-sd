/*
 * Host runner: verify, instantiate, feed, step, collect the output.
 *
 * Mirrors what a real host does (gwrg-dist-spec spec/05-host.md) closely
 * enough to be worth trusting as a test: the module is verified from its own
 * bytes first, instantiated with NO import object at all, and driven through
 * the stepped path rather than run(), so the incremental route is the one the
 * tests cover.
 *
 * The module emits an output ID, not a filename. Nothing here invents one
 * either: `extract` hands back the id the module gave and the bytes behind it,
 * and naming is install.mjs's job, from the manifest and the user's own file.
 *
 * This file is imported by the browser page as well as run under node, so the
 * CLI below is guarded on `process`. A bare `process.argv` here throws at
 * import time in a browser and takes the whole page down with no error visible
 * anywhere; build-page.sh fails the build on it for that reason.
 *
 *   node extract.mjs <module.wasm> <out.whd> <in.wad>
 */
import { verify } from "./verify.mjs";

export const ABI_VERSION = 1;

/** Ceiling on a single output when the caller states none. A manifest's
 *  `limits.maxOutputBytes` should be passed instead wherever there is one. */
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_INPUTS = 16;
const MAX_OUTPUTS = 8;
// An output id is matched against the manifest, never written anywhere, but it
// is still a module-chosen string and there is no reason to carry a megabyte
// of one around.
const MAX_ID_BYTES = 255;

/**
 * Converts one WAD.
 *
 * @param {Uint8Array} wasmBytes  the converter module
 * @param {Uint8Array|Uint8Array[]} inputs  the .wad, or a list of them
 * @param {{flags?: number, maxOutputBytes?: number, expectedOutputs?: string[],
 *          onProgress?: (p: {stage: number, stages: number, name: string}) => void,
 *          shouldCancel?: () => boolean}} [opts]
 * @returns {Promise<{outputs: {id: string, data: Uint8Array}[], warnings: string[],
 *                    ms: number, pages: number}>}
 */
export async function extract(wasmBytes, inputs, opts = {}) {
  const {
    flags = 0,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    expectedOutputs = null,
    onProgress = null,
    shouldCancel = null,
  } = opts;

  const report = verify(wasmBytes);
  if (!report.ok) {
    throw fail(`module failed verification:\n  ${report.errors.join("\n  ")}`, { phase: "verify" });
  }

  // No import object at all. If the module asked for anything this throws,
  // which is the same property `verify` asserted statically, enforced a second
  // time by the engine.
  const { instance } = await WebAssembly.instantiate(wasmBytes, undefined);
  const x = instance.exports;

  const abi = x.abi_version() >>> 0;
  if (abi !== ABI_VERSION) {
    throw fail(`module implements ABI version ${abi}, this host drives ${ABI_VERSION}`,
      { phase: "abi" });
  }

  // Never hold a view across a module call: growth detaches the buffer, so
  // memory.buffer is re-read on every access rather than captured once.
  const mem = () => new Uint8Array(x.memory.buffer);
  const read = (ptr, len, what) => {
    const n = len >>> 0;
    const p = ptr >>> 0;
    if (n > maxOutputBytes) {
      throw fail(`module claims ${n} bytes for ${what}, over the ${maxOutputBytes} limit`,
        { phase: "output" });
    }
    const buf = x.memory.buffer;
    if (p + n > buf.byteLength) {
      throw fail(`module returned an out-of-bounds range for ${what}`, { phase: "output" });
    }
    return new Uint8Array(buf, p, n).slice();
  };
  // fatal:true, because a module that hands back invalid UTF-8 is misbehaving
  // and quietly substituting replacement characters would hide it.
  const str = (ptr, len, what) =>
    new TextDecoder("utf-8", { fatal: true }).decode(read(ptr, len, what));

  const files = Array.isArray(inputs) ? inputs : [inputs];
  if (files.length === 0) throw fail("no input files given", { phase: "input" });
  if (files.length > MAX_INPUTS) {
    throw fail(`${files.length} input files given, over the ${MAX_INPUTS} limit`,
      { phase: "input" });
  }

  x.input_clear();
  for (const f of files) {
    const ptr = x.alloc(f.length) >>> 0;
    if (!ptr) throw fail(`alloc failed for ${f.length} bytes`, { phase: "input" });
    mem().set(f, ptr);                 // re-read: alloc may have grown memory
    x.input_add(ptr, f.length);
  }

  const t0 = Date.now();
  let status = x.run_begin(flags) >>> 0;
  if (status !== 0) {
    throw fail(errorText(), { phase: "run_begin", status });
  }

  const stages = x.stage_count() >>> 0;
  const stageName = (i) =>
    str(x.stage_name_ptr(i), Math.min(x.stage_name_len(i) >>> 0, MAX_ID_BYTES), "a stage name");

  // Always the stepped path, even with nobody watching: it is what `run` does
  // internally, and exercising it here keeps the incremental route the one the
  // parity check covers rather than a second, less-travelled one.
  for (let steps = 0; ; steps++) {
    if (steps > 1000) throw fail("module never finished", { phase: "run_step" });
    const index = x.stage_index() >>> 0;
    if (onProgress && index < stages) {
      onProgress({ stage: index, stages, name: stageName(index) });
    }
    if (shouldCancel && shouldCancel()) throw fail("cancelled", { phase: "cancel" });

    let rc;
    try {
      rc = x.run_step() >>> 0;
    } catch (e) {
      /*
       * A trap, not a return. wasm cannot unwind without the exception-handling
       * proposal, so the converter's own fatal paths end in abort() and then in an
       * `unreachable` instead of a status code. The instance's memory survives
       * it and the module writes its message before trapping where it can, so
       * the reason is still readable -- better than reporting a bare
       * RuntimeError, which is all the engine offers.
       */
      throw fail(x.error_len() ? errorText() : e.message, { phase: "run_step", trapped: true });
    }
    if (rc === 0) break;
    if (rc !== 1) throw fail(errorText(), { phase: "run_step", status: rc });
  }
  const ms = Date.now() - t0;
  if (onProgress) onProgress({ stage: stages, stages, name: "done" });

  function errorText() {
    const n = Math.min(x.error_len() >>> 0, 4096);
    return n ? str(x.error_ptr(), n, "the error message") : "";
  }

  const warnText = x.warnings_len()
    ? str(x.warnings_ptr(), Math.min(x.warnings_len() >>> 0, 64 * 1024), "warnings")
    : "";

  const count = x.output_count() >>> 0;
  if (count === 0) throw fail("module reported success but produced no output", { phase: "output" });
  if (count > MAX_OUTPUTS) {
    throw fail(`module reported ${count} outputs, over the ${MAX_OUTPUTS} limit`,
      { phase: "output" });
  }

  const outputs = [];
  for (let i = 0; i < count; i++) {
    const id = str(x.output_name_ptr(i),
      Math.min(x.output_name_len(i) >>> 0, MAX_ID_BYTES), `output ${i}'s id`);
    outputs.push({ id, data: read(x.output_ptr(i), x.output_len(i), `output ${i}`) });
  }

  // The manifest, not the module, decides what a legitimate run produces.
  if (expectedOutputs) {
    const got = outputs.map((o) => o.id).sort().join(",");
    const want = [...expectedOutputs].sort().join(",");
    if (got !== want) {
      throw fail(`module produced [${got}] but the manifest declares [${want}]`,
        { phase: "output" });
    }
  }

  return {
    outputs,
    warnings: warnText ? warnText.split("\n") : [],
    ms,
    pages: x.memory.buffer.byteLength / 65536,
  };
}

/** An Error carrying enough for a caller to phrase its own message. */
function fail(message, extra) {
  return Object.assign(new Error(message), extra);
}

// Node CLI entry point, guarded because this file is also loaded straight into
// a browser. The wording below is what check.sh reads, so keep it.
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const [modPath, outPath, ...wadPaths] = process.argv.slice(2);
  if (!modPath || !outPath || wadPaths.length === 0) {
    console.error("usage: extract.mjs <module.wasm> <out.whd> <in.wad>");
    process.exit(2);
  }

  let result;
  try {
    result = await extract(
      new Uint8Array(readFileSync(modPath)),
      wadPaths.map((p) => new Uint8Array(readFileSync(p))),
      {
        expectedOutputs: ["whd"],
        onProgress: ({ stage, stages, name }) => {
          if (stage < stages) process.stderr.write(`  [${stage + 1}/${stages}] ${name}\n`);
        },
      },
    );
  } catch (e) {
    if (e.trapped) console.error(`${e.phase} trapped: ${e.message}`);
    else if (e.status !== undefined) console.error(`${e.phase} failed (${e.status}): ${e.message}`);
    else console.error(e.message);
    process.exit(1);
  }

  for (const w of result.warnings) console.error("  warning: " + w);
  writeFileSync(outPath, result.outputs[0].data);
  const len = result.outputs[0].data.length;
  console.error(`ok: ${len} bytes in ${result.ms} ms, ${result.pages} pages ` +
    `(${(result.pages / 16).toFixed(1)} MiB) used`);
}
