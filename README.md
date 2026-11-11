# Einkauf 🛒

Gemeinsame Einkaufs-App als Web-App (läuft im Handy-Browser, lässt sich auf den Homescreen legen, funktioniert offline).
Design: warmes Beige/Braun, hell und dunkel.

## Bereiche
- **Übersicht (Dashboard):** offene Artikel, im Wagen, Fortschritt; „Wer kauft was“ pro Person; „Wo einkaufen“ pro Laden; zuletzt hinzugefügt.
- **Liste:** nach Laden gruppiert und innerhalb des Ladens nach dessen **Laufweg** (Eingang → Kasse) sortiert.
  Filter nach Laden und Person. Antippen = abhaken. Antippen des Personen-Kreises = wechselt, wer es kauft.
- **Angebote:** Wochenangebote eintragen (Produkt, Laden, Preis, gültig bis – Standard: nächster Samstag).
  Die App gleicht sie mit der Liste ab: Artikel bekommen ein **%-Abzeichen**, beim Eintragen erscheint ein Hinweis
  mit „Dort holen“, die Übersicht zeigt „X Artikel sind im Angebot“. Auch Ähnliches derselben Abteilung wird gemeldet
  (z. B. Penne, wenn Spaghetti im Angebot sind). Links zu den Prospekten eurer Läden, kaufDA und marktguru.
  Abgelaufene Angebote werden automatisch ausgeblendet.
- **Läden:** Startliste mit Supermärkten, Discountern und Drogerien in Emden. Suchen, Lieblingsläden per Stern ★ (stehen oben, in der Übersicht und in der Ladenauswahl), anlegen, bearbeiten, löschen.
  „Läden in Emden suchen“ lädt weitere Geschäfte live aus OpenStreetMap (Baumarkt, Mode, Bäcker, Elektronik …).
  Jeder Laden hat seinen eigenen Laufweg (⋯ → Reihenfolge der Abteilungen mit ▲/▼).
- **Personen:** hinzufügen, umbenennen, Farbe wählen, entfernen. „Das bin ich“ pro Gerät einstellen.
- **Mehr:** Abteilungen anlegen/umbenennen/löschen, Sicherung herunterladen/einspielen, alles zurücksetzen.

## Eintragen
„Tomaten“, „2 Dosen Mais“, „Käse - der milde Gouda“ (Text nach ` - ` wird Notiz). Die Abteilung wird automatisch erkannt;
Korrekturen merkt sich die App. 📷 fügt einen Artikel mit Foto hinzu.

## Starten
Lokal: `python3 -m http.server` und `http://localhost:8000` öffnen. Fürs Handy z. B. über GitHub Pages veröffentlichen
und „Zum Home-Bildschirm“ hinzufügen.

## Gemeinsam nutzen (Abgleich zwischen Handys)
Über **Supabase** (empfohlen, kostenlos) oder alternativ **Firebase**: einmal einrichten, dann per **Einladungslink**
beitreten. Änderungen erscheinen sofort auf allen Handys, offline geht alles weiter und wird später abgeglichen.
Anleitungen: **[SUPABASE.md](SUPABASE.md)** (Datenbank-Skript: `supabase.sql`) · [FIREBASE.md](FIREBASE.md) (`firestore.rules`).
Die Bibliotheken liegen lokal in `vendor/` (supabase-js 2.45.4, MIT · Firebase JS SDK 10.14.1, Apache-2.0) und werden
nur geladen, wenn der Abgleich eingerichtet ist.

## Hinweis
Die Ladenadressen stammen aus öffentlichen Verzeichnissen und OpenStreetMap und können veraltet sein.
