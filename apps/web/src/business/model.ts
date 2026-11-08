/** Static, source-linked business strategy data; intentionally separate from live financial reporting. */
export type OfferStatus = 'Core promise' | 'Pricing hypothesis' | 'Future offer';

export interface BusinessOffer {
  id: string;
  name: string;
  audience: string;
  price: string;
  billing: string;
  status: OfferStatus;
  value: string;
  capabilities: string[];
}

export const BUSINESS_OFFERS: BusinessOffer[] = [
  {
    id: 'community',
    name: 'Community',
    audience: 'Individual developers and open-source maintainers',
    price: '$0',
    billing: 'Free · local-first',
    status: 'Core promise',
    value: 'A useful engineering-evidence workflow without an ORBIT account, hosted service or AI API key.',
    capabilities: [
      'Local repository indexing and evidence storage',
      'Local analysis and Change Passport export as implemented',
      'Read-only access to locally indexed context',
      'No arbitrary scan or repository cap designed to force an upgrade',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    audience: 'GitHub-centric engineering teams, initially around 5–50 developers',
    price: '$8–$12 pilot · $12–$18 standard',
    billing: 'Per active contributor / month · pricing hypothesis',
    status: 'Pricing hypothesis',
    value: 'Shared evidence, collaboration and continuity across repositories—not access to basic local verification.',
    capabilities: [
      'Shared workspaces and project membership',
      'Opt-in evidence metadata synchronisation',
      'Cross-repository views and shared review workflows',
      'Team policies, integrations and agreed retention',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'Organisations with private deployment, governance and procurement needs',
    price: 'Custom',
    billing: 'Annual contract · scope to be validated',
    status: 'Future offer',
    value: 'Customer-controlled deployment choices, identity controls, auditability and operational support.',
    capabilities: [
      'Private or customer-controlled deployment options',
      'SSO / SAML, SCIM and role-based access',
      'Audit exports, retention and administrative controls',
      'Support commitments only when operationally supportable',
    ],
  },
  {
    id: 'embedded',
    name: 'Embedded',
    audience: 'Firmware, IoT and hardware engineering teams',
    price: '$49–$199',
    billing: 'Per engineering workspace / month · pricing hypothesis',
    status: 'Pricing hypothesis',
    value: 'Connect firmware changes and builds to recorded device sessions and telemetry evidence.',
    capabilities: [
      'Firmware build and commit linkage',
      'Recorded device-session metadata and replay',
      'Session comparison across firmware versions',
      'Exportable evidence bundles for validation reviews',
    ],
  },
];

export interface CustomerSegment {
  id: string;
  name: string;
  pain: string;
  buyer: string;
  motion: string;
}

export const CUSTOMER_SEGMENTS: CustomerSegment[] = [
  {
    id: 'product-engineering',
    name: 'Product engineering',
    pain: 'Reviewers reconstruct impact, test history, coverage and environment context across separate tools.',
    buyer: 'Engineering manager, staff engineer or DevEx / CI lead',
    motion: 'Beachhead · validate with GitHub + CI teams first',
  },
  {
    id: 'embedded-iot',
    name: 'Embedded / IoT',
    pain: 'Firmware changes, builds and device logs are disconnected, slowing failure investigation.',
    buyer: 'Firmware lead, embedded engineering manager or test lead',
    motion: 'Differentiated expansion · validate after the software workflow',
  },
  {
    id: 'open-source',
    name: 'Open-source maintainers',
    pain: 'Limited reviewer time and fragmented pull-request evidence.',
    buyer: 'Maintainer or project sponsor',
    motion: 'Community adoption before monetisation',
  },
  {
    id: 'consultancies',
    name: 'Consultancies and agencies',
    pain: 'Verification summaries and investigation workflows vary across client repositories.',
    buyer: 'CTO, delivery lead or quality lead',
    motion: 'Later team segment or channel',
  },
  {
    id: 'enterprise',
    name: 'Large enterprises',
    pain: 'Private deployment, identity, audit, retention and procurement requirements.',
    buyer: 'Platform engineering, security and procurement',
    motion: 'Defer until security and operations mature',
  },
];

export interface MarketReference {
  id: string;
  product: string;
  offer: string;
  price: string;
  billing: string;
  relevance: string;
  sourceUrl: string;
}

export const MARKET_RESEARCH_DATE = '2026-11-08';

export const MARKET_REFERENCES: MarketReference[] = [
  {
    id: 'github-team',
    product: 'GitHub Team',
    offer: 'Team collaboration platform',
    price: '$4',
    billing: 'Per user / month',
    relevance: 'Collaboration-platform baseline; not a direct ORBIT substitute.',
    sourceUrl: 'https://github.com/pricing',
  },
  {
    id: 'qodana',
    product: 'JetBrains Qodana',
    offer: 'Code quality and CI analysis',
    price: 'Quote / plan-dependent',
    billing: 'Per active contributor; 90-day activity window; minimum 3 contributors',
    relevance: 'Useful code-analysis comparator. The official page directs buyers to plan selection; no universal fixed public fee is stated here.',
    sourceUrl: 'https://www.jetbrains.com/qodana/buy/',
  },
  {
    id: 'graphite-starter',
    product: 'Graphite Starter',
    offer: 'PR workflow and team insights',
    price: '$20',
    billing: 'Per user / month · billed annually',
    relevance: 'Adjacent PR-workflow benchmark.',
    sourceUrl: 'https://graphite.com/pricing',
  },
  {
    id: 'graphite-team',
    product: 'Graphite Team',
    offer: 'PR workflow, collaboration and AI reviews',
    price: '$40',
    billing: 'Per user / month · billed annually',
    relevance: 'Higher-tier collaboration and review benchmark.',
    sourceUrl: 'https://graphite.com/pricing',
  },
  {
    id: 'coderabbit-essentials',
    product: 'CodeRabbit Essentials',
    offer: 'AI code review',
    price: '$24',
    billing: 'Per developer / month · billed annually',
    relevance: 'AI-review benchmark; not equivalent to evidence provenance and local-first workflows.',
    sourceUrl: 'https://www.coderabbit.ai/pricing',
  },
  {
    id: 'coderabbit-team',
    product: 'CodeRabbit Team',
    offer: 'Multi-repository AI review and team controls',
    price: '$48',
    billing: 'Per developer / month · billed annually',
    relevance: 'Team AI-review benchmark with different usage limits and product scope.',
    sourceUrl: 'https://www.coderabbit.ai/pricing',
  },
  {
    id: 'coderabbit-advanced',
    product: 'CodeRabbit Advanced',
    offer: 'Architectural insights and expanded security review',
    price: '$72',
    billing: 'Per developer / month · billed annually',
    relevance: 'Upper adjacent-market reference, not a direct ORBIT substitute.',
    sourceUrl: 'https://www.coderabbit.ai/pricing',
  },
];

export interface BusinessStage {
  id: string;
  name: string;
  productGoal: string;
  exitGate: string;
}

export const COMMERCIAL_STAGES: BusinessStage[] = [
  {
    id: 's0',
    name: 'S0 · Release readiness',
    productGoal: 'Stabilise the local-first workflow, documentation, licence and security baseline.',
    exitGate: 'Fresh-clone workflow is reproducible; critical security, privacy and licence blockers are resolved.',
  },
  {
    id: 's1',
    name: 'S1 · Community preview',
    productGoal: 'Ship one coherent local workflow from repository scan to evidence-backed Change Passport.',
    exitGate: 'External developers can complete the documented workflow without private assistance.',
  },
  {
    id: 's2',
    name: 'S2 · Design-partner pilot',
    productGoal: 'Validate real review and investigation workflows with 5–10 pilot teams.',
    exitGate: 'At least 5 teams complete workflows, 3 budget owners discuss paid pilots and 2 make a meaningful commitment.',
  },
  {
    id: 's3',
    name: 'S3 · Team paid beta',
    productGoal: 'Build optional shared workspaces and metadata sync only after pilot evidence confirms the need.',
    exitGate: 'Paid pilots use the product repeatedly; workspace costs, export, deletion and support are measured.',
  },
  {
    id: 's4',
    name: 'S4 · Enterprise readiness',
    productGoal: 'Add private deployment, identity, governance and operational controls for qualified buyers.',
    exitGate: 'Controls are implemented and tested; support obligations can be met.',
  },
  {
    id: 's5',
    name: 'S5 · Embedded expansion',
    productGoal: 'Complete firmware/build/device-session evidence linkage for embedded engineering teams.',
    exitGate: 'Multiple embedded teams use the workflow repeatedly and demonstrate investigation value.',
  },
];

export const BUSINESS_KPIS = [
  { id: 'mrr', name: 'Monthly recurring revenue', definition: 'Recognised subscription run-rate from paying workspaces.' },
  { id: 'paid-workspaces', name: 'Paid workspaces', definition: 'Distinct workspaces with an active paid subscription.' },
  { id: 'pilot-conversion', name: 'Pilot-to-paid conversion', definition: 'Pilot teams that become paying customers.' },
  { id: 'weekly-active', name: 'Weekly active workspaces', definition: 'Workspaces completing a real evidence workflow in a week.' },
  { id: 'workspace-cost', name: 'Cost per active workspace', definition: 'Measured hosting, storage and support cost per active workspace.' },
  { id: 'time-to-value', name: 'Time to first useful Passport', definition: 'Elapsed time from setup to a valid, evidence-backed output.' },
] as const;

export const TRUST_GUARDRAILS = [
  'Local repository inspection remains useful without an account or subscription.',
  'No source code, secrets or raw telemetry is uploaded by default.',
  'Hosted synchronisation is opt-in and limited to clearly selected data.',
  'No paid entitlement check may corrupt, lock or delete local evidence.',
  'No revenue, adoption, retention or reliability metric is displayed without measured data.',
  'No security certification, SLA or compliance claim is made before it is achieved.',
] as const;
