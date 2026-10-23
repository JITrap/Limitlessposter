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
| etwas freigeben oder zurückschicken | Welt → **Wartet auf dich** · oder unten im Abschnitt „Wartet auf dich“ |
| wissen, was heute schon raus ist und was noch darf | [[Status#Heute]] (Posts und Shop-Änderungen gegen das Tageslimit) |
| den Plan für die nächsten Tage | [[Pläne/Content-Kalender]] · die fertigen Karten: [[Pläne/Content-Bank]] |
| Berichte lesen | `Berichte/` (täglich und wöchentlich vom Berichter) |

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
- [[Pläne/Content-Kalender]] · [[Pläne/Wochenplan]]
- `Berichte/` – Tages- und Wochenberichte · `Ideen/` – Poster- und Kampagnen-Ideen
- `Inbox/` – hier Chats, Notizen und Skills ablegen, das System ordnet sie ein
- Not-Aus: Datei `PAUSE` in diesem Ordner anlegen (oder Knopf in der Welt)
