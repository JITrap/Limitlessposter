---
type: home
cssclasses: [limitless-home]
---
# Limitless OS

> Dein Firmen-Betriebssystem. Alles, was die Marke voranbringt, läuft hier zusammen.

## Live – die Welt
Oben die **Zentrale** (Shop, Social, Produktion auf einer Seite), darunter das **Büro** (wer gerade woran
arbeitet), **Wartet auf dich**, die **Wandtafel** und der **Ticker**. Alles aktualisiert sich von selbst.
<iframe src="http://localhost:4242" style="width:100%;height:1150px;border:0;border-radius:12px;background:#0b0b0c"></iframe>

> [!tip] Bleibt der Rahmen leer, läuft der Aufseher nicht: PowerShell → `Start-ScheduledTask LimitlessOS`. Die Welt gibt es auch im Browser: http://localhost:4242 – dort funktionieren die Knöpfe (Freigeben, Pause, Zahlen jetzt holen) am besten.

## Wo finde ich was
| Du willst … | Hier |
|---|---|
| alle Zahlen aus Shopify, Metricool und Printify auf einen Blick | Welt → **Zentrale** (oben) · als Notiz: [[Kennzahlen]] · als Text: [[Status#Zentrale]] |
| live sehen, woran gerade gearbeitet wird | Welt → **Büro** und **Ticker** · als Text: [[Status#Arbeiter]] |
| etwas freigeben, erledigen oder zurückschicken | Welt → **Wartet auf dich** (Freigeben / Erledigt) · oder unten im Abschnitt „Wartet auf dich“ |
| wissen, was heute schon raus ist und was noch darf | [[Status#Heute]] (Posts und Shop-Änderungen gegen das Tageslimit) |
| den Plan für die nächsten Tage | [[Pläne/Content-Kalender]] · die fertigen Karten: [[Pläne/Content-Bank]] |
| Berichte lesen | `Berichte/` (täglich und wöchentlich vom Berichter) |
| sehen, was je gepostet wurde (Dubletten-Schutz) | [[Pläne/Veröffentlicht]] · Tageszähler je Netzwerk: Welt → Wandtafel |
| den Kalender: was wann rausgeht (3 Tage zurück, 7 voraus, je Netzwerk) | Welt → **Kalender** · als Text: [[Status#Kalender (7 Tage)]] · die Liste dahinter: [[Pläne/Veröffentlicht]] |
| ob die Woche voll ist (Ist/Soll je Netzwerk und Tag, Lücken rot) | Welt → **Kalender** (Soll aus [[Strategie]] `daily_targets`) · als Text: [[Status#Kalender (7 Tage)]] |
| Slots, Formate, Stimme und Stories der Tagesproduktion | [[Pläne/Produktion]] |
| woran die Fabrik arbeitet, wenn der Content steht (Shop, Reichweite, Daten, Kunde, Marke) | [[Pläne/Wachstum]] – der Wachstumskatalog, Aufgaben heißen „Wachstum Wxx: …“ |
| die fertigen Bilder, Slides, Clips und Stimmproben ansehen | Welt → **Produktion** (Galerie aus `Assets/content/`, nach Aufgabe) · als Text: [[Status#Produktion]] |
| wissen, ob die Fabrik läuft, warum nicht, und wann der nächste Auslöser kommt | Welt → **Fabrik** (Ampel oben, Knopf „Planer jetzt“) · als Text: [[Status#Fabrik]] |
| die eigene Stimme prüfen (Sprachausgabe für Reels und Ads) | Welt → **Stimme** (Engine, Stimmen, letzte Probe) · Stand auch in [[Status#Produktion]] |

## Status (Textfassung, alle 30 Sekunden neu)
![[Status]]

## Wartet auf dich
Karten hier brauchen dein Ja. **Freigeben** = Knopf in der Welt oder in der Notiz `needs_approval: false` setzen.
**Zurückschicken** = Karte im Kanban nach **todo** ziehen (die Aufgabe wird dann neu als Entwurf bearbeitet) – gern mit einem Absatz „Korrektur: …“ unter `## Auftrag`.

![[Dashboard.base#Wartet auf dich]]

## Kanban
![[Dashboard.base#Kanban]]

## Heute
![[Dashboard.base#Heute]]

## Schnellzugriff
- [[Kennzahlen]] – die Zahlen der Zentrale als Notiz (alle 6 Stunden neu)
- [[Strategie]] – Ziel, Wertleiter, Autopilot-Stufen, Grenzen
- [[Marke/Kern]] · [[Marke/Tonalität]] · [[Marke/Visuell]] · [[Marke/Hashtags]] · [[Marke/Produkte]] · [[Marke/Kanäle]]
- [[Pläne/Content-Kalender]] · [[Pläne/Wochenplan]] · [[Pläne/Produktion]] · [[Pläne/Wachstum]]
- `Berichte/` – Tages- und Wochenberichte · `Ideen/` – Poster- und Kampagnen-Ideen
- `Inbox/` – hier Chats, Notizen und Skills ablegen, das System ordnet sie ein
- Not-Aus: Datei `PAUSE` in diesem Ordner anlegen (oder Knopf in der Welt)
