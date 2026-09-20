import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSession } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 400 });
    }

    const valid = await verifyPassword(data.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 400 });
    }

    // ADDED: a deactivated account used to log in perfectly happily. getActor()
    // checks isActive on every API call, so the token that came back was
    // already worthless — the user landed on a dashboard where every request
    // 401'd and bounced them back to /login, which signed them in again. Refuse
    // at the door instead.
    //
    // This says "deactivated" rather than reusing the generic "invalid email or
    // password" above, which does confirm the account exists. That is the right
    // trade here: these are ConnectSphere staff and clients who need to know to
    // contact an administrator, not an anonymous public signup worth protecting
    // from enumeration.
    if (!user.isActive) {
      return NextResponse.json(
        { error: "This account has been deactivated. Contact your ConnectSphere administrator." },
        { status: 403 }
      );
    }

    const token = signSession({ id: user.id, role: user.role });
    return NextResponse.json({
      token,
      // CHANGED: user.fullName, exposed as `name` so the response shape is unchanged.
      user: { id: user.id, name: user.fullName, email: user.email, role: user.role },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
