# systemdocu

Server-CMDB mit Graphansicht. Dokumentiert Server, Services, Instanzen und Abhängigkeiten.

## Voraussetzungen

- Docker + docker-compose
- Verzeichnisse auf dem Host anlegen:

```bash
mkdir -p /opt/docker/systemdocu/postgres /opt/docker/systemdocu/logs
```

## Starten

```bash
cp .env.example .env
# .env anpassen (siehe unten)
docker compose up -d --build
```

Aufruf: `http://<server-ip>:9191`

## .env

```env
POSTGRES_USER=systemdocu
POSTGRES_PASSWORD=geheim
POSTGRES_DB=systemdocu

ZABBIX_URL=https://monitoring.example.com/
ZABBIX_API_TOKEN=<api-token>
ZABBIX_VERIFY_SSL=false
```

`ZABBIX_VERIFY_SSL=false` deaktiviert die Zertifikatsprüfung (für selbstsignierte Zertifikate).

## Env-Variablen

| Variable | Beschreibung |
|---|---|
| `POSTGRES_USER` | DB-Benutzer |
| `POSTGRES_PASSWORD` | DB-Passwort |
| `POSTGRES_DB` | DB-Name |
| `ZABBIX_URL` | Zabbix API URL |
| `ZABBIX_API_TOKEN` | Zabbix API-Token (empfohlen) |
| `ZABBIX_USER` | Zabbix Benutzer (alternativ zu Token) |
| `ZABBIX_PASSWORD` | Zabbix Passwort (alternativ zu Token) |
| `ZABBIX_VERIFY_SSL` | `false` = SSL-Prüfung deaktivieren (Standard: false) |

## Features

- **Graph**: Server als Knoten, Relationen als Kanten; Reinzoomen zeigt Instanz-Knoten mit Typ-Icon
- **Server**: anlegen, bearbeiten, löschen; Tags, Umgebungen, Relationen
- **Services & Instanzen**: je Server mehrere Services, je Service mehrere Instanzen mit Anwendungs-Zuordnung
- **Instanz-Relationen**: direkte Verbindungen zwischen Instanzen verschiedener Server
- **Filter**: nach Tag, Umgebung oder Anwendung
- **Zabbix-Scan**: Host aus `Server/*`-Gruppe scannen → LLD-Erkennung von DBs, Containern, VMs, Freigaben → importieren
- **Export**: JSON-Export aller Daten

## Zabbix API-Token erstellen

Zabbix → Administration → API-Token → Token erstellen, Benutzer mit Lesezugriff zuweisen.

## Backup

```bash
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql
```

Restore:

```bash
cat backup.sql | docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
```
