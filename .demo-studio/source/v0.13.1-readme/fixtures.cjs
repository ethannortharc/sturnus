// Fictional product-development workspace. No data is read from the host.
const now = Math.floor(Date.now() / 1000);
const root = '/home/demo/studio';
const work = (folder, branch, extra = {}) => ({
  path: `${root}/${folder}`, branch, main: branch === 'main', ahead: 0, behind: 0,
  dirty: 0, at: now - 420, head: 'b72e4c1', subject: 'Prepare the next release', ...extra
});
const project = (name, works) => ({
  key: name, name, path: `${root}/${name}`, workspace: 'studio', git: true, at: now - 120, live: 2,
  facts: { at: now, main: 'main', ahead: 0, behind: 0, tag: 'v1.8.0', works }
});
const session = (id, kind, name, title, summary, p, extra = {}) => ({
  id, kind, name, title, summary, project: p, workspace: 'studio', state: 'working', status: 'working',
  at: now - 120, since: now - 120, summary_at: now - 30, cwd: `${root}/${p}`,
  work: `${root}/${p}`, branch: 'main', loc: { session: 'studio', pane: id, mux: 'zellij' },
  unread: 0, subs: [], ...extra
});
const sessions = [
  session('api', 'claude', 'api-builder', 'Usage limits API',
    'Adding per-workspace limits. The implementation is ready; edge cases are under review.', 'atlas-api', {
      work: `${root}/atlas-limits`, cwd: `${root}/atlas-limits`, branch: 'feat/usage-limits', tool: 'Read',
      subs: [{ id: 'a18d7c', type: 'Explore', task: 'Check retry and rate-limit edge cases', model: 'Sonnet', state: 'working', start: now - 200, at: now - 10 },
        { id: 'b29e8d', type: 'Explore', task: 'Trace the existing quota middleware', state: 'done', start: now - 800, at: now - 500 }]
    }),
  session('review', 'codex', 'release-review', 'Review the release',
    'Usage-limit changes are reviewed. The migration and API contract are ready for a final look.', 'atlas-api', {
      state: 'idle', status: 'review', needs_you: 'Review the migration notes before merging feat/usage-limits.',
      work: `${root}/atlas-limits`, cwd: `${root}/atlas-limits`, branch: 'feat/usage-limits',
      said: 'The API contract and migration plan are ready for review.\n\n- Existing workspaces keep their current limits.\n- New limits are applied on the next billing cycle.\n- Retry behavior is covered by focused checks.\n\nThe remaining step is your review of the migration notes.'
    }),
  session('ui', 'cursor', 'console-ui', 'Workspace billing UI',
    'Connecting the usage meter to the new API and polishing the empty state.', 'northstar', {
      work: `${root}/northstar-billing`, cwd: `${root}/northstar-billing`, branch: 'feat/billing-console', tool: 'Edit'
    }),
  session('research', 'claude', 'research-notes', 'Explore local search', 'Comparing indexing approaches for a small offline search tool.', '', {
    workspace: 'research', cwd: '/home/demo/research/search', work: '', loc: null, state: 'idle', status: 'idle'
  })
];
const posts = [
  { id: 'p1', from: 'user', kind: 'user', at: now - 780, text: 'Keep the release small: usage limits first. We can ship the billing redesign separately.' },
  { id: 'p2', from: 'api-builder', kind: 'claude', at: now - 600, text: 'The usage-limit endpoint is ready on **feat/usage-limits**. Existing workspaces keep their current allowance.\n\n@release-review Please check the migration notes and retry behavior.' },
  { id: 'p3', from: 'release-review', kind: 'codex', at: now - 360, text: 'Reviewed the API contract and the migration path. No breaking changes found in the sample cases.\n\nOne decision remains: apply new limits on the **next billing cycle**.' },
  { id: 'p4', from: 'user', kind: 'user', at: now - 180, text: 'Agreed. Apply new limits next cycle; keep the current allowance until then.' }
];
const state = {
  sessions, version: '0.13.1', at: now, me: 'user', work_lang: 'en',
  workspaces: [
    { key: 'studio', name: 'Studio', path: root, projects: ['atlas-api', 'northstar'], live: 3, groups: { studio: 3 }, at: now - 120 },
    { key: 'research', name: 'Research', path: '/home/demo/research', projects: [], live: 1, groups: {}, at: now - 600 },
    { key: 'experiments', name: 'Experiments', path: '/home/demo/experiments', projects: [], live: 0, groups: {}, at: now - 86400 },
    { key: 'archive', name: 'Archive', path: '/home/demo/archive', projects: [], live: 0, groups: {}, at: now - 86400 * 8 }
  ],
  projects: {
    'atlas-api': project('atlas-api', [work('atlas-api', 'main'), work('atlas-limits', 'feat/usage-limits', { ahead: 4, dirty: 2, subject: 'Keep existing workspace allowances during migration' }), work('atlas-webhooks', 'feat/webhooks', { ahead: 2, at: now - 86400 * 5, subject: 'Add webhook delivery receipts' })]),
    northstar: project('northstar', [work('northstar', 'main'), work('northstar-billing', 'feat/billing-console', { ahead: 2, dirty: 3, subject: 'Connect the usage meter to the API' })])
  },
  boards: {
    studio: { key: 'studio', name: 'Studio', kind: 'workspace', unread: 0, topics: [], members: ['api-builder', 'release-review', 'console-ui'] },
    'atlas-api': { key: 'atlas-api', name: 'atlas-api', kind: 'project', unread: 0, topics: [], members: ['api-builder', 'release-review'], last: posts[3] },
    northstar: { key: 'northstar', name: 'northstar', kind: 'project', unread: 0, topics: [], members: ['console-ui'] }
  },
  groups: { studio: { name: 'studio', mux: 'zellij', clients: [{}], agents: 3 } },
  decisions: [
    { sid: 'review', name: 'release-review', by: 'user', what: 'Apply new usage limits on the next billing cycle.', at: now - 180 },
    { sid: 'api', name: 'api-builder', by: 'user', what: 'Ship usage limits first; keep the billing redesign separate.', at: now - 780 }
  ],
  reports: { review: { at: now - 100, name: 'release-review', r: {
    goal: 'Ship usage limits without changing existing workspace allowances.',
    done: ['Reviewed the API contract and migration notes.', 'Checked retries, empty responses, and existing workspace allowances.'],
    decisions: [{ by: 'user', what: 'Apply new limits on the next billing cycle.' }],
    now: 'Ready for your review.', next: ['Review the migration notes, then merge feat/usage-limits.'], refs: ['docs/usage-limits.md']
  } } },
  talk: [{ key: 'm1', from: 'api-builder', to: 'release-review', at: now - 600, text: 'The endpoint and migration notes are ready. Please check the retry behavior.', via: 'amail' }],
  queue: [{ id: 'q1', status: 'waiting', to: 'console-ui', mode: 'remind', created: now - 900, text: 'Review the billing empty state after the usage meter is connected.' }],
  reporting: [], locks: [], lock_issues: [], inbox: [], events: [],
  summarizer: { busy: false, error: '' }, about: { model: 'Claude · Haiku' },
  models: { summary: { label: 'Claude · Haiku' }, assist: { label: 'Claude · Haiku' } },
  voice: { on: false }, muxes: ['zellij', 'tmux'], launch: { claude: ['claude'], codex: ['codex'], cursor: ['cursor-agent'] }
};
const transcript = { items: [
  { who: 'user', at: now - 600, text: 'Review the usage-limit changes. Focus on compatibility and the migration path.' },
  { who: 'assistant', at: now - 480, text: 'I will check the API contract, how existing allowances are preserved, and what happens when a request is retried.' },
  { who: 'tool', at: now - 300, text: 'Read docs/usage-limits.md · inspect migration and retry checks' },
  { who: 'assistant', at: now - 150, text: '## Review complete\n\nThe change keeps existing workspace allowances intact.\n\n- The migration defers new limits until the next billing cycle.\n- Retried requests reuse the same usage record.\n- The empty state is handled without an error.\n\n**Ready for your review:** confirm the migration notes before merging.' }
] };
module.exports = { state, board: { posts, topics: [], members: ['api-builder', 'release-review'] }, transcript };
