// Prisma reads DATABASE_URL at runtime. Some hosts expose a "public" url variable
// name; keep a small fallback map so the app can boot even if DATABASE_URL is
// missing.
if (!process.env.DATABASE_URL) {
  const fallback =
    process.env.DATABASE_PUBLIC_URL ||
    process.env.DATABASE_URL_PUBLIC ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRESQL_URL ||
    "";

  if (fallback) {
    process.env.DATABASE_URL = fallback;
  }
}

const { PrismaClient } = require("@prisma/client");

const globalForPrisma = globalThis;

const prisma = globalForPrisma.__anylinkPrisma || new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__anylinkPrisma = prisma;
}

module.exports = { prisma };
