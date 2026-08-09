export type ScreenKey =
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
  { key: 'queue', label: 'Review queue', icon: 'ph-tray', arrivesIn: 3 },
  { key: 'opps', label: 'Opportunities', icon: 'ph-radar' },
  { key: 'scoring', label: 'Scoring', icon: 'ph-sliders-horizontal', arrivesIn: 2 },
  { key: 'guardrails', label: 'Guardrails', icon: 'ph-shield-check', arrivesIn: 2 },
  { key: 'attribution', label: 'Attribution', icon: 'ph-link', arrivesIn: 4 },
  { key: 'digest', label: 'Weekly digest', icon: 'ph-newspaper', arrivesIn: 4 },
  { key: 'system', label: 'System', icon: 'ph-terminal-window' },
];

interface SidebarProps {
  readonly screen: ScreenKey;
  readonly onNavigate: (screen: ScreenKey) => void;
  readonly badges: Partial<Record<ScreenKey, string>>;
  readonly publishedToday: string;
}

export function Sidebar({
  screen,
  onNavigate,
  badges,
  publishedToday,
}: SidebarProps): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <i className="ph ph-broadcast" aria-hidden="true" />
        </span>
        <span className="brand-name sidebar-label">Signal</span>
        <span className="brand-version sidebar-label">v0.1</span>
      </div>

      <nav className="nav-list" aria-label="Sections">
        {NAV.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="nav-item"
            aria-current={screen === entry.key ? 'page' : undefined}
            title={entry.arrivesIn ? `${entry.label} — arrives in Phase ${entry.arrivesIn}` : entry.label}
            onClick={() => onNavigate(entry.key)}
          >
            <i className={`ph ${entry.icon}`} aria-hidden="true" />
            <span className="sidebar-label">{entry.label}</span>
            <span className="nav-badge sidebar-label">
              {entry.arrivesIn ? `P${entry.arrivesIn}` : (badges[entry.key] ?? '')}
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <p className="sidebar-kicker">Publish layer</p>
        <div className="sidebar-status">
          <span className="dot dot-live" />
          <span>human approval required</span>
        </div>
        <div className="sidebar-status">
          <span className="dot" />
          <span>{publishedToday}</span>
        </div>
      </div>
    </aside>
  );
}
