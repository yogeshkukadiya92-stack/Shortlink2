const { prisma } = require("../lib/prisma");

async function getWorkspaceSettings(userId) {
  return prisma.workspaceSettings.findUnique({
    where: { userId },
  });
}

async function upsertWorkspaceSettings(userId, data) {
  return prisma.workspaceSettings.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      ...data,
    },
  });
}

module.exports = {
  getWorkspaceSettings,
  upsertWorkspaceSettings,
};
