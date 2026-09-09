import { PrismaClient } from "@prisma/client";

// A single shared Prisma client. In dev, Next.js hot-reloads modules, which
// would otherwise create a new PrismaClient on every edit and exhaust your
// database's connection limit - stashing it on `global` avoids that.
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
