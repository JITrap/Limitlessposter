# Shopify anbinden (einmalig, ca. 10 Minuten)

Limitless OS liest Bestellungen und Produkte aus deinem Shop und kann – nach deiner
Freigabe – Produkttitel und -beschreibungen verbessern. Dafür braucht es eine eigene
kleine App in deinem Shop. Der alte Weg („Apps entwickeln → Token kopieren“) ist seit
Januar 2026 geschlossen; so geht es jetzt:

## 1. App im Dev Dashboard anlegen

1. Öffne <https://dev.shopify.com/dashboard> und melde dich mit dem Konto an, dem
   der Shop `limitlessposter.com` gehört (Partner-Konto ist **nicht** nötig).
2. **Create app** → Name `Limitless OS` → als Typ eine App, die **nur in deinem Shop**
   läuft (Custom/„für einen Store“).
3. Unter **Access scopes** diese Berechtigungen setzen:
   - `read_products`, `write_products`
   - `read_orders`
   - `read_customers`
   - `read_inventory`, `write_inventory`
   - `read_locations`
4. **Release** eine Version und installiere die App im Shop (Button „Install“ oder
   über Shopify-Admin → Apps).

## 2. Zugangsdaten holen

Im Dev Dashboard unter **Settings → Client credentials** findest du **Client ID** und
**Client Secret**. Beide in die `.env` des Repos eintragen:

```
SHOPIFY_STORE_DOMAIN=limitlessposter.myshopify.com
SHOPIFY_CLIENT_ID=…
SHOPIFY_CLIENT_SECRET=…
```

`SHOPIFY_STORE_DOMAIN` ist die **myshopify-Adresse**, nicht `limitlessposter.com`.
Du findest sie im Shopify-Admin unter Einstellungen → Domains.

## 3. Prüfen

Im Repo-Ordner:

```
npm run build
node supervisor/dist/adapters/shopify.js products --limit 3
```

Erscheint eine JSON-Liste mit drei Produkten, ist alles verbunden. Die Station
**Shop-Büro** wird beim nächsten Durchlauf des Aufsehers grün.

## Was Limitless OS damit tut

- **Lesen** (immer erlaubt): Bestellungen der letzten 60 Tage, Bestseller, Lagerstand,
  Produkttexte → `Marke/Produkte.md` und Berichte.
- **Schreiben** (nur nach Freigabe): Titel und Beschreibung eines Produkts. Höchstens
  5 Änderungen pro Tag (`dailyShopChangeLimit`). Der Zugriffs-Token läuft nach 24 h ab
  und wird automatisch erneuert.

## Grenzen des Basic-Plans

Shopify-Analytics-Berichte sind im Basic-Plan für Apps eingeschränkt. Limitless OS
leitet Umsatz und Bestseller deshalb aus den Bestellungen ab. Sitzungen, Conversion und
Herkunft der Besucher siehst du weiterhin nur im Shopify-Admin unter Analytics.
