/*
 * Port of scripts/build/wadwide.py.
 *
 * The Unity re-release IWADs ship 426- and 560-wide patch art (TITLEPIC,
 * STBAR, INTERPIC, ...). The 320-wide engine cannot draw it: V_DrawPatch's
 * RANGECHECK fires at run time. The host pipeline cropped these before
 * whd_gen ever saw them, so the module has to do the same or it would produce
 * a WHD that converts cleanly and then fails on the device.
 *
 * The crop is lossless and in place. Column pixels are addressed through a
 * columnofs[width] table of intra-lump offsets, so keeping a centered 320-wide
 * window is just: set width to 320, slide the columnofs window by (w-320)/2
 * entries. Pixel data never moves, lump sizes and directory offsets are
 * unchanged.
 *
 * Difference from the Python, and it is deliberate: every read is bounds
 * checked against the buffer. The Python ran on a file a developer chose; this
 * runs on a file a stranger uploaded. A lump that does not fit its own claims
 * is skipped, exactly as a non-patch lump is.
 */
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr int kTargetW = 320;

inline uint32_t rd32(const unsigned char *p) {
    uint32_t v; memcpy(&v, p, 4); return v;
}
inline int32_t rd32s(const unsigned char *p) {
    int32_t v; memcpy(&v, p, 4); return v;
}
inline int16_t rd16(const unsigned char *p) {
    int16_t v; memcpy(&v, p, 2); return v;
}
inline void wr16(unsigned char *p, int16_t v) { memcpy(p, &v, 2); }

} // namespace

/*
 * Crops in place. Returns the number of lumps cropped; `summary` receives the
 * same one-line report the Python printed, which the ABI surfaces as a warning
 * so a user can see their WAD was altered.
 */
int whd_wadwide(std::vector<unsigned char> &data, std::string *summary) {
    if (data.size() < 12) return 0;

    const unsigned char *base = data.data();
    if (memcmp(base, "IWAD", 4) != 0 && memcmp(base, "PWAD", 4) != 0) return 0;

    const int32_t numlumps = rd32s(base + 4);
    const int32_t dirofs = rd32s(base + 8);
    if (numlumps <= 0 || dirofs < 0) return 0;
    if ((uint64_t)dirofs + (uint64_t)numlumps * 16 > data.size()) return 0;

    int cropped = 0;
    std::string names;

    for (int32_t i = 0; i < numlumps; i++) {
        const unsigned char *ent = data.data() + dirofs + 16 * i;
        const int32_t off = rd32s(ent);
        const int32_t size = rd32s(ent + 4);

        char name[9];
        memcpy(name, ent + 8, 8);
        name[8] = '\0';

        if (size < 16 || off < 0) continue;
        if ((uint64_t)off + (uint64_t)size > data.size()) continue;

        unsigned char *lump = data.data() + off;
        const int16_t w = rd16(lump);
        const int16_t h = rd16(lump + 2);
        const int16_t to = rd16(lump + 6);

        if (!(w > kTargetW && w <= 1024 && h > 0 && h <= 200)) continue;

        // The columnofs table must fit inside the lump before it is read.
        if ((uint64_t)8 + 4ull * (uint64_t)w > (uint64_t)size) continue;

        // Sanity: it must really be a patch, i.e. every column offset lands
        // inside the lump.
        bool patch = true;
        for (int c = 0; c < w; c++) {
            if (rd32(lump + 8 + 4 * c) >= (uint32_t)size) { patch = false; break; }
        }
        if (!patch) continue;

        const int start = (w - kTargetW) / 2;
        std::vector<unsigned char> window(lump + 8 + 4 * start,
                                          lump + 8 + 4 * (start + kTargetW));
        wr16(lump + 0, (int16_t)kTargetW);
        wr16(lump + 2, h);
        wr16(lump + 4, 0);   // leftoffset, as the Python sets it
        wr16(lump + 6, to);
        memcpy(lump + 8, window.data(), window.size());

        cropped++;
        if (summary) {
            char buf[64];
            snprintf(buf, sizeof buf, "%s%s(%dx%d)", names.empty() ? "" : " ",
                     name, (int)w, (int)h);
            names += buf;
        }
    }

    if (summary && cropped) {
        *summary = "cropped " + std::to_string(cropped) +
                   " widescreen lumps to " + std::to_string(kTargetW) +
                   "w: " + names;
    }
    return cropped;
}
