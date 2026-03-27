const fs = require("fs");
const path = require("path");
const { prisma } = require("../lib/prisma");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");

function readJson(name, fallback) {
  const filePath = path.join(dataDir, name);
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[backfill] Could not parse ${name}: ${error.message}`);
    return fallback;
  }
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asEpochDate(value) {
  if (!value) return null;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSubscriptionStatus(status) {
  const normalized = String(status || "TRIALING").toUpperCase();
  if (["TRIALING", "ACTIVE", "INACTIVE", "LIFETIME", "CANCELED", "PAST_DUE"].includes(normalized)) {
    return normalized;
  }
  return "TRIALING";
}

function mapLegacyFields(fields) {
  const normalized = {
    name: fields?.name !== false,
    email: fields?.email !== false,
    phone: fields?.phone === true,
    company: fields?.company === true,
    message: fields?.message !== false,
  };

  const allFields = [
    { key: "name", label: "Full name", type: "TEXT", required: normalized.name, enabled: normalized.name },
    { key: "email", label: "Email address", type: "EMAIL", required: normalized.email, enabled: normalized.email },
    { key: "phone", label: "Phone number", type: "TEL", required: false, enabled: normalized.phone },
    { key: "company", label: "Company", type: "TEXT", required: false, enabled: normalized.company },
    { key: "message", label: "Message", type: "TEXTAREA", required: normalized.message, enabled: normalized.message },
  ];

  return allFields.filter((field) => field.enabled);
}

async function backfillUsers(users, settings) {
  const settingsByUser = new Map(settings.map((item) => [String(item.userId || ""), item]));

  for (const user of users) {
    const userId = String(user.id);
    const userSettings = settingsByUser.get(userId);
    const defaultDomain = userSettings?.defaultDomain || process.env.PUBLIC_APP_DOMAIN || "go.shortlinks.in";

    await prisma.user.upsert({
      where: { email: String(user.email || "").toLowerCase() },
      update: {
        name: user.name || "User",
        passwordHash: user.passwordHash || user.combinedPasswordHash || "",
        emailVerified: Boolean(user.emailVerified),
        isAdmin: Boolean(user.isAdmin),
        subscriptionStatus: normalizeSubscriptionStatus(user.subscriptionStatus),
        trialStartedAt: asEpochDate(user.trialStartedAt),
        trialEndsAt: asEpochDate(user.trialEndsAt),
        subscriptionStartedAt: asEpochDate(user.subscriptionStartedAt),
        subscriptionExpiresAt: asEpochDate(user.subscriptionExpiresAt),
        createdAt: asEpochDate(user.createdAt) || new Date(),
      },
      create: {
        id: userId,
        name: user.name || "User",
        email: String(user.email || "").toLowerCase(),
        passwordHash: user.passwordHash || user.combinedPasswordHash || "",
        emailVerified: Boolean(user.emailVerified),
        isAdmin: Boolean(user.isAdmin),
        subscriptionStatus: normalizeSubscriptionStatus(user.subscriptionStatus),
        trialStartedAt: asEpochDate(user.trialStartedAt),
        trialEndsAt: asEpochDate(user.trialEndsAt),
        subscriptionStartedAt: asEpochDate(user.subscriptionStartedAt),
        subscriptionExpiresAt: asEpochDate(user.subscriptionExpiresAt),
        createdAt: asEpochDate(user.createdAt) || new Date(),
        settings: {
          create: {
            workspaceName: userSettings?.workspaceName || "AnyLink Workspace",
            defaultDomain,
          },
        },
      },
    });

    await prisma.workspaceSettings.upsert({
      where: { userId },
      update: {
        workspaceName: userSettings?.workspaceName || "AnyLink Workspace",
        defaultDomain,
      },
      create: {
        userId,
        workspaceName: userSettings?.workspaceName || "AnyLink Workspace",
        defaultDomain,
      },
    });
  }
}

async function backfillDomains(settings) {
  for (const item of settings) {
    const userId = String(item.userId || "");
    const domains = Array.isArray(item.domains) ? item.domains : [];
    const defaultDomain = item.defaultDomain || process.env.PUBLIC_APP_DOMAIN || "go.shortlinks.in";

    for (const host of new Set([defaultDomain, ...domains])) {
      if (!host || host === process.env.PUBLIC_APP_DOMAIN) continue;
      await prisma.customDomain.upsert({
        where: { host },
        update: {
          userId,
          status: host === defaultDomain ? "ACTIVE" : "VERIFIED",
          isActive: host === defaultDomain,
          dnsTarget: process.env.PUBLIC_APP_DOMAIN || "go.shortlinks.in",
          verifiedAt: new Date(),
        },
        create: {
          userId,
          host,
          status: host === defaultDomain ? "ACTIVE" : "VERIFIED",
          isActive: host === defaultDomain,
          dnsTarget: process.env.PUBLIC_APP_DOMAIN || "go.shortlinks.in",
          verifiedAt: new Date(),
        },
      });
    }
  }
}

async function backfillSessions(sessions) {
  for (const session of sessions) {
    if (!session.token || !session.userId) continue;
    await prisma.session.upsert({
      where: { token: session.token },
      update: {
        userId: String(session.userId),
        expiresAt: asEpochDate(session.expiresAt) || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        createdAt: asEpochDate(session.createdAt) || new Date(),
      },
      create: {
        token: session.token,
        userId: String(session.userId),
        expiresAt: asEpochDate(session.expiresAt) || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        createdAt: asEpochDate(session.createdAt) || new Date(),
      },
    });
  }
}

async function backfillLinks(links) {
  for (const link of links) {
    const linkId = String(link.id || "");
    if (!linkId || !link.userId || !link.slug) continue;

    await prisma.link.upsert({
      where: { slug: link.slug },
      update: {
        userId: String(link.userId),
        destination: link.destination || "",
        shortUrl: link.shortUrl || "",
        includeQr: Boolean(link.includeQr),
        clickCount: Number(link.analytics?.totalClicks || 0),
        lastClickedAt: asDate(link.analytics?.lastClickedAt),
        createdAt: asDate(link.createdAt) || new Date(),
      },
      create: {
        id: linkId,
        userId: String(link.userId),
        slug: link.slug,
        destination: link.destination || "",
        shortUrl: link.shortUrl || "",
        includeQr: Boolean(link.includeQr),
        clickCount: Number(link.analytics?.totalClicks || 0),
        lastClickedAt: asDate(link.analytics?.lastClickedAt),
        createdAt: asDate(link.createdAt) || new Date(),
      },
    });

    const storedLink = await prisma.link.findUnique({ where: { slug: link.slug } });
    const clicks = Array.isArray(link.analytics?.clicks) ? link.analytics.clicks : [];

    for (const click of clicks) {
      if (!click?.id) continue;
      const exists = await prisma.clickEvent.findUnique({ where: { id: String(click.id) } }).catch(() => null);
      if (exists) continue;

      await prisma.clickEvent.create({
        data: {
          id: String(click.id),
          userId: String(link.userId),
          linkId: storedLink.id,
          ipAddress: click.ip || null,
          country: click.country || null,
          city: click.city || null,
          browser: click.browser || null,
          platform: click.platform || null,
          device: click.deviceType || null,
          referrer: click.referrer || null,
          createdAt: asDate(click.clickedAt) || new Date(),
        },
      }).catch(() => null);
    }
  }
}

async function backfillPages(pages) {
  for (const page of pages) {
    const pageId = String(page.id || "");
    if (!pageId || !page.userId || !page.slug) continue;

    const fields = mapLegacyFields(page.fields || {});
    await prisma.page.upsert({
      where: { slug: page.slug },
      update: {
        userId: String(page.userId),
        title: page.title || "Untitled form",
        headline: page.headline || page.title || "Untitled form",
        description: page.description || "",
        submitLabel: page.submitLabel || "Submit",
        thanksMessage: page.thanksMessage || "Thanks, your response has been received.",
        createdAt: asDate(page.createdAt) || new Date(),
      },
      create: {
        id: pageId,
        userId: String(page.userId),
        title: page.title || "Untitled form",
        slug: page.slug,
        headline: page.headline || page.title || "Untitled form",
        description: page.description || "",
        submitLabel: page.submitLabel || "Submit",
        thanksMessage: page.thanksMessage || "Thanks, your response has been received.",
        createdAt: asDate(page.createdAt) || new Date(),
      },
    });

    await prisma.pageField.deleteMany({ where: { pageId } });
    if (fields.length) {
      await prisma.pageField.createMany({
        data: fields.map((field, index) => ({
          pageId,
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          enabled: field.enabled,
          sortOrder: index,
        })),
      }).catch(() => null);
    }

    const submissions = Array.isArray(page.submissions) ? page.submissions : [];
    for (const submission of submissions) {
      const submissionId = String(submission.id || "");
      if (!submissionId) continue;
      const existing = await prisma.formSubmission.findUnique({ where: { id: submissionId } }).catch(() => null);
      if (existing) continue;

      await prisma.formSubmission.create({
        data: {
          id: submissionId,
          pageId,
          ipAddress: submission.meta?.ip || null,
          country: submission.meta?.country || null,
          city: submission.meta?.city || null,
          browser: submission.meta?.browser || null,
          platform: submission.meta?.platform || null,
          device: submission.meta?.device || null,
          createdAt: asDate(submission.submittedAt) || new Date(),
          answers: {
            create: Object.entries(submission.answers || {}).map(([fieldKey, value]) => ({
              fieldKey,
              fieldLabel: fields.find((field) => field.key === fieldKey)?.label || fieldKey,
              value: String(value || ""),
            })),
          },
        },
      }).catch(() => null);
    }
  }
}

async function main() {
  const users = readJson("users.json", []);
  const settings = readJson("settings.json", []);
  const sessions = readJson("sessions.json", []);
  const links = readJson("links.json", []);
  const pages = readJson("pages.json", []);

  console.log(`[backfill] users=${users.length}, settings=${settings.length}, sessions=${sessions.length}, links=${links.length}, pages=${pages.length}`);

  await backfillUsers(users, settings);
  await backfillDomains(settings);
  await backfillSessions(sessions);
  await backfillLinks(links);
  await backfillPages(pages);

  console.log("[backfill] JSON data backfill completed.");
}

main()
  .catch((error) => {
    console.error("[backfill] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
