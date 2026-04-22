# systemdocu

Server-CMDB mit Graphansicht. Dokumentiert Server, Services und Abhängigkeiten.

## Was ist das

Web-App zur Dokumentation von Servern, Diensten und deren Beziehungen. Vis-network-Graph im Browser. Keine externe Auth nötig.

## Voraussetzungen

- Docker + docker-compose
- `/opt/docker/systemdocu/postgres/` muss existieren

```bash
mkdir -p /opt/docker/systemdocu/postgres
```

## Starten

```bash
cp .env.example .env
# .env anpassen
docker compose up -d
```

Aufruf: `http://<server-ip>/`

## Zabbix Import

Skript läuft standalone, schreibt direkt per API in die Datenbank.

```bash
cd backend
pip install -r requirements.txt
ZABBIX_URL=https://zabbix.internal \
ZABBIX_USER=Admin \
ZABBIX_PASSWORD=secret \
SYSTEMDOCU_API_URL=http://localhost:8000/api/import/zabbix \
python zabbix_import.py
```

Oder als Cronjob im Backend-Container:

```bash
docker compose exec backend python zabbix_import.py
```

## Backup

```bash
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql
```

Restore:

```bash
cat backup.sql | docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
```

## Env-Variablen

| Variable | Beschreibung |
|---|---|
| `POSTGRES_USER` | DB-Benutzer |
| `POSTGRES_PASSWORD` | DB-Passwort |
| `POSTGRES_DB` | DB-Name |
| `ZABBIX_URL` | Zabbix API URL |
| `ZABBIX_USER` | Zabbix Benutzer |
| `ZABBIX_PASSWORD` | Zabbix Passwort |
