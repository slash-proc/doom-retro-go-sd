/*
 * The converter's filesystem: two files, both in linear memory.
 *
 * whd_gen opens its input by name, seeks around it, and writes its output by
 * name. None of that can reach a real filesystem here -- there isn't one, and
 * the whole point of the module is that there cannot be one. So the six stdio
 * calls wad.cpp makes are intercepted with wasm-ld's --wrap and served from
 * two buffers the ABI owns.
 *
 * Interception is by --wrap rather than by redefining fopen, because libc's
 * own stdio must keep working for everything else (a duplicate definition
 * would not link at all). A handle we did not create is passed straight
 * through to __real_*, so printf and friends behave exactly as they would
 * otherwise -- which, with the WASI stubs in place, means they go nowhere.
 *
 * Two details that are not incidental:
 *
 *   1. ftell() must be exact. wad.cpp asserts on it three times and, more
 *      importantly, stores it as whdheader.size. A lazy implementation would
 *      produce a WHD whose header disagrees with its body.
 *   2. The output length is a HIGH-WATER MARK, not the final position.
 *      write_whd() finishes by seeking back to the header and rewriting it, so
 *      the position at fclose() is near the start of the file, not its end.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern FILE *__real_fopen(const char *path, const char *mode);
extern size_t __real_fread(void *p, size_t size, size_t n, FILE *f);
extern size_t __real_fwrite(const void *p, size_t size, size_t n, FILE *f);
extern int __real_fclose(FILE *f);
extern int __real_fseek(FILE *f, long off, int whence);
extern long __real_ftell(FILE *f);
extern int __real_fputc(int c, FILE *f);

/* The names abi.cpp synthesises into argv. Matched exactly, nothing else. */
#define INPUT_NAME  "input.wad"
#define OUTPUT_NAME "output.whd"

typedef struct {
    int used;
    int writing;
    unsigned char *data;   /* input: borrowed. output: owned, realloc'd */
    size_t size;           /* bytes that exist (high-water mark) */
    size_t cap;            /* output only */
    size_t pos;
} memfile;

/*
 * Three slots: the input is opened twice by whd_gen when the stats block is
 * compiled in, and the output once. Static so a handle's address is stable
 * and so is_ours() is a range check rather than bookkeeping.
 */
static memfile g_files[3];

static const unsigned char *g_input;
static size_t g_input_len;

static unsigned char *g_output;
static size_t g_output_len;

void whd_memfs_set_input(const unsigned char *data, size_t len) {
    g_input = data;
    g_input_len = len;
}

const unsigned char *whd_memfs_output(size_t *len) {
    *len = g_output_len;
    return g_output;
}

void whd_memfs_reset(void) {
    for (unsigned i = 0; i < sizeof g_files / sizeof g_files[0]; i++) {
        if (g_files[i].used && g_files[i].writing) free(g_files[i].data);
        memset(&g_files[i], 0, sizeof g_files[i]);
    }
    free(g_output);
    g_output = NULL;
    g_output_len = 0;
    g_input = NULL;
    g_input_len = 0;
}

static int is_ours(FILE *f) {
    return (void *)f >= (void *)&g_files[0] &&
           (void *)f < (void *)&g_files[sizeof g_files / sizeof g_files[0]];
}

FILE *__wrap_fopen(const char *path, const char *mode) {
    if (!path) return NULL;
    int writing = mode && (strchr(mode, 'w') || strchr(mode, 'a'));

    if (!writing && strcmp(path, INPUT_NAME) == 0) {
        if (!g_input) return NULL;
        for (unsigned i = 0; i < sizeof g_files / sizeof g_files[0]; i++) {
            if (g_files[i].used) continue;
            g_files[i].used = 1;
            g_files[i].writing = 0;
            g_files[i].data = (unsigned char *)g_input;
            g_files[i].size = g_input_len;
            g_files[i].pos = 0;
            return (FILE *)&g_files[i];
        }
        return NULL;
    }

    if (writing && strcmp(path, OUTPUT_NAME) == 0) {
        for (unsigned i = 0; i < sizeof g_files / sizeof g_files[0]; i++) {
            if (g_files[i].used) continue;
            g_files[i].used = 1;
            g_files[i].writing = 1;
            g_files[i].data = NULL;
            g_files[i].size = 0;
            g_files[i].cap = 0;
            g_files[i].pos = 0;
            return (FILE *)&g_files[i];
        }
        return NULL;
    }

    /* Any other path is not ours; let libc fail it the way it normally would. */
    return __real_fopen(path, mode);
}

size_t __wrap_fread(void *p, size_t size, size_t n, FILE *f) {
    if (!is_ours(f)) return __real_fread(p, size, n, f);
    memfile *m = (memfile *)f;
    if (size == 0 || n == 0) return 0;
    size_t want = size * n;
    size_t avail = m->pos < m->size ? m->size - m->pos : 0;
    size_t items = (want <= avail) ? n : (avail / size);
    if (items) {
        memcpy(p, m->data + m->pos, items * size);
        m->pos += items * size;
    }
    return items;
}

static int grow(memfile *m, size_t need) {
    if (need <= m->cap) return 1;
    size_t cap = m->cap ? m->cap : 1u << 20;
    while (cap < need) cap += cap / 2;
    unsigned char *p = (unsigned char *)realloc(m->data, cap);
    if (!p) return 0;
    /* Seeking past the end then writing must read back as zeros, not as
       whatever realloc handed us. */
    memset(p + m->cap, 0, cap - m->cap);
    m->data = p;
    m->cap = cap;
    return 1;
}

size_t __wrap_fwrite(const void *p, size_t size, size_t n, FILE *f) {
    if (!is_ours(f)) return __real_fwrite(p, size, n, f);
    memfile *m = (memfile *)f;
    if (!m->writing || size == 0 || n == 0) return 0;
    size_t bytes = size * n;
    if (!grow(m, m->pos + bytes)) return 0;
    memcpy(m->data + m->pos, p, bytes);
    m->pos += bytes;
    if (m->pos > m->size) m->size = m->pos; /* high-water mark */
    return n;
}

int __wrap_fseek(FILE *f, long off, int whence) {
    if (!is_ours(f)) return __real_fseek(f, off, whence);
    memfile *m = (memfile *)f;
    long base = (whence == SEEK_SET) ? 0 : (whence == SEEK_CUR) ? (long)m->pos
                                                                : (long)m->size;
    long want = base + off;
    if (want < 0) return -1;
    m->pos = (size_t)want;
    return 0;
}

long __wrap_ftell(FILE *f) {
    if (!is_ours(f)) return __real_ftell(f);
    return (long)((memfile *)f)->pos;
}

/*
 * write_whd() pads each lump to a word boundary a byte at a time with fputc.
 * Missing it does not merely lose the padding: every following lump lands at
 * the wrong offset. It is the same file, so it goes through the same buffer.
 */
int __wrap_fputc(int c, FILE *f) {
    if (!is_ours(f)) return __real_fputc(c, f);
    unsigned char b = (unsigned char)c;
    return __wrap_fwrite(&b, 1, 1, f) == 1 ? (int)b : -1;
}

int __wrap_fclose(FILE *f) {
    if (!is_ours(f)) return __real_fclose(f);
    memfile *m = (memfile *)f;
    if (m->writing) {
        /* Hand the bytes to the ABI. Ownership moves; the slot keeps nothing. */
        free(g_output);
        g_output = m->data;
        g_output_len = m->size;
    }
    memset(m, 0, sizeof *m);
    return 0;
}
