const { prisma } = require("../lib/prisma");

async function findUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email: String(email || "").trim().toLowerCase() },
  });
}

async function findUserById(id) {
  return prisma.user.findUnique({
    where: { id },
  });
}

async function createUser(data) {
  return prisma.user.create({
    data,
  });
}

async function updateUser(id, data) {
  return prisma.user.update({
    where: { id },
    data,
  });
}

async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "asc" },
  });
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  listUsers,
};
