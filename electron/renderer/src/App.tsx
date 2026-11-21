import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OpportunityView, SystemStatus } from '../../../src/shared/ipc.js';
import { NAV, Sidebar, type ScreenKey } from './components/Sidebar.js';
import { Toast, type ToastState } from './components/Toast.js';
import { SystemScreen } from './screens/SystemScreen.js';
import { OpportunitiesScreen } from './screens/OpportunitiesScreen.js';
import { ScoringScreen } from './screens/ScoringScreen.js';
import { GuardrailsScreen } from './screens/GuardrailsScreen.js';
import { QueueScreen } from './screens/QueueScreen.js';
import { ComingInPhase } from './screens/ComingInPhase.js';
import { GrowthScreen } from './screens/GrowthScreen.js';
import { MarketingScreen } from './screens/MarketingScreen.js';
import { GrowthReportsScreen } from './screens/GrowthReportsScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { StudioScreen } from './screens/StudioScreen.js';
import { CreativeScreen } from './screens/CreativeScreen.js';
import { ConnectionsScreen } from './screens/ConnectionsScreen.js';
import { OperationsScreen } from './screens/OperationsScreen.js';
import { RevenueScreen } from './screens/RevenueScreen.js';
import { AnalyticsScreen } from './screens/AnalyticsScreen.js';
import { SalesScreen } from './screens/SalesScreen.js';
import { GuideScreen } from './screens/GuideScreen.js';
import { MarketingTeamScreen } from './screens/MarketingTeamScreen.js';
import type { GuideDestination } from '../../../src/shared/marketing-guide.js';

export function App(): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  // Always open on a useful next step. Remember the business, not a deep tool tab.
  const [screen, setScreen] = useState<ScreenKey>(() => {
    try { const saved = sessionStorage.getItem('signal.screen'); return NAV.some(n => n.key === saved) ? saved as ScreenKey : 'guide'; }
    catch { return 'guide'; }
  });
  const [guideProduct, setGuideProduct] = useState(() => { try { return localStorage.getItem('signal.guide-business') ?? ''; } catch { return ''; } });
  const [destination, setDestination] = useState<GuideDestination | null>(null);
  const navigate = (next: ScreenKey) => { setDestination(null); setScreen(next); };
  const selectGuideProduct = (id: string) => { setGuideProduct(id); try { localStorage.setItem('signal.guide-business', id); } catch { /* Storage is optional. */ } };

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    try {
      sessionStorage.setItem('signal.screen', screen);
    } catch {
      // A remembered tab is a convenience, not a requirement.
    }
  }, [screen]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityView[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const say = useCallback((message: string, kind: ToastState['kind'] = 'ok') => {
    setToast({ message, kind });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextOpportunities, nextQueue] = await Promise.all([
        window.signal.status(),
        window.signal.opportunities(100),
        window.signal.queue(),
      ]);
      setStatus(nextStatus);
      setOpportunities(nextOpportunities);
      setQueueCount(nextQueue.length);
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
      queue: queueCount > 0 ? String(queueCount) : '',
    }),
    [opportunities.length, queueCount],
  );

  return (
    <div className={`shell platform-${window.signal.platform === 'darwin' ? 'mac' : 'pc'}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Sidebar
        version={status?.version ?? null}
        screen={screen}
        onNavigate={navigate}
        badges={badges}
      />

      <main className="main">
        <div className="titlebar">
          <span className="titlebar-crumb">
            Signal · {NAV.find((n) => n.key === screen)?.label ?? ''}
          </span>
        </div>

        {/* The queue manages its own two scroll panes, so the outer one must
            not add a third. */}
        <div ref={contentRef} id="main-content" tabIndex={-1} className={screen === 'queue' ? 'main-fill' : 'main-scroll'}>
          {error ? (
            <div className="page">
              <h1 className="page-title">Signal could not read its own state</h1>
              <p className="page-lede selectable">{error}</p>
            </div>
          ) : screen === 'team' ? (
            <MarketingTeamScreen productId={guideProduct} onProduct={selectGuideProduct} onToast={say} onNavigate={(next, id) => { selectGuideProduct(id); setDestination(next); setScreen(next.screen); }} />
          ) : screen === 'guide' ? (
            <GuideScreen productId={guideProduct} onProduct={selectGuideProduct} onToast={say} onNavigate={(next, id) => { selectGuideProduct(id); setDestination(next); setScreen(next.screen); }} />
          ) : screen === 'sales' ? (
            <SalesScreen onToast={say} initialProductId={guideProduct} initialSection={destination?.screen === 'sales' ? destination.section : 'prospects'} />
          ) : screen === 'revenue' ? (
            <RevenueScreen onToast={say} initialProductId={guideProduct} />
          ) : screen === 'analytics' ? (
            <AnalyticsScreen onToast={say} initialProductId={guideProduct} />
          ) : screen === 'operations' ? (
            <OperationsScreen onToast={say} onNavigate={navigate} initialProductId={guideProduct} initialSection={destination?.screen === 'operations' ? destination.section : 'overview'} />
          ) : screen === 'connections' ? (
            <ConnectionsScreen onToast={say} initialProductId={guideProduct} />
          ) : screen === 'creative' ? (
            <CreativeScreen onToast={say} />
          ) : screen === 'studio' ? (
            <StudioScreen onToast={say} openOperations={() => setScreen('operations')} />
          ) : screen === 'settings' ? (
            <SettingsScreen onToast={say} />
          ) : screen === 'marketing' || screen === 'engineering' ? (
            <MarketingScreen onToast={say} initialProductId={guideProduct} initialTab={screen === 'engineering' ? 'engineering' : destination?.screen === 'marketing' ? destination.section : 'chat'} />
          ) : screen === 'growth' ? (
            <GrowthScreen onToast={say} />
          ) : screen === 'attribution' || screen === 'digest' ? (
            <GrowthReportsScreen mode={screen} />
          ) : screen === 'queue' ? (
            <QueueScreen onToast={say} onChanged={() => void refresh()} />
          ) : screen === 'opps' ? (
            <OpportunitiesScreen
              opportunities={opportunities}
              ingesting={ingesting}
              onIngest={ingestNow}
              onOpen={(url) => void window.signal.openExternal(url)}
            />
          ) : screen === 'scoring' ? (
            <ScoringScreen onToast={say} />
          ) : screen === 'guardrails' ? (
            <GuardrailsScreen status={status} onToast={say} />
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
