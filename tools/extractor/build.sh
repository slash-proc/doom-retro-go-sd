#!/usr/bin/env bash
# Build doom_whd.wasm.
#
# The toolchain is wasi-sdk in a container, so nothing has to be installed on
# the machine doing the build and everyone gets the same clang. The engine
# sources come from the rp2040-doom submodule unmodified except for the error
# path (see whd_compat.h); the four files in src/ are the module itself.
set -euo pipefail
cd "$(dirname "$0")/../.."          # repo root

IMAGE="${WASI_SDK_IMAGE:-ghcr.io/webassembly/wasi-sdk:latest}"
OUT="tools/extractor/doom_whd.wasm"

# 8192 pages = 512 MiB, and the number is measured, not copied.
#
# The module peaks at 3571 pages (223 MiB) converting Doom II, the largest IWAD
# on hand. Capping at 4096 would leave 525 pages of headroom, which is too thin
# to promise: TNT and Plutonia are larger WADs than Doom II and were not
# available to measure. 8192 is a comfortable multiple of the worst case
# actually observed. The manifest publishes whatever the binary declares as
# limits.maxMemoryPages, so the two cannot disagree.
MAX_MEMORY=536870912

# The exact ABI surface. Anything missing is a broken module and anything extra
# is unreviewed surface area, so the verifier rejects both -- which is why this
# list is written out rather than using --export-all.
EXPORTS=(
  abi_version alloc input_clear input_add run run_begin run_step
  stage_count stage_index stage_name_ptr stage_name_len
  output_count output_name_ptr output_name_len output_ptr output_len
  error_ptr error_len warnings_ptr warnings_len
)

# whd_gen reaches the "filesystem" through these six. --wrap rather than
# redefinition, so libc's own stdio keeps working for everything else.
WRAPS=(fopen fread fwrite fclose fseek ftell fputc)

E=rp2040-doom/src
G=$E/whd_gen
INC="-I$E -I$E/doom -I$G -I$E/adpcm-xq -Itools/extractor/src"

CFLAGS_COMMON="-O2 -w -include tools/extractor/src/wasi_compat.h $INC -DIS_WHD_GEN=1 -DWHD_GEN_STATS=0"
# main() becomes whd_gen_main so abi.cpp can call it; the source keeps its
# main() and the native oracle build is unaffected.
# -fno-exceptions is forced, not preferred. wasm cannot unwind without the
# exception-handling proposal, and neither can setjmp; and of the two toolchains
# that offer it, wasi-sdk 24 ships no EH-enabled libc++abi at all, while the
# current one emits exnref-based EH that today's browsers and Node refuse to
# compile. Building without it also keeps the module free of a tag section,
# so the conformance verifier stays exactly as it is for every project that
# vendors it. See whd_compat.h for what the error paths do instead.
CXXFLAGS="$CFLAGS_COMMON -std=gnu++17 -Dmain=whd_gen_main -fno-exceptions -DWHD_NO_EXCEPTIONS=1"

LDFLAGS="-nostartfiles -Wl,--strip-all -Wl,--no-entry -Wl,--max-memory=$MAX_MEMORY -Wl,-z,stack-size=1048576"
for e in "${EXPORTS[@]}"; do LDFLAGS="$LDFLAGS -Wl,--export=$e"; done
for w in "${WRAPS[@]}"; do LDFLAGS="$LDFLAGS -Wl,--wrap=$w"; done

exec docker run --rm -v "$PWD:/w" -w /w --entrypoint sh "$IMAGE" -c "
set -e
CC=/opt/wasi-sdk/bin/clang
CXX=/opt/wasi-sdk/bin/clang++
T=--target=wasm32-wasip1
mkdir -p /tmp/o

# C sources: the engine's decoders, plus the WASI stubs and the memory 'files'.
for f in $E/tiny_huff.c $E/musx_decoder.c $E/image_decoder.c $E/adpcm-xq/adpcm-lib.c; do
  \$CC \$T $CFLAGS_COMMON -c \$f -o /tmp/o/\$(basename \$f .c).o
done
\$CC \$T -O2 -c tools/extractor/src/stubs.c -o /tmp/o/stubs.o
\$CC \$T -O2 -w -c tools/extractor/src/memfs.c -o /tmp/o/memfs.o

# C++ sources: the converter, and the module around it.
\$CXX \$T $CXXFLAGS \\
  $G/whd_gen.cpp $G/mus2seq.cpp $G/huff.cpp $G/lodepng.cpp $G/compress_mus.cpp $G/wad.cpp \\
  tools/extractor/src/abi.cpp tools/extractor/src/wadwide.cpp \\
  /tmp/o/*.o \\
  $LDFLAGS -o $OUT
"
