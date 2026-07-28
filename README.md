# Family Gate

Limity czasu TV (Netflix, YouTube, …) oparte o AdGuard Home Query Log, panel Angular oraz encje MQTT do Home Assistant.

Domyślny adres po EasyPanel: `http://home.blackpage.pl:3036`  
AdGuard: `http://home.blackpage.pl:3035`

## Co robi

1. Co ~20 s czyta query log AdGuard dla IP TV.
2. Mapuje domeny na usługi (`youtube`, `netflix`, …) i nalicza czas sesji.
3. Po wyczerpaniu limitu ustawia `blocked_services` na kliencie w AdGuard.
4. O północy (`Europe/Warsaw`) archiwizuje dzień w SQLite i resetuje liczniki.
5. Publikuje MQTT Discovery dla Home Assistant (pozostały czas, switch blokady, limit).

## EasyPanel / Docker

1. Skopiuj `.env.example` → `.env` i uzupełnij:
   - `ADGUARD_USER` / `ADGUARD_PASSWORD`
   - `PARENT_PASSWORD` (panel WWW)
   - opcjonalnie `MQTT_URL`, `MQTT_USER`, `MQTT_PASSWORD`
2. Volume na dane: `/app/data` (SQLite).
3. Port: `3036`.
4. Build z Dockerfile w root repo.

Przykład lokalnie:

```bash
cp .env.example .env
docker compose up --build
```

Panel: `http://localhost:3036` — hasło z `PARENT_PASSWORD`.

## Zmienne środowiskowe

| Zmienna | Opis |
|---|---|
| `PORT` | Domyślnie `3036` |
| `DATA_DIR` | Katalog SQLite (`./data`) |
| `TIMEZONE` | `Europe/Warsaw` |
| `PARENT_PASSWORD` | Basic Auth panelu |
| `ADGUARD_URL` | np. `http://home.blackpage.pl:3035` |
| `ADGUARD_USER` / `ADGUARD_PASSWORD` | Basic Auth AdGuard |
| `POLL_INTERVAL_SEC` | Interwał workera (20) |
| `IDLE_TIMEOUT_SEC` | Koniec sesji bez DNS (180) |
| `MQTT_URL` | np. `mqtt://homeassistant.local:1883` (puste = wyłączone) |
| `MQTT_USER` / `MQTT_PASSWORD` | Broker MQTT |
| `MQTT_DISCOVERY_PREFIX` | `homeassistant` |
| `MQTT_BASE_TOPIC` | `family_gate` |

## Home Assistant

Wymagany broker MQTT z włączonym discovery.

Po starcie Family Gate pojawią się urządzenia `Family Gate Tv Igor` itd. z encjami:

- `sensor.*_remaining` / `*_used` (minuty)
- `binary_sensor.*_blocked`
- `switch.*` — OFF = wymuszona blokada, ON = pozwól (w ramach limitu)
- `number.*_limit` — dzienny limit w minutach

Przykładowa karta:

```yaml
type: entities
title: TV Igor
entities:
  - entity: sensor.family_gate_tv_igor_youtube_remaining
  - entity: switch.family_gate_tv_igor_youtube
  - entity: number.family_gate_tv_igor_youtube_limit
```

## Development

```bash
npm install
cp .env.example .env
npm run build -w @family-gate/shared
npm run dev:api          # :3036
npm run dev:web          # ng serve + proxy /api → :3036
```

## Seed

Przy pierwszym starcie tworzone są:

- klienci: **Tv Igor** (`192.168.100.41`, AdGuard `Tv igor`), **TV Salon** (`192.168.100.43`)
- limity 60 min na YouTube i Netflix dla obu

Nazwa w AdGuard (`adguard_name`) musi dokładnie zgadzać się z klientem w AdGuard.

## Ograniczenia

- Liczenie oparte o DNS — przybliżenie, nie dokładny czas odtwarzania.
- Już otwarty stream może chwilę działać po blokadzie (cache DNS / połączenia).
- TV powinny mieć stałe IP (DHCP reservation) albo identyfikację MAC w AdGuard.
