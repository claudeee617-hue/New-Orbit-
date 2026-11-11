export { ATLAS_VERSION, LANGUAGES, FILE_CATEGORIES, DEFAULT_SCAN_LIMITS } from './types.js';
export type {
  ExtractedCall,
  ExtractedImport,
  ExtractedSymbol,
  FileCategory,
  FileExtraction,
  ImportKind,
  Language,
  ScanConfig,
  SkippedFile,
  SourceLocation,
  SymbolKind,
  UnsupportedConstruct,
} from './types.js';
export { extractFile } from './extract.js';
export { classifyFile, detectLanguage, isTestPath, globToRegExp } from './classify.js';
export { findCycles, rankHotspots } from './analysis.js';
export type { Hotspot } from './analysis.js';
export { scanRepository, resolveConfig } from './scan.js';
export type { ScanOptions, ScanResult, ChangeCounts, EntryPoint } from './scan.js';
export {
  buildArchitectureMap,
  exportAtlas,
  impactMap,
  moduleSummaries,
  symbolIndex,
} from './report.js';
export type {
  ArchitectureMap,
  ArchitectureModule,
  AtlasExport,
  ImpactMap,
  ModuleSummary,
  SymbolEntry,
  SymbolQuery,
} from './report.js';
export {
  normalizeRepoPath,
  parseUnifiedDiff,
  parseLcov,
  parseCobertura,
  verifyChangedLineCoverage,
} from './verification.js';
export type {
  VerificationStatus,
  DiffFile,
  CoverageFile,
  CoverageSummary,
  VerificationFinding,
  VerificationReport,
} from './verification.js';
export { parseJunitXml, summarizeTestHistory } from './flare.js';
export type { TestCaseResult, TestHistorySummary } from './flare.js';
export { inspectEnvironment, compareEnvironments } from './capsule.js';
export type { EnvironmentSnapshot, EnvironmentDifference } from './capsule.js';
export { parseTelemetry } from './flight-recorder.js';
export type { TelemetryPoint, TelemetrySession } from './flight-recorder.js';
export { createChangePassport } from './passport.js';
export type {
  ChangePassport,
  ChangePassportInput,
  PassportEvidence,
  PassportCompletenessDimension,
  PassportImpactSummary,
} from './passport.js';

export {
  MEMORY_KINDS,
  rememberMemory,
  searchMemories,
  getMemory,
  invalidateMemory,
  importMarkdownMemory,
  detectMemoryConflicts,
  assessMemoryFreshness,
} from './memory.js';
export type {
  MemoryKind,
  MemoryInput,
  MemoryRecord,
  MemorySearchOptions,
  MemoryConflict,
} from './memory.js';

export {
  findSensitivePathFindings,
  compareCoverageSnapshots,
  mapChangeContext,
  renderWitnessMarkdown,
  renderWitnessSarif,
} from './witness-extended.js';
export type {
  CoverageFileComparison,
  ChangedSymbolRef,
  RelatedTestRef,
  ChangeContext,
} from './witness-extended.js';
export {
  parsePytestJsonReport,
  parseJestJsonReport,
  parseGoTestJson,
  analyseTestHistory,
} from './flare-extended.js';
export type { FailureCluster, SlowTest, TestReliabilityReport } from './flare-extended.js';
export { inspectExtendedEnvironment } from './capsule-extended.js';
export type { ExtendedEnvironmentSnapshot } from './capsule-extended.js';

export {
  analyseTelemetry,
  createRecordedFileTransport,
  SERIAL_TRANSPORT_STATUS,
} from './flight-recorder-extended.js';
export type {
  TelemetrySeverity,
  TelemetryThresholdRule,
  TelemetryAnalysisOptions,
  TypedTelemetryMetric,
  TelemetryAnomaly,
  TelemetryAnalysis,
  TelemetryTransport,
} from './flight-recorder-extended.js';
export { storeTelemetrySession } from './telemetry-store.js';
export type { StoreTelemetrySessionInput, StoredTelemetrySession } from './telemetry-store.js';
export {
  recordChangePassport,
  getPassportHistory,
  compareChangePassports,
  createReproductionPlan,
} from './passport-engine.js';
export type {
  PassportDimension,
  PassportImpact,
  PassportRecordInput,
  PersistedPassport,
  PassportVersionSummary,
  PassportComparison,
  ReproductionStep,
  ReproductionPlan,
} from './passport-engine.js';

export { XmlError, childrenNamed, parseXml, type XmlElement } from './xml.js';
export { parseTelemetryTimestamp } from './flight-recorder.js';
