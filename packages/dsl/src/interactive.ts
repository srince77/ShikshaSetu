/** Interactive scene content and its dependency-free widget extension point. */

/** Every widget kind produced by the interactive-content pipeline. */
export type WidgetType =
  | 'simulation'
  | 'diagram'
  | 'code'
  | 'game'
  | 'visualization3d'
  | 'procedural-skill';

/** Frozen set of every valid {@link WidgetType}. */
export const WIDGET_TYPES = [
  'simulation',
  'diagram',
  'code',
  'game',
  'visualization3d',
  'procedural-skill',
] as const satisfies readonly WidgetType[];

// Compile-time check that WIDGET_TYPES covers every WidgetType member.
type _WidgetTypesExhaustive = [WidgetType] extends [(typeof WIDGET_TYPES)[number]] ? true : never;
const _widgetTypesExhaustive: _WidgetTypesExhaustive = true;
void _widgetTypesExhaustive;

/** Narrow an unknown value to a valid {@link WidgetType}. */
export function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === 'string' && (WIDGET_TYPES as readonly string[]).includes(value);
}

/** Minimal contract shared by every widget config; other members are app-domain-defined. */
export interface WidgetConfigBase {
  type: WidgetType;
  [key: string]: unknown;
}

/**
 * Interactive web content. `html` is a full document rendered via iframe
 * `srcDoc`; `url` is a `src` fallback used only when `html` is absent.
 * Validators require at least one of the two; the generated schema does not
 * express that disjunction.
 */
export type InteractiveContent<TWidgetConfig extends WidgetConfigBase = WidgetConfigBase> = {
  type: 'interactive';
  url?: string;
  html?: string;
  widgetType?: WidgetType;
  widgetConfig?: TWidgetConfig;
};

/** Cheap structural guard for {@link InteractiveContent}. */
export function isInteractiveContent(value: unknown): value is InteractiveContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const content = value as Record<string, unknown>;
  if (content.type !== 'interactive') return false;
  if (typeof content.html !== 'string' && typeof content.url !== 'string') return false;
  if (content.url !== undefined && typeof content.url !== 'string') return false;
  if (content.html !== undefined && typeof content.html !== 'string') return false;
  if (content.widgetType !== undefined && !isWidgetType(content.widgetType)) return false;
  if (content.widgetConfig !== undefined) {
    if (
      typeof content.widgetConfig !== 'object' ||
      content.widgetConfig === null ||
      Array.isArray(content.widgetConfig)
    )
      return false;
    if (!isWidgetType((content.widgetConfig as Record<string, unknown>).type)) return false;
  }
  return true;
}
