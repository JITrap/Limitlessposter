# Higgsfield – KI-Clips für die Abend-Reels

Higgsfield (higgsfield.ai) erzeugt aus einem Bild ein kurzes Video. Limitless OS nutzt das für **ein** Format: **H01 Higgsfield-Raum**.
Das Studio rendert ein Standbild mit deinem echten Poster im Raum, Higgsfield macht daraus eine Kamerafahrt (5–8 s), und der
Reel-Renderer legt Hook, Karten, Untertitel, Stimme, Musik und Endcard darüber. Das Poster selbst wird nie von einer KI gemalt.

## Einrichten (einmalig, 2 Minuten)
1. Higgsfield-Konto mit Guthaben (die Erzeugungen kosten Credits aus deinem Plan).
2. PowerShell im Repo-Ordner: `claude mcp login higgsfield` → im Browser anmelden. Der Server `https://mcp.higgsfield.ai/mcp`
   steht bereits in `.mcp.json`; `install.ps1` fragt den Login ebenfalls ab (Schritt 4/4, optional).
3. `claude mcp list` zeigt `higgsfield … ✔ Connected`. Die Karte „Higgsfield anmelden“ unter „Wartet auf dich“ schließt sich dann
   von selbst; die Welt zeigt den Stand im Bereich **Stimme**.

## Steuern
In `<Vault>\LimitlessOS\Pläne\Produktion.md`:
- `higgsfield: ja|nein` – H01 an oder aus. Ohne Anmeldung oder bei `nein` baut die Produktion stattdessen T07.
- `higgsfield_pro_tag: 2` – höchstens so viele Clips am Tag (Guthaben-Bremse). Der Planer gibt H01 dem Hero-Slot am Abend.
- Modelle: günstige Image-to-Video-Modelle (Kling, Wan). Sora oder Veo nur, wenn du es unter „Notizen von Julius“ freigibst.

## Regeln für die Arbeiter
- Der Clip ist Hintergrund: Kamerafahrt oder Licht im Raum, **das Poster bleibt exakt wie im Standbild**. Keine neuen Texte, Logos,
  Marken, keine Gesichter bekannter Personen, keine Menschen im Vordergrund.
- Download nur über `node supervisor\dist\adapters\studio.js fetch --url <https://…> --out <Vault>\LimitlessOS\Assets\content\<id>\higgsfield.mp4`
  (nur https, nur Mediendateien, nur unter `Assets\`, höchstens 200 MB).
- Reel: `studio.js render-reel --scene h01-overlay --background <…>\higgsfield.mp4 …` – die Szene ist durchsichtig, der Clip liegt darunter.
- Jeder H01-Post trägt `isAiGenerated: true` (Instagram) bzw. `isAigc: true` (TikTok).
- Dauert die Erzeugung länger als 10 Minuten oder schlägt sie fehl: Rückfall auf T07, Grund im Ergebnis.

## Werkzeuge
Die Arbeiter der Stationen **Produktion** und **Studio** dürfen alle Werkzeuge des Servers `higgsfield` nutzen (`mcp__higgsfield`).
Die genauen Werkzeugnamen (Bild erzeugen, Bild → Video, Status abfragen) liest der Arbeiter aus dem Server; sie stehen nicht fest im Code.
