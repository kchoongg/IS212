import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createVenueSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET() {
  const venues = await prisma.venue.findMany();
  return NextResponse.json(venues);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createVenueSchema.parse(body);
    const venue = await prisma.venue.create({ data });
    return NextResponse.json(venue, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
