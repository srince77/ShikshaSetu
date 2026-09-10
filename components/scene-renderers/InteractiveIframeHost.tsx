'use client';

/**
 * Stable host for interactive scene iframes.
 *
 * Mounted once at the classroom root — outside the mode-swap / scene subtree
 * that unmounts and remounts — so the iframe elements it renders survive
 * scene switches and any classroom-shell remount. An in-tree placeholder
 * (not yet built — no fixture content exercises the `interactive` scene type
 * this phase) would register content via `useInteractiveIframePool.mount`
 * and report its on-screen rect; the actual iframes live here, portaled into
 * a stable host node and positioned over that rect via `position: fixed`.
 *
 * Ported down from the reference app's version: this keeps the part that
 * solves the real, non-obvious problem (iframe reload on remount) and the
 * widget postMessage channel `wb_*`/`widget_*` actions need, and drops the
 * Pro-mode element-picker and runtime-error-capture wiring, which belong to
 * the canvas editor's AI-assisted-fix flow (a separate, deprioritized piece
 * of work) rather than to solving the keep-alive problem itself.
 *
 * Portal target follows `document.fullscreenElement` so the iframe stays
 * inside the fullscreen subtree during presentation mode; otherwise it lives
 * on `document.body`.
 *
 * Security: the sandbox intentionally omits `allow-same-origin`. Combining
 * `allow-scripts` with `allow-same-origin` on a srcDoc iframe effectively
 * negates sandbox protections — the embedded document would be treated as
 * same-origin with the parent and could access cookies, localStorage, and
 * the parent DOM. Since the HTML may originate from LLM output, keeping the
 * iframe in a unique (null) origin prevents any embedded script from
 * reaching the host application's state. postMessage communication (the only
 * parent<->iframe channel used here) still works with a null origin because
 * the host sends with targetOrigin='*'.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import {
  useInteractiveIframePool,
  type IframePoolEntry,
} from '@/lib/store/interactive-iframe-pool';
import {
  GENUI_LOGICAL_HEIGHT,
  GENUI_LOGICAL_WIDTH,
  fitGenUiViewport,
} from '@/lib/interactive/logical-viewport';
import { intersectClientBoxes } from '@/lib/interactive/visible-client-rect';

export function InteractiveIframeHost() {
  const entries = useInteractiveIframePool((s) => s.entries);
  const activeSceneId = useInteractiveIframePool((s) => s.activeSceneId);
  const reset = useInteractiveIframePool((s) => s.reset);
  const setActiveScene = useWidgetIframeStore((s) => s.setActiveScene);

  // Portal into the fullscreen element when one is active (presentation mode
  // fullscreens the classroom shell, and a body-portaled iframe would not be
  // part of that subtree, so it would vanish). Falls back to body otherwise.
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useEffect(() => {
    const sync = () => setPortalTarget(document.fullscreenElement ?? document.body);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Keep the messaging store's active scene in lock-step (its legacy fallback
  // path resolves the current widget by active scene when no id is passed).
  useEffect(() => {
    setActiveScene(activeSceneId);
  }, [activeSceneId, setActiveScene]);

  // The host is mounted once per classroom. When it unmounts — e.g. on
  // classroom switch — drop the pool so a new classroom doesn't briefly
  // render the previous one's stale iframes.
  useEffect(() => reset, [reset]);

  if (!portalTarget) return null;

  return createPortal(
    <>
      {Object.entries(entries).map(([sceneId, entry]) => (
        <PooledIframe
          key={sceneId}
          sceneId={sceneId}
          entry={entry}
          visible={entry.owner !== null && sceneId === activeSceneId}
        />
      ))}
    </>,
    portalTarget,
  );
}

interface PooledIframeProps {
  readonly sceneId: string;
  readonly entry: IframePoolEntry;
  readonly visible: boolean;
}

/**
 * One persisted iframe. Stays mounted as long as its pool entry exists (only
 * evicted by LRU), so its document is preserved across scene/mode changes.
 * `srcDoc` / `src` come straight from the entry and only change when the
 * content changes — that is the single intended reload path.
 */
function PooledIframe({ sceneId, entry, visible }: PooledIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const registerIframe = useWidgetIframeStore((s) => s.registerIframe);

  // Register the postMessage callback for this scene so ActionEngine's
  // widget_* handlers can reach the iframe. Stable per scene: the callback
  // reads contentWindow lazily at send time.
  useEffect(() => {
    const send = (type: string, payload: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ type, ...payload }, '*');
    };
    registerIframe(sceneId, send);
    return () => registerIframe(sceneId, null);
  }, [sceneId, registerIframe]);

  const rect = entry.rect;
  const clip = entry.clip ?? rect;
  const viewport = rect ? fitGenUiViewport(rect) : null;
  const visibleViewport = viewport && clip ? intersectClientBoxes(viewport.box, clip) : null;
  // Require a real measured box before showing — a null or zero-size rect means
  // the slot hasn't laid out yet; showing then would flash a 0x0 iframe pinned
  // at the viewport origin.
  const shown =
    visible &&
    rect !== null &&
    clip !== null &&
    viewport !== null &&
    visibleViewport !== null &&
    visibleViewport.width > 0 &&
    visibleViewport.height > 0 &&
    rect.width > 0 &&
    rect.height > 0;
  const wrapStyle: CSSProperties = {
    position: 'fixed',
    left: visibleViewport?.left ?? 0,
    top: visibleViewport?.top ?? 0,
    width: visibleViewport?.width ?? 0,
    height: visibleViewport?.height ?? 0,
    overflow: 'hidden',
    borderRadius: 'var(--radius-tile)',
    zIndex: 1,
    visibility: shown ? 'visible' : 'hidden',
    pointerEvents: shown ? 'auto' : 'none',
  };
  const iframeStyle: CSSProperties = {
    position: 'absolute',
    left: viewport && visibleViewport ? viewport.box.left - visibleViewport.left : 0,
    top: viewport && visibleViewport ? viewport.box.top - visibleViewport.top : 0,
    width: GENUI_LOGICAL_WIDTH,
    height: GENUI_LOGICAL_HEIGHT,
    border: 0,
    transform: `scale(${viewport?.scale ?? 0})`,
    transformOrigin: 'top left',
  };

  return (
    <div style={wrapStyle}>
      <iframe
        ref={iframeRef}
        srcDoc={entry.srcDoc}
        src={entry.srcDoc ? undefined : entry.src}
        style={iframeStyle}
        title={`Interactive scene ${sceneId}`}
        sandbox="allow-scripts allow-forms allow-popups"
      />
    </div>
  );
}
