# Gladys Tasmota

External integration of [Gladys Assistant](https://gladysassistant.com) for
[Tasmota](https://tasmota.github.io/) devices — **100 % local**, over MQTT or HTTP.

Built on the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js) and the
[integration SDK](https://github.com/GladysAssistant/integration-sdk-js); it ports the Tasmota
service of the Gladys core and goes further.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## Features

| Area            | What is supported                                                                   |
| --------------- | ----------------------------------------------------------------------------------- |
| Transports      | Your MQTT broker, an **embedded Mosquitto broker** (sub-container), or HTTP only    |
| Discovery       | LWT, `Status 0`, Tasmota native discovery, HTTP address list, IP range scan         |
| Identity        | MAC address: renaming, new topic / IP or HTTP → MQTT keep the same Gladys device    |
| Relays & lights | `POWERn`, brightness, RGB color, color temperature, effects and speed               |
| Fans & shutters | `FanSpeed` (off / low / medium / high), shutter open / close / stop and position    |
| Energy          | Power, apparent / reactive power, voltage, current, today / yesterday / total index |
| Sensors         | Temperature, humidity, pressure, lux, CO2, VOC, PM2.5/PM10, distance, UV, soil…     |
| Scene triggers  | Button pressed, switch changed, RF code, IR code, device online / offline           |
| Scene actions   | Send any command (answer as output), pulse a relay, blink a light, restart          |
| Dashboard       | Devices overview, device card, energy card (live tiles and power chart)             |
| Transport badge | "Local", degraded when commands fall back to HTTP, unreachable when offline         |
| Languages       | English, French, German, Spanish                                                    |

Requires **Gladys 5.1.0** or later.

## Project structure

```
index.js                     SDK wiring (no protocol logic)
src/manager.js               device registry, MQTT/HTTP routing, discovery, events
src/tasmota/                 pure parsers: features, events, Status 0
src/transports/              MQTT client and HTTP API
src/broker.js                embedded Mosquitto broker
src/actions.js               Configuration screen actions
src/scenes.js                scene actions
src/widgets.js               dashboard widgets
src/config.js, src/i18n.js   configuration defaults, multi-language texts
docs/                        user documentation (en, fr, de, es)
test/                        unit tests (node --test, no network)
```

## Development

```bash
npm install
npm test
npm run lint
npm run format:check

GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="tasmota" \
DATA_DIR=./data LOG_LEVEL=debug \
npm start
```

Validate the manifest against the store rules:

```bash
npx github:GladysAssistant/integration-store .
```

## Release

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), then
**Actions → Release → Run workflow** (`patch`, `minor` or `major`): the workflow bumps the
version everywhere, tags, builds the `linux/amd64` + `linux/arm64` image on `ghcr.io` and
publishes the GitHub Release.

See [`CLAUDE.md`](CLAUDE.md) for the project rules and [`SECURITY.md`](SECURITY.md) to report a
vulnerability.

## License

Apache-2.0
