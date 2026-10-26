# Higgsfield – KI-Bild und -Video in der Fabrik

Higgsfield (higgsfield.ai) erzeugt Bilder und Videos aus Text und Referenzbildern. Limitless OS nutzt es an vier Stellen,
immer mit deinem **echten Poster als Referenz** – eine KI malt nie das Motiv. Dein Higgsfield-Guthaben (Credits) bezahlt
jede Erzeugung; die Zentrale zeigt den Stand, `Pläne/Produktion.md` bremst den Verbrauch.

## Die vier Formate
| Kürzel | Was entsteht | Woher | Richtpreis | Wann |
|---|---|---|---|---|
| **H01 Higgsfield-Raum** | 9-s-Reel: KI-Kamerafahrt durch den Raum mit deinem Poster, darüber Hook, Karten, Stimme, Endcard | Studio-Standbild → Kling 4.0 Image-to-Video | ≈ 7,5 Credits | Hero-Slot Mo/Mi/Fr/So |
| **M01 Motion-Produktfilm** | 12-s-Reel im Hyper-Motion-Look: Licht läuft über Rahmen und Glas, Makro auf Papier, Schwebe-Moment | Marketing-Studio-Preset (Typ Hyper-Motion), Storyboard zuerst | 40–60 Credits | Hero-Slot Di/Sa |
| **U01 UGC-Reel** | 15-s-Clip: erfundene erwachsene Person zeigt das Poster und spricht Deutsch (Higgsfields eigener UGC-Ablauf) | Soul 2.0 Darsteller → GPT Image 2 Board → Seedance 2.5 mit Ton | ≈ 100 Credits | Do, höchstens einmal je Woche |
| **P01 Produktfoto** | Lifestyle- und Studio-Standbilder mit dem Poster für Karussells, Stories, Shop | Higgsfields Ablauf „product-photoshoot“, Nano Banana Pro | 1–3 Credits je Bild | wenn der Auftrag es verlangt |

Alle KI-Posts werden gekennzeichnet (`isAiGenerated`, TikTok `isAigc`; UGC zusätzlich „Darsteller: KI“ in der Caption). Der KI-Darsteller
ist Moderator, nie Kunde: keine erfundenen Erfahrungen, keine Bewertungen. Rückfall ohne Higgsfield: H01/M01 → T07, U01 → T01.

## Einrichten (einmalig, 2 Minuten)
1. Higgsfield-Konto mit Guthaben (Stand 26.10.2026: Plan Pro, 550 Credits).
2. PowerShell im Repo-Ordner: `claude mcp login higgsfield` → im Browser anmelden. Der Server `https://mcp.higgsfield.ai/mcp`
   steht in `.mcp.json`; `install.ps1` fragt den Login als Schritt 4/4 ab (optional).
3. `claude mcp list` zeigt `higgsfield … ✔ Connected`. Die Karte „Higgsfield anmelden“ schließt sich von selbst; die Welt zeigt
   den Stand im Bereich **Stimme**, das Guthaben in der **Zentrale**.

## Steuern in `Pläne/Produktion.md`
- `higgsfield: ja|nein` – alle KI-Formate an oder aus.
- `higgsfield_pro_tag: 2` – Clips je Tag · `higgsfield_credits_pro_tag: 60` – Credits je Tag · `higgsfield_reserve: 100` – darunter
  wird nichts erzeugt · `higgsfield_ugc_pro_woche: 1` – teure UGC-Reels je Woche.
- `higgsfield_rotation` – welches Format der Hero-Slot an welchem Wochentag bekommt.
- Modelle: Kling 4.0 (Raum), Marketing-Studio-Presets (Motion), Seedance 2.5 (UGC), Nano Banana Pro (Fotos). Sora oder Veo nur,
  wenn du es unter „Notizen von Julius“ freigibst.

## So laufen die Werkzeuge (für dich zum Nachvollziehen)
1. Guthaben prüfen (`balance`), Kosten vorab abfragen (`get_cost: true`), Summe des Tages gegen die Bremse rechnen.
2. Vault-Datei öffentlich machen: `shopify.js upload-file` (Shopify-CDN) → `media_import_url` → Medien-ID.
3. Erzeugen (`generate_image` / `generate_video` / `execute_preset`), warten (`jobs_wait`, höchstens 10 Minuten), Ergebnis mit
   `studio.js fetch` in `Assets/content/<Aufgabe>/` holen (nur https, nur Medien, nur unter `Assets/`).
4. Reel bauen: `studio.js render-reel --scene h01-overlay --background <Clip>` – die Szene ist durchsichtig, der Clip liegt darunter;
   Stimme, Untertitel, Musik und Endcard kommen von uns.
5. Credits und Modell stehen im Ergebnis der Aufgabe; der Dubletten-Schutz und das Gate gelten wie für jedes Reel.

Die vollständige Werkzeugkarte für die Arbeiter: `stations/produktion/higgsfield.md`, die Format-Briefs: `stations/produktion/formate/`.

## Die Higgsfield-Skills, die du hochgeladen hast
- **UGC-Skill** → Format U01: Hook in zwei Sekunden, Sprache wie zu einem Freund, Darsteller und Raum erst als Bild, dann als Video,
  keine Testimonials, KI-Hinweis. Umgesetzt über Higgsfields eingebauten Ablauf `ugc-video` plus unsere Markenregeln.
- **Motion-Skill** → Format M01: Produkt lesen, Lichtsetup, Storyboard, erst dann rendern; Produkt bleibt exakt; Hyper-Motion für
  physische Produkte. Umgesetzt über die Marketing-Studio-Presets.
- **Client-Finder-Skill** → Station **Kunden-Finder** (`kunden`) und Katalog-Pakete W60/W61: Firmen und Creator mit sichtbarem Anlass,
  nur offizielle Firmenkontakte, persönliche Anschreiben als Entwurf. **Nicht übernommen:** der Versand per Gmail – der Skill selbst
  sagt, dass Kalt-E-Mails an Firmen in Deutschland und Österreich vorherige Einwilligung brauchen (§ 7 UWG). Deshalb verschickt das
  System nie etwas; du bekommst die Liste mit dem erlaubten Weg je Firma (B22 im Katalog).

## Werkzeuge, die die Arbeiter bewusst nicht nutzen
`ads_studio_*` (Werbeanzeigen mit Guthaben), `tiktok_*` (Veröffentlichen läuft nur über Metricool), Website-Bau, Kauf- und Plan-Werkzeuge.
