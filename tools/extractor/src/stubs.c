/*
 * Local definitions of every WASI syscall wasi-libc would otherwise import.
 *
 * This is what makes the module import NOTHING (gwrg-dist-spec
 * spec/04-processor.md, "The security property"). wasi-libc declares each
 * syscall as an undefined symbol carrying import_module/import_name
 * attributes; an undefined symbol that later finds a DEFINITION in another
 * object is resolved by wasm-ld as an ordinary call, and no import is emitted.
 * So defining them here does not "shim" or "sandbox" anything -- it removes
 * the module's ability to reach a host at all, which is then checkable from
 * the binary rather than taken on trust.
 *
 * Every one returns __WASI_ERRNO_NOSYS. Nothing in the converter's path calls
 * them: real file I/O is served by memfs.c over the input and output blobs,
 * and stdio writes are swallowed. They exist because libc references them,
 * not because anything needs them to work.
 *
 * Signatures are matched to wasi-libc's at the WASM level (i32/i64), which is
 * what wasm-ld checks. The WASI headers are deliberately not included: these
 * are link-level replacements, not API implementations.
 */
#include <stdint.h>

#define NOSYS 52 /* __WASI_ERRNO_NOSYS */

#define STUB(name, ...) \
    int32_t __imported_wasi_snapshot_preview1_##name(__VA_ARGS__); \
    int32_t __imported_wasi_snapshot_preview1_##name(__VA_ARGS__)

STUB(args_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(args_sizes_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(environ_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(environ_sizes_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(clock_res_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(clock_time_get, int32_t a, int64_t b, int32_t c) { (void)a; (void)b; (void)c; return NOSYS; }
STUB(random_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(sched_yield, void) { return NOSYS; }
STUB(poll_oneoff, int32_t a, int32_t b, int32_t c, int32_t d) { (void)a; (void)b; (void)c; (void)d; return NOSYS; }

STUB(fd_close, int32_t a) { (void)a; return NOSYS; }
STUB(fd_datasync, int32_t a) { (void)a; return NOSYS; }
STUB(fd_sync, int32_t a) { (void)a; return NOSYS; }
STUB(fd_fdstat_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(fd_fdstat_set_flags, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(fd_filestat_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(fd_read, int32_t a, int32_t b, int32_t c, int32_t d) { (void)a; (void)b; (void)c; (void)d; return NOSYS; }
STUB(fd_write, int32_t a, int32_t b, int32_t c, int32_t d) { (void)a; (void)b; (void)c; (void)d; return NOSYS; }
STUB(fd_pread, int32_t a, int32_t b, int32_t c, int64_t d, int32_t e) { (void)a; (void)b; (void)c; (void)d; (void)e; return NOSYS; }
STUB(fd_pwrite, int32_t a, int32_t b, int32_t c, int64_t d, int32_t e) { (void)a; (void)b; (void)c; (void)d; (void)e; return NOSYS; }
STUB(fd_seek, int32_t a, int64_t b, int32_t c, int32_t d) { (void)a; (void)b; (void)c; (void)d; return NOSYS; }
STUB(fd_tell, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(fd_prestat_get, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(fd_prestat_dir_name, int32_t a, int32_t b, int32_t c) { (void)a; (void)b; (void)c; return NOSYS; }
STUB(fd_readdir, int32_t a, int32_t b, int32_t c, int64_t d, int32_t e) { (void)a; (void)b; (void)c; (void)d; (void)e; return NOSYS; }
STUB(fd_renumber, int32_t a, int32_t b) { (void)a; (void)b; return NOSYS; }
STUB(fd_advise, int32_t a, int64_t b, int64_t c, int32_t d) { (void)a; (void)b; (void)c; (void)d; return NOSYS; }
STUB(fd_allocate, int32_t a, int64_t b, int64_t c) { (void)a; (void)b; (void)c; return NOSYS; }
STUB(fd_filestat_set_size, int32_t a, int64_t b) { (void)a; (void)b; return NOSYS; }
STUB(fd_filestat_set_times, int32_t a, int64_t b, int64_t c, int32_t d) { (void)a; (void)b; (void)c; (void)d; return NOSYS; }

STUB(path_open, int32_t a, int32_t b, int32_t c, int32_t d, int32_t e, int64_t f, int64_t g, int32_t h, int32_t i)
    { (void)a; (void)b; (void)c; (void)d; (void)e; (void)f; (void)g; (void)h; (void)i; return NOSYS; }
STUB(path_filestat_get, int32_t a, int32_t b, int32_t c, int32_t d, int32_t e) { (void)a; (void)b; (void)c; (void)d; (void)e; return NOSYS; }
STUB(path_create_directory, int32_t a, int32_t b, int32_t c) { (void)a; (void)b; (void)c; return NOSYS; }
STUB(path_unlink_file, int32_t a, int32_t b, int32_t c) { (void)a; (void)b; (void)c; return NOSYS; }
STUB(path_remove_directory, int32_t a, int32_t b, int32_t c) { (void)a; (void)b; (void)c; return NOSYS; }
STUB(path_readlink, int32_t a, int32_t b, int32_t c, int32_t d, int32_t e, int32_t f) { (void)a; (void)b; (void)c; (void)d; (void)e; (void)f; return NOSYS; }

/*
 * proc_exit is the one that cannot return: libc calls it from exit() and
 * abort(), and its wasm signature has no result. A trap is the honest
 * behaviour -- the host sees the instance die rather than a run that silently
 * reports success. abi.cpp arranges for the converter's own failure paths to
 * return an error code long before anything reaches here.
 */
_Noreturn void __imported_wasi_snapshot_preview1_proc_exit(int32_t code);
_Noreturn void __imported_wasi_snapshot_preview1_proc_exit(int32_t code) {
    (void)code;
    __builtin_trap();
}
