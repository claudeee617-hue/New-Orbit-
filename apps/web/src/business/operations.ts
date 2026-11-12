export const BUSINESS_WORKSPACE_VERSION = 1 as const;
export const BUSINESS_WORKSPACE_STORAGE_KEY = 'orbit.business-workspace.v1';
export const MAX_BUSINESS_OPPORTUNITIES = 250;
export const MAX_BUSINESS_WORKSPACE_BYTES = 2_000_000;

export const OPPORTUNITY_STAGES = [
  'discovery',
  'qualified',
  'pilot',
  'won',
  'lost',
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_SEGMENTS = [
  'product-engineering',
  'embedded-iot',
  'open-source',
  'consultancy',
  'enterprise',
] as const;

export type OpportunitySegment = (typeof OPPORTUNITY_SEGMENTS)[number];

export interface BusinessOpportunity {
  id: string;
  account: string;
  segment: OpportunitySegment;
  stage: OpportunityStage;
  estimatedMonthlyValue: number;
  nextAction: string;
  dueDate: string;
  evidence: string;
}

export interface BusinessWorkspace {
  version: typeof BUSINESS_WORKSPACE_VERSION;
  opportunities: BusinessOpportunity[];
}

export interface BusinessPipelineSummary {
  activeAccounts: number;
  qualifiedAccounts: number;
  pilotAccounts: number;
  wonAccounts: number;
  dueFollowUps: number;
  openPipelineEstimate: number;
}

const MAX_VALUE = 1_000_000_000_000;

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  discovery: 'Discovery',
  qualified: 'Qualified',
  pilot: 'Pilot',
  won: 'Won',
  lost: 'Closed lost',
};

export const OPPORTUNITY_SEGMENT_LABELS: Record<OpportunitySegment, string> = {
  'product-engineering': 'Product engineering',
  'embedded-iot': 'Embedded / IoT',
  'open-source': 'Open source',
  consultancy: 'Consultancy / agency',
  enterprise: 'Enterprise',
};

export function emptyBusinessWorkspace(): BusinessWorkspace {
  return { version: BUSINESS_WORKSPACE_VERSION, opportunities: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const result = value.trim();
  if (result.length === 0 || result.length > maxLength) {
    throw new Error(`${field} must contain 1–${maxLength} characters.`);
  }
  return result;
}

function optionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const result = value.trim();
  if (result.length > maxLength) {
    throw new Error(`${field} must be no longer than ${maxLength} characters.`);
  }
  return result;
}

function validDate(value: string): boolean {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseOpportunity(value: unknown, index: number): BusinessOpportunity {
  const label = `Opportunity ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);

  const id = requiredText(value.id, `${label} ID`, 80);
  const account = requiredText(value.account, `${label} account`, 120);
  const segment = value.segment;
  if (
    typeof segment !== 'string' ||
    !OPPORTUNITY_SEGMENTS.includes(segment as OpportunitySegment)
  ) {
    throw new Error(`${label} has an unsupported segment.`);
  }

  const stage = value.stage;
  if (typeof stage !== 'string' || !OPPORTUNITY_STAGES.includes(stage as OpportunityStage)) {
    throw new Error(`${label} has an unsupported stage.`);
  }

  const estimatedMonthlyValue = value.estimatedMonthlyValue;
  if (
    typeof estimatedMonthlyValue !== 'number' ||
    !Number.isFinite(estimatedMonthlyValue) ||
    estimatedMonthlyValue < 0 ||
    estimatedMonthlyValue > MAX_VALUE
  ) {
    throw new Error(`${label} estimated monthly value must be between 0 and ${MAX_VALUE}.`);
  }

  const nextAction = optionalText(value.nextAction, `${label} next action`, 180);
  const dueDate = optionalText(value.dueDate, `${label} due date`, 10);
  if (!validDate(dueDate)) throw new Error(`${label} due date must use YYYY-MM-DD.`);
  const evidence = optionalText(value.evidence, `${label} evidence`, 1_000);

  return {
    id,
    account,
    segment: segment as OpportunitySegment,
    stage: stage as OpportunityStage,
    estimatedMonthlyValue,
    nextAction,
    dueDate,
    evidence,
  };
}

/** Validates imported or persisted data before it enters the UI. */
export function normaliseBusinessWorkspace(value: unknown): BusinessWorkspace {
  if (!isRecord(value) || value.version !== BUSINESS_WORKSPACE_VERSION) {
    throw new Error('Unsupported Business workspace version.');
  }
  if (!Array.isArray(value.opportunities)) {
    throw new Error('Business workspace opportunities must be an array.');
  }
  if (value.opportunities.length > MAX_BUSINESS_OPPORTUNITIES) {
    throw new Error(
      `A workspace can contain at most ${MAX_BUSINESS_OPPORTUNITIES} opportunities.`,
    );
  }

  const opportunities = value.opportunities.map(parseOpportunity);
  const ids = new Set<string>();
  for (const opportunity of opportunities) {
    if (ids.has(opportunity.id)) throw new Error('Opportunity IDs must be unique.');
    ids.add(opportunity.id);
  }

  return { version: BUSINESS_WORKSPACE_VERSION, opportunities };
}

export function parseBusinessWorkspace(serialized: string): BusinessWorkspace {
  if (serialized.length > MAX_BUSINESS_WORKSPACE_BYTES) {
    throw new Error('Business workspace backup is larger than 2 MB.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  return normaliseBusinessWorkspace(parsed);
}

export function serialiseBusinessWorkspace(workspace: BusinessWorkspace): string {
  return JSON.stringify(normaliseBusinessWorkspace(workspace), null, 2);
}

export function getLocalDateKey(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function calculateBusinessPipelineSummary(
  workspace: BusinessWorkspace,
  today = getLocalDateKey(),
): BusinessPipelineSummary {
  const open = workspace.opportunities.filter(
    ({ stage }) => stage !== 'won' && stage !== 'lost',
  );
  return {
    activeAccounts: open.length,
    qualifiedAccounts: open.filter(
      ({ stage }) => stage === 'qualified' || stage === 'pilot',
    ).length,
    pilotAccounts: open.filter(({ stage }) => stage === 'pilot').length,
    wonAccounts: workspace.opportunities.filter(({ stage }) => stage === 'won').length,
    dueFollowUps: open.filter(({ dueDate }) => dueDate !== '' && dueDate <= today).length,
    openPipelineEstimate: open.reduce(
      (total, { estimatedMonthlyValue }) => total + estimatedMonthlyValue,
      0,
    ),
  };
}
