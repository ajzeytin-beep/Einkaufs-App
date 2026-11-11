# Google Maps für die Laden-Suche einrichten (optional)

Ohne Google sucht die App in **OpenStreetMap** und **Photon** (kostenlos). Mit einem eigenen Google-Schlüssel kommen
zusätzlich die Google-Maps-Ergebnisse dazu – meist die vollständigsten.

**Kosten:** Google verlangt ein Rechnungskonto mit Kreditkarte. Für die Maps-Dienste gibt es ein monatliches
kostenloses Kontingent; bei ein paar Laden-Suchen pro Woche bleibt ihr sehr wahrscheinlich darin.
Die aktuellen Preise stehen auf <https://mapsplatform.google.com/pricing/>. Zur Sicherheit unten ein Budget-Limit setzen.

## 1. Projekt und Rechnungskonto
1. <https://console.cloud.google.com> öffnen und mit einem Google-Konto anmelden.
2. Oben **Projekt auswählen → Neues Projekt** → Name z. B. `einkauf` → Erstellen.
3. Links **Abrechnung** → Rechnungskonto verknüpfen (Kreditkarte hinterlegen).

## 2. Dienste freischalten
Links **APIs & Dienste → Bibliothek**, nacheinander suchen und **Aktivieren**:
- **Maps JavaScript API**
- **Places API (New)**

## 3. Schlüssel erstellen und absichern
1. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → API-Schlüssel**.
2. Den Schlüssel bearbeiten:
   - **Anwendungseinschränkungen:** *Websites* → `https://ajzeytin-beep.github.io/*` hinzufügen.
     (So funktioniert der Schlüssel nur in eurer App.)
   - **API-Einschränkungen:** *Schlüssel einschränken* → **Maps JavaScript API** und **Places API (New)** auswählen.
   - Speichern und den Schlüssel (beginnt mit `AIza…`) kopieren.

## 4. Budget-Warnung (empfohlen)
**Abrechnung → Budgets & Benachrichtigungen → Budget erstellen**, z. B. 5 € pro Monat mit E-Mail-Warnung.

## 5. In der App eintragen
App → **Mehr → Laden-Suche** → Schlüssel einfügen → **Speichern**.
Ist ein gemeinsamer Haushalt eingerichtet, wird der Schlüssel automatisch mit den anderen Geräten geteilt.
Er steht **nicht** im öffentlichen Code dieses Repositorys.
