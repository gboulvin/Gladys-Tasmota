# Tasmota

Steuern Sie Ihre [Tasmota](https://tasmota.github.io/)-Geräte aus Gladys, **zu 100 % lokal**:
Steckdosen, Relais, Lampen und LED-Streifen, Dimmer, Rollläden, Ventilatoren, Energiezähler und
Sensoren. Keine Cloud.

## Was Sie bekommen

- **Automatische Erkennung** per MQTT (`LWT`, `Status 0` und die native Tasmota-Erkennung) und
  per HTTP (eine Adressliste oder der Scan eines IP-Bereichs).
- Jedes Gerät wird über seine **MAC-Adresse** erkannt: Umbenennen, ein neues Topic, eine neue IP
  oder der Wechsel von HTTP zu MQTT behalten dasselbe Gladys-Gerät und seinen Verlauf.
- **Relais** (`POWER1`…`POWER8`), **Lampen** (Ein/Aus, Helligkeit, RGB-Farbe, Farbtemperatur,
  Effekte und ihre Geschwindigkeit), **Ventilatoren** (`FanSpeed`), **Rollläden** (öffnen /
  schließen / stoppen, Position).
- **Energiemessung**: Leistung, Schein- und Blindleistung, Spannung, Strom, Energie heute,
  gestern und gesamt (der Gesamtwert ist ein kumulierter Zählerstand, nutzbar für die
  Energieüberwachung von Gladys), Mehrkanalzähler inklusive.
- **Sensoren**: Temperatur, Luftfeuchtigkeit, Luftdruck, Helligkeit, CO2, VOC, PM2.5 / PM10,
  Entfernung, UV-Index, Bodenfeuchte, Analogeingänge, Impulszähler, Schaltereingänge,
  Chiptemperatur, WLAN-Signal und Laufzeit.
- **Szenen-Auslöser**: Taste gedrückt (einfach, doppelt, dreifach… halten), Schaltereingang
  geändert, RF-Code empfangen (Sonoff RF Bridge), IR-Code empfangen, Gerät online / offline.
- **Szenen-Aktionen**: beliebigen Tasmota-Befehl senden (Backlog, RfSend, IRSend, Rule…), ein
  Relais zeitweise einschalten, eine Lampe blinken lassen, ein Gerät neu starten.
- **Dashboard-Widgets**: Geräteübersicht, Gerätekarte, Energiekarte.
- Ein **„Lokal“-Badge** an jedem Gerät, orange wenn der Broker ausgefallen ist und Befehle über
  HTTP laufen, rot wenn das Gerät nicht erreichbar ist.

## Wählen, wie die Geräte mit Gladys sprechen

Die Konfigurationsseite beginnt mit **Schritt 1 — Verbindungsmodus**, gefolgt von drei Blöcken.
Gladys zeigt alle Blöcke gleichzeitig: **Füllen Sie nur den Block der gewählten Option aus**,
die anderen werden ignoriert und können leer bleiben. Der Status oben auf der Seite zeigt
immer die aktive Option und was noch fehlt.

| Verbindungsmodus                               | Ausfüllen | Sie brauchen               |
| ---------------------------------------------- | --------- | -------------------------- |
| Option 1 — Mein vorhandener MQTT-Broker        | Block 1   | Adresse und Zugangsdaten   |
| Option 2 — Eigener Broker, von der Integration | Block 2   | nichts (Passwort optional) |
| Option 3 — Kein MQTT, nur HTTP                 | Block 3   | die IP-Adressen der Geräte |

### Option 1 — Mein vorhandener MQTT-Broker

Zum Beispiel der Broker der Gladys-**MQTT**-Integration, der bereits auf dem Gladys-Host läuft
(Port 1883, mit Benutzer und Passwort von der Seite dieser Integration).

1. **Verbindungsmodus**: _Option 1 — Mein vorhandener MQTT-Broker_.
2. **Block 1 — Broker-URL**: `mqtt://<IP des Brokers>:1883` — verwenden Sie die LAN-IP, nicht
   `localhost` (die Integration läuft in einem eigenen Container).
3. **Block 1 — Broker-Benutzer** und **Broker-Passwort**, dann speichern.
4. Auf jedem Tasmota-Gerät: **Configuration → MQTT**, denselben Host, Port, Benutzer und
   dasselbe Passwort eintragen.

### Option 2 — Eigener Broker, von der Integration bereitgestellt

1. **Verbindungsmodus**: _Option 2 — Eigener Broker, von der Integration bereitgestellt_.
2. **Block 2 — Passwort der Geräte**: optional, leer lassen, um eines zu erzeugen. Speichern:
   Die Integration startet einen eigenen Mosquitto-Container; Block 2 zeigt Adresse und Port
   für die Geräte (Benutzer `tasmota`).
3. Führen Sie die Aktion **Option 2 — Befehl für die Geräte abrufen** aus (IP-Adresse von
   Gladys eingeben): Sie liefert eine Zeile zum Einfügen, z. B.
   `Backlog MqttHost 192.168.1.10; MqttPort 41883; MqttUser tasmota; MqttPassword …`.
4. Fügen Sie sie in die **Console** jedes Tasmota-Geräts ein. Das Gerät startet neu und
   erscheint in Gladys.

### MQTT-Topics (Optionen 1 und 2)

Behalten Sie **%prefix%/%topic%/**, den Tasmota-Standard, außer Sie haben das Full Topic Ihrer
Geräte auf `%topic%/%prefix%/` geändert.

### Option 3 — Kein MQTT, nur HTTP

1. **Verbindungsmodus**: _Option 3 — Kein MQTT, nur HTTP_.
2. **Block 3 — HTTP-Adressen**: `192.168.1.20, 192.168.1.30-45` (oder die Aktion
   **IP-Bereich scannen** nutzen).
3. **Web-Benutzer** (`admin`) und **Web-Passwort**: nur wenn auf den Geräten ein Web-Passwort
   gesetzt ist. Die Geräte werden alle **HTTP-Aktualisierungsintervall** Sekunden gelesen
   (standardmäßig 30).

Block 3 funktioniert auch mit den Optionen 1 und 2, für die wenigen Geräte ohne MQTT. Ein per
HTTP gefundenes Gerät, das sich später mit dem Broker verbindet, wechselt von selbst zu MQTT;
die Aktion **Gerät auf MQTT umstellen** sendet ihm die Broker-Einstellungen für Sie.

## Geräte hinzufügen

Öffnen Sie den Reiter **Erkennung** der Integration: Die gefundenen Geräte erscheinen dort mit
ihren Funktionen. Klicken Sie auf **Hinzufügen**, wählen Sie den Raum, fertig. Bekommt ein Gerät
eine neue Funktion (ein angeschlossener Sensor, eine neue Firmware), erscheint eine Schaltfläche
**Aktualisieren**.

## Aktionen der Konfigurationsseite

- **Verbindung testen** — Broker-Status und Anzahl der Geräte online.
- **Option 2 — Befehl für die Geräte abrufen** — die Konsolenzeile für den eigenen Broker.
- **HTTP-Gerät hinzufügen** / **IP-Bereich scannen** — Geräte per HTTP finden (höchstens 1024
  Adressen).
- **Lampe identifizieren** — die Lampe blinkt zweimal und kehrt in ihren Zustand zurück. Relais
  blinken nie (sie können eine Heizung steuern).
- **Befehl senden** — beliebiger Tasmota-Befehl, die Antwort erscheint unter der Schaltfläche.
- **Gerät neu starten**.
- **Gerät auf MQTT umstellen** — sendet `MqttHost`, `MqttPort`, `MqttUser`, `MqttPassword`.

## Szenen

In der Kategorie **Integrationen** des Szeneneditors (Gladys 5.1 oder neuer):

| Auslöser                         | Nötige Tasmota-Einstellung                              | Variablen          |
| -------------------------------- | ------------------------------------------------------- | ------------------ |
| Tasmota-Taste gedrückt           | `SetOption73 1` (Tasten von den Relais entkoppelt)      | `button`, `action` |
| Tasmota-Schaltereingang geändert | `SetOption114 1` (Schalter von den Relais entkoppelt)   | `switch`, `action` |
| RF-Code empfangen                | eine RF Bridge (`RfReceived`)                           | `code`, `rf_key`   |
| IR-Code empfangen                | ein IR-Empfänger (`IrReceived`)                         | `code`, `protocol` |
| Tasmota-Gerät online / offline   | keine (LWT per MQTT, fehlgeschlagene Abfragen per HTTP) | `status`           |

Jeder Filter ist optional: Leer gelassen passt er auf alles. Lesen Sie die Werte in den folgenden
Aktionen z. B. mit `{{triggerEvent.data.code}}`.

Aktionen: **Tasmota-Befehl senden** (Ausgaben `answered` und `response`), **Relais zeitweise
einschalten** (das Gerät schaltet es selbst aus, bis zu 360 s), **Tasmota-Lampe blinken lassen**,
**Tasmota-Gerät neu starten**.

Die Zustände selbst (ein Relais, eine Temperatur…) sind normale Gerätefunktionen: Nutzen Sie
dafür den Standard-Auslöser „Gerätezustand“ und die Aktion „Gerät steuern“ von Gladys.

## Dashboard

- **Tasmota-Geräte** — Anzahl der Geräte, online und offline, Broker-Verbindung, Zustand jedes
  Geräts, eine Schaltfläche **Aktualisieren**.
- **Tasmota-Gerät** — wählen Sie ein Gerät: seine wichtigsten Live-Werte, IP, Firmware,
  WLAN-Signal, Laufzeit sowie die Schaltflächen **Umschalten**, **Identifizieren** (Lampen) und
  **Neustart**.
- **Tasmota-Energie** — wählen Sie ein Messgerät: Leistungskurve über 24 Stunden, Live-Leistung,
  Spannung, Strom, Energie heute, gestern und gesamt.

## Fehlerbehebung

- **Nichts in der Erkennung (MQTT)**: Prüfen Sie, dass die Broker-URL die LAN-IP nutzt und die
  Geräte in ihrer Konsole „MQTT connected“ anzeigen. Klicken Sie im Reiter Erkennung auf
  **Scannen**: Jedes bekannte Gerät wird erneut abgefragt.
- **Ein Gerät verlangt ein Passwort (HTTP)**: Tragen Sie Web-Benutzer und -Passwort in der
  Konfiguration oder in den Feldern der Aktionen Hinzufügen / Scannen ein.
- **Tasten lösen keine Szenen aus**: Senden Sie `SetOption73 1` an das Gerät (und
  `SetOption114 1` für Schaltereingänge).
- **Logs**: Öffnen Sie die Logs der Integration in Gladys; `LOG_LEVEL=debug` liefert alle
  Details.
