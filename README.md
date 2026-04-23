# systemdocu

Server-CMDB mit interaktiver Graphansicht. Dokumentiert physische und virtuelle Server, Services, Instanzen, Anwendungen, Umgebungen/Subnetze und Internetanschlüsse — inklusive Zabbix-Integration und Excel-Export.

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
└── Services (1:N)              — installierte Dienste (PostgreSQL, Docker, Hyper-V …)
    └── Instanzen (1:N)
        ├── IP-Adressen          — nur bei VM-Typen (hyperv, esxi, proxmox)
        ├── Environments (M:N)   — Umgebungszugehörigkeit der Instanz
        └── Anwendungen (M:N)    — zugeordnete Applikationen

Environment
├── Subnetz (z. B. 192.168.1.0/24)
└── Gateway-IP

Internetanschluss / Router / Gateway
├── Anbieter, externe IP, interne IP
├── Upstream-Router              — Kette Richtung Internet
├── Verknüpfter Server           — wenn Gateway ein vorhandener Server ist
└── Environments (M:N)           — Netze, für die dieser Eintrag Gateway ist

Relationen
├── Server–Server (connects_to, hosts, depends_on)
└── Instanz–Instanz  (connects_to, uses, depends_on, hosts)
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

### Filter

Über die Dropdowns **Umgebung** und **Anwendung** werden alle nicht passenden Server, Instanzen und Kanten ausgeblendet. Ein Server ist sichtbar, wenn er oder eine seiner Instanzen der gewählten Umgebung/Anwendung zugeordnet ist.

### Server anlegen

1. Schaltfläche **+ Server** → Hostname, IP(s), OS-Typ, Beschreibung eintragen
2. IP-Felder akzeptieren mehrere Adressen kommagetrennt (z. B. `10.0.1.10, 192.168.2.3`)

### Services & Instanzen

In der Sidebar des Servers:

- **Service hinzufügen**: Typ wählen (PostgreSQL, Docker, Hyper-V, Samba …), Version und Port optional
- Jeder Service-Typ kann pro Server **nur einmal** angelegt werden
- **Instanz hinzufügen**: Name und optionale Beschreibung
- Bei Hyper-V/ESXi/Proxmox: Instanzen sind VMs und erhalten ein eigenes IP-Feld
- **Umgebungen** und **Anwendungen** können per Chip-Button jeder Instanz zugeordnet werden

**Doppelt angelegter Service (Merge):** Wenn ein Service-Typ versehentlich doppelt existiert, erscheint in der Kopfzeile des Duplikats ein **⎇ Zusammenführen**-Button. Alle Instanzen werden verlustfrei in den anderen Service verschoben, das leere Duplikat wird gelöscht.

### Umgebungen verwalten

Schaltfläche **Umgebungen**:

- Farbe, Name, Subnetz (`192.168.1.0/24`), Gateway-IP nachträglich bearbeitbar (Stift-Icon)
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
2. Eintrag „GW-Server3" anlegen — Upstream: `FW-Telekom`, Verknüpfter Server: `server3`, Umgebungen: `192.168.2.0/24`, `192.168.6.0/24`, `192.168.7.0/24`
3. Mit Toggle **🌐 Internet** einblenden → Graph zeigt:
   `🌐 Internet → 🔒 FW-Telekom → server3 → alle Server in diesen drei Netzen`

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
| docker | 🐳 | Hellblau |
| kubernetes | ☸ | Indigo |
| hyperv | 🖥 | Cyan |
| samba | 📁 | Orange |
| sftp | 📂 | Grün |
| freeipa | 🔑 | Violett |
| zabbix | 📊 | Rot |
| graylog | 📝 | Dunkelgrau |
| veeam | 💾 | Grün |
| minio | 🪣 | Rot-Orange |
| gateway | 🔀 | Teal |
| webserver | 🌐 | Hellblau |

### Logs

Backend-Logs (Warnungen und Fehler) unter `/opt/docker/systemdocu/logs/backend.log`, rotierend, max. 10 MB × 5 Dateien.

```bash
tail -f /opt/docker/systemdocu/logs/backend.log
```
