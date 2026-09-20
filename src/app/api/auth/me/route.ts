import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, unauthenticated } from "@/lib/apiAuth";

/**
 * Who is signed in. Backs useCurrentUser(), which the app shell uses to decide
 * whether to render the signed-in chrome at all.
 *
 * CHANGED: this used to call getSession() and look the user up itself, making
 * it the only route in the app not going through getActor(). That meant it
 * skipped getActor's isActive check, so a deactivated user got a cheerful 200
 * and a role here while every other route returned 401 — the shell believed
 * they were signed in and nothing else did. Answering "who am I" is exactly
 * the question that must not disagree with the rest of the API.
 */
export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  // getActor returns what access decisions need (id, role, organisationId);
  // this route also owes the client a name and an email to render.
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true, fullName: true, email: true, role: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // `fullName` is the column; routes have always exposed it as `name`.
  return NextResponse.json({
    id: user.id,
    name: user.fullName,
    email: user.email,
    role: user.role,
  });
}
