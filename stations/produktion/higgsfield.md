# Higgsfield – Werkzeugkarte für Produktion und Studio

Higgsfield ist der KI-Bild- und -Video-Dienst der Fabrik (MCP-Server `higgsfield`, Werkzeuge `mcp__higgsfield__*`).
Er liefert **Hintergründe, Räume, Clips und KI-Darsteller** – nie das Motiv: das Poster kommt immer aus `Marke/Produkte.md`.
Jede Erzeugung kostet Guthaben aus Julius' Konto. Lies diese Karte vor jedem Higgsfield-Schritt.

## Guthaben und Grenzen (immer zuerst)
1. `balance` → `credits`. Liegt das Guthaben unter `higgsfield_reserve` (Pläne/Produktion.md, Standard 100): **nichts erzeugen**,
   Rückfall auf T07, Grund ins Ergebnis.
2. Vor jedem bezahlten Aufruf dieselben Parameter mit `get_cost: true` schicken – die Antwort nennt die Credits. Summe je Tag
   höchstens `higgsfield_credits_pro_tag` (Standard 60); du zählst die eigenen Aufrufe und die Credits anderer Aufgaben von heute
   (Glob `Aufgaben/*.md`, Zeile „Higgsfield: … Credits“ unter Ergebnis).
3. Richtwerte (Stand 26.10.2026): Raumclip Kling 4.0, 5 s, 720p = 7,5 · Seedance 2.5, 6 s ohne Ton = 42 · Marketing-Studio-Video
   12 s = 60 · Standbild GPT Image 2.5 = 0,25 · Soul-Porträt ≈ 1. UGC-Reel (Darsteller + Board + 15 s Seedance mit Ton) ≈ 100.
4. `use_unlim` nie setzen (nur Julius darf seine Gratis-Kontingente freigeben). `count` immer 1. Jede Zahl ins Ergebnis:
   „Higgsfield: <Credits> Credits (<Modell>)“.

## Medien hochladen (der Weg ohne curl)
Arbeiter haben keinen curl. Bilder aus dem Vault gehen so zu Higgsfield:
`node supervisor/dist/adapters/shopify.js upload-file "<abs. Pfad>"` → öffentliche `url` → `media_import_url { url, type: "image" }`
→ `media_id`. Nur Dateien aus `Assets/` hochladen, nie Notizen. Ergebnisse zurück in den Vault:
`node supervisor/dist/adapters/studio.js fetch --url <Ergebnis-URL> --out "<Vault>/LimitlessOS/Assets/content/<id>/<datei>"`.

## Erzeugen und warten
- Video: `generate_video { params: { model, prompt, aspect_ratio: "9:16", duration, resolution: "720p", medias: [{ value: <media_id>, role }] } }`.
  Rollen aus `models_explore { action: "get", model_id }` (`start_image` bei Kling, `image_references` bei Seedance omni_reference).
- Bild: `generate_image { params: { model: "gpt_image_2_5" | "soul_2" | "nano_banana_pro", prompt, aspect_ratio, medias } }`.
- Mehrere unabhängige Aufträge: `generate_image_batch` / `generate_video_batch` (je `{index, params}`), dann `jobs_wait`
  `{ jobs: [{index, job_id}], timeout_seconds: 15 }` wiederholen, bis `all_terminal: true` (höchstens 40 Durchläufe = 10 Minuten),
  danach **einmal** `show_generation_by_ids`. Auch ein einzelner `generate_video`-Auftrag wird mit `jobs_wait` abgeholt.
- Ergebnis-URL aus der Antwort (`result_url` / `url` des Jobs) → `studio.js fetch`. Modelle nie stillschweigend tauschen:
  ist ein Modell nicht verfügbar, Rückfall auf das Format ohne Higgsfield und Hinweis ins Ergebnis.
- Zeitüberschreitung ist kein Fehler: dieselben Job-IDs weiter abfragen, nie neu einreichen.

## Die vier Wege
| Format | Was Higgsfield liefert | Modell / Weg | Richtpreis | Danach bei uns |
|---|---|---|---|---|
| **H01 Higgsfield-Raum** | 5–8 s Kamerafahrt durch den Raum mit dem echten Poster | Standbild `mockup-room` (echtes Poster) → `media_import_url` → `kling4_0` image-to-video, `start_image` | 7,5 | `render-reel --scene h01-overlay --background` + Stimme, Untertitel, Endcard |
| **M01 Motion-Produktfilm** | 10–15 s Hyper-Motion-Produktclip (Licht, Makro, Material) | Marketing Studio: `get_presets { source: "marketing_studio", category: "motion" }` → Preset vom Typ `hypermotion`, `execute_preset { source, preset_id, inputs: { product_media_id, prompt } }` | 40–60 | Overlay (Hook, Endcard), Stimme, Musik |
| **U01 UGC-Reel** | 15 s Clip mit KI-Darsteller, der das Poster zeigt, deutsche Sprache | Higgsfields Ablauf `get_workflow_instructions { workflow: "ugc-video" }`, Format `review` (mit Produkt) oder `product` (ohne Darsteller) | ≈ 100 | nur Cover/Untertitel-Prüfung, Caption mit KI-Hinweis |
| **P01 Produktfoto** | Lifestyle- oder Studio-Standbilder mit dem echten Poster | `get_workflow_instructions { workflow: "product-photoshoot" }` (Modus `lifestyle-scene`, `social-carousel`), Modell `nano_banana_pro`, Poster als `image_references` | 1–3 je Bild | Karussell-Slides, Story-Bilder, Shop-Bilder (Freigabe) |

## Prompt-Regeln (aus den Higgsfield-Skills, für uns verbindlich)
- **Nur Sichtbares beschreiben**: Materialien, Licht mit Richtung („Fensterlicht von links, später Nachmittag“), drei Tiefenebenen,
  zwei bis drei bewohnte Details. Keine Etiketten wie „gemütlich“, keine Farblisten, keine Verneinungen außer den Schutzsätzen.
- **Das Poster bleibt exakt wie im Referenzbild** – immer als Satz im Prompt: „keep the poster artwork exactly as shown“.
- **Keine Texte, Logos, Marken, Wasserzeichen** im erzeugten Bild oder Clip; kein Text einbrennen lassen (Hook und Endcard macht unsere Szene).
- **Menschen**: nur erwachsene, erfundene Personen; nie das Gesicht einer echten Person, keine Prominenten; natürliche Haut, eine kleine
  Unperfektheit (Haarsträhne, Falte im Shirt). Handy-Look kommt von der Kamera (leichte Handbewegung, Augenhöhe, Tageslicht).
- **Hook in den ersten zwei Sekunden**, gesprochen (≤ 10 Wörter, wie zu einem Freund) und sichtbar (etwas passiert schon im ersten Bild).
- Prompts auf Englisch schreiben, gesprochene Sprache im Clip auf Deutsch anweisen („speaks German, natural Berlin everyday tone“).
- Ein Nutzen pro Video, konkret gezeigt; keine Floskeln (game-changer, must-have, revolutionär, effortless, „du brauchst das“).

## Wahrheit und Kennzeichnung
- Der KI-Darsteller ist Moderator, nie Kunde: keine Sätze wie „ich habe es gekauft/benutze es seit Monaten“, keine Bewertungen,
  keine Sterne, keine erfundenen Erfahrungen oder Ergebnisse. Erlaubt sind Aussagen über Sichtbares (Rahmen, Größen, Papier) und die
  Fakten aus `Marke/Produkte.md`.
- Jeder Post mit KI-Anteil: `instagramData.isAiGenerated: true`, `tiktokData.isAigc: true`. In der Caption eines UGC-Reels steht
  „KI-Clip“ oder „Darsteller: KI“ – kurz, ohne Entschuldigung.
- Keine fremden Marken, Logos, Musik, Charaktere. Das Produkt wird nie umgestaltet oder „verbessert“.
- Stockt etwas (Moderation, Fehler, Zeit > 10 Minuten): Rückfall auf das Format ohne Higgsfield, nie Umwege über andere Anbieter.

## Werkzeuge, die Arbeiter nicht nutzen
`ads_studio_*` (eigene Werbeanzeigen mit Guthaben), `tiktok_*` (Veröffentlichen – das macht nur der Metricool-Weg), `create_website`,
`participate_in_contest`, `show_plans_and_credits`/Kauf-Werkzeuge, `delete_*`. Veröffentlicht wird ausschließlich über `metricool.js schedule`.
