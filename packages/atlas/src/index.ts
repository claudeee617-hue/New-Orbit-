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
export * from './memory/index.js';
