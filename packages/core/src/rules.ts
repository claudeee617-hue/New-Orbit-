import { OrbitError } from '@orbit/shared';
import type { EdgeType, NodeType } from './vocabulary.js';

const CODE: readonly NodeType[] = ['File', 'Symbol', 'Function', 'Class', 'Module'];
const CALLABLE: readonly NodeType[] = ['Symbol', 'Function', 'Class'];

interface EdgeRule {
  readonly from: readonly NodeType[];
  readonly to: readonly NodeType[];
  /** When true, both ends must have the same node type (e.g. a Decision supersedes a Decision). */
  readonly sameType?: true;
}

/**
 * Which node types each relationship may connect. Edges that break these rules are rejected at
 * write time. Extending a rule is a deliberate change that should be recorded in an ADR.
 */
export const EDGE_RULES: Readonly<Record<EdgeType, EdgeRule>> = {
  IMPORTS: { from: CODE, to: [...CODE, 'Dependency'] },
  CALLS: { from: CALLABLE, to: CALLABLE },
  DEPENDS_ON: {
    from: ['Repository', 'Module', 'File', 'Environment'],
    to: ['Dependency', 'Module', 'File', 'Repository'],
  },
  MODIFIES: {
    from: ['Commit', 'PullRequest'],
    to: [...CODE, 'Dependency', 'CIWorkflow', 'Documentation'],
  },
  TESTS: { from: ['Test'], to: [...CODE, 'Firmware'] },
  BUILDS: { from: ['Build', 'CIWorkflow'], to: ['Artifact', 'Firmware', 'Build'] },
  RUNS_IN: { from: ['TestRun', 'Build', 'Test'], to: ['Environment', 'CIWorkflow', 'Build'] },
  OBSERVED_ON: {
    from: ['TelemetrySession', 'TestRun'],
    to: ['HardwareDevice', 'Firmware', 'Environment'],
  },
  INTRODUCES: {
    from: ['Commit', 'PullRequest'],
    to: [...CODE, 'Dependency', 'Test', 'Finding'],
  },
  FIXES: { from: ['Commit', 'PullRequest'], to: ['Issue', 'Finding'] },
  DOCUMENTS: {
    from: ['Documentation', 'Decision'],
    to: [...CODE, 'Repository', 'Dependency', 'Firmware'],
  },
  SUPERSEDES: {
    from: ['Decision', 'Documentation', 'ChangePassport', 'Environment', 'Artifact'],
    to: ['Decision', 'Documentation', 'ChangePassport', 'Environment', 'Artifact'],
    sameType: true,
  },
  AFFECTS: {
    from: ['Commit', 'PullRequest', 'Finding', 'ChangePassport'],
    to: [...CODE, 'Test', 'Dependency', 'Firmware', 'HardwareDevice', 'CIWorkflow', 'Environment'],
  },
  VERIFIED_BY: {
    from: ['Commit', 'PullRequest', 'ChangePassport', 'Firmware', 'Build'],
    to: ['TestRun', 'TelemetrySession', 'Test', 'CIWorkflow', 'Build', 'Artifact'],
  },
};

export function isEdgeAllowed(type: EdgeType, fromType: NodeType, toType: NodeType): boolean {
  const rule = EDGE_RULES[type];
  if (!rule.from.includes(fromType) || !rule.to.includes(toType)) return false;
  if (rule.sameType === true && fromType !== toType) return false;
  return true;
}

export function assertEdgeAllowed(type: EdgeType, fromType: NodeType, toType: NodeType): void {
  if (!isEdgeAllowed(type, fromType, toType)) {
    throw new OrbitError(
      'INVALID_INPUT',
      `Relationship ${type} is not allowed from ${fromType} to ${toType}`,
      {
        details: { type, fromType, toType },
      },
    );
  }
}
