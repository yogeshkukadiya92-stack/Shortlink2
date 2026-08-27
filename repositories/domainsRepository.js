const { prisma } = require("../lib/prisma");

async function listDomainsByUser(userId) {
  return prisma.customDomain.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
}

async function assertDomainAvailable(userId, host) {
  const existing = await prisma.customDomain.findUnique({ where: { host } });
  if (existing && existing.userId !== userId) {
    const error = new Error("This domain is already connected to another workspace.");
    error.code = "DOMAIN_OWNERSHIP_CONFLICT";
    throw error;
  }
  return existing;
}

async function upsertDomain(userId, host, data = {}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customDomain.findUnique({ where: { host } });
    if (existing && existing.userId !== userId) {
      const error = new Error("This domain is already connected to another workspace.");
      error.code = "DOMAIN_OWNERSHIP_CONFLICT";
      throw error;
    }
    if (existing) return tx.customDomain.update({ where: { id: existing.id }, data });
    return tx.customDomain.create({ data: { userId, host, ...data } });
  });
}

async function removeDomainsNotIn(userId, hosts) {
  return prisma.customDomain.deleteMany({
    where: {
      userId,
      host: {
        notIn: hosts,
      },
    },
  });
}

module.exports = {
  assertDomainAvailable,
  listDomainsByUser,
  upsertDomain,
  removeDomainsNotIn,
};
