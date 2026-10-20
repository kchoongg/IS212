import { describe, it, expect } from "vitest";
import {
  INITIAL,
  MIN_SESSIONS,
  blankSession,
  effectiveStartsAt,
  validateForm,
  toIso,
  toFormValues,
  sessionsPayload,
  availableSessionEquipmentOptions,
  type EventRecord,
  type EquipmentItem,
  type FormValues,
  type SessionRow,
} from "../eventForm";

// SPM-23 - multi-session events (class clarification #74).

const projector = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f10";
const microphone = "8f14e45f-ceea-4e7c-9c2f-1f6a8e4f1f11";
const catalogue: EquipmentItem[] = [
  { id: projector, name: "4K Portable Projector", category: "Display" },
  { id: microphone, name: "Wireless Microphone", category: "Audio" },
];

// Far enough ahead that "start date is in the past" never trips.
const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  ...blankSession(),
  startsAt: "2099-12-05T09:00",
  endsAt: "2099-12-05T17:00",
  expectedAttendance: "300",
  ...over,
});

const multi = (sessions: SessionRow[], over: Partial<FormValues> = {}): FormValues => ({
  ...INITIAL,
  title: "Nusantara Summit",
  category: "conference",
  multiSession: true,
  sessions,
  ...over,
});

describe("validateForm — multi-session, submitting", () => {
  it("[SPM-23][AC6][AC7] passes with two complete sessions and no event-level dates or attendance", () => {
    // Schedule and Attendance are not shown for a multi-session event, so they
    // must not be demanded either.
    const values = multi([session(), session({ startsAt: "2099-12-06T09:00", endsAt: "2099-12-06T17:00" })]);
    expect(validateForm(values, "submit")).toEqual({});
  });

  it("[SPM-23][AC6][AC7] asks for a start, an end and an attendance on each session, keyed to that session", () => {
    const errors = validateForm(multi([session(), blankSession()]), "submit");
    expect(errors["sessions.1.startsAt"]).toBe("Enter when this session starts.");
    expect(errors["sessions.1.endsAt"]).toBe("Enter when this session ends.");
    expect(errors["sessions.1.expectedAttendance"]).toBe("Enter how many people you expect.");
    // Session 1 is fine and must not be flagged.
    expect(Object.keys(errors).some((key) => key.startsWith("sessions.0."))).toBe(false);
  });

  it("[SPM-23][AC6][AC7] does not ask for the event-level fields a multi-session event does not have", () => {
    const errors = validateForm(multi([blankSession(), blankSession()]), "submit");
    expect(errors.startsAt).toBeUndefined();
    expect(errors.endsAt).toBeUndefined();
    expect(errors.expectedAttendance).toBeUndefined();
  });

  it("[SPM-23][AC6][AC7] still asks for the type of event", () => {
    const errors = validateForm(multi([session(), session()], { category: "" }), "submit");
    expect(errors.category).toBe("Choose the type of event.");
  });

  it("[SPM-23][AC6][AC7] rejects a session that ends before it starts", () => {
    const errors = validateForm(
      multi([session(), session({ startsAt: "2099-12-06T17:00", endsAt: "2099-12-06T09:00" })]),
      "submit"
    );
    expect(errors["sessions.1.endsAt"]).toBe("Ends at must be after starts at.");
  });

  it("[SPM-23][AC6][AC7] rejects a session that starts in the past", () => {
    const errors = validateForm(
      multi([session({ startsAt: "2020-01-01T09:00", endsAt: "2020-01-01T17:00" }), session()]),
      "submit"
    );
    expect(errors["sessions.0.startsAt"]).toBe("The start date is in the past.");
  });

  it("[SPM-23][AC6][AC7] rejects an attendance of 0 and a non-integer on a session", () => {
    const zero = validateForm(multi([session({ expectedAttendance: "0" }), session()]), "submit");
    expect(zero["sessions.0.expectedAttendance"]).toBe("Enter a whole number of people, at least 1.");
    const fraction = validateForm(multi([session(), session({ expectedAttendance: "2.5" })]), "submit");
    expect(fraction["sessions.1.expectedAttendance"]).toBe("Enter a whole number of people, at least 1.");
  });

  it("[SPM-23][AC6][AC7] needs at least two sessions", () => {
    const errors = validateForm(multi([session()]), "submit");
    expect(errors.sessions).toBe("Add at least two sessions, or untick multiple sessions.");
    expect(MIN_SESSIONS).toBe(2);
  });

  it("[SPM-23][AC5][AC7] flags an equipment row with no item, and one with a quantity below 1", () => {
    const noItem = validateForm(
      multi([
        session({ equipment: [{ equipmentId: "", quantityRequested: "1", technicalRequirements: "" }] }),
        session(),
      ]),
      "submit"
    );
    expect(noItem["sessions.0.equipment"]).toBe("Choose an item for every equipment row, or remove the empty ones.");

    const zeroQty = validateForm(
      multi([
        session(),
        session({ equipment: [{ equipmentId: projector, quantityRequested: "0", technicalRequirements: "" }] }),
      ]),
      "submit"
    );
    expect(zeroQty["sessions.1.equipment"]).toBe("Every equipment row needs a quantity of at least 1.");
  });

  it("[SPM-23][AC6][AC7] rejects the same item in two sessions (the picker prevents it; this is the check behind it)", () => {
    const row = { equipmentId: projector, quantityRequested: "1", technicalRequirements: "" };
    const errors = validateForm(multi([session({ equipment: [row] }), session({ equipment: [row] })]), "submit");
    expect(errors.sessions).toMatch(/only be requested once per event, across all sessions/);
  });

  it("[SPM-23][AC6][AC7] ignores event-level equipment rows while multi-session is on (they are not sent)", () => {
    const stale = { equipmentId: "", quantityRequested: "0", technicalRequirements: "" };
    const errors = validateForm(multi([session(), session()], { equipment: [stale] }), "submit");
    expect(errors.equipment).toBeUndefined();
  });
});

describe("validateForm — multi-session, saving a draft", () => {
  it("[SPM-24][AC1] [SPM-23][AC6] still needs each session's start and end, because a session cannot be stored without them", () => {
    const errors = validateForm(multi([session(), blankSession()]), "draft");
    expect(errors["sessions.1.startsAt"]).toBe("Enter when this session starts.");
    expect(errors["sessions.1.endsAt"]).toBe("Enter when this session ends.");
  });

  it("[SPM-24][AC1] [SPM-23][AC6] does not need attendance, a type or anything else to save", () => {
    const values = multi(
      [session({ expectedAttendance: "" }), session({ expectedAttendance: "" })],
      { category: "" }
    );
    expect(validateForm(values, "draft")).toEqual({});
  });

  it("[SPM-24][AC1] [SPM-23][AC6] does not reject a start date in the past on a draft", () => {
    const errors = validateForm(
      multi([session({ startsAt: "2020-01-01T09:00", endsAt: "2020-01-01T17:00" }), session()]),
      "draft"
    );
    expect(errors["sessions.0.startsAt"]).toBeUndefined();
  });

  it("[SPM-24][AC1] still only needs the title for an ordinary single-session draft", () => {
    expect(validateForm({ ...INITIAL, title: "Nusantara Summit" }, "draft")).toEqual({});
    // And sessions left over from an earlier ticking are not validated once unticked.
    expect(
      validateForm({ ...INITIAL, title: "Nusantara Summit", sessions: [blankSession()] }, "draft")
    ).toEqual({});
  });
});

describe("validateForm — registration window with sessions", () => {
  const reg = { registrationEnabled: true, registrationCapacity: "300" };
  const sessions = [
    session({ startsAt: "2099-12-05T09:00", endsAt: "2099-12-05T17:00" }),
    session({ startsAt: "2099-12-06T09:00", endsAt: "2099-12-06T17:00" }),
  ];

  it("[SPM-23][AC5][AC6] takes the event's start to be the earliest session", () => {
    expect(effectiveStartsAt(multi(sessions))).toBe("2099-12-05T09:00");
    // Order of entry does not matter.
    expect(effectiveStartsAt(multi([...sessions].reverse()))).toBe("2099-12-05T09:00");
  });

  it("[SPM-23][AC5][AC6] accepts registration that opens before the first session", () => {
    const errors = validateForm(multi(sessions, { ...reg, registrationOpensAt: "2099-11-01T00:00" }), "submit");
    expect(errors.registrationOpensAt).toBeUndefined();
  });

  it("[SPM-23][AC5][AC6] rejects registration that opens between the sessions - the event has already started", () => {
    const errors = validateForm(multi(sessions, { ...reg, registrationOpensAt: "2099-12-05T12:00" }), "submit");
    expect(errors.registrationOpensAt).toBe("Registration must open before the event starts.");
  });

  it("[SPM-23][AC5][AC6] rejects registration that closes between the sessions", () => {
    const errors = validateForm(multi(sessions, { ...reg, registrationClosesAt: "2099-12-05T12:00" }), "submit");
    expect(errors.registrationClosesAt).toBe("Registration must close before the event starts.");
  });
});

describe("validateForm — equipment rows, event level", () => {
  const empty = { equipmentId: "", quantityRequested: "1", technicalRequirements: "" };
  const withDates = { ...INITIAL, title: "Nusantara Summit", startsAt: "2099-12-05T09:00", endsAt: "2099-12-05T17:00" };

  it("[SPM-23][AC5] flags an empty row when SAVING A DRAFT - the server would answer 'Invalid uuid'", () => {
    const errors = validateForm({ ...withDates, equipment: [empty] }, "draft");
    expect(errors.equipment).toBe("Choose an item for every equipment row, or remove the empty ones.");
  });

  it("[SPM-23][AC5] flags a quantity below 1, or not whole, on a draft too", () => {
    for (const quantityRequested of ["0", "", "1.5"]) {
      const errors = validateForm(
        { ...withDates, equipment: [{ ...empty, equipmentId: projector, quantityRequested }] },
        "draft"
      );
      expect(errors.equipment).toBe("Every equipment row needs a quantity of at least 1.");
    }
  });

  it("[SPM-23][AC5] still lets a draft save with no equipment rows, or with complete ones", () => {
    expect(validateForm(withDates, "draft")).toEqual({});
    expect(
      validateForm({ ...withDates, equipment: [{ ...empty, equipmentId: projector, quantityRequested: "2" }] }, "draft")
    ).toEqual({});
  });

  it("[SPM-23][AC5] gives the same message on submit", () => {
    const errors = validateForm({ ...withDates, category: "conference", expectedAttendance: "50", equipment: [empty] }, "submit");
    expect(errors.equipment).toBe("Choose an item for every equipment row, or remove the empty ones.");
  });

  it("[SPM-23][AC5] accepts distinct complete rows on submit", () => {
    const rows = [
      { ...empty, equipmentId: projector, quantityRequested: "2" },
      { ...empty, equipmentId: microphone, quantityRequested: "4" },
    ];
    const errors = validateForm({ ...withDates, category: "conference", expectedAttendance: "50", equipment: rows }, "submit");
    expect(errors.equipment).toBeUndefined();
  });

  it("[SPM-23][AC5] does not check event-level rows while multi-session is on - they are not sent", () => {
    const errors = validateForm(multi([session(), session()], { equipment: [empty] }), "draft");
    expect(errors.equipment).toBeUndefined();
  });

  it("[SPM-23][AC5] checks a session's rows on a draft as well", () => {
    const errors = validateForm(multi([session({ equipment: [empty] }), session()]), "draft");
    expect(errors["sessions.0.equipment"]).toBe("Choose an item for every equipment row, or remove the empty ones.");
  });
});

describe("effectiveStartsAt", () => {
  it("[SPM-23][AC3] is the plain Starts at for an ordinary event", () => {
    expect(effectiveStartsAt({ ...INITIAL, startsAt: "2099-12-05T09:00" })).toBe("2099-12-05T09:00");
  });

  it("[SPM-23][AC3] is empty for a multi-session event whose sessions have no usable start yet", () => {
    expect(effectiveStartsAt(multi([blankSession(), blankSession()]))).toBe("");
  });
});

describe("availableSessionEquipmentOptions", () => {
  const row = (equipmentId: string) => ({ equipmentId, quantityRequested: "1", technicalRequirements: "" });

  it("[SPM-23][AC6] offers everything when nothing has been picked yet", () => {
    const options = availableSessionEquipmentOptions(catalogue, [session(), session()], 0, 0);
    expect(options.map((o) => o.value)).toEqual([projector, microphone]);
    expect(options[0].label).toBe("4K Portable Projector — Display");
  });

  it("[SPM-23][AC6] hides an item another SESSION already has, not just one in the same session", () => {
    const sessions = [session({ equipment: [row(projector)] }), session({ equipment: [row("")] })];
    const options = availableSessionEquipmentOptions(catalogue, sessions, 1, 0);
    expect(options.map((o) => o.value)).toEqual([microphone]);
  });

  it("[SPM-23][AC6] keeps a row's own choice available, so it can be changed or kept", () => {
    const sessions = [session({ equipment: [row(projector)] }), session()];
    const options = availableSessionEquipmentOptions(catalogue, sessions, 0, 0);
    expect(options.map((o) => o.value)).toContain(projector);
  });
});

describe("toFormValues / sessionsPayload — sessions", () => {
  const record: EventRecord = {
    title: "Nusantara Summit",
    category: "conference",
    purpose: null,
    description: null,
    startsAt: "2099-12-05T01:00:00.000Z",
    endsAt: "2099-12-06T09:00:00.000Z",
    expectedAttendance: 300,
    preferredLayout: null,
    accessibilityNotes: null,
    specialRequirements: null,
    registrationEnabled: false,
    registrationCapacity: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    facilityRequirements: [],
    equipmentRequests: [
      { equipmentId: microphone, quantityRequested: 1, technicalRequirements: null, sessionId: null },
      { equipmentId: projector, quantityRequested: 2, technicalRequirements: "HDMI", sessionId: "s1" },
    ],
    sessions: [
      {
        id: "s1",
        label: "Day 1",
        startsAt: "2099-12-05T01:00:00.000Z",
        endsAt: "2099-12-05T09:00:00.000Z",
        expectedAttendance: 300,
        preferredLayout: "theatre",
      },
      {
        id: "s2",
        label: null,
        startsAt: "2099-12-06T01:00:00.000Z",
        endsAt: "2099-12-06T09:00:00.000Z",
        expectedAttendance: null,
        preferredLayout: null,
      },
    ],
  };

  it("[SPM-24][AC3] [SPM-23][AC6] turns multi-session on and fills one card per saved session, in order", () => {
    const values = toFormValues(record);
    expect(values.multiSession).toBe(true);
    expect(values.sessions).toHaveLength(2);
    expect(values.sessions[0]).toMatchObject({
      label: "Day 1",
      expectedAttendance: "300",
      preferredLayout: "theatre",
    });
    // Null columns come back as empty inputs, not the string "null".
    expect(values.sessions[1]).toMatchObject({ label: "", expectedAttendance: "", preferredLayout: "" });
  });

  it("[SPM-24][AC3] [SPM-23][AC6] puts each equipment request on its own session, and event-wide ones at event level", () => {
    const values = toFormValues(record);
    expect(values.sessions[0].equipment).toEqual([
      { equipmentId: projector, quantityRequested: "2", technicalRequirements: "HDMI" },
    ]);
    expect(values.sessions[1].equipment).toEqual([]);
    expect(values.equipment.map((row) => row.equipmentId)).toEqual([microphone]);
  });

  it("[SPM-24][AC3] [SPM-23][AC6] leaves multi-session off for an event with no sessions, or a record from before sessions existed", () => {
    const { sessions: _unused, ...withoutSessions } = record;
    void _unused;
    const legacy = toFormValues({ ...withoutSessions, equipmentRequests: [] });
    expect(legacy.multiSession).toBe(false);
    expect(legacy.sessions).toEqual([]);

    expect(toFormValues({ ...record, sessions: [] }).multiSession).toBe(false);
  });

  it("[SPM-24][AC3] [SPM-23][AC6] sends sessions as the API takes them: ISO times, numbers, blanks as undefined", () => {
    const payload = sessionsPayload(
      multi([
        session({
          label: "  Day 1 — Keynotes  ",
          startsAt: "2099-12-05T09:00",
          endsAt: "2099-12-05T17:00",
          preferredLayout: "theatre",
          equipment: [{ equipmentId: projector, quantityRequested: "2", technicalRequirements: "" }],
        }),
        session({ label: "", expectedAttendance: "" }),
      ])
    );

    expect(payload[0]).toMatchObject({
      label: "Day 1 — Keynotes",
      expectedAttendance: 300,
      preferredLayout: "theatre",
      equipment: [{ equipmentId: projector, quantityRequested: 2, technicalRequirements: undefined }],
    });
    expect(payload[0].startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(payload[1]).toMatchObject({
      label: undefined,
      expectedAttendance: undefined,
      preferredLayout: undefined,
      equipment: undefined,
    });
  });

  it("[SPM-24][AC3] [SPM-23][AC6] round-trips: what toFormValues loads is what sessionsPayload sends back", () => {
    const payload = sessionsPayload(toFormValues(record));
    expect(payload).toHaveLength(2);
    expect(new Date(payload[0].startsAt).toISOString()).toBe("2099-12-05T01:00:00.000Z");
    expect(new Date(payload[1].endsAt).toISOString()).toBe("2099-12-06T09:00:00.000Z");
    expect(payload[0].equipment?.[0]).toMatchObject({ equipmentId: projector, quantityRequested: 2 });
  });
});

describe("toIso", () => {
  it("[SPM-23] turns a datetime-local value into a full ISO string", () => {
    expect(toIso("2099-12-05T09:00")).toBe(new Date("2099-12-05T09:00").toISOString());
  });

  it("[SPM-23] gives nothing for an empty or unreadable value", () => {
    expect(toIso("")).toBeUndefined();
    expect(toIso("not a date")).toBeUndefined();
  });
});
