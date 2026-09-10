# Debug symbols (crash PC/LR → function / line)

This archive matches a Retro-Go SD Doom core release build.

| File | Purpose |
|------|---------|
| `doom.out` | Linked image with DWARF (`-g`). Use for address resolution. |
| `main.map` | Linker map (symbol addresses, section layout). |

## Resolve a crash

From a device log, take the **PC** and **LR** (hex), then:

```bash
arm-none-eabi-addr2line -e doom.out -f -C -a 0x24012abc 0x24004567
```

Example output:

```
0x24012abc
doom_start
/path/to/src/gnw/main_gnw.c:72
0x24004567
…
```

Without a local toolchain, use the builder image:

```bash
docker run --rm -v "$PWD:/w" -w /w sylverb/retro-go-sd-builder:v1.5 \
  arm-none-eabi-addr2line -e doom.out -f -C -a 0x24012abc
```

If you have a checkout of this repo, you can also use:

```bash
python3 scripts/resolve_addr.py --elf doom.out 0x24012abc 0x24004567
```

The packed `.bin` on the SD card is stripped of DWARF; only this ELF is
useful for source-level crash investigation.
