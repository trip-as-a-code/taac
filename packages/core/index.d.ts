import type { Diagnostic, SiteExport } from './types'

export type * from './types'

export interface CollectedFiles {
  files: Record<string, string>
  key: string
  paths: string[]
  root: string
}

export type ExportResult =
  { ok: true; export: SiteExport; paths: string[] } | { ok: false; diagnostics: Diagnostic[]; paths: string[] }

export function collectFiles(inputPath: string): CollectedFiles
export function exportSite(inputPath: string): ExportResult
export function exportFiles(
  files: Record<string, string>,
  key: string,
  options?: { lenient?: boolean },
): { ok: true; export: SiteExport } | { ok: false; diagnostics: Diagnostic[] }
export function validate(inputPath: string): Diagnostic[]
export function version(): string
