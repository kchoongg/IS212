// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font is resolved by the Next.js compiler, which is not running here.
// Each face hands back its own CSS variable, so the test can tell them apart.
vi.mock("next/font/local", () => ({ default: (options: { variable: string }) => ({ variable: options.variable }) }));

import RootLayout, { metadata } from "@/app/layout";
import { setRoute } from "@/test/ui";

describe("Root layout", () => {
  // Rendered to a string and parsed: a whole <html> document cannot be mounted
  // inside the test page's own <body>. The result is a separate document, so
  // these read plain DOM properties rather than using the jest-dom matchers.
  function page() {
    setRoute("/dashboard");
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>page content</p>
      </RootLayout>
    );
    return new DOMParser().parseFromString(html, "text/html");
  }

  it("[SPM-7] declares the page language and loads both typefaces", () => {
    const doc = page();

    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    for (const face of ["--font-geist-sans", "--font-geist-mono", "--font-display"]) {
      expect(doc.documentElement.className).toContain(face);
    }
  });

  it("[SPM-7] puts a 'Skip to content' link first, pointing at the page content", () => {
    const doc = page();

    const first = doc.body.firstElementChild as HTMLAnchorElement;

    expect(first.textContent).toBe("Skip to content");
    expect(first.getAttribute("href")).toBe("#main");
    expect(doc.getElementById("main")!.textContent).toBe("page content");
  });

  it("[SPM-7][AC3] wraps every page in the app shell", () => {
    const doc = page();

    expect(doc.querySelector("header")!.textContent).toContain("ConnectSphere");
    expect(doc.querySelector("main")!.contains(doc.getElementById("main"))).toBe(true);
  });

  it("[SPM-7] titles the site", () => {
    expect(metadata.title).toBe("ConnectSphere");
  });
});
