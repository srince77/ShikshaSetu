/**
 * Asset manifest: the set of asset references a document *touches*, classified
 * by role, with optional per-asset metadata layered on by the caller.
 *
 * An entry's `ref` is the reference exactly as the document holds it (an
 * allocated asset id, a legacy placeholder, or a concrete URL), not a content
 * hash or resolution result, so two exports of an unchanged document produce
 * the same manifest and a reference whose bytes resolve to nothing still
 * appears. The enumeration is pure and IO-free; metadata enrichment is a
 * caller-supplied callback that must not mutate the document.
 */
import type { Action } from './action.js';
import type { Slide } from './slides.js';
import { slideMediaSlotDescriptors, type SlideMediaSlotKind } from './slide-media-slots.js';
import { isSlideContent, type Scene, type SceneType, type Stage } from './stage.js';

/** The role a referenced asset plays in the document. */
export type AssetKind = 'image' | 'video' | 'audio' | 'poster' | 'background';

/** Provenance and byte metadata an export can attach to a manifest entry; all optional
 * since a referenced asset may have no stored record (bytes pending, pruned, or never written). */
export interface AssetManifestMetadata {
  readonly byteSize?: number;
  readonly mimeType?: string;
  /** Playback duration in seconds, for audio/video assets that recorded one. */
  readonly durationSeconds?: number;
  /** Voice the narration was synthesized with, for speech audio. */
  readonly voice?: string;
  /** Generation prompt the asset was produced from, for generated media. */
  readonly prompt?: string;
}

export interface AssetManifestEntry extends AssetManifestMetadata {
  readonly ref: string;
  readonly kind: AssetKind;
}

export interface AssetManifest {
  /**
   * One entry per distinct (reference, kind) pair, in document order (stage
   * whiteboard, then each scene's canvas/whiteboards/speech actions, then the
   * stage's video-manifest keys).
   */
  readonly entries: readonly AssetManifestEntry[];
  /**
   * Logical owner count per reference. An owner is the element, background, or
   * speech action holding the reference, so a video element repeating one ref
   * in both `src` and `mediaRef` counts once while its poster counts separately.
   */
  readonly referenceCounts: ReadonlyMap<string, number>;
}

/** The document slice the enumeration reads: a stage plus its scenes. */
export interface AssetManifestDocument {
  readonly stage: Pick<Stage, 'whiteboard' | 'videoManifest'>;
  readonly scenes: readonly Scene<Action, { type: SceneType }>[];
}

export interface EnumerateAssetManifestOptions {
  /** Called once per distinct (reference, kind) pair; return `undefined` when nothing is known. */
  readonly metadata?: (ref: string, kind: AssetKind) => AssetManifestMetadata | undefined;
}

function manifestKind(slotKind: SlideMediaSlotKind): AssetKind {
  switch (slotKind) {
    case 'background-image':
      return 'background';
    case 'image-src':
      return 'image';
    case 'video-src':
    case 'video-media-ref':
      return 'video';
    case 'video-poster':
      return 'poster';
    case 'audio-src':
      return 'audio';
  }
}

/**
 * Enumerate the asset manifest of one document, in the document's own
 * traversal order (deterministic for a fixed document).
 */
export function enumerateAssetManifest(
  document: AssetManifestDocument,
  options: EnumerateAssetManifestOptions = {},
): AssetManifest {
  const kindsByRef = new Map<string, Set<AssetKind>>();
  const orderedPairs: Array<{ ref: string; kind: AssetKind }> = [];
  const ownerKeysByRef = new Map<string, Set<string>>();

  const record = (ref: string, kind: AssetKind, ownerKey: string) => {
    let kinds = kindsByRef.get(ref);
    if (!kinds) {
      kinds = new Set<AssetKind>();
      kindsByRef.set(ref, kinds);
    }
    if (!kinds.has(kind)) {
      kinds.add(kind);
      orderedPairs.push({ ref, kind });
    }
    let owners = ownerKeysByRef.get(ref);
    if (!owners) {
      owners = new Set<string>();
      ownerKeysByRef.set(ref, owners);
    }
    owners.add(ownerKey);
  };

  const visitSlide = (slide: Pick<Slide, 'background' | 'elements'>, scopeKey: string) => {
    for (const slot of slideMediaSlotDescriptors(slide)) {
      if (!slot.ref) continue;
      // Structural positions (not ids) keep owners collision-free even when scene/element ids repeat.
      const ownerKey =
        slot.elementIndex !== undefined
          ? `${scopeKey}:element:${slot.elementIndex}`
          : `${scopeKey}:background`;
      record(
        slot.ref,
        manifestKind(slot.kind),
        slot.kind === 'video-poster' ? `${ownerKey}:poster` : ownerKey,
      );
    }
  };

  const stage = document.stage;
  for (let index = 0; index < (stage.whiteboard ?? []).length; index += 1) {
    const slide = stage.whiteboard![index];
    visitSlide(slide, `stage-whiteboard:${index}`);
  }

  for (let sceneIndex = 0; sceneIndex < document.scenes.length; sceneIndex += 1) {
    const scene = document.scenes[sceneIndex];
    if (isSlideContent(scene.content)) {
      visitSlide(scene.content.canvas, `scene:${sceneIndex}:canvas`);
    }
    for (let index = 0; index < (scene.whiteboards ?? []).length; index += 1) {
      const slide = scene.whiteboards![index];
      visitSlide(slide, `scene:${sceneIndex}:whiteboard:${index}`);
    }
    for (let index = 0; index < (scene.actions ?? []).length; index += 1) {
      const action = scene.actions![index];
      if (action.type !== 'speech' || !action.audioId) continue;
      record(action.audioId, 'audio', `scene:${sceneIndex}:speech:${index}`);
    }
  }

  // videoManifest keys are references, not byte owners: they get no ownerKey,
  // so a manifest-only ref is enumerated but cannot qualify for in-place replacement.
  for (const ref of Object.keys(stage.videoManifest ?? {})) {
    let kinds = kindsByRef.get(ref);
    if (!kinds) {
      kinds = new Set<AssetKind>();
      kindsByRef.set(ref, kinds);
    }
    if (!kinds.has('video')) {
      kinds.add('video');
      orderedPairs.push({ ref, kind: 'video' });
    }
  }

  const entries: AssetManifestEntry[] = [];
  for (const { ref, kind } of orderedPairs) {
    const metadata = options.metadata?.(ref, kind);
    entries.push({
      ref,
      kind,
      ...(metadata?.byteSize !== undefined ? { byteSize: metadata.byteSize } : {}),
      ...(metadata?.mimeType !== undefined ? { mimeType: metadata.mimeType } : {}),
      ...(metadata?.durationSeconds !== undefined
        ? { durationSeconds: metadata.durationSeconds }
        : {}),
      ...(metadata?.voice !== undefined ? { voice: metadata.voice } : {}),
      ...(metadata?.prompt !== undefined ? { prompt: metadata.prompt } : {}),
    });
  }

  const referenceCounts = new Map(
    [...ownerKeysByRef].map(([ref, owners]) => [ref, owners.size] as const),
  );

  return { entries, referenceCounts };
}
