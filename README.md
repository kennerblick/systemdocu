# systemdocu

Server-CMDB mit interaktiver Graphansicht. Dokumentiert physische und virtuelle Server, Services, Instanzen, Cluster, Anwendungen, Umgebungen/Subnetze und Internetanschlüsse — inklusive Zabbix-Integration und Excel-Export.

![Graph-Ansicht](docs/screenshot.png)

---

## Inhaltsverzeichnis

- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Konfiguration (.env)](#konfiguration-env)
- [Update](#update)
- [Datenmodell](#datenmodell)
- [Bedienung](#bedienung)
- [Zabbix-Integration](#zabbix-integration)
- [Export](#export)
- [Backup & Restore](#backup--restore)
- [Architektur](#architektur)
- [API-Übersicht](#api-übersicht)

---

## Voraussetzungen

- Docker ≥ 24 + Docker Compose v2
- Verzeichnisse auf dem Host:

```bash
mkdir -p /opt/docker/systemdocu/postgres /opt/docker/systemdocu/logs
```

---

## Installation

```bash
git clone https://github.com/kennerblick/systemdocu.git
cd systemdocu

cp .env.example .env
# .env anpassen (Passwörter, Zabbix-URL)

docker compose up -d --build
```

Aufruf im Browser: `http://<server-ip>:9191`

Beim ersten Start werden drei Demo-Server mit Services angelegt. Diese können jederzeit gelöscht werden.

---

## Konfiguration (.env)

```env
POSTGRES_USER=systemdocu
POSTGRES_PASSWORD=geheim
POSTGRES_DB=systemdocu

ZABBIX_URL=https://monitoring.example.com/
ZABBIX_API_TOKEN=<api-token>
ZABBIX_VERIFY_SSL=false
```

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `POSTGRES_USER` | ✓ | Datenbankbenutzer |
| `POSTGRES_PASSWORD` | ✓ | Datenbankpasswort |
| `POSTGRES_DB` | ✓ | Datenbankname |
| `ZABBIX_URL` | — | Zabbix-API-URL (z. B. `https://zabbix.example.com/`) |
| `ZABBIX_API_TOKEN` | — | API-Token (empfohlen) |
| `ZABBIX_USER` | — | Zabbix-Benutzer (Alternative zu Token) |
| `ZABBIX_PASSWORD` | — | Zabbix-Passwort (Alternative zu Token) |
| `ZABBIX_VERIFY_SSL` | — | `false` = SSL-Prüfung deaktivieren (Standard: `false`) |

---

## Update

```bash
cd /opt/docker/systemdocu
git pull
docker compose build --no-cache
docker compose up -d
```

Neue Datenbankspalten werden beim Start automatisch per `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migriert — kein manueller SQL-Eingriff nötig.

---

## Datenmodell

```
Server
├── Environments (M:N)          — Umgebungszugehörigkeit (z. B. Produktion, DMZ)
├── Gateway-Gerät               — Internet-Router ODER Gateway-Server (FK, optional)
├── is_gateway                  — markiert den Server als nutzbares Gateway
└── Services (1:N)              — installierte Dienste (PostgreSQL, Docker, Hyper-V …)
    └── Instanzen (1:N)
        ├── IP-Adresse           — nur bei VM-Typen (hyperv, esxi, proxmox)
        ├── Gateway-Gerät        — Internet-Router ODER Gateway-Server (FK, optional)
        ├── Environments (M:N)   — Umgebungszugehörigkeit der Instanz
        ├── Anwendungen (M:N)    — zugeordnete Applikationen
        └── Eigene Dienste (1:N) — vom VM angebotene Services (Webserver, MQTT …)

Environment
├── Subnetz (z. B. 192.168.1.0/24)
├── Gateway-IP                  — freitextlich (veraltet, wird durch Gerät-Links ersetzt)
└── Default-Gateway-Gerät       — Internet-Router ODER Gateway-Server;
                                   wird neuen Mitgliedern automatisch zugewiesen

Internetanschluss / Router / Gateway
├── Anbieter, externe IP, interne IP
├── Upstream-Router              — Kette Richtung Internet
├── Verknüpfter Server           — wenn Gateway ein vorhandener Server ist
└── Environments (M:N)           — Netze, für die dieser Eintrag Gateway ist

Cluster
├── Name, Beschreibung, Service-Typ (z. B. postgresql, kubernetes)
└── Mitglieder (M:N)               — Instanzen gleichen Typs von beliebigen Servern

Relationen
├── Server–Server   (connects_to, hosts, depends_on)
└── Instanz/Cluster → Instanz/Cluster  (connects_to, uses, depends_on, hosts)
    └── Datenrichtung: → (to), ← (from), ↔ (both), — (none)
```

---

## Bedienung

### Graph

| Aktion | Beschreibung |
|---|---|
| Klick auf Server-Knoten | Öffnet Sidebar mit Details |
| Reinzoomen (> 65 %) | Zeigt Instanz-Knoten innerhalb des Servers |
| Rauszoomen | Blendet Instanz-Knoten aus, zeigt Übersichtskanten |
| Hover über Kante | Zeigt Verbindungsdetails als Tooltip |
| VM-Instanzen | Werden visuell im farbigen Bereich ihres Hyper-V-Hosts dargestellt |

**Linke Seite**: Internetanschlüsse/Router (erscheinen nur wenn Toggle „🌐 Internet" aktiv).

**Sidebar-Breite**: Die Sidebar lässt sich durch Ziehen des Trennbalkens zwischen Graph und Sidebar auf eine beliebige Breite (280–700 px) anpassen.

### Filter

Über die Dropdowns **Umgebung** und **Anwendung** werden alle nicht passenden Server, Instanzen und Kanten ausgeblendet. Ein Server ist sichtbar, wenn er oder eine seiner Instanzen der gewählten Umgebung/Anwendung zugeordnet ist.

### Server anlegen

1. Schaltfläche **+ Server** → Hostname, IP(s), OS-Typ, Beschreibung eintragen
2. IP-Felder akzeptieren mehrere Adressen kommagetrennt (z. B. `10.0.1.10, 192.168.2.3`)
3. **Als Gateway markieren**: Checkbox „Ist Gateway-Server" — macht den Server in allen Gateway-Dropdowns auswählbar

### Services & Instanzen

In der Sidebar des Servers:

- **Service hinzufügen**: Typ wählen (PostgreSQL, Docker, Hyper-V, Samba, MQTT …), Version und Port optional
- Jeder Service-Typ kann pro Server **nur einmal** angelegt werden
- **Instanz hinzufügen**: Name und optionale Beschreibung
- Bei Hyper-V/ESXi/Proxmox: Instanzen sind VMs und erhalten ein eigenes IP-Feld sowie ein Gateway-Dropdown
- **Umgebungen** und **Anwendungen** können per Chip-Button jeder Instanz zugeordnet werden

**VM-eigene Dienste**: Eine VM kann selbst Dienste anbieten (z. B. Webserver, MQTT-Broker). Diese werden im unteren Bereich der VM-Kachel als Liste verwaltet (Typ, Version, Port) und erscheinen als auswählbare Einträge in den Instanz-Relationen-Dropdowns (mit `↳`-Präfix).

**Doppelt angelegter Service (Merge):** Wenn ein Service-Typ versehentlich doppelt existiert, erscheint in der Kopfzeile des Duplikats ein **⎇ Zusammenführen**-Button. Alle Instanzen werden verlustfrei in den anderen Service verschoben, das leere Duplikat wird gelöscht.

### Gateway-Gerät

Jeder **Server** und jede **VM-Instanz** kann einem Gateway-Gerät zugeordnet werden. Als Gateway kommen infrage:

- Ein Eintrag aus **Internetanschlüsse** (Internet-Router/Firewall)
- Ein vorhandener **Server**, der als Gateway markiert ist (`Is Gateway` aktiviert)

Das Dropdown zeigt alle Internet-Router sowie alle als Gateway markierten Server — unabhängig von deren Umgebungszugehörigkeit.

**Automatische Zuweisung**: Wenn ein Server oder eine VM einer Umgebung hinzugefügt wird, und die Umgebung hat ein Default-Gateway konfiguriert, wird dieses automatisch als Gateway-Gerät eingetragen (nur wenn noch keines gesetzt ist).

### Umgebungen verwalten

Schaltfläche **Umgebungen**:

- Farbe, Name, Subnetz (`192.168.1.0/24`), Gateway-IP nachträglich bearbeitbar (Stift-Icon)
- **Default-Gateway-Gerät**: Dropdown mit allen Internet-Routern und Gateway-Servern, gruppiert nach Typ. Wird neuen Server- und Instanz-Mitgliedern automatisch als Gateway gesetzt.
- Farb-Dot direkt anklicken für schnellen Farbwechsel
- Umgebungen werden Servern **und** einzelnen Instanzen (z. B. VMs) zugeordnet

### Internetanschlüsse & Gateway-Verlauf

Schaltfläche **Anschlüsse** (sichtbar wenn Toggle **🌐 Internet** aktiv oder unabhängig davon):

| Feld | Beschreibung |
|---|---|
| Name / Firewall | Bezeichnung des Geräts (z. B. `FW-Telekom`, `GW-Server3`) |
| Anbieter | ISP-Name (z. B. `Telekom`, `Vodafone`) |
| Externe IP | Öffentliche IP oder `DHCP` |
| Interne IP | LAN-seitige IP des Routers/Gateways |
| Upstream-Router | Gerät Richtung Internet (für Ketten-Visualisierung) |
| Verknüpfter Server | Vorhandener Server, der als Gateway fungiert |
| Umgebungen | Alle Subnetze/Umgebungen, für die dieser Eintrag Gateway ist |

**Beispiel: Server3 ist Gateway für mehrere Subnetze, hinter einer Firewall:**

1. Eintrag „FW-Telekom" anlegen — kein verknüpfter Server, Upstream leer → erscheint links fixiert
2. Server3 → Bearbeiten → „Ist Gateway-Server" aktivieren
3. Umgebungen (`192.168.6.0/24`, `192.168.7.0/24`, …) → Default-Gateway-Gerät: `GW-Server3` wählen
4. Mit Toggle **🌐 Internet** einblenden → Graph zeigt:
   `🌐 Internet → 🔒 FW-Telekom → server3 → alle Server in diesen Netzen`

### Server-Relationen

In der Sidebar unter **Server-Relation**:

- Zielserver aus Dropdown wählen (alle Server inkl. des aktuellen — dieser ist mit `(dieser)` gekennzeichnet)
- Relationstyp: `connects_to`, `hosts`, `depends_on`

### Cluster verwalten

Schaltfläche **Cluster**:

- **Neuen Cluster erstellen**: Name, Beschreibung (optional) und Service-Typ wählen → **Erstellen**
- **Mitglieder hinzufügen**: Stift-Icon → Server wählen → Instanzen des passenden Typs erscheinen → **+ Mitglied**. Mitglieder können von beliebig vielen Servern sein.
- **Mitglied entfernen**: Chip mit × anklicken
- **Cluster löschen**: × in der Kopfzeile
- Im Graph erscheinen Cluster als **◆ Raute** in der Farbe des Service-Typs, verbunden mit ihren Mitglied-Instanzen durch gestrichelte Kanten
- In der **hierarchischen Ansicht** werden Cluster als eigene Gruppe ganz oben angezeigt

### Instanz-Relationen

Unter **Instanz-Relationen**:

- **Liste**: Zeigt ausgehende Verbindungen des aktuell gewählten Quell-Eintrags. Beim Wechsel der Quelle im Dropdown aktualisiert sich die Liste automatisch.
- **Quelle** (`ir-src`): Cluster (◆) und Instanzen des aktuellen Servers, gruppiert nach Typ
- **Ziel**: Entweder einen Cluster direkt auswählen — oder Server wählen und dann die Ziel-Instanz
- Relationstypen: `connects_to`, `uses`, `depends_on`, `hosts`
- **Datenrichtung**: → (zum Ziel), ← (zur Quelle), ↔ (beidseitig), — (kein Pfeil)
- **Bearbeiten**: Stift-Icon in der Zeile → Typ und Richtung inline ändern

---

## Zabbix-Integration

### API-Token erstellen

Zabbix → Administration → API-Token → Token erstellen, Benutzer mit **Lesezugriff** zuweisen.

### Scan & Import

1. Schaltfläche **Scan Zabbix** (grüner Rahmen = Verbindung OK)
2. Host aus der Liste wählen → **Scannen**
3. Erkannte Services prüfen → **Importieren**

Erkannt werden: PostgreSQL, MySQL, Docker, Kubernetes, Samba, SFTP, FreeIPA, Zabbix, Graylog, Veeam, MinIO, Hyper-V.

Der Button zeigt Verbindungsstatus an:
- Grüner Rahmen: Zabbix erreichbar
- Roter Hintergrund: nicht erreichbar oder falsche Credentials

---

## Export

### Excel

Schaltfläche **Excel** → `systemdocu.xlsx` wird heruntergeladen.

- **Sheet 1 „Infrastruktur"**: Server → Service → Instanz → Anwendungen (mit Umgebungen, IPs, OS)
- **Sheet 2 „Anwendungen"**: Anwendung → Instanz → Service → Server

Server- und Service-Zellen sind farbig markiert (entsprechend der Graph-Farben). Erste Zeile eingefroren, Spaltenbreiten vorgegeben.

### JSON

Schaltfläche **↓** (neben Excel) → vollständiger Rohdaten-Export als `systemdocu-export.json`.

---

## Backup & Restore

```bash
# Backup
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20250101.sql | docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
```

---

## Architektur

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│  frontend/index.html  (vanilla JS + vis-network)    │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP :9191
┌──────────────────────▼──────────────────────────────┐
│  nginx  (Frontend-Container)                        │
│  /api/* → proxy_pass backend:8000                   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  FastAPI  (Backend-Container, Python 3.12)          │
│  SQLAlchemy async + asyncpg                         │
│  Automatische DB-Migration beim Start               │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  PostgreSQL 16                                      │
│  Volume: /opt/docker/systemdocu/postgres            │
└─────────────────────────────────────────────────────┘
```

Alle drei Container laufen im internen Docker-Netzwerk `internal`. Nur Port `9191` (nginx) ist nach außen geöffnet.

### Service-Typen

| Typ | Icon | Farbe |
|---|---|---|
| postgresql | 🗄 | Blau |
| mysql | 🗄 | Orange |
| docker | 🐳 | Hellblau |
| kubernetes | ☸ | Indigo |
| hyperv | 🖥 | Cyan |
| proxmox | 🖥 | Orange |
| esxi | 🖥 | Grün |
| samba | 📁 | Orange |
| sftp | 📂 | Grün |
| freeipa | 🔑 | Violett |
| zabbix | 📊 | Rot |
| graylog | 📝 | Dunkelgrau |
| veeam | 💾 | Grün |
| minio | 🪣 | Rot-Orange |
| gateway | 🔀 | Teal |
| webserver | 🌐 | Hellblau |
| mqtt | 📨 | Lila |

### Logs

Backend-Logs (Warnungen und Fehler) unter `/opt/docker/systemdocu/logs/backend.log`, rotierend, max. 10 MB × 5 Dateien.

```bash
tail -f /opt/docker/systemdocu/logs/backend.log
```

---

## API-Übersicht

Interaktive Swagger-Doku: `http://<server-ip>:9191/api/docs`

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET/POST | `/api/servers` | Server auflisten / anlegen |
| GET/PUT/DELETE | `/api/servers/{id}` | Server abrufen / aktualisieren / löschen |
| GET/POST | `/api/servers/{id}/services` | Services eines Servers |
| GET/POST | `/api/services/{id}/instances` | Instanzen eines Services |
| PATCH/DELETE | `/api/instances/{id}` | Instanz aktualisieren / löschen |
| POST/DELETE | `/api/instances/{id}/environments/{env_id}` | Umgebung zuordnen / entfernen |
| POST/DELETE | `/api/instances/{id}/applications/{app_id}` | Anwendung zuordnen / entfernen |
| GET/POST | `/api/clusters` | Cluster auflisten / anlegen |
| PATCH/DELETE | `/api/clusters/{id}` | Cluster aktualisieren / löschen |
| POST/DELETE | `/api/clusters/{id}/instances/{inst_id}` | Mitglied hinzufügen / entfernen |
| GET/POST | `/api/instance-relations` | Instanz/Cluster-Relationen |
| PATCH/DELETE | `/api/instance-relations/{id}` | Relation aktualisieren / löschen |
| GET/POST | `/api/relations` | Server-Relationen |
| GET/POST/PUT/DELETE | `/api/environments` | Umgebungen verwalten |
| GET/POST/DELETE | `/api/applications` | Anwendungen verwalten |
| GET/POST/PUT/DELETE | `/api/internet-routers` | Internetanschlüsse verwalten |
| GET | `/api/export/json` | JSON-Rohdaten-Export |
| GET | `/api/export/excel` | Excel-Export |
| GET | `/api/zabbix/ping` | Zabbix-Verbindungsstatus |
| GET | `/api/zabbix/hosts` | Zabbix-Hosts auflisten |
| POST | `/api/zabbix/scan` | Host scannen |
| POST | `/api/import/zabbix` | Scan-Ergebnis importieren |
