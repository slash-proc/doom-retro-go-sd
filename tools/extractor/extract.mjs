/*
 * Host runner: verify, instantiate, feed, step, write the output.
 *
 * Mirrors what a real host does (gwrg-dist-spec spec/05-host.md) closely
 * enough to be worth trusting as a test: the module is verified from its own
 * bytes first, instantiated with NO import object at all, and driven through
 * the stepped path rather than run(), so the incremental route is the one the
 * tests cover.
 *
 * The module emits an output ID, not a filename. This runner therefore takes
 * the destination path from its own command line, exactly as a host takes it
 * from the manifest -- nothing about the name comes from the module.
 *
 *   node extract.mjs <module.wasm> <out.whd> <in.wad>
 */
import fs from "node:fs";
import { verify } from "./verify.mjs";

const [modPath, outPath, wadPath] = process.argv.slice(2);
if (!modPath || !outPath || !wadPath) {
  console.error("usage: extract.mjs <module.wasm> <out.whd> <in.wad>");
  process.exit(2);
}

const bytes = new Uint8Array(fs.readFileSync(modPath));
const report = verify(bytes);
if (!report.ok) {
  console.error("module failed verification:");
  for (const p of report.problems) console.error("  - " + p);
  process.exit(1);
}

const { instance } = await WebAssembly.instantiate(bytes, undefined);
const x = instance.exports;

if ((x.abi_version() >>> 0) !== 1) {
  console.error("unsupported ABI version " + x.abi_version());
  process.exit(1);
}

// Never hold a view across a module call: growth detaches the buffer.
const mem = () => new Uint8Array(x.memory.buffer);
const str = (ptr, len) =>
  new TextDecoder("utf-8", { fatal: true }).decode(
    mem().subarray(ptr >>> 0, (ptr >>> 0) + (len >>> 0)),
  );

const wad = new Uint8Array(fs.readFileSync(wadPath));
x.input_clear();
const ptr = x.alloc(wad.length) >>> 0;
if (!ptr) { console.error("alloc failed"); process.exit(1); }
mem().set(wad, ptr);
x.input_add(ptr, wad.length);

const t0 = Date.now();
let rc = x.run_begin(0) >>> 0;
if (rc !== 0) {
  console.error(`run_begin failed (${rc}): ${str(x.error_ptr(), x.error_len())}`);
  process.exit(1);
}

const stages = x.stage_count() >>> 0;
for (let steps = 0; ; steps++) {
  if (steps > 1000) { console.error("module never finished"); process.exit(1); }
  try {
    rc = x.run_step() >>> 0;
  } catch (e) {
    /*
     * A trap, not a return. wasm cannot unwind without the exception-handling
     * proposal, so the converter's own fatal paths end in `unreachable`
     * instead of a status code. The instance's memory survives it, and the
     * module writes the message before trapping, so the reason is still
     * readable -- a host should do exactly this rather than reporting a bare
     * RuntimeError.
     */
    const msg = x.error_len() ? str(x.error_ptr(), x.error_len()) : e.message;
    console.error(`run_step trapped: ${msg}`);
    process.exit(1);
  }
  if (rc === 0) break;
  if (rc !== 1) {
    console.error(`run_step failed (${rc}): ${str(x.error_ptr(), x.error_len())}`);
    process.exit(1);
  }
  const i = x.stage_index() >>> 0;
  if (i < stages) {
    process.stderr.write(`  [${i + 1}/${stages}] ${str(x.stage_name_ptr(i), x.stage_name_len(i))}\n`);
  }
}
const ms = Date.now() - t0;

const warnings = x.warnings_len() ? str(x.warnings_ptr(), x.warnings_len()) : "";
if (warnings) for (const w of warnings.split("\n")) console.error("  warning: " + w);

const n = x.output_count() >>> 0;
if (n !== 1) { console.error(`expected 1 output, got ${n}`); process.exit(1); }

// The module labels its output; it does not name it.
const id = str(x.output_name_ptr(0), x.output_name_len(0));
if (id !== "whd") { console.error(`unexpected output id "${id}"`); process.exit(1); }

const len = x.output_len(0) >>> 0;
const out = new Uint8Array(mem().subarray(x.output_ptr(0) >>> 0, (x.output_ptr(0) >>> 0) + len));
fs.writeFileSync(outPath, out);

const pages = x.memory.buffer.byteLength / 65536;
console.error(`ok: ${len} bytes in ${ms} ms, ${pages} pages (${(pages / 16).toFixed(1)} MiB) used`);
