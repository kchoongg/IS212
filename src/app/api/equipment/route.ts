import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createEquipmentSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET() {
  const items = await prisma.equipmentItem.findMany();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createEquipmentSchema.parse(body);
    const item = await prisma.equipmentItem.create({ data });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
