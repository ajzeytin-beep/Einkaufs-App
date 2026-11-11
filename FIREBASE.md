# Gemeinsamer Abgleich einrichten (Firebase, kostenlos)

Einmalig ca. 5 Minuten. Danach seht ihr beide dieselbe Liste live auf euren Handys.
Der kostenlose „Spark“-Tarif reicht für eine Familie bei Weitem – es wird **keine Kreditkarte** benötigt.

## 1. Firebase-Projekt anlegen
1. <https://console.firebase.google.com> öffnen und mit einem Google-Konto anmelden.
2. **„Projekt erstellen“** → Name z. B. `einkauf` → Google Analytics **ausschalten** → Erstellen.

## 2. Anonyme Anmeldung einschalten
1. Links **Build → Authentication** → „Jetzt starten“.
2. Reiter **Sign-in method** → **Anonym** → aktivieren → Speichern.

## 3. Datenbank anlegen
1. Links **Build → Firestore Database** → „Datenbank erstellen“.
2. Standort: **eur3 (Europe)** oder `europe-west3 (Frankfurt)` → Weiter.
3. „Im **Produktionsmodus** starten“ → Erstellen.
4. Reiter **Regeln**: alles löschen, den Inhalt der Datei [`firestore.rules`](firestore.rules) einfügen → **Veröffentlichen**.

## 4. Web-App registrieren
1. Zahnrad oben links → **Projekteinstellungen** → unten „Meine Apps“ → Symbol **`</>`** (Web).
2. Name z. B. `Einkauf`, Hosting **nicht** ankreuzen → App registrieren.
3. Es erscheint ein Code-Block mit `const firebaseConfig = { … };` – **diesen Block kopieren**.

## 5. In der App eintragen
**Variante A (am einfachsten):** In der App auf **Mehr → Gemeinsam nutzen** den kopierten Block einfügen →
„Konfiguration speichern“ → **„Gemeinsamen Haushalt starten“** → **„Einladung teilen“** und den Link
z. B. per WhatsApp an deine Frau schicken. Sie öffnet den Link, bestätigt – fertig.

**Variante B (für alle Geräte fest eingebaut):** Die Werte in `firebase-config.js` eintragen
(`window.FIREBASE_CONFIG = { … }`), committen und veröffentlichen. Dann muss auf keinem Gerät etwas eingefügt werden.

## Sicherheit
- Die Firebase-Konfiguration ist **kein Geheimnis** – sie steht in jeder Firebase-Web-App.
- Geschützt wird eure Liste durch den **24-stelligen Haushalts-Code** (wie ein Schlüssel) und die Regeln in
  `firestore.rules`: Nur angemeldete Geräte, die den Code kennen, können lesen/schreiben; niemand kann eine Liste
  aller Haushalte abrufen. Den Einladungslink also nur an Familie schicken.
- Fotos werden verkleinert direkt in der Datenbank gespeichert (kein kostenpflichtiger Firebase Storage nötig).
