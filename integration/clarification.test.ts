// Request Event Clarification against a real database (SPM-29): one open
// clarification per event, held by a partial unique index (PR #70 review).

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as requestClarification } from "@/app/api/events/[id]/clarifications/route";
import { PATCH as changeEvent } from "@/app/api/events/[id]/route";
import { CLARIFICATION_ALREADY_OPEN } from "@/lib/clarification";
import { createEvent, createWorld, destroyWorld, params, req, type TestEvent, type World } from "./world";

let world: World;

beforeEach(async () => {
  world = await createWorld();
});

afterEach(async () => {
  await destroyWorld(world);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function ask(event: TestEvent, message: string) {
  return requestClarification(
    req("POST", `/api/events/${event.reference}/clarifications`, world.coordinator, { fields: ["purpose"], message }),
    params({ id: event.reference })
  );
}

describe("one open clarification per event on a real database", () => {
  it(
    "[SPM-29][AC3] (conflict): two clarification requests for one event at the same moment - exactly one is opened",
    async () => {
      const event = await createEvent(world, {
        title: "Integration Clarity Forum",
        day: "2031-08-12",
        start: "09:00",
        end: "12:00",
        status: "under_review",
      });

      // A check before the create cannot stop this: both requests read "none
      // open" before either saves. The partial unique index does.
      const responses = await Promise.all([ask(event, "First tab"), ask(event, "Second tab")]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
      const refused = responses.find((r) => r.status === 400)!;
      expect(await refused.json()).toEqual({ error: CLARIFICATION_ALREADY_OPEN });
      expect(await prisma.clarificationRequest.count({ where: { eventId: event.id, status: "open" } })).toBe(1);
    }
  );

  it("[SPM-26] approving the request closes its open clarification, unanswered", async () => {
    const event = await createEvent(world, {
      title: "Integration Closing Forum",
      day: "2031-08-19",
      start: "09:00",
      end: "12:00",
      status: "under_review",
    });
    expect((await ask(event, "Which hall?")).status).toBe(201);

    const res = await changeEvent(
      req("PATCH", `/api/events/${event.reference}`, world.coordinator, { status: "approved" }),
      params({ id: event.reference })
    );

    expect(res.status).toBe(200);
    expect(await prisma.clarificationRequest.findMany({ where: { eventId: event.id } })).toEqual([
      expect.objectContaining({ status: "closed", responseMessage: null, respondedAt: null }),
    ]);
  });
});
