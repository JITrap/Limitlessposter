# Erste Schritte (ca. 30 Minuten)

## 1. Installieren
1. Repo auf den PC holen (z. B. `git clone https://github.com/JITrap/Limitlessposter.git` oder als ZIP)
   nach `C:\Users\<du>\limitlessposter`.
2. PowerShell **als normaler Benutzer** (nicht als Administrator) im Repo-Ordner öffnen und ausführen:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
   ```
3. Das Skript fragt nach deinem **Obsidian-Vault** (der Ordner, den Obsidian öffnet) und legt dort
   den Unterordner `LimitlessOS` an. Es öffnet die `.env` – trag die Shopify-Daten ein, wenn du sie
   schon hast (`docs/anleitung/shopify-app.md`), sonst später.
4. Wenn Claude sich öffnet: mit dem **claude.ai-Konto** einloggen (nicht API), dann `/mcp` tippen,
   `metricool` wählen, im Browser bei Metricool anmelden, `/exit`.
5. Am Ende öffnen sich **die Welt** (`http://localhost:4242`) und `Home.md` in Obsidian.

Prüfen: `powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1 -Smoke`

## 2. Die Marke füttern (10 Minuten, einmalig)
Öffne in Obsidian `LimitlessOS/Marke/` und beantworte die Fragen in den Kästen:
- `Kern.md` – wer kauft, warum wir, Produktversprechen
- `Tonalität.md` – wie wir klingen
- `Produkte.md` – **feste Produktfakten** (Formate, Material, Versand). Nur was hier steht, darf das
  System behaupten.
- `Visuell.md` – Farben, falls du welche hast

Leg deine Poster-Dateien (PNG/JPG, Dateiname = Shopify-Handle) in `LimitlessOS/Assets/poster/`.

## 3. Deinen Tagesplanungs-Chat einschicken
Kopiere den Chat als Text in eine Datei `LimitlessOS/Inbox/Tagesplanung.md`. Der Planer ordnet
ihn beim nächsten Lauf ein und baut daraus Themen und Regeln.

## 4. Die ersten Tage
- Das System legt sofort los: Planer füllt die Warteschlange, Studio baut Bilder, Content schreibt
  Posts. Nach außen geht **nichts ohne dich** – alles landet unter **Wartet auf dich**
  (`Home.md` oder die Welt).
- Freigeben: in der Welt **Freigeben** klicken (oder in der Notiz `needs_approval: false`). Beim
  nächsten Lauf wird geplant (Metricool) bzw. geändert (Shop).
- Zurückschicken: Karte im Kanban nach **todo** ziehen und unter `## Auftrag` einen Absatz
  „Korrektur: …“ anfügen; `needs_approval` bleibt `true`. Ein Drag ist nie eine Freigabe.
- Karten mit Station **manual** sind Dinge, die nur du tun kannst (Pinterest verbinden, Poster
  ablegen, Google Merchant Center). Erledigt → `status: done`.

## 5. Nach zwei Wochen
Wenn die Freigaben durchgehend passen: in `Strategie.md` oben `content: 2` setzen – ab dann plant
das Content-Studio ohne Rückfrage (höchstens 3 Posts pro Tag). Der Shop bleibt auf Freigabe,
bis du dasselbe für `shop-analyst` entscheidest.
