"""Qualitäts-Gate für Captions (Spec: Abschnitt „Qualitäts-Gate“).

Das Gate prüft nur, es ändert nichts. Jede Verletzung ist ein deutscher Satz.
"""
from __future__ import annotations

import re
import unicodedata

PRICE_LINE = "Endpreis, gem. § 19 UStG ohne USt.-Ausweis"
PRICE = "79,99"
# Die 6 Shop-Größen je Ausrichtung (Hochformat und Querformat)
ALLOWED_SIZES = {
    (28, 36), (30, 46), (41, 51), (46, 61), (51, 76), (61, 91),
    (36, 28), (46, 30), (51, 41), (61, 46), (76, 51), (91, 61),
}

# --- Verbotene Sprache -------------------------------------------------------
# Der Text wird in Wörter zerlegt (Kleinbuchstaben; Bindestriche verschmelzen:
# „Black-Friday“ → „blackfriday“, „Holz-Rahmen“ → „holzrahmen“; Satzzeichen trennen).
# Regeln je Eintrag: "start" = Wortanfang, "in" = irgendwo im Wort, "end" = Wortende,
# "word" = ganzes Wort, "seq" = Wortfolge.
DISCOUNT_RULES = [
    ("sale", "in"), ("code", "start"), ("code", "end"), ("deal", "in"), ("spar", "start"),
    ("rabatt", "in"), ("gutschein", "in"), ("coupon", "in"), ("kupon", "in"), ("gratis", "in"), ("discount", "in"),
    ("schnäppchen", "in"), ("promocode", "in"), ("aktionscode", "in"),
    ("blackfriday", "in"), ("blackweek", "in"), ("cyberweek", "in"), ("cybermonday", "in"),
    ("prozent", "in"), ("angebot", "in"), ("aktion", "start"),
    ("sonderpreis", "in"), ("einführungspreis", "in"), ("vorteilspreis", "in"), ("kennenlernpreis", "in"),
    ("bestpreis", "in"), ("aktionspreis", "in"), ("nachlass", "end"), ("nachlass", "word"), ("nachlässe", "end"),
    ("nachlasses", "end"), ("nachlässen", "end"),
    ("herbstaktion", "in"), ("weihnachtsaktion", "in"), ("sparaktion", "in"), ("rabattaktion", "in"),
    ("sommeraktion", "in"), ("winteraktion", "in"), ("osteraktion", "in"), ("adventsaktion", "in"),
    ("nikolausaktion", "in"), ("sonderaktion", "in"), ("neujahrsaktion", "in"), ("aktionswoche", "in"),
    ("2für1", "in"), ("3für2", "in"), ("blackweekend", "in"),
    ("zum preis von", "seq"), ("2 für 1", "seq"), ("3 für 2", "seq"), ("drei für zwei", "seq"), ("zwei für eins", "seq"),
    ("halben preis", "seq"), ("halber preis", "seq"), ("cyber week", "seq"), ("cyber monday", "seq"),
    ("black friday", "seq"), ("black week", "seq"), ("black weekend", "seq"), ("kostenlos dazu", "seq"),
    ("geschenkt dazu", "seq"), ("statt", "word"),
]
MATERIAL_RULES = [
    ("premium", "in"), ("material", "in"), ("hochwertig", "in"), ("museumsqualität", "in"),
    ("museumsglas", "in"), ("holzrahmen", "in"), ("alurahmen", "in"), ("metallrahmen", "in"),
    ("eichenrahmen", "in"), ("kunststoffrahmen", "in"), ("massivholz", "in"), ("echtholz", "in"),
    ("acryl", "in"), ("plexiglas", "in"), ("echtglas", "in"), ("glasscheibe", "in"), ("hinter glas", "seq"),
    ("leinwand", "in"), ("leinwänd", "in"), ("museumsgläs", "in"), ("canvas", "in"), ("mdf", "start"),
    ("aluminium", "start"), ("alu", "word"),
    ("plastik", "start"), ("papier", "in"), ("fineart", "in"),
    ("fine art", "seq"), ("entspiegelt", "start"), ("glas", "word"), ("glases", "word"), ("kunststoff", "start"),
    ("eiche", "word"), ("lichtecht", "in"), ("säurefrei", "start"),
]
# Harmlose Wörter (als Präfix geprüft: „kolossal“ deckt kolossale/kolossaler …).
ALLOWED_WORDS = {
    "qrcode", "dresscode", "farbcode", "barcode", "zipcode", "sparsam", "spartan", "salerno",
    "salento", "salem", "jerusalem", "schicksal", "rinnsal", "kolossal", "universal", "basal",
    "mühsal", "codex", "sparen", "sparst", "sparte", "ideal", "hundertprozent", "papierkram",
}
ALLOWED_EXACT = {"spart"}  # nur als ganzes Wort erlaubt („spart Platz“), nicht „Spartipp“
# Lieferzeit-Versprechen: Je Satz (getrennt an . ! ? : ; · und Zeilenumbruch) muss
# eine Dauer („in 3–5 Tagen“, „innerhalb von zwei Tagen“, „48h“) UND ein Lieferwort stehen;
# dazu feste Wendungen. Zahlen über der Einheitsgrenze (h 96, Tage 14, Wochen 6) sind
# keine Lieferzeit („in 365 Tagen“, „in 30 Tagen zur Gewohnheit“).
def _rx(pattern: str) -> str:
    """Umlaute im Muster auch in ae/oe/ue/ss-Umschrift zulassen (fuenf, naechsten,
    Geschaeftstag). Idempotent: ein schon umgeschriebenes Muster bleibt unverändert."""
    pattern = (pattern.replace("(?:ä|ae)", "ä").replace("(?:ö|oe)", "ö")
               .replace("(?:ü|ue)", "ü").replace("(?:ß|ss)", "ß"))
    return (pattern.replace("ä", "(?:ä|ae)").replace("ö", "(?:ö|oe)")
            .replace("ü", "(?:ü|ue)").replace("ß", "(?:ß|ss)"))


_D = r"(?:ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)"
_ONES = r"(?:dreizehn|vierzehn|fünfzehn|sechzehn|siebzehn|achtzehn|neunzehn|eins|ein|eine|einer|einem|einen|eines|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)"
_TENS = r"(?:zwanzig|dreißig|vierzig|fünfzig|sechzig|siebzig|achtzig|neunzig)"
_NUMWORD = _rx(
    rf"(?:{_D}?(?:hundert|tausend)(?:{_D}und)?(?:{_TENS}|{_ONES})?"
    rf"|{_D}und{_TENS}|{_TENS}|{_ONES}einhalb|eineinhalb|anderthalb|{_ONES}"
    rf"|paar|wenige|wenigen|weniger|einige|einigen|einiger)"
)
_DUR_UNIT = _rx(r"(h|std|stunden?|(?:werk\s*|arbeits\s*|geschäfts\s*)?tag(?:e|en|es)?|tg|tägig\w*|wochen?)")
_NUM = rf"(\d{{1,3}}|{_NUMWORD})"
_RANGE = rf"(?:\s*(?:bis|–|-)?\s*(?:\d{{1,3}}|{_NUMWORD}))?"  # „3–5“ wird zu „3 5“ normalisiert
# Eine Dauer irgendwo im Satz: „3–5 Tage“, „48h“, „zwei bis drei Tagen“, „eines Tages“, „3+ Tagen“
DURATION_RE = rf"\b{_NUM}{_RANGE}[\s+]*{_DUR_UNIT}\b"


_WORD_VALUES = {"ein": 1, "eins": 1, "eine": 1, "einer": 1, "einem": 1, "einen": 1, "eines": 1, "zwei": 2, "drei": 3, "vier": 4,
                "fünf": 5, "fuenf": 5, "sechs": 6, "sieben": 7, "acht": 8, "neun": 9, "zehn": 10, "elf": 11, "zwölf": 12, "zwoelf": 12,
                "dreizehn": 13, "vierzehn": 14, "fünfzehn": 15, "fuenfzehn": 15, "sechzehn": 16, "siebzehn": 17, "achtzehn": 18,
                "neunzehn": 19, "zwanzig": 20, "dreißig": 30, "dreissig": 30, "vierzig": 40, "fünfzig": 50, "fuenfzig": 50,
                "sechzig": 60, "siebzig": 70, "achtzig": 80, "neunzig": 90, "hundert": 100, "tausend": 1000, "anderthalb": 1.5,
                "eineinhalb": 1.5}


def _word_to_number(w: str) -> float | None:
    """Zahlwort → Zahl („vierundzwanzig“ → 24, „zweihundert“ → 200, „dreieinhalb“ → 3.5); None, wenn unbekannt."""
    w = w.lower()
    if w.isdigit():
        return float(w)
    if w in _WORD_VALUES:
        return float(_WORD_VALUES[w])
    if w.endswith("einhalb") and w[:-7] in _WORD_VALUES:
        return _WORD_VALUES[w[:-7]] + 0.5
    for big, val in (("tausend", 1000), ("hundert", 100)):
        if big in w:
            head, _, tail = w.partition(big)
            head_v = _WORD_VALUES.get(head, 1) if head else 1
            tail_v = _word_to_number(tail.removeprefix("und")) if tail else 0
            return head_v * val + (tail_v or 0)
    if "und" in w:
        a, _, b = w.partition("und")
        if a in _WORD_VALUES and b in _WORD_VALUES:
            return float(_WORD_VALUES[a] + _WORD_VALUES[b])
    return None


def _limit_for(unit: str) -> int:
    u = unit.replace(" ", "")
    if u.startswith(("h", "std", "stund")):
        return 96
    if u.startswith("woche"):
        return 6
    return 14
# Lieferwörter als Stämme; liefer* deckt Lieferung/geliefert/liefert, schick* nur als Paarpartner einer Dauer
_LIEFER_CORE = r"(?:liefer|versand|verschick|versend|zustell|zugestellt|schick)"
_LIEFER_DUR = rf"(?:{_LIEFER_CORE}|bei dir|an deiner wand|garantiert|dauert|dauer\b|\braus\b|\bda\b|bestellung|unterwegs|auf dem weg|komm\w*\b.{{0,24}}\ban\b|ankomm|angekomm)"
_LIEFER_EXT = rf"(?:{_LIEFER_CORE}|bei dir|an deiner wand|garantiert|komm\w*\b.{{0,24}}\ban\b|ankomm|angekomm|ist dein poster da)"
_LIEFER_FEST = _LIEFER_EXT
_FEST = r"(?:weihnachten|heiligabend|ostern|nikolaus|valentinstag|muttertag|vatertag|silvester|neujahr|fest|feiertagen|feiertage|advent)"
_ART = r"(?:dem\s+|den\s+|der\s+|das\s+|die\s+)?"
_MONAT = _rx(r"(?:januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|\d{1,2})")
DELIVERY_PATTERNS = [_rx(p) for p in [  # feste Wendungen, je Satz
    # Liefertermin „morgen bei dir“, nicht das Nomen („jeden Morgen bei dir“, „fang morgen da an“)
    r"(?<!jeden )(?<!am )(?<!guten )(?<!den )(?<!der )(?<!jeder )(?<!diesen )(?<!jedem )\b(?:morgen|übermorgen)\s+(?:ist es\s+|schon\s+)?(?:bei dir|an deiner wand)\b",
    r"(?<!jeden )(?<!am )(?<!guten )(?<!den )(?<!der )(?<!jeder )(?<!diesen )(?<!jedem )\b(?:morgen|übermorgen)\s+(?:ist es\s+|schon\s+)?da\b(?!\s+an\b)",
    r"\bheute bestellt\b",
    r"\b(?:lieferzeit|lieferdauer|versanddauer|versandzeit|expressversand|expresslieferung|schnellversand|sofortversand|sofort lieferbar)",
    r"\bexpress\b",
    r"\bwerktäg",
    r"\bwerktag",
]]
# Paare: (Muster A, Muster B, strong) – beide im selben Satz; strong = auch an : ; · trennen.
# Das erste Paar ist die Dauer-Regel; nur dort gilt die Einheitsgrenze (_duration_ok).
DELIVERY_SENTENCE_PAIRS = [(_rx(a), _rx(b), st) for a, b, st in [
    (DURATION_RE, _LIEFER_DUR, False),
    (r"schnell", _LIEFER_EXT, True),
    (r"\bsofort", _LIEFER_EXT, True),
    (r"\bsame day\b", _LIEFER_EXT, True),
    (r"\bam\s+(?:nächsten|gleichen|selben|folgenden)\s+tag\b", _LIEFER_DUR, True),
    (rf"\b(?:vor|bis|zu|zum|bis zum|noch vor)\s+{_ART}{_FEST}\b", _LIEFER_FEST, True),
    (rf"\b(?:bis|vor|spätestens)\s+(?:zum\s+|am\s+|dem\s+)?\d{{1,2}}\s+{_MONAT}\b", _LIEFER_FEST, True),
    (r"\b(?:rechtzeitig|pünktlich|puenktlich)\b", _LIEFER_FEST, True),
    (rf"\b(?:rechtzeitig|pünktlich|puenktlich)\s+(?:zu|zum|vor|für|fürs|zur)\s+{_ART}{_FEST}\b", r".", True),
]]
_ABBREV = ["ca.", "max.", "min.", "std.", "tg.", "evtl.", "inkl.", "zzgl.", "ggf.", "bzw.", "z.b.", "z. b.", "u.a.", "u. a.", "sog."]
# Flache Liste für Dokumentation und config/platforms.json (gate.forbiddenWords)
FORBIDDEN_WORDS = sorted({w for w, _ in DISCOUNT_RULES} | {w for w, _ in MATERIAL_RULES})
BRANDS = [
    "nike", "adidas", "ikea", "disney", "marvel", "ferrari", "apple", "samsung", "netflix",
    "lego", "porsche", "marlboro", "batman", "wimbledon", "formula 1", "formula one", "formel 1", "formel eins", "f1",
    "just do it", "red bull", "mercedes", "bmw", "audi", "lamborghini", "rolex", "gucci",
    "louis vuitton", "chanel", "dior", "supreme",
]
# Kurze Markennamen, die in Alltagswörtern stecken (Audio, Legal …): nur als ganzes Wort
SHORT_WHOLE_WORD = {"audi", "dior"}
PERSONS = [
    "messi", "ronaldo", "cristiano", "neymar", "jordan", "franklin", "federer", "nadal",
    "djokovic", "dokovic", "schumacher", "verstappen", "hamilton", "senna", "kobe", "lebron", "mbappé",
    "mbappe", "haaland", "jobs", "musk", "einstein", "ali",
]

HASHTAG_RE = r"(?<![\w#])#[A-Za-zÄÖÜäöüß][\w]*"
PRICE_RE = r"\b(\d{1,4}),(\d{2})\s?€"
# Jeder Geldbetrag: „79,99 €“, „59 €“, „1.299,00 €“, „€79,99“, „79,99 EUR“, „ab 59,99“
_AMT = r"(\d{1,3}(?:\.\d{3})+|\d+)([,.]\d{1,2}|[,.][-–—]{1,2})?"
_AMT_DEC = r"(\d{1,3}(?:\.\d{3})+|\d+)([,.]\d{1,2}|[,.][-–—]{1,2})"
_UNIT = r"(?!\s*(?:m|cm|mm|km|kg|g|l|%|x|×|meter|metern|zentimeter|millimeter|kilo|liter)\b)"  # kein Preis: „1,50 m“
_CUR = r"(?:€|euros?\b|eur\b)"
MONEY_RE = (
    rf"(?<![\d.,]){_AMT}[\s\-–]*{_CUR}"                 # 79,99 €  ·  59 €  ·  79,- Euro  ·  100-Euro-Wand
    rf"|€[\s\-]*{_AMT}"                                  # €79,99  ·  € 1.299,00
    rf"|(?:\bEUR|\bEuro)\s*{_AMT_DEC}"                  # EUR 79,99 · EUR79,99 (nicht: EURO 2028)
    rf"|(?<![\d.,×x])\b(\d{{1,4}})(,\d{{2}}|[,.][-–—]{{1,2}})(?![\d%]){_UNIT}"  # 79,99 · 79,- · 79.- ohne Währung
)
# Preis in Worten („unter hundert Euro“, „Achtzig-Euro-Poster“) – nie erlaubt, Preise werden in Ziffern geschrieben
WORD_PRICE_RE = rf"\b(?:{_NUMWORD})[\s\-–]*(?:€|euros?\b|eur\b)"
SIZE_RE = r"(?<!\d)(\d{2,3})\s*(?:cm)?\s*[×xX]\s*(\d{2,3})(?!\d)"
LINK_RE = r"https?://\S+"
# Du-/Ihr-Ansprache (LinkedIn verboten): Pronomen überall; Imperative nur als erstes Wort eines Satzes
# (Textanfang oder nach . ! ? : – — ) · bzw. „ - “ oder Zeilenumbruch, auch hinter →/👉/Anführungszeichen/Listenmarkern
# wie „1)“, „1 ·“, „1 “, „1️⃣“, „#1“, „1/“) und nicht vor Ergänzungsstrich („Stell- und Hängeflächen“).
DU_PRONOUN_RE = re.compile(
    r"(?<![\w#])(?:du|dich|dir|dein|deine|deinem|deinen|deiner|deines|deins|euch|euer|eure|eurem|euren|eurer|eures)(?![\w\-])", re.I)
DU_IMPERATIVES = {
    "schreib", "schreibe", "stell", "mach", "zeig", "zeige", "hol", "hole", "nimm", "guck", "lass", "schau",
    "sag", "wähl", "wähle", "waehl", "waehle", "probier", "probiere", "entdeck", "entdecke", "bestell", "bestelle",
    "kommentier", "kommentiere", "markier", "markiere", "speichere", "tagge", "häng", "hänge", "haeng", "haenge",
    "tippe", "finde", "verlinke", "erzähl", "erzähle", "erzaehl", "misch", "mische", "halte", "leg", "lege", "achte",
    "denk", "denke", "vergiss", "gib", "sieh", "lies", "swipe", "besuch", "besuche", "plane", "nutze",
}
# Nomen-/Adjektiv-Zwillinge nur mit typischem Imperativ-Objekt („Tag für Tag“, „Speicher und Flur“, „Teil der Kollektion“,
# „Schick in Schwarz“, „Der Check“ bleiben frei). klick: auch Präpositionen („Klick zum Shop“); schick: keine Präpositionen;
# folge/teil(e): keine Dativ-/Genitiv-Artikel („Folgt die Wand“, „Teile der Kollektion“).
_OBJ_BASE = {"hier", "es", "das", "den", "die", "uns", "mal", "jetzt", "mir", "einfach", "ihn", "sie", "ihm", "mich",
             "diesen", "dieses", "diese"}
_OBJ_PERSON = {"jemanden", "jemand", "einen", "eine", "deinen", "deine", "dein"}
DU_IMPERATIVES_WITH_OBJECT = {
    "klick": _OBJ_BASE | {"auf", "zum", "zur", "ins", "in", "dem", "der"}, "klicke": _OBJ_BASE | {"auf", "zum", "zur", "ins", "in", "dem", "der"},
    "schick": _OBJ_BASE | {"dem", "der"}, "schicke": _OBJ_BASE | {"dem", "der"},
    "folge": _OBJ_BASE, "teile": _OBJ_BASE, "teil": _OBJ_BASE,
    "tag": _OBJ_BASE | _OBJ_PERSON, "speicher": _OBJ_BASE, "check": _OBJ_BASE | {"ob", "mal"}, "checke": _OBJ_BASE | {"ob"},
    "starte": _OBJ_BASE | {"mit", "bei", "im"},  # „Starte und Ziele“ (Nomen) bleibt frei
}
_SENTENCE_START_RE = re.compile(
    r"(?:^|[.!?:\n–—)·/]|\s-\s)[^\w]*(?:\d+[\W_]*)?([^\W\d_]\w*)(-?)(?:[ \t]+([^\W\d_]\w*))?", re.U)


def du_form_hits(text: str) -> list[str]:
    """Treffer der Du-/Ihr-Ansprache: Pronomen überall, Imperative nur am Satzanfang (nicht vor „-“)."""
    text = text or ""
    hits = [m.group(0).lower() for m in DU_PRONOUN_RE.finditer(text)]
    for m in _SENTENCE_START_RE.finditer(text):
        word, hyphen, nxt = m.group(1).lower(), m.group(2), (m.group(3) or "").lower()
        if hyphen:
            continue
        if word in DU_IMPERATIVES or nxt in DU_IMPERATIVES_WITH_OBJECT.get(word, ()):
            hits.append(word)
    return hits


def _rules(rules: dict | None) -> dict:
    """Gate-Regeln aus config/platforms.json oder die Konstanten als Fallback."""
    r = rules or {}
    return {
        "priceLine": r.get("priceLine", PRICE_LINE),
        "price": r.get("price", PRICE),
        "allowedSizes": {tuple(s) for s in r.get("allowedSizes", [])} or ALLOWED_SIZES,
        "discountRules": [tuple(x) for x in r.get("discountRules", DISCOUNT_RULES)]
        + ([(w, "start") for w in r.get("forbiddenWords", [])] if "discountRules" not in r else []),
        "materialRules": [tuple(x) for x in r.get("materialRules", MATERIAL_RULES)],
        "deliveryPatterns": r.get("deliveryPatterns", DELIVERY_PATTERNS),
        "deliveryPairs": [tuple(x) for x in r.get("deliveryPairs", DELIVERY_SENTENCE_PAIRS)],
        "allowedWords": set(r.get("allowedWords") or []) | ALLOWED_WORDS,
        "brands": r.get("brands") or BRANDS,
        "persons": r.get("persons") or PERSONS,
        "exemptTexts": list(r.get("exemptTexts") or []),
    }


_APOSTROPHES = "’‘‛´ʼ`′"
_DASHES = "–—"
_FOLD_TABLE = str.maketrans({c: "'" for c in _APOSTROPHES} | {c: "-" for c in _DASHES})


def _fold_chars(text: str) -> str:
    """Apostroph- und Gedankenstrich-Varianten vereinheitlichen (’ ‘ ‛ ´ ʼ ` ′ → ', – — → -)."""
    return (text or "").translate(_FOLD_TABLE)


def _fold_marks(text: str) -> str:
    """_clean, dann Whitespace-Folgen (auch Zeilenumbrüche) → ein Leerzeichen, Enden getrimmt."""
    return re.sub(r"\s+", " ", _clean(text)).strip()


def clean_text(text: str) -> str:
    """Öffentliche Textbereinigung des Gates (Längen werden daran gemessen)."""
    return _clean(text)


def fold_marks(text: str) -> str:
    """Öffentliche Faltung für Vergleiche außerhalb des Gates (Apostrophe, Striche, NFKC, Whitespace)."""
    return _fold_marks(text)


def _clean(text: str) -> str:
    """Unicode-Normalisierung: Apostroph-/Strich-Faltung (vor NFKC, das ´ sonst in „ ́“ zerlegt), NFKC,
    unsichtbare Zeichen raus, Sonder-Bindestriche und Sonderleerzeichen vereinheitlicht,
    Ausrufezeichen-Varianten → „!“."""
    t = re.sub(r"[\u2122\u00ae\u00a9]", " ", _fold_chars(text or ""))  # ™ ® © entfernen (NFKC würde „TM“ ankleben)
    t = unicodedata.normalize("NFKC", t)
    t = re.sub(r"[\u00ad\u200b\u200c\u200d\u2060\ufeff]", "", t)
    t = re.sub(r"[\u2010\u2011\u2012\u2212]", "-", t)
    t = re.sub(r"[\u00a0\u202f\u2007\t]", " ", t)
    t = re.sub(r" {2,}", " ", t)
    return re.sub(r"[\uff01\u2757\u203c\u2755]", "!", t)


def _fold(text: str) -> str:
    """Diakritika entfernen (Đoković → dokovic, Mbappé → mbappe) für Marken/Personen."""
    t = text.replace("Đ", "D").replace("đ", "d").replace("ł", "l").replace("Ł", "L").replace("ø", "o").replace("Ø", "O")
    t = unicodedata.normalize("NFKD", t)
    return "".join(c for c in t if not unicodedata.combining(c))


def _umlaut_variants(term: str) -> list[str]:
    """Zusätzliche Umschrift ae/oe/ue/ss für Regeln mit Umlauten."""
    tr = term.translate(str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}))
    return [term] if tr == term else [term, tr]


def _normalize(text: str) -> str:
    """Kleinbuchstaben; Bindestriche verschmelzen („Holz-Rahmen“ → „holzrahmen“)."""
    return re.sub(r"[\-–—_]", "", text.lower())


def _words(text: str) -> list[str]:
    return re.findall(r"[0-9a-zäöüß]+", _normalize(text))


def _words_with_parts(text: str) -> list[tuple[str, list[str]]]:
    """Je Wort das verschmolzene Wort und seine Bindestrich-Teile („extra-premium-qualität“)."""
    out = []
    for token in re.findall(r"[0-9a-zäöüß\-–—_]+", text.lower()):
        parts = [p for p in re.split(r"[\-–—_]+", token) if p]
        merged = "".join(parts)
        if merged:
            out.append((merged, parts if len(parts) > 1 else []))
    return out


def _match_mode(w: str, t: str, mode: str) -> bool:
    return (mode == "start" and w.startswith(t)) or (mode == "end" and w.endswith(t)) \
        or (mode == "in" and t in w) or (mode == "word" and w == t)


def _allowed_for(w: str, t: str, allowed: set[str]) -> bool:
    """Ein Erlaubt-Präfix neutralisiert nur Treffer, die in den Präfix hineinreichen
    (qrcode → code, ideal → deal, schicksal(e) → sale), nicht Verbotsteile dahinter
    (universal|gutschein, ideal|angebot)."""
    if w in ALLOWED_EXACT:
        return True
    for a in allowed:
        if w.startswith(a):
            starts = [m.start() for m in re.finditer(re.escape(t), w)]
            if starts and all(st < len(a) for st in starts):
                return True
            if not starts:
                return True
    return False


def _rule_hits(rules: list[tuple[str, str]], text: str, allowed: set[str]) -> list[str]:
    words = _words_with_parts(text)
    seq = " " + " ".join(w for w, _ in words) + " "
    hits: list[str] = []
    for term, mode in rules:
        for t in _umlaut_variants(_normalize(term)):
            if mode == "seq":
                if f" {t} " in seq or f" {t}s " in seq:
                    hits.append(term)
                    break
                continue
            found = False
            for w, parts in words:
                if _allowed_for(w, t, allowed):
                    continue
                if _match_mode(w, t, mode) or any(_match_mode(p, t, mode) and not _allowed_for(p, t, allowed) for p in parts):
                    found = True
                    break
            if found:
                hits.append(term)
                break
    return hits


def _sentences(text: str, strong: bool = False) -> list[str]:
    norm = re.sub(r" {2,}", " ", re.sub(r"[\-–—_()+]", " ", text.lower()))
    for ab in _ABBREV:
        norm = re.sub(rf"(?<![a-zäöüß]){re.escape(ab)}", ab.replace(".", "").replace(" ", ""), norm)
    norm = re.sub(r"(?<=\d)\.(?=\s*(?:\d|[a-zäöü]))", " ", norm)  # „24. Dezember“, „18.12.“ sind keine Satzenden
    seps = r"[.!?:;·\n]+" if strong else r"[.!?\n]+"
    return [x.strip() for x in re.split(seps, norm) if x.strip()]


def _duration_ok(m: re.Match) -> bool:
    """False, wenn die Zahl über der Einheitsgrenze liegt (dann keine Lieferzeit)."""
    groups = [g for g in m.groups() if g]
    unit = groups[-1] if groups else ""
    nums = [n for n in (_word_to_number(g) for g in groups[:-1]) if n is not None]
    if nums and max(nums) > _limit_for(unit):
        return False
    return True


def _delivery_hits(patterns: list[str], pairs: list[tuple], text: str) -> list[str]:
    out = []
    for sent in _sentences(text):
        for pat in patterns:
            m = re.search(pat, sent)
            if m:
                out.append(m.group(0).strip())
    for idx, (a, b, strong) in enumerate(pairs):
        is_duration = idx == 0
        for sent in _sentences(text, strong=bool(strong)):
            if not re.search(b, sent):
                continue
            for ma in re.finditer(a, sent):
                if not is_duration or _duration_ok(ma):
                    out.append(ma.group(0).strip())
                    break
            else:
                continue
            break
    return out


def _brand_hits(brands: list[str], text: str, whole_word: bool = False) -> list[str]:
    """Marken: am Wortanfang (Lego, Legosteine, Disneys) oder als Teil eines Hashtags
    (#ikeahack); Kurznamen (≤ 3 Zeichen oder SHORT_WHOLE_WORD, z. B. f1, audi) und
    Personen nur als ganzes Wort (optional Genitiv-s) oder als Hashtag-Anfang mit
    Ziffern-Suffix (#messi10); Wortfolgen („formel 1“, „just do it“) innerhalb eines
    Satzes oder zusammengeschrieben in einem Wort (#justdoit, Formel1-Feeling)."""
    hits = []
    text = _fold(text)
    sentences = _sentences(text, strong=True)
    words = _words(text)
    for b in brands:
        bl = _fold(b.lower())
        if " " in bl:
            sq = bl.replace(" ", "")
            if any(re.search(rf"\b{re.escape(bl)}\b", sent) for sent in sentences) or any(sq in w for w in words):
                hits.append(b)
        elif whole_word or len(bl) <= 3 or bl in SHORT_WHOLE_WORD:
            if re.search(rf"\b{re.escape(bl)}s?\b", text, re.I) or re.search(rf"#{re.escape(bl)}(?![a-zäöüß])", text, re.I):
                hits.append(b)
        elif re.search(rf"\b{re.escape(bl)}", text, re.I) or re.search(rf"#\w*{re.escape(bl)}\w*", text, re.I):
            hits.append(b)
    return hits


def _normalize_amount(euro: str, cent: str) -> str:
    """„79.99“ → „79,99“; „1.299,00“ bleibt; „79,-“ bleibt."""
    if cent.startswith("."):
        cent = "," + cent[1:]
    return euro + cent


def _amounts(text: str) -> list[str]:
    """Alle Geldbeträge im Text als Strings („79,99“, „59“, „1.299,00“, „79,-“)."""
    out = []
    for groups in re.findall(MONEY_RE, text, re.I):
        pairs = [(groups[i], groups[i + 1]) for i in range(0, len(groups), 2)]
        e, c = next((e, c) for e, c in pairs if e)
        out.append(_normalize_amount(e, c))
    return out


def check_caption(platform: str, text: str, limits: dict, rules: dict | None = None) -> list[str]:
    """Verstöße einer Caption gegen die Plattform-Limits; leer = bestanden."""
    r = _rules(rules)
    limits = limits or {}
    text = _clean(text)
    v: list[str] = []

    if "!" in text:
        v.append("Ausrufezeichen im Text")

    n = len(text)
    min_len = limits.get("minLen") or 0
    max_len = limits.get("maxLen")
    if n < min_len:
        v.append(f"Text zu kurz ({n} < {min_len})")
    if max_len is not None and n > max_len:
        v.append(f"Text zu lang ({n} > {max_len})")

    hook_max = limits.get("hookMax")
    if hook_max:
        first = text.split("\n", 1)[0]
        if len(first) > hook_max:
            v.append(f"Hook zu lang ({len(first)} > {hook_max})")

    hashtags = limits.get("hashtags")
    try:
        lo, hi = int(hashtags[0] or 0), int(hashtags[1] or 0)
    except (TypeError, ValueError, IndexError, KeyError):
        lo, hi = 0, 0
    tags = re.findall(HASHTAG_RE, text)
    if not (lo <= len(tags) <= hi):
        v.append(f"Hashtags: {len(tags)}, erlaubt {lo}–{hi}")

    links = re.findall(LINK_RE, text)
    mode = limits.get("links", "none")
    if mode in ("none", "firstComment"):
        if links:
            v.append("Link im Text nicht erlaubt")
    elif mode == "required":
        if not links:
            v.append("Produktlink fehlt")
    elif mode == "end":
        lines = [ln for ln in text.split("\n") if ln.strip()]
        if any(re.search(LINK_RE, ln) for ln in lines[:-1]):
            v.append("Link nur als letzte Zeile erlaubt")

    amounts = _amounts(text)
    if re.search(WORD_PRICE_RE, text, re.I):
        v.append("Preis in Caption nicht erlaubt" if limits.get("noPrice") else "Preis in Worten nicht erlaubt (Ziffern verwenden)")
    if limits.get("noPrice") and "€" in text:
        v.append("Preis in Caption nicht erlaubt")  # auf TikTok auch ein nacktes €
    if amounts:
        if limits.get("noPrice"):
            v.append("Preis in Caption nicht erlaubt")
        else:
            for amount in amounts:
                if amount != r["price"]:
                    v.append(f"Preis {amount} ist nicht {r['price']}")
            if limits.get("priceLine") and r["priceLine"] not in text:
                v.append("Preis ohne §-19-Zeile")

    for a, b in re.findall(SIZE_RE, text):
        if (int(a), int(b)) not in r["allowedSizes"]:
            v.append(f"Unbekannte Größe {a} × {b} cm")

    text_without_links = re.sub(LINK_RE, " ", text)
    for w in _rule_hits(r["discountRules"] + r["materialRules"], text_without_links, r["allowedWords"]):
        v.append(f"Verbotenes Wort: {w}")
    for m in _delivery_hits(r["deliveryPatterns"], r["deliveryPairs"], text_without_links):
        v.append(f"Verbotenes Wort: {m}")
    if "%" in text_without_links:
        v.append("Verbotenes Wort: %")
    text_for_brands = text_without_links
    for t in r["exemptTexts"]:
        t = _fold_marks(str(t or ""))
        if t:
            text_for_brands = re.sub(rf"(?<!\w){re.escape(t)}(?!\w)", " ", text_for_brands, flags=re.I)
    for b in _brand_hits(r["brands"], text_for_brands):
        v.append(f"Marke genannt: {b}")
    for p in _brand_hits(r["persons"], text_for_brands, whole_word=True):
        v.append(f"Person genannt: {p}")
    if platform == "linkedin":  # Spec: LinkedIn in Wir-Form, keine Du-Ansprache (Produkttitel ausgenommen)
        for w in du_form_hits(text_for_brands):
            v.append(f"Du-Form auf LinkedIn: {w}")

    return list(dict.fromkeys(v))


def check_title(title: str, rules: dict | None = None) -> list[str]:
    """Textregeln für den TikTok-Titel (`network.title` = Hook, Spec Anhang A): kein „!“, kein Preis, keine Rabatt-,
    Material- oder Lieferzeit-Sprache, keine Marken/Personen (eigener Shop-Titel ausgenommen). Leer = bestanden."""
    r = _rules(rules)
    t = _clean(title or "")
    v: list[str] = []
    if "!" in t:
        v.append("Titel: Ausrufezeichen")
    if "€" in t or _amounts(t) or re.search(WORD_PRICE_RE, t, re.I):
        v.append("Titel: Preis")
    if "%" in t:
        v.append("Titel: %")
    for w in _rule_hits(r["discountRules"] + r["materialRules"], t, r["allowedWords"]):
        v.append(f"Titel: Verbotenes Wort: {w}")
    if _delivery_hits(r["deliveryPatterns"], r["deliveryPairs"], t):
        v.append("Titel: Lieferzeit")
    text_for_brands = t
    for x in r["exemptTexts"]:
        x = _fold_marks(str(x or ""))
        if x:
            text_for_brands = re.sub(rf"(?<!\w){re.escape(x)}(?!\w)", " ", text_for_brands, flags=re.I)
    for b in _brand_hits(r["brands"], text_for_brands):
        v.append(f"Titel: Marke genannt: {b}")
    for pers in _brand_hits(r["persons"], text_for_brands, whole_word=True):
        v.append(f"Titel: Person genannt: {pers}")
    return list(dict.fromkeys(v))


# --- Item-Prüfung -------------------------------------------------------------
from dataclasses import dataclass, field  # noqa: E402


@dataclass
class GateResult:
    passed: bool
    violations: list[str] = field(default_factory=list)


MEDIA_RULES = {
    "reel": "video", "video": "video", "post": (2, 7), "photos": (2, 10), "story": (1, 1),
    "update": (1, 1), "document": (2, 7), "image": (1, 1),
}
TEXT_FREE_TYPES = {"story"}  # Stories haben keine Caption
ALT_PLATFORMS = {"instagram", "facebook", "linkedin"}
PRODUCT_NAME_PLATFORMS = {"facebook", "linkedin", "gbp"}  # dort nennt die Vorlage products[0] immer
TITLE_PLATFORMS = {"tiktok"}  # Spec Anhang A: tiktokData.title = Hook – Pflicht, mit den Textregeln geprüft (LOG Task 7)
LINK_MODES = {"none", "firstComment", "required", "end"}
LINK_ITEM_MODES = {"required", "firstComment", "end"}  # item.link ist Pflicht (Text, letzte Zeile bzw. erster Kommentar)
LINK_TEXT_MODES = {"required", "end"}  # item.link muss im Text stehen, andere Links sind fremd
GATE_KEYS = ("minLen", "maxLen", "hashtags", "links", "hookMax", "priceLine", "noPrice")
ALT_MAX = 100
VIDEO_USES = {"main+poster"}
SINGLE_IMAGE_USES = {"poster", "slides.tt[0]", "slides.ig[0]"}
MULTI_USES = {"slides.ig", "slides.tt"}
KNOWN_USES = VIDEO_USES | SINGLE_IMAGE_USES | MULTI_USES
STORY_USES = {"poster", "slides.tt[0]"}  # 9:16-Quellen
ALLOWED_USES = {  # Cross-Posting-Matrix (Spec): welcher Verweis für welchen Typ
    ("facebook", "reel"): {"main+poster"}, ("facebook", "post"): {"slides.ig"}, ("facebook", "story"): STORY_USES,
    ("linkedin", "video"): {"main+poster"}, ("linkedin", "document"): {"slides.ig"},
    ("linkedin", "image"): {"slides.ig[0]"},  # Matrix: Reel-Cover → LinkedIn nein
    ("gbp", "update"): {"slides.ig[0]", "poster"},
    ("tiktok", "video"): {"main+poster"}, ("tiktok", "photos"): {"slides.tt"},
}


def normalize(s: str) -> str:
    """’→', Gedankenstriche→-, Whitespace-Folgen→ein Leerzeichen, Kleinbuchstaben."""
    return _fold_marks(s).lower()


def motif_key(shop_title: str) -> str:
    """Motivname aus dem Shop-Titel: vor „ – “/„ — “/„ - “, vor „,“ und vor „ (“ (NBSP zählt als Leerzeichen)."""
    t = re.sub(r"\s+", " ", _clean(shop_title or ""))
    t = re.split(r" [–—-] ", t, maxsplit=1)[0]
    return t.split(",")[0].split(" (")[0].strip()


def motif_phrase(shop_title: str) -> str:
    """Titel vor dem Gedankenstrich, Komma inklusive („No Risk, No Porsche“)."""
    t = re.sub(r"\s+", " ", _clean(shop_title or ""))
    return re.split(r" [–—-] ", t, maxsplit=1)[0].strip()


def product_named(key: str, text: str) -> bool:
    """Motivschlüssel als ganze Wortfolge im Text, schreibweisengenau (Groß/Klein) nach
    Apostroph-/Strich-Faltung: „FOCUS“ ≠ „Focus on You“ (Ruling Task 3)."""
    key_n, text_n = _fold_marks(key), _fold_marks(text)
    if not key_n:
        return True
    return re.search(rf"(?<!\w){re.escape(key_n)}(?!\w)", text_n) is not None


def product_mentioned(key: str, text: str) -> bool:
    """Motivschlüssel als Wortfolge im Text, ohne Rücksicht auf Groß/Klein."""
    key_n, text_n = _fold_marks(key), _fold_marks(text)
    return bool(key_n) and re.search(rf"(?<!\w){re.escape(key_n)}(?!\w)", text_n, re.I) is not None


def _tags_text(tags) -> str:
    if isinstance(tags, (list, tuple)):
        return " ".join(str(t) for t in tags if t).strip()
    return str(tags or "").strip()


def post_text(item: dict) -> str:
    """Text, wie er gepostet wird: Caption, plus Tags nur, wenn sie nicht schon darin stehen."""
    caption = str(item.get("caption") or "")
    tags = _tags_text(item.get("tags"))
    if tags and tags not in caption:
        return f"{caption}\n\n{tags}" if caption else tags
    return caption


def _ref_count(item: dict) -> int | None:
    rc = item.get("refCount")
    try:
        return int(rc) if rc is not None and str(rc).strip() != "" else None
    except (TypeError, ValueError):
        return None


def _ref_use(item: dict) -> str:
    ref = item.get("ref")
    return str(ref.get("use") or "") if isinstance(ref, dict) else ""


def media_count(item: dict) -> int | None:
    """Anzahl der Bilder/Videos eines Items: aus `media` (Folien, main/poster/image; ein Medien-Objekt
    ohne verwertbares Medium zählt 0), sonst aus dem Verweis; None nur ohne Medien oder bei einem
    Folien-Verweis ohne refCount."""
    item = item or {}
    media = item.get("media")
    if isinstance(media, dict) and media:
        if "slides" in media:
            slides = media["slides"]
            if isinstance(slides, dict):
                slides = slides.get("ig") or slides.get("tt") or []
            return len(slides) if isinstance(slides, (list, tuple)) else 0
        if media.get("main") or media.get("poster") or media.get("image"):
            return 1
        return 0
    use = _ref_use(item)
    if use in VIDEO_USES or use in SINGLE_IMAGE_USES:
        return 1
    if use in MULTI_USES:
        return _ref_count(item)
    return None


def _has_media(item: dict) -> bool:
    media = item.get("media")
    return bool(isinstance(media, dict) and media) or bool(_ref_use(item))


def _is_video(item: dict) -> bool:
    media = item.get("media") or {}
    if isinstance(media, dict) and media.get("main") and "slides" not in media and not media.get("image"):
        return True
    return _ref_use(item) in VIDEO_USES


def _has_video_and_poster(item: dict) -> bool:
    media = item.get("media") or {}
    if isinstance(media, dict) and media.get("main") and media.get("poster"):
        return True
    return _ref_use(item) in VIDEO_USES


def _valid_products(products) -> list[tuple[str, str]] | None:
    """[[handle, titel], …] → Liste von Tupeln; None bei fehlerhafter Form."""
    if products is None:
        return []
    if not isinstance(products, (list, tuple)):
        return None
    out = []
    for p in products:
        if not isinstance(p, (list, tuple)) or len(p) < 2 or not all(isinstance(x, str) and x.strip() for x in p[:2]):
            return None
        out.append((p[0].strip(), p[1].strip()))
    return out


def _norm_link(link: str) -> str:
    return link.strip().rstrip(".,;:!?)»\"'").rstrip("/")


def adapt_item(platform: str, item: dict) -> dict:
    """Altes Instagram-Format (ig.caption/ig.tags, media.slides.{ig,tt}, Story mit image und ohne type)
    in die Plan-v2-Form bringen. Setzt _oldForm, wenn Caption/Tags oder Folien aus dem alten Format stammen."""
    it = dict(item or {})
    if not it.get("type") and ("for" in it or "what" in it):
        it["type"] = "story"
    net = "tt" if platform == "tiktok" else "ig"
    sub = it.get(net)
    if "caption" not in it and isinstance(sub, dict):
        it["caption"] = sub.get("caption")
        it["tags"] = sub.get("tags")
        it["_oldForm"] = True
    media = it.get("media")
    if isinstance(media, dict) and isinstance(media.get("slides"), dict):
        it["media"] = {**media, "slides": list(media["slides"].get(net) or [])}
        it["_oldForm"] = True
    if it.get("type") == "story" and not it.get("media") and not it.get("ref") and it.get("image"):
        it["media"] = {"image": it["image"]}
    return it


def _check_links(item: dict, text: str, mode: str, products: list, cfg: dict) -> list[str]:
    v: list[str] = []
    link = item.get("link")
    if link is None or link == "":
        return ["Produktlink fehlt (item.link)"]
    if not isinstance(link, str):
        return ["Produktlink fehlerhaft"]
    link_n = _norm_link(link)
    if mode in LINK_TEXT_MODES:
        found = [_norm_link(m) for m in re.findall(LINK_RE, _clean(text))]
        if link_n not in found:
            v.append(f"Produktlink fehlt: {link}")
        for other in found:
            if other != link_n:
                v.append(f"Fremder Link im Text: {other}")
    if mode == "firstComment":  # Spec Anhang A: der Shop-Link steht im ersten Kommentar (LinkedIn)
        fc = item.get("firstComment")
        if fc is not None and not isinstance(fc, str):
            v.append("Erster Kommentar fehlerhaft")
        else:
            found = [_norm_link(m) for m in re.findall(LINK_RE, _clean(fc or ""))]
            if link_n not in found:
                v.append("Erster Kommentar ohne Produktlink")
            for other in found:
                if other != link_n:
                    v.append(f"Fremder Link im ersten Kommentar: {other}")
    product_url = ((cfg or {}).get("shop") or {}).get("productUrl")
    if not isinstance(product_url, str) or not product_url:
        v.append("Gate-Konfiguration fehlt: shop.productUrl")
    elif products:
        try:
            expected = product_url.format(handle=products[0][0])
        except (KeyError, IndexError, ValueError):
            v.append("Gate-Konfiguration fehlerhaft: shop.productUrl")
        else:
            if _norm_link(expected) != link_n:
                v.append(f"Produktlink passt nicht zum Produkt {products[0][0]}: {link}")
    return v


def _limit_errors(platform: str, limits: dict) -> list[str]:
    """Typprüfung der Plattform-Limits; jede fehlerhafte Angabe als Verstoß statt Absturz."""
    def is_int(x):
        return isinstance(x, int) and not isinstance(x, bool)
    errs = []
    for k in ("minLen", "maxLen"):
        if not is_int(limits.get(k)) or limits[k] < 0:
            errs.append(f"Gate-Konfiguration fehlerhaft: {platform}.gate.{k}")
    hm = limits.get("hookMax")
    if hm is not None and (not is_int(hm) or hm <= 0):
        errs.append(f"Gate-Konfiguration fehlerhaft: {platform}.gate.hookMax")
    h = limits.get("hashtags")
    if not (isinstance(h, (list, tuple)) and len(h) == 2 and all(is_int(x) for x in h)):
        errs.append(f"Gate-Konfiguration fehlerhaft: {platform}.gate.hashtags")
    links = limits.get("links")
    if not isinstance(links, str) or links not in LINK_MODES:
        errs.append(f"Gate-Konfiguration fehlerhaft: {platform}.gate.links ({links!r})")
    for k in ("priceLine", "noPrice"):
        if not isinstance(limits.get(k), bool):
            errs.append(f"Gate-Konfiguration fehlerhaft: {platform}.gate.{k}")
    return errs


def check_item(platform: str, item: dict, cfg: dict) -> GateResult:
    """Prüft Typ, Text, Produktname, Produktlink, Medien und Alt-Texte eines Plan-Items."""
    platforms = (cfg or {}).get("platforms") or {}
    platform_cfg = platforms.get(platform)
    if not isinstance(platform_cfg, dict) or not isinstance(platform_cfg.get("gate"), dict):
        return GateResult(passed=False, violations=[f"Gate-Konfiguration fehlt: {platform}"])
    limits = platform_cfg["gate"]
    missing = sorted(k for k in GATE_KEYS if k not in limits)
    if missing:
        return GateResult(passed=False, violations=[f"Gate-Konfiguration unvollständig: {platform} ({', '.join(missing)})"])
    bad = _limit_errors(platform, limits)
    global_rules = (cfg or {}).get("gate")
    if global_rules is not None and not isinstance(global_rules, dict):
        bad.append("Gate-Konfiguration fehlerhaft: gate")
    if bad:
        return GateResult(passed=False, violations=bad)
    rules = dict(global_rules or {})
    item = adapt_item(platform, item)
    v: list[str] = []

    itype = item.get("type") or ""
    if not isinstance(itype, str):
        v.append("Typ fehlerhaft")
        itype = ""
    elif not itype:
        v.append("Typ fehlt")
    elif itype not in MEDIA_RULES:
        v.append(f"Unbekannter Typ: {itype}")
    else:
        allowed_types = platform_cfg.get("types")
        if isinstance(allowed_types, list) and allowed_types and itype not in allowed_types:
            v.append(f"Typ nicht erlaubt auf {platform}: {itype}")

    products = _valid_products(item.get("products"))
    if products is None:
        v.append("Produkte fehlerhaft")
        products = []
        rules["exemptTexts"] = []
    else:
        rules["exemptTexts"] = [x for _, t in products for x in (t, motif_phrase(t), motif_key(t))]

    mode = str(limits.get("links") or "none")
    if itype not in TEXT_FREE_TYPES:
        text = post_text(item)
        v.extend(check_caption(platform, text, limits, rules))
        needs_product = platform in PRODUCT_NAME_PLATFORMS or mode in LINK_ITEM_MODES
        if needs_product and not products and "Produkte fehlerhaft" not in v:
            v.append("Produkte fehlen")
        if mode in LINK_ITEM_MODES:
            v.extend(_check_links(item, text, mode, products, cfg))
        # Produktname (Entscheidungstabelle Task 3)
        check_names = platform in PRODUCT_NAME_PLATFORMS or (platform == "instagram" and len(products) == 1)
        if check_names and products:
            key = motif_key(products[0][1])
            if not product_named(key, text):
                v.append(f"Produktname fehlt: {key}")
        for _, title in products:  # Spec: „exakt wie im Shop-Titel“ – wer das Motiv nennt, nennt es genau so
            key = motif_key(title)
            if key and product_mentioned(key, text) and not product_named(key, text):
                v.append(f"Produktname nicht exakt: {key}")

    if itype in TEXT_FREE_TYPES and str(item.get("caption") or "").strip():
        v.append("Story mit Text")

    if platform in TITLE_PLATFORMS and itype not in TEXT_FREE_TYPES:  # tiktokData.title = Hook, Pflicht und textgeprüft
        network = item.get("network") if isinstance(item.get("network"), dict) else {}
        title = network.get("title")
        if not isinstance(title, str) or not title.strip():
            v.append("network.title fehlt")
        else:
            v.extend(check_title(title, rules))

    rule = MEDIA_RULES.get(itype)
    use = _ref_use(item)
    n: int | None = None
    if rule == "video":
        if not _has_video_and_poster(item):
            v.append("Reel ohne Video+Cover")
        elif use and (platform, itype) in ALLOWED_USES and use not in ALLOWED_USES[(platform, itype)]:
            v.append(f"Verweis {use} nicht erlaubt für {platform}.{itype}")
    elif isinstance(rule, tuple):
        if not _has_media(item):
            v.append("Medien fehlen")
        elif use and use not in KNOWN_USES:
            v.append(f"Unbekannter Verweis: {use}")
        else:
            if _is_video(item):
                v.append("Video statt Bild")
            if itype == "story" and use and use not in STORY_USES:
                v.append(f"Story-Verweis nicht 9:16: {use}")
            elif platform == "tiktok" and itype == "photos" and use and use != "slides.tt":
                v.append(f"TikTok-Fotos brauchen slides.tt: {use}")
            elif use and (platform, itype) in ALLOWED_USES and use not in ALLOWED_USES[(platform, itype)]:
                v.append(f"Verweis {use} nicht erlaubt für {platform}.{itype}")
            n = media_count(item)
            if n is None:
                v.append("Medienanzahl unbekannt (refCount fehlt)")
            elif not (rule[0] <= n <= rule[1]):
                v.append(f"Medien: {n}, erlaubt {rule[0]}–{rule[1]}")
        old_ig = (platform == "instagram" and item.get("_oldForm") and "alt" not in item
                  and not limits.get("altRequired"))
        if platform in ALT_PLATFORMS and itype not in TEXT_FREE_TYPES and not old_ig:
            alt = item.get("alt")
            if alt is None:
                alt = []
            if not isinstance(alt, list):
                v.append("Alt-Texte fehlerhaft")
            else:
                if n is not None and len(alt) != n:
                    v.append(f"Alt-Texte: {len(alt)} statt {n}")
                for i, a in enumerate(alt, 1):
                    a = str(a or "").strip()
                    if not a:
                        v.append(f"Alt-Text leer: {i}")
                    elif len(a) >= ALT_MAX:
                        v.append(f"Alt-Text zu lang: {i}")

    v = list(dict.fromkeys(v))
    return GateResult(passed=not v, violations=v)


def story_id(st: dict) -> str:
    return f"story-{st.get('for')}-{st.get('time')}"


PLAN_PREFIX = {"tiktok": "tt", "facebook": "fb", "linkedin": "li", "gbp": "gbp"}  # Item-IDs <datum>-<prefix><n>
PLAN_MODES = {"planned", "scheduled", "draft", "published", "error", "skipped"}
_DATE_RE = r"^\d{4}-\d{2}-\d{2}$"
_TIME_RE = r"^(?:[01]\d|2[0-3]):[0-5]\d$"


def validate_plan(platform: str, doc) -> list[str]:
    """Dokumentform eines neuen Tagesplans (days-tt/-fb/-li/-gbp): date, platform, source, items/stories, IDs,
    slot.time, metricool.mode, Story-Bezug. Leer = in Ordnung. Instagram-Pläne alter Form kennen keine Dokumentform."""
    prefix = PLAN_PREFIX.get(platform)
    if prefix is None:
        return [f"Dokumentform: keine neue Plan-Sammlung für {platform}"]
    if not isinstance(doc, dict):
        return ["Dokumentform: Plan ist kein Objekt"]
    v: list[str] = []
    date = doc.get("date")
    if not isinstance(date, str) or not re.match(_DATE_RE, date):
        v.append(f"Dokumentform: date fehlt oder ist nicht YYYY-MM-DD ({date!r})")
    if doc.get("platform") != platform:
        v.append(f"Dokumentform: platform ist {doc.get('platform')!r}, erwartet {platform!r}")
    src = doc.get("source")
    if not isinstance(src, dict) or src.get("collection") != "days" or not isinstance(src.get("date"), str) \
            or not re.match(_DATE_RE, src.get("date") or ""):
        v.append("Dokumentform: source muss {collection: \"days\", date: YYYY-MM-DD} sein")
    if not isinstance(doc.get("generatedAt"), str):
        v.append("Dokumentform: generatedAt fehlt oder ist kein String")
    items, stories = doc.get("items"), doc.get("stories", [])
    if not isinstance(items, list):
        return v + ["Dokumentform: items fehlt oder ist keine Liste"]
    if not isinstance(stories, list):
        v.append("Dokumentform: stories ist keine Liste")
        stories = []
    id_re = re.compile(rf"^{re.escape(date)}-{prefix}\d+$") if isinstance(date, str) else re.compile(rf"^\d{{4}}-\d{{2}}-\d{{2}}-{prefix}\d+$")
    ids: set[str] = set()
    for i, it in enumerate(items):
        where = f"items[{i}]"
        if not isinstance(it, dict):
            v.append(f"Dokumentform: {where} ist kein Objekt")
            continue
        iid = it.get("id")
        if not isinstance(iid, str) or not id_re.match(iid):
            v.append(f"Dokumentform: {where} id {iid!r} passt nicht zu <datum>-{prefix}<n>")
        elif iid in ids:
            v.append(f"Dokumentform: id {iid} doppelt")
        else:
            ids.add(iid)
        slot = it.get("slot")
        if not isinstance(slot, dict):
            v.append(f"Dokumentform: {where} slot muss ein Objekt {{time: HH:MM}} sein")
        elif not isinstance(slot.get("time"), str) or not re.match(_TIME_RE, slot["time"]):
            v.append(f"Dokumentform: {where} slot.time ist nicht HH:MM ({slot.get('time')!r})")
        m = it.get("metricool")
        if m is not None and (not isinstance(m, dict) or m.get("mode") not in PLAN_MODES):
            v.append(f"Dokumentform: {where} metricool.mode unbekannt ({(m or {}).get('mode') if isinstance(m, dict) else m!r})")
    for i, st in enumerate(stories):
        where = f"stories[{i}]"
        if not isinstance(st, dict):
            v.append(f"Dokumentform: {where} ist kein Objekt")
            continue
        if st.get("for") not in ids:
            v.append(f"Dokumentform: {where} for {st.get('for')!r} nennt kein Item des Plans")
        if not isinstance(st.get("time"), str) or not re.match(_TIME_RE, st["time"]):
            v.append(f"Dokumentform: {where} time ist nicht HH:MM ({st.get('time')!r})")
        m = st.get("metricool")
        if m is not None and (not isinstance(m, dict) or m.get("mode") not in PLAN_MODES):
            v.append(f"Dokumentform: {where} metricool.mode unbekannt")
    return v


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json
    import sys

    ap = argparse.ArgumentParser(description="Qualitäts-Gate für einen Tagesplan")
    ap.add_argument("platform")
    ap.add_argument("plan")
    ap.add_argument("--platforms", default="config/platforms.json")
    args = ap.parse_args(argv)
    try:
        with open(args.platforms, encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError) as e:
        print(f"Konfiguration nicht lesbar: {args.platforms} ({e.__class__.__name__})", file=sys.stderr)
        cfg = {"platforms": {}, "gate": {}}
    if not isinstance(cfg, dict):
        print(f"Konfiguration ist kein Objekt: {args.platforms}", file=sys.stderr)
        cfg = {"platforms": {}, "gate": {}}
    try:
        with open(args.plan, encoding="utf-8") as f:
            plan = json.load(f)
    except (OSError, ValueError) as e:
        print(f"Plan nicht lesbar: {args.plan} ({e.__class__.__name__})", file=sys.stderr)
        return 2
    if not isinstance(plan, dict):
        print(f"Plan ist kein Objekt: {args.plan}", file=sys.stderr)
        return 2
    items, stories = plan.get("items") or [], plan.get("stories") or []
    if not isinstance(items, list) or not isinstance(stories, list):
        print(f"Plan: items/stories müssen Listen sein: {args.plan}", file=sys.stderr)
        return 2
    if args.platform in PLAN_PREFIX:  # neue Sammlungen: erst die Dokumentform, dann die Items (Instagram alter Form: nur Items)
        shape = validate_plan(args.platform, plan)
        if shape:
            print(f"Plan nicht lesbar: {args.plan} – " + "; ".join(shape), file=sys.stderr)
            return 2
    entries: list[tuple[str, dict | None]] = []
    for i, it in enumerate(items):
        entries.append((str(it.get("id")), it) if isinstance(it, dict) else (f"items[{i}]", None))
    for i, st in enumerate(stories):
        entries.append((story_id(st), {**st, "type": "story"}) if isinstance(st, dict) else (f"stories[{i}]", None))
    failed = 0
    for ident, it in entries:
        if it is None:
            failed += 1
            print(f"SKIP {ident}: Element ist kein Objekt")
            continue
        try:
            r = check_item(args.platform, it, cfg)
        except Exception as e:  # noqa: BLE001 – ein kaputtes Element darf die übrigen nicht verschlucken
            r = GateResult(passed=False, violations=[f"Gate-Fehler: {e.__class__.__name__}: {e}"])
        if r.passed:
            print(f"PASS {ident}")
        else:
            failed += 1
            print(f"SKIP {ident}: " + "; ".join(r.violations))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
