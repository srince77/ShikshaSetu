/**
 * Asset-storage seam: a DSL document never embeds binaries directly, only a
 * stable {@link AssetRef}; a {@link StorageProvider} resolves that ref to a URL
 * at render time. Keeps documents portable (a raw URL would bake in a
 * provider and an expiry assumption). Concrete backends (IndexedDB + object
 * URLs in the browser, object storage/CDN on a server) live in
 * `@shikshasetu/storage`; this package stays dependency- and DOM-free.
 */

/**
 * Backend-agnostic handle to a stored asset, allocated by the provider at
 * `put` time. A ref says nothing about the bytes behind it, so a richer
 * implementation can regenerate/replace bytes without invalidating documents
 * that point at the ref.
 */
export type AssetRef = string;

/** Optional per-asset metadata; every value must be structured-cloneable (IndexedDB). */
export interface AssetMeta {
  contentType?: string;
  [key: string]: unknown;
}

/**
 * Minimal structural view of a binary blob, satisfied by the platform `Blob`
 * without binding this package to the DOM lib.
 */
export interface BinaryBlob {
  readonly size: number;
  /** MIME type, `''` when unknown. */
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Store bytes, get back an allocated ref, resolve a ref to a URL usable as an
 * `<img>`/`<audio>`/`<video>` `src`. `put` must always return a fresh ref even
 * for already-stored bytes: reusing a ref for repeat content would let a
 * caller probe whether arbitrary bytes already exist (an existence oracle).
 */
export interface StorageProvider {
  put: (data: BinaryBlob, meta?: AssetMeta) => Promise<AssetRef>;
  /** Resolves to `null` if no asset is stored under the ref. */
  resolve: (ref: AssetRef) => Promise<string | null>;
  /** No-op if no asset exists under the ref. */
  remove: (ref: AssetRef) => Promise<void>;
}
