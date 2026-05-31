# MPPT Solar Card
The MPPT Solar Card gives you a clean, at-a-glance view of your solar charge controller's data.

This card is for [Lovelace](https://www.home-assistant.io/lovelace) on [Home Assistant](https://www.home-assistant.io/).

[![GitHub Release][releases-shield]][releases]

[![License][license-shield]](LICENSE)
[![hacs_badge](https://img.shields.io/badge/HACS-Default-orange.svg?style=for-the-badge)](https://github.com/custom-components/hacs)

## Preview

<img width="1673" height="767" alt="solar-mppt-dark-mode" src="https://github.com/user-attachments/assets/1a087dcc-bacb-47d2-943e-30ad80e5dbe3" />
<img width="1675" height="766" alt="solar-mppt-light-mode" src="https://github.com/user-attachments/assets/7d3cd62b-3d23-4e72-b27e-2f3a659d8397" />


## Requirements
- This card uses [Sun integration](https://www.home-assistant.io/integrations/sun/) so it needs to be enabled

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

1. Download `ha-mppt-solar-card.js` from the [latest release][releases].
2. Copy it to `<config>/www/ha-mppt-solar-card.js`.
3. Add a resource entry in your dashboard settings:

```yaml
resources:
  - url: /local/ha-mppt-solar-card.js
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
chart_mode: auto
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

### Chart options

| Name           | Type   | Required     | Description                                              | Default  |
| -------------- | ------ | ------------ | -------------------------------------------------------- | -------- |
| `show_chart`   | bool   | **Optional** | Show or hide the power history sparkline                 | `true`   |
| `chart_height` | number | **Optional** | Height of the chart area in pixels                       | `64`     |
| `chart_mode`   | string | **Optional** | Chart time-window mode. `auto` or `rolling` (see below)  | `auto`   |
| `chart_hours`  | number | **Optional** | Window size in hours. Only used when `chart_mode: rolling` | `24`   |

#### `chart_mode: auto` (default — Auto-daylight)

The chart fetches data from midnight yesterday through the current moment and overlays yesterday's curve in gray behind today's curve in amber. The X axis is automatically cropped to the **active solar window** — the time between the first and last moment either day had measurable output (> 1 W). This ensures the full card width is used for the hours that actually matter, with night-time gaps excluded.

- **At sunrise:** today's curve begins growing from the left edge; yesterday's full curve is already visible behind it for comparison.
- **During the day:** both curves fill the card width; yesterday's peak and ramp-up pattern are immediately comparable to today's progress.
- **After sunset:** the axis is cropped to the production window of whichever day ended later.
- **Around midnight (no production yet today):** yesterday's full curve is shown alone so the chart is never blank.

#### `chart_mode: rolling`

Shows a fixed rolling window ending at the current moment (length set by `chart_hours`, default 24 h). The previous equivalent window (24–48 h ago) is overlaid in gray for comparison. Use this mode if you prefer a consistent, time-locked view rather than a daylight-cropped one.

```yaml
# Rolling 12-hour window example
chart_mode: rolling
chart_hours: 12
```

---

## Troubleshooting

**Card not appearing after install**
Clear your browser cache or do a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

**Sensors show `—` instead of a value**
Check that the entity ID in your YAML exactly matches the entity ID in Home Assistant (Settings → Devices & Services → Entities). Entity IDs are case-sensitive.

**Visual editor not opening**
Open your browser's developer console (`F12`) and look for JavaScript errors. Make sure the `ha-mppt-solar-card.js` resource is registered and the browser cache has been cleared after installation.

**Card not updating when sensor values change**
Confirm the sensor entities are updating in Home Assistant (check their state in Developer Tools → States). If states update but the card does not, try removing and re-adding the card.

**General Lovelace plugin troubleshooting**
See the [thomasloven wiki][troubleshooting].

---

[releases-shield]: https://img.shields.io/github/v/release/Chalkin/ha-mppt-solar-card?style=for-the-badge
[releases]: https://github.com/Chalkin/ha-mppt-solar-card/releases
[license-shield]: https://img.shields.io/github/license/Chalkin/ha-mppt-solar-card?style=for-the-badge
[troubleshooting]: https://github.com/thomasloven/hass-config/wiki/Lovelace-Plugins
