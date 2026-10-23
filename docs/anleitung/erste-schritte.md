# Erste Schritte (ca. 15 Minuten, davon 10 Minuten Warten)

Das meiste ist schon vorbereitet: Der Vault kommt mit deinem echten Sortiment (125 Produkte),
Markenkern, Hashtags, Kalender und den ersten Aufgaben-Karten. Du machst nur noch das, was nur du
kannst: installieren, dreimal im Browser anmelden, ein paar Fragen beantworten.

## 1. Repo auf den PC holen und installieren (ein Download, ein Befehl)
1. Auf <https://github.com/JITrap/Limitlessposter> oben rechts **Code → Download ZIP**. Die Datei
   landet in `Downloads\Limitlessposter-main.zip`.
2. **PowerShell** öffnen (Startmenü → „PowerShell“ tippen, als normaler Benutzer, nicht als Administrator)
   und diese drei Zeilen einfügen (Rechtsklick fügt ein), Enter:
   ```powershell
   $z = Get-ChildItem "$env:USERPROFILE\Downloads\Limitlessposter-main*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
   Expand-Archive $z.FullName "$env:TEMP\limitless-zip" -Force
   powershell -ExecutionPolicy Bypass -File "$env:TEMP\limitless-zip\Limitlessposter-main\scripts\bootstrap.ps1"
   ```
   `bootstrap.ps1` kopiert das Repo nach `C:\Users\<du>\limitlessposter` und startet `install.ps1`.
   Das installiert Node.js, Git, ffmpeg und Claude Code (falls nötig), baut den Aufseher, findet deinen
   Obsidian-Vault selbst (fragt nur nach, wenn es mehrere gibt), kopiert die Vorlage nach
   `<Vault>\LimitlessOS`, richtet den Autostart ein und öffnet die Welt.
   Wenn Windows beim ersten `winget`-Aufruf nachfragt, mit `Y` bestätigen.
3. Der Installer öffnet nacheinander **drei Browserfenster**: Claude (mit dem **claude.ai-Konto** anmelden,
   Max-Abo, nicht „API key“), Metricool (dein Metricool-Konto), Shopify (das Konto, dem der Shop gehört,
   Zugriff bestätigen). Fenster schließen, zurück zur PowerShell – sie macht weiter.
   Später nachholen: `claude auth login`, `claude mcp login metricool`, `claude mcp login shopify`.
4. Am Ende öffnen sich **die Welt** (`http://localhost:4242`) und `Home.md` in Obsidian.

Prüfen: `powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1 -Smoke` (im Repo-Ordner).

Repo später aktualisieren: neue ZIP laden, dieselben drei Zeilen – `.env`, Vault und Daten bleiben erhalten.

## 2. Deine Karten abarbeiten (10 Minuten, einmalig)
Unter **Wartet auf dich** (Welt oder `Home.md`) liegen Karten mit Station **manual** – Dinge, die nur du
tun kannst, jede mit Klick-Anleitung:
- Logins Claude / Metricool / Shopify (falls in Schritt 1 nicht passiert)
- Produktfakten bestätigen und 5 Fragen zum Markenkern beantworten (`Marke/Produkte.md`, `Marke/Kern.md`)
- Rechtliches: Motive mit Namen Dritter – deine Entscheidung
- Tagesplanungs-Chat in `Inbox/` legen
- Pinterest-Business-Konto verbinden · Google Merchant Center

Erledigt → in der Notiz `status: done` setzen. Poster-Dateien musst du **nicht** ablegen – das Studio
nutzt die Produktbilder aus Shopify.

## 3. Die ersten Tage
- Das System legt sofort los: Studio rendert den Probelauf („The World Is Yours“), das Content-Studio
  schreibt das erste Karussell, das Shop-Büro schlägt deutsche Texte für die 12 englischen Produkte vor,
  der Planer füllt den Kalender. Nach außen geht **nichts ohne dich** – alles landet unter **Wartet auf dich**.
- Freigeben: in der Welt **Freigeben** klicken (oder in der Notiz `needs_approval: false`). Beim nächsten
  Lauf wird geplant (Metricool) bzw. geändert (Shop).
- Zurückschicken: Karte im Kanban nach **todo** ziehen und unter `## Auftrag` einen Absatz
  „Korrektur: …“ anfügen; `needs_approval` bleibt `true`. Ein Drag ist nie eine Freigabe.
- Täglich 07:30 liegt ein Tagesbericht in `Berichte/`, donnerstags 17:00 der Wochenbericht.

## 4. Nach zwei Wochen
Wenn die Freigaben durchgehend passen: in `Strategie.md` oben `content: 2` setzen – ab dann plant das
Content-Studio ohne Rückfrage (höchstens 3 Posts pro Tag). Der Shop bleibt auf Freigabe, bis du dasselbe
für `shop-analyst` entscheidest.

## Wenn etwas hakt
`scripts\doctor.ps1` nennt das Problem und die Lösung. Häufig: nicht mit dem Abo angemeldet
(`claude auth login`), MCP abgelaufen (`claude mcp login metricool` bzw. `shopify`), `ANTHROPIC_API_KEY`
gesetzt (entfernen, sonst zahlst du API statt Abo).
