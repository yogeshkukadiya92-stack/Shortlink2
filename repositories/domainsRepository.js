const { prisma } = require("../lib/prisma");

async function listDomainsByUser(userId) {
  return prisma.customDomain.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
}

async function upsertDomain(userId, host, data = {}) {
  return prisma.customDomain.upsert({
    where: { host },
    update: {
      ...data,
      userId,
    },
    create: {
      userId,
      host,
      ...data,
    },
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
  listDomainsByUser,
  upsertDomain,
  removeDomainsNotIn,
};
