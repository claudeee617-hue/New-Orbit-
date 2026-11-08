export { MemoryEngine, memoryKey, nodeTypeFor, slugify } from './engine.js';
export type { ImportedMemory, MemoryEngineOptions } from './engine.js';
export { diskFileProbe, graphFileProbe, combineProbes } from './probe.js';
export type { FileProbe } from './probe.js';
export { searchMemory } from './search.js';
export type { MemoryHit, MemorySearchQuery, MemorySearchResult } from './search.js';
export { checkStaleness } from './staleness.js';
export type { StaleReason, StalenessFinding } from './staleness.js';
export { findConflicts } from './conflicts.js';
export type { MemoryConflict } from './conflicts.js';
export { importDocuments, isAdrPath, parseAdr } from './import.js';
export type { ImportOptions, ImportResult, ImportedEntry, ParsedAdr } from './import.js';
export { linkMemoryToHistory } from './link.js';
export type { LinkResult, MemoryLink } from './link.js';
export {
  DECISION_STATUSES,
  MEMORY_AUTHORITIES,
  MEMORY_CATEGORIES,
  MEMORY_LIMITS,
  MEMORY_STATUSES,
  NORMATIVE_CATEGORIES,
  sourceRefSchema,
} from './types.js';
export type {
  DecisionStatus,
  MemoryAuthority,
  MemoryCategory,
  MemoryConfirmInput,
  MemoryCreateInput,
  MemoryInvalidateInput,
  MemoryItem,
  MemoryStatus,
  MemoryUpdateInput,
  MemoryVersion,
  SourceRef,
} from './types.js';
