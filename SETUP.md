# Runde – Einrichtung (ca. 30 Minuten, einmalig)

## 1. Supabase-Projekt anlegen
1. supabase.com öffnen, mit GitHub oder E-Mail registrieren.
2. "New project": Name `runde`, Region **Frankfurt (eu-central-1)**, ein Datenbank-Passwort vergeben und aufschreiben.
3. Warten, bis das Projekt fertig ist (ca. 2 Minuten).

## 2. Datenbank einrichten
1. Links "SQL Editor" -> "New query".
2. Den kompletten Inhalt von `schema.sql` einfügen, "Run" drücken.
3. Erwartet: "Success. No rows returned". Bei Rot: Fehlertext kopieren und mir schicken.

## 3. Anmeldung ohne E-Mail-Bestätigung
Authentication -> Sign In / Providers -> Email -> **"Confirm email" ausschalten** -> Save.
(Sonst kommen die Bestätigungs-Mails nur sehr begrenzt an.) Sehen die Menüs anders aus: Screenshot schicken.

## 4. Zugangsdaten in config.js eintragen
1. Project Settings -> API (bzw. "API Keys" / "Data API").
2. Kopiere die **Project URL** und den **anon** (neu: **publishable**) Key.
3. Datei öffnen:
```
open -a TextEdit /Users/max/Runde/config.js
```
4. `https://DEIN-PROJEKT.supabase.co` und `DEIN-ANON-KEY` ersetzen, speichern.
5. Niemals den `service_role` bzw. `secret` Key eintragen.

## 5. Auf dem Mac testen
```
mkdir -p /Users/max/Runde && cd /Users/max/Runde && unzip -o /Users/max/Downloads/runde.zip
```
(nur beim ersten Mal, vor Schritt 4)
```
cd /Users/max/Runde && python3 -m http.server 8000
```
Dann im Browser `http://localhost:8000` öffnen. Beenden mit Ctrl+C.

## 6. Online stellen (damit Freunde es nutzen können)
1. github.com: Konto anlegen -> "New repository" -> Name `runde`, **Public** -> Create.
2. "uploading an existing file" -> alle Dateien aus `/Users/max/Runde` hineinziehen (auch `config.js` mit deinen Werten) -> "Commit changes".
3. Settings -> Pages -> Source: "Deploy from a branch" -> Branch `main`, Ordner `/ (root)` -> Save.
4. Nach ca. 1 Minute steht oben die Adresse: `https://DEINNAME.github.io/runde/`.

## 7. Auf dem Handy
- iPhone (Safari): Adresse öffnen -> Teilen -> "Zum Home-Bildschirm".
- Android (Chrome): Menü -> "App installieren".
- Registrieren, Gruppe erstellen, Code teilen. Freunde: Registrieren -> "Mit Code beitreten".

## Wichtig
- Gratis-Projekte bei Supabase pausieren nach längerer Nichtnutzung (Stand meines Wissens 7 Tage). Dann im Dashboard "Restore" klicken.
- Gratis-Speicher ist begrenzt (Stand meines Wissens 1 GB). Ein Foto hat ca. 150 KB.
- Der Einladungscode gibt Zugriff auf Fotos und Orte der Gruppe. Nur an Freunde geben.
- Punkte: ABV ÷ 5 pro Standardportion (Pils 0,5 l = 1, Wein 0,2 l = 2,4, Vodka 4 cl = 8), anteilig nach Menge.
- Limits pro Abend (Wechsel 6 Uhr): 15 Punkte **und** 100 g Reinalkohol. Admin ändert das unter "Gruppe".

## Erklärung im 5-Fragen-Schema
1. **Was geändert?** Neues Projekt "Runde": Web-App für Getränke-Tracking mit Rangliste, Karte, Fotobeweis.
2. **Warum?** Handy-fähig und immer online, ohne dass dein Mac läuft.
3. **Welche Datei macht was?** `schema.sql` Datenbank und Regeln · `logic.js` Punkte und Limits · `views.js` Bildschirme · `app.js` Anmeldung, Kamera, Karte, Speichern · `index.html` Gerüst und Design · `config.js` deine Zugangsdaten · `sw.js` + `manifest.webmanifest` + Icons: Installation aufs Handy.
4. **Technisch?** Kamera-Foto wird verkleinert, mit Zeitstempel versehen und privat hochgeladen. Die Datenbank-Funktion `log_drink` prüft alles, rechnet Punkte und Limits selbst und speichert. Rangliste und Karte lesen nur Daten der eigenen Gruppe.
5. **Lernen?** Der Browser darf der Datenbank nie blind vertrauen: Die Regeln (Punkte, Limits, Zugriff) stehen deshalb in der Datenbank, nicht nur in der App.
