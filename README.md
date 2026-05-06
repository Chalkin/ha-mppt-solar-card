# MPPT Solar Card

A Home Assistant Lovelace custom card for visualising the live state of an MPPT solar charge controller.

[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE.md)
[![hacs_badge](https://img.shields.io/badge/HACS-Default-orange.svg?style=for-the-badge)](https://github.com/custom-components/hacs)

---

## Overview

The MPPT Solar Card gives you a clean, at-a-glance view of your solar charge controller's live telemetry directly on your Home Assistant dashboard. One card = one controller (read-only; no service calls are made).

**What the card displays:**

| Region      | Content                              |
| ----------- | ------------------------------------ |
| Header      | Card title and sun status icon       |
| Hero        | Current solar output in **W** (large, accented) |
| Sub-hero    | Peak wattage reached today           |
| Stats row   | Battery **Voltage** (V) and **Current** (A) |
| Energy row  | Energy harvested **Today** (kWh, accented) and **Yesterday** (kWh) |

---

## Installation

### HACS (recommended)

1. Open HACS in your Home Assistant instance.
2. Go to **Frontend** → **+ Explore & Download Repositories**.
3. Search for **MPPT Solar Card** and click **Download**.
4. Refresh your browser.

### Manual

1. Download `mppt-solar-card.js` from the [latest release][releases].
2. Copy it to `<config>/www/mppt-solar-card.js`.
3. Add a resource entry in your dashboard settings:

```yaml
resources:
  - url: /local/mppt-solar-card.js
    type: module
```

---

## Configuration

Point the card at your sensor entities and you are done. All entity bindings are optional — omit any you don't have, and the card will show `—` in that slot.

### Minimal example

```yaml
type: custom:mppt-solar-card
name: Solar Roof
entity_power: sensor.solar_power
entity_energy_today: sensor.solar_energy_today
```

### Full example

```yaml
type: custom:mppt-solar-card
name: Solar Dach
entity_power: sensor.solar_power
entity_peak_power_today: sensor.solar_peak_power_today
entity_voltage: sensor.solar_voltage
entity_current: sensor.solar_current
entity_energy_today: sensor.solar_energy_today
entity_energy_yesterday: sensor.solar_energy_yesterday
```

---

## Options

### General

| Name   | Type   | Required     | Description                        | Default        |
| ------ | ------ | ------------ | ---------------------------------- | -------------- |
| `type` | string | **Required** | Must be `custom:mppt-solar-card`   |                |
| `name` | string | **Optional** | Title shown in the card header     | `MPPT Solar`   |

### Entity bindings

Each field accepts a Home Assistant entity ID string. All bindings are optional.

| Name                      | Type   | Display region      | Unit | Description                                    |
| ------------------------- | ------ | ------------------- | ---- | ---------------------------------------------- |
| `entity_power`            | string | Hero (large value)  | W    | Current solar output power                     |
| `entity_peak_power_today` | string | Sub-hero            | W    | Peak power recorded today                      |
| `entity_voltage`          | string | Stats row           | V    | Battery / panel voltage (shown to 1 decimal)   |
| `entity_current`          | string | Stats row           | A    | Charge current (shown to 1 decimal)            |
| `entity_energy_today`     | string | Energy row (accent) | kWh  | Energy harvested today (shown to 2 decimals)   |
| `entity_energy_yesterday` | string | Energy row          | kWh  | Energy harvested yesterday (shown to 2 decimals) |

---

## Troubleshooting

**Card not appearing after install**
Clear your browser cache or do a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

**Sensors show `—` instead of a value**
Check that the entity ID in your YAML exactly matches the entity ID in Home Assistant (Settings → Devices & Services → Entities). Entity IDs are case-sensitive.

**Visual editor not opening**
Open your browser's developer console (`F12`) and look for JavaScript errors. Make sure the `mppt-solar-card.js` resource is registered and the browser cache has been cleared after installation.

**Card not updating when sensor values change**
Confirm the sensor entities are updating in Home Assistant (check their state in Developer Tools → States). If states update but the card does not, try removing and re-adding the card.

**General Lovelace plugin troubleshooting**
See the [thomasloven wiki][troubleshooting].

---

[releases]: https://github.com/Chalkin/ha-mppt-solar-card/releases
[troubleshooting]: https://github.com/thomasloven/hass-config/wiki/Lovelace-Plugins
