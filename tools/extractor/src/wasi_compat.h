/*
 * Force-included first in every translation unit of the wasm build.
 *
 * whddata.h builds texture-name tables with __STRING() and __CONCAT(), which
 * are glibc's <sys/cdefs.h> spellings, not standard C. wasi-libc has no reason
 * to provide them, so the macros expand to nothing and every name in
 * NAMED_TEXTURE_LIST looks like an undeclared identifier.
 *
 * Defining them here rather than editing whddata.h keeps the engine header
 * identical between the native oracle and the module, which is the property
 * the whole parity argument rests on.
 */
#ifndef WHD_WASI_COMPAT_H
#define WHD_WASI_COMPAT_H

#ifndef __STRING
#define __STRING(x) #x
#endif

#ifndef __CONCAT
#define __CONCAT(a, b) a##b
#endif

#endif
