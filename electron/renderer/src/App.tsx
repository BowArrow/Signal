import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OpportunityView, SystemStatus } from '../../../src/shared/ipc.js';
import { NAV, Sidebar, type ScreenKey } from './components/Sidebar.js';
import { Toast, type ToastState } from './components/Toast.js';
import { SystemScreen } from './screens/SystemScreen.js';
import { OpportunitiesScreen } from './screens/OpportunitiesScreen.js';
import { ComingInPhase } from './screens/ComingInPhase.js';

export function App(): React.JSX.Element {
  const [screen, setScreen] = useState<ScreenKey>('opps');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityView[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const say = useCallback((message: string, kind: ToastState['kind'] = 'ok') => {
    setToast({ message, kind });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextOpportunities] = await Promise.all([
        window.signal.status(),
        window.signal.opportunities(100),
      ]);
      setStatus(nextStatus);
      setOpportunities(nextOpportunities);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // The scheduler runs on a one-minute tick in the main process, so polling
    // for its results at roughly that cadence keeps the window honest without
    // needing a push channel yet.
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const ingestNow = useCallback(async () => {
    setIngesting(true);
    try {
      const summary = await window.signal.ingestNow();
      await refresh();
      const skipped = summary.sources.filter((s) => s.status === 'skipped').length;
      say(
        `${summary.inserted} new · ${summary.dropped} dropped` +
          (skipped ? ` · ${skipped} sources skipped for missing credentials` : ''),
        skipped ? 'warn' : 'ok',
      );
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), 'warn');
    } finally {
      setIngesting(false);
    }
  }, [refresh, say]);

  const toggleSource = useCallback(
    async (sourceId: string, enabled: boolean, name: string) => {
      await window.signal.toggleSource(sourceId, enabled);
      await refresh();
      say(`${name} polling ${enabled ? 'resumed' : 'paused'}`);
    },
    [refresh, say],
  );

  useEffect(() => window.signal.onMenuCommand((command) => {
    if (command === 'poll') void ingestNow();
  }), [ingestNow]);

  const badges = useMemo(
    () => ({
      opps: opportunities.length ? String(opportunities.length) : '',
      // Nothing reaches the review queue until Phase 2 scores and drafts.
      queue: '',
    }),
    [opportunities.length],
  );

  return (
    <div className={`shell platform-${window.signal.platform === 'darwin' ? 'mac' : 'pc'}`}>
      <Sidebar
        screen={screen}
        onNavigate={setScreen}
        badges={badges}
        publishedToday={
          status
            ? `reddit 0/${status.limits.maxRepliesPerPlatformPerDay} replies today`
            : 'loading…'
        }
      />

      <main className="main">
        <div className="titlebar">
          <span className="titlebar-crumb">
            Signal · {NAV.find((n) => n.key === screen)?.label ?? ''}
          </span>
        </div>

        <div className="main-scroll">
          {error ? (
            <div className="page">
              <h1 className="page-title">Signal could not read its own state</h1>
              <p className="page-lede selectable">{error}</p>
            </div>
          ) : screen === 'opps' ? (
            <OpportunitiesScreen
              opportunities={opportunities}
              ingesting={ingesting}
              onIngest={ingestNow}
              onOpen={(url) => void window.signal.openExternal(url)}
            />
          ) : screen === 'system' ? (
            <SystemScreen status={status} onToggleSource={toggleSource} />
          ) : (
            <ComingInPhase screen={screen} />
          )}
        </div>
      </main>

      <Toast state={toast} onDone={() => setToast(null)} />
    </div>
  );
}
