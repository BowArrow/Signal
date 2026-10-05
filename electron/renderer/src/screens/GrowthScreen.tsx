import { useCallback, useEffect, useState } from 'react';
import type {
  ExperimentResult,
  GrowthAction,
  GrowthDashboard,
  GrowthExperimentView,
  GrowthGoal,
  GrowthSettings,
} from '../../../../src/shared/growth.js';
import '../styles/growth.css';
import { GrowthActivity } from '../components/GrowthActivity.js';

type Props = { onToast: (message: string, kind?: 'ok' | 'warn') => void };
type Tab = 'bullseye' | 'experiments' | 'agents' | 'settings';

export function GrowthScreen({ onToast }: Props): React.JSX.Element {
  const [data, setData] = useState<GrowthDashboard | null>(null);
  const [productId, setProductId] = useState('');
  const [tab, setTab] = useState<Tab>('bullseye');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  useEffect(() => {
    if (selectedChannel)
      document
        .querySelector('.growth-detail')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedChannel]);
  const refresh = useCallback(async () => {
    try {
      setData(await window.signal.growth());
      setLoadError('');
    } catch (err) {
      setLoadError(String(err));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  const act = async (action: GrowthAction): Promise<void> => {
    setBusy(true);
    try {
      setData(await window.signal.growthAction(action));
      setError('');
      onToast(action.type === 'research' ? 'Research queued. Results appear one channel at a time.' : 'Saved');
    } catch (err) {
      const message = String(err).replace(/^Error: Error invoking remote method '[^']+': Error: /, '');
      setError(message);
      onToast(message, 'warn');
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <div className="page">
        <h1 className="page-title">Growth lab</h1>
        <p role="status">{loadError || 'Loading your growth workspace…'}</p>
      </div>
    );
  const product =
    data.products.find((p) => p.id === productId) ?? data.products[0];
  if (!product)
    return (
      <div className="page">
        <h1 className="page-title">Growth lab</h1>
        <p>Add a product in signal.config.ts to begin.</p>
      </div>
    );
  const researched = product.channels.filter((c) => c.idea).length;
  const shortlist = product.channels.filter((c) => c.ring !== 'outer');
  const core = product.channels.find((c) => c.ring === 'inner');
  const active = product.tasks.filter((t) =>
    ['queued', 'running'].includes(t.status),
  );
  const selected = product.channels.find((c) => c.id === selectedChannel);
  const shortlistFull = selected?.ring === 'outer' && shortlist.length >= 3;
  const selectedTest = product.experiments.find((e) => e.channelId === selected?.id && e.status !== 'completed');
  const latestMeasured = product.experiments
    .filter((e) => e.channelId === selected?.id && e.status === 'completed')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const currency = (cents: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: product.currency,
    }).format(cents / 100);
  return (
    <div className="page growth-page">
      <div className="growth-heading">
        <div>
          <p className="growth-eyebrow">TRACTION / BULLSEYE</p>
          <h1 className="page-title">Find your path to growth.</h1>
          <p className="page-lede">
            Explore broadly. Test cheaply. Focus on what earns customers.
          </p>
        </div>
        <label className="growth-product">
          Product
          <select
            aria-label="Growth product"
            value={product.id}
            onChange={(e) => {
              setProductId(e.target.value);
              setSelectedChannel('');
            }}
          >
            {data.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="growth-goal">
        <i className="ph ph-flag" aria-hidden="true" />
        <div>
          <strong>{product.goal.description}</strong>
          <p>
            {product.goal.targetCustomers} customers ·{' '}
            {currency(product.goal.experimentBudgetCents)} test budget ·{' '}
            {product.goal.testDays} days per test
          </p>
        </div>
        <button className="btn" onClick={() => setTab('settings')}>
          Edit goal
        </button>
      </div>
      <div className="growth-tabs" role="tablist" aria-label="Growth views">
        {(['bullseye', 'experiments', 'agents', 'settings'] as const).map(
          (key) => (
            <button
              role="tab"
              aria-selected={tab === key}
              key={key}
              onClick={() => setTab(key)}
            >
              {key === 'bullseye'
                ? 'Bullseye board'
                : key === 'experiments'
                  ? `Experiments (${product.experiments.length})`
                  : key === 'agents'
                    ? `Agents${active.length ? ` (${active.length})` : ''}`
                    : 'Goals & runtime'}
            </button>
          ),
        )}
      </div>
      {(error || loadError) && (
        <p className="growth-error selectable" role="alert">
          {error || loadError}
        </p>
      )}
      <GrowthActivity data={data} product={product} busy={busy} act={act} onDetails={() => setTab('agents')} />
      {tab === 'bullseye' && (
        <>
          <section className="growth-overview">
            <div
              className="growth-target"
              aria-label={`${researched} channels researched; ${shortlist.length} shortlisted; core channel ${core?.name ?? 'not yet proven'}`}
            >
              <div className="growth-ring-middle">
                <div className="growth-ring-inner">
                  <i className="ph ph-target" />
                  <strong>
                    {core ? core.name : 'Your next\ngrowth engine'}
                  </strong>
                  <span>
                    {core ? 'Measured promise' : 'Waiting for evidence'}
                  </span>
                </div>
              </div>
              <span className="growth-ring-label">19 POSSIBILITIES</span>
            </div>
            <div className="growth-steps">
              <div>
                <span>01</span>
                <section>
                  <h3>
                    Consider every channel <small>{researched}/19</small>
                  </h3>
                  <p>
                    Local research agents turn your product positioning and
                    discovered signals into testable ideas.
                  </p>
                </section>
              </div>
              <div>
                <span>02</span>
                <section>
                  <h3>
                    Run small tests <small>{shortlist.length}/3</small>
                  </h3>
                  <p>
                    Choose up to three channels. Each gets a campaign draft,
                    budget, timebox, and success thresholds.
                  </p>
                </section>
              </div>
              <div>
                <span>03</span>
                <section>
                  <h3>Focus with evidence</h3>
                  <p>
                    Measure acquisition cost, audience fit, and customer volume
                    before choosing your core channel.
                  </p>
                </section>
              </div>
              <button
                className="btn btn-primary"
                disabled={
                  busy ||
                  active.some((t) => t.kind === 'research')
                }
                onClick={() => {
                  void act({ type: 'research', productId: product.id, refresh: researched === 19 });
                  setTab('agents');
                }}
              >
                <i className="ph ph-sparkle" />{' '}
                {active.some((t) => t.kind === 'research')
                  ? 'Research in progress'
                  : researched === 19
                  ? 'Refresh all 19 channels'
                  : researched
                  ? 'Research remaining channels'
                  : 'Research all 19 channels'}
              </button>
            </div>
          </section>
          <div className="growth-section-title">
            <h2>The outer ring</h2>
            <span>
              AI estimates are hypotheses. Results come from your tests.
            </span>
          </div>
          <div className="growth-channel-grid">
            {product.channels.map((c, index) => (
              <button
                key={c.id}
                className={`growth-channel ${selectedChannel === c.id ? 'selected' : ''}`}
                onClick={() => setSelectedChannel(c.id)}
                aria-pressed={selectedChannel === c.id}
              >
                <div>
                  <span className="growth-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={`growth-pill ring-${c.ring}`}>
                    {c.ring === 'inner'
                      ? 'Core channel'
                      : c.ring === 'middle'
                        ? 'Shortlisted'
                        : c.idea
                          ? 'Researched'
                          : 'Unexplored'}
                  </span>
                </div>
                <h3>{c.name}</h3>
                <p>{c.idea?.hypothesis ?? c.hint}</p>
                {c.idea && (
                  <small>
                    Est. {currency(c.idea.estimatedCostCents)} ·{' '}
                    {c.idea.estimatedHours} hours
                  </small>
                )}
              </button>
            ))}
          </div>
          {selected && (
            <section className="card growth-detail">
              <div className="growth-section-title">
                <h2>{selected.name}</h2>
                <button className="btn" onClick={() => setSelectedChannel('')}>
                  Close
                </button>
              </div>
              {selected.idea ? (
                <>
                  <h3>{selected.idea.hypothesis}</h3>
                  <p>
                    <strong>Audience:</strong> {selected.idea.audience}
                  </p>
                  <p>
                    <strong>Test:</strong> {selected.idea.test}
                  </p>
                  <p>
                    <strong>Success signal:</strong>{' '}
                    {selected.idea.successSignal}
                  </p>
                  <p>
                    <strong>Why:</strong> {selected.idea.rationale}
                  </p>
                  <p>
                    Estimated reachable customers:{' '}
                    {selected.idea.potentialCustomers}. Evidence references:{' '}
                    {selected.idea.evidenceIds.length || 'none yet'}.
                  </p>
                  {selected.evidence.length > 0 && (
                    <ul>
                      {selected.evidence.map((source) => (
                        <li key={source.id}>
                          <button
                            className="btn"
                            onClick={() =>
                              void window.signal
                                .openExternal(source.url)
                                .catch((e) => onToast(String(e), 'warn'))
                            }
                          >
                            {source.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {shortlistFull && (
                    <section className="growth-shortlist-help" aria-label="Shortlist is full">
                      <h3>All 3 shortlist slots are occupied</h3>
                      <p>Bullseye keeps you focused on three channels at a time. Remove one below to make room for {selected.name}. Its drafts and experiment history stay saved.</p>
                      {shortlist.map((channel) => {
                        const running = product.experiments.some((e) => e.channelId === channel.id && e.status === 'running');
                        return <div className="growth-shortlist-slot" key={channel.id}>
                          <span>{channel.name}{running ? ' — record the running test’s results before removing' : ''}</span>
                          <button className="btn" disabled={busy || running} onClick={() => void act({ type: 'remove', channelId: channel.id })}>Remove {channel.name}</button>
                        </div>;
                      })}
                    </section>
                  )}
                  <div className="growth-actions">
                    <button
                      className="btn btn-primary"
                      disabled={busy || shortlistFull || (selected.ring !== 'outer' && Boolean(selectedTest))}
                      onClick={() =>
                        void act({ type: 'shortlist', channelId: selected.id })
                      }
                    >
                      {selectedTest && selected.ring !== 'outer' ? 'Test already prepared' : selected.ring === 'outer'
                        ? 'Shortlist & prepare campaign'
                        : 'Prepare next test'}
                    </button>
                    {selected.ring !== 'outer' && (
                      <button
                        className="btn"
                        disabled={busy || selectedTest?.status === 'running'}
                        onClick={() =>
                          void act({ type: 'remove', channelId: selected.id })
                        }
                      >
                        Return to outer ring
                      </button>
                    )}
                    <button
                      className="btn"
                      disabled={busy || shortlistFull || latestMeasured?.evaluation.verdict !== 'promising'}
                      onClick={() =>
                        void act({ type: 'focus', channelId: selected.id })
                      }
                    >
                      Set as core channel
                    </button>
                  </div>
                  {selectedTest && <button className="btn" onClick={() => setTab('experiments')}>View prepared experiments</button>}
                  {latestMeasured?.evaluation.verdict !== 'promising' && <p className="growth-muted">A core channel needs a completed test that meets your customer and acquisition cost goals.</p>}
                </>
              ) : (
                <p>
                  Run channel research to generate a product-specific
                  experiment.
                </p>
              )}
            </section>
          )}
        </>
      )}
      {tab === 'experiments' && (
        <>
          <div className="growth-section-title">
            <h2>Small bets, real learning.</h2>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                void act({ type: 'analysis', productId: product.id });
                setTab('agents');
              }}
            >
              Analyze results
            </button>
          </div>
          {!product.experiments.length && (
            <div className="card growth-empty">
              <i className="ph ph-flask" />
              <h3>Your first experiment starts on the board.</h3>
              <p>
                Research the channels, open an idea, then shortlist it to
                prepare a test and campaign draft.
              </p>
              <button className="btn" onClick={() => setTab('bullseye')}>
                Explore channels
              </button>
            </div>
          )}
          {product.experiments.map((exp) => (
            <ExperimentCard
              key={exp.id}
              exp={exp}
              busy={busy}
              act={act}
              currency={currency}
            />
          ))}
        </>
      )}
      {tab === 'agents' && (
        <>
          <div className="growth-agent-grid">
            {[
              [
                'Research',
                'Product-specific hypotheses across all 19 channels.',
              ],
              [
                'Campaign writer',
                'Articles, pitches, ads, emails and launch materials.',
              ],
              [
                'Opportunity agent',
                'Fetch rules, score signals, and draft useful replies.',
              ],
              [
                'Growth analyst',
                'Compare real measurements and identify the next test.',
              ],
            ].map(([title, body]) => (
              <div className="card" key={title}>
                <i className="ph ph-cpu growth-agent-icon" />
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
          <div className="growth-section-title">
            <h2>Agent activity</h2>
            <div className="growth-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void act({ type: 'opportunities', productId: product.id })
                }
              >
                Process opportunity step
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  void act({ type: 'analysis', productId: product.id })
                }
              >
                Write growth memo
              </button>
            </div>
          </div>
          <p className="growth-muted">
            One local task runs at a time. Scheduled cycles:{' '}
            {data.settings.enabled
              ? `every ${data.settings.intervalMinutes} minutes while Signal is open`
              : 'off; manually queued work still runs'}
            . Campaigns are drafts for review.
          </p>
          {!product.tasks.length && (
            <div className="card growth-empty">
              <h3>Ready when you are.</h3>
              <p>
                Check your provider in Settings, then start channel
                research.
              </p>
            </div>
          )}
          {product.tasks.map((task) => (
            <article className="card growth-task" key={task.id}>
              <div className="growth-section-title">
                <h3>
                  {task.kind} <span className="growth-pill">{task.status}</span>
                </h3>
                <small>{new Date(task.createdAt).toLocaleString()}</small>
              </div>
              <p className="growth-muted">
                {product.channels.find((c) => c.id === task.targetId)?.name ??
                  product.experiments.find((e) => e.id === task.targetId)
                    ?.channelName ??
                  product.name}
                {task.model ? ` · ${task.model}` : ''}
              </p>
              {task.error && (
                <p className="growth-error selectable">{task.error}</p>
              )}
              {task.output && (
                <details open={task.kind !== 'research'}>
                  <summary>
                    {typeof task.output['title'] === 'string'
                      ? task.output['title']
                      : 'View output'}
                  </summary>
                  <pre className="growth-output selectable">
                    {typeof task.output['body'] === 'string'
                      ? task.output['body'] +
                        '\n\nExecution checklist\n' +
                        (Array.isArray(task.output['checklist'])
                          ? task.output['checklist'].join('\n')
                          : '')
                      : JSON.stringify(task.output, null, 2)}
                  </pre>
                  <button
                    className="btn"
                    onClick={() => {
                      const output = task.output;
                      void window.signal
                        .copyToClipboard(
                          typeof output?.['body'] === 'string'
                            ? output['body']
                            : JSON.stringify(output, null, 2),
                        )
                        .then(() => onToast('Copied'))
                        .catch((e) => onToast(String(e), 'warn'));
                    }}
                  >
                    Copy output
                  </button>
                </details>
              )}
              {['queued', 'running'].includes(task.status) && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void act({ type: 'cancel', taskId: task.id })}
                >
                  Cancel task
                </button>
              )}
              {['failed', 'cancelled'].includes(task.status) && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void act({ type: 'retry', taskId: task.id })}
                >
                  Retry task
                </button>
              )}
            </article>
          ))}
        </>
      )}
      {tab === 'settings' && (
        <div className="growth-settings">
          <GoalForm
            key={product.id}
            goal={product.goal}
            currency={product.currency}
            busy={busy}
            save={(value) =>
              act({ type: 'goal', productId: product.id, value })
            }
          />
          <RuntimeForm
            settings={data.settings}
            models={models}
            busy={busy}
            save={(value) => act({ type: 'settings', value })}
            check={async () => {
              setRuntime('Checking…');
              try {
                const result = await window.signal.growthRuntime();
                setRuntime(
                  `${result.ok ? 'Ready' : 'Unavailable'}: ${result.detail}`,
                );
                setModels(result.models ?? []);
              } catch (e) {
                setRuntime(String(e));
              }
            }}
            runtime={runtime}
          />
        </div>
      )}
      <p className="growth-footnote">
        Method adapted from Traction by Gabriel Weinberg and Justin Mares,
        Bullseye chapter (supplied excerpt, pp. 19–26). Revenue measurements are
        user-recorded; UTM links identify experiments in your analytics.
      </p>
    </div>
  );
}

function GoalForm({
  goal,
  currency,
  busy,
  save,
}: {
  goal: GrowthGoal;
  currency: string;
  busy: boolean;
  save: (goal: GrowthGoal) => Promise<void>;
}) {
  const [value, setValue] = useState(goal);
  return (
    <form
      className="card growth-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
    >
      <h2>Your traction goal</h2>
      <p>
        Set affordable limits before testing. These defaults are editable
        assumptions.
      </p>
      <label>
        Goal
        <input
          required
          value={value.description}
          onChange={(e) => setValue({ ...value, description: e.target.value })}
        />
      </label>
      {(
        [
          ['targetCustomers', 'Target paying customers'],
          ['experimentBudgetCents', `Budget per experiment (${currency})`],
          ['maxCacCents', `Maximum acquisition cost (${currency})`],
          ['testDays', 'Test duration (days, maximum 30)'],
          ['minVisitors', 'Minimum measured visitors'],
          ['minCustomers', 'Minimum paying customers'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            required
            min={key.includes('Cents') ? 0 : 1}
            step={key.includes('Cents') ? 0.01 : 1}
            max={key === 'testDays' ? 30 : 1000000000}
            value={key.includes('Cents') ? value[key] / 100 : value[key]}
            onChange={(e) =>
              setValue({
                ...value,
                [key]: key.includes('Cents')
                  ? Math.round(Number(e.target.value) * 100)
                  : Number(e.target.value),
              })
            }
          />
        </label>
      ))}
      <p className="growth-muted">
        Existing experiments keep their original thresholds so success criteria
        cannot change after a test starts.
      </p>
      <button className="btn btn-primary" disabled={busy}>
        Save goal
      </button>
    </form>
  );
}
function RuntimeForm({
  settings,
  models,
  busy,
  save,
  check,
  runtime,
}: {
  settings: GrowthSettings;
  models: string[];
  busy: boolean;
  save: (value: GrowthSettings) => Promise<void>;
  check: () => Promise<void>;
  runtime: string;
}) {
  const [value, setValue] = useState(settings);
  return (
    <form
      className="card growth-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
    >
      <h2>Local AI runtime</h2>
      <p>
        Use a running Ollama, LM Studio, or llama.cpp server on this computer.
        Agents use this connection when Local is selected in Settings. Select GPT and configure its API key in Settings.
      </p>
      <label>
        Local API base URL
        <input
          type="url"
          required
          value={value.baseUrl}
          onChange={(e) => setValue({ ...value, baseUrl: e.target.value })}
        />
      </label>
      <label>
        Research, writing & analysis model
        <input
          required
          list="growth-models"
          value={value.model}
          onChange={(e) => setValue({ ...value, model: e.target.value })}
        />
        <datalist id="growth-models">
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </label>
      <label>
        Opportunity scoring & reply model
        <input
          required
          list="growth-models"
          value={value.pipelineModel}
          onChange={(e) =>
            setValue({ ...value, pipelineModel: e.target.value })
          }
        />
      </label>
      <label>
        Cycle interval (minutes)
        <input
          type="number"
          min={15}
          max={10080}
          required
          value={value.intervalMinutes}
          onChange={(e) =>
            setValue({ ...value, intervalMinutes: Number(e.target.value) })
          }
        />
      </label>
      <label className="growth-checkbox">
        <input
          type="checkbox"
          checked={value.autoPlan}
          onChange={(e) => setValue({ ...value, autoPlan: e.target.checked })}
        />
        Automatically shortlist affordable ideas and focus after measured
        results
      </label>
      <label className="growth-checkbox">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
        />
        Schedule research, campaign preparation and analysis
      </label>
      <p className="growth-muted">
        Turning schedules off prevents new cycles. Cancel queued tasks in Local
        agents to stop work already requested. Start your local server with{' '}
        <code>ollama serve</code>.
      </p>
      <div className="growth-actions">
        <button className="btn btn-primary" disabled={busy}>
          Save runtime
        </button>
        <button className="btn" type="button" onClick={() => void check()}>
          Check saved runtime
        </button>
      </div>
      <p role="status">{runtime}</p>
    </form>
  );
}
function ExperimentCard({
  exp,
  act,
  busy,
  currency,
}: {
  exp: GrowthExperimentView;
  act: (action: GrowthAction) => Promise<void>;
  busy: boolean;
  currency: (cents: number) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<ExperimentResult>(
    exp.result ?? {
      visitors: 0,
      leads: 0,
      customers: 0,
      spendCents: 0,
      revenueCents: 0,
      audienceFit: 'unknown',
      source: '',
      notes: '',
    },
  );
  return (
    <article className="card growth-experiment">
      <div className="growth-section-title">
        <h3>{exp.channelName}</h3>
        <span className="growth-pill">{exp.status}</span>
      </div>
      <h3>{exp.title}</h3>
      <p>
        Budget {currency(exp.goal.experimentBudgetCents)} · Maximum CAC{' '}
        {currency(exp.goal.maxCacCents)} · {exp.goal.testDays} days
        {exp.endsAt
          ? ` · Ends ${new Date(exp.endsAt).toLocaleDateString()}`
          : ''}
      </p>
      <label>
        Campaign URL
        <input
          readOnly
          className="selectable"
          value={exp.trackedUrl}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <p className={`growth-verdict verdict-${exp.evaluation.verdict}`}>
        {exp.evaluation.verdict}: {exp.evaluation.reason}
      </p>
      {exp.result && (
        <p>
          {exp.result.visitors} visitors · {exp.result.leads} leads ·{' '}
          {exp.result.customers} paying customers ·{' '}
          {currency(exp.result.revenueCents)} revenue · CAC{' '}
          {exp.evaluation.cacCents === null
            ? 'unknown'
            : currency(exp.evaluation.cacCents)}
        </p>
      )}
      <div className="growth-actions">
        {exp.status === 'planned' && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void act({ type: 'start', experimentId: exp.id })}
          >
            Start test clock
          </button>
        )}
        <button
          className="btn"
          disabled={busy}
          onClick={() => void act({ type: 'campaign', experimentId: exp.id })}
        >
          Draft campaign
        </button>
        {exp.status !== 'planned' && (
          <button className="btn" onClick={() => setEditing(!editing)}>
            {exp.result ? 'Correct results' : 'Record results'}
          </button>
        )}
        {exp.evaluation.verdict === 'promising' && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void act({ type: 'focus', channelId: exp.channelId })
            }
          >
            Focus this channel
          </button>
        )}
      </div>
      {editing && (
        <form
          className="growth-form growth-results"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ type: 'results', experimentId: exp.id, value: result });
          }}
        >
          <p>
            Enter cumulative totals for this test. Saving replaces the previous
            totals and completes the test; it does not add them twice.
          </p>
          <div className="growth-result-grid">
            {(
              [
                'visitors',
                'leads',
                'customers',
                'spendCents',
                'revenueCents',
              ] as const
            ).map((key) => (
              <label key={key}>
                {key === 'customers'
                  ? 'Paying customers'
                  : key === 'spendCents'
                    ? 'Actual spend'
                    : key === 'revenueCents'
                      ? 'Revenue'
                      : key}
                <input
                  type="number"
                  min={0}
                  step={key.includes('Cents') ? 0.01 : 1}
                  required
                  value={
                    key.includes('Cents') ? result[key] / 100 : result[key]
                  }
                  onChange={(e) =>
                    setResult({
                      ...result,
                      [key]: key.includes('Cents')
                        ? Math.round(Number(e.target.value) * 100)
                        : Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
            <label>
              Audience fit
              <select
                value={result.audienceFit}
                onChange={(e) =>
                  setResult({
                    ...result,
                    audienceFit: e.target
                      .value as ExperimentResult['audienceFit'],
                  })
                }
              >
                <option value="unknown">Unknown</option>
                <option value="poor">Poor</option>
                <option value="good">Good</option>
              </select>
            </label>
          </div>
          <label>
            Measurement source (report URL or reference)
            <input
              required
              value={result.source}
              onChange={(e) => setResult({ ...result, source: e.target.value })}
            />
          </label>
          <label>
            What did you learn?
            <textarea
              value={result.notes}
              onChange={(e) => setResult({ ...result, notes: e.target.value })}
            />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            Save measured results
          </button>
        </form>
      )}
    </article>
  );
}
