"""Text-Vorverarbeitung für die Stimme.

Macht aus Post-Texten sprechbaren Text: Zahlen, Preise, Abkürzungen,
Sonderzeichen werden ausgeschrieben, URLs/Hashtags/Emojis entfernt.
Reine Standardbibliothek, keine Abhängigkeiten.
"""
from __future__ import annotations

import re

EINER = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun",
         "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn",
         "achtzehn", "neunzehn"]
ZEHNER = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig",
          "neunzig"]


def _unter_hundert(n: int, als_vorsilbe: bool = False) -> str:
    if n < 20:
        if n == 1 and als_vorsilbe:
            return "ein"
        return EINER[n]
    z, e = divmod(n, 10)
    if e == 0:
        return ZEHNER[z]
    vor = "ein" if e == 1 else EINER[e]
    return f"{vor}und{ZEHNER[z]}"


def _unter_tausend(n: int, als_vorsilbe: bool = False) -> str:
    h, rest = divmod(n, 100)
    teile = []
    if h:
        teile.append(("ein" if h == 1 else EINER[h]) + "hundert")
    if rest or not h:
        teile.append(_unter_hundert(rest, als_vorsilbe))
    return "".join(teile)


def zahl_zu_wort(n: int) -> str:
    """0 … 999 999 als deutsches Zahlwort. Größere Zahlen werden ziffernweise gesprochen."""
    if n < 0:
        return "minus " + zahl_zu_wort(-n)
    if n < 1000:
        return _unter_tausend(n)
    if n < 1_000_000:
        t, rest = divmod(n, 1000)
        vorn = "eintausend" if t == 1 else _unter_tausend(t, als_vorsilbe=True) + "tausend"
        return vorn + (_unter_tausend(rest) if rest else "")
    return " ".join(EINER[int(z)] for z in str(n))


ABKUERZUNGEN = [
    (r"\bz\.\s?B\.", "zum Beispiel"),
    (r"\bbzw\.", "beziehungsweise"),
    (r"\bca\.", "circa"),
    (r"\binkl\.", "inklusive"),
    (r"\bggf\.", "gegebenenfalls"),
    (r"\busw\.", "und so weiter"),
    (r"\bNr\.", "Nummer"),
    (r"\bevtl\.", "eventuell"),
    (r"\bu\.\s?a\.", "unter anderem"),
    (r"\bd\.\s?h\.", "das heißt"),
    (r"\bUStG\b", "Umsatzsteuergesetz"),
    (r"\bUSt\.?", "Umsatzsteuer"),
    (r"\bgem\.", "gemäß"),
    (r"\bStd\.", "Stunden"),
    (r"\bMin\.", "Minuten"),
    (r"\bDE\b", "Deutschland"),
]

# URLs ohne das Satzzeichen dahinter („…/x.“ → der Punkt bleibt Satzende)
_URL = re.compile(r"(https?://\S+?|www\.\S+?|\b[\w-]+\.(?:com|de|net|org|shop)\b\S*?)(?=[.,;:!?)]*(?:\s|$))", re.I)
_HASHTAG = re.compile(r"(?<!\w)[#@][\w\-]+")
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF⭐⬆✅❌️‍]+"
)
_PREIS = re.compile(r"(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*(?:€|Euro)")
_EURO = re.compile(r"(\d+)\s*€")
_PROZENT = re.compile(r"(\d+)\s*%")
_PARAGRAF = re.compile(r"§\s*(\d+)")
_ZEIT = re.compile(r"\b(\d{1,2}):(\d{2})\s*(?:Uhr)?\b")
_DEZIMAL = re.compile(r"(\d+),(\d+)")
_CM = re.compile(r"(\d+)\s*cm\b")
_STUNDEN = re.compile(r"(\d+)\s*(?:h|Std)\b")
_MAL = re.compile(r"(\d+)\s*[x×]\s*(\d+)")
_INT = re.compile(r"\d+")


def _sprich_zahl(m: re.Match) -> str:
    s = m.group(0)
    return zahl_zu_wort(int(s)) if len(s) <= 6 else " ".join(EINER[int(z)] for z in s)


def normalisieren(text: str) -> str:
    """Macht Text sprechbar. Gibt einen String ohne URLs/Hashtags/Emojis zurück.

    Domains werden nicht gesprochen – sie gehören auf die Endcard, nicht in den Ton.
    """
    t = text.replace("\r\n", "\n")
    t = _URL.sub(" ", t)
    # „Mehr auf <Domain>“ → der Rest „Mehr auf“ wäre ein halber Satz, weg damit
    t = re.sub(r"(?:(?:Mehr|Alles|Infos|Jetzt|Link)\s+)?(?:auf|unter|bei)\s*(?=[.!?\n]|$)", "", t, flags=re.I)
    # verwaiste Satzzeichen („Satz. .!“) nach dem Entfernen von Links
    t = re.sub(r"(?:^|(?<=[.!?\n]))\s*[.!?]+", "", t)
    t = _HASHTAG.sub(" ", t)
    t = _EMOJI.sub(" ", t)
    for muster, ersatz in ABKUERZUNGEN:
        t = re.sub(muster, ersatz, t)
    t = _PARAGRAF.sub(lambda m: "Paragraf " + m.group(1), t)
    t = _PREIS.sub(lambda m: f"{zahl_zu_wort(int(m.group(1).replace('.', '')))} Euro"
                   + ("" if m.group(2) == "00" else f" {zahl_zu_wort(int(m.group(2)))}"), t)
    t = _EURO.sub(lambda m: f"{zahl_zu_wort(int(m.group(1)))} Euro", t)
    t = _PROZENT.sub(lambda m: f"{zahl_zu_wort(int(m.group(1)))} Prozent", t)
    # zweite Zahl bleibt Ziffer, damit "70 cm" danach zu "siebzig Zentimeter" wird
    t = _MAL.sub(lambda m: f"{zahl_zu_wort(int(m.group(1)))} mal {m.group(2)}", t)
    t = _CM.sub(lambda m: f"{zahl_zu_wort(int(m.group(1)))} Zentimeter", t)
    t = _STUNDEN.sub(lambda m: f"{zahl_zu_wort(int(m.group(1)))} Stunden", t)
    t = _ZEIT.sub(lambda m: f"{zahl_zu_wort(int(m.group(1)))} Uhr"
                  + ("" if m.group(2) == "00" else f" {zahl_zu_wort(int(m.group(2)))}"), t)
    t = _DEZIMAL.sub(lambda m: f"{zahl_zu_wort(int(m.group(1)))} Komma "
                     + " ".join(EINER[int(z)] for z in m.group(2)), t)
    t = t.replace("×", " mal ").replace("&", " und ").replace("+", " plus ")
    t = _INT.sub(_sprich_zahl, t)
    t = re.sub(r"\s*[–—-]{1,2}\s+", ", ", t)
    t = re.sub(r"[\"„“”»«*_`~]", "", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r" +([,.;:!?])", r"\1", t)
    t = re.sub(r"\n[ \t]*\n+", "\n\n", t)
    return t.strip()


_SATZ = re.compile(r"(?<=[.!?…])\s+(?=[A-ZÄÖÜ„\"(])")


def saetze(text: str) -> list[str]:
    """Teilt in Sätze. Ein leerer String markiert eine Absatzpause."""
    out: list[str] = []
    absaetze = [a.strip() for a in re.split(r"\n\s*\n", text) if a.strip()]
    for i, absatz in enumerate(absaetze):
        flach = re.sub(r"\s*\n\s*", " ", absatz)
        for s in _SATZ.split(flach):
            s = s.strip()
            if s and re.search(r"[A-Za-zÄÖÜäöüß0-9]", s):
                out.append(s)
        if i < len(absaetze) - 1:
            out.append("")
    return out


if __name__ == "__main__":
    import sys
    print(normalisieren(sys.stdin.read()))
