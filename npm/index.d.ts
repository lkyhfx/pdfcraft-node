/// <reference types="node" />
export type CompressionMode = 'lossless' | 'balanced' | 'strong';
export interface OperationOptions {
  /** Hard cap: 512 MiB, aggregate for merge. */
  maxInputBytes?: number;
  /** Hard cap: 256 MiB, aggregate for split. */
  maxOutputBytes?: number;
  /** Terminates the isolated native worker; default 120000, maximum 300000. */
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface CompressOptions extends OperationOptions {
  mode?: CompressionMode;
  /** Downgrading newer PDFs is refused. */
  compatibility?: 'retain' | '1.4' | '1.5' | '1.6' | '1.7' | '2.0';
}
export function compressPdf(input: Buffer | Uint8Array, options?: CompressOptions): Promise<Buffer>;
export function compressPdfFile(inputPath: string, outputPath: string, options?: CompressOptions): Promise<void>;

export interface PdfPageInfo {
  /** Visible dimensions in points after crop, rotation and UserUnit. */
  width: number;
  height: number;
  rotation: number;
  orientation: 'portrait' | 'landscape';
}
export interface PdfInfo { pageCount: number; version: string; pages: PdfPageInfo[] }
/** Inclusive, 1-based range. */
export interface PageRange { start: number; end: number }
export interface RenderOptions extends OperationOptions {
  /** Default 144. */
  dpi?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
  transparent?: boolean;
}
export interface SvgRenderOptions extends OperationOptions {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
}
export interface BatchExtractOptions extends OperationOptions {
  maxBatchBytes?: number;
  /** Default and maximum 128. */
  maxRangePages?: number;
  /** Default and maximum 128. */
  maxOutputs?: number;
}
export interface ExtractedPdfFile { path: string; start: number; end: number; bytes: number }
export function getPdfInfo(input: Buffer | Uint8Array, options?: OperationOptions): Promise<PdfInfo>;
export function getPdfInfoFile(path: string, options?: OperationOptions): Promise<PdfInfo>;
export function mergePdfs(inputs: (Buffer | Uint8Array)[], options?: OperationOptions): Promise<Buffer>;
export function mergePdfFiles(paths: string[], outputPath: string, options?: OperationOptions): Promise<void>;
/** Preserves supplied order and duplicates. */
export function selectPdfPages(input: Buffer | Uint8Array, pages: number[], options?: OperationOptions): Promise<Buffer>;
export function removePdfPages(input: Buffer | Uint8Array, pages: number[], options?: OperationOptions): Promise<Buffer>;
/** Deletes selected originals; inserts every replacement page at the earliest selected position. */
export function replacePdfPages(input: Buffer | Uint8Array, replacement: Buffer | Uint8Array, pages: number[], options?: OperationOptions): Promise<Buffer>;
export function splitPdf(input: Buffer | Uint8Array, ranges: PageRange[], options?: OperationOptions): Promise<Buffer[]>;
export function extractPdfPagesFile(inputPath: string, outputPath: string, pages: number[], options?: OperationOptions): Promise<void>;
/** One source parse; writes each range sequentially. Oversized batches bisect recursively. */
export function extractPdfRangesFile(inputPath: string, outputDirectory: string, ranges: PageRange[], options?: BatchExtractOptions): Promise<ExtractedPdfFile[]>;
export function renderPdfPage(input: Buffer | Uint8Array, page: number, options?: RenderOptions): Promise<Buffer>;
export function renderPdfPageFile(inputPath: string, page: number, outputPath: string, options?: RenderOptions): Promise<void>;
export function renderSvgToPng(input: string | Buffer | Uint8Array, options?: SvgRenderOptions): Promise<Buffer>;
