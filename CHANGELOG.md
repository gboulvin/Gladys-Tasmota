# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First release of the Tasmota external integration for Gladys Assistant 5.1 or
  later, built on the official JavaScript template and the integration SDK 0.15.
- MQTT support: your own broker, or an embedded Mosquitto broker started by the
  integration (sub-container), with both `%prefix%/%topic%/` and
  `%topic%/%prefix%/` FullTopic layouts.
- HTTP support: a list of addresses and ranges in the configuration, an
  "Add an HTTP device" action, an IP range scan (1024 addresses at most), web
  password support, polling at a configurable interval.
- Automatic discovery from the LWT, `Status 0` and the Tasmota native discovery
  (`tasmota/discovery/<MAC>/config`); devices identified by their MAC address,
  so a new name, topic, IP or protocol keeps the same Gladys device.
- Relays, lights (on/off, brightness, RGB color, color temperature, effects and
  their speed), fans (`FanSpeed`) and shutters (state and position).
- Energy metering (power, apparent and reactive power, voltage, current, energy
  today / yesterday / total index), multi-channel meters included.
- Sensors: temperature, humidity, pressure, illuminance, CO2, VOC, PM2.5, PM10,
  distance, UV index, soil moisture, analog inputs, counters, switch inputs,
  chip temperature, Wi-Fi signal and uptime. A sensor plugged in later is added
  to its device.
- Scene triggers: button pressed, switch input changed, RF code received, IR
  code received, device online / offline.
- Scene actions: send a Tasmota command (with its answer as output), turn a
  relay on for a while, make a light blink, restart a device.
- Dashboard widgets: devices overview, device card, energy card.
- Configuration actions: test the connection, embedded broker settings, add an
  HTTP device, scan an IP range, identify a light, send a command, restart a
  device, move a device to MQTT.
- "Local" transport badge on every device, degraded when the broker is down and
  the commands fall back to HTTP, unreachable when the device is offline.
- English, French, German and Spanish texts and documentation.
- `SECURITY.md`, `CLAUDE.md`, CI on Node 22 and 24, multi-arch Docker image
  (amd64, arm64), Release workflow and GitHub Releases.

[Unreleased]: https://github.com/gboulvin/Gladys-Tasmota/commits/main
