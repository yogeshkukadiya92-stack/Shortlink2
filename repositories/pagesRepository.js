const { prisma } = require("../lib/prisma");

async function listPagesByUser(userId) {
  return prisma.page.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      fields: {
        orderBy: { sortOrder: "asc" },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        include: {
          answers: true,
        },
      },
    },
  });
}

async function findPageById(pageId, userId) {
  return prisma.page.findFirst({
    where: { id: pageId, userId },
    include: {
      fields: {
        orderBy: { sortOrder: "asc" },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        include: {
          answers: true,
        },
      },
    },
  });
}

async function findPageBySlug(slug) {
  return prisma.page.findUnique({
    where: { slug },
    include: {
      fields: {
        orderBy: { sortOrder: "asc" },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        include: {
          answers: true,
        },
      },
    },
  });
}

async function savePage(userId, pageId, data, fields) {
  const pageData = {
    title: data.title,
    slug: data.slug,
    headline: data.headline,
    description: data.description,
    submitLabel: data.submitLabel,
    thanksMessage: data.thanksMessage,
  };

  if (pageId) {
    return prisma.$transaction(async (tx) => {
      const page = await tx.page.update({
        where: { id: pageId },
        data: pageData,
      });

      await tx.pageField.deleteMany({
        where: { pageId },
      });

      if (fields.length) {
        await tx.pageField.createMany({
          data: fields.map((field, index) => ({
            pageId,
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required,
            enabled: field.enabled,
            sortOrder: index,
          })),
        });
      }

      return tx.page.findUnique({
        where: { id: page.id },
        include: {
          fields: {
            orderBy: { sortOrder: "asc" },
          },
          submissions: {
            orderBy: { createdAt: "desc" },
            include: {
              answers: true,
            },
          },
        },
      });
    });
  }

  return prisma.page.create({
    data: {
      userId,
      ...pageData,
      fields: {
        create: fields.map((field, index) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          enabled: field.enabled,
          sortOrder: index,
        })),
      },
    },
    include: {
      fields: {
        orderBy: { sortOrder: "asc" },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        include: {
          answers: true,
        },
      },
    },
  });
}

async function deletePageById(pageId, userId) {
  return prisma.page.deleteMany({
    where: { id: pageId, userId },
  });
}

async function createSubmission(pageId, meta, answers) {
  return prisma.formSubmission.create({
    data: {
      pageId,
      ipAddress: meta.ipAddress,
      country: meta.country,
      city: meta.city,
      browser: meta.browser,
      platform: meta.platform,
      device: meta.device,
      answers: {
        create: answers.map((answer) => ({
          fieldKey: answer.fieldKey,
          fieldLabel: answer.fieldLabel,
          value: answer.value,
        })),
      },
    },
    include: {
      answers: true,
    },
  });
}

module.exports = {
  listPagesByUser,
  findPageById,
  findPageBySlug,
  savePage,
  deletePageById,
  createSubmission,
};
