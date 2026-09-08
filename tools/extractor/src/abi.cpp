/*
 * The wasm processor ABI for the Doom WAD -> WHD converter
 * (gwrg-dist-spec spec/04-processor.md, wasm/1).
 *
 * Everything the outside world can reach is in this file: 20 functions and a
 * linear memory. There is no import, no host callback and no filesystem --
 * whd_gen's fopen/fread/fwrite reach memfs.c and nothing else.
 *
 * The module LABELS its outputs, it does not name them. output_name_* returns
 * the id "whd" from the manifest's tools[].outputs[], never a filename: the
 * host resolves the name from the matched variant or from the user's own file,
 * so a module cannot propose a path, an extension, or a name that collides
 * with something already on the card.
 *
 * Stages exist because a module that imports nothing cannot report progress by
 * calling out, and its memory is not shared, so the host cannot watch a
 * counter either. Work is therefore divided into steps that RETURN. The
 * conversion itself is one indivisible call into whd_gen_main -- splitting it
 * would mean dissecting 600 lines of main() into resumable phases for a run
 * that takes a few seconds -- so the three stages are the boundaries that
 * genuinely exist: prepare the WAD, convert it, publish the bytes.
 */
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "whd_compat.h"

extern "C" {
void whd_memfs_set_input(const unsigned char *data, size_t len);
const unsigned char *whd_memfs_output(size_t *len);
void whd_memfs_reset(void);
void __wasm_call_ctors(void);
}

int whd_wadwide(std::vector<unsigned char> &data, std::string *summary);

/*
 * whd_gen.cpp's main(), renamed at compile time with -Dmain=whd_gen_main.
 * Not extern "C": once the macro has renamed it, it is an ordinary C++
 * function and is mangled like one. main() itself would not have been.
 */
int whd_gen_main(int argc, const char **argv);

namespace {

/* ---- module state ----------------------------------------------------- */

bool g_ctors_done = false;

struct Input {
    const unsigned char *ptr;
    size_t len;
};

std::vector<Input> g_inputs;
std::vector<unsigned char> g_wad;      /* mutable copy: wadwide crops in place */
std::vector<unsigned char> g_result;   /* the finished WHD */

std::string g_error;
std::string g_warnings;
const char *const kOutputId = "whd";   /* an id, NOT a filename */

const char *const kStages[] = { "Reading WAD", "Converting", "Writing" };
constexpr uint32_t kStageCount = sizeof kStages / sizeof kStages[0];

uint32_t g_stage = 0;
bool g_running = false;
bool g_done = false;

/* Errors are reported, never thrown across the ABI boundary. */
enum : uint32_t {
    kOk = 0,
    kMore = 1,
    kErrBadInput = 2,
    kErrConvert = 3,
    kErrState = 4,
};

void ensure_ctors() {
    /*
     * Built with -nostartfiles and --no-entry, so nothing runs at
     * instantiation: there is no start section and no _initialize export for a
     * host to call (either would be an export the ABI does not declare). The
     * module therefore runs its own static constructors, once, before any
     * state they touch is used. whd_gen has plenty of them -- the lump tables
     * are std::map globals.
     */
    if (!g_ctors_done) {
        g_ctors_done = true;
        __wasm_call_ctors();
    }
}

void warn(const std::string &w) {
    if (w.empty()) return;
    if (!g_warnings.empty()) g_warnings += "\n";
    g_warnings += w;
}

} // namespace

#if !WHD_USE_EXCEPTIONS
/*
 * The no-exceptions build's error path. Unusable as things stand -- wasm has
 * no way to unwind without the exception-handling proposal, and setjmp needs
 * it too -- so this records the message and traps. The message is still
 * readable at error_ptr afterwards, because a trap does not invalidate the
 * instance's memory.
 */
[[noreturn]] void whd_error(const std::string &msg) {
    g_error = msg;
    __builtin_trap();
}
#endif

/* ---- exports ----------------------------------------------------------- */

extern "C" {

uint32_t abi_version(void) { return 1; }

uint32_t alloc(uint32_t len) {
    ensure_ctors();
    if (len == 0) len = 1;
    void *p = malloc(len);
    return (uint32_t)(uintptr_t)p;
}

void input_clear(void) {
    ensure_ctors();
    g_inputs.clear();
}

uint32_t input_add(uint32_t ptr, uint32_t len) {
    ensure_ctors();
    g_inputs.push_back(Input{ (const unsigned char *)(uintptr_t)ptr, (size_t)len });
    return (uint32_t)(g_inputs.size() - 1);
}

uint32_t run_begin(uint32_t flags) {
    ensure_ctors();

    /*
     * Options are declared empty in the manifest: -no-super-tiny and
     * -raw-columns are baked in because they must match the shipped core, so
     * there is no bit a caller could legitimately set.
     */
    (void)flags;

    g_error.clear();
    g_warnings.clear();
    g_result.clear();
    g_stage = 0;
    g_done = false;
    g_running = false;
    whd_memfs_reset();

    if (g_inputs.size() != 1) {
        g_error = "expected exactly one WAD, got " + std::to_string(g_inputs.size());
        return kErrBadInput;
    }
    if (g_inputs[0].len < 12) {
        g_error = "file is too small to be a WAD";
        return kErrBadInput;
    }

    g_running = true;
    return kOk;
}

uint32_t run_step(void) {
    if (!g_running) {
        g_error = "run_step called without run_begin";
        return kErrState;
    }
    if (g_done) return kOk;

    switch (g_stage) {
    case 0: {
        /* Reading WAD: take a mutable copy and crop widescreen patch art. */
        g_wad.assign(g_inputs[0].ptr, g_inputs[0].ptr + g_inputs[0].len);
        if (memcmp(g_wad.data(), "IWAD", 4) != 0 &&
            memcmp(g_wad.data(), "PWAD", 4) != 0) {
            g_error = "file is not a WAD (no IWAD/PWAD signature)";
            g_running = false;
            return kErrBadInput;
        }
        /*
         * Validate the directory before whd_gen sees it.
         *
         * This is not belt-and-braces: the input is not strict, so a file that
         * matches no known IWAD hash still reaches this module, and a
         * truncated or hand-edited WAD is a thing users genuinely have. Down
         * inside the converter the same file reports "Failed to read N bytes"
         * and, with no way to unwind on wasm, that becomes a trap -- a dead
         * instance and no status for the host. Catching it here turns the
         * common cases back into an ordinary error return with a message.
         */
        {
            const unsigned char *b = g_wad.data();
            int32_t numlumps, dirofs;
            memcpy(&numlumps, b + 4, 4);
            memcpy(&dirofs, b + 8, 4);
            if (numlumps <= 0 || dirofs < 0 ||
                (uint64_t)dirofs + (uint64_t)numlumps * 16 > g_wad.size()) {
                g_error = "WAD directory is out of range: the file looks truncated";
                g_running = false;
                return kErrBadInput;
            }
            for (int32_t i = 0; i < numlumps; i++) {
                const unsigned char *ent = b + dirofs + 16 * i;
                int32_t off, len;
                memcpy(&off, ent, 4);
                memcpy(&len, ent + 4, 4);
                if (off < 0 || len < 0 ||
                    (uint64_t)off + (uint64_t)len > g_wad.size()) {
                    char name[9];
                    memcpy(name, ent + 8, 8);
                    name[8] = '\0';
                    g_error = std::string("lump \"") + name +
                              "\" runs past the end of the file: it looks truncated";
                    g_running = false;
                    return kErrBadInput;
                }
            }
        }

        std::string summary;
        if (whd_wadwide(g_wad, &summary)) warn(summary);
        whd_memfs_set_input(g_wad.data(), g_wad.size());
        g_stage = 1;
        return kMore;
    }
    case 1: {
        /* Converting: whd_gen, with the flags the shipped core requires. */
        const char *argv[] = { "whd_gen", "input.wad", "output.whd",
                               "-no-super-tiny", "-raw-columns" };
#if WHD_USE_EXCEPTIONS
        try {
            int rc = whd_gen_main(5, argv);
            if (rc != 0) {
                g_error = "conversion failed (code " + std::to_string(rc) + ")";
                g_running = false;
                return kErrConvert;
            }
        } catch (const std::exception &e) {
            g_error = e.what();
            g_running = false;
            return kErrConvert;
        } catch (...) {
            g_error = "conversion failed";
            g_running = false;
            return kErrConvert;
        }
#else
        int rc = whd_gen_main(5, argv);
        if (rc != 0) {
            g_error = "conversion failed (code " + std::to_string(rc) + ")";
            g_running = false;
            return kErrConvert;
        }
#endif
        g_stage = 2;
        return kMore;
    }
    case 2:
    default: {
        /* Writing: take the bytes memfs collected. */
        size_t len = 0;
        const unsigned char *out = whd_memfs_output(&len);
        if (!out || len == 0) {
            g_error = "conversion produced no output";
            g_running = false;
            return kErrConvert;
        }
        g_result.assign(out, out + len);
        whd_memfs_reset();
        g_wad.clear();
        g_wad.shrink_to_fit();
        g_stage = kStageCount;
        g_done = true;
        g_running = false;
        return kOk;
    }
    }
}

uint32_t run(uint32_t flags) {
    uint32_t rc = run_begin(flags);
    if (rc != kOk) return rc;
    for (;;) {
        rc = run_step();
        if (rc == kMore) continue;
        return rc;
    }
}

uint32_t stage_count(void) { return kStageCount; }
uint32_t stage_index(void) { return g_stage; }

uint32_t stage_name_ptr(uint32_t i) {
    if (i >= kStageCount) return 0;
    return (uint32_t)(uintptr_t)kStages[i];
}
uint32_t stage_name_len(uint32_t i) {
    if (i >= kStageCount) return 0;
    return (uint32_t)strlen(kStages[i]);
}

uint32_t output_count(void) { return g_result.empty() ? 0u : 1u; }

uint32_t output_name_ptr(uint32_t i) {
    if (i != 0 || g_result.empty()) return 0;
    return (uint32_t)(uintptr_t)kOutputId;
}
uint32_t output_name_len(uint32_t i) {
    if (i != 0 || g_result.empty()) return 0;
    return (uint32_t)strlen(kOutputId);
}
uint32_t output_ptr(uint32_t i) {
    if (i != 0 || g_result.empty()) return 0;
    return (uint32_t)(uintptr_t)g_result.data();
}
uint32_t output_len(uint32_t i) {
    if (i != 0) return 0;
    return (uint32_t)g_result.size();
}

uint32_t error_ptr(void) { return (uint32_t)(uintptr_t)g_error.data(); }
uint32_t error_len(void) { return (uint32_t)g_error.size(); }
uint32_t warnings_ptr(void) { return (uint32_t)(uintptr_t)g_warnings.data(); }
uint32_t warnings_len(void) { return (uint32_t)g_warnings.size(); }

} // extern "C"
