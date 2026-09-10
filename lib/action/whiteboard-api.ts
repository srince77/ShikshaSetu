/**
 * Whiteboard CRUD used by ActionEngine's `wb_*` handlers. Ported from the
 * reference app's larger Stage API (which also covers scene/element authoring
 * and server persistence, out of scope for this phase) down to just the
 * whiteboard namespace, operating on `useCourseStore`'s `stage.whiteboard`
 * array.
 */
import type { PPTElement, Whiteboard } from '@shikshasetu/dsl';
import type { CourseState } from '@/lib/store/course';

export interface APIResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Minimal Zustand-store shape this module needs (matches useCourseStore). */
export interface CourseStore {
  getState: () => CourseState;
  setState: (partial: Partial<CourseState>) => void;
}

function generateId(prefix?: string): string {
  const id = crypto.randomUUID().slice(0, 10);
  return prefix ? `${prefix}_${id}` : id;
}

export function createWhiteboardAPI(store: CourseStore) {
  const whiteboardAPI = {
    create(): APIResult<Whiteboard> {
      try {
        const state = store.getState();
        const whiteboard: Whiteboard = {
          id: generateId('whiteboard'),
          viewportSize: 1000,
          // viewportRatio is height/width, so a 16:9 landscape sheet is 9/16.
          viewportRatio: 9 / 16,
          elements: [],
          background: { type: 'solid', color: '#ffffff' },
          animations: [],
        };
        const whiteboardList = state.stage?.whiteboard
          ? [...state.stage.whiteboard, whiteboard]
          : [whiteboard];
        store.setState({
          stage: state.stage ? { ...state.stage, whiteboard: whiteboardList } : state.stage,
        });
        return { success: true, data: whiteboard };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    get(): APIResult<Whiteboard> {
      try {
        const state = store.getState();
        if (!state.stage?.whiteboard || state.stage.whiteboard.length === 0) {
          return whiteboardAPI.create();
        }
        return { success: true, data: state.stage.whiteboard.at(-1) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    update(updates: Partial<Whiteboard>, whiteboardId: string): APIResult<boolean> {
      try {
        const state = store.getState();
        const whiteboard = state.stage?.whiteboard?.find((wb) => wb.id === whiteboardId);
        if (!whiteboard || !state.stage) return { success: false, error: 'Whiteboard not found' };
        const newWhiteboard = { ...whiteboard, ...updates };
        const whiteboardList = state.stage.whiteboard!.map((wb) =>
          wb.id === whiteboardId ? newWhiteboard : wb,
        );
        store.setState({ stage: { ...state.stage, whiteboard: whiteboardList } });
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    getElement(elementId: string, whiteboardId: string): APIResult<PPTElement> {
      try {
        const state = store.getState();
        const whiteboard = state.stage?.whiteboard?.find((wb) => wb.id === whiteboardId);
        if (!whiteboard) return { success: false, error: 'Whiteboard not found' };
        return { success: true, data: whiteboard.elements.find((el) => el.id === elementId) };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    addElement(element: PPTElement, whiteboardId: string): APIResult<boolean> {
      try {
        const state = store.getState();
        const whiteboard = state.stage?.whiteboard?.find((wb) => wb.id === whiteboardId);
        if (!whiteboard || !state.stage) return { success: false, error: 'Whiteboard not found' };
        const newElement = { ...element, id: element.id || generateId(element.type) };
        const newWhiteboard = { ...whiteboard, elements: [...whiteboard.elements, newElement] };
        const whiteboardList = state.stage.whiteboard!.map((wb) =>
          wb.id === whiteboardId ? newWhiteboard : wb,
        );
        store.setState({ stage: { ...state.stage, whiteboard: whiteboardList } });
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    deleteElement(elementId: string, whiteboardId: string): APIResult<boolean> {
      try {
        const state = store.getState();
        const whiteboard = state.stage?.whiteboard?.find((wb) => wb.id === whiteboardId);
        if (!whiteboard || !state.stage) return { success: false, error: 'Whiteboard not found' };
        const newWhiteboard = {
          ...whiteboard,
          elements: whiteboard.elements.filter((el) => el.id !== elementId),
        };
        const whiteboardList = state.stage.whiteboard!.map((wb) =>
          wb.id === whiteboardId ? newWhiteboard : wb,
        );
        store.setState({ stage: { ...state.stage, whiteboard: whiteboardList } });
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    updateElement(element: PPTElement, whiteboardId: string): APIResult<boolean> {
      try {
        const state = store.getState();
        const whiteboard = state.stage?.whiteboard?.find((wb) => wb.id === whiteboardId);
        if (!whiteboard || !state.stage) return { success: false, error: 'Whiteboard not found' };
        const newWhiteboard = {
          ...whiteboard,
          elements: whiteboard.elements.map((el) => (el.id === element.id ? element : el)),
        };
        const whiteboardList = state.stage.whiteboard!.map((wb) =>
          wb.id === whiteboardId ? newWhiteboard : wb,
        );
        store.setState({ stage: { ...state.stage, whiteboard: whiteboardList } });
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },

    listElements(whiteboardId: string): APIResult<PPTElement[]> {
      try {
        const state = store.getState();
        const whiteboard = state.stage?.whiteboard?.find((wb) => wb.id === whiteboardId);
        if (!whiteboard) return { success: false, error: 'Whiteboard not found' };
        return { success: true, data: whiteboard.elements };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  };

  return whiteboardAPI;
}

export type WhiteboardAPI = ReturnType<typeof createWhiteboardAPI>;
