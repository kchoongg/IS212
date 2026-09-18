import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { createEquipmentSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  // ADDED: this route had no authentication at all. The catalogue is readable
  // by organisers as well as staff, because the event request form (S-08)
  // asks the organiser to pick the equipment they need from it - but not by
  // an anonymous caller or an attendee.
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  if (!can(actor.role, "equipment:view")) {
    return forbidden("The equipment catalogue is not available to your role");
  }

  // CHANGED: prisma.equipmentItem -> prisma.equipment (the model is Equipment;
  // it tracks pooled quantities, not individual physical units).
  const items = await prisma.equipment.findMany();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    // ADDED: this route accepted unauthenticated requests. Technical Support
    // Staff "maintain records of available equipment" (briefing §2), so the
    // catalogue is theirs to write.
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "equipment:manage")) {
      return forbidden("Only Technical Support Staff can add equipment");
    }

    const body = await req.json();
    const data = createEquipmentSchema.parse(body);

    if ((data.quantityInMaintenance ?? 0) > data.totalQuantity) {
      return NextResponse.json(
        { error: "quantityInMaintenance cannot exceed totalQuantity" },
        { status: 400 }
      );
    }

    const item = await prisma.equipment.create({ data });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
