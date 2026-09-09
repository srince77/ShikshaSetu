/**
 * Cleanup for legacy `line` elements carrying stray `rotate` / `height` fields
 * that the slide contract omits. Older documents predate schema enforcement
 * and could carry these fields, which whole-canvas validation now rejects
 * (`additionalProperties: false`). Stripping is lossless: line geometry is
 * fully determined by `left`/`top`/`width` plus `start`/`end`.
 *
 * Never mutates its input; returns the input by identity when nothing needs
 * stripping. Not a validator: unexpected shapes pass through untouched.
 * Walks a Stage aggregate (`{ stage, scenes }`), a single Scene row, or a
 * single Stage row; non-slide scene content (quiz/widget/PBL) is left alone.
 */

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The stray fields legacy runtimes could persist on a `line` element. */
const STRIPPED_LINE_FIELDS: readonly string[] = ['rotate', 'height'];

function ownsAnyField(el: unknown, fields: readonly string[]): el is Raw {
  return isObject(el) && fields.some((field) => Object.hasOwn(el, field));
}

export function stripLegacyLineGeometry(doc: unknown): unknown {
  if (!isObject(doc)) return doc;

  const asScene = stripSceneFields(doc);
  if (asScene !== undefined) return asScene;

  const asStage = stripStageFields(doc);
  if (asStage !== undefined) return asStage;

  if (!Array.isArray(doc.scenes)) return doc;

  let nextScenes: unknown[] | undefined;
  (doc.scenes as unknown[]).forEach((scene, sceneIndex) => {
    if (!isObject(scene)) return;
    const nextScene = stripSceneFields(scene);
    if (nextScene === undefined) return;
    (nextScenes ??= [...(doc.scenes as unknown[])])[sceneIndex] = nextScene;
  });

  const nextStage = isObject(doc.stage) ? stripStageFields(doc.stage) : undefined;
  if (nextScenes === undefined && nextStage === undefined) return doc;
  return {
    ...doc,
    ...(nextScenes !== undefined ? { scenes: nextScenes } : {}),
    ...(nextStage !== undefined ? { stage: nextStage } : {}),
  };
}

/** Strip one flat elements array; `undefined` when already clean. */
function stripElementList(elements: unknown[]): unknown[] | undefined {
  let nextElements: unknown[] | undefined;
  elements.forEach((el, elementIndex) => {
    if (!ownsAnyField(el, STRIPPED_LINE_FIELDS) || el.type !== 'line') return;
    const stripped = { ...el };
    for (const field of STRIPPED_LINE_FIELDS) delete stripped[field];
    (nextElements ??= [...elements])[elementIndex] = stripped;
  });
  return nextElements;
}

/** Strip a list of slide-like objects (scene `whiteboards`, stage `whiteboard`); `undefined` when clean. */
function stripSlideList(slides: unknown[]): unknown[] | undefined {
  let nextSlides: unknown[] | undefined;
  slides.forEach((slide, slideIndex) => {
    if (!isObject(slide) || !Array.isArray(slide.elements)) return;
    const nextElements = stripElementList(slide.elements);
    if (nextElements === undefined) return;
    (nextSlides ??= [...slides])[slideIndex] = { ...slide, elements: nextElements };
  });
  return nextSlides;
}

/** Strip the slide surfaces of one scene-shaped row; `undefined` when clean. */
function stripSceneFields(scene: Raw): Raw | undefined {
  let nextScene: Raw | undefined;

  const content = scene.content;
  if (isObject(content)) {
    // Gate on the slide discriminant so quiz/widget/PBL content is never touched;
    // an absent discriminant stays eligible (predates schema enforcement).
    const slideShaped = content.type === 'slide' || content.type === undefined;
    const canvas = slideShaped ? content.canvas : undefined;
    if (isObject(canvas) && Array.isArray(canvas.elements)) {
      const nextElements = stripElementList(canvas.elements);
      if (nextElements !== undefined) {
        nextScene = {
          ...scene,
          content: { ...content, canvas: { ...canvas, elements: nextElements } },
        };
      }
    }
  }

  if (Array.isArray(scene.whiteboards)) {
    const nextWhiteboards = stripSlideList(scene.whiteboards as unknown[]);
    if (nextWhiteboards !== undefined) {
      nextScene = { ...(nextScene ?? scene), whiteboards: nextWhiteboards };
    }
  }

  return nextScene;
}

/** Strip the explainer-board surface of one stage-shaped row (`whiteboard`); `undefined` when clean. */
function stripStageFields(stage: Raw): Raw | undefined {
  if (!Array.isArray(stage.whiteboard)) return undefined;
  const nextWhiteboard = stripSlideList(stage.whiteboard as unknown[]);
  return nextWhiteboard === undefined ? undefined : { ...stage, whiteboard: nextWhiteboard };
}
