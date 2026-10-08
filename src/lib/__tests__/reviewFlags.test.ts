import { describe, it, expect } from "vitest";
import { addReviewReasons } from "@/lib/reviewFlags";

describe("addReviewReasons", () => {
  it("starts a list when nothing is flagged yet", () => {
    expect(addReviewReasons(null, ["event_schedule_changed"])).toBe("event_schedule_changed");
    expect(addReviewReasons("", ["venue_retired"])).toBe("venue_retired");
  });

  it("keeps every code already there, including ones the caller does not know", () => {
    expect(addReviewReasons("venue_retired,some_future_code", ["event_schedule_changed"])).toBe(
      "venue_retired,some_future_code,event_schedule_changed"
    );
  });

  it("adds each code once", () => {
    expect(addReviewReasons("venue_retired", ["venue_retired", "layout_removed", "layout_removed"])).toBe(
      "venue_retired,layout_removed"
    );
  });

  it("ignores blanks and spaces in the stored value", () => {
    expect(addReviewReasons(" venue_retired, ,layout_removed ", [])).toBe("venue_retired,layout_removed");
  });
});
