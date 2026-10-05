import { CHANNELS, type ChannelKey } from './growth.js';
import { hasPublishingPermission, type OperationsView } from './operations.js';
import { PLAYBOOKS } from './playbooks.js';

/** Capability inventory, not a claim that a channel has been tested or has buyers. */
export function channelCoverage(view: OperationsView, productId: string, now: number) {
  const state = view.states.find(s => s.productId === productId);
  const accounts = view.accounts.filter(a => a.productId === productId && state?.accountIds.includes(a.id) && a.status === 'verified'
    && hasPublishingPermission(a) && (!a.expiresAt || a.expiresAt > now || a.refreshable));
  const activities = view.readiness?.find(r => r.productId === productId)?.activities ?? [];
  const ready = (label: string) => activities.some(a => a.label === label && a.ready);
  const website = accounts.some(a => a.provider === 'signal-blog');
  const social = accounts.some(a => ['x', 'linkedin', 'facebook', 'bluesky'].includes(a.provider)) && Boolean(state?.mode !== 'acquisition' || state.ownedAudience || state.testChannels);
  const enabled = (value: boolean) => value ? view.offline || !state?.running ? 'Ready when Run starts' : 'Enabled' : 'Needs setup';
  const capability: Partial<Record<ChannelKey, { status: string; detail: string }>> = {
    blogs: { status: 'Research and draft', detail: 'Signal can find relevant blogs, inspect their audience and contributor guidance, and prepare a specific tutorial pitch. You review the destination and submit through its permitted route.' },
    seo: { status: enabled(website), detail: 'Publish problem-specific website articles; measure search traffic and paid outcomes. Search visibility takes time.' },
    content: { status: enabled(website || social || ready('YouTube ads')), detail: 'Test useful tutorials and selected social destinations. Each is a distribution test; publication alone does not establish reach.' },
    community: { status: enabled(ready('Public request replies')), detail: 'Reply to qualified Bluesky requests. Other researched communities require their own permitted participation route.' },
    email: { status: enabled(ready('Initial outreach')), detail: 'Send configured responses and follow-ups to eligible opted-in leads. Public authors are not added to email lists.' },
    sales: { status: enabled(ready('Email replies and follow-ups')), detail: 'Handle relevant inbox conversations under the saved Sales policy and separate email limits.' },
    sem: { status: 'Funding and launch required', detail: 'Prepare a bounded search-ad experiment. This marketing loop does not launch ads or increase spending.' },
    'social-ads': { status: 'Funding and launch required', detail: 'Prepare audience and creative tests; paid delivery needs its own funded launch.' },
    'offline-ads': { status: 'Placement required', detail: 'Arrange a trackable placement and cost before committing to print or advertising.' },
    affiliates: { status: 'Partner recruitment required', detail: 'An affiliate signup program is not a recruited partner. Arrange relevant partner participation and track resulting sales.' },
    platforms: { status: 'Submission required', detail: 'Prepare listings or LTD submissions; platform acceptance and placement are separate from connected social accounts.' },
  };
  const automatic = new Set<ChannelKey>(['seo', 'content', 'community', 'email', 'sales']);
  const next: Partial<Record<ChannelKey, string>> = {
    blogs: 'Open Sales → Prospects and run research. Signal returns specific blog destinations, evidence, proposed copy and the remaining submission step in Drafts & suggestions.',
    seo: website ? 'Signal can publish through the selected website account. Review the saved article limit and inspect query impressions in Analytics.' : 'Connect the product website, then select it in Operating settings.',
    content: 'Choose a real buyer problem and a selected destination. Signal can write and publish supported formats; videos still need a finished asset and a supported publishing route.',
    community: 'Enable qualified public replies and a separate reply allowance in Operating settings. Signal can reply on Bluesky. For Facebook groups, Reddit or Discord, read the community rules and use a permitted human account to participate.',
    email: 'Open Sales → Prospects to research businesses and prepare cold introductions. Review each exact email in Drafts & suggestions before queuing it. Subscriber outreach remains separate; connecting Gmail alone does not provide an outreach audience.',
    sales: 'In Sales, enable inbox monitoring and AI triage, then review the reply policy. Signal answers eligible buying inquiries; unresolved questions appear in Needs you.',
    affiliates: 'Choose three educators serving this product’s buyers. Prepare a concrete demonstration and affiliate invitation in Growth workspace. Send through a permitted contact route and record each reply in the lead pipeline.',
    platforms: 'Check the existing LTD submissions in the lead pipeline first. Record acceptance or rejection and the next follow-up date. For a new directory, prepare screenshots and a listing, then submit through its official form.',
    partnerships: 'Choose three complementary businesses with an existing audience. Offer one joint tutorial that helps their customers. Prepare the invitation in Growth workspace, contact them through a permitted route, and record the outcome.',
  };
  return CHANNELS.map(([key, label, description]) => {
    const coverage = capability[key] ?? { status: 'Guided experiment', detail: description + ' Signal can prepare materials; you arrange the external activity.' };
    const playbook = PLAYBOOKS.find(p => p.channel === key)!;
    return { key, label, ...coverage,
      lane: automatic.has(key) ? coverage.status === 'Needs setup' ? 'setup' as const : 'automatic' as const : 'guided' as const,
      nextStep: next[key] ?? playbook.firstTest,
      steps: key === 'blogs' ? ['Signal searches for relevant blogs and checks their published content.', 'Signal proposes a useful tutorial pitch and saves the supporting evidence.', 'Open the specific destination and contributor guidance from the suggestion.', 'Review the proposed copy, submit through the permitted route, then record the link.'] : playbook.steps, measure: playbook.measure, stopRule: playbook.stopRule,
      destination: key === 'email' || key === 'sales' || key === 'blogs' ? 'sales' as const : automatic.has(key) ? 'settings' as const : 'studio' as const,
    };
  });
}
