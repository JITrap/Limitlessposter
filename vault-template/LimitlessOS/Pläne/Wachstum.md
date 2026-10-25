---
type: plan
updated: 2026-10-25
pakete: 0
---
# Wachstumskatalog

> [!info] Hier steht, woran die Fabrik arbeitet, wenn der Content-Kalender voll ist: Shop, Reichweite, Daten, Kunde,
> Marke und Saison – je Paket mit Station, prüfbarer Bedingung, Abkühlzeit und Wert. Der Planer nimmt je Lauf höchstens
> drei Pakete (höchster Wert, Abkühlzeit abgelaufen) und legt sie als „Wachstum Wxx: …“ an. Der vollständige Katalog
> wird gerade erstellt und mit dem nächsten Update eingespielt.

## Regeln für den Planer
- Erst die Lücken des Kalenders schließen (Soll aus [[Strategie]]), dann die Wertleiter, dann dieser Katalog.
- Je Lauf höchstens 3 Katalog-Aufgaben; Bedingung prüfen; nie für ⛔-Stationen.
- Abkühlzeit über das `created`-Datum der letzten Aufgabe mit demselben „Wxx“ im Titel.
- Katalog-Aufgaben tragen `tags: [task, wachstum]`.
