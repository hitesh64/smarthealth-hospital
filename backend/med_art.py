"""Pack pictures for medicines that have no photo: a clean drawing of the pack (blister strip, bottle,
tube, sachet or box) in the colour of the medicine's category, with its name and pack size.
The pharmacy can replace it with a real photo in Admin > Medicine Stock at any time."""
import re
from html import escape

COLORS = {  # main colour, light tint
    "Fever & Pain": ("#dc2626", "#fee2e2"), "Cold & Cough": ("#0284c7", "#e0f2fe"),
    "Stomach & Digestion": ("#16a34a", "#dcfce7"), "Vitamins & Supplements": ("#d97706", "#fef3c7"),
    "First Aid": ("#e11d48", "#ffe4e6"), "Skin Care": ("#9333ea", "#f3e8ff"), "Diabetes": ("#4f46e5", "#e0e7ff"),
    "Baby Care": ("#db2777", "#fce7f3"), "Heart & BP": ("#be123c", "#ffe4e6"), "General": ("#0d9488", "#ccfbf1"),
}
FONT = "Segoe UI, Roboto, Helvetica, Arial, sans-serif"
FORM_WORDS = r"\b(tablets?|capsules?|chewable|syrup|liquid|lotion|cream|gel|ointment|powder|spray|nasal|lozenges?)\b"


def _lines(text, width, most):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    if len(lines) > most:
        lines = lines[:most]
        lines[-1] = lines[-1][: width - 1].rstrip() + "…"
    return lines


def _pack_text(name, description):
    m = re.search(r"((?:Strip|Bottle|Pack) of \d+(?: [a-z]+)?)", description or "")
    if m:
        return m.group(1)
    m = re.search(r"(\d+(?:\.\d+)? ?(?:ml|g|mg)\b|\(\d+[^)]*\))", name)
    return m.group(1).strip("()") if m else ""


def _text(x, y, size, lines, fill, weight=700, gap=1.18):
    out = []
    for i, line in enumerate(lines):
        out.append(f'<text x="{x}" y="{y + i * size * gap:.0f}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
                   f'fill="{fill}" text-anchor="middle">{escape(line)}</text>')
    return "".join(out)


def pack_svg(name, unit, category, description=""):
    main, tint = COLORS.get(category, COLORS["General"])
    title = re.sub(r"\s*\([^)]*\)", "", name).strip()
    short = re.sub(FORM_WORDS, "", title, flags=re.I)
    # the pack label carries the brand only: no strength, size or "pain relief"
    short = re.sub(r"\b\d+(?:\.\d+)?\s?(?:mg|g|ml|%)(?=\s|$)|\bpain relief\b|\bantiseptic\b|\bfruit salt\b", "", short, flags=re.I)
    short = re.sub(r"\s+", " ", short).strip() or title
    label = _lines(short, 11, 2)
    unit = (unit or "").lower()

    if unit.startswith("strip"):
        cavities = "".join(
            f'<circle cx="{150 + c * 75}" cy="{r}" r="25" fill="#ffffff" stroke="#94a3b8" stroke-width="3"/>'
            f'<ellipse cx="{150 + c * 75}" cy="{r}" rx="17" ry="17" fill="{tint}" stroke="{main}" stroke-opacity=".35" stroke-width="2"/>'
            for c in range(5) for r in (322, 392))
        perf = "".join(f'<line x1="{187 + c * 75}" y1="285" x2="{187 + c * 75}" y2="428" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6 6"/>'
                       for c in range(4))
        product = (f'<g transform="rotate(-6 300 320)"><rect x="105" y="195" width="390" height="250" rx="22" fill="url(#foil)" stroke="#94a3b8" stroke-width="2"/>'
                   f'<path d="M127 195h346a22 22 0 0 1 22 22v63H105v-63a22 22 0 0 1 22-22z" fill="{main}"/>'
                   + _text(300, 246 if len(label) == 1 else 232, 34 if len(label) == 1 else 26, label, "#ffffff", 800)
                   + perf + cavities + "</g>")
    elif unit.startswith("bottle"):
        product = (f'<rect x="250" y="168" width="100" height="44" rx="10" fill="#334155"/>'
                   f'<rect x="262" y="206" width="76" height="30" fill="{main}" opacity=".85"/>'
                   f'<path d="M222 262q0-30 40-30h76q40 0 40 30v190q0 26-26 26H248q-26 0-26-26z" fill="url(#body)"/>'
                   f'<rect x="222" y="298" width="156" height="120" fill="#ffffff"/>'
                   f'<rect x="222" y="298" width="156" height="14" fill="{main}"/>'
                   + _text(300, 352 if len(label) == 1 else 342, 28 if len(label) == 1 else 22, label, main, 800)
                   + f'<rect x="236" y="250" width="14" height="190" rx="7" fill="#ffffff" opacity=".35"/>')
    elif unit.startswith("tube"):
        product = (f'<g transform="rotate(-8 300 320)">'
                   f'<rect x="100" y="250" width="34" height="140" rx="4" fill="{main}"/>'
                   + "".join(f'<line x1="{106 + i * 7}" y1="256" x2="{106 + i * 7}" y2="384" stroke="#ffffff" stroke-opacity=".45" stroke-width="2"/>' for i in range(4))
                   + f'<path d="M134 250L420 268v104L134 390z" fill="url(#body)"/>'
                   f'<path d="M420 280h26v80h-26z" fill="#e2e8f0"/><rect x="446" y="282" width="58" height="76" rx="8" fill="#334155"/>'
                   f'<rect x="170" y="290" width="220" height="60" rx="8" fill="#ffffff"/>'
                   + _text(280, 330 if len(label) == 1 else 316, 30 if len(label) == 1 else 22, label, main, 800)
                   + "</g>")
    elif unit.startswith("sachet"):
        zig_top = "".join(f"L{190 + i * 20} {178 if i % 2 else 168}" for i in range(12))
        zig_bot = "".join(f"L{410 - i * 20} {462 if i % 2 else 472}" for i in range(12))
        product = (f'<path d="M180 168{zig_top}L420 168V472{zig_bot}L180 472z" fill="url(#body)"/>'
                   f'<circle cx="300" cy="280" r="54" fill="#ffffff" opacity=".95"/>'
                   f'<path d="M300 246v68M266 280h68" stroke="{main}" stroke-width="16" stroke-linecap="round"/>'
                   + _text(300, 382 if len(label) == 1 else 370, 32 if len(label) == 1 else 25, label, "#ffffff", 800))
    else:  # box / pack
        product = (f'<path d="M168 214L214 176h244l-46 38z" fill="{tint}" stroke="{main}" stroke-opacity=".3" stroke-width="2"/>'
                   f'<path d="M412 214l46-38v232l-46 40z" fill="{main}" opacity=".75"/>'
                   f'<rect x="168" y="214" width="244" height="234" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>'
                   f'<rect x="168" y="214" width="244" height="62" fill="{main}"/>'
                   f'<circle cx="208" cy="245" r="16" fill="#ffffff" opacity=".9"/>'
                   f'<path d="M208 235v20M198 245h20" stroke="{main}" stroke-width="5" stroke-linecap="round"/>'
                   + _text(290, 350 if len(label) == 1 else 338, 32 if len(label) == 1 else 26, label, main, 800)
                   + f'<rect x="196" y="410" width="188" height="10" rx="5" fill="{tint}"/>')

    title_lines = _lines(title, 22, 2)
    pack = _pack_text(name, description)
    pack_line = _text(300, 548, 22, [pack], "#475569", 600) if pack else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">'
            f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="{tint}"/></linearGradient>'
            f'<linearGradient id="foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fafc"/><stop offset=".5" stop-color="#cbd5e1"/><stop offset="1" stop-color="#e2e8f0"/></linearGradient>'
            f'<linearGradient id="body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{main}"/><stop offset=".55" stop-color="{main}" stop-opacity=".82"/><stop offset="1" stop-color="{main}"/></linearGradient></defs>'
            f'<rect width="600" height="600" fill="url(#bg)"/>'
            f'<circle cx="520" cy="80" r="120" fill="{main}" opacity=".06"/><circle cx="70" cy="560" r="90" fill="{main}" opacity=".06"/>'
            + _text(300, 78 if len(title_lines) == 1 else 62, 34, title_lines, "#0f172a", 800, 1.2)
            + f'<ellipse cx="300" cy="488" rx="170" ry="16" fill="#0f172a" opacity=".08"/>'
            + product
            + pack_line
            + f'<text x="300" y="584" font-family="{FONT}" font-size="17" font-weight="700" fill="{main}" text-anchor="middle" letter-spacing="1.5">{escape(category.upper())}</text>'
            + "</svg>")
