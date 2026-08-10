# systemdocu

Server-CMDB mit interaktiver Graphansicht. Dokumentiert physische und virtuelle Server, Services, Instanzen, Cluster, Anwendungen, Umgebungen/Subnetze und Internetanschlüsse — inklusive Zabbix-Integration und Excel-Export.

**Version: v0.5.0-alpha**

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

AUTH_USER=admin
AUTH_PASSWORD=geheim

ZABBIX_URL=https://monitoring.example.com/
ZABBIX_API_TOKEN=<api-token>
ZABBIX_VERIFY_SSL=false
```

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `POSTGRES_USER` | ✓ | Datenbankbenutzer |
| `POSTGRES_PASSWORD` | ✓ | Datenbankpasswort |
| `POSTGRES_DB` | ✓ | Datenbankname |
| `AUTH_USER` | ✓ | Benutzername für HTTP-Basic-Auth (schützt die komplette API) |
| `AUTH_PASSWORD` | ✓ | Passwort für HTTP-Basic-Auth — unbedingt vom Standardwert `admin` ändern |
| `ZABBIX_URL` | — | Zabbix-API-URL (z. B. `https://zabbix.example.com/`) |
| `ZABBIX_API_TOKEN` | — | API-Token (empfohlen) |
| `ZABBIX_USER` | — | Zabbix-Benutzer (Alternative zu Token) |
| `ZABBIX_PASSWORD` | — | Zabbix-Passwort (Alternative zu Token) |
| `ZABBIX_VERIFY_SSL` | — | `false` = SSL-Prüfung deaktivieren (Standard: `false`) |

---

## Speicherung / Persistenz

- Primärer Speicher: PostgreSQL-Datenbank im `postgres`-Container.
- DB-Verbindung: `postgresql+asyncpg://<POSTGRES_USER>:<POSTGRES_PASSWORD>@<POSTGRES_HOST>/<POSTGRES_DB>`.
- Die Datenbankstruktur wird in `backend/app/models.py` definiert. Wichtige Tabellen und ihre Formate sind:
  - `servers`: Hostname, FQDN, IP-/Gateway-Adressen als Strings, Betriebssystem-Typ, Beschreibung als Text, `is_gateway` als Boolean, Gateway-Verweise als Foreign-Key-IDs.
  - `services`: Service-Typ, Version als String, Port als Integer, Detailtext als Text.
  - `service_instances`: Instanzname, FQDN, Beschreibung als Text, IP/Gateway als String, Boolean-Felder `available` und `is_gateway`, sowie Verweise auf Router/Server/Cluster.
  - `environments`: Name, Beschreibung, Farbe, Subnetz, Gateway-IP als Strings, Default-Gateway-Verweise als Foreign Keys.
  - `applications`: Name, Beschreibung, Farbe als Strings.
  - `clusters`: Name, Beschreibung, Service-Typ, Domain als Strings.
  - `internet_routers`: Name, Anbieter, externe/interne IP als Strings, Upstream-Router-Referenz, verknüpfter Server als Foreign Key.
  - `relations` und `instance_relations`: Relationale Verknüpfungen zwischen Servern, Instanzen oder Clustern, gespeichert als Foreign-Key-IDs plus `type`/`direction` als Strings.
  - Join-Tabellen für M:N-Beziehungen: `server_environments`, `instance_environments`, `instance_applications`, `router_environments`, `cluster_members`.
- Schemaänderungen werden per Alembic in `backend/alembic` verwaltet und beim Start automatisch angewendet.
- Docker speichert die PostgreSQL-Daten dauerhaft im Host-Verzeichnis `/opt/docker/systemdocu/postgres`.
- Logs des Backends liegen im Host-Verzeichnis `/opt/docker/systemdocu/logs`.
- Es gibt keine persistente Flat-File-Datenbank für die CMDB-Daten; alle Kernobjekte werden relational in PostgreSQL gespeichert.

## Update

```bash
cd /opt/docker/systemdocu
git pull
docker compose build --no-cache
docker compose up -d
```

Datenbankmigrationen werden beim Start automatisch per **Alembic** angewendet — kein manueller SQL-Eingriff nötig.

---

## Datenmodell

### Grafische Übersicht

```
                           +-------------+
                           |   Server    |
                           +-------------+
                              /  |   \
                             /   |    \
                            /    |     \
                    hosts  /     |      \ belongs_to
                          /      |       \
                 +--------+   +--------+   +-------------+
                 |Service |   |Cluster |   |Environment  |
                 +--------+   +--------+   +-------------+
                      |           |             ^
                      | contains  | groups      |
                      v           v             |
                 +-------------+               +--------------+
                 |  Instance   |-------------->|  Application |
                 +-------------+               +--------------+
                      |   ^
          gateway     |   | belongs_to
                      |   |
                      v   |
               +----------------+
               | Internet/Gateway|
               +----------------+
```

### Textuelles Datenmodell

```
Server
├── Environments (M:N)          — Umgebungszugehörigkeit (z. B. Produktion, DMZ)
├── Anwendungen (M:N)           — Server, die komplett zu einer Anwendung gehören
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
├── Subnetz (z. B. 203.0.113.0/24)
├── Gateway-IP                  — freitextlich (veraltet, wird durch Gerät-Links ersetzt)
└── Default-Gateway-Gerät       — Internet-Router ODER Gateway-Server;
                                   wird neuen Mitgliedern automatisch zugewiesen

Internetanschluss / Router / Gateway
├── Anbieter, externe IP, interne IP
├── Upstream-Router              — Kette Richtung Internet
├── Verknüpfter Server           — wenn Gateway ein vorhandener Server ist
└── Environments (M:N)           — Netze, für die dieser Eintrag Gateway ist

Cluster
├── Name, Beschreibung, Domain/FQDN, Service-Typ (z. B. postgresql, kubernetes)
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
| Klick auf Cluster-Raute | Öffnet Cluster-Sidebar |

**Linke Seite/oben**: Internetanschlüsse/Router (immer sichtbar).

**Sidebar-Breite**: Die Sidebar lässt sich durch Ziehen des Trennbalkens zwischen Graph und Sidebar auf eine beliebige Breite (280–700 px) anpassen.

### Suche

Das Suchfeld in der Toolbar (Lupe) durchsucht alle **Servernamen**, **Instanznamen** und **IP-Adressen** in Echtzeit.

- Tipp-Eingabe → Dropdown mit bis zu 20 Treffern (Server- und Instanz-Einträge)
- Klick auf Eintrag oder **Enter** → Graph zoomt zum gefundenen Element, das Element blinkt **gelb** bis es angeklickt wird
- Bei versteckten Instanz-Knoten (zu weit herausgezoomt): automatisches Reinzoomen vor dem Fokussieren
- Pfeiltasten ↑/↓ zur Navigation im Dropdown, **Escape** zum Schließen

### Layout

| Schaltfläche | Beschreibung |
|---|---|
| **Hierarchisch** (Standard) | Nach Internetanschluss gruppiert: www-Server über ihrem Router, darunter der Router, darunter — getrennt durch größeren Abstand — je eine Spalte pro zugehöriger Umgebung (auch wenn mehrere Umgebungen an einem Anschluss hängen) |
| **Physik** | Kräftebasiertes Layout, frei verschiebbar |

Jede Umgebung erscheint zusätzlich als sechseckiger **Switch**-Knoten in ihrer
Umgebungsfarbe, verbunden mit allen Servern/Instanzen der Umgebung sowie —
falls konfiguriert — ihrem Standard-Gateway (Router oder GW-Server). Server-
und Instanz-Gateway-Verbindungen laufen dabei über den passenden Switch statt
als eigene Linie direkt zum Gateway — nur ein individuell abweichendes
Gateway (nicht das Umgebungs-Standard-Gateway) bekommt weiterhin eine eigene
Linie. Server-Punkte und Service/Instanz-Boxen sind in der Farbe ihrer
Anwendung(en) gefüllt (halb so groß bei Instanzen); ohne Anwendung sind sie
weiß, bei mehreren Anwendungen in gleich große Farbsegmente aufgeteilt.

### Filter

Über die Dropdowns **Umgebung** und **Anwendung** werden alle nicht passenden Server, Instanzen und Kanten ausgeblendet. Ein Server ist sichtbar, wenn er oder eine seiner Instanzen der gewählten Umgebung/Anwendung zugeordnet ist.

### Server anlegen

1. Schaltfläche **+ Server** → Hostname, IP(s), OS-Typ, Beschreibung eintragen
2. OS-Typ: Linux, Windows, Proxmox, ESXi, Hyper-V — bestimmt Icon-Farbe im Graph und im Excel-Export
3. IP-Felder akzeptieren mehrere Adressen kommagetrennt (z. B. `198.51.100.10, 203.0.113.20`)
4. **Als Gateway markieren**: Checkbox „Ist Gateway-Server" — macht den Server in allen Gateway-Dropdowns auswählbar

**Anwendungen**: Im Bereich „Anwendungen" der Server-Sidebar lässt sich der **ganze Server** direkt einer Anwendung zuordnen — für Hosts, die komplett einer Anwendung gehören. Die Checkbox „auch für Services/Instanzen übernehmen" (standardmäßig **deaktiviert**) entscheidet, ob sich die Zuordnung zusätzlich an alle Services und Instanzen des Servers vererbt: nur dann gelten sie in Anwendungs-Filter und Excel-Export als zur Anwendung gehörig, auch ohne eigene Anwendungs-Zuordnung (in der Instanz-Sidebar als abgeblasste Chips mit ↳-Symbol erkennbar; auf dem Server-Chip selbst ebenfalls ein ↳-Symbol). Server ohne Instanzen erscheinen im Excel-Export als „— ganzer Server —" — unabhängig von der Vererbungs-Checkbox.

### Services & Instanzen

In der Sidebar des Servers:

- **Service hinzufügen**: Typ wählen (PostgreSQL, Docker, Hyper-V, Samba, NFS, MQTT …), Version und Port optional
- Jeder Service-Typ kann pro Server **nur einmal** angelegt werden
- **Instanz hinzufügen**: Name und optionale Beschreibung

**Instanz-Aktionen** (unterhalb des Instanznamens):

| Service-Typ | Verfügbare Aktionen |
|---|---|
| kubernetes, hyperv, docker, proxmox, esxi | **+Netzwerk** · **+Anwendung** · **+Service** (Dropdown-Buttons) |
| postgresql, samba, nfs, sftp, webserver, mqtt, gateway | **+Anwendung** (Dropdown-Button) |

Jede Instanz zeigt darunter ihre **Relationen** als kompakte Liste mit Richtungspfeil, Servernamen/Instanzname und Relationstyp.

Bei Hyper-V/ESXi/Proxmox: Instanzen sind VMs und erhalten ein eigenes IP-Feld sowie ein Gateway-Dropdown.

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

- Farbe, Name, Subnetz (`203.0.113.0/24`), Gateway-IP nachträglich bearbeitbar (Stift-Icon)
- **Default-Gateway-Gerät**: Dropdown mit allen Internet-Routern und Gateway-Servern, gruppiert nach Typ. Wird neuen Server- und Instanz-Mitgliedern automatisch als Gateway gesetzt.
- Farb-Dot direkt anklicken für schnellen Farbwechsel
- Umgebungen werden Servern **und** einzelnen Instanzen (z. B. VMs) zugeordnet

### Internetanschlüsse & Gateway-Verlauf

Schaltfläche **Anschlüsse**:

| Feld | Beschreibung |
|---|---|
| Name / Firewall | Bezeichnung des Geräts (z. B. `FW-Provider`, `GW-Server1`) |
| Anbieter | ISP-Name (z. B. `Provider A`, `Provider B`) |
| Externe IP | Öffentliche IP oder `DHCP` |
| Interne IP | LAN-seitige IP des Routers/Gateways |
| Upstream-Router | Gerät Richtung Internet (für Ketten-Visualisierung) |
| Verknüpfter Server | Vorhandener Server, der als Gateway fungiert |
| Umgebungen | Alle Subnetze/Umgebungen, für die dieser Eintrag Gateway ist |

**Beispiel: Server1 ist Gateway für mehrere Subnetze, hinter einer Firewall:**

1. Eintrag „FW-Provider" anlegen — kein verknüpfter Server, Upstream leer → erscheint links fixiert
2. Server1 → Bearbeiten → „Ist Gateway-Server" aktivieren
3. Umgebungen (`198.51.100.0/24`, `203.0.113.0/24`, …) → Default-Gateway-Gerät: `GW-Server1` wählen
4. Graph zeigt (immer sichtbar):
   `🌐 Internet → 🔒 FW-Provider → server1 → alle Server in diesen Netzen`

### Server-Relationen

In der Sidebar unter **Server-Relation**:

- Zielserver aus Dropdown wählen (alle Server inkl. des aktuellen — dieser ist mit `(dieser)` gekennzeichnet)
- Relationstyp: `connects_to`, `hosts`, `depends_on`

### Cluster verwalten

Schaltfläche **Cluster**:

- **Neuen Cluster erstellen**: Name, Beschreibung (optional), Domain/FQDN (optional) und Service-Typ wählen → **Erstellen**
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

Erkannt werden: PostgreSQL, Docker, Kubernetes, Samba, NFS, Veeam, MinIO, Hyper-V, Proxmox-VMs.

Der Button zeigt Verbindungsstatus an:
- Grüner Rahmen: Zabbix erreichbar
- Roter Hintergrund: nicht erreichbar oder falsche Credentials

### Erkennungsmethoden

**LLD-basiert** (empfohlen): Der Scan wertet aktive Zabbix-Discovery-Rules aus. Dabei werden sowohl Standard-Keys (`docker.containers.discovery`, `pgsql.db.discovery`, …) als auch vollständige Keys mit Parametern unterstützt. Letzteres erlaubt eigene `system.run`-Rules, z. B. für Proxmox:

```
system.run[sudo pvesh get /cluster/resources --type vm --output-format json]
```

**Item-basiert** (Fallback): Für Dienste ohne LLD-Rule können zusätzliche Scanner eingebunden werden. Die Scanner liegen als einzelne Python-Dateien in `backend/app/routers/zabbix_scanners/` und werden automatisch geladen. Jede Datei muss eine Funktion `scan(zapi, hostid, services)` bereitstellen — keine weitere Registrierung nötig. Mitgeliefert: `hyperv.py` (PowerShell Get-VM Items) und `proxmox.py` (Items im Format `ProxmoxVM [ID]: Name`).

**Eigene Scanner hinzufügen:**

```python
# backend/app/routers/zabbix_scanners/mein_scanner.py
import logging
logger = logging.getLogger("systemdocu")

def scan(zapi, hostid: str, services: dict) -> None:
    items = zapi.item.get(output=["name"], hostids=[hostid],
                          search={"name": "Mein Muster"}, limit=500)
    for item in items:
        # services["mein-typ"] = {"version": None, "instances": set()}
        # services["mein-typ"]["instances"].add(item["name"])
        pass
```

---

## Export

### Excel

Schaltfläche **Excel** → `systemdocu.xlsx` wird heruntergeladen.

- **Sheet 1 „Infrastruktur"**: Server → Service → Instanz → Anwendungen (mit Umgebungen, IPs, OS)
- **Sheet 2 „Anwendungen"**: Anwendung → Instanz → Service → Server

Server- und Service-Zellen sind farbig markiert (entsprechend der Graph-Farben). Erste Zeile eingefroren, Spaltenbreiten vorgegeben.

### DB Import/Export (JSON)

Schaltfläche **DB Import/Export** → vollständiger, verlustfreier Export als
`systemdocu-export.json`. Anders als der Excel-Export bleiben dabei IDs,
Router, Cluster, Relationen und alle Felder erhalten — geeignet zum
1:1-Umzug auf eine andere Instanz oder als Vollbackup.

**Import ersetzt die gesamte Datenbank** (Bestätigungsabfrage in der UI) —
alle Tabellen werden geleert und komplett aus der Datei neu befüllt.

---

## Backup & Restore

```bash
# Backup
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20250101.sql | docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
```

Alternativ: **DB Import/Export**-Button in der UI (siehe oben) für ein
JSON-basiertes Backup/Restore ohne Shell-Zugriff auf den Server.

---

## Architektur

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│  frontend/index.html  (vanilla JS + vis-network)    │
│  SSE-Client: Echtzeit-Aktualisierung bei Änderungen │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP :9191
┌──────────────────────▼──────────────────────────────┐
│  nginx  (Frontend-Container)                        │
│  /api/* → proxy_pass backend:8000                   │
│  X-Accel-Buffering: no  (SSE-Durchleitung)          │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  FastAPI  (Backend-Container, Python 3.12)          │
│  SQLAlchemy 2.0 async + asyncpg                     │
│  Alembic-Migrationen beim Start (entrypoint.sh)     │
│  SSE-Endpoint /api/events (asyncio.Queue-Bus)       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  PostgreSQL 16                                      │
│  Volume: /opt/docker/systemdocu/postgres            │
└─────────────────────────────────────────────────────┘
```

Alle drei Container laufen im internen Docker-Netzwerk `internal`. Nur Port `9191` (nginx) ist nach außen geöffnet.

**Echtzeit-Sync**: Jede Schreiboperation broadcastet ein SSE-Event (`data_changed`). Alle verbundenen Browser laden die Daten neu und aktualisieren den Graphen diff-basiert — ohne Zoom oder Physik-Positionen zurückzusetzen. Mehrere gleichzeitige Nutzer werden vollständig unterstützt.

### Service-Typen

| Typ | Icon | Farbe |
|---|---|---|
| postgresql | 🗄 | Blau |
| mysql | 🗄 | Orange |
| docker | 🐳 | Hellblau |
| kubernetes | ☸ | Indigo |
| hyperv | 🖥 | Cyan |
| proxmox | 🖧 | Orange |
| esxi | 🖥 | Grün |
| samba | 📁 | Amber |
| nfs | 🗂 | Dunkel-Amber |
| sftp | 📂 | Grün |
| freeipa | 🔑 | Violett |
| zabbix | 📊 | Rot |
| graylog | 📝 | Dunkelgrau |
| veeam | 💾 | Grün |
| minio | 🪣 | Rot-Orange |
| gateway | 🔀 | Teal |
| webserver | 🌐 | Hellblau |
| mqtt | 📨 | Lila |

### Datenbankmigrationen

Schema-Änderungen werden versioniert mit **Alembic** verwaltet (`backend/alembic/versions/`). Beim Container-Start führt `entrypoint.sh` automatisch `alembic upgrade head` aus.

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
| GET/POST/PUT/DELETE | `/api/applications` | Anwendungen verwalten |
| GET/POST/PUT/DELETE | `/api/internet-routers` | Internetanschlüsse verwalten |
| GET | `/api/export/excel` | Excel-Export |
| GET | `/api/db-export` | Vollständiger JSON-Export (verlustfrei) |
| POST | `/api/db-import` | Vollständiger JSON-Import (ersetzt alle Daten) |
| GET | `/api/events` | SSE-Stream für Echtzeit-Updates |
| GET | `/api/zabbix/ping` | Zabbix-Verbindungsstatus |
| GET | `/api/zabbix/hosts` | Zabbix-Hosts auflisten |
| POST | `/api/zabbix/scan` | Host scannen |
| POST | `/api/zabbix/import` | Scan-Ergebnis importieren |
