// Runs before every test file (vitest.config.mts `setupFiles`). Only does
// anything for UI tests - the ones that opt into a browser-like environment
// with `// @vitest-environment jsdom` on their first line.

import { afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  const { resetNavigation } = await import("./navigation");

  afterEach(() => {
    cleanup();
    resetNavigation();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // jsdom has no layout, so it does not implement these. Screens only call
  // them as a courtesy after an error.
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

  // jsdom cannot load another page. Following a link would only print "Not
  // implemented: navigation", so cancel the browser's part of the click. The
  // component's own click handlers still run, which is what a test checks.
  // Capture phase, so a handler that stops propagation cannot skip this.
  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) event.preventDefault();
    },
    true
  );

  // <dialog>: open/close without the top layer, which is all a test needs.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
