const { prisma } = require("../lib/prisma");

async function recordClickEvent(linkId, userId, click) {
  return prisma.$transaction(async (tx) => {
    await tx.clickEvent.create({
      data: {
        linkId,
        userId,
        ipAddress: click.ip || null,
        country: click.country || null,
        city: click.city || null,
        browser: click.browser || null,
        platform: click.platform || null,
        device: click.deviceType || null,
        referrer: click.referrer || null,
      },
    });

    await tx.link.update({
      where: { id: linkId },
      data: {
        clickCount: { increment: 1 },
        lastClickedAt: new Date(click.clickedAt),
      },
    });
  });
}

async function listAnalyticsByUser(userId) {
  return prisma.link.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      clickEvents: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

module.exports = {
  recordClickEvent,
  listAnalyticsByUser,
};
