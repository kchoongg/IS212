import { describe, it, expect } from "vitest";
import {
  REQUEST_TIME_MESSAGES,
  checkRequestTimes,
  checkVenueBookingRequest,
  coversSchedule,
  defaultTimes,
  openingHoursMessage,
  requestedWindow,
  setupAndTurnaround,
  type BookingRequestInput,
} from "../venueBookingRequest";

// SPM-42 (Request Venue Booking), as changed by SPM-93 (Book Venues in
// 15-Minute Units): a request is a date, a start time and an end time on a
// 15-minute grid, and the venue's setup and turnaround minutes are added
// around it (Week 7 Customer Changes, Change #1). The numbers are SPM93
// Studio's: open 07:00-22:00, 30 min setup, 45 min turnaround.
//
// Written with an explicit +08:00 so each case reads as the time a user sees.

const sgt = (iso: string) => new Date(`${iso}+08:00`);
const at = (from: string, to: string) => ({ startsAt: sgt(from), endsAt: sgt(to) });

describe("requestedWindow", () => {
  it("[SPM-93][AC1] SPM-93-TC01: turns a date and two times into the stored window", () => {
    expect(requestedWindow("2027-06-09", "14:00", "16:00")).toEqual(at("2027-06-09T14:00:00", "2027-06-09T16:00:00"));
  });

  it("[SPM-93][AC1] is null when a time cannot be read", () => {
    expect(requestedWindow("2027-06-09", "", "16:00")).toBeNull();
    expect(requestedWindow("2027-06-09", "14:00", "4pm")).toBeNull();
    expect(requestedWindow("2027-02-31", "14:00", "16:00")).toBeNull();
  });
});

// AC2: the form starts on the event's (or session's) own times, widened to the grid.
describe("defaultTimes", () => {
  it("[SPM-93][AC2] SPM-93-TC01: an off-grid event is widened outwards", () => {
    expect(defaultTimes(at("2027-06-09T14:10:00", "2027-06-09T15:50:00"))).toEqual({
      day: "2027-06-09",
      startTime: "14:00",
      endTime: "16:00",
    });
  });

  it("[SPM-93][AC2] SPM-93-TC02: a session already on the grid is unchanged", () => {
    expect(defaultTimes(at("2027-06-18T14:00:00", "2027-06-18T17:30:00"))).toEqual({
      day: "2027-06-18",
      startTime: "14:00",
      endTime: "17:30",
    });
  });

  it("[SPM-93][AC2] returns null for a schedule running over more than one day", () => {
    expect(defaultTimes(at("2027-06-17T09:05:00", "2027-06-18T17:30:00"))).toBeNull();
  });

  it("[SPM-93][AC2] returns null for a schedule ending at midnight, which a time field cannot hold", () => {
    expect(defaultTimes(at("2027-06-17T20:00:00", "2027-06-18T00:00:00"))).toBeNull();
  });
});

// AC3: an off-grid time, or an end not after the start, is refused and named.
describe("checkRequestTimes", () => {
  it("[SPM-93][AC3] accepts times on the grid with the end after the start", () => {
    expect(checkRequestTimes({ startTime: "10:00", endTime: "12:15" })).toEqual({});
  });

  it("[SPM-93][AC3] SPM-93-TC03: names an off-grid start time", () => {
    expect(checkRequestTimes({ startTime: "10:10", endTime: "12:00" })).toEqual({
      startTime: "Choose a start time on a 15-minute step (:00, :15, :30 or :45).",
    });
  });

  it("[SPM-93][AC3] SPM-93-TC03: names an off-grid end time", () => {
    expect(checkRequestTimes({ startTime: "10:00", endTime: "12:20" })).toEqual({
      endTime: "Choose an end time on a 15-minute step (:00, :15, :30 or :45).",
    });
  });

  it("[SPM-93][AC3] names both when both are off the grid", () => {
    expect(checkRequestTimes({ startTime: "10:10", endTime: "12:20" })).toEqual({
      startTime: REQUEST_TIME_MESSAGES.startOffGrid,
      endTime: REQUEST_TIME_MESSAGES.endOffGrid,
    });
  });

  it.each([
    ["equal to the start", "10:00"],
    ["before the start", "09:45"],
  ])("[SPM-93][AC3] SPM-93-TC03: refuses an end %s", (_, endTime) => {
    expect(checkRequestTimes({ startTime: "10:00", endTime })).toEqual({
      endTime: "The end time must be after the start time.",
    });
  });

  it("[SPM-93][AC3] treats an empty or unreadable time as off the grid", () => {
    expect(checkRequestTimes({ startTime: "", endTime: "noon" })).toEqual({
      startTime: REQUEST_TIME_MESSAGES.startOffGrid,
      endTime: REQUEST_TIME_MESSAGES.endOffGrid,
    });
  });
});

describe("coversSchedule", () => {
  const workshop = at("2027-06-11T10:00:00", "2027-06-11T12:00:00");

  it("[SPM-93][AC3] accepts exactly the schedule's times, or wider", () => {
    expect(coversSchedule(workshop, workshop)).toBe(true);
    expect(coversSchedule(at("2027-06-11T09:45:00", "2027-06-11T12:15:00"), workshop)).toBe(true);
  });

  it("[SPM-93][AC3] SPM-93-TC04: refuses a request starting after the schedule starts", () => {
    expect(coversSchedule(at("2027-06-11T10:30:00", "2027-06-11T12:00:00"), workshop)).toBe(false);
  });

  it("[SPM-93][AC3] refuses a request ending before the schedule ends", () => {
    expect(coversSchedule(at("2027-06-11T10:00:00", "2027-06-11T11:45:00"), workshop)).toBe(false);
  });
});

describe("openingHoursMessage", () => {
  it("[SPM-93][AC4][AC6] SPM-93-TC06: gives the earliest start and latest end once setup and turnaround are allowed for", () => {
    expect(openingHoursMessage({ name: "SPM93 Studio", opensAt: "07:00", closesAt: "22:00", setupMinutes: 30, teardownMinutes: 45 })).toBe(
      "SPM93 Studio is open 07:00–22:00. With its 30 min setup and 45 min turnaround, choose times between 07:30 and 21:15."
    );
  });

  it("[SPM-93][AC4][AC6] leaves out setup and turnaround for a venue that needs none", () => {
    expect(openingHoursMessage({ name: "SPM93 Quick Room", opensAt: "07:00", closesAt: "22:00", setupMinutes: 0, teardownMinutes: 0 })).toBe(
      "SPM93 Quick Room is open 07:00–22:00. Choose times between 07:00 and 22:00."
    );
  });

  it("[SPM-93][AC4][AC6] offers the whole day when the venue's hours cannot be read", () => {
    expect(openingHoursMessage({ name: "SPM93 Quick Room", opensAt: "", closesAt: "late", setupMinutes: 0, teardownMinutes: 0 })).toBe(
      "SPM93 Quick Room is open –late. Choose times between 00:00 and 24:00."
    );
  });
});

describe("checkVenueBookingRequest", () => {
  // SPM93 Validation Workshop at SPM93 Studio: 11 Jun 2027 10:00-12:00, no sessions.
  const base: BookingRequestInput = {
    eventId: "workshop",
    sessionId: null,
    eventStatus: "planning",
    holder: { kind: "event", name: "SPM93 Validation Workshop" },
    schedule: at("2027-06-11T10:00:00", "2027-06-11T12:00:00"),
    needs: { expectedAttendance: 30, preferredLayout: "theatre", requirements: [] },
    venue: {
      name: "SPM93 Studio",
      building: "Orchard Hub",
      opensAt: "07:00",
      closesAt: "22:00",
      setupMinutes: 30,
      teardownMinutes: 45,
      layouts: [{ layoutName: "theatre", capacity: 60 }],
      facilityIds: [],
      bookings: [],
      unavailability: [],
    },
    day: "2027-06-11",
    startTime: "10:00",
    endTime: "12:00",
  };
  const withBooking = (status: string, from: string, to: string): BookingRequestInput => ({
    ...base,
    venue: { ...base.venue, bookings: [{ eventId: "other", status, ...at(from, to) }] },
  });

  it("[SPM-93][AC1] SPM-93-TC01: a suitable, free venue is accepted, storing the requested times only", () => {
    expect(checkVenueBookingRequest(base)).toEqual({ ok: true, window: at("2027-06-11T10:00:00", "2027-06-11T12:00:00") });
  });

  it("[SPM-93][AC3] SPM-93-TC03: an off-grid start time is refused and named", () => {
    expect(checkVenueBookingRequest({ ...base, startTime: "10:10" })).toEqual({
      ok: false,
      error: REQUEST_TIME_MESSAGES.startOffGrid,
      field: "startTime",
    });
  });

  it("[SPM-93][AC3] SPM-93-TC03: an end not after the start is refused and named", () => {
    expect(checkVenueBookingRequest({ ...base, endTime: "10:00" })).toEqual({
      ok: false,
      error: REQUEST_TIME_MESSAGES.endNotAfterStart,
      field: "endTime",
    });
  });

  it("[SPM-93][AC3] SPM-93-TC04: times that do not cover the event's own time are refused", () => {
    expect(checkVenueBookingRequest({ ...base, startTime: "10:30" })).toEqual({
      ok: false,
      error: "The requested times do not cover the event's time (11 Jun 2027, 10:00–12:00).",
    });
  });

  it("[SPM-42][AC4] a session is checked against the session's own time", () => {
    const result = checkVenueBookingRequest({
      ...base,
      holder: { kind: "session", name: "Day 2" },
      schedule: at("2027-06-12T14:00:00", "2027-06-12T17:30:00"),
    });
    expect(result).toEqual({
      ok: false,
      error: "The requested times do not cover the session's time (12 Jun 2027, 14:00–17:30).",
    });
  });

  describe("opening hours (AC4)", () => {
    const breakfast: BookingRequestInput = { ...base, schedule: at("2027-06-13T07:30:00", "2027-06-13T09:00:00"), day: "2027-06-13" };
    const forum: BookingRequestInput = { ...base, schedule: at("2027-06-13T20:00:00", "2027-06-13T21:15:00"), day: "2027-06-13" };
    const refusal = { ok: false, error: openingHoursMessage(base.venue) };

    it("[SPM-93][AC4][AC6] SPM-93-TC06: setup may start exactly at opening time", () => {
      expect(checkVenueBookingRequest({ ...breakfast, startTime: "07:30", endTime: "09:00" }).ok).toBe(true);
    });

    it("[SPM-93][AC4][AC6] SPM-93-TC06: setup may not start before opening time", () => {
      expect(checkVenueBookingRequest({ ...breakfast, startTime: "07:15", endTime: "09:00" })).toEqual(refusal);
    });

    it("[SPM-93][AC4][AC6] SPM-93-TC06: turnaround may end exactly at closing time", () => {
      expect(checkVenueBookingRequest({ ...forum, startTime: "20:00", endTime: "21:15" }).ok).toBe(true);
    });

    it("[SPM-93][AC4][AC6] SPM-93-TC06: turnaround may not end after closing time", () => {
      expect(checkVenueBookingRequest({ ...forum, startTime: "20:00", endTime: "21:30" })).toEqual(refusal);
    });

    it("[SPM-93][AC4] SPM-93-TC05: the old lunch and dinner gaps can be booked", () => {
      const quickRoom = { ...base.venue, setupMinutes: 0, teardownMinutes: 0 };
      const lunch = { ...base, venue: quickRoom, schedule: at("2027-06-14T12:00:00", "2027-06-14T13:00:00"), day: "2027-06-14" };
      expect(checkVenueBookingRequest({ ...lunch, startTime: "12:00", endTime: "13:00" }).ok).toBe(true);
      const sunset = { ...lunch, schedule: at("2027-06-14T18:00:00", "2027-06-14T19:00:00") };
      expect(checkVenueBookingRequest({ ...sunset, startTime: "18:00", endTime: "19:00" }).ok).toBe(true);
    });
  });

  it("[SPM-42][AC1] [SPM-41][AC5] an unsuitable venue is refused with the reason", () => {
    const result = checkVenueBookingRequest({ ...base, needs: { ...base.needs, expectedAttendance: 200 } });
    expect(result).toEqual({
      ok: false,
      error: "SPM93 Studio is not suitable for this space: Theatre capacity is 60 - this space expects 200.",
    });
  });

  it("[SPM-41] an incomplete check (no attendance or layout yet) does not block", () => {
    const result = checkVenueBookingRequest({ ...base, needs: { expectedAttendance: null, preferredLayout: null, requirements: [] } });
    expect(result.ok).toBe(true);
  });

  it("[SPM-42] a completed, cancelled or rejected event is refused", () => {
    for (const status of ["completed", "cancelled", "rejected"]) {
      expect(checkVenueBookingRequest({ ...base, eventStatus: status })).toEqual({
        ok: false,
        error: "A venue cannot be requested for a completed, cancelled or rejected event.",
      });
    }
    for (const status of ["approved", "planning", "confirmed", "postponed"]) {
      expect(checkVenueBookingRequest({ ...base, eventStatus: status }).ok).toBe(true);
    }
  });

  it("[SPM-54][AC2] SPM-54-TC10: a request that has not been approved yet is refused", () => {
    for (const status of ["submitted", "under_review"]) {
      expect(checkVenueBookingRequest({ ...base, eventStatus: status })).toEqual({
        ok: false,
        error: "A venue can be requested once this request has been approved.",
      });
    }
  });

  describe("conflicts include setup and turnaround (AC6, AC7)", () => {
    // SPM93 Morning Masterclass: 8 Jun 10:00-12:00, so the room is in use 09:30-12:45.
    const huddle: BookingRequestInput = { ...base, schedule: at("2027-06-08T08:15:00", "2027-06-08T08:45:00"), day: "2027-06-08" };
    const review: BookingRequestInput = { ...base, schedule: at("2027-06-08T13:15:00", "2027-06-08T14:00:00"), day: "2027-06-08" };
    const masterclass = [
      { eventId: "masterclass", status: "approved", eventReference: "EVT-000101", eventTitle: "SPM93 Morning Masterclass", ...at("2027-06-08T10:00:00", "2027-06-08T12:00:00") },
    ];
    const booked = (from: string, to: string) => ({
      ok: false,
      error: `SPM93 Studio is already booked for EVT-000101 SPM93 Morning Masterclass on 8 Jun 2027, ${from}–${to}.`,
    });

    it("[SPM-93][AC6][AC7] [SPM-44][AC4][AC5] SPM-93-TC09: refused when its turnaround runs into the approved booking's setup", () => {
      const request = { ...huddle, venue: { ...base.venue, bookings: masterclass }, startTime: "08:15", endTime: "09:00" };
      expect(checkVenueBookingRequest(request)).toEqual(booked("09:30", "09:45"));
    });

    it("[SPM-93][AC6][AC7] [SPM-44][AC4][AC5] SPM-93-TC09: accepted when its turnaround ends as the approved booking's setup starts", () => {
      const request = { ...huddle, venue: { ...base.venue, bookings: masterclass }, startTime: "08:15", endTime: "08:45" };
      expect(checkVenueBookingRequest(request).ok).toBe(true);
    });

    it("[SPM-93][AC6][AC7] [SPM-44][AC4][AC5] SPM-93-TC10: refused when its setup runs into the approved booking's turnaround", () => {
      const request = { ...review, venue: { ...base.venue, bookings: masterclass }, startTime: "13:00", endTime: "14:00" };
      expect(checkVenueBookingRequest(request)).toEqual(booked("12:30", "12:45"));
    });

    it("[SPM-93][AC6][AC7] [SPM-44][AC4][AC5] SPM-93-TC10: accepted when its setup starts as the approved booking's turnaround ends", () => {
      const request = { ...review, venue: { ...base.venue, bookings: masterclass }, startTime: "13:15", endTime: "14:00" };
      expect(checkVenueBookingRequest(request).ok).toBe(true);
    });

    it("[SPM-93][AC6][AC7] [SPM-44][AC4][AC5] SPM-93-TC08: at a venue with no setup or turnaround, a request may start as another booking ends", () => {
      const quickRoom = { ...base.venue, setupMinutes: 0, teardownMinutes: 0, bookings: masterclass };
      const followOn = { ...base, venue: quickRoom, schedule: at("2027-06-08T12:00:00", "2027-06-08T13:00:00"), day: "2027-06-08" };
      expect(checkVenueBookingRequest({ ...followOn, startTime: "12:00", endTime: "13:00" }).ok).toBe(true);
      expect(checkVenueBookingRequest({ ...followOn, startTime: "11:45", endTime: "13:00" })).toEqual(booked("11:45", "12:00"));
    });

    // SPM93 Partner Lunch, pending: 10 Jun 12:00-13:00, held 11:30-13:45.
    const teamSync: BookingRequestInput = { ...base, schedule: at("2027-06-10T14:15:00", "2027-06-10T15:00:00"), day: "2027-06-10" };
    const partnerLunch = [
      { eventId: "lunch", status: "pending", eventReference: "EVT-000102", eventTitle: "SPM93 Partner Lunch", ...at("2027-06-10T12:00:00", "2027-06-10T13:00:00") },
    ];

    it("[SPM-93][AC6][AC7] [SPM-44][AC4][AC5] SPM-93-TC11: a pending hold also holds its setup and turnaround", () => {
      const request = { ...teamSync, venue: { ...base.venue, bookings: partnerLunch }, startTime: "14:00", endTime: "15:00" };
      expect(checkVenueBookingRequest(request)).toEqual({
        ok: false,
        error: "SPM93 Studio is on hold for EVT-000102 SPM93 Partner Lunch on 10 Jun 2027, 13:30–13:45.",
      });
    });

    it("[SPM-93][AC6][AC7] [SPM-44][AC4][AC5] SPM-93-TC11: accepted when its setup starts as the hold's turnaround ends", () => {
      const request = { ...teamSync, venue: { ...base.venue, bookings: partnerLunch }, startTime: "14:15", endTime: "15:00" };
      expect(checkVenueBookingRequest(request).ok).toBe(true);
    });

    // Maintenance on 16 Jun 14:00-18:00.
    const twilight: BookingRequestInput = {
      ...base,
      schedule: at("2027-06-16T18:30:00", "2027-06-16T20:00:00"),
      day: "2027-06-16",
      venue: { ...base.venue, unavailability: [{ reason: "maintenance", ...at("2027-06-16T14:00:00", "2027-06-16T18:00:00") }] },
    };

    it("[SPM-93][AC6][AC7] [SPM-44][AC8] SPM-93-TC12: refused when its setup runs into an unavailable period", () => {
      expect(checkVenueBookingRequest({ ...twilight, startTime: "18:15", endTime: "20:00" })).toEqual({
        ok: false,
        error: "SPM93 Studio is unavailable at this time (maintenance, 16 Jun 2027, 14:00–18:00).",
      });
    });

    it("[SPM-93][AC6][AC7] [SPM-44][AC8] SPM-93-TC12: accepted when its setup starts as the unavailable period ends", () => {
      expect(checkVenueBookingRequest({ ...twilight, startTime: "18:30", endTime: "20:00" }).ok).toBe(true);
    });

    it("[SPM-44][AC7] cancelled and rejected bookings do not block", () => {
      for (const status of ["cancelled", "rejected"]) {
        expect(checkVenueBookingRequest(withBooking(status, "2027-06-11T10:00:00", "2027-06-11T12:00:00")).ok).toBe(true);
      }
    });

    // SPM-81 AC4: the event's own booking is not a clash with another event,
    // but it is a repeat, whichever session holds it.
    it("[SPM-44][AC4] [SPM-81][AC4] the event's own booking for another session is refused as a repeat, not as a clash", () => {
      const own = { ...base, venue: { ...base.venue, bookings: [{ eventId: "workshop", sessionId: "day-2", status: "approved", ...at("2027-06-11T10:00:00", "2027-06-11T12:00:00") }] } };
      expect(checkVenueBookingRequest(own)).toMatchObject({ ok: false, error: expect.stringContaining("This event already has") });
    });
  });
});

// SPM-44 AC4, raised in review on PR #37: the event's own bookings are exempt
// from the clash check, so a repeat has to be caught separately.
describe("a repeat of the same request (SPM-44 AC4)", () => {
  const base: BookingRequestInput = {
    eventId: "workshop",
    sessionId: null,
    eventStatus: "planning",
    holder: { kind: "event", name: "SPM93 Validation Workshop" },
    schedule: at("2027-06-11T10:00:00", "2027-06-11T12:00:00"),
    needs: { expectedAttendance: 30, preferredLayout: "theatre", requirements: [] },
    venue: {
      name: "SPM93 Studio",
      building: "Orchard Hub",
      opensAt: "07:00",
      closesAt: "22:00",
      setupMinutes: 30,
      teardownMinutes: 45,
      layouts: [{ layoutName: "theatre", capacity: 60 }],
      facilityIds: [],
      bookings: [],
      unavailability: [],
    },
    day: "2027-06-11",
    startTime: "10:00",
    endTime: "12:00",
  };
  const own = (status: string, from: string, to: string, sessionId: string | null = null) => ({
    eventId: "workshop", sessionId, status, ...at(`2027-06-11T${from}:00`, `2027-06-11T${to}:00`),
  });
  const holding = (...bookings: BookingRequestInput["venue"]["bookings"]): BookingRequestInput => ({
    ...base,
    venue: { ...base.venue, bookings },
  });

  it("[SPM-44][AC4] [SPM-81][AC4] refuses the same event asking again while its request is pending", () => {
    expect(checkVenueBookingRequest(holding(own("pending", "10:00", "12:00")))).toEqual({
      ok: false,
      error: "This event already has a pending request for SPM93 Studio on 11 Jun 2027, 10:00–12:00.",
    });
  });

  it("[SPM-44][AC4] [SPM-81][AC4] refuses it once the first request is approved, worded as a booking", () => {
    expect(checkVenueBookingRequest(holding(own("approved", "10:00", "12:00")))).toEqual({
      ok: false,
      error: "This event already has SPM93 Studio booked on 11 Jun 2027, 10:00–12:00.",
    });
  });

  it("[SPM-44][AC4] [SPM-81][AC4] boundary: a quarter-hour in common is enough to make it a repeat", () => {
    expect(checkVenueBookingRequest(holding(own("pending", "11:45", "13:00"))).ok).toBe(false);
  });

  it("[SPM-44][AC4] [SPM-81][AC4] boundary: the same event's request ending as this one starts is not a repeat", () => {
    expect(checkVenueBookingRequest({ ...holding(own("pending", "09:00", "10:00")), schedule: at("2027-06-11T10:00:00", "2027-06-11T12:00:00") }).ok).toBe(true);
  });

  it("[SPM-44][AC4] [SPM-81][AC4] does not count a cancelled or rejected earlier request", () => {
    for (const status of ["cancelled", "rejected"]) {
      expect(checkVenueBookingRequest(holding(own(status, "10:00", "12:00"))).ok).toBe(true);
    }
  });

  // SPM-81 AC4 (decided 2026-10-10): per event, not per session. The refusal
  // says "This event", because it is another session that holds the room.
  it("[SPM-81][AC4] SPM-81-TC09: refuses another session of the same event asking for the room at overlapping times", () => {
    const input = holding(own("pending", "10:00", "12:00", "day-1"));
    expect(checkVenueBookingRequest({ ...input, sessionId: "day-2", holder: { kind: "session", name: "Day 2" } })).toEqual({
      ok: false,
      error: "This event already has a pending request for SPM93 Studio on 11 Jun 2027, 10:00–12:00.",
    });
  });

  it("[SPM-81][AC4] SPM-81-TC09: lets another session of the same event take the room as the first one ends", () => {
    const input = holding(own("pending", "09:00", "10:00", "day-1"));
    expect(checkVenueBookingRequest({ ...input, sessionId: "day-2", holder: { kind: "session", name: "Day 2" } }).ok).toBe(true);
  });

  it("[SPM-44][AC4] [SPM-81][AC4] refuses the same session asking twice, naming the session", () => {
    const input = holding(own("pending", "10:00", "12:00", "day-1"));
    expect(checkVenueBookingRequest({ ...input, sessionId: "day-1", holder: { kind: "session", name: "Day 1" } })).toEqual({
      ok: false,
      error: "Day 1 already has a pending request for SPM93 Studio on 11 Jun 2027, 10:00–12:00.",
    });
  });
});

// AC6 on screen: the request form and Venue Staff's card show the times setup
// and turnaround take, and the whole room-in-use period.
describe("setupAndTurnaround", () => {
  it("[SPM-93][AC6] SPM-93-TC01: 30 min setup and 45 min turnaround around 14:00-16:00", () => {
    expect(setupAndTurnaround(at("2027-06-09T14:00:00", "2027-06-09T16:00:00"), { setupMinutes: 30, teardownMinutes: 45 })).toEqual({
      setup: at("2027-06-09T13:30:00", "2027-06-09T14:00:00"),
      turnaround: at("2027-06-09T16:00:00", "2027-06-09T16:45:00"),
      occupied: at("2027-06-09T13:30:00", "2027-06-09T16:45:00"),
    });
  });

  it("[SPM-93][AC6] SPM-93-TC08: a venue with no setup or turnaround has neither, and is in use for the booked times", () => {
    expect(setupAndTurnaround(at("2027-06-08T12:00:00", "2027-06-08T13:00:00"), { setupMinutes: 0, teardownMinutes: 0 })).toEqual({
      setup: null,
      turnaround: null,
      occupied: at("2027-06-08T12:00:00", "2027-06-08T13:00:00"),
    });
  });

  it("[SPM-93][AC6] a venue with setup only has no turnaround", () => {
    const holds = setupAndTurnaround(at("2027-06-08T12:00:00", "2027-06-08T13:00:00"), { setupMinutes: 15, teardownMinutes: 0 });
    expect(holds.setup).toEqual(at("2027-06-08T11:45:00", "2027-06-08T12:00:00"));
    expect(holds.turnaround).toBeNull();
  });
});
