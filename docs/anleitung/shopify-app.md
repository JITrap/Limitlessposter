# Shopify anbinden

Limitless OS liest Produkte und Bestellungen aus deinem Shop und kann – nach deiner Freigabe –
Produkttitel und -beschreibungen verbessern. Es gibt zwei Wege. **Weg A reicht für den Start.**

## Weg A (Standard, 2 Minuten): Shopify-MCP im Browser anmelden

Shopify betreibt einen offiziellen MCP-Server für Shop-Besitzer (`https://setup.shopify.com/mcp`).
Er steht bereits in der `.mcp.json` des Repos. Du musst dich nur einmal anmelden:

1. PowerShell im Repo-Ordner öffnen: `claude mcp login shopify` (macht `install.ps1` bereits für dich).
2. Im Browser mit dem Shopify-Konto anmelden, dem `limitlessposter.com` gehört, und den Zugriff bestätigen.
3. `claude mcp list` zeigt `shopify … ✔ Connected`. (Ältere Claude-Version: `claude` → `/mcp` → `shopify` → Authenticate.)

Auf der Shopify-Freigabeseite kannst du zwischen **Nur-Lesen** und **Lesen + Schreiben** wählen. Mit
Nur-Lesen bleiben alle Produkttext-Vorschläge in den Notizen (du überträgst sie selbst); mit Schreiben
ändert das Shop-Büro Titel und Beschreibung nach deiner Freigabe selbst. Shopify blockiert in jedem Fall
Rückerstattungen, Stornos, Zahlungen, Steuern, Domains und das Live-Theme. Später ändern geht nur über
Abmelden (`claude mcp logout shopify`) und neu anmelden.

Schlägt der Login fehl (Shopify lehnt den Client ab), nimm Weg B – das System erkennt beide Wege.

Die Anmeldung wird lokal gespeichert, die Hintergrund-Arbeiter nutzen sie automatisch. Die Station
**Shop-Büro** wird beim nächsten Durchlauf des Aufsehers grün. Läuft die Anmeldung ab, steht in
`Status.md` ein MCP-Fehler – dann Schritt 1–3 wiederholen.

Was das System damit tut:
- **Lesen** (immer erlaubt): Produkte, Bestellungen, Bestseller → `Marke/Produkte.md` und Berichte
  (Werkzeuge `search_products`, `get-product`, `list-orders`, `graphql_query`).
- **Schreiben** (nur nach Freigabe, höchstens 5 pro Tag): `update-product` mit **nur** Titel und
  Beschreibung. Preise, Varianten, Bilder und Sichtbarkeit sind der Station per Anweisung verboten;
  solange eine Aufgabe auf Freigabe wartet, ist das Werkzeug zusätzlich technisch gesperrt.

## Weg B (optional, 10 Minuten): eigene App für den Datei-Upload

Metricool braucht **öffentliche Links** für Bilder und Clips aus dem Studio. Dafür lädt Limitless OS
die Dateien auf dein Shopify-CDN (Inhalte → Dateien). Das kann der MCP-Server nicht – dafür braucht es
eine kleine eigene App mit Client-Credentials. Ohne Weg B plant das System Posts mit
`autoPublish: false`: Metricool schickt dir eine Push-Nachricht, du hängst die Datei aus
`Assets/content/<aufgabe>/` in der Metricool-App an. Für die ersten Wochen ist das völlig in Ordnung.

### 1. App im Dev Dashboard anlegen
1. <https://dev.shopify.com/dashboard> öffnen, mit dem Shop-Konto anmelden (kein Partner-Konto nötig).
2. **Create app** → Name `Limitless OS` → App, die nur in deinem Shop läuft (Custom).
3. **Access scopes**: `read_products`, `write_products`, `read_orders`, `read_customers`,
   `read_inventory`, `write_inventory`, `read_locations`, `read_files`, `write_files`.
4. Version **releasen** und die App im Shop installieren.

### 2. Zugangsdaten eintragen
Dev Dashboard → **Settings → Client credentials** → Client ID und Client Secret in die `.env`:

```
SHOPIFY_STORE_DOMAIN=gexdm4-2q.myshopify.com
SHOPIFY_CLIENT_ID=…
SHOPIFY_CLIENT_SECRET=…
```

(`SHOPIFY_STORE_DOMAIN` ist deine myshopify-Adresse und schon vorausgefüllt.)

### 3. Prüfen
```
npm run build
node supervisor/dist/adapters/shopify.js products --limit 3
```
Erscheint eine JSON-Liste mit drei Produkten, ist alles verbunden. Der Zugriffs-Token läuft nach 24 h
ab und wird automatisch erneuert. Mit Weg B zählt der Adapter die Shop-Änderungen pro Tag selbst
(`dailyShopChangeLimit`).

## Grenzen des Basic-Plans
Shopify-Analytics-Berichte sind im Basic-Plan für Apps eingeschränkt. Limitless OS leitet Umsatz und
Bestseller aus den Bestellungen ab. Sitzungen, Conversion und Herkunft der Besucher siehst du im
Shopify-Admin unter Analytics.
