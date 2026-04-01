const { prisma } = require("../lib/prisma");

async function listLinksByUser(userId) {
  return prisma.link.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

async function findLinkBySlug(slug) {
  return prisma.link.findUnique({
    where: { slug },
  });
}

async function createLink(data) {
  return prisma.link.create({
    data,
  });
}

async function updateLinkBySlug(slug, userId, data) {
  const result = await prisma.link.updateMany({
    where: { slug, userId },
    data,
  });

  if (!result.count) {
    return null;
  }

  return prisma.link.findUnique({
    where: { slug: data.slug || slug },
  });
}

async function deleteLinkById(id, userId) {
  return prisma.link.deleteMany({
    where: { id, userId },
  });
}

async function deleteLinkBySlug(slug, userId) {
  return prisma.link.deleteMany({
    where: { slug, userId },
  });
}

module.exports = {
  listLinksByUser,
  findLinkBySlug,
  createLink,
  updateLinkBySlug,
  deleteLinkById,
  deleteLinkBySlug,
};
