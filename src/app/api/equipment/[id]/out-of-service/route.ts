import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { recordOutOfServiceSchema } from "@/lib/validation";
import { checkOutOfService, outOfServiceReasonFor } from "@/lib/equipment";

// SPM-48 AC7 ("equipment recorded as unavailable is excluded") - the recording
// side. Technical Support says how many units of an item are unavailable,
// damaged or under maintenance, and why (customer Q&A #9: Technical Support
// Staff maintain equipment status). The availability check already subtracts
// that number, so the effect shows on the Equipment request screen at once.
//
// Only the API for now: a screen for it belongs to SPM-55 (Record Equipment
// Unavailability). Lowering availability below what is already reserved is
// allowed - the affected events simply show as short on their next check,
// which is how a broken unit should surface.
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "equipment:manage")) {
      return forbidden("Only Technical Support Staff can record equipment as unavailable");
    }

    const data = recordOutOfServiceSchema.parse(await req.json());

    const item = await prisma.equipment.findUnique({
      where: { id },
      select: { totalQuantity: true },
    });
    if (!item) {
      return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
    }
    const problem = checkOutOfService(item.totalQuantity, data.quantityOutOfService);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    const updated = await prisma.equipment.update({
      where: { id },
      data: {
        quantityInMaintenance: data.quantityOutOfService,
        outOfServiceReason: outOfServiceReasonFor(data.quantityOutOfService, data.reason),
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
