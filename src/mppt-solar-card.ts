import { LitElement, html, svg, TemplateResult, css, PropertyValues, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';

interface HistoryPoint {
  t: number;
  v: number;
}

import type { MpptSolarCardConfig } from './types';

import { CARD_VERSION } from './const';
import { localize } from './localize/localize';

// Styled console banner so your card is easy to spot in the browser console.
// Stays visible in production — useful for version-mismatch debugging in HA.
console.info(
  `%c  MPPT-SOLAR-CARD \n%c  ${localize('common.version')} ${CARD_VERSION}    `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

// Registering with window.customCards makes your card appear in the Lovelace
// "Add Card" UI picker with a name and description. This array is shared by all
// custom cards on the page, so we guard with `|| []` before pushing.
interface WindowWithCustomCards extends Window {
  customCards: Array<{ type: string; name: string; description: string }>;
}

(window as unknown as WindowWithCustomCards).customCards =
  (window as unknown as WindowWithCustomCards).customCards || [];
(window as unknown as WindowWithCustomCards).customCards.push({
  type: 'mppt-solar-card',
  name: 'MPPT Solar Card',
  description: 'Visualizes the live state of an MPPT solar charge controller.',
});

@customElement('mppt-solar-card')
export class MpptSolarCard extends LitElement {
  // getConfigElement is called by HA when the user opens the visual editor.
  // The dynamic import keeps the editor code out of the main bundle — it is only
  // loaded when actually needed, improving initial load time.
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    try {
      await import('./editor');
      const element = document.createElement('mppt-solar-card-editor');
      return element;
    } catch (error) {
      console.error('Failed to load editor:', error);
      throw error;
    }
  }

  // getStubConfig returns a minimal valid config used when the user adds the
  // card from the picker without going through the visual editor first.
  public static getStubConfig(): Record<string, unknown> {
    return {
      name: 'MPPT Solar',
      entity: '',
      entity_peak_power_today: '',
      entity_voltage: '',
      entity_current: '',
      entity_energy_today: '',
      entity_energy_yesterday: '',
      show_chart: true,
      chart_mode: 'auto',
      chart_hours: 24,
      chart_height: 64,
    };
  }

  // `hass` is set by HA on every state change anywhere in the system.
  // `attribute: false` means it is set as a JS property, not an HTML attribute
  // (the object is too large to serialize as an attribute).
  // Lit will schedule a re-render whenever this property reference changes.
  @property({ attribute: false }) public hass!: HomeAssistant;

  // `config` is private internal state set via setConfig().
  // Using @state (instead of @property) means it won't be exposed as a public
  // property but will still trigger re-renders when it changes.
  @state() private config!: MpptSolarCardConfig;

  // Power history time series for the sparkline (unix seconds + watts).
  @state() private _history: HistoryPoint[] = [];

  // Power history for the previous period (24–48 h ago), used for the overlay line.
  @state() private _historyPrev: HistoryPoint[] = [];

  // Unix-second timestamp of the hovered position, or null when not hovering.
  // Using a timestamp (rather than a series index) lets the hover work even
  // when today's series is empty and only the previous-day curve is visible.
  @state() private _hoverT: number | null = null;

  // Guards against concurrent/repeated history fetches.
  private _historyLoading = false;

  // setConfig is called by HA whenever the YAML config changes (including from
  // the visual editor). It runs before the element is connected to the DOM, so
  // you can't access `this.hass` here — it may not be set yet.
  //
  // Good practices:
  //   • Throw an Error for truly invalid configs (HA will surface it as an error card).
  //   • Spread defaults first, then the user config on top — this lets users omit
  //     optional fields without your render() code needing null-checks everywhere.
  //   • Never call async operations here; use connectedCallback or firstUpdated instead.
  //
  // https://lit.dev/docs/components/properties/#accessors-custom
  public setConfig(config: MpptSolarCardConfig): void {
    if (!config) {
      throw new Error(localize('common.invalid_configuration'));
    }
    this.config = {
      name: 'MPPT Solar',
      ...config,
    };
  }

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config) return false;
    if (changedProps.has('config')) return true;
    if (changedProps.has('_history') || changedProps.has('_historyPrev') || changedProps.has('_hoverT')) return true;
    if (!changedProps.has('hass')) return false;
    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
    if (!oldHass) return true;
    const sunEntity = this.config.entity_sun ?? 'sun.sun';
    const ids = [
      this.config.entity,
      this.config.entity_peak_power_today,
      this.config.entity_voltage,
      this.config.entity_current,
      this.config.entity_energy_today,
      this.config.entity_energy_yesterday,
      sunEntity,
    ].filter(Boolean) as string[];
    return ids.some((id) => oldHass.states[id] !== this.hass.states[id]);
  }

  /** Returns true when the sun is below the horizon (night mode). */
  private get _isNight(): boolean {
    if (!this.hass) return false;
    const sunEntity = this.config?.entity_sun ?? 'sun.sun';
    const sunState = this.hass.states[sunEntity];
    return sunState?.state === 'below_horizon';
  }

  protected updated(changedProps: PropertyValues): void {
    if (!this.hass || !this.config) return;

    const oldConfig = changedProps.get('config') as MpptSolarCardConfig | undefined;
    const configChanged =
      changedProps.has('config') &&
      (!oldConfig ||
        oldConfig.entity !== this.config.entity ||
        (oldConfig.chart_hours ?? 24) !== (this.config.chart_hours ?? 24) ||
        (oldConfig.chart_mode ?? 'auto') !== (this.config.chart_mode ?? 'auto') ||
        (oldConfig.show_chart !== false) !== (this.config.show_chart !== false));

    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
    const firstHass = changedProps.has('hass') && !oldHass;

    if ((configChanged || firstHass) && this.config.show_chart !== false) {
      this._fetchHistory();
    }

    if (changedProps.has('hass') && oldHass && this.config.entity) {
      const id = this.config.entity;
      const newSt = this.hass.states[id];
      const oldSt = oldHass.states[id];
      if (newSt && newSt !== oldSt) {
        const v = parseFloat(newSt.state);
        const t = new Date(newSt.last_updated).getTime() / 1000;
        if (!isNaN(v) && isFinite(t)) {
          const last = this._history[this._history.length - 1];
          if (!last || last.t < t) {
            this._history = [...this._history, { t, v }];
          }
        }
      }
    }
  }

  private async _fetchHistory(): Promise<void> {
    if (this._historyLoading) return;
    if (!this.hass || !this.config.entity) {
      this._history = [];
      this._historyPrev = [];
      return;
    }
    this._historyLoading = true;
    const entityId = this.config.entity;
    const mode = this.config.chart_mode ?? 'auto';
    try {
      if (mode === 'auto') {
        await this._fetchHistoryAuto(entityId);
      } else {
        await this._fetchHistoryRolling(entityId);
      }
    } catch (err) {
      console.warn('mppt-solar-card: history fetch failed', err);
      this._history = [];
      this._historyPrev = [];
    } finally {
      this._historyLoading = false;
    }
  }

  /** Auto-daylight: fetch yesterday-midnight → now, split by calendar day. */
  private async _fetchHistoryAuto(entityId: string): Promise<void> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 3600 * 1000);
    const result = await this.hass.callWS<Record<string, Array<{ s: string; lu: number }>>>({
      type: 'history/history_during_period',
      start_time: startOfYesterday.toISOString(),
      end_time: now.toISOString(),
      entity_ids: [entityId],
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    const series = result?.[entityId] ?? [];
    const startOfTodaySec = startOfToday.getTime() / 1000;
    const today: HistoryPoint[] = [];
    const prev: HistoryPoint[] = [];
    for (const s of series) {
      const v = parseFloat(s.s);
      if (!isFinite(s.lu) || isNaN(v)) continue;
      if (s.lu >= startOfTodaySec) {
        today.push({ t: s.lu, v });
      } else {
        // Shift yesterday's points forward by 24 h so they overlay today on the X axis.
        prev.push({ t: s.lu + 24 * 3600, v });
      }
    }
    this._history = today;
    this._historyPrev = prev;
  }

  /** Rolling window: fetch the last `chart_hours` hours plus the equivalent prior window. */
  private async _fetchHistoryRolling(entityId: string): Promise<void> {
    const hours = Math.max(1, this.config.chart_hours ?? 24);
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    const prevEnd = start;
    const prevStart = new Date(prevEnd.getTime() - hours * 3600 * 1000);
    const [result, resultPrev] = await Promise.all([
      this.hass.callWS<Record<string, Array<{ s: string; lu: number }>>>({
        type: 'history/history_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [entityId],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      }),
      this.hass.callWS<Record<string, Array<{ s: string; lu: number }>>>({
        type: 'history/history_during_period',
        start_time: prevStart.toISOString(),
        end_time: prevEnd.toISOString(),
        entity_ids: [entityId],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      }),
    ]);
    const shiftSec = hours * 3600;
    const series = result?.[entityId] ?? [];
    this._history = series.map((s) => ({ t: s.lu, v: parseFloat(s.s) })).filter((p) => isFinite(p.t) && !isNaN(p.v));
    const seriesPrev = resultPrev?.[entityId] ?? [];
    this._historyPrev = seriesPrev
      .map((s) => ({ t: s.lu + shiftSec, v: parseFloat(s.s) }))
      .filter((p) => isFinite(p.t) && !isNaN(p.v));
  }

  protected render(): TemplateResult | void {
    if (!this.hass) {
      return this._renderSkeleton();
    }

    return html`
      <ha-card tabindex="0">
        <div class="solar-card ${this._isNight ? 'night' : ''}">
          ${this._renderHeader()} ${this._renderHero()} ${this._renderChart()}
          <div class="divider"></div>
          ${this._renderStats()}
          <div class="divider"></div>
          ${this._renderEnergy()}
        </div>
      </ha-card>
    `;
  }

  /** Read state value from an entity, returns '—' when unavailable. */
  private _val(entityId?: string): string {
    if (!entityId || !this.hass) return '—';
    const s = this.hass.states[entityId];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') return '—';
    return s.state;
  }

  /** Format a numeric state to a fixed number of decimal places. */
  private _fmt(entityId?: string, decimals = 0): string {
    const raw = this._val(entityId);
    if (raw === '—') return raw;
    const n = parseFloat(raw);
    return isNaN(n) ? raw : n.toFixed(decimals);
  }

  private _renderHeader(): TemplateResult {
    const name = this.config.name ?? 'MPPT Solar';
    const icon = this._isNight ? 'mdi:weather-night' : 'mdi:weather-sunny';
    return html`
      <div class="header">
        <div class="header-left">
          <span class="header-dot"></span>
          <span class="header-title">${name}</span>
        </div>
        <ha-icon class="header-icon" icon=${icon}></ha-icon>
      </div>
    `;
  }

  private _renderHero(): TemplateResult {
    const power = this._fmt(this.config.entity, 0);
    const peak = this._fmt(this.config.entity_peak_power_today, 0);
    const subLine = this._isNight
      ? html`<div class="hero-peak">idle</div>`
      : html`<div class="hero-peak">peak ${peak} W today</div>`;
    return html`
      <div class="hero">
        <div class="hero-power">
          <span class="hero-value">${power}</span>
          <span class="hero-unit">W</span>
        </div>
        ${subLine}
      </div>
    `;
  }

  /**
   * Bucket-average `data` into at most `maxPts` evenly-spaced samples.
   * This reduces noise without losing the overall shape of the curve.
   */
  private _downsample(data: HistoryPoint[], maxPts = 150): HistoryPoint[] {
    if (data.length <= maxPts) return data;
    const tMin = data[0].t;
    const tMax = data[data.length - 1].t;
    const bucketWidth = (tMax - tMin) / maxPts;
    const buckets: number[][] = Array.from({ length: maxPts }, () => []);
    for (const p of data) {
      const idx = Math.min(Math.floor((p.t - tMin) / bucketWidth), maxPts - 1);
      buckets[idx].push(p.v);
    }
    const result: HistoryPoint[] = [];
    for (let i = 0; i < maxPts; i++) {
      if (buckets[i].length === 0) continue;
      const avg = buckets[i].reduce((a, b) => a + b, 0) / buckets[i].length;
      result.push({ t: tMin + (i + 0.5) * bucketWidth, v: avg });
    }
    return result;
  }

  // Downsampled data used by both _renderChart and _onChartMove.
  // X-axis bounds (unix seconds) of the rendered chart. Used so the hover
  // cursor maps correctly when the X axis is cropped (auto mode).
  private _chartTMin = 0;
  private _chartTMax = 0;

  private _renderChart(): TemplateResult {
    if (this.config.show_chart === false) return html``;

    const height = Math.max(24, this.config.chart_height ?? 64);
    const width = 300;

    const hasToday = this._history.length >= 2;
    const hasPrev = this._historyPrev.length >= 2;
    if (!hasToday && !hasPrev) {
      return html`<div class="chart chart--empty" style="height:${height}px">${localize('chart.empty')}</div>`;
    }

    // Downsample for smoothness; store today's data for the hover handler.
    const data = hasToday ? this._downsample(this._history, 150) : [];
    const dataPrev = hasPrev ? this._downsample(this._historyPrev, 150) : [];

    const NIGHT_THRESHOLD = 1; // watts — below this is treated as no-sun
    const mode = this.config.chart_mode ?? 'auto';

    // X-axis bounds.
    //  • auto:    crop to the union of active (>NIGHT_THRESHOLD) points across
    //             both series so the chart fills edge-to-edge without wasting
    //             width on dark night hours.
    //  • rolling: keep the full requested window (today's first → last sample).
    let tMin: number;
    let tMax: number;
    if (mode === 'auto') {
      const activeAll = [
        ...data.filter((d) => d.v > NIGHT_THRESHOLD),
        ...dataPrev.filter((d) => d.v > NIGHT_THRESHOLD),
      ];
      if (activeAll.length >= 2) {
        tMin = Math.min(...activeAll.map((p) => p.t));
        tMax = Math.max(...activeAll.map((p) => p.t));
      } else {
        const allPts = [...data, ...dataPrev];
        tMin = Math.min(...allPts.map((p) => p.t));
        tMax = Math.max(...allPts.map((p) => p.t));
      }
    } else {
      tMin = hasToday ? data[0].t : dataPrev[0].t;
      tMax = hasToday ? data[data.length - 1].t : dataPrev[dataPrev.length - 1].t;
    }
    const tRange = Math.max(tMax - tMin, 1);
    this._chartTMin = tMin;
    this._chartTMax = tMax;

    // Scale vMax across both series so the previous-day overlay shares the same Y axis.
    const vMax = Math.max(...data.map((d) => d.v), ...dataPrev.map((d) => d.v), 1);
    const padY = 2;

    const toPoint = (d: HistoryPoint): { x: number; y: number } => ({
      x: ((d.t - tMin) / tRange) * width,
      y: height - padY - (d.v / vMax) * (height - padY * 2),
    });

    const buildSegments = (pts_data: HistoryPoint[]): { x: number; y: number }[][] => {
      const segs: { x: number; y: number }[][] = [];
      let segPts: { x: number; y: number }[] = [];
      for (let i = 0; i < pts_data.length; i++) {
        if (pts_data[i].v > NIGHT_THRESHOLD) {
          segPts.push(toPoint(pts_data[i]));
        } else {
          if (segPts.length >= 2) segs.push(segPts);
          segPts = [];
        }
      }
      if (segPts.length >= 2) segs.push(segPts);
      return segs;
    };

    // Split into contiguous "active" (daytime) segments so the zero-power
    // baseline during night is never drawn.
    type Segment = { pts: { x: number; y: number }[]; startIdx: number };
    const segments: Segment[] = [];
    let segPts: { x: number; y: number }[] = [];
    let segStart = -1;
    for (let i = 0; i < data.length; i++) {
      if (data[i].v > NIGHT_THRESHOLD) {
        if (segStart === -1) segStart = i;
        segPts.push(toPoint(data[i]));
      } else {
        if (segPts.length >= 2) segments.push({ pts: segPts, startIdx: segStart });
        segPts = [];
        segStart = -1;
      }
    }
    if (segPts.length >= 2) segments.push({ pts: segPts, startIdx: segStart });

    // Build segments for the previous-day overlay.
    const segmentsPrev = buildSegments(dataPrev);

    // Binary-search helper: find the nearest point in `pts` to `tTarget`.
    // Returns null if `tTarget` is outside the series' time range (so we never
    // snap to an end-of-series sample when hovering well past it) or if the
    // nearest point is below the night threshold.
    const nearestActive = (pts: HistoryPoint[], tTarget: number): HistoryPoint | null => {
      if (pts.length === 0) return null;
      const tFirst = pts[0].t;
      const tLast = pts[pts.length - 1].t;
      // Small tolerance so the very edges still register a hover.
      const tol = Math.max((tLast - tFirst) / Math.max(pts.length - 1, 1), 1);
      if (tTarget < tFirst - tol || tTarget > tLast + tol) return null;
      let lo = 0;
      let hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].t < tTarget) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(pts[lo - 1].t - tTarget) < Math.abs(pts[lo].t - tTarget)) lo--;
      return pts[lo].v > NIGHT_THRESHOLD ? pts[lo] : null;
    };

    // Resolve hover data independently for today and yesterday so the tooltip
    // and dots work even when only one of the two series has data.
    const hoverT = this._hoverT;
    const hoverData = hoverT !== null ? nearestActive(data, hoverT) : null;
    const hoverPt = hoverData ? toPoint(hoverData) : null;
    const hoverDataPrev = hoverT !== null ? nearestActive(dataPrev, hoverT) : null;
    const hoverPtPrev = hoverDataPrev ? toPoint(hoverDataPrev) : null;

    const unit = this._unit(this.config.entity) || 'W';

    // Cursor line and tooltip follow the actual pointer position, not the
    // snapped data point — otherwise they jump to the end of today's line
    // when the pointer is past today's last sample.
    const hoverX = hoverT !== null ? ((hoverT - tMin) / tRange) * width : null;
    const hasHover = hoverX !== null && (hoverData !== null || hoverDataPrev !== null);

    return html`
      <div
        class="chart"
        style="height:${height}px"
        @pointermove=${this._onChartMove}
        @pointerleave=${this._onChartLeave}
        role="img"
        aria-label=${localize('chart.title')}
      >
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart-svg">
          ${segmentsPrev.map((pts) => {
            const linePath = this._smoothPath(pts);
            const first = pts[0];
            const last = pts[pts.length - 1];
            const areaPath = `${linePath} L ${last.x.toFixed(2)},${height} L ${first.x.toFixed(2)},${height} Z`;
            return svg`
              <path class="chart-area-prev" d=${areaPath}></path>
              <path class="chart-line-prev" d=${linePath}></path>
            `;
          })}
          ${segments.map(({ pts }) => {
            const linePath = this._smoothPath(pts);
            const first = pts[0];
            const last = pts[pts.length - 1];
            const areaPath = `${linePath} L ${last.x.toFixed(2)},${height} L ${first.x.toFixed(2)},${height} Z`;
            return svg`
              <path class="chart-area" d=${areaPath}></path>
              <path class="chart-line" d=${linePath}></path>
            `;
          })}
          ${hasHover ? svg`<line class="chart-cursor" x1=${hoverX} x2=${hoverX} y1="0" y2=${height}></line>` : ''}
          ${hoverPt ? svg`<circle class="chart-dot" cx=${hoverPt.x} cy=${hoverPt.y} r="3.5"></circle>` : ''}
          ${hoverPtPrev
            ? svg`<circle class="chart-dot-prev" cx=${hoverPtPrev.x} cy=${hoverPtPrev.y} r="3"></circle>`
            : ''}
        </svg>
        ${hasHover
          ? html`<div class="chart-tooltip" style="left:${(hoverX! / width) * 100}%">
              ${hoverData ? html`<div class="chart-tooltip-value">${Math.round(hoverData.v)} ${unit}</div>` : ''}
              ${hoverDataPrev
                ? html`<div class="chart-tooltip-value-prev">${Math.round(hoverDataPrev.v)} ${unit}</div>`
                : ''}
              <div class="chart-tooltip-time">${this._fmtTime((hoverData ?? hoverDataPrev!).t)}</div>
            </div>`
          : ''}
      </div>
    `;
  }

  /** Catmull-Rom → cubic Bézier smoothing for a tidy filled curve. */
  private _smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    return d;
  }

  private _onChartMove = (ev: PointerEvent): void => {
    const target = ev.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || this._chartTMax === this._chartTMin) return;
    const fx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    // Map the cursor's screen X to the chart's visible time range and store
    // the timestamp directly. The render method resolves the nearest point in
    // each series independently, so hover works even when today is empty.
    const tTarget = this._chartTMin + fx * (this._chartTMax - this._chartTMin);
    if (this._hoverT !== tTarget) this._hoverT = tTarget;
  };

  private _onChartLeave = (): void => {
    if (this._hoverT !== null) this._hoverT = null;
  };

  private _unit(entityId?: string): string | undefined {
    if (!entityId || !this.hass) return undefined;
    const s = this.hass.states[entityId];
    return s?.attributes?.unit_of_measurement as string | undefined;
  }

  private _fmtTime(t: number): string {
    const d = new Date(t * 1000);
    const lang = this.hass?.locale?.language;
    try {
      return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
  }

  private _renderStats(): TemplateResult {
    const voltage = this._fmt(this.config.entity_voltage, 1);
    const current = this._fmt(this.config.entity_current, 1);
    return html`
      <div class="stats-grid">
        <div class="stat-cell">
          <div class="stat-label">Voltage</div>
          <div class="stat-value">${voltage} <span class="stat-unit">V</span></div>
        </div>
        <div class="stat-cell">
          <div class="stat-label">Current</div>
          <div class="stat-value">${current} <span class="stat-unit">A</span></div>
        </div>
      </div>
    `;
  }

  private _renderEnergy(): TemplateResult {
    const today = this._fmt(this.config.entity_energy_today, 2);
    const yesterday = this._fmt(this.config.entity_energy_yesterday, 2);
    const todayClass = this._isNight ? 'energy-value secondary' : 'energy-value accent';
    return html`
      <div class="energy-grid">
        <div class="energy-row">
          <span class="energy-label">Today</span>
          <span class=${todayClass}>${today} kWh</span>
        </div>
        <div class="energy-row">
          <span class="energy-label secondary">Yesterday</span>
          <span class="energy-value secondary">${yesterday} kWh</span>
        </div>
      </div>
    `;
  }

  private _renderSkeleton(): TemplateResult {
    return html`
      <ha-card>
        <div class="solar-card skeleton-content">
          <div class="skeleton skeleton-header"></div>
          <div class="skeleton skeleton-hero"></div>
          <div class="skeleton skeleton-sub"></div>
          <div class="skeleton skeleton-chart"></div>
          <div class="divider"></div>
          <div class="skeleton skeleton-stats"></div>
          <div class="divider"></div>
          <div class="skeleton skeleton-energy"></div>
        </div>
      </ha-card>
    `;
  }


  static get styles(): CSSResultGroup {
    return css`
      /* ── Host / accent token ───────────────────────────── */
      :host {
        --solar-accent: #f0b429;
        --solar-accent-dim: rgba(240, 180, 41, 0.15);
      }

      /* ── Card wrapper ──────────────────────────────────── */
      .solar-card {
        padding: 12px 20px 15px;
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      /* ── Header ────────────────────────────────────────── */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .header-dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--solar-accent);
        flex-shrink: 0;
        box-shadow: 0 0 6px 2px rgba(240, 180, 41, 0.55);
      }
      .header-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--primary-text-color);
        letter-spacing: 0.01em;
      }
      .header-icon {
        --mdc-icon-size: 22px;
        color: var(--solar-accent);
        opacity: 0.85;
      }

      /* ── Hero power block ──────────────────────────────── */
      .hero {
        margin-bottom: 10px;
      }
      .hero-power {
        display: flex;
        align-items: baseline;
        gap: 4px;
        line-height: 1;
      }
      .hero-value {
        font-size: 54px;
        font-weight: 700;
        color: var(--solar-accent);
        letter-spacing: -2px;
        line-height: 1;
      }
      .hero-unit {
        font-size: 20px;
        font-weight: 500;
        color: var(--solar-accent);
        margin-bottom: 4px;
      }
      .hero-peak {
        margin-top: 4px;
        font-size: 16px;
        color: var(--secondary-text-color);
        font-weight: 400;
      }

      /* ── Divider ───────────────────────────────────────── */
      .divider {
        height: 1px;
        background: var(--divider-color);
        margin: 10px 0;
      }

      /* ── Chart / sparkline ─────────────────────────────── */
      .chart {
        position: relative;
        width: 100%;
        margin-top: 2px;
        touch-action: none;
      }
      .chart--empty {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        color: var(--secondary-text-color);
      }
      .chart-svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      .chart-area-prev {
        fill: rgba(128, 128, 128, 0.08);
        stroke: none;
      }
      .chart-line-prev {
        fill: none;
        stroke: var(--secondary-text-color, #9e9e9e);
        stroke-width: 1.5;
        stroke-linejoin: round;
        stroke-linecap: round;
        stroke-dasharray: 4 3;
        opacity: 0.5;
        vector-effect: non-scaling-stroke;
      }
      .chart-area {
        fill: var(--solar-accent-dim);
        stroke: none;
      }
      .chart-line {
        fill: none;
        stroke: var(--solar-accent);
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }
      .chart-cursor {
        stroke: var(--secondary-text-color);
        stroke-width: 1;
        stroke-dasharray: 2 3;
        opacity: 0.6;
        vector-effect: non-scaling-stroke;
      }
      .chart-dot {
        fill: var(--solar-accent);
        stroke: var(--card-background-color, var(--ha-card-background, #1c1c1e));
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
      }
      .chart-dot-prev {
        fill: var(--secondary-text-color);
        stroke: var(--card-background-color, var(--ha-card-background, #1c1c1e));
        stroke-width: 2;
        opacity: 0.7;
        vector-effect: non-scaling-stroke;
      }
      .chart-tooltip {
        position: absolute;
        top: 0;
        transform: translate(-50%, -100%);
        padding: 4px 8px;
        background: var(--card-background-color, var(--ha-card-background, #1c1c1e));
        border: 1px solid var(--divider-color);
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.2;
        color: var(--primary-text-color);
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      }
      .chart-tooltip-value {
        font-weight: 600;
        color: var(--solar-accent);
      }
      .chart-tooltip-value-prev {
        font-weight: 600;
        color: var(--secondary-text-color);
        opacity: 0.8;
      }
      .chart-tooltip-time {
        color: var(--secondary-text-color);
      }

      /* ── Voltage / Current stats grid ──────────────────── */
      .stats-grid {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }
      .stat-cell {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .stat-cell:last-child {
        align-items: flex-end;
        text-align: right;
      }
      .stat-label {
        font-size: 16px;
        color: var(--secondary-text-color);
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .stat-value {
        font-size: 22px;
        font-weight: 500;
        color: var(--primary-text-color);
        letter-spacing: -0.5px;
        line-height: 1.2;
      }
      .stat-unit {
        font-size: 13px;
        font-weight: 400;
        color: var(--secondary-text-color);
      }

      /* ── Energy rows ───────────────────────────────────── */
      .energy-grid {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .energy-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .energy-label {
        font-size: 16px;
        color: var(--primary-text-color);
        font-weight: 600;
      }
      .energy-label.secondary {
        color: var(--secondary-text-color);
      }
      .energy-value {
        font-size: 16px;
        font-weight: 600;
        color: var(--primary-text-color);
      }
      .energy-value.accent {
        color: var(--solar-accent);
      }
      .energy-value.secondary {
        color: var(--secondary-text-color);
        font-weight: 400;
      }

      /* ── Night mode ────────────────────────────────────── */
      .night .header-dot {
        background: var(--secondary-text-color);
        box-shadow: none;
      }
      .night .header-icon {
        color: var(--secondary-text-color);
        opacity: 0.7;
      }
      .night .hero-value,
      .night .hero-unit {
        color: var(--secondary-text-color);
      }

      /* ── Skeleton / loading UI ───────────────────────── */
      @keyframes skeleton-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.4;
        }
      }
      .skeleton {
        border-radius: 6px;
        background: var(--divider-color);
        animation: skeleton-pulse 1.4s ease-in-out infinite;
      }
      .skeleton-content {
        pointer-events: none;
        gap: 12px;
      }
      .skeleton-header {
        height: 20px;
        width: 55%;
      }
      .skeleton-hero {
        height: 64px;
        width: 45%;
        margin-top: 4px;
      }
      .skeleton-sub {
        height: 14px;
        width: 38%;
      }
      .skeleton-chart {
        height: 64px;
        margin-top: 4px;
      }
      .skeleton-stats {
        height: 48px;
      }
      .skeleton-energy {
        height: 44px;
      }
    `;
  }
}
