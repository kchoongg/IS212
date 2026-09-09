import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createEquipmentSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET() {
  // CHANGED: prisma.equipmentItem -> prisma.equipment (the model is Equipment;
  // it tracks pooled quantities, not individual physical units).
  const items = await prisma.equipment.findMany();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
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
