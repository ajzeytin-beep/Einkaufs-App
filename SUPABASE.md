# Gemeinsamer Abgleich mit Supabase einrichten (empfohlen, kostenlos)

Einmalig ca. 5 Minuten. Danach seht ihr beide dieselbe Liste live auf euren Handys.
Der kostenlose Tarif reicht für eine Familie bei Weitem, eine Kreditkarte ist nicht nötig.

## 1. Projekt anlegen
1. <https://supabase.com> öffnen → **Start your project** → mit GitHub- oder E-Mail-Konto anmelden.
2. **New project** → Name z. B. `einkauf`, ein Datenbank-Passwort vergeben (wird für die App nicht gebraucht),
   Region **Central EU (Frankfurt)** → **Create new project**. Kurz warten, bis das Projekt bereit ist.

## 2. Tabelle anlegen
1. Links **SQL Editor** → **New query**.
2. Den kompletten Inhalt der Datei [`supabase.sql`](supabase.sql) einfügen → **Run**.
   Es sollte „Success. No rows returned“ erscheinen. (Mehrfaches Ausführen schadet nicht.)

## 3. Zugangsdaten kopieren
1. Links **Project Settings** (Zahnrad) → **API** (bzw. **Data API** / **API Keys**).
2. Kopieren:
   - **Project URL**, z. B. `https://abcdefghijkl.supabase.co`
   - **anon public** Key (beginnt mit `eyJ…`) – oder den neuen **Publishable key** (`sb_publishable_…`).
   - ⚠️ **Nicht** den `service_role`/`secret` Key verwenden!

## 4. In der App eintragen

> **Bei dieser App bereits erledigt:** Project URL und Publishable Key sind in `sync-config.js` fest eingetragen –
> in der App einfach **Mehr → „Gemeinsamen Haushalt starten“** und die Einladung teilen.

**Variante A (am einfachsten):** In der App **Mehr → Gemeinsam nutzen** → URL und Key einfügen (beides zusammen in
das Feld, z. B. untereinander) → „Konfiguration speichern“ → **„Gemeinsamen Haushalt starten“** →
**„Einladung teilen“** und den Link an deine Frau schicken. Sie öffnet ihn, bestätigt und wählt „Wer bist du?“ – fertig.

**Variante B (fest eingebaut):** In `sync-config.js` eintragen:
```js
window.SYNC_CONFIG = { provider: "supabase", url: "https://abcdefghijkl.supabase.co", key: "eyJ..." };
```
committen und veröffentlichen – dann muss auf keinem Gerät etwas eingefügt werden.

## Gut zu wissen
- **Sicherheit:** Der anon/publishable Key ist öffentlich (steht in jeder Supabase-Web-App). Eure Liste schützt der
  **24-stellige Haushalts-Code** im Einladungslink zusammen mit den Regeln aus `supabase.sql` (Row Level Security):
  Ohne Code sieht man nichts, und niemand kann eine Liste aller Haushalte abrufen. Den Link nur an Familie schicken.
- **Live-Abgleich:** Änderungen werden über Supabase Realtime sofort gemeldet; beim Öffnen der App und nach
  Netzunterbrechungen wird zusätzlich alles neu geladen.
- **Offline:** Ohne Netz geht alles weiter; Änderungen werden automatisch nachgereicht.
- **Pausieren:** Supabase pausiert kostenlose Projekte, die eine Woche lang gar nicht benutzt wurden. Bei normaler
  Nutzung passiert das nicht; falls doch, im Supabase-Dashboard auf **Restore** klicken.
- Fotos werden verkleinert in der Tabelle gespeichert (kein Storage-Bucket nötig).
