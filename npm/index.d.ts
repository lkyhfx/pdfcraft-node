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
