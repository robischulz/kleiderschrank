# Kleiderschrank – Anleitung

## 1. Online
Die App läuft über GitHub Pages: https://robischulz.github.io/kleiderschrank/
Dort liegt nur der App-Code, die Fotos bleiben ausschließlich auf dem iPhone.
Jeder Push auf `main` aktualisiert die Seite nach etwa einer Minute.

## 2. Auf dem iPhone installieren
1. Die Adresse in **Safari** öffnen.
2. Teilen-Symbol → **Zum Home-Bildschirm** → Hinzufügen.
3. Die App vom Home-Bildschirm starten und einmal den Kamerazugriff erlauben.
   Ab jetzt funktioniert sie auch ohne Internet.

## Bedienung
- **+** oben links: Kamera mit Umriss. Handy vors Gesicht, ganzer Körper in den Umriss, auslösen.
  Unten links kann man stattdessen ein vorhandenes Foto wählen, oben rechts die Kamera wechseln.
- Nach dem Foto: **Wiederholen**, **Ist ein Kleid**, **Hinzufügen** oder **✕** (zurück zur Galerie).
- Felder nach links/rechts wischen. **Kleider** zeigt nur Kleider (Oberkörper und Beine als ein Feld).
  **Zufall** stellt ein zufälliges Outfit zusammen.
- **Lange auf ein Feld drücken**: nur dieses Teil oder das ganze Foto löschen.
- **⋯** oben rechts: **Backup sichern** (→ Teilen → „In Dateien sichern“) und **Backup wiederherstellen**.
  Ein Punkt am ⋯ erinnert daran, wenn seit über 14 Tagen kein Backup gemacht wurde.

## Wichtig
- Wird die App vom Home-Bildschirm gelöscht, sind die Fotos weg. Vorher ein Backup machen.
- Nach Änderungen an der App: in `sw.js` die Versionsnummer (`kleiderschrank-v2` → `v3`) erhöhen
  und den Ordner neu hochladen. Die App aktualisiert sich dann beim nächsten Start.
