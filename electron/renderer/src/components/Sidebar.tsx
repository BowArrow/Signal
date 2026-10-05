import { useEffect, useState } from 'react';

export type ScreenKey =
  | 'sales'
  | 'revenue'
  | 'analytics'
  | 'operations'
  | 'connections'
  | 'creative'
  | 'studio'
  | 'settings'
  | 'marketing'
  | 'engineering'
  | 'growth'
  | 'queue'
  | 'opps'
  | 'scoring'
  | 'guardrails'
  | 'attribution'
  | 'digest'
  | 'system';

interface NavEntry {
  readonly key: ScreenKey;
  readonly label: string;
  readonly icon: string;
  /** The phase that turns this screen on. Undefined means it works now. */
  readonly arrivesIn?: number;
}

export const NAV: readonly NavEntry[] = [
  { key: 'sales', label: 'Sales', icon: 'ph-envelope' },
  { key: 'revenue', label: 'Revenue', icon: 'ph-chart-line-up' },
  { key: 'analytics', label: 'Analytics', icon: 'ph-chart-bar' },
  { key: 'operations', label: 'Operations', icon: 'ph-play-circle' },
  { key: 'connections', label: 'Connections', icon: 'ph-plugs-connected' },
  { key: 'studio', label: 'Growth workspace', icon: 'ph-rocket-launch' },
  { key: 'creative', label: 'Creative studio', icon: 'ph-palette' },
  { key: 'marketing', label: 'Marketing agent', icon: 'ph-chats-circle' },
  { key: 'engineering', label: 'Engineering requests', icon: 'ph-wrench' },
  { key: 'growth', label: 'Growth lab', icon: 'ph-target' },
  { key: 'queue', label: 'Review queue', icon: 'ph-tray' },
  { key: 'opps', label: 'Opportunities', icon: 'ph-radar' },
  { key: 'scoring', label: 'Scoring', icon: 'ph-sliders-horizontal' },
  { key: 'guardrails', label: 'Guardrails', icon: 'ph-shield-check' },
  { key: 'attribution', label: 'Experiment results', icon: 'ph-chart-line-up' },
  { key: 'digest', label: 'Growth digest', icon: 'ph-newspaper' },
  { key: 'system', label: 'System', icon: 'ph-terminal-window' },
  { key: 'settings', label: 'Settings', icon: 'ph-gear' },
];

interface SidebarProps {
  readonly version: string | null;
  readonly screen: ScreenKey;
  readonly onNavigate: (screen: ScreenKey) => void;
  readonly badges: Partial<Record<ScreenKey, string>>;
}

const GROUPS: { label: string; keys: ScreenKey[] }[] = [
  { label: 'Work', keys: ['operations', 'sales', 'queue'] },
  { label: 'Create', keys: ['studio', 'creative', 'marketing'] },
  { label: 'Measure', keys: ['analytics', 'revenue'] },
  { label: 'Setup', keys: ['connections', 'settings'] },
];
const advanced = NAV.filter(entry => !GROUPS.some(group => group.keys.includes(entry.key)));

export function Sidebar({
  version,
  screen,
  onNavigate,
  badges,
}: SidebarProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(() => advanced.some(entry => entry.key === screen));
  useEffect(() => { if (advanced.some(entry => entry.key === screen)) setExpanded(true); }, [screen]);
  const item = (entry: NavEntry) => <button key={entry.key} type="button" className="nav-item"
    aria-label={entry.label} aria-current={screen === entry.key ? 'page' : undefined}
    title={entry.label} onClick={() => onNavigate(entry.key)}>
    <i className={`ph ${entry.icon}`} aria-hidden="true" />
    <span className="sidebar-label">{entry.label}</span>
    {badges[entry.key] && <span className="nav-badge sidebar-label">{badges[entry.key]}</span>}
  </button>;
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <img src="./signal.svg" width="22" height="22" alt="" />
        </span>
        <span className="brand-name sidebar-label">Signal</span>
        {version && <span className="brand-version sidebar-label">v{version}</span>}
      </div>

      <nav className="nav-list" aria-label="Sections">
        {GROUPS.map(group => <section className="nav-group" key={group.label} aria-label={group.label}>
          <h2 className="nav-group-label sidebar-label">{group.label}</h2>
          {group.keys.map(key => item(NAV.find(entry => entry.key === key)!))}
        </section>)}
        <div className="nav-group">
          <button type="button" className="nav-item nav-tools-toggle" aria-label="Advanced tools"
            title="Advanced tools" aria-expanded={expanded} aria-controls="advanced-navigation"
            onClick={() => setExpanded(!expanded)}>
            <i className="ph ph-sliders-horizontal" aria-hidden="true" />
            <span className="sidebar-label">Advanced tools</span>
            <i className={`ph ${expanded ? 'ph-caret-up' : 'ph-caret-down'} sidebar-label`} aria-hidden="true" />
          </button>
          <div id="advanced-navigation" hidden={!expanded}>{advanced.map(item)}</div>
        </div>
      </nav>

      <div className="sidebar-footer">
        <p>Marketing, with a record.</p>
        <span>Activity in Operations. Outcomes in Revenue.</span>
      </div>
    </aside>
  );
}
