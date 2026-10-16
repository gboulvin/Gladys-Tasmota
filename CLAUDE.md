# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

The **Tasmota** external integration of Gladys Assistant: a Node.js service
(Node 22+, ESM, no build step) running in its own sandboxed Docker container,
talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the Tasmota devices over MQTT (`mqtt` package) and HTTP (global
`fetch`). It started from the official JavaScript template and ports, then
extends, the Tasmota service of the Gladys core.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/manager.test.js          # one file
node --test --test-name-pattern "shutter" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs `format:check`, `lint` and `test` on Node 22 and 24 and builds the
Docker image: run the three commands before pushing.

## Architecture

```
index.js                     SDK wiring only: handlers registered before connect()
src/manager.js               TasmotaManager: device records (by MAC), MQTT/HTTP routing,
                             discovery, states, events, availability, /data persistence
src/tasmota/features.js      PURE: Tasmota STATE/SENSOR JSON -> Gladys features, and
                             Gladys value -> Tasmota command (buildCommand)
src/tasmota/events.js        PURE: Button / Switch / RfReceived / IrReceived -> scene events
src/tasmota/status.js        PURE: Status 0 -> device identity (MAC, name, topic, IP...)
src/transports/mqtt.js       MQTT client wrapper + FullTopic layouts + discovery topics
src/transports/http.js       HTTP API (/cm?cmnd=), address ranges, bounded concurrency
src/broker.js                embedded Mosquitto sub-container (config, $7$ hashes, start)
src/actions.js               manifest `actions` (Configuration screen buttons)
src/scenes.js                manifest `scene_actions`
src/widgets.js               manifest `widgets` (overview, device, energy)
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  t(en, fr, de, es): every user-facing message
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (en + fr mandatory)
test/                        node --test, against the SDK fake Gladys and a fake MQTT transport
```

## Rules

- **External ids are forever.** A device is `externalIds('tasmota', <mac>)`,
  the MAC lowercase without separators; a feature key (`power1`, `dimmer`,
  `energy-power-2`, `am2301-temperature`, `shutter1-position`…) never depends
  on anything but the Tasmota JSON key. Never rename one: Gladys keys the
  history, scenes and dashboards on them. Same for every manifest key.
- **Keep the parsers pure.** `src/tasmota/*` does no I/O, so every Tasmota
  payload shape gets a unit test with a real-life sample (`test/helpers.js`).
- **State vs event.** A value is a feature published with
  `publishChangedStates`; something that happened (button, RF/IR code,
  online/offline) is a scene event, one per transition. Never fire an event
  because of an action received from Gladys.
- **Safety.** `identify` only blinks lights (a relay may drive a heater); a
  pulse is bounded (`MAX_PULSE_SECONDS`) and runs on the device itself.
- **The container rootfs is read-only.** Write only under `/data`
  (`DATA_DIR` in the tests). Never log tokens or passwords (`redactUrl`).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Four languages.** Every manifest text and every message is
  `{ en, fr, de, es }` (`t()` in code); `docs/*.md` stay in sync. The tests
  fail on a missing language.
- **Manifest ↔ code.** Actions, scene actions, scene triggers, widgets and
  config defaults are cross-checked by `test/manifest.test.js`: change both
  sides together.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
