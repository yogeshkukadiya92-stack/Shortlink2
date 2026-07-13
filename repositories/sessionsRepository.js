const { prisma } = require("../lib/prisma");

async function findSessionByToken(token) {
  return prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
}

async function createSession(data) {
  return prisma.session.create({
    data,
  });
}

async function deleteSessionByToken(token) {
  return prisma.session.deleteMany({
    where: { token },
  });
}

async function deleteSessionsByUserId(userId) {
  return prisma.session.deleteMany({
    where: { userId },
  });
}

async function deleteExpiredSessions(now = new Date()) {
  return prisma.session.deleteMany({
    where: {
      expiresAt: {
        lte: now,
      },
    },
  });
}

module.exports = {
  findSessionByToken,
  createSession,
  deleteSessionByToken,
  deleteSessionsByUserId,
  deleteExpiredSessions,
};
