// @vitest-environment jsdom
//
// SPM-55 - the Equipment page (sidebar "Equipment", /equipment): every item's
// operational status, and Technical Support recording and returning units.
//
// CONTRACT (SPM-55, written before the code):
//   src/app/equipment/page.tsx - internal staff only: Coordinator, Ops Manager, Technical Support.
//     The Organiser holds equipment:view (to pick items on the request form) but is refused here,
//     as are Venue Staff and Attendees, and the list is never requested for them.
//   GET /api/equipment. A table "Equipment" with columns Equipment, Category, Total units,
//     Out of service, Status, Reason. Status badge from operationalStatus(); Reason from
//     outOfServiceSummary().
//   Technical Support only: "Record unavailability" per row -> dialog "Record unavailability -
//     <item>" with "Units out of service", "Type" (Unavailable / Damaged / Under maintenance),
//     "Reason (optional)", "Save" / "Cancel", filled in with what is recorded now; and
//     "Return all to available" on a row with units out -> "Return all units to available?" with
//     "Return to available" / "Cancel". Both send PATCH /api/equipment/<id>/out-of-service.
//   Messages as in docs/test-cases/SPM-55_test_cases.json (DECIDED 2026-10-11).

import { describe, it, expect } from "vitest";
import EquipmentPage from "@/app/equipment/page";
import { fireEvent, mockApi, render, reply, router, screen, setRoute, signedInAs, signedOut, userEvent, waitFor, within } from "@/test/ui";

const LIST = "GET /api/equipment";
const PATCH = "PATCH /api/equipment/projector-id/out-of-service";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "projector-id",
    name: "SPM55 Laser Projector",
    category: "AV",
    totalQuantity: 4,
    quantityInMaintenance: 0,
    outOfServiceType: null,
    outOfServiceReason: null,
    isActive: true,
    ...overrides,
  };
}

const kit = () =>
  item({
    id: "mic-id",
    name: "SPM55 Spare Microphone Kit",
    totalQuantity: 5,
    quantityInMaintenance: 3,
    outOfServiceType: "under_maintenance",
    outOfServiceReason: "Cable fault",
  });

function open(role = "tech_support", list: unknown = [item(), kit()], extra: Record<string, unknown> = {}) {
  setRoute("/equipment");
  const api = mockApi({ ...signedInAs(role), [LIST]: list, ...extra });
  render(<EquipmentPage />);
  return api;
}

const table = () => screen.findByRole("table", { name: "Equipment" });
const rowFor = async (name: string) =>
  within(await table())
    .getAllByRole("row")
    .find((r) => r.textContent?.includes(name)) as HTMLElement;
const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;

async function openRecord(name = "SPM55 Laser Projector") {
  await userEvent.click(within(await rowFor(name)).getByRole("button", { name: "Record unavailability" }));
}

async function fill(units: string, type?: string, reason?: string) {
  fireEvent.change(screen.getByLabelText("Units out of service"), { target: { value: units } });
  if (type) await userEvent.selectOptions(screen.getByLabelText("Type"), type);
  if (reason !== undefined) fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: reason } });
}

const save = () => userEvent.click(within(dialog()).getByRole("button", { name: "Save", hidden: true }));

describe("Equipment page (SPM-55)", () => {
  it("sends an anonymous visitor to log in", async () => {
    setRoute("/equipment");
    mockApi(signedOut());

    render(<EquipmentPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment"));
  });

  it.each(["organiser", "venue_staff", "attendee"])(
    "SPM-55-TC11: refuses %s, and never asks for the list",
    async (role) => {
      const api = open(role);

      expect(await screen.findByText("You do not have access to this")).toBeInTheDocument();
      expect(api.sent(LIST)).toHaveLength(0);
    }
  );

  it("SPM-55-TC10: lists every item with its operational status and reason", async () => {
    open("coordinator");

    const projector = await rowFor("SPM55 Laser Projector");
    expect(projector).toHaveTextContent("AV");
    expect(projector).toHaveTextContent("Available");
    const mics = await rowFor("SPM55 Spare Microphone Kit");
    expect(within(mics).getAllByRole("cell").map((c) => c.textContent)).toEqual(
      expect.arrayContaining(["5", "3", "Partly out of service", "Under maintenance - Cable fault"])
    );
    const headers = within(await table()).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Equipment", "Category", "Total units", "Out of service", "Status", "Reason", ""]);
  });

  it("shows an item with every unit out as 'Out of service'", async () => {
    open("coordinator", [item({ quantityInMaintenance: 4, outOfServiceType: "damaged" })]);

    const row = await rowFor("SPM55 Laser Projector");
    expect(row).toHaveTextContent("Out of service");
    expect(row).toHaveTextContent("Damaged");
  });

  it.each(["coordinator", "ops_manager"])("SPM-55-TC10: gives %s no way to change the status", async (role) => {
    open(role);

    await table();
    expect(screen.queryByRole("button", { name: "Record unavailability" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Return all to available" })).not.toBeInTheDocument();
  });

  it("offers Technical Support 'Return all to available' only on an item with units out", async () => {
    open();

    expect(within(await rowFor("SPM55 Spare Microphone Kit")).getByRole("button", { name: "Return all to available" })).toBeInTheDocument();
    expect(within(await rowFor("SPM55 Laser Projector")).queryByRole("button", { name: "Return all to available" })).not.toBeInTheDocument();
  });

  it("says so when the catalogue is empty", async () => {
    open("coordinator", []);

    expect(await screen.findByText("No equipment yet")).toBeInTheDocument();
  });

  it("explains a failed load and retries", async () => {
    const api = open("coordinator", reply(500, {}));

    expect(await screen.findByText("Could not load the equipment catalogue.")).toBeInTheDocument();
    api.on(LIST, [item()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await rowFor("SPM55 Laser Projector")).toBeInTheDocument();
  });

  it("sends a visitor whose session has ended to log in", async () => {
    open("coordinator", reply(401, {}));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment"));
  });

  describe("recording unavailability (AC1, AC2)", () => {
    it("SPM-55-TC01: opens a dialog for the item, with nothing out of service yet", async () => {
      open();

      await openRecord();

      expect(dialog().open).toBe(true);
      expect(within(dialog()).getByText("Record unavailability - SPM55 Laser Projector")).toBeInTheDocument();
      expect(screen.getByLabelText("Units out of service")).toHaveValue(0);
      expect(within(screen.getByLabelText("Type")).getAllByRole("option", { hidden: true }).map((o) => o.textContent)).toEqual([
        "Choose a type",
        "Unavailable",
        "Damaged",
        "Under maintenance",
      ]);
    });

    it("SPM-55-TC09: fills the dialog in with what is recorded now", async () => {
      open();

      await openRecord("SPM55 Spare Microphone Kit");

      expect(screen.getByLabelText("Units out of service")).toHaveValue(3);
      expect(screen.getByLabelText("Type")).toHaveValue("under_maintenance");
      expect(screen.getByLabelText("Reason (optional)")).toHaveValue("Cable fault");
    });

    it("SPM-55-TC01: sends the units, type and reason, says what was saved, and reloads the list", async () => {
      const api = open("tech_support", [item()], {
        [PATCH]: { ...item({ quantityInMaintenance: 2 }), flaggedReservations: [] },
      });
      await openRecord();

      await fill("2", "Under maintenance", "Lamp replacement");
      await save();

      expect(api.sent(PATCH).map((c) => c.body)).toEqual([
        { quantityOutOfService: 2, type: "under_maintenance", reason: "Lamp replacement" },
      ]);
      expect(
        await screen.findByText("Saved. 2 of 4 SPM55 Laser Projector units are out of service. No reservations were affected.")
      ).toBeInTheDocument();
      await waitFor(() => expect(api.sent(LIST)).toHaveLength(2));
      expect(dialog().open).toBe(false);
    });

    it("SPM-55-TC04: sends no reason when it is left empty", async () => {
      const api = open("tech_support", [item()], {
        [PATCH]: { ...item({ quantityInMaintenance: 4 }), flaggedReservations: [] },
      });
      await openRecord();

      await fill("4", "Damaged");
      await save();

      expect(api.sent(PATCH)[0].body).toEqual({ quantityOutOfService: 4, type: "damaged" });
    });

    it.each([
      ["", "Enter a whole number of units, 0 or more."],
      ["-1", "Enter a whole number of units, 0 or more."],
      ["1.5", "Enter a whole number of units, 0 or more."],
    ])("refuses %j units, sending nothing", async (units, message) => {
      const api = open("tech_support", [item()], { [PATCH]: {} });
      await openRecord();

      await fill(units, "Damaged");
      await save();

      expect(within(dialog()).getByText(message)).toBeInTheDocument();
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("asks for a type when units are out of service, sending nothing", async () => {
      const api = open("tech_support", [item()], { [PATCH]: {} });
      await openRecord();

      await fill("2");
      await save();

      expect(within(dialog()).getByText("Choose a type.")).toBeInTheDocument();
      expect(api.sent(PATCH)).toHaveLength(0);
    });

    it("SPM-55-TC05: shows the server's refusal under the units and keeps the dialog open", async () => {
      open("tech_support", [item()], {
        [PATCH]: reply(400, { error: "Only 4 units in total - cannot mark 5 as out of service" }),
      });
      await openRecord();

      await fill("5", "Unavailable");
      await save();

      expect(await within(dialog()).findByText("Only 4 units in total - cannot mark 5 as out of service")).toBeInTheDocument();
      expect(dialog().open).toBe(true);
    });

    it("says when the server cannot be reached", async () => {
      open("tech_support", [item()], { [PATCH]: () => Promise.reject(new Error("offline")) });
      await openRecord();

      await fill("1", "Damaged");
      await save();

      expect(await within(dialog()).findByText("Could not reach the server. Check your connection and try again.")).toBeInTheDocument();
    });

    it("sends no type or reason when 0 units are recorded", async () => {
      const api = open("tech_support", [kit()], {
        "PATCH /api/equipment/mic-id/out-of-service": { ...kit(), quantityInMaintenance: 0, flaggedReservations: [] },
      });
      await openRecord("SPM55 Spare Microphone Kit");

      await fill("0");
      await save();

      expect(api.sent("PATCH /api/equipment/mic-id/out-of-service")[0].body).toEqual({ quantityOutOfService: 0 });
    });

    it("closes on Escape", async () => {
      open();
      await openRecord();

      fireEvent(dialog(), new Event("cancel", { cancelable: true }));

      await waitFor(() => expect(dialog().open).toBe(false));
    });

    it("closes without sending anything on Cancel", async () => {
      const api = open("tech_support", [item()], { [PATCH]: {} });
      await openRecord();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(PATCH)).toHaveLength(0);
    });
  });

  describe("reservations it leaves short (AC4)", () => {
    it("SPM-55-TC06: lists each flagged reservation and says the coordinators were notified", async () => {
      open("tech_support", [item()], {
        [PATCH]: {
          ...item({ quantityInMaintenance: 3 }),
          flaggedReservations: [
            { requestId: "r1", eventId: "e1", eventTitle: "SPM55 Harbour Product Launch", sessionLabel: null, reserved: 4, available: 3 },
          ],
        },
      });
      await openRecord();

      await fill("3", "Damaged", "Dropped in transit");
      await save();

      const panel = await screen.findByText("Saved - 1 reservation flagged for review, coordinators notified");
      const box = panel.closest("[role='status'], [role='alert'], div") as HTMLElement;
      expect(box.parentElement).toHaveTextContent("SPM55 Harbour Product Launch: 4 reserved, 3 available");
      expect(box.parentElement).toHaveTextContent("not been changed or cancelled");
    });

    it("SPM-55-TC08: counts more than one in the plural", async () => {
      open("tech_support", [item()], {
        [PATCH]: {
          ...item({ quantityInMaintenance: 1 }),
          flaggedReservations: [
            { requestId: "r1", eventId: "e1", eventTitle: "SPM55 Morning Showcase", sessionLabel: null, reserved: 3, available: 2 },
            { requestId: "r2", eventId: "e2", eventTitle: "SPM55 Evening Showcase", sessionLabel: "Day 1", reserved: 3, available: 2 },
          ],
        },
      });
      await openRecord();

      await fill("1", "Unavailable");
      await save();

      expect(await screen.findByText("Saved - 2 reservations flagged for review, coordinators notified")).toBeInTheDocument();
      expect(screen.getByText("SPM55 Evening Showcase (Day 1): 3 reserved, 2 available")).toBeInTheDocument();
    });
  });

  describe("returning units (AC5)", () => {
    const MIC_PATCH = "PATCH /api/equipment/mic-id/out-of-service";
    const askReturn = async () =>
      userEvent.click(within(await rowFor("SPM55 Spare Microphone Kit")).getByRole("button", { name: "Return all to available" }));

    it("SPM-55-TC03: asks first, then returns every unit and says so", async () => {
      const api = open("tech_support", [kit()], { [MIC_PATCH]: { ...kit(), quantityInMaintenance: 0, flaggedReservations: [] } });

      await askReturn();
      expect(within(dialog()).getByText("Return all units to available?")).toBeInTheDocument();
      expect(dialog()).toHaveTextContent("3 units out of service will be counted as available again");
      expect(api.sent(MIC_PATCH)).toHaveLength(0);

      await userEvent.click(within(dialog()).getByRole("button", { name: "Return to available", hidden: true }));

      expect(api.sent(MIC_PATCH).map((c) => c.body)).toEqual([{ quantityOutOfService: 0 }]);
      expect(await screen.findByText("All SPM55 Spare Microphone Kit units are back in service.")).toBeInTheDocument();
      await waitFor(() => expect(api.sent(LIST)).toHaveLength(2));
    });

    it("SPM-55-TC09: returns some units by lowering the number", async () => {
      const api = open("tech_support", [kit()], {
        [MIC_PATCH]: { ...kit(), quantityInMaintenance: 1, flaggedReservations: [] },
      });
      await openRecord("SPM55 Spare Microphone Kit");

      await fill("1");
      await save();

      expect(api.sent(MIC_PATCH)[0].body).toEqual({ quantityOutOfService: 1, type: "under_maintenance", reason: "Cable fault" });
      expect(
        await screen.findByText("Saved. 1 of 5 SPM55 Spare Microphone Kit units are out of service. No reservations were affected.")
      ).toBeInTheDocument();
    });

    it("says 'unit' for a single unit", async () => {
      open("tech_support", [kit()].map((k) => ({ ...k, quantityInMaintenance: 1 })));

      await askReturn();

      expect(dialog()).toHaveTextContent("The 1 unit out of service will be counted as available again");
    });

    it("says when the server cannot be reached", async () => {
      open("tech_support", [kit()], { [MIC_PATCH]: () => Promise.reject(new Error("offline")) });

      await askReturn();
      await userEvent.click(within(dialog()).getByRole("button", { name: "Return to available", hidden: true }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server. Check your connection and try again.");
      expect(dialog().open).toBe(false);
    });

    it("shows a refusal from the server", async () => {
      open("tech_support", [kit()], { [MIC_PATCH]: reply(500, {}) });

      await askReturn();
      await userEvent.click(within(dialog()).getByRole("button", { name: "Return to available", hidden: true }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not update this equipment.");
    });
  });
});
