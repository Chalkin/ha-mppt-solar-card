import { LovelaceCardConfig, LovelaceCardEditor } from 'custom-card-helpers';

declare global {
  interface HTMLElementTagNameMap {
    'mppt-solar-card-editor': LovelaceCardEditor;
  }
}

export interface MpptSolarCardConfig extends LovelaceCardConfig {
  type: string;
  name?: string;
  icon?: string;
  entity?: string;
  // Entity bindings
  entity_peak_power_today?: string;
  entity_voltage?: string;
  entity_current?: string;
  entity_energy_today?: string;
  entity_energy_yesterday?: string;
  // Chart
  show_chart?: boolean;
  chart_mode?: 'auto' | 'rolling';
  chart_hours?: number;
  chart_height?: number;
  // Sun / night mode
  entity_sun?: string;
}
