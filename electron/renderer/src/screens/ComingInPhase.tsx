import { NAV, type ScreenKey } from '../components/Sidebar.js';

const WHAT: Record<string, { title: string; body: string }> = {
  queue: {
    title: 'Review queue',
    body: 'The queue arrives in Phase 3, once there are scored opportunities and drafts to review. Every draft will land here and nothing will publish without an explicit approve action — that is a property of the publish layer, not of this screen.',
  },
  scoring: {
    title: 'Scoring',
    body: 'Phase 2. Four axes stored separately so the weights stay tunable, with contribution carrying the most weight. Below threshold there is no LLM call and no queue entry.',
  },
  guardrails: {
    title: 'Guardrails',
    body: 'Phase 2 seeds the community rules registry with researched values, per community, each carrying the sidebar link it came from and an unverified flag until you confirm it. The rate limiter and cooldown land in Phase 3 at the publish layer.',
  },
  attribution: {
    title: 'Publications & attribution',
    body: 'Phase 4. Tracked redirects and the Stripe webhook live on the signal-edge Firebase project, because a laptop that sleeps cannot receive either. Last-touch, 30-day window, and a conversion with no recorded click stays unattributed rather than guessed.',
  },
  digest: {
    title: 'Weekly digest',
    body: 'Phase 4. Which communities and framings converted, which drafts you rejected and why, and the top performers fed back into the voice file.',
  },
};

export function ComingInPhase({ screen }: { readonly screen: ScreenKey }): React.JSX.Element {
  const entry = NAV.find((n) => n.key === screen);
  const copy = WHAT[screen];

  return (
    <div className="page">
      <p
        style={{
          margin: '0 0 6px',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-accent)',
        }}
      >
        Phase {entry?.arrivesIn ?? '?'}
      </p>
      <h1 className="page-title">{copy?.title ?? entry?.label}</h1>
      <p className="page-lede">{copy?.body}</p>

      <div className="card" style={{ maxWidth: '68ch' }}>
        <p className="card-kicker">Where Phase 1 stopped</p>
        <p className="card-body">
          Ingestion, deduplication, the durable job queue and the schema are done and tested. No
          scoring, no LLM call, no draft, and no outbound message of any kind.
        </p>
      </div>
    </div>
  );
}
