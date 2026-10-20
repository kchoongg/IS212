import { describe, it, expect } from "vitest";
import { addReviewReasons } from "@/lib/reviewFlags";

describe("addReviewReasons", () => {
  it("[SPM-39][AC7] starts a list when nothing is flagged yet", () => {
    expect(addReviewReasons(null, ["event_schedule_changed"])).toBe("event_schedule_changed");
    expect(addReviewReasons("", ["venue_retired"])).toBe("venue_retired");
  });

  it("[SPM-39][AC7] keeps every code already there, including ones the caller does not know", () => {
    expect(addReviewReasons("venue_retired,some_future_code", ["event_schedule_changed"])).toBe(
      "venue_retired,some_future_code,event_schedule_changed"
    );
  });

  it("[SPM-39][AC7] adds each code once", () => {
    expect(addReviewReasons("venue_retired", ["venue_retired", "layout_removed", "layout_removed"])).toBe(
      "venue_retired,layout_removed"
    );
  });

  it("[SPM-39][AC7] ignores blanks and spaces in the stored value", () => {
    expect(addReviewReasons(" venue_retired, ,layout_removed ", [])).toBe("venue_retired,layout_removed");
  });
});
