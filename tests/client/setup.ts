import { vi, beforeEach } from "vitest";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class MockIntersectionObserver {
  root = null;
  rootMargin = "";
  thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

(globalThis as any).ResizeObserver = MockResizeObserver;
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

if (typeof window !== "undefined") {
  (window as any).ResizeObserver = MockResizeObserver;
  (window as any).IntersectionObserver = MockIntersectionObserver;

  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  if (!window.scrollTo) {
    (window as any).scrollTo = () => {};
  }

  if (!(window as any).PointerEvent) {
    (window as any).PointerEvent = class PointerEvent extends Event {} as any;
  }

  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
  (Element.prototype as any).hasPointerCapture =
    (Element.prototype as any).hasPointerCapture || (() => false);
  (Element.prototype as any).releasePointerCapture =
    (Element.prototype as any).releasePointerCapture || (() => {});
  (Element.prototype as any).setPointerCapture =
    (Element.prototype as any).setPointerCapture || (() => {});
}

function emptyResponse(): Response {
  return new Response("[]", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  (globalThis as any).fetch = vi.fn(async () => emptyResponse());
});
