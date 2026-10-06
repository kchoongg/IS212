// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font is resolved by the Next.js compiler, which is not running here.
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-local" }) }));
vi.mock("next/font/google", () => ({ Source_Serif_4: () => ({ variable: "font-display" }) }));

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

  it("declares the page language and loads both typefaces", () => {
    const doc = page();

    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(doc.documentElement.className).toContain("font-local");
    expect(doc.documentElement.className).toContain("font-display");
  });

  it("puts a 'Skip to content' link first, pointing at the page content", () => {
    const doc = page();

    const first = doc.body.firstElementChild as HTMLAnchorElement;

    expect(first.textContent).toBe("Skip to content");
    expect(first.getAttribute("href")).toBe("#main");
    expect(doc.getElementById("main")!.textContent).toBe("page content");
  });

  it("wraps every page in the app shell", () => {
    const doc = page();

    expect(doc.querySelector("header")!.textContent).toContain("ConnectSphere");
    expect(doc.querySelector("main")!.contains(doc.getElementById("main"))).toBe(true);
  });

  it("titles the site", () => {
    expect(metadata.title).toBe("ConnectSphere");
  });
});
