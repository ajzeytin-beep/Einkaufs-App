# Einkauf 🛒

Gemeinsame Einkaufs-App als Web-App (läuft im Handy-Browser, lässt sich auf den Homescreen legen, funktioniert offline).
Design: warmes Beige/Braun, hell und dunkel.

## Bereiche
- **Übersicht (Dashboard):** offene Artikel, im Wagen, Fortschritt; „Wer kauft was“ pro Person; „Wo einkaufen“ pro Laden; zuletzt hinzugefügt.
- **Liste:** nach Laden gruppiert und innerhalb des Ladens nach dessen **Laufweg** (Eingang → Kasse) sortiert.
  Filter nach Laden und Person. Antippen = abhaken. Antippen des Personen-Kreises = wechselt, wer es kauft.
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

## Hinweis
Die Daten liegen derzeit auf dem jeweiligen Gerät. Der gemeinsame Abgleich zwischen mehreren Handys ist der nächste Schritt.
Die Ladenadressen stammen aus öffentlichen Verzeichnissen und OpenStreetMap und können veraltet sein.
