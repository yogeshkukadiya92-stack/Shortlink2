const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { prisma } = require("./lib/prisma");
const { URL } = require("url");
const { createUser: createDbUser, findUserByEmail, findUserById, updateUser: updateDbUser, listUsers: listDbUsers } = require("./repositories/usersRepository");
const { createSession: createDbSession, deleteSessionByToken: deleteDbSessionByToken, deleteSessionsByUserId, findSessionByToken } = require("./repositories/sessionsRepository");
const { getWorkspaceSettings: getDbWorkspaceSettings, upsertWorkspaceSettings } = require("./repositories/settingsRepository");
const { listLinksByUser, createLink: createDbLink, updateLinkBySlug, deleteLinkBySlug, findLinkBySlug } = require("./repositories/linksRepository");
const { listDomainsByUser, upsertDomain, removeDomainsNotIn } = require("./repositories/domainsRepository");
const { listPagesByUser, findPageById, findPageBySlug, savePage: saveDbPage, deletePageById, createSubmission } = require("./repositories/pagesRepository");
const { recordClickEvent: recordDbClickEvent, listAnalyticsByUser } = require("./repositories/analyticsRepository");

const host = "0.0.0.0";
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const linksFile = path.join(dataDir, "links.json");
const pagesFile = path.join(dataDir, "pages.json");
const settingsFile = path.join(dataDir, "settings.json");
const usersFile = path.join(dataDir, "users.json");
const sessionsFile = path.join(dataDir, "sessions.json");
const activityFile = path.join(dataDir, "activity.json");
const couponsFile = path.join(dataDir, "coupons.json");
const godaddyTokensFile = path.join(dataDir, "godaddy_tokens.json");
const auditLogsFile = path.join(dataDir, "audit_logs.json");
const sessionCookieName = "anylink_session";
const protectedLinkCookiePrefix = "anylink_gate_";
const analyticsVisitorCookieName = "anylink_vid";
const analyticsSessionCookieName = "anylink_vsid";
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 14;
const protectedLinkLifetimeSeconds = 60 * 60 * 24;
const analyticsVisitorLifetimeSeconds = 60 * 60 * 24 * 365;
const analyticsSessionLifetimeSeconds = 60 * 60 * 6;
const verificationLifetimeMs = 1000 * 60 * 30;
const resetLifetimeMs = 1000 * 60 * 30;
const trialLifetimeMs = 1000 * 60 * 60 * 24 * 3;
const sessionSameSite = ["Lax", "Strict", "None"].includes(String(process.env.SESSION_SAMESITE || "Lax"))
  ? String(process.env.SESSION_SAMESITE || "Lax")
  : "Lax";
const maxRequestBodyBytes = Math.max(16_384, Number(process.env.MAX_REQUEST_BODY_BYTES || 300_000));
const publicAppDomain = process.env.PUBLIC_APP_DOMAIN || "go.shortlinks.in";
const dbOnlyMode = String(process.env.DB_ONLY_MODE || "").toLowerCase() === "true";
const customDomainDnsTarget = publicAppDomain;
const cloudflareApiBase = "https://api.cloudflare.com/client/v4";
const cloudflareApiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const cloudflareZoneId = String(process.env.CLOUDFLARE_ZONE_ID || "").trim();
const cloudflareSaasCnameTarget = String(process.env.CLOUDFLARE_SAAS_CNAME_TARGET || "").trim();
const cloudflareFallbackOrigin = String(process.env.CLOUDFLARE_FALLBACK_ORIGIN || "").trim();
const cloudflareHostnameSslMethod = String(process.env.CLOUDFLARE_CUSTOM_HOSTNAME_SSL_METHOD || "http").trim().toLowerCase();
const godaddyApiBase = "https://api.godaddy.com/v1";
const godaddySecondLevelTlds = new Set([
  "co.in",
  "org.in",
  "net.in",
  "gen.in",
  "firm.in",
  "ind.in",
  "ac.in",
  "edu.in",
  "gov.in",
  "mil.in",
]);
const razorpayApiBase = "https://api.razorpay.com/v1";
const builtInAdminEmails = ["yogshkukadiya92@gmail.com", "yogeshkukadiya92@gmail.com"];
const builtInLifetimeEmails = ["yogeshkukadiya92@gmail.com"];
const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const rateLimitState = new Map();
const webhookAllowedEvents = new Set([
  "link.created",
  "link.updated",
  "link.deleted",
  "link.clicked",
  "form.submitted",
  "subscription.activated",
  "subscription.updated",
]);
const webhookDeliveryTimeoutMs = Math.max(3000, Number(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS || 9000));

const appRoutes = new Set([
  "/",
  "/auth",
  "/admin",
  "/home",
  "/links",
  "/qr-codes",
  "/pages",
  "/analytics",
  "/campaigns",
  "/custom-domains",
  "/settings",
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

ensureStorage();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    applySecurityHeaders(req, res);

    if (!(await isRequestAllowedByOrigin(req, pathname))) {
      return sendJson(res, 403, { error: "Blocked by security policy." });
    }

    const limiterBlock = evaluateRateLimit(req, pathname);
    if (limiterBlock) {
      const retrySeconds = Math.max(1, Math.ceil(limiterBlock.retryAfterMs / 1000));
      res.setHeader("Retry-After", String(retrySeconds));
      return sendJson(res, 429, { error: "Too many requests. Please try again shortly." });
    }

    if (req.method === "POST" && pathname === "/api/auth/signup") {
      const body = await readRequestBody(req);
      return await handleSignup(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readRequestBody(req);
      return await handleLogin(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/profile") {
      const body = await readRequestBody(req);
      return await withAuth(req, res, (user) => handleUpdateProfile(body, req, res, user));
    }

    if (req.method === "POST" && pathname === "/api/auth/change-password") {
      const body = await readRequestBody(req);
      return await withAuth(req, res, (user) => handleChangePassword(body, res, user));
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      return await handleLogout(req, res);
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      return await handleAuthMe(req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/forgot-password") {
      const body = await readRequestBody(req);
      return await handleForgotPassword(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/reset-password") {
      const body = await readRequestBody(req);
      return await handleResetPassword(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/send-verification") {
      const body = await readRequestBody(req);
      return await handleSendVerification(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/verify-email") {
      const body = await readRequestBody(req);
      return handleVerifyEmail(body, req, res);
    }

    if (req.method === "GET" && pathname === "/api/auth/google") {
      return sendJson(res, 501, { error: "Google login needs OAuth credentials before it can be enabled." });
    }

    if (req.method === "GET" && pathname === "/api/billing/status") {
      return await withAuth(req, res, (user) => sendJson(res, 200, { billing: serializeBilling(user) }));
    }

    if (req.method === "POST" && pathname === "/api/billing/subscribe") {
      const body = await readRequestBody(req);
      return await withAuth(req, res, (user) => handleCreateSubscription(user, req, res, body));
    }

    if (req.method === "POST" && pathname === "/api/billing/coupon/preview") {
      const body = await readRequestBody(req);
      return await withAuth(req, res, (user) => handleCouponPreview(user, body, res));
    }

    if (req.method === "POST" && pathname === "/api/billing/refresh") {
      return await withAuth(req, res, (user) => handleRefreshSubscription(user, req, res));
    }

    if (req.method === "POST" && pathname === "/api/billing/razorpay/webhook") {
      const rawBody = await readRawRequestBody(req);
      return await handleRazorpayWebhook(rawBody, req, res);
    }

    if (req.method === "GET" && pathname === "/api/admin/overview") {
      return await withAdmin(req, res, () => handleAdminOverview(req, res));
    }

    if (req.method === "GET" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/links")) {
      const userId = pathname.split("/")[4];
      return await withAdmin(req, res, () => handleAdminUserLinks(userId, res));
    }

    if (req.method === "GET" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/export")) {
      const userId = pathname.split("/")[4];
      return await withAdmin(req, res, () => handleAdminUserExport(userId, req, res));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/block")) {
      const body = await readRequestBody(req);
      const userId = pathname.split("/")[4];
      return await withAdmin(req, res, (adminUser) => handleAdminBlockUser(userId, body, res, adminUser));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/delete-links")) {
      const userId = pathname.split("/")[4];
      return await withAdmin(req, res, (adminUser) => handleAdminDeleteUserLinks(userId, "", req, res, adminUser));
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/admin/users/") && pathname.includes("/links/")) {
      const parts = pathname.split("/");
      const userId = parts[4];
      const slug = parts.slice(6).join("/");
      return await withAdmin(req, res, (adminUser) => handleAdminDeleteUserLinks(userId, slug, req, res, adminUser));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/subscription")) {
      const body = await readRequestBody(req);
      const userId = pathname.split("/")[4];
      return await withAdmin(req, res, (adminUser) => handleAdminSubscriptionUpdate(userId, body, res, adminUser));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/trial")) {
      const body = await readRequestBody(req);
      const userId = pathname.split("/")[4];
      return await withAdmin(req, res, (adminUser) => handleAdminTrialUpdate(userId, body, res, adminUser));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/verify")) {
      const userId = pathname.split("/")[4];
      return await withAdmin(req, res, (adminUser) => handleAdminVerifyUser(userId, res, adminUser));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/sessions/") && pathname.endsWith("/revoke")) {
      const sessionToken = pathname.split("/")[4];
      return await withAdmin(req, res, (adminUser) => handleAdminRevokeSession(sessionToken, res, adminUser));
    }

    if (req.method === "POST" && pathname === "/api/admin/coupons") {
      const body = await readRequestBody(req);
      return await withAdmin(req, res, (adminUser) => handleAdminSaveCoupon(body, res, adminUser));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/coupons/") && pathname.endsWith("/delete")) {
      const couponCode = pathname.split("/")[4];
      return await withAdmin(req, res, (adminUser) => handleAdminDeleteCoupon(couponCode, res, adminUser));
    }

    if (req.method === "GET" && pathname === "/api/links") {
      return await withAppAccess(req, res, async (user) => sendJson(res, 200, { links: await readLinksForUserAsync(user.id) }));
    }

    if (req.method === "POST" && pathname === "/api/links/health-check") {
      const body = await readRequestBody(req);
      return await withAppAccess(req, res, (user) => handleLinksHealthCheck(body, req, res, user));
    }

    if (req.method === "GET" && pathname === "/api/analytics") {
        return await withAppAccess(req, res, async (user) => sendJson(res, 200, { analytics: await buildAnalyticsReport(user.id, parseAnalyticsFilters(requestUrl.searchParams)) }));
      }

    if (req.method === "GET" && pathname === "/api/analytics/export") {
        return await withAppAccess(req, res, (user) => handleAnalyticsExport(req, res, user, parseAnalyticsFilters(requestUrl.searchParams)));
      }

    if (req.method === "GET" && pathname === "/api/pages") {
      return await withAppAccess(req, res, async (user) => sendJson(res, 200, { pages: await readPagesForUserAsync(user.id, req) }));
    }

    if (req.method === "GET" && pathname.startsWith("/api/pages/") && pathname.endsWith("/export")) {
      const pageId = pathname.split("/")[3];
      return await withAppAccess(req, res, (user) => handlePageExport(pageId, req, res, user));
    }

    if (req.method === "POST" && pathname === "/api/pages") {
      const body = await readRequestBody(req);
      return await withAppAccess(req, res, (user) => handleSavePage(body, req, res, user));
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/pages/")) {
      const pageId = pathname.split("/").pop();
      return await withAppAccess(req, res, (user) => handleDeletePage(pageId, res, user));
    }

    if (req.method === "POST" && pathname.startsWith("/api/forms/") && pathname.endsWith("/submit")) {
      const body = await readRequestBody(req);
      const slug = pathname.split("/")[3];
      return await handlePublicFormSubmit(slug, body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/links") {
      const body = await readRequestBody(req);
      return await withAppAccess(req, res, (user) => handleCreateLink(body, req, res, user));
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/links/")) {
      const slug = pathname.split("/").pop();
      const body = await readRequestBody(req);
      return await withAppAccess(req, res, (user) => handleUpdateLink(slug, body, req, res, user));
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/links/")) {
      const slug = pathname.split("/").pop();
      return await withAppAccess(req, res, (user) => handleDeleteLink(slug, req, res, user));
    }

    if (req.method === "GET" && pathname === "/api/trash-links") {
      return await withAppAccess(req, res, async (user) => sendJson(res, 200, { trashLinks: await readTrashLinksForUserAsync(user.id, req) }));
    }

    if (req.method === "POST" && pathname.startsWith("/api/trash-links/") && pathname.endsWith("/restore")) {
      const slug = pathname.split("/")[3];
      return await withAppAccess(req, res, (user) => handleRestoreTrashLink(slug, req, res, user));
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/trash-links/")) {
      const slug = pathname.split("/").pop();
      return await withAppAccess(req, res, (user) => handleDeleteTrashLinkForever(slug, req, res, user));
    }

    if (req.method === "GET" && pathname === "/api/webhooks") {
      return await withAppAccess(req, res, (user) => handleListWebhooks(req, res, user));
    }

    if (req.method === "POST" && pathname === "/api/webhooks") {
      const body = await readRequestBody(req);
      return await withAppAccess(req, res, (user) => handleUpsertWebhook(body, req, res, user));
    }

    if (req.method === "POST" && pathname.startsWith("/api/webhooks/") && pathname.endsWith("/test")) {
      const webhookId = pathname.split("/")[3];
      return await withAppAccess(req, res, (user) => handleTestWebhook(webhookId, req, res, user));
    }

    if (req.method === "POST" && pathname.startsWith("/api/webhooks/") && pathname.endsWith("/delete")) {
      const webhookId = pathname.split("/")[3];
      return await withAppAccess(req, res, (user) => handleDeleteWebhook(webhookId, req, res, user));
    }

    if (req.method === "GET" && pathname === "/api/settings") {
      return await withAppAccess(req, res, async (user) => sendJson(res, 200, { settings: await readSettingsForUserAsync(user.id, req) }));
    }

    if (req.method === "POST" && pathname === "/api/settings") {
      const body = await readRequestBody(req);
      return await withAppAccess(req, res, (user) => handleSaveSettings(body, req, res, user));
    }

    if (req.method === "GET" && pathname.startsWith("/api/domains/verify/")) {
      const domain = decodeURIComponent(pathname.split("/").pop());
      return await withAppAccess(req, res, (user) => handleVerifyDomain(domain, req, res, user));
    }

    if (req.method === "POST" && pathname === "/api/domains/godaddy/connect") {
      const body = await readRequestBody(req);
      return await withAppAccess(req, res, (user) => handleGoDaddyConnect(body, req, res, user));
    }

    if (req.method === "POST" && pathname === "/api/domains/godaddy/disconnect") {
      return await withAppAccess(req, res, (user) => handleGoDaddyDisconnect(req, res, user));
    }

    if (req.method === "GET" && pathname === "/api/team") {
      return await withAppAccess(req, res, (user) => handleGetTeamMembers(req, res, user));
    }

    if (req.method === "POST" && pathname === "/api/team") {
      const body = await readRequestBody(req);
      return await withAppAccess(req, res, (user) => handleUpsertTeamMember(body, req, res, user));
    }

    if (req.method === "POST" && pathname.startsWith("/api/team/") && pathname.endsWith("/remove")) {
      const memberId = pathname.split("/")[3];
      return await withAppAccess(req, res, (user) => handleRemoveTeamMember(memberId, req, res, user));
    }

    if (req.method === "POST" && pathname.startsWith("/api/unlock/")) {
      const body = await readRequestBody(req);
      const slug = pathname.split("/").pop();
      return await handleUnlockProtectedLink(slug, body, req, res);
    }

    if (req.method === "GET" && pathname.startsWith("/forms/")) {
      const slug = pathname.split("/")[2];
      return await handlePublicFormPage(slug, req, res);
    }

    if (req.method === "GET" && appRoutes.has(pathname)) {
      return serveFile(path.join(rootDir, "index.html"), res);
    }

    if (req.method === "GET" && (pathname === "/styles.css" || pathname === "/script.js")) {
      return serveFile(path.join(rootDir, pathname.slice(1)), res);
    }

    if (req.method === "GET") {
      const slug = pathname.replace(/^\/+/, "");

      if (slug) {
        return await handleRedirect(slug, req, res);
      }
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = String(error?.message || "");
    if (message === "Request body too large") {
      sendJson(res, 413, { error: "Request body too large." });
      return;
    }
    if (message === "Invalid JSON body") {
      sendJson(res, 400, { error: "Invalid JSON body." });
      return;
    }
    sendJson(res, 500, { error: "Server error", ...(isProduction ? {} : { details: message }) });
  }
});

server.listen(port, host, () => {
  console.log(`AnyLink server running at http://${host}:${port}`);
});

function ensureStorage() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  ensureJsonFile(linksFile, []);
  ensureJsonFile(pagesFile, []);
  ensureJsonFile(settingsFile, []);
  ensureJsonFile(usersFile, []);
  ensureJsonFile(sessionsFile, []);
  ensureJsonFile(activityFile, {});
  ensureJsonFile(couponsFile, []);
  ensureJsonFile(godaddyTokensFile, []);
  ensureJsonFile(auditLogsFile, []);
}

function ensureJsonFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2), "utf8");
  }
}

function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(fallbackValue) ? (Array.isArray(parsed) ? parsed : fallbackValue) : parsed;
  } catch {
    return fallbackValue;
  }
}

function writeJsonFile(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function readLinks() {
  return readJsonFile(linksFile, []);
}

function readPages() {
  return readJsonFile(pagesFile, []);
}

function writePages(pages) {
  writeJsonFile(pagesFile, pages);
}

function readPagesForUser(userId, req) {
  return readPages()
    .filter((item) => item.userId === userId)
    .map((item) => normalizePage(item, req));
}

async function readPagesForUserAsync(userId, req) {
  try {
    const pages = await listPagesByUser(userId);
    if (Array.isArray(pages) && pages.length) {
      const filePages = !dbOnlyMode ? readPages().filter((item) => item.userId === userId) : [];
      return pages.map((page) => {
        const fallbackPage = filePages.find((item) => item.id === page.id || item.slug === page.slug);
        return mapDbPageRecord(page, req, fallbackPage);
      });
    }
    if (dbOnlyMode) {
      return [];
    }
  } catch {
    if (dbOnlyMode) {
      return [];
    }
  }

  return readPagesForUser(userId, req);
}

async function findNormalizedPageByIdAsync(pageId, userId, req) {
  try {
    const page = await findPageById(pageId, userId);
    if (page) {
      const fallbackPage = !dbOnlyMode ? readPages().find((item) => item.id === pageId && item.userId === userId) : null;
      return mapDbPageRecord(page, req, fallbackPage);
    }
    if (dbOnlyMode) {
      return null;
    }
  } catch {
    if (dbOnlyMode) {
      return null;
    }
  }

  const stored = readPages().find((item) => item.id === pageId && item.userId === userId);
  return stored ? normalizePage(stored, req) : null;
}

async function findNormalizedPageBySlugAsync(slug, req) {
  try {
    const page = await findPageBySlug(slug);
    if (page) {
      const fallbackPage = !dbOnlyMode ? readPages().find((item) => item.slug === slug) : null;
      return mapDbPageRecord(page, req, fallbackPage);
    }
    if (dbOnlyMode) {
      return null;
    }
  } catch {
    if (dbOnlyMode) {
      return null;
    }
  }

  const stored = readPages().find((item) => item.slug === slug);
  return stored ? normalizePage(stored, req) : null;
}

function readLinksForUser(userId) {
  return readLinks().filter((item) => item.userId === userId);
}

async function readLinksForUserAsync(userId) {
  try {
    const links = await listLinksByUser(userId);
    if (Array.isArray(links) && links.length) {
      return links.map((item) => ({
        id: item.id,
        userId: item.userId,
        slug: item.slug,
        destination: item.destination,
        shortUrl: item.shortUrl,
        includeQr: Boolean(item.includeQr),
        createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
        analytics: createEmptyAnalytics(),
      }));
    }
    if (dbOnlyMode) {
      return [];
    }
  } catch {
    if (dbOnlyMode) {
      return [];
    }
  }

  return readLinksForUser(userId);
}

function writeLinks(links) {
  writeJsonFile(linksFile, links);
}

function readUsers() {
  return readJsonFile(usersFile, []);
}

function writeUsers(users) {
  writeJsonFile(usersFile, users);
}

function getUserAccessOverride(userId) {
  return readUsers().find((item) => item.id === userId) || null;
}

function mergeUserAccessOverride(user) {
  if (!user?.id) {
    return user;
  }

  const override = getUserAccessOverride(user.id);
  if (!override) {
    return user;
  }

  return {
    ...user,
    isBlocked: Boolean(override.isBlocked),
    blockedAt: Number(override.blockedAt || 0),
    blockedReason: String(override.blockedReason || ""),
  };
}

function persistUserAccessOverride(user, updates = {}) {
  if (!user?.id) {
    return null;
  }

  const users = readUsers();
  const index = users.findIndex((item) => item.id === user.id);
  const existing = index >= 0 ? users[index] : {};
  const nextUser = {
    ...existing,
    id: user.id,
    name: existing.name || user.name || "User",
    email: existing.email || user.email || "",
    emailVerified: Boolean(existing.emailVerified || user.emailVerified),
    isAdmin: Boolean(existing.isAdmin || user.isAdmin),
    subscriptionStatus: existing.subscriptionStatus || user.subscriptionStatus || "inactive",
    trialStartedAt: Number(existing.trialStartedAt || user.trialStartedAt || 0),
    trialEndsAt: Number(existing.trialEndsAt || user.trialEndsAt || 0),
    subscriptionStartedAt: Number(existing.subscriptionStartedAt || user.subscriptionStartedAt || 0),
    subscriptionExpiresAt: Number(existing.subscriptionExpiresAt || user.subscriptionExpiresAt || 0),
    createdAt: existing.createdAt || user.createdAt || Date.now(),
    ...updates,
    updatedAt: Date.now(),
  };

  if (index >= 0) {
    users[index] = nextUser;
  } else {
    users.push(nextUser);
  }

  writeUsers(users);
  return nextUser;
}

function readSessions() {
  const sessions = readJsonFile(sessionsFile, []);
  const now = Date.now();
  const validSessions = sessions.filter((session) => Number(session.expiresAt) > now);

  if (validSessions.length !== sessions.length) {
    writeSessions(validSessions);
  }

  return validSessions;
}

function writeSessions(sessions) {
  writeJsonFile(sessionsFile, sessions);
}

function readCoupons() {
  return readJsonFile(couponsFile, [])
    .map((coupon) => normalizeCoupon(coupon))
    .filter(Boolean)
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
}

function writeCoupons(coupons) {
  writeJsonFile(couponsFile, coupons);
}

function readGoDaddyTokens() {
  return readJsonFile(godaddyTokensFile, [])
    .filter((item) => item && item.userId);
}

function writeGoDaddyTokens(tokens) {
  writeJsonFile(godaddyTokensFile, tokens);
}

function getGoDaddyTokenForUser(userId) {
  const tokens = readGoDaddyTokens();
  return tokens.find((item) => item.userId === userId) || null;
}

function setGoDaddyTokenForUser(userId, apiKey, apiSecret) {
  const tokens = readGoDaddyTokens();
  const filtered = tokens.filter((item) => item.userId !== userId);
  filtered.push({
    userId,
    apiKey,
    apiSecret,
    updatedAt: Date.now(),
  });
  writeGoDaddyTokens(filtered);
}

function clearGoDaddyTokenForUser(userId) {
  const tokens = readGoDaddyTokens();
  const nextTokens = tokens.filter((item) => item.userId !== userId);
  writeGoDaddyTokens(nextTokens);
}

function getDomainAutomationStateForUser(userId) {
  const token = userId ? getGoDaddyTokenForUser(userId) : null;
  return {
    provider: "godaddy",
    connected: Boolean(token && token.apiKey && token.apiSecret),
  };
}

function normalizeCoupon(coupon) {
  const code = String(coupon?.code || "").trim().toUpperCase();
  if (!code) {
    return null;
  }

  const type = String(coupon?.type || "plan").trim().toLowerCase();
  return {
    code,
    label: String(coupon?.label || "").trim(),
    type: ["plan", "free_days", "lifetime"].includes(type) ? type : "plan",
    value: Math.max(0, Number(coupon?.value || 0)),
    planId: String(coupon?.planId || "").trim(),
    active: coupon?.active !== false,
    createdAt: Number(coupon?.createdAt || Date.now()),
    updatedAt: Number(coupon?.updatedAt || Date.now()),
  };
}

function findCouponByCode(code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }
  return readCoupons().find((coupon) => coupon.code === normalizedCode && coupon.active) || null;
}

function readSettingsStore() {
  const parsed = readJsonFile(settingsFile, []);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  return [];
}

function writeSettingsStore(store) {
  writeJsonFile(settingsFile, store);
}

function readSettingsForUser(userId, req) {
  const store = readSettingsStore();
  const existing = store.find((item) => item.userId === userId);
  return normalizeSettings(existing || { userId }, req);
}

async function readSettingsForUserAsync(userId, req) {
  try {
    const dbSettings = await getDbWorkspaceSettings(userId);
    const dbDomains = await listDomainsByUser(userId);
    const fileExtras = !dbOnlyMode ? readSettingsForUser(userId, req) : null;

      if (dbSettings) {
        const mergedDomainEntries = [
          ...(Array.isArray(fileExtras?.domainEntries) ? fileExtras.domainEntries : []),
          ...dbDomains.map((item) => ({
            host: item.host,
            status: item.status,
            isActive: item.isActive,
            dnsTarget: item.dnsTarget,
            verifiedAt: item.verifiedAt,
            provider: item.provider || null,
            sslStatus: item.sslStatus || null,
            ownershipStatus: item.ownershipStatus || null,
            providerHostnameId: item.providerHostnameId || null,
            verificationErrors: [],
          })),
        ];
      return normalizeSettings({
          userId,
          workspaceName: dbSettings.workspaceName,
          defaultDomain: dbSettings.defaultDomain,
          domains: [
            dbSettings.defaultDomain,
            ...dbDomains.map((item) => item.host),
          ],
          conversionGoals: fileExtras?.conversionGoals || {},
          goalAlertState: fileExtras?.goalAlertState || {},
          linkRules: fileExtras?.linkRules || {},
          linkHealth: fileExtras?.linkHealth || {},
          campaignTemplates: fileExtras?.campaignTemplates || [],
          pixelTemplates: fileExtras?.pixelTemplates || [],
          teamMembers: fileExtras?.teamMembers || [],
          webhooks: fileExtras?.webhooks || [],
          trashLinks: fileExtras?.trashLinks || [],
          campaigns: fileExtras?.campaigns || [],
          domainEntries: mergedDomainEntries,
        }, req);
      }
    if (dbOnlyMode) {
      return normalizeSettings({ userId }, req);
    }
  } catch {
    if (dbOnlyMode) {
      return normalizeSettings({ userId }, req);
    }
  }

  return readSettingsForUser(userId, req);
}

function writeSettingsExtras(userId, req, updater) {
  if (dbOnlyMode) {
    return null;
  }

  const store = readSettingsStore();
  const existing = store.find((item) => item.userId === userId) || normalizeSettings({ userId }, req);
  const nextPartial = updater(existing);
  const normalized = normalizeSettings({
    ...existing,
    ...nextPartial,
  }, req);

  const nextStore = store.filter((item) => item.userId !== userId);
  nextStore.push(normalized);
  writeSettingsStore(nextStore);
  return normalized;
}

async function readTrashLinksForUserAsync(userId, req) {
  const settings = await readSettingsForUserAsync(userId, req);
  return Array.isArray(settings.trashLinks) ? settings.trashLinks : [];
}

function readActivityStore() {
  return readJsonFile(activityFile, {});
}

function writeActivityStore(store) {
  writeJsonFile(activityFile, store || {});
}

function readAuditLogs() {
  return readJsonFile(auditLogsFile, [])
    .filter((item) => item && typeof item === "object")
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
}

function writeAuditLogs(items) {
  writeJsonFile(auditLogsFile, items || []);
}

function appendAuditLog(action, actor = {}, metadata = {}) {
  const logs = readAuditLogs();
  logs.unshift({
    id: crypto.randomUUID(),
    action: String(action || "").trim() || "system.event",
    actorUserId: String(actor.userId || "").trim(),
    actorEmail: String(actor.email || "").trim(),
    actorType: String(actor.type || "system").trim().toLowerCase(),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    createdAt: Date.now(),
  });
  writeAuditLogs(logs.slice(0, 1500));
}

function getDefaultActivitySummary(userId) {
  return {
    userId,
    totalTimeMs: 0,
    pageViews: 0,
    visits: 0,
    linksCreated: 0,
    lastActiveAt: 0,
    lastPage: "",
    pages: {},
  };
}

function readActivitySummary(userId) {
  const store = readActivityStore();
  return {
    ...getDefaultActivitySummary(userId),
    ...(store?.[userId] || {}),
    pages: store?.[userId]?.pages && typeof store[userId].pages === "object" ? store[userId].pages : {},
  };
}

function updateActivitySummary(userId, updater) {
  const store = readActivityStore();
  const current = {
    ...getDefaultActivitySummary(userId),
    ...(store?.[userId] || {}),
    pages: store?.[userId]?.pages && typeof store[userId].pages === "object" ? store[userId].pages : {},
  };
  const next = updater(current) || current;
  store[userId] = {
    ...getDefaultActivitySummary(userId),
    ...next,
    pages: next.pages && typeof next.pages === "object" ? next.pages : {},
  };
  writeActivityStore(store);
  return store[userId];
}

function summarizeTopPages(pages) {
  return Object.entries(pages || {})
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, 3)
    .map(([page, count]) => ({ page, count: Number(count || 0) }));
}

function handleActivityPing(body, res, user) {
  const page = String(body.page || "").trim().toLowerCase();
  const event = String(body.event || "heartbeat").trim().toLowerCase();
  const durationMs = Math.max(0, Math.min(5 * 60 * 1000, Number(body.durationMs) || 0));
  const now = Date.now();

  const summary = updateActivitySummary(user.id, (current) => {
    const nextPages = { ...(current.pages || {}) };

    if (page && event === "view") {
      nextPages[page] = Number(nextPages[page] || 0) + 1;
    }

    return {
      ...current,
      totalTimeMs: Number(current.totalTimeMs || 0) + durationMs,
      pageViews: Number(current.pageViews || 0) + (event === "view" ? 1 : 0),
      visits: Number(current.visits || 0) + (event === "view" ? 1 : 0),
      lastActiveAt: now,
      lastPage: page || current.lastPage || "",
      pages: nextPages,
    };
  });

  return sendJson(res, 200, {
    success: true,
    activity: {
      totalTimeMs: summary.totalTimeMs,
      pageViews: summary.pageViews,
      visits: summary.visits,
      linksCreated: summary.linksCreated,
      lastActiveAt: summary.lastActiveAt,
      lastPage: summary.lastPage,
    },
  });
}

function applySecurityHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
}

let cachedCsrfAllowedHostnames = new Set();
let cachedCsrfAllowedHostnamesExpiresAt = 0;

async function getCsrfAllowedHostnames() {
  const now = Date.now();
  if (now < cachedCsrfAllowedHostnamesExpiresAt && cachedCsrfAllowedHostnames.size) {
    return cachedCsrfAllowedHostnames;
  }

  const next = new Set([String(publicAppDomain || "").trim().toLowerCase()].filter(Boolean));

  try {
    const domains = await prisma.customDomain.findMany({ select: { host: true } });
    for (const domain of domains || []) {
      const host = String(domain?.host || "").trim().toLowerCase();
      if (host) next.add(host);
    }
  } catch {
    // If DB is temporarily unavailable, fall back to the default domain only.
  }

  cachedCsrfAllowedHostnames = next;
  cachedCsrfAllowedHostnamesExpiresAt = now + 60 * 1000;
  return next;
}

async function isRequestAllowedByOrigin(req, pathname) {
  const method = String(req.method || "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;
  if (!String(pathname || "").startsWith("/api/")) return true;
  if (pathname === "/api/billing/razorpay/webhook") return true;

  const source = String(req.headers.origin || req.headers.referer || "").trim();
  if (!source) return true;

  const forwardedHostHeader = String(
    req.headers["x-original-host"] ||
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    ""
  ).trim().toLowerCase();
  if (!forwardedHostHeader) return false;
  const requestHostname = forwardedHostHeader.split(",")[0].trim().split(":")[0] || "";
  if (!requestHostname) return false;

  try {
    const parsed = new URL(source);
    const sourceHost = String(parsed.hostname || "").toLowerCase();
    const sourceOrigin = String(parsed.origin || "").toLowerCase();
    if (sourceHost && sourceHost === requestHostname) return true;
    if (allowedOrigins.has(sourceOrigin)) return true;

    const allowedHostnames = await getCsrfAllowedHostnames();
    return allowedHostnames.has(sourceHost) && allowedHostnames.has(requestHostname);
  } catch {
    return false;
  }
}

function evaluateRateLimit(req, pathname) {
  const method = String(req.method || "GET").toUpperCase();
  const lowerPath = String(pathname || "").toLowerCase();
  if (!lowerPath.startsWith("/api/")) return null;
  const ip = getRateLimitClientIp(req);
  if (!ip) return null;

  const limits = [];
  if (lowerPath.startsWith("/api/auth/")) {
    limits.push({ key: `auth:${ip}`, max: 45, windowMs: 10 * 60 * 1000 });
    if (lowerPath.endsWith("/login")) {
      limits.push({ key: `auth-login:${ip}`, max: 12, windowMs: 5 * 60 * 1000 });
    }
  }
  if (lowerPath.startsWith("/api/admin/")) {
    limits.push({ key: `admin:${ip}`, max: 120, windowMs: 60 * 1000 });
  }
  if (lowerPath.startsWith("/api/unlock/")) {
    const slug = lowerPath.split("/").pop() || "unknown";
    limits.push({ key: `unlock:${ip}:${slug}`, max: 20, windowMs: 10 * 60 * 1000 });
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && lowerPath.startsWith("/api/")) {
    limits.push({ key: `write:${ip}`, max: 240, windowMs: 60 * 1000 });
  }
  limits.push({ key: `global:${ip}`, max: 1200, windowMs: 60 * 1000 });

  for (const limit of limits) {
    const hit = hitRateLimit(limit.key, limit.max, limit.windowMs);
    if (hit) return hit;
  }

  return null;
}

function hitRateLimit(key, max, windowMs) {
  const now = Date.now();
  const current = rateLimitState.get(key);
  if (!current || now >= current.resetAt) {
    rateLimitState.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  current.count += 1;
  if (current.count > max) {
    return { retryAfterMs: Math.max(1, current.resetAt - now) };
  }

  if (Math.random() < 0.003) pruneRateLimitState(now);
  return null;
}

function pruneRateLimitState(now = Date.now()) {
  for (const [key, value] of rateLimitState.entries()) {
    if (!value || now >= Number(value.resetAt || 0)) {
      rateLimitState.delete(key);
    }
  }
}

function getRateLimitClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  const remoteIp = String(req.socket?.remoteAddress || "").trim();
  return forwarded || realIp || remoteIp || "";
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (Buffer.byteLength(body, "utf8") > maxRequestBodyBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function readRawRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (Buffer.byteLength(body, "utf8") > maxRequestBodyBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function withAuth(req, res, handler) {
  const user = await getAuthenticatedUserAsync(req);

  if (!user) {
    return sendJson(res, 401, { error: "Authentication required." });
  }

  if (isUserBlocked(user)) {
    return sendJson(res, 423, { error: "This account has been blocked by an administrator." });
  }

  return handler(user);
}

async function withAppAccess(req, res, handler) {
  return withAuth(req, res, (user) => {
    if (!hasActiveAccess(user)) {
      return sendJson(res, 402, {
        error: "Trial ended. Subscription required.",
        billing: serializeBilling(user),
      });
    }

    return handler(user);
  });
}

async function withAdmin(req, res, handler) {
  return withAuth(req, res, (user) => {
    if (!isAdminUser(user)) {
      return sendJson(res, 403, { error: "Admin access required." });
    }

    return handler(user);
  });
}

function getAuthenticatedUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[sessionCookieName];

  if (!token) {
    return null;
  }

  const sessions = readSessions();
  const session = sessions.find((item) => item.token === token);

  if (!session) {
    return null;
  }

  const user = readUsers().find((item) => item.id === session.userId);
  return user || null;
}

async function getAuthenticatedUserAsync(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[sessionCookieName];

  if (!token) {
    return null;
  }

  try {
    const session = await findSessionByToken(token);
    if (session?.user) {
      return mergeUserAccessOverride(normalizeDbUser(session.user));
    }
  } catch {
    if (dbOnlyMode) {
      return null;
    }
    // Fall back to file-backed session lookup while migration is in progress.
  }

  return dbOnlyMode ? null : getAuthenticatedUser(req);
}

function isUserBlocked(user) {
  return Boolean(user?.isBlocked || user?.blockedAt || String(user?.subscriptionStatus || "").toLowerCase() === "blocked");
}

function buildStoredPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  return { salt, combined: `${salt}:${hash}` };
}

function verifyPassword(password, userLike) {
  const stored = String(userLike?.passwordHash || "");

  if (stored.includes(":")) {
    const [salt, hash] = stored.split(":");
    return hashPassword(password, salt) === hash;
  }

  if (userLike?.salt) {
    return hashPassword(password, userLike.salt) === stored;
  }

  return false;
}

function normalizeDbUser(user) {
  return {
    ...user,
    subscriptionStatus: String(user.subscriptionStatus || "").toLowerCase() || "inactive",
    trialStartedAt: user.trialStartedAt ? new Date(user.trialStartedAt).getTime() : 0,
    trialEndsAt: user.trialEndsAt ? new Date(user.trialEndsAt).getTime() : 0,
    subscriptionStartedAt: user.subscriptionStartedAt ? new Date(user.subscriptionStartedAt).getTime() : 0,
    subscriptionExpiresAt: user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt).getTime() : 0,
  };
}

async function ensureDbWorkspaceSettings(userId, req) {
  try {
    await upsertWorkspaceSettings(userId, {
      workspaceName: "AnyLink Workspace",
      defaultDomain: getDefaultShortDomain(req),
    });
  } catch {
    // Keep JSON settings as the fallback source while we migrate feature-by-feature.
  }
}

async function handleSignup(body, req, res) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!name || !email || !password) {
    return sendJson(res, 400, { error: "Name, email, and password are required." });
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return sendJson(res, 400, { error: "Enter a valid email address." });
  }

  if (password.length < 6) {
    return sendJson(res, 400, { error: "Password must be at least 6 characters." });
  }

  const users = dbOnlyMode ? [] : readUsers();
  let dbExistingUser = null;

  try {
    dbExistingUser = await findUserByEmail(email);
  } catch {
    dbExistingUser = null;
  }

  if (users.some((item) => item.email === email) || dbExistingUser) {
    return sendJson(res, 409, { error: "An account with this email already exists." });
  }

  const { salt, combined } = buildStoredPassword(password);
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    salt,
    passwordHash: combined,
    emailVerified: false,
    isAdmin: users.length === 0,
    subscriptionStatus: "trialing",
    trialStartedAt: Date.now(),
    trialEndsAt: Date.now() + trialLifetimeMs,
    subscriptionStartedAt: 0,
    subscriptionExpiresAt: 0,
    verificationToken: createToken(),
    verificationExpiresAt: Date.now() + verificationLifetimeMs,
    resetToken: "",
    resetExpiresAt: 0,
    createdAt: new Date().toISOString(),
  };

  if (!dbOnlyMode) {
    users.push(user);
    writeUsers(users);
    ensureUserSettings(user.id, req);
  }
  await ensureDbWorkspaceSettings(user.id, req);

  try {
    await createDbUser({
      id: user.id,
      name,
      email,
      passwordHash: combined,
      emailVerified: false,
      isAdmin: users.length === 1,
      subscriptionStatus: "TRIALING",
      trialStartedAt: new Date(user.trialStartedAt),
      trialEndsAt: new Date(user.trialEndsAt),
      subscriptionStartedAt: null,
      subscriptionExpiresAt: null,
      createdAt: new Date(user.createdAt),
    });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to create your account right now. Please try again." });
    }
    // JSON remains the live fallback while DB migration rolls out.
  }

  const verificationUrl = buildAuthUrl(req, "verify", user.verificationToken);
  const verificationEmailSent = await sendTransactionalEmail({
    to: user.email,
    subject: "Verify your AnyLink email",
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#183153"><h2 style="margin:0 0 12px;">Welcome to AnyLink</h2><p style="margin:0 0 14px;">Please verify your email to secure your account.</p><p style="margin:0 0 20px;"><a href="${verificationUrl}" style="display:inline-block;background:#2852e0;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Verify email</a></p></div>`,
    text: `Verify your AnyLink email: ${verificationUrl}`,
  });

  return await createSessionResponse(user, req, res, 201, {
    verificationDelivery: verificationEmailSent ? "email" : "link",
    verificationMessage: verificationEmailSent ? "Verification email sent to your inbox." : "Email is not configured yet. Use the verification link below.",
    verificationUrl: verificationEmailSent ? "" : verificationUrl,
  });
}

async function handleLogin(body, req, res) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  let user = null;

  try {
    const dbUser = await findUserByEmail(email);
    if (dbUser && verifyPassword(password, dbUser)) {
      user = mergeUserAccessOverride(normalizeDbUser(dbUser));
    }
  } catch {
    user = null;
  }

  if (!user && !dbOnlyMode) {
    user = readUsers().find((item) => item.email === email);
    if (!user || !verifyPassword(password, user)) {
      return sendJson(res, 401, { error: "Invalid email or password." });
    }
  }

  if (!user) {
    return sendJson(res, 401, { error: "Invalid email or password." });
  }

  if (isUserBlocked(user)) {
    return sendJson(res, 423, { error: "This account has been blocked by an administrator." });
  }

  return await createSessionResponse(user, req, res, 200);
}

async function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[sessionCookieName];

  if (token) {
    if (!dbOnlyMode) {
      const sessions = readSessions().filter((item) => item.token !== token);
      writeSessions(sessions);
    }
    try {
      await deleteDbSessionByToken(token);
    } catch {
      // Ignore DB session delete failures during fallback mode.
    }
  }

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": buildSessionCookie("", { maxAge: 0 }),
  });
  res.end(JSON.stringify({ success: true }));
}

async function handleUpdateProfile(body, req, res, user) {
  const users = dbOnlyMode ? [] : readUsers();
  const record = users.find((item) => item.id === user.id) || { ...user };

  if (!record) {
    return sendJson(res, 404, { error: "User not found." });
  }

  const nextName = String(body.name || "").trim();

  if (nextName.length < 2) {
    return sendJson(res, 400, { error: "Name must be at least 2 characters." });
  }

  record.name = nextName;
  if (!dbOnlyMode) {
    writeUsers(users);
  }

  try {
    await updateDbUser(user.id, { name: nextName });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to update your profile right now." });
    }
    // Keep file-backed user as fallback until full migration is complete.
  }

  return sendJson(res, 200, { user: serializeUser(record) });
}

async function handleChangePassword(body, res, user) {
  const users = dbOnlyMode ? [] : readUsers();
  const record = users.find((item) => item.id === user.id) || { ...user };

  if (!record) {
    return sendJson(res, 404, { error: "User not found." });
  }

  const currentPassword = String(body.currentPassword || "");
  const nextPassword = String(body.newPassword || "");
  const confirmPassword = String(body.confirmPassword || "");

  if (!currentPassword || !nextPassword || !confirmPassword) {
    return sendJson(res, 400, { error: "Fill in all password fields." });
  }

  if (!verifyPassword(currentPassword, record)) {
    return sendJson(res, 400, { error: "Current password is incorrect." });
  }

  if (nextPassword.length < 6) {
    return sendJson(res, 400, { error: "New password must be at least 6 characters." });
  }

  if (nextPassword !== confirmPassword) {
    return sendJson(res, 400, { error: "New password and confirm password must match." });
  }

  const { salt, combined } = buildStoredPassword(nextPassword);
  record.salt = salt;
  record.passwordHash = combined;
  record.resetToken = "";
  record.resetExpiresAt = 0;
  if (!dbOnlyMode) {
    writeUsers(users);
  }

  try {
    await updateDbUser(user.id, { passwordHash: combined });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to update your password right now." });
    }
    // Keep file-backed password as fallback until full migration is complete.
  }

  return sendJson(res, 200, { success: true, message: "Password updated successfully." });
}

async function handleAuthMe(req, res) {
  const user = await getAuthenticatedUserAsync(req);

  if (!user) {
    return sendJson(res, 200, { user: null });
  }

  return sendJson(res, 200, { user: serializeUser(user), billing: serializeBilling(user) });
}

async function handleForgotPassword(body, req, res) {
  const email = String(body.email || "").trim().toLowerCase();
  const users = dbOnlyMode ? [] : readUsers();
  let user = !dbOnlyMode ? users.find((item) => item.email === email) : null;
  let dbUser = null;

  try {
    dbUser = await findUserByEmail(email);
    if (!user && dbUser && !dbOnlyMode) {
      user = {
        id: dbUser.id,
        name: dbUser.name || email.split("@")[0] || "User",
        email: String(dbUser.email || "").trim().toLowerCase(),
        passwordHash: String(dbUser.passwordHash || ""),
        salt: "",
        emailVerified: Boolean(dbUser.emailVerified),
        isAdmin: Boolean(dbUser.isAdmin),
        subscriptionStatus: String(dbUser.subscriptionStatus || "inactive").toLowerCase(),
        trialStartedAt: dbUser.trialStartedAt ? new Date(dbUser.trialStartedAt).getTime() : 0,
        trialEndsAt: dbUser.trialEndsAt ? new Date(dbUser.trialEndsAt).getTime() : 0,
        subscriptionStartedAt: dbUser.subscriptionStartedAt ? new Date(dbUser.subscriptionStartedAt).getTime() : 0,
        subscriptionExpiresAt: dbUser.subscriptionExpiresAt ? new Date(dbUser.subscriptionExpiresAt).getTime() : 0,
        createdAt: dbUser.createdAt ? new Date(dbUser.createdAt).toISOString() : new Date().toISOString(),
        resetToken: "",
        resetOtp: "",
        resetExpiresAt: 0,
        verificationToken: "",
        verificationExpiresAt: 0,
      };
      users.push(user);
    }
  } catch {
    // Keep file-backed fallback if DB lookup is unavailable.
  }

  if (!user && !dbUser) {
    return sendJson(res, 200, {
      success: true,
      delivery: "email",
      message: "If that email exists, a password reset OTP has been sent.",
    });
  }

  const resetToken = createToken();
  const resetOtp = createOtp();
  const resetExpiresAt = Date.now() + resetLifetimeMs;

  if (dbUser) {
    try {
      await prisma.authToken.deleteMany({
        where: {
          userId: dbUser.id,
          type: { in: ["password_reset", "password_reset_otp"] },
        },
      });
      await prisma.authToken.createMany({
        data: [
          {
            userId: dbUser.id,
            type: "password_reset",
            token: resetToken,
            expiresAt: new Date(resetExpiresAt),
          },
          {
            userId: dbUser.id,
            type: "password_reset_otp",
            token: buildResetOtpToken(email, resetOtp),
            expiresAt: new Date(resetExpiresAt),
          },
        ],
      });
    } catch (error) {
      console.error("Unable to create reset OTP:", error?.message || error);
      if (dbOnlyMode) {
        return sendJson(res, 500, { error: "Unable to generate a reset OTP right now." });
      }
    }
  }

  if (user && !dbOnlyMode) {
    user.resetToken = resetToken;
    user.resetOtp = resetOtp;
    user.resetExpiresAt = resetExpiresAt;
    writeUsers(users);
  }

  const resetUrl = buildAuthUrl(req, "reset", resetToken);
  const emailSent = await sendTransactionalEmail({
    to: email,
    subject: "Your ShortLink password reset OTP",
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#183153"><h2 style="margin:0 0 12px;">Reset your password</h2><p style="margin:0 0 14px;">Use this OTP to reset your ShortLink password. It expires in 30 minutes.</p><p style="font-size:28px;letter-spacing:8px;font-weight:800;margin:0 0 18px;color:#0c2d66;">${resetOtp}</p><p style="margin:0 0 20px;">Or click the secure reset button below.</p><p style="margin:0 0 20px;"><a href="${resetUrl}" style="display:inline-block;background:#2852e0;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Reset password</a></p><p style="margin:0;color:#5f7399;">If you did not request this, you can safely ignore this email.</p></div>`,
    text: `Your ShortLink password reset OTP is ${resetOtp}. It expires in 30 minutes. Reset link: ${resetUrl}`,
  });

  return sendJson(res, 200, {
    success: true,
    delivery: emailSent ? "email" : "link",
    message: emailSent ? "Password reset OTP sent to your email." : "Email is not configured yet. Use the reset link below.",
    resetUrl: emailSent ? "" : resetUrl,
  });
}

async function handleResetPassword(body, req, res) {
  const token = String(body.token || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const otp = String(body.otp || body.code || "").replace(/\D/g, "").slice(0, 6);
  const password = String(body.password || "");

  if (password.length < 6) {
    return sendJson(res, 400, { error: "Password must be at least 6 characters." });
  }

  const resetLookup = await findValidPasswordResetRequest({ token, email, otp });

  if (!resetLookup) {
    return sendJson(res, 400, { error: "This reset OTP or link is invalid or expired." });
  }

  const { combined } = buildStoredPassword(password);

  if (resetLookup.dbUser) {
    await updateDbUser(resetLookup.dbUser.id, { passwordHash: combined });
    await prisma.authToken.updateMany({
      where: {
        userId: resetLookup.dbUser.id,
        type: { in: ["password_reset", "password_reset_otp"] },
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
  }

  if (resetLookup.fileUser && !dbOnlyMode) {
    const users = readUsers();
    const user = users.find((item) => item.id === resetLookup.fileUser.id);
    if (user) {
      user.passwordHash = combined;
      user.salt = "";
      user.resetToken = "";
      user.resetOtp = "";
      user.resetExpiresAt = 0;
      writeUsers(users);
    }
  }

  return sendJson(res, 200, { success: true, message: "Password updated. You can sign in now." });
}

async function findValidPasswordResetRequest({ token, email, otp }) {
  const now = new Date();

  if (token) {
    try {
      const dbToken = await prisma.authToken.findFirst({
        where: {
          token,
          type: "password_reset",
          usedAt: null,
          expiresAt: { gt: now },
        },
        include: { user: true },
      });
      if (dbToken?.user) {
        return { dbUser: dbToken.user, fileUser: null };
      }
    } catch {
      if (dbOnlyMode) return null;
    }
  }

  if (email && otp.length === 6) {
    try {
      const dbUser = await findUserByEmail(email);
      if (dbUser) {
        const dbOtp = await prisma.authToken.findFirst({
          where: {
            userId: dbUser.id,
            token: buildResetOtpToken(email, otp),
            type: "password_reset_otp",
            usedAt: null,
            expiresAt: { gt: now },
          },
        });
        if (dbOtp) {
          return { dbUser, fileUser: null };
        }
      }
    } catch {
      if (dbOnlyMode) return null;
    }
  }

  if (!dbOnlyMode) {
    const users = readUsers();
    const fileUser = users.find((item) => {
      const expiresAt = Number(item.resetExpiresAt || 0);
      const tokenMatches = token && item.resetToken === token;
      const otpMatches = email && otp.length === 6 && item.email === email && item.resetOtp === otp;
      return expiresAt > Date.now() && (tokenMatches || otpMatches);
    });
    if (fileUser) {
      return { dbUser: null, fileUser };
    }
  }

  return null;
}

async function handleSendVerification(body, req, res) {
  const email = String(body.email || "").trim().toLowerCase();
  const users = readUsers();
  let user = users.find((item) => item.email === email);

  if (!user) {
    try {
      const dbUser = await findUserByEmail(email);
      if (dbUser) {
        user = {
          id: dbUser.id,
          name: dbUser.name || email.split("@")[0] || "User",
          email: String(dbUser.email || "").trim().toLowerCase(),
          passwordHash: String(dbUser.passwordHash || ""),
          salt: "",
          emailVerified: Boolean(dbUser.emailVerified),
          isAdmin: Boolean(dbUser.isAdmin),
          subscriptionStatus: String(dbUser.subscriptionStatus || "inactive").toLowerCase(),
          trialStartedAt: dbUser.trialStartedAt ? new Date(dbUser.trialStartedAt).getTime() : 0,
          trialEndsAt: dbUser.trialEndsAt ? new Date(dbUser.trialEndsAt).getTime() : 0,
          subscriptionStartedAt: dbUser.subscriptionStartedAt ? new Date(dbUser.subscriptionStartedAt).getTime() : 0,
          subscriptionExpiresAt: dbUser.subscriptionExpiresAt ? new Date(dbUser.subscriptionExpiresAt).getTime() : 0,
          createdAt: dbUser.createdAt ? new Date(dbUser.createdAt).toISOString() : new Date().toISOString(),
          resetToken: "",
          resetExpiresAt: 0,
          verificationToken: "",
          verificationExpiresAt: 0,
        };
        users.push(user);
      }
    } catch {
      // Keep file-backed fallback if DB lookup is unavailable.
    }
  }

  if (!user) {
    return sendJson(res, 404, { error: "No account found for that email." });
  }

  if (user.emailVerified) {
    return sendJson(res, 200, { success: true, message: "Email is already verified." });
  }

  user.verificationToken = createToken();
  user.verificationExpiresAt = Date.now() + verificationLifetimeMs;
  writeUsers(users);

  const verificationUrl = buildAuthUrl(req, "verify", user.verificationToken);
  const emailSent = await sendTransactionalEmail({
    to: user.email,
    subject: "Verify your AnyLink email",
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#183153"><h2 style="margin:0 0 12px;">Verify your email</h2><p style="margin:0 0 14px;">Click the button below to confirm your AnyLink account email.</p><p style="margin:0 0 20px;"><a href="${verificationUrl}" style="display:inline-block;background:#2852e0;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Verify email</a></p></div>`,
    text: `Verify your AnyLink email: ${verificationUrl}`,
  });

  return sendJson(res, 200, {
    success: true,
    delivery: emailSent ? "email" : "link",
    message: emailSent ? "Verification link sent to your email." : "Email is not configured yet. Use the verification link below.",
    verificationUrl: emailSent ? "" : verificationUrl,
  });
}

function handleVerifyEmail(body, req, res) {
  const token = String(body.token || "").trim();
  const users = readUsers();
  const user = users.find((item) => item.verificationToken === token && Number(item.verificationExpiresAt) > Date.now());

  if (!user) {
    return sendJson(res, 400, { error: "This verification link is invalid or expired." });
  }

  user.emailVerified = true;
  user.verificationToken = "";
  user.verificationExpiresAt = 0;
  writeUsers(users);

  return sendJson(res, 200, { success: true, message: "Email verified successfully." });
}

function serializeCouponForClient(coupon) {
  if (!coupon) {
    return null;
  }

  return {
    code: coupon.code,
    label: coupon.label,
    type: coupon.type,
    value: coupon.value,
    planId: coupon.planId,
    active: coupon.active,
  };
}

function describeCoupon(coupon) {
  if (!coupon) {
    return "";
  }
  if (coupon.type === "free_days") {
    return `${coupon.value || 0} free day${Number(coupon.value || 0) === 1 ? "" : "s"}`;
  }
  if (coupon.type === "lifetime") {
    return "lifetime access";
  }
  return coupon.label || "discounted plan";
}

async function handleCouponPreview(user, body, res) {
  const coupon = findCouponByCode(body.code);

  if (!coupon) {
    return sendJson(res, 404, { error: "Coupon code not found or inactive." });
  }

  return sendJson(res, 200, {
    success: true,
    coupon: serializeCouponForClient(coupon),
    message: coupon.type === "plan"
      ? `Coupon applied: ${describeCoupon(coupon)}.`
      : `Offer applied: ${describeCoupon(coupon)}.`,
  });
}

async function handleCreateSubscription(user, req, res, body = {}) {
  const razorpayKeyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const razorpayKeySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  const defaultRazorpayPlanId = String(process.env.RAZORPAY_PLAN_ID || "").trim();
  const fallbackPaymentUrl = String(process.env.SUBSCRIPTION_PAYMENT_URL || "").trim();
  const coupon = findCouponByCode(body.couponCode);

  if (String(body.couponCode || "").trim() && !coupon) {
    return sendJson(res, 400, { error: "That coupon is invalid or inactive." });
  }

  if (coupon?.type === "free_days") {
    const now = Date.now();
    const days = Math.max(1, Number(coupon.value || 0));
    await applyBillingUpdateToUser(user.id, {
      subscriptionStatus: "active",
      trialStartedAt: 0,
      trialEndsAt: 0,
      subscriptionStartedAt: now,
      subscriptionExpiresAt: now + days * 24 * 60 * 60 * 1000,
      billingProvider: "coupon",
      couponCode: coupon.code,
    });
    const refreshedUser = (await getAuthenticatedUserAsync(req)) || user;
    queueWebhookEvent(user.id, "subscription.activated", {
      source: "coupon",
      couponCode: coupon.code,
      billing: serializeBilling(refreshedUser),
    }, req).catch(() => {});
    return sendJson(res, 200, {
      success: true,
      provider: "coupon",
      billing: serializeBilling(refreshedUser),
      message: `${describeCoupon(coupon)} applied successfully.`,
    });
  }

  if (coupon?.type === "lifetime") {
    const now = Date.now();
    await applyBillingUpdateToUser(user.id, {
      subscriptionStatus: "lifetime",
      trialStartedAt: 0,
      trialEndsAt: 0,
      subscriptionStartedAt: now,
      subscriptionExpiresAt: 0,
      billingProvider: "coupon",
      couponCode: coupon.code,
    });
    const refreshedUser = (await getAuthenticatedUserAsync(req)) || user;
    queueWebhookEvent(user.id, "subscription.activated", {
      source: "coupon",
      couponCode: coupon.code,
      billing: serializeBilling(refreshedUser),
    }, req).catch(() => {});
    return sendJson(res, 200, {
      success: true,
      provider: "coupon",
      billing: serializeBilling(refreshedUser),
      message: "Lifetime access unlocked successfully.",
    });
  }

  const razorpayPlanId = String(coupon?.planId || defaultRazorpayPlanId || "").trim();

  if (!razorpayKeyId || !razorpayKeySecret || !razorpayPlanId) {
    if (fallbackPaymentUrl) {
      return sendJson(res, 200, { paymentUrl: fallbackPaymentUrl, provider: "link" });
    }

    return sendJson(res, 501, {
      error: "Razorpay is not configured yet. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_PLAN_ID.",
    });
  }

  try {
    const currentSettings = await readSettingsForUserAsync(user.id, req);
    const periodLabel = String(process.env.RAZORPAY_SUBSCRIPTION_LABEL || "AnyLink Pro");
    const totalCount = Math.min(100, Math.max(1, Number(process.env.RAZORPAY_TOTAL_COUNT || 12)));
    const returnUrl = buildAbsoluteUrl(req, "/settings");
    const authHeader = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");

    const response = await fetch(`${razorpayApiBase}/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: razorpayPlanId,
        total_count: totalCount,
        quantity: 1,
        customer_notify: 1,
        notes: {
          anylink_user_id: user.id,
          anylink_email: user.email,
          anylink_workspace: currentSettings.workspaceName || "AnyLink Workspace",
          anylink_return_url: returnUrl,
          anylink_plan_label: periodLabel,
          anylink_coupon_code: coupon?.code || "",
          anylink_coupon_label: describeCoupon(coupon),
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return sendJson(res, 502, {
        error: payload.error?.description || payload.error?.reason || "Unable to start Razorpay checkout right now.",
      });
    }

    const paymentUrl = String(payload.short_url || "").trim();
    if (!paymentUrl) {
      return sendJson(res, 502, { error: "Razorpay did not return a hosted checkout URL." });
    }

    const now = Date.now();
    if (!dbOnlyMode) {
      const users = readUsers();
      const fileUser = users.find((item) => item.id === user.id);
      if (fileUser) {
        fileUser.billingProvider = "razorpay";
        fileUser.razorpayPlanId = razorpayPlanId;
        fileUser.razorpaySubscriptionId = payload.id || "";
        fileUser.razorpayCheckoutUrl = paymentUrl;
        fileUser.razorpayCheckoutCreatedAt = now;
        fileUser.pendingCouponCode = coupon?.code || "";
        writeUsers(users);
      }
    }

    return sendJson(res, 200, {
      paymentUrl,
      provider: "razorpay",
      checkout: {
        subscriptionId: payload.id || "",
        status: payload.status || "created",
      },
    });
  } catch {
    if (fallbackPaymentUrl) {
      return sendJson(res, 200, { paymentUrl: fallbackPaymentUrl, provider: "link" });
    }
    return sendJson(res, 500, { error: "Unable to start subscription checkout right now." });
  }
}

async function handleRazorpayWebhook(rawBody, req, res) {
  const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  const signature = String(req.headers["x-razorpay-signature"] || "").trim();

  if (!webhookSecret) {
    return sendJson(res, 501, { error: "Webhook secret is not configured." });
  }

  if (!signature) {
    return sendJson(res, 401, { error: "Missing Razorpay signature." });
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return sendJson(res, 401, { error: "Invalid Razorpay signature." });
  }

  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return sendJson(res, 400, { error: "Invalid webhook payload." });
  }

  const event = String(payload.event || "").trim();
  const subscriptionEntity = payload.payload?.subscription?.entity
    || payload.payload?.subscription?.item?.entity
    || payload.payload?.payment?.entity?.notes
    || {};
  const paymentEntity = payload.payload?.payment?.entity || {};
  const notes = {
    ...(subscriptionEntity.notes || {}),
    ...(paymentEntity.notes || {}),
  };
  const subscriptionId = String(subscriptionEntity.id || paymentEntity.subscription_id || notes.razorpay_subscription_id || "").trim();
  const userId = String(notes.anylink_user_id || "").trim();

  if (!userId) {
    return sendJson(res, 200, { received: true, ignored: true, reason: "No AnyLink user id present in notes." });
  }

  const accessUpdate = mapRazorpayEventToBillingState(event, subscriptionEntity);
  if (!accessUpdate) {
    return sendJson(res, 200, { received: true, ignored: true, reason: `Unhandled event ${event}` });
  }

  await applyBillingUpdateToUser(userId, {
    ...accessUpdate,
    billingProvider: "razorpay",
    razorpaySubscriptionId: subscriptionId,
    razorpayPlanId: String(subscriptionEntity.plan_id || notes.razorpay_plan_id || "").trim(),
    razorpayCustomerId: String(subscriptionEntity.customer_id || "").trim(),
    razorpayStatus: String(subscriptionEntity.status || event || "").trim(),
    razorpayLastEvent: event,
    razorpayLastEventAt: Date.now(),
  });

  const eventName = accessUpdate.subscriptionStatus === "active" ? "subscription.activated" : "subscription.updated";
  queueWebhookEvent(userId, eventName, {
    source: "razorpay_webhook",
    razorpayEvent: event,
    subscriptionId,
    update: accessUpdate,
  }, req).catch(() => {});

  return sendJson(res, 200, { received: true, event });
}

async function handleRefreshSubscription(user, req, res) {
  const razorpayKeyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const razorpayKeySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!razorpayKeyId || !razorpayKeySecret) {
    return sendJson(res, 501, { error: "Razorpay refresh is not configured yet." });
  }

  const storedUser = !dbOnlyMode ? readUsers().find((item) => item.id === user.id) : null;
  const subscriptionId = String(storedUser?.razorpaySubscriptionId || user.razorpaySubscriptionId || "").trim();

  if (!subscriptionId) {
    return sendJson(res, 404, { error: "No Razorpay subscription found for this account." });
  }

  try {
    const authHeader = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
    const response = await fetch(`${razorpayApiBase}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return sendJson(res, 502, {
        error: payload.error?.description || payload.error?.reason || "Unable to verify your Razorpay subscription right now.",
      });
    }

    const normalized = mapRazorpayStatusToBillingState(payload);
    if (normalized) {
      await applyBillingUpdateToUser(user.id, {
        ...normalized,
        billingProvider: "razorpay",
        razorpaySubscriptionId: subscriptionId,
        razorpayPlanId: String(payload.plan_id || storedUser?.razorpayPlanId || "").trim(),
        razorpayCustomerId: String(payload.customer_id || storedUser?.razorpayCustomerId || "").trim(),
        razorpayStatus: String(payload.status || "").trim(),
        razorpayLastEvent: "manual_refresh",
        razorpayLastEventAt: Date.now(),
      });
      const refreshedForWebhook = getAuthenticatedUserById(user.id) || { ...user, ...(normalized || {}) };
      const eventName = String(normalized.subscriptionStatus || "").toLowerCase() === "active"
        ? "subscription.activated"
        : "subscription.updated";
      queueWebhookEvent(user.id, eventName, {
        source: "manual_refresh",
        subscriptionId,
        billing: serializeBilling(refreshedForWebhook),
      }, req).catch(() => {});
    }

    const refreshedUser = getAuthenticatedUserById(user.id) || { ...user, ...(normalized || {}) };
    return sendJson(res, 200, {
      success: true,
      billing: serializeBilling(refreshedUser),
      razorpayStatus: String(payload.status || "unknown"),
    });
  } catch {
    return sendJson(res, 500, { error: "Could not refresh subscription status right now." });
  }
}

function mapRazorpayEventToBillingState(event, subscriptionEntity = {}) {
  const now = Date.now();
  const currentStart = Number(subscriptionEntity.current_start || 0) * 1000 || now;
  const currentEnd = Number(subscriptionEntity.current_end || 0) * 1000 || 0;
  const endedAt = Number(subscriptionEntity.ended_at || 0) * 1000 || 0;

  if (["subscription.activated", "subscription.charged", "subscription.resumed", "subscription.authenticated"].includes(event)) {
    return {
      subscriptionStatus: "active",
      trialEndsAt: 0,
      subscriptionStartedAt: currentStart || now,
      subscriptionExpiresAt: currentEnd || now + 30 * 24 * 60 * 60 * 1000,
    };
  }

  if (["subscription.completed", "subscription.cancelled", "subscription.halted", "subscription.paused"].includes(event)) {
    return {
      subscriptionStatus: "inactive",
      subscriptionStartedAt: currentStart || 0,
      subscriptionExpiresAt: endedAt || currentEnd || now,
    };
  }

  return null;
}

function mapRazorpayStatusToBillingState(subscriptionEntity = {}) {
  const status = String(subscriptionEntity.status || "").trim().toLowerCase();
  const now = Date.now();
  const currentStart = Number(subscriptionEntity.current_start || 0) * 1000 || now;
  const currentEnd = Number(subscriptionEntity.current_end || 0) * 1000 || 0;
  const endedAt = Number(subscriptionEntity.ended_at || 0) * 1000 || 0;

  if (["active", "authenticated"].includes(status)) {
    return {
      subscriptionStatus: "active",
      trialEndsAt: 0,
      subscriptionStartedAt: currentStart || now,
      subscriptionExpiresAt: currentEnd || now + 30 * 24 * 60 * 60 * 1000,
    };
  }

  if (["completed", "cancelled", "halted", "paused", "expired"].includes(status)) {
    return {
      subscriptionStatus: "inactive",
      subscriptionStartedAt: currentStart || 0,
      subscriptionExpiresAt: endedAt || currentEnd || now,
    };
  }

  return null;
}

async function applyBillingUpdateToUser(userId, updates) {
  if (!dbOnlyMode) {
    const users = readUsers();
    const fileUser = users.find((item) => item.id === userId);
    if (fileUser) {
      Object.assign(fileUser, updates);
      if (updates.subscriptionStatus === "active") {
        fileUser.trialEndsAt = 0;
      }
      writeUsers(users);
    }
  }

  try {
    const dbUpdate = {};
    if (updates.subscriptionStatus) dbUpdate.subscriptionStatus = String(updates.subscriptionStatus || "").toUpperCase();
    if ("trialEndsAt" in updates) dbUpdate.trialEndsAt = updates.trialEndsAt ? new Date(Number(updates.trialEndsAt)) : null;
    if ("subscriptionStartedAt" in updates) dbUpdate.subscriptionStartedAt = updates.subscriptionStartedAt ? new Date(Number(updates.subscriptionStartedAt)) : null;
    if ("subscriptionExpiresAt" in updates) dbUpdate.subscriptionExpiresAt = updates.subscriptionExpiresAt ? new Date(Number(updates.subscriptionExpiresAt)) : null;
    if (Object.keys(dbUpdate).length) {
      await updateDbUser(userId, dbUpdate);
    }
  } catch {
    // JSON remains the operational fallback until full DB billing migration lands.
  }
}

function getAuthenticatedUserById(userId) {
  const fileUser = !dbOnlyMode ? readUsers().find((item) => item.id === userId) : null;
  if (fileUser) {
    return fileUser;
  }
  return null;
}

async function readAdminUsersAsync() {
  const fileUsers = readUsers();
  let dbUsers = [];

  try {
    dbUsers = await listDbUsers();
  } catch {
    dbUsers = [];
  }

  const mergedById = new Map();
  for (const user of fileUsers) {
    if (!user?.id) continue;
    mergedById.set(user.id, user);
  }

  for (const dbUser of dbUsers) {
    if (!dbUser?.id) continue;
    const normalized = normalizeDbUser(dbUser);
    const existing = mergedById.get(normalized.id);
    mergedById.set(normalized.id, {
      ...(existing || {}),
      ...normalized,
    });
  }

  return [...mergedById.values()];
}

async function handleAdminOverview(req, res) {
  const users = await readAdminUsersAsync();
  const sessions = readSessions();
  const userSummaries = await Promise.all(users.map(async (user) => {
    const userSessions = sessions.filter((session) => session.userId === user.id);
    const userLinks = await readLinksForUserAsync(user.id);
    const safeUserLinks = Array.isArray(userLinks) ? userLinks : [];
    const activity = readActivitySummary(user.id);
    return {
      ...serializeUser(user),
      billing: serializeBilling(user),
      totalLinks: safeUserLinks.length,
      lastLinkAt: safeUserLinks[0]?.createdAt || "",
      activeSessions: userSessions.length,
      usage: {
        totalTimeMs: Number(activity.totalTimeMs || 0),
        pageViews: Number(activity.pageViews || 0),
        visits: Number(activity.visits || 0),
        linksCreated: Number(activity.linksCreated || 0),
        lastActiveAt: Number(activity.lastActiveAt || 0),
        lastPage: String(activity.lastPage || ""),
        topPages: summarizeTopPages(activity.pages || {}),
      },
    };
  }));

  const sessionSummaries = sessions
    .map((session) => {
      const user = users.find((item) => item.id === session.userId);
      if (!user) {
        return null;
      }
      return {
        token: session.token,
        userId: session.userId,
        userName: user.name,
        email: user.email,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.createdAt - left.createdAt);

  return sendJson(res, 200, {
    users: userSummaries.sort((left, right) => Number(right.usage.lastActiveAt || right.billing.trialStartedAt || 0) - Number(left.usage.lastActiveAt || left.billing.trialStartedAt || 0)),
    sessions: sessionSummaries,
    coupons: readCoupons().map(serializeCouponForClient),
    auditLogs: readAuditLogs().slice(0, 120),
    summary: {
      totalUsers: userSummaries.length,
      activeSubscriptions: userSummaries.filter((user) => user.billing.subscriptionStatus === "active" && user.billing.hasAccess).length,
      trialingUsers: userSummaries.filter((user) => user.billing.subscriptionStatus === "trialing" && user.billing.hasAccess).length,
      expiredUsers: userSummaries.filter((user) => !user.billing.hasAccess).length,
      totalPageViews: userSummaries.reduce((sum, user) => sum + Number(user.usage.pageViews || 0), 0),
      totalLinksCreated: userSummaries.reduce((sum, user) => sum + Number(user.usage.linksCreated || 0), 0),
      totalTimeMs: userSummaries.reduce((sum, user) => sum + Number(user.usage.totalTimeMs || 0), 0),
    },
  });
}

async function handleAdminSubscriptionUpdate(userId, body, res, adminUser) {
  const users = readUsers();
  const user = users.find((item) => item.id === userId);

  if (!user) {
    return sendJson(res, 404, { error: "User not found." });
  }

  const mode = String(body.mode || "active").trim().toLowerCase();
  const days = Math.max(1, Number(body.days) || 30);
  const now = Date.now();

  if (mode === "active") {
    user.subscriptionStatus = "active";
    user.trialStartedAt = 0;
    user.trialEndsAt = 0;
    user.subscriptionStartedAt = now;
    user.subscriptionExpiresAt = now + days * 24 * 60 * 60 * 1000;
  } else if (mode === "trial") {
    user.subscriptionStatus = "trialing";
    user.trialStartedAt = now;
    user.trialEndsAt = now + days * 24 * 60 * 60 * 1000;
    user.subscriptionStartedAt = 0;
    user.subscriptionExpiresAt = 0;
  } else if (mode === "inactive") {
    user.subscriptionStatus = "inactive";
    user.trialStartedAt = 0;
    user.trialEndsAt = 0;
    user.subscriptionStartedAt = 0;
    user.subscriptionExpiresAt = 0;
  } else if (mode === "lifetime") {
    user.subscriptionStatus = "lifetime";
    user.trialStartedAt = 0;
    user.trialEndsAt = 0;
    user.subscriptionStartedAt = now;
    user.subscriptionExpiresAt = 0;
  } else {
    return sendJson(res, 400, { error: "Invalid subscription mode." });
  }

  if (!dbOnlyMode) {
    writeUsers(users);
  }

  try {
    await updateDbUser(user.id, {
      subscriptionStatus: String(user.subscriptionStatus || "").toUpperCase(),
      trialStartedAt: user.trialStartedAt ? new Date(Number(user.trialStartedAt)) : null,
      trialEndsAt: user.trialEndsAt ? new Date(Number(user.trialEndsAt)) : null,
      subscriptionStartedAt: user.subscriptionStartedAt ? new Date(Number(user.subscriptionStartedAt)) : null,
      subscriptionExpiresAt: user.subscriptionExpiresAt ? new Date(Number(user.subscriptionExpiresAt)) : null,
    });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to update this subscription right now." });
    }
  }

  appendAuditLog("admin.subscription.update", { userId: adminUser?.id, email: adminUser?.email, type: "admin" }, {
    targetUserId: user.id,
    targetEmail: user.email,
    mode,
    days,
  });
  return sendJson(res, 200, { success: true, billing: serializeBilling(user) });
}

async function handleAdminUserLinks(userId, res) {
  const users = await readAdminUsersAsync();
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return sendJson(res, 404, { error: "User not found." });
  }

  const links = await readLinksForUserAsync(userId);
  const normalizedLinks = (Array.isArray(links) ? links : [])
    .map((link) => ({
      id: String(link.id || ""),
      slug: String(link.slug || ""),
      destination: String(link.destination || ""),
      shortUrl: String(link.shortUrl || buildShortUrl(getDefaultShortDomain(), String(link.slug || ""))),
      includeQr: Boolean(link.includeQr),
      createdAt: String(link.createdAt || ""),
    }))
    .sort((left, right) => Number(new Date(right.createdAt || 0).getTime()) - Number(new Date(left.createdAt || 0).getTime()));

  return sendJson(res, 200, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    summary: {
      totalLinks: normalizedLinks.length,
      lastLinkAt: normalizedLinks[0]?.createdAt || "",
    },
    links: normalizedLinks,
  });
}

async function handleAdminUserExport(userId, req, res) {
  const users = await readAdminUsersAsync();
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return sendJson(res, 404, { error: "User not found." });
  }

  const links = await readLinksForUserAsync(userId);
  const activity = readActivitySummary(userId);
  const billing = serializeBilling(user);
  const safeLinks = Array.isArray(links) ? links : [];

  const headers = [
    "User Name",
    "User Email",
    "Email Verified",
    "Subscription Status",
    "Has Access",
    "Trial Ends At",
    "Subscription Starts At",
    "Subscription Ends At",
    "Total User Links",
    "Total Page Views",
    "Total Time Spent (ms)",
    "Link Slug",
    "Short URL",
    "Destination",
    "Include QR",
    "Link Created At",
  ];

  const baseCols = [
    String(user.name || ""),
    String(user.email || ""),
    user.emailVerified ? "Yes" : "No",
    String(billing.subscriptionStatus || ""),
    billing.hasAccess ? "Yes" : "No",
    billing.trialEndsAt ? new Date(Number(billing.trialEndsAt)).toISOString() : "",
    billing.subscriptionStartedAt ? new Date(Number(billing.subscriptionStartedAt)).toISOString() : "",
    billing.subscriptionExpiresAt ? new Date(Number(billing.subscriptionExpiresAt)).toISOString() : "",
    String(safeLinks.length),
    String(Number(activity.pageViews || 0)),
    String(Number(activity.totalTimeMs || 0)),
  ];

  const rows = safeLinks.length
    ? safeLinks.map((link) => [
      ...baseCols,
      String(link.slug || ""),
      String(link.shortUrl || ""),
      String(link.destination || ""),
      Boolean(link.includeQr) ? "Yes" : "No",
      link.createdAt ? new Date(link.createdAt).toISOString() : "",
    ])
    : [[
      ...baseCols,
      "",
      "",
      "",
      "",
      "",
    ]];

  const safeName = String(user.name || "user").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
  return sendCsv(res, `${safeName}-data.csv`, headers, rows);
}

async function handleAdminBlockUser(userId, body, res, adminUser) {
  const users = await readAdminUsersAsync();
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return sendJson(res, 404, { error: "User not found." });
  }

  if (user.id === adminUser?.id) {
    return sendJson(res, 400, { error: "You cannot block your own admin account." });
  }

  if (isAdminUser(user)) {
    return sendJson(res, 400, { error: "Admin accounts cannot be blocked from this panel." });
  }

  const shouldBlock = body.blocked !== false;
  const reason = String(body.reason || "").trim().slice(0, 240);
  const nextUser = persistUserAccessOverride(user, {
    isBlocked: shouldBlock,
    blockedAt: shouldBlock ? Date.now() : 0,
    blockedReason: shouldBlock ? reason : "",
  });

  if (shouldBlock) {
    writeSessions(readSessions().filter((session) => session.userId !== user.id));
    try {
      await deleteSessionsByUserId(user.id);
    } catch {
      // The auth guard still blocks DB sessions through the local access override.
    }
  }

  appendAuditLog(shouldBlock ? "admin.user.block" : "admin.user.unblock", { userId: adminUser?.id, email: adminUser?.email, type: "admin" }, {
    targetUserId: user.id,
    targetEmail: user.email,
    reason,
  });
  return sendJson(res, 200, { success: true, user: serializeUser(nextUser) });
}

async function handleAdminDeleteUserLinks(userId, slug, req, res, adminUser) {
  const users = await readAdminUsersAsync();
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return sendJson(res, 404, { error: "User not found." });
  }

  const normalizedSlug = String(slug || "").trim();
  const links = await readLinksForUserAsync(userId);
  const targetLinks = normalizedSlug
    ? links.filter((link) => link.slug === normalizedSlug)
    : links;

  if (!targetLinks.length) {
    return sendJson(res, 404, { error: normalizedSlug ? "Link not found." : "This user has no links to delete." });
  }

  const fileLinks = readLinks();
  const targetSlugs = new Set(targetLinks.map((link) => link.slug));
  if (!dbOnlyMode) {
    writeLinks(fileLinks.filter((link) => !(link.userId === userId && targetSlugs.has(link.slug))));
  }

  let deletedCount = 0;
  for (const link of targetLinks) {
    try {
      await deleteLinkBySlug(link.slug, userId);
      deletedCount += 1;
    } catch {
      if (dbOnlyMode) {
        return sendJson(res, 500, { error: "Unable to delete this user's links right now." });
      }
    }
  }

  appendAuditLog(normalizedSlug ? "admin.user.link.delete" : "admin.user.links.delete", { userId: adminUser?.id, email: adminUser?.email, type: "admin" }, {
    targetUserId: user.id,
    targetEmail: user.email,
    slug: normalizedSlug,
    deletedCount: dbOnlyMode ? deletedCount : targetLinks.length,
  });
  return sendJson(res, 200, { success: true, deletedCount: dbOnlyMode ? deletedCount : targetLinks.length });
}

async function handleAdminTrialUpdate(userId, body, res, adminUser) {
  const users = readUsers();
  const user = users.find((item) => item.id === userId);

  if (!user) {
    return sendJson(res, 404, { error: "User not found." });
  }

  const days = Math.max(1, Number(body.days) || 3);
  user.subscriptionStatus = "trialing";
  user.trialStartedAt = Date.now();
  user.trialEndsAt = Date.now() + days * 24 * 60 * 60 * 1000;
  user.subscriptionStartedAt = 0;
  user.subscriptionExpiresAt = 0;
  if (!dbOnlyMode) {
    writeUsers(users);
  }

  try {
    await updateDbUser(user.id, {
      subscriptionStatus: "TRIALING",
      trialStartedAt: new Date(Number(user.trialStartedAt)),
      trialEndsAt: new Date(Number(user.trialEndsAt)),
      subscriptionStartedAt: null,
      subscriptionExpiresAt: null,
    });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to extend this trial right now." });
    }
  }

  appendAuditLog("admin.trial.update", { userId: adminUser?.id, email: adminUser?.email, type: "admin" }, {
    targetUserId: user.id,
    targetEmail: user.email,
    days,
  });
  return sendJson(res, 200, { success: true, billing: serializeBilling(user) });
}

function handleAdminVerifyUser(userId, res, adminUser) {
  const users = readUsers();
  const user = users.find((item) => item.id === userId);

  if (!user) {
    return sendJson(res, 404, { error: "User not found." });
  }

  user.emailVerified = true;
  user.verificationToken = "";
  user.verificationExpiresAt = 0;
  writeUsers(users);

  appendAuditLog("admin.user.verify", { userId: adminUser?.id, email: adminUser?.email, type: "admin" }, {
    targetUserId: user.id,
    targetEmail: user.email,
  });
  return sendJson(res, 200, { success: true, user: serializeUser(user) });
}

function handleAdminRevokeSession(sessionToken, res, adminUser) {
  const sessions = readSessions();
  const revoked = sessions.find((session) => session.token === sessionToken);
  const nextSessions = sessions.filter((session) => session.token !== sessionToken);

  if (sessions.length === nextSessions.length) {
    return sendJson(res, 404, { error: "Session not found." });
  }

  writeSessions(nextSessions);
  appendAuditLog("admin.session.revoke", { userId: adminUser?.id, email: adminUser?.email, type: "admin" }, {
    sessionToken: sessionToken.slice(0, 12),
    targetUserId: revoked?.userId || "",
  });
  return sendJson(res, 200, { success: true });
}

async function createSessionResponse(user, req, res, statusCode, extras = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const session = {
    token,
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionLifetimeMs,
  };

  if (!dbOnlyMode) {
    const sessions = readSessions().filter((item) => item.userId !== user.id);
    sessions.push(session);
    writeSessions(sessions);
  }

  try {
    await createDbSession({
      token,
      userId: user.id,
      expiresAt: new Date(session.expiresAt),
      createdAt: new Date(session.createdAt),
    });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to start your session right now. Please try again." });
    }
    // JSON session stays as fallback.
  }

  const settings = await readSettingsForUserAsync(user.id, req);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": buildSessionCookie(token, { maxAge: sessionLifetimeMs / 1000 }),
  });
  res.end(JSON.stringify({ user: serializeUser(user), settings, billing: serializeBilling(user), ...extras }));
}

function buildSessionCookie(value, options = {}) {
  const parts = [
    `${sessionCookieName}=${value}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sessionSameSite}`,
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  return parts.join("; ");
}

function buildClientCookie(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `SameSite=${options.sameSite || "Lax"}`,
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  return parts.join("; ");
}

function parseCookies(cookieHeader) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const separatorIndex = part.indexOf("=");
      const key = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
      const value = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : "";
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function getTrackingContext(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const visitorId = cookies[analyticsVisitorCookieName] || crypto.randomUUID();
  const sessionId = cookies[analyticsSessionCookieName] || crypto.randomUUID();
  const setCookies = [];

  if (!cookies[analyticsVisitorCookieName]) {
    setCookies.push(buildClientCookie(analyticsVisitorCookieName, visitorId, { maxAge: analyticsVisitorLifetimeSeconds, httpOnly: true, sameSite: "Lax" }));
  }

  if (!cookies[analyticsSessionCookieName]) {
    setCookies.push(buildClientCookie(analyticsSessionCookieName, sessionId, { maxAge: analyticsSessionLifetimeSeconds, httpOnly: true, sameSite: "Lax" }));
  }

  return {
    visitorId,
    sessionId,
    setCookies,
    language: getPreferredLanguage(req),
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    isAdmin: isAdminUser(user),
    isBlocked: isUserBlocked(user),
    blockedAt: Number(user.blockedAt || 0),
    blockedReason: String(user.blockedReason || ""),
  };
}

function serializeBilling(user) {
  if (hasLifetimeAccess(user)) {
    return {
      subscriptionStatus: "lifetime",
      trialStartedAt: Number(user.trialStartedAt || 0),
      trialEndsAt: Number(user.trialEndsAt || 0),
      trialRemainingMs: 0,
      subscriptionStartedAt: Number(user.subscriptionStartedAt || 0),
      subscriptionExpiresAt: 0,
      hasAccess: true,
    };
  }

  const now = Date.now();
  const trialEndsAt = Number(user.trialEndsAt || 0);
  const subscriptionStatus = String(user.subscriptionStatus || "inactive").toLowerCase();
  const trialRemainingMs = Math.max(0, trialEndsAt - now);
  return {
    subscriptionStatus,
    trialStartedAt: Number(user.trialStartedAt || 0),
    trialEndsAt,
    trialRemainingMs,
    subscriptionStartedAt: Number(user.subscriptionStartedAt || 0),
    subscriptionExpiresAt: Number(user.subscriptionExpiresAt || 0),
    hasAccess: hasActiveAccess(user),
  };
}

function hasActiveAccess(user) {
  if (isUserBlocked(user)) {
    return false;
  }

  if (hasLifetimeAccess(user)) {
    return true;
  }

  const now = Date.now();
  if (String(user.subscriptionStatus || "").toLowerCase() === "active" && Number(user.subscriptionExpiresAt || 0) > now) {
    return true;
  }

  return Number(user.trialEndsAt || 0) > now;
}

function hasLifetimeAccess(user) {
  if (!user) {
    return false;
  }

  if (String(user.subscriptionStatus || "").toLowerCase() === "lifetime") {
    return true;
  }

  return builtInLifetimeEmails.includes(String(user.email || "").toLowerCase());
}

async function handleCreateLink(body, req, res, user) {
  const rawDestination = String(body.destination || "").trim();
  const customSlug = String(body.slug || "").trim().toLowerCase();
  const requestedDomain = sanitizeDomainInput(String(body.domain || "").trim(), req);
  const includeQr = Boolean(body.includeQr);

  if (!rawDestination) {
    return sendJson(res, 400, { error: "Destination URL is required." });
  }

  const destination = normalizeUrl(rawDestination);

  if (!destination) {
    return sendJson(res, 400, { error: "Please enter a valid destination URL." });
  }

  const links = dbOnlyMode ? await readLinksForUserAsync(user.id) : readLinks();
  let slug = customSlug || generateSlug(links);

  if (!/^[a-z0-9-]{3,32}$/.test(slug)) {
    return sendJson(res, 400, { error: "Slug must be 3-32 characters and use only letters, numbers, or hyphens." });
  }

  if (dbOnlyMode) {
    while (!customSlug) {
      try {
        const exists = await findLinkBySlug(slug);
        if (!exists) break;
      } catch {
        break;
      }
      slug = generateSlug([]);
    }

    if (customSlug) {
      try {
        const exists = await findLinkBySlug(slug);
        if (exists) {
          return sendJson(res, 409, { error: "That short link already exists. Try another custom slug." });
        }
      } catch {
        // Allow DB create to be the final guard.
      }
    }
  } else if (links.some((item) => item.slug === slug)) {
    return sendJson(res, 409, { error: "That short link already exists. Try another custom slug." });
  }

  const settings = await readSettingsForUserAsync(user.id, req);
  const allowedDomains = Array.isArray(settings.domains) ? settings.domains.map((item) => sanitizeDomainInput(String(item || ""), req)).filter(Boolean) : [];
  const resolvedDomain = requestedDomain && allowedDomains.includes(requestedDomain)
    ? requestedDomain
    : (settings.defaultDomain || req.headers.host);
  const shortUrl = buildShortUrl(resolvedDomain, slug);
  const nextLink = {
    id: Date.now(),
    userId: user.id,
    slug,
    destination,
    shortUrl,
    includeQr,
    createdAt: new Date().toISOString(),
    analytics: createEmptyAnalytics(),
  };

  if (!dbOnlyMode) {
    links.unshift(nextLink);
    writeLinks(links);
  }
  try {
    await createDbLink({
      id: String(nextLink.id),
      userId: user.id,
      slug,
      destination,
      shortUrl,
      includeQr,
      createdAt: new Date(nextLink.createdAt),
    });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to create your link right now. Please try again." });
    }
    // JSON remains fallback during DB migration.
  }

  try {
    updateActivitySummary(user.id, (current) => ({
      ...current,
      linksCreated: Number(current.linksCreated || 0) + 1,
      lastActiveAt: Date.now(),
      lastPage: "links",
    }));
  } catch {
    // Activity summary should not block link creation.
  }

  queueWebhookEvent(user.id, "link.created", {
    link: {
      id: String(nextLink.id),
      slug: nextLink.slug,
      destination: nextLink.destination,
      shortUrl: nextLink.shortUrl,
      includeQr: nextLink.includeQr,
      createdAt: nextLink.createdAt,
    },
  }, req).catch(() => {});
  sendJson(res, 201, { link: nextLink });
}

async function handleUpdateLink(slug, body, req, res, user) {
  const currentSlug = sanitizeSlugInput(String(slug || "").trim());
  const nextSlug = sanitizeSlugInput(String(body.slug || currentSlug).trim().toLowerCase());
  const rawDestination = String(body.destination || "").trim();
  const requestedDomain = sanitizeDomainInput(String(body.domain || "").trim(), req);
  const includeQr = Boolean(body.includeQr);

  if (!currentSlug) {
    return sendJson(res, 400, { error: "Link slug is required." });
  }

  if (!rawDestination) {
    return sendJson(res, 400, { error: "Destination URL is required." });
  }

  if (!/^[a-z0-9-]{3,32}$/.test(nextSlug)) {
    return sendJson(res, 400, { error: "Slug must be 3-32 characters and use only letters, numbers, or hyphens." });
  }

  const destination = normalizeUrl(rawDestination);
  if (!destination) {
    return sendJson(res, 400, { error: "Please enter a valid destination URL." });
  }

  const settings = await readSettingsForUserAsync(user.id, req);
  const allowedDomains = Array.isArray(settings.domains) ? settings.domains.map((item) => sanitizeDomainInput(String(item || ""), req)).filter(Boolean) : [];
  const resolvedDomain = requestedDomain && allowedDomains.includes(requestedDomain)
    ? requestedDomain
    : (settings.defaultDomain || req.headers.host);
  const nextShortUrl = buildShortUrl(resolvedDomain, nextSlug);
  const links = dbOnlyMode ? [] : readLinks();
  const fileMatch = links.find((item) => item.slug === currentSlug && item.userId === user.id) || null;
  let dbMatch = null;

  try {
    const found = await findLinkBySlug(currentSlug);
    if (found && found.userId === user.id) {
      dbMatch = found;
    }
  } catch {
    dbMatch = null;
  }

  const existing = fileMatch || (dbMatch ? {
    id: dbMatch.id,
    userId: dbMatch.userId,
    slug: dbMatch.slug,
    destination: dbMatch.destination,
    shortUrl: dbMatch.shortUrl,
    includeQr: dbMatch.includeQr,
    createdAt: dbMatch.createdAt instanceof Date ? dbMatch.createdAt.toISOString() : dbMatch.createdAt,
    analytics: createEmptyAnalytics(),
  } : null);

  if (!existing) {
    return sendJson(res, 404, { error: "Link not found." });
  }

  if (nextSlug !== currentSlug) {
    if (!dbOnlyMode && links.some((item) => item.userId === user.id && item.slug === nextSlug)) {
      return sendJson(res, 409, { error: "That short link already exists. Try another custom slug." });
    }

    try {
      const found = await findLinkBySlug(nextSlug);
      if (found && found.userId === user.id) {
        return sendJson(res, 409, { error: "That short link already exists. Try another custom slug." });
      }
    } catch {
      // Allow DB update to be final guard.
    }
  }

  const updatedLink = {
    ...existing,
    slug: nextSlug,
    destination,
    shortUrl: nextShortUrl,
    includeQr,
  };

  if (!dbOnlyMode) {
    const nextLinks = links.map((item) => {
      if (item.userId === user.id && item.slug === currentSlug) {
        return {
          ...item,
          slug: nextSlug,
          destination,
          shortUrl: nextShortUrl,
          includeQr,
        };
      }
      return item;
    });
    writeLinks(nextLinks);
  }

  try {
    const dbUpdatedLink = await updateLinkBySlug(currentSlug, user.id, {
      slug: nextSlug,
      destination,
      shortUrl: nextShortUrl,
      includeQr,
    });

    if (dbOnlyMode && !dbUpdatedLink) {
      return sendJson(res, 500, { error: "Unable to update your link right now. Please try again." });
    }
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to update your link right now. Please try again." });
    }
  }

  queueWebhookEvent(user.id, "link.updated", {
    previousSlug: currentSlug,
    link: {
      id: String(updatedLink.id),
      slug: updatedLink.slug,
      destination: updatedLink.destination,
      shortUrl: updatedLink.shortUrl,
      includeQr: updatedLink.includeQr,
      createdAt: updatedLink.createdAt,
    },
  }, req).catch(() => {});
  sendJson(res, 200, { link: updatedLink });
}

async function handleSavePage(body, req, res, user) {
  const title = String(body.title || "").trim();
  const headline = String(body.headline || "").trim();
  const description = String(body.description || "").trim();
  const submitLabel = String(body.submitLabel || "").trim() || "Submit";
  const thanksMessage = String(body.thanksMessage || "").trim() || "Thanks, your response has been received.";
  const rawSlug = String(body.slug || "").trim().toLowerCase();

  if (!title) {
    return sendJson(res, 400, { error: "Form name is required." });
  }

  const slug = sanitizeFormSlug(rawSlug || title);

  if (!slug) {
    return sendJson(res, 400, { error: "Use a valid slug with letters, numbers, and hyphens only." });
  }

  const fields = normalizeFormFields(body.fields || {});
  const pages = dbOnlyMode ? [] : readPages();
  const existingIndex = pages.findIndex((item) => item.id === body.id && item.userId === user.id);
  const conflictingSlug = pages.find((item) => item.slug === slug && item.id !== body.id);

  if (!dbOnlyMode && conflictingSlug) {
    return sendJson(res, 409, { error: "That form slug is already in use." });
  }

  try {
    const conflictingDbPage = await findPageBySlug(slug);
    if (conflictingDbPage && conflictingDbPage.id !== body.id) {
      return sendJson(res, 409, { error: "That form slug is already in use." });
    }
  } catch {
    // Keep JSON fallback while migration is in progress.
  }

  if (existingIndex >= 0) {
    const current = pages[existingIndex];
    pages[existingIndex] = normalizePage({
      ...current,
      title,
      headline: headline || title,
      description,
      submitLabel,
      thanksMessage,
      slug,
      fields,
      updatedAt: new Date().toISOString(),
    }, req);
  } else {
    pages.unshift(normalizePage({
      id: crypto.randomUUID(),
      userId: user.id,
      title,
      headline: headline || title,
      description,
      submitLabel,
      thanksMessage,
      slug,
      fields,
      submissions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, req));
  }

  if (!dbOnlyMode) {
    writePages(pages);
  }
  const saved = pages.find((item) => item.slug === slug && item.userId === user.id);

  try {
    const dbSaved = await saveDbPage(user.id, body.id || "", {
      title,
      slug,
      headline: headline || title,
      description,
      submitLabel,
      thanksMessage,
    }, serializeDbFormFields(fields));
    return sendJson(res, existingIndex >= 0 ? 200 : 201, { page: mapDbPageRecord(dbSaved, req, saved) });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to save this form right now. Please try again." });
    }
    return sendJson(res, existingIndex >= 0 ? 200 : 201, { page: normalizePage(saved, req) });
  }
}

async function handleDeletePage(pageId, res, user) {
  const pages = dbOnlyMode ? [] : readPages();
  const nextPages = pages.filter((item) => !(item.id === pageId && item.userId === user.id));

  if (dbOnlyMode || nextPages.length === pages.length) {
    try {
      const result = await deletePageById(pageId, user.id);
      if (!result.count) {
        return sendJson(res, 404, { error: "Form not found." });
      }
      return sendJson(res, 200, { success: true });
    } catch {
      return sendJson(res, 404, { error: "Form not found." });
    }
  }

  if (!dbOnlyMode) {
    writePages(nextPages);
  }
  try {
    await deletePageById(pageId, user.id);
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to complete this request right now. Please try again." });
    }
    // JSON remains fallback during DB migration.
  }
  return sendJson(res, 200, { success: true });
}

async function handlePageExport(pageId, req, res, user) {
  const page = await findNormalizedPageByIdAsync(pageId, user.id, req);

  if (!page) {
    return sendJson(res, 404, { error: "Form not found." });
  }

  const enabledFields = getEnabledFormFields(page.fields);
  const headers = [
    "Submitted At",
    "IP Address",
    "Country",
    "City",
    "Device",
    "Platform",
    "Browser",
    ...enabledFields.map((field) => field.label),
  ];

  const rows = page.submissions.map((submission) => [
    submission.submittedAt || "",
    submission.meta?.ip || "",
    submission.meta?.country || "",
    submission.meta?.city || "",
    submission.meta?.device || "",
    submission.meta?.platform || "",
    submission.meta?.browser || "",
    ...enabledFields.map((field) => submission.answers?.[field.key] || ""),
  ]);

  return sendCsv(res, page.slug + "-responses.csv", headers, rows);
}

async function handlePublicFormPage(slug, req, res) {
  const normalizedPage = await findNormalizedPageBySlugAsync(slug, req);

  if (!normalizedPage) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!DOCTYPE html><html><body style=\"font-family:Arial,sans-serif;padding:40px;\"><h1>Form not found</h1><p>This form link is not available.</p></body></html>");
    return;
  }
  const fieldMarkup = normalizeFormFields(normalizedPage.fields).map((field) => {
    const label = `<span style="font-weight:600;color:#1f356c;">${escapeHtml(field.label)}</span>`;
    const requiredAttr = field.required ? "required" : "";
    const optionsMarkup = (field.options || []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
    const inputBaseStyle = "padding:14px 16px;border:1px solid #d9e2f0;border-radius:14px;font:inherit;background:#fff;";

    if (!isInteractiveFormFieldType(field.type)) {
      if (field.type === "divider") {
        return '<hr style="border:none;border-top:1px solid #dce7f7;margin:8px 0 2px;">';
      }
      if (field.type === "heading1") return `<h1 style="margin:0 0 6px;font-size:2rem;line-height:1.08;">${escapeHtml(field.content || field.label)}</h1>`;
      if (field.type === "heading2") return `<h2 style="margin:0 0 6px;font-size:1.6rem;line-height:1.12;color:#17315f;">${escapeHtml(field.content || field.label)}</h2>`;
      if (field.type === "heading3") return `<h3 style="margin:0 0 6px;font-size:1.22rem;line-height:1.2;color:#17315f;">${escapeHtml(field.content || field.label)}</h3>`;
      if (field.type === "title") return `<div style="font-size:.82rem;letter-spacing:.16em;text-transform:uppercase;color:#6580b8;font-weight:700;">${escapeHtml(field.content || field.label)}</div>`;
      if (field.type === "label") return `<div style="font-size:.9rem;color:#58719b;font-weight:600;">${escapeHtml(field.content || field.label)}</div>`;
      if (field.type === "textblock") return `<p style="margin:0;color:#4e6795;font-size:1rem;line-height:1.7;">${escapeHtml(field.content || "")}</p>`;
      if (field.type === "pagebreak") return `<div style="margin:10px 0 4px;padding:14px 18px;border-radius:16px;background:#f4f8ff;border:1px dashed #c8d8f6;color:#17315f;font-weight:700;">${escapeHtml(field.content || "Next section")}</div>`;
      if (field.type === "image" && field.url) return `<div style="display:grid;gap:10px;"><img src="${escapeHtml(field.url)}" alt="${escapeHtml(field.label)}" style="max-width:100%;border-radius:18px;border:1px solid #dce7f7;"><span style="font-size:.88rem;color:#58719b;">${escapeHtml(field.label)}</span></div>`;
      if (field.type === "video" && field.url) return `<div style="display:grid;gap:10px;"><video controls src="${escapeHtml(field.url)}" style="width:100%;border-radius:18px;border:1px solid #dce7f7;background:#000;"></video><span style="font-size:.88rem;color:#58719b;">${escapeHtml(field.label)}</span></div>`;
      if (field.type === "audio" && field.url) return `<div style="display:grid;gap:10px;"><audio controls src="${escapeHtml(field.url)}" style="width:100%;"></audio><span style="font-size:.88rem;color:#58719b;">${escapeHtml(field.label)}</span></div>`;
      if (field.type === "embed" && field.url) return `<div style="display:grid;gap:10px;"><iframe src="${escapeHtml(field.url)}" style="width:100%;min-height:280px;border:1px solid #dce7f7;border-radius:18px;background:#fff;"></iframe><span style="font-size:.88rem;color:#58719b;">${escapeHtml(field.label)}</span></div>`;
      return "";
    }

    if (field.type === "textarea") {
      return `<label style="display:grid;gap:8px;">${label}<textarea name="${field.key}" ${requiredAttr} rows="5" style="${inputBaseStyle}"></textarea></label>`;
    }

    if (field.type === "select") {
      return `<label style="display:grid;gap:8px;">${label}<select name="${field.key}" ${requiredAttr} style="${inputBaseStyle}"><option value="">Select an option</option>${optionsMarkup}</select></label>`;
    }

    if (field.type === "multiselect") {
      return `<label style="display:grid;gap:8px;">${label}<select name="${field.key}" ${requiredAttr} multiple style="${inputBaseStyle} min-height:140px;">${optionsMarkup}</select></label>`;
    }

    if (field.type === "radio") {
      return `<fieldset style="display:grid;gap:10px;border:none;padding:0;margin:0;"><legend style="font-weight:600;color:#1f356c;padding:0;">${escapeHtml(field.label)}</legend>${(field.options || []).map((option) => `<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #d9e2f0;border-radius:14px;"><input type="radio" name="${field.key}" value="${escapeHtml(option)}" ${requiredAttr} style="width:18px;height:18px;">${escapeHtml(option)}</label>`).join("")}</fieldset>`;
    }

    if (field.type === "checkbox" && field.options?.length) {
      return `<fieldset style="display:grid;gap:10px;border:none;padding:0;margin:0;"><legend style="font-weight:600;color:#1f356c;padding:0;">${escapeHtml(field.label)}</legend>${(field.options || []).map((option) => `<label style="display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #d9e2f0;border-radius:14px;"><input type="checkbox" name="${field.key}" value="${escapeHtml(option)}" style="width:18px;height:18px;">${escapeHtml(option)}</label>`).join("")}</fieldset>`;
    }

    if (field.type === "checkbox") {
      return `<label style="display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid #d9e2f0;border-radius:14px;"><input type="checkbox" name="${field.key}" value="Yes" ${requiredAttr} style="width:18px;height:18px;"><span style="font-weight:600;color:#1f356c;">${escapeHtml(field.label)}</span></label>`;
    }

    if (field.type === "scale") {
      return `<label style="display:grid;gap:8px;">${label}<input type="range" name="${field.key}" min="${Number(field.min || 1)}" max="${Number(field.max || 5)}" value="${Number(field.min || 1)}" style="width:100%;"><span style="font-size:.85rem;color:#58719b;display:flex;justify-content:space-between;"><i>${Number(field.min || 1)}</i><i>${Number(field.max || 5)}</i></span></label>`;
    }

    const htmlType = mapFieldTypeToHtmlInput(field.type);
    return `<label style="display:grid;gap:8px;">${label}<input type="${htmlType}" name="${field.key}" ${requiredAttr} style="${inputBaseStyle}"></label>`;
  }).join("");

  const html = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(normalizedPage.title)} | AnyLink Form</title>
      <style>
        body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:linear-gradient(180deg,#edf5ff,#f8fbff);color:#132b5c;}
        .wrap{max-width:760px;margin:0 auto;padding:32px 18px 60px;}
        .card{background:#fff;border:1px solid #dce7f7;border-radius:28px;padding:28px;box-shadow:0 22px 60px rgba(39,85,166,.12);}
        .eyebrow{margin:0 0 10px;color:#6580b8;letter-spacing:.16em;text-transform:uppercase;font-size:.8rem}
        h1{margin:0 0 12px;font-size:clamp(2rem,5vw,3rem);line-height:1.02}
        p{margin:0 0 18px;color:#4e6795;font-size:1rem;line-height:1.65}
        form{display:grid;gap:16px;margin-top:22px}
        button{height:52px;border:none;border-radius:16px;background:linear-gradient(135deg,#2852e0,#10a9d9);color:#fff;font-weight:700;font-size:1rem;cursor:pointer}
        .status{display:none;margin-top:16px;padding:14px 16px;border-radius:14px;background:#eff8f2;color:#1f7a42}
        .status.error{background:#fff1f0;color:#b3402d}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="card">
          <p class="eyebrow">Response form</p>
          <h1>${escapeHtml(normalizedPage.headline)}</h1>
          <p>${escapeHtml(normalizedPage.description || "Fill out this form and your response will go straight into the owner's dashboard.")}</p>
          <form id="publicForm">
            ${fieldMarkup}
            <button type="submit">${escapeHtml(normalizedPage.submitLabel)}</button>
          </form>
          <div id="formStatus" class="status" aria-live="polite"></div>
        </div>
      </div>
      <script>
        const form = document.getElementById("publicForm");
        const status = document.getElementById("formStatus");
        async function fileToPayload(file) {
          return {
            name: file.name,
            type: file.type,
            size: file.size
          };
        }
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const formData = new FormData(form);
          const entries = {};
          for (const element of [...form.elements]) {
            if (!element.name) continue;
            if (element.type === "file") {
              const file = element.files && element.files[0];
              entries[element.name] = file ? await fileToPayload(file) : "";
              continue;
            }
            if (element.tagName === "SELECT" && element.multiple) {
              entries[element.name] = [...element.selectedOptions].map((option) => option.value);
              continue;
            }
            if (element.type === "checkbox") {
              const matching = [...form.querySelectorAll('[name="' + element.name + '"]')];
              if (matching.length > 1) {
                entries[element.name] = matching.filter((item) => item.checked).map((item) => item.value);
              } else {
                entries[element.name] = element.checked ? element.value : "";
              }
              continue;
            }
            if (element.type === "radio") {
              if (Object.prototype.hasOwnProperty.call(entries, element.name)) continue;
              const checked = form.querySelector('[name="' + element.name + '"]:checked');
              entries[element.name] = checked ? checked.value : "";
              continue;
            }
            entries[element.name] = element.value;
          }
          status.className = "status";
          status.style.display = "block";
          status.textContent = "Submitting...";
          try {
            const response = await fetch("/api/forms/${encodeURIComponent(normalizedPage.slug)}/submit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entries)
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Unable to submit form.");
            form.reset();
            status.textContent = payload.message || ${JSON.stringify(getThankYouContent(normalizedPage))};
          } catch (error) {
            status.className = "status error";
            status.style.display = "block";
            status.textContent = error.message;
          }
        });
      </script>
    </body>
  </html>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function handlePublicFormSubmit(slug, body, req, res) {
  const normalizedPage = await findNormalizedPageBySlugAsync(slug, req);
  const pages = dbOnlyMode ? [] : readPages();
  const page = pages.find((item) => item.slug === slug);

  if (!normalizedPage) {
    return sendJson(res, 404, { error: "Form not found." });
  }

  const answers = {};
  const dbAnswers = [];

  for (const field of getEnabledFormFields(normalizedPage.fields)) {
    const rawValue = body[field.key];
    let value = "";
    if (field.type === "checkbox" && Array.isArray(rawValue)) {
      value = rawValue.join(", ");
    } else if (field.type === "checkbox") {
      value = rawValue ? String(rawValue).trim() : "";
    } else if (field.type === "multiselect" && Array.isArray(rawValue)) {
      value = rawValue.join(", ");
    } else if (field.type === "file" && rawValue && typeof rawValue === "object") {
      value = [rawValue.name, rawValue.type, rawValue.size ? `${rawValue.size} bytes` : ""].filter(Boolean).join(" • ");
    } else {
      value = String(rawValue || "").trim();
    }
    if (field.required && !value) {
      return sendJson(res, 400, { error: field.label + " is required." });
    }
    answers[field.key] = value;
    dbAnswers.push({ fieldKey: field.key, fieldLabel: field.label, value });
  }

  const geo = getGeoDetails(req);
  const agent = parseUserAgent(req.headers["user-agent"] || "");

  if (page) {
    page.submissions = Array.isArray(page.submissions) ? page.submissions : [];
    page.submissions.unshift({
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      answers,
      meta: {
        ip: getClientIp(req),
        country: geo.country,
        city: geo.city,
        browser: agent.browser,
        platform: agent.platform,
        device: agent.deviceType,
      },
    });
    page.updatedAt = new Date().toISOString();
    writePages(pages);
  }

  try {
    const dbPage = await findPageBySlug(slug);
    if (dbPage) {
      await createSubmission(dbPage.id, {
        ipAddress: getClientIp(req),
        country: geo.country,
        city: geo.city,
        browser: agent.browser,
        platform: agent.platform,
        device: agent.deviceType,
      }, dbAnswers);
    }
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to save this response right now. Please try again." });
    }
    // JSON remains fallback during DB migration.
  }

  queueWebhookEvent(normalizedPage.userId, "form.submitted", {
    form: {
      id: normalizedPage.id || "",
      slug: normalizedPage.slug,
      title: normalizedPage.title,
      headline: normalizedPage.headline,
    },
    submission: {
      submittedAt: new Date().toISOString(),
      ip: getClientIp(req),
      country: geo.country,
      city: geo.city,
      browser: agent.browser,
      platform: agent.platform,
      device: agent.deviceType,
      answers,
    },
  }, req).catch(() => {});
  return sendJson(res, 201, { success: true, message: normalizedPage.thanksMessage });
}

async function checkDestinationHealth(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  const result = {
    status: "unknown",
    httpStatus: 0,
    checkedAt: new Date().toISOString(),
    error: "",
  };

  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
    }

    result.httpStatus = Number(response.status || 0);
    if (response.ok) {
      result.status = "healthy";
    } else if (response.status >= 500) {
      result.status = "broken";
    } else {
      result.status = "degraded";
    }
  } catch (error) {
    result.status = "broken";
    result.error = error.name === "AbortError" ? "Request timed out" : String(error.message || "Health check failed");
  } finally {
    clearTimeout(timeout);
  }

  return result;
}

async function handleLinksHealthCheck(body, req, res, user) {
  const links = await readLinksForUserAsync(user.id);
  const requestedSlug = sanitizeSlugInput(String(body?.slug || "").trim());
  const targetLinks = requestedSlug ? links.filter((item) => item.slug === requestedSlug) : links.slice(0, 100);

  if (!targetLinks.length) {
    return sendJson(res, 404, { error: requestedSlug ? "Link not found." : "No links found." });
  }

  const settings = await readSettingsForUserAsync(user.id, req);
  const nextHealth = {
    ...(settings.linkHealth || {}),
  };
  const results = [];

  for (const link of targetLinks) {
    const health = await checkDestinationHealth(link.destination);
    nextHealth[link.slug] = health;
    results.push({
      slug: link.slug,
      destination: link.destination,
      ...health,
    });
  }

  const nextSettings = normalizeSettings({
    ...settings,
    linkHealth: nextHealth,
  }, req);

  if (!dbOnlyMode) {
    const store = readSettingsStore().filter((item) => item.userId !== user.id);
    store.push(nextSettings);
    writeSettingsStore(store);
  }

  return sendJson(res, 200, {
    checked: results.length,
    results,
    settings: nextSettings,
  });
}

async function handleDeleteLink(slug, req, res, user) {
  const links = dbOnlyMode ? [] : readLinks();
  const fileMatch = links.find((item) => item.slug === slug && item.userId === user.id) || null;
  let dbMatch = null;

  try {
    const found = await findLinkBySlug(slug);
    if (found && found.userId === user.id) {
      dbMatch = found;
    }
  } catch {
    dbMatch = null;
  }

  const linkToTrash = fileMatch || (dbMatch ? {
    id: dbMatch.id,
    userId: dbMatch.userId,
    slug: dbMatch.slug,
    destination: dbMatch.destination,
    shortUrl: dbMatch.shortUrl,
    includeQr: dbMatch.includeQr,
    createdAt: dbMatch.createdAt instanceof Date ? dbMatch.createdAt.toISOString() : dbMatch.createdAt,
    analytics: createEmptyAnalytics(),
  } : null);

  if (!linkToTrash) {
    return sendJson(res, 404, { error: "Link not found." });
  }

  let trashLinks = [];
  try {
    trashLinks = await readTrashLinksForUserAsync(user.id, req);
  } catch {
    trashLinks = [];
  }

  const trashedItem = {
    ...linkToTrash,
    deletedAt: new Date().toISOString(),
  };

  const nextTrashLinks = normalizeTrashLinks([
    trashedItem,
    ...trashLinks.filter((item) => item.slug !== slug),
  ]);

  if (!dbOnlyMode && fileMatch) {
    writeLinks(links.filter((item) => !(item.slug === slug && item.userId === user.id)));
  }

  try {
    await deleteLinkBySlug(slug, user.id);
  } catch (error) {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to complete this request right now. Please try again.", details: error.message });
    }
  }

  try {
    writeSettingsExtras(user.id, req, () => ({ trashLinks: nextTrashLinks }));
  } catch {
    // Trash sync is best-effort while migration is in progress.
  }

  queueWebhookEvent(user.id, "link.deleted", {
    link: {
      id: String(trashedItem.id || ""),
      slug: trashedItem.slug,
      destination: trashedItem.destination,
      shortUrl: trashedItem.shortUrl,
      includeQr: Boolean(trashedItem.includeQr),
      deletedAt: trashedItem.deletedAt,
    },
  }, req).catch(() => {});
  return sendJson(res, 200, { success: true, trashLink: trashedItem, trashLinks: nextTrashLinks });
}

async function handleRestoreTrashLink(slug, req, res, user) {
  const trashLinks = await readTrashLinksForUserAsync(user.id, req);
  const trashedLink = trashLinks.find((item) => item.slug === slug);

  if (!trashedLink) {
    return sendJson(res, 404, { error: "Deleted link not found." });
  }

  const liveLinks = await readLinksForUserAsync(user.id);
  if (liveLinks.some((item) => item.slug === slug)) {
    return sendJson(res, 409, { error: "That slug is already in use. Delete or rename the current link first." });
  }

  const settings = await readSettingsForUserAsync(user.id, req);
  const restoredLink = {
    id: trashedLink.id || Date.now(),
    userId: user.id,
    slug: trashedLink.slug,
    destination: normalizeUrl(trashedLink.destination || "") || trashedLink.destination,
    shortUrl: buildShortUrl(settings.defaultDomain || publicAppDomain, trashedLink.slug),
    includeQr: Boolean(trashedLink.includeQr),
    createdAt: trashedLink.createdAt || new Date().toISOString(),
    analytics: trashedLink.analytics || createEmptyAnalytics(),
  };

  if (!dbOnlyMode) {
    const links = readLinks();
    links.unshift(restoredLink);
    writeLinks(links);
  }

  try {
    await createDbLink({
      id: String(restoredLink.id),
      userId: user.id,
      slug: restoredLink.slug,
      destination: restoredLink.destination,
      shortUrl: restoredLink.shortUrl,
      includeQr: restoredLink.includeQr,
      createdAt: new Date(restoredLink.createdAt),
    });
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to restore this link right now. Please try again." });
    }
  }

  const nextTrashLinks = normalizeTrashLinks(trashLinks.filter((item) => item.slug !== slug));
  writeSettingsExtras(user.id, req, () => ({ trashLinks: nextTrashLinks }));
  return sendJson(res, 200, { success: true, link: restoredLink, trashLinks: nextTrashLinks });
}

async function handleDeleteTrashLinkForever(slug, req, res, user) {
  const trashLinks = await readTrashLinksForUserAsync(user.id, req);
  if (!trashLinks.some((item) => item.slug === slug)) {
    return sendJson(res, 404, { error: "Deleted link not found." });
  }

  const nextTrashLinks = normalizeTrashLinks(trashLinks.filter((item) => item.slug !== slug));
  writeSettingsExtras(user.id, req, () => ({ trashLinks: nextTrashLinks }));
  return sendJson(res, 200, { success: true, trashLinks: nextTrashLinks });
}

async function buildAnalyticsReport(userId, filters = parseAnalyticsFilters()) {
  try {
      const links = await listAnalyticsByUser(userId);
      if (Array.isArray(links) && links.length) {
        const fileLinks = !dbOnlyMode ? readLinksForUser(userId) : [];
        const fileAnalyticsMap = new Map(fileLinks.map((link) => [link.slug, Array.isArray(link.analytics?.clicks) ? link.analytics.clicks : []]));
        const normalizedLinks = links.map((link) => {
          const dbClicks = (link.clickEvents || []).map((click) => ({
            id: click.id,
            clickedAt: click.createdAt instanceof Date ? click.createdAt.toISOString() : click.createdAt,
            ip: click.ipAddress || "Unknown",
            country: click.country || "Unknown",
            city: click.city || "Unknown",
            cityLabel: click.city && click.country !== "Unknown" ? (click.city + ", " + click.country) : (click.city || click.country || "Unknown"),
            platform: click.platform || "Unknown",
            deviceType: click.device || "Web",
            browser: click.browser || "Unknown",
            referrer: click.referrer || "",
            referrerLabel: click.referrer || "Direct",
            visitorId: "",
            sessionId: "",
            language: "Unknown",
            slug: link.slug,
            shortUrl: link.shortUrl,
          }));
          const fileClicks = (fileAnalyticsMap.get(link.slug) || []).map((click) => ({
            ...click,
            referrerLabel: click.referrer || "Direct",
            slug: link.slug,
            shortUrl: link.shortUrl,
          }));
          const clicks = filterClicksByAnalyticsRange((fileClicks.length ? fileClicks : dbClicks), filters);

          return {
            id: link.id,
            slug: link.slug,
            shortUrl: link.shortUrl,
            destination: link.destination,
            totalClicks: clicks.length,
            uniqueClicks: countUniqueClicks(clicks),
            repeatClicks: Math.max(0, clicks.length - countUniqueClicks(clicks)),
            lastClickedAt: clicks[0]?.clickedAt || "",
            topCountries: summarizeClicks(clicks, "country"),
            topCities: summarizeClicks(clicks, "cityLabel"),
            topDevices: summarizeClicks(clicks, "deviceType"),
            topPlatforms: summarizeClicks(clicks, "platform"),
            topBrowsers: summarizeClicks(clicks, "browser"),
            topLanguages: summarizeClicks(clicks, "language"),
            topReferrers: summarizeClicks(clicks, "referrerLabel"),
            recentClicks: clicks.slice(0, 8),
            createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : link.createdAt,
          };
        });

      const allClicks = normalizedLinks.flatMap((link) => link.recentClicks.map((click) => ({
        ...click,
        slug: link.slug,
        shortUrl: link.shortUrl,
      })));

        return {
          appliedRange: filters.range,
          appliedRangeLabel: filters.label,
          customStart: filters.customStart || "",
          customEnd: filters.customEnd || "",
          totalLinks: normalizedLinks.length,
          totalClicks: normalizedLinks.reduce((sum, link) => sum + Number(link.totalClicks || 0), 0),
          uniqueClicks: countUniqueClicks(allClicks),
          repeatClicks: Math.max(0, normalizedLinks.reduce((sum, link) => sum + Number(link.totalClicks || 0), 0) - countUniqueClicks(allClicks)),
          topCountries: summarizeClicks(allClicks, "country"),
          topCities: summarizeClicks(allClicks, "cityLabel"),
          topDevices: summarizeClicks(allClicks, "deviceType"),
          topPlatforms: summarizeClicks(allClicks, "platform"),
          topBrowsers: summarizeClicks(allClicks, "browser"),
          topLanguages: summarizeClicks(allClicks, "language"),
          topReferrers: summarizeClicks(allClicks.map((click) => ({ ...click, referrerLabel: click.referrer || "Direct" })), "referrerLabel"),
          recentClicks: allClicks.slice().sort((left, right) => new Date(right.clickedAt).getTime() - new Date(left.clickedAt).getTime()).slice(0, 12),
          links: normalizedLinks.sort((left, right) => right.totalClicks - left.totalClicks || new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()),
        };
      }
    if (dbOnlyMode) {
        return {
          appliedRange: filters.range,
          appliedRangeLabel: filters.label,
          customStart: filters.customStart || "",
          customEnd: filters.customEnd || "",
          totalLinks: 0,
          totalClicks: 0,
          uniqueClicks: 0,
          repeatClicks: 0,
          topCountries: [],
          topCities: [],
          topDevices: [],
          topPlatforms: [],
          topBrowsers: [],
          topLanguages: [],
          topReferrers: [],
          recentClicks: [],
          links: [],
        };
    }
  } catch {
    if (dbOnlyMode) {
        return {
          appliedRange: filters.range,
          appliedRangeLabel: filters.label,
          customStart: filters.customStart || "",
          customEnd: filters.customEnd || "",
          totalLinks: 0,
          totalClicks: 0,
          uniqueClicks: 0,
          repeatClicks: 0,
          topCountries: [],
          topCities: [],
          topDevices: [],
          topPlatforms: [],
          topBrowsers: [],
          topLanguages: [],
          topReferrers: [],
          recentClicks: [],
          links: [],
        };
    }
  }

  const links = readLinksForUser(userId);
  const totalClicks = links.reduce((sum, link) => sum + Number(link.analytics?.totalClicks || 0), 0);
    const allClicks = links.flatMap((link) => filterClicksByAnalyticsRange((Array.isArray(link.analytics?.clicks) ? link.analytics.clicks : []).map((click) => ({
      ...click,
      referrerLabel: click.referrer || "Direct",
      slug: link.slug,
      shortUrl: link.shortUrl,
    })), filters));

    return {
      appliedRange: filters.range,
      appliedRangeLabel: filters.label,
      customStart: filters.customStart || "",
      customEnd: filters.customEnd || "",
      totalLinks: links.length,
      totalClicks: allClicks.length,
      uniqueClicks: countUniqueClicks(allClicks),
      repeatClicks: Math.max(0, allClicks.length - countUniqueClicks(allClicks)),
      topCountries: summarizeClicks(allClicks, "country"),
      topCities: summarizeClicks(allClicks, "cityLabel"),
      topDevices: summarizeClicks(allClicks, "deviceType"),
      topPlatforms: summarizeClicks(allClicks, "platform"),
      topBrowsers: summarizeClicks(allClicks, "browser"),
      topLanguages: summarizeClicks(allClicks, "language"),
      topReferrers: summarizeClicks(allClicks, "referrerLabel"),
      recentClicks: allClicks.sort((left, right) => new Date(right.clickedAt).getTime() - new Date(left.clickedAt).getTime()).slice(0, 12),
      links: links.map((link) => ({
      id: link.id,
        slug: link.slug,
        shortUrl: link.shortUrl,
        destination: link.destination,
        totalClicks: filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters).length,
        uniqueClicks: countUniqueClicks(filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters)),
        repeatClicks: Math.max(0, filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters).length - countUniqueClicks(filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters))),
        lastClickedAt: filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters)[0]?.clickedAt || "",
        topCountries: summarizeClicks(filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters), "country"),
        topCities: summarizeClicks(filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters), "cityLabel"),
        topDevices: summarizeClicks(filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters), "deviceType"),
        topPlatforms: summarizeClicks(filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters), "platform"),
        topBrowsers: summarizeClicks(filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters), "browser"),
        topLanguages: summarizeClicks(filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters), "language"),
        topReferrers: summarizeClicks(filterClicksByAnalyticsRange((link.analytics?.clicks || []).map((click) => ({ ...click, referrerLabel: click.referrer || "Direct" })), filters), "referrerLabel"),
        recentClicks: filterClicksByAnalyticsRange(link.analytics?.clicks || [], filters).slice().sort((left, right) => new Date(right.clickedAt).getTime() - new Date(left.clickedAt).getTime()).slice(0, 8),
        createdAt: link.createdAt || "",
      })).sort((left, right) => right.totalClicks - left.totalClicks || new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()),
    };
}

async function handleAnalyticsExport(req, res, user, filters = parseAnalyticsFilters()) {
    const analytics = await buildAnalyticsReport(user.id, filters);
    const headers = [
      "Slug",
      "Short URL",
      "Destination",
      "Total Clicks",
      "Unique Clicks",
      "Last Clicked At",
      "Top Countries",
      "Top Cities",
    "Top Devices",
    "Top Browsers",
    "Top Platforms",
  ];

  const rows = analytics.links.map((link) => [
      link.slug || "",
      link.shortUrl || "",
      link.destination || "",
      String(link.totalClicks || 0),
      String(link.uniqueClicks || 0),
      link.lastClickedAt || "",
      formatAnalyticsExportList(link.topCountries),
      formatAnalyticsExportList(link.topCities),
    formatAnalyticsExportList(link.topDevices),
    formatAnalyticsExportList(link.topBrowsers),
    formatAnalyticsExportList(link.topPlatforms),
  ]);

  return sendCsv(res, "anylink-analytics.csv", headers, rows);
}

async function handleSaveSettings(body, req, res, user) {
  const currentSettings = await readSettingsForUserAsync(user.id, req);
  const workspaceName = String(body.workspaceName || currentSettings.workspaceName || "").trim();
  const defaultDomain = sanitizeDomainInput(String(body.defaultDomain || currentSettings.defaultDomain || "").trim(), req);
  const requestedDomains = Array.isArray(body.domains) ? body.domains : currentSettings.domains;
  const domains = normalizeDomains(requestedDomains, req);
  const conversionGoals = normalizeConversionGoals(body.conversionGoals || currentSettings.conversionGoals || {});
  const goalAlertState = normalizeGoalAlertState(body.goalAlertState || currentSettings.goalAlertState || {});
  const linkRules = normalizeLinkRules(body.linkRules || currentSettings.linkRules || {}, currentSettings.linkRules || {});
  const linkHealth = normalizeLinkHealth(body.linkHealth || currentSettings.linkHealth || {});
  const campaignTemplates = normalizeCampaignTemplates(body.campaignTemplates || currentSettings.campaignTemplates || []);
  const pixelTemplates = normalizePixelTemplates(body.pixelTemplates || currentSettings.pixelTemplates || []);
  const teamMembers = normalizeTeamMembers(body.teamMembers || currentSettings.teamMembers || []);
  const webhooks = normalizeWebhookEndpoints(body.webhooks || currentSettings.webhooks || []);
  const trashLinks = normalizeTrashLinks(body.trashLinks || currentSettings.trashLinks || []);
  const campaigns = normalizeCampaigns(body.campaigns || currentSettings.campaigns || []);

  if (!workspaceName) {
    return sendJson(res, 400, { error: "Workspace name is required." });
  }

  if (!defaultDomain) {
    return sendJson(res, 400, { error: "Enter a valid domain or host." });
  }

  if (!domains.includes(defaultDomain)) {
    domains.unshift(defaultDomain);
  }

  const currentDomainEntries = currentSettings.domainEntries || [];
  const nextSettings = normalizeSettings({
    userId: user.id,
    workspaceName,
    defaultDomain,
    domains,
    domainEntries: currentDomainEntries,
    conversionGoals,
    goalAlertState,
    linkRules,
    linkHealth,
    campaignTemplates,
    pixelTemplates,
    teamMembers,
    webhooks,
    trashLinks,
    campaigns,
  }, req);

  if (!dbOnlyMode) {
    const store = readSettingsStore().filter((item) => item.userId !== user.id);
    store.push(nextSettings);
    writeSettingsStore(store);
  }
  try {
    await upsertWorkspaceSettings(user.id, {
      workspaceName: nextSettings.workspaceName,
      defaultDomain: nextSettings.defaultDomain,
    });

    const customHosts = nextSettings.domains.filter((domain) => domain !== publicAppDomain);
    await removeDomainsNotIn(user.id, customHosts);

      for (const entry of nextSettings.domainEntries.filter((item) => item.host !== publicAppDomain)) {
        await upsertDomain(user.id, entry.host, {
          status: entry.status,
          isActive: entry.isActive,
          dnsTarget: entry.dnsTarget || getProviderDnsTarget(),
          verifiedAt: entry.verifiedAt ? new Date(entry.verifiedAt) : null,
          provider: entry.provider || (isCloudflareSaasConfigured() ? "cloudflare" : "manual"),
          sslStatus: entry.sslStatus || null,
          ownershipStatus: entry.ownershipStatus || null,
          providerHostnameId: entry.providerHostnameId || null,
        });
      }
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to save your settings right now. Please try again." });
    }
    // JSON remains fallback during DB migration.
  }
  return sendJson(res, 200, { settings: nextSettings });
}

async function handleGoDaddyConnect(body, req, res, user) {
  const apiKey = String(body?.apiKey || "").trim();
  const apiSecret = String(body?.apiSecret || "").trim();

  if (!apiKey || !apiSecret) {
    return sendJson(res, 400, { error: "GoDaddy API key and secret are required." });
  }

  try {
    await validateGoDaddyCredentials({ apiKey, apiSecret });
    setGoDaddyTokenForUser(user.id, apiKey, apiSecret);
    const settings = await readSettingsForUserAsync(user.id, req);
    return sendJson(res, 200, {
      success: true,
      domainAutomation: settings.domainAutomation,
      settings,
    });
  } catch (error) {
    return sendJson(res, 400, { error: `GoDaddy connection failed: ${error.message}` });
  }
}

async function handleGoDaddyDisconnect(req, res, user) {
  clearGoDaddyTokenForUser(user.id);
  const settings = await readSettingsForUserAsync(user.id, req);
  return sendJson(res, 200, {
    success: true,
    domainAutomation: settings.domainAutomation,
    settings,
  });
}

async function handleGetTeamMembers(req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  return sendJson(res, 200, { teamMembers: settings.teamMembers || [] });
}

async function handleUpsertTeamMember(body, req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  const id = String(body?.id || "").trim() || crypto.randomUUID();
  const email = String(body?.email || "").trim().toLowerCase();
  const role = ["admin", "editor", "viewer"].includes(String(body?.role || "").trim().toLowerCase())
    ? String(body?.role || "").trim().toLowerCase()
    : "viewer";
  const name = String(body?.name || "").trim() || (email.split("@")[0] || "Member");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(res, 400, { error: "Enter a valid member email." });
  }

  const existing = normalizeTeamMembers(settings.teamMembers || []);
  const next = [
    { id, email, role, name, status: "active", updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
    ...existing.filter((item) => item.id !== id && item.email !== email),
  ];

  const nextSettings = normalizeSettings({
    ...settings,
    teamMembers: next,
  }, req);

  if (!dbOnlyMode) {
    const store = readSettingsStore().filter((item) => item.userId !== user.id);
    store.push(nextSettings);
    writeSettingsStore(store);
  }

  appendAuditLog("team.member.upsert", { userId: user.id, email: user.email, type: "user" }, { workspaceUserId: user.id, memberEmail: email, role });
  return sendJson(res, 200, { teamMembers: nextSettings.teamMembers, settings: nextSettings });
}

async function handleRemoveTeamMember(memberId, req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  const existing = normalizeTeamMembers(settings.teamMembers || []);
  const match = existing.find((item) => item.id === memberId);
  const next = existing.filter((item) => item.id !== memberId);

  const nextSettings = normalizeSettings({
    ...settings,
    teamMembers: next,
  }, req);

  if (!dbOnlyMode) {
    const store = readSettingsStore().filter((item) => item.userId !== user.id);
    store.push(nextSettings);
    writeSettingsStore(store);
  }

  if (match) {
    appendAuditLog("team.member.remove", { userId: user.id, email: user.email, type: "user" }, { workspaceUserId: user.id, memberEmail: match.email, role: match.role });
  }
  return sendJson(res, 200, { teamMembers: nextSettings.teamMembers, settings: nextSettings });
}

function serializeWebhookEndpointForClient(endpoint, includeSecret = false) {
  if (!endpoint) return null;
  const secret = String(endpoint.secret || "");
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    events: Array.isArray(endpoint.events) ? endpoint.events : [...webhookAllowedEvents],
    isActive: endpoint.isActive !== false,
    createdAt: endpoint.createdAt || "",
    updatedAt: endpoint.updatedAt || "",
    lastTriggeredAt: endpoint.lastTriggeredAt || "",
    lastStatus: Number(endpoint.lastStatus || 0),
    lastError: endpoint.lastError || "",
    totalSuccess: Math.max(0, Number(endpoint.totalSuccess || 0)),
    totalFailed: Math.max(0, Number(endpoint.totalFailed || 0)),
    signingSecret: includeSecret ? secret : "",
    signingSecretPreview: secret ? `${secret.slice(0, 10)}...${secret.slice(-6)}` : "",
  };
}

async function persistWebhookSettingsForUser(userId, req, webhooks) {
  const settings = await readSettingsForUserAsync(userId, req);
  const nextSettings = normalizeSettings({
    ...settings,
    webhooks: normalizeWebhookEndpoints(webhooks),
  }, req);

  if (!dbOnlyMode) {
    const store = readSettingsStore().filter((item) => item.userId !== userId);
    store.push(nextSettings);
    writeSettingsStore(store);
  }

  return nextSettings;
}

async function handleListWebhooks(req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  const webhooks = normalizeWebhookEndpoints(settings.webhooks || []).map((item) => serializeWebhookEndpointForClient(item, false));
  return sendJson(res, 200, { webhooks });
}

async function handleUpsertWebhook(body, req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  const existing = normalizeWebhookEndpoints(settings.webhooks || []);
  const id = String(body?.id || "").trim();
  const name = String(body?.name || "").trim() || "Automation webhook";
  const url = String(body?.url || "").trim();
  const isActive = body?.isActive !== false;
  const events = normalizeWebhookEvents(body?.events || []);

  if (!url) {
    return sendJson(res, 400, { error: "Webhook URL is required." });
  }

  let parsedUrl = "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return sendJson(res, 400, { error: "Webhook URL must use http or https." });
    }
    parsedUrl = parsed.toString();
  } catch {
    return sendJson(res, 400, { error: "Enter a valid webhook URL." });
  }

  const nowIso = new Date().toISOString();
  const current = id ? existing.find((item) => item.id === id) : null;
  const webhook = normalizeWebhookEndpoint({
    ...(current || {}),
    id: current?.id || id || crypto.randomUUID(),
    name,
    url: parsedUrl,
    events,
    isActive,
    updatedAt: nowIso,
    createdAt: current?.createdAt || nowIso,
    secret: current?.secret || `whsec_${crypto.randomBytes(24).toString("hex")}`,
  });

  if (!webhook) {
    return sendJson(res, 400, { error: "Unable to save webhook. Check your URL and fields." });
  }

  const nextWebhooks = [webhook, ...existing.filter((item) => item.id !== webhook.id)];
  const nextSettings = await persistWebhookSettingsForUser(user.id, req, nextWebhooks);
  appendAuditLog("webhook.upsert", { userId: user.id, email: user.email, type: "user" }, { webhookId: webhook.id, webhookUrl: webhook.url });
  return sendJson(res, 200, {
    success: true,
    webhook: serializeWebhookEndpointForClient(webhook, true),
    webhooks: nextSettings.webhooks.map((item) => serializeWebhookEndpointForClient(item, false)),
    settings: nextSettings,
  });
}

async function handleDeleteWebhook(webhookId, req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  const existing = normalizeWebhookEndpoints(settings.webhooks || []);
  const match = existing.find((item) => item.id === webhookId);
  if (!match) {
    return sendJson(res, 404, { error: "Webhook not found." });
  }
  const nextSettings = await persistWebhookSettingsForUser(user.id, req, existing.filter((item) => item.id !== webhookId));
  appendAuditLog("webhook.delete", { userId: user.id, email: user.email, type: "user" }, { webhookId: match.id, webhookUrl: match.url });
  return sendJson(res, 200, {
    success: true,
    webhooks: nextSettings.webhooks.map((item) => serializeWebhookEndpointForClient(item, false)),
    settings: nextSettings,
  });
}

async function handleTestWebhook(webhookId, req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  const endpoint = normalizeWebhookEndpoints(settings.webhooks || []).find((item) => item.id === webhookId);
  if (!endpoint) {
    return sendJson(res, 404, { error: "Webhook not found." });
  }
  const result = await deliverWebhookEvent(user.id, endpoint, "subscription.updated", {
    source: "manual_test",
    message: "AnyLink test webhook delivery",
    triggeredBy: user.email,
  }, req);
  return sendJson(res, result.ok ? 200 : 502, {
    success: result.ok,
    status: result.status,
    message: result.ok ? "Test event sent successfully." : "Test event failed. Check URL or automation endpoint.",
    error: result.ok ? "" : result.error,
  });
}

function signWebhookBody(secret, timestamp, payloadBody) {
  const raw = `${timestamp}.${payloadBody}`;
  const digest = crypto.createHmac("sha256", String(secret || "")).update(raw).digest("hex");
  return `sha256=${digest}`;
}

async function persistWebhookDeliveryResult(userId, webhookId, req, outcome) {
  try {
    const settings = await readSettingsForUserAsync(userId, req);
    const existing = normalizeWebhookEndpoints(settings.webhooks || []);
    const target = existing.find((item) => item.id === webhookId);
    if (!target) return;
    const nowIso = new Date().toISOString();
    const nextWebhooks = existing.map((item) => {
      if (item.id !== webhookId) return item;
      return normalizeWebhookEndpoint({
        ...item,
        updatedAt: nowIso,
        lastTriggeredAt: nowIso,
        lastStatus: Number(outcome.status || 0),
        lastError: outcome.ok ? "" : String(outcome.error || "Webhook delivery failed."),
        totalSuccess: Number(item.totalSuccess || 0) + (outcome.ok ? 1 : 0),
        totalFailed: Number(item.totalFailed || 0) + (outcome.ok ? 0 : 1),
      });
    }).filter(Boolean);
    await persistWebhookSettingsForUser(userId, req, nextWebhooks);
  } catch {
    // Webhook stats are best effort.
  }
}

async function deliverWebhookEvent(userId, endpoint, eventName, data, req) {
  const timestamp = Date.now().toString();
  const deliveryId = crypto.randomUUID();
  const settings = await readSettingsForUserAsync(userId, req);
  const payload = {
    id: deliveryId,
    event: eventName,
    createdAt: new Date().toISOString(),
    workspace: {
      userId,
      workspaceName: settings.workspaceName || "AnyLink Workspace",
      defaultDomain: settings.defaultDomain || publicAppDomain,
    },
    data: data || {},
  };
  const payloadBody = JSON.stringify(payload);
  const signature = signWebhookBody(endpoint.secret || "", timestamp, payloadBody);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webhookDeliveryTimeoutMs);
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AnyLink-Webhook/1.0",
        "X-AnyLink-Event": eventName,
        "X-AnyLink-Delivery": deliveryId,
        "X-AnyLink-Timestamp": timestamp,
        "X-AnyLink-Signature": signature,
      },
      body: payloadBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const ok = response.ok;
    const outcome = {
      ok,
      status: Number(response.status || 0),
      error: ok ? "" : `HTTP ${response.status}`,
    };
    await persistWebhookDeliveryResult(userId, endpoint.id, req, outcome);
    return outcome;
  } catch (error) {
    clearTimeout(timeout);
    const outcome = {
      ok: false,
      status: 0,
      error: error?.name === "AbortError" ? "Delivery timed out." : String(error?.message || "Delivery failed."),
    };
    await persistWebhookDeliveryResult(userId, endpoint.id, req, outcome);
    return outcome;
  }
}

async function queueWebhookEvent(userId, eventName, data, req) {
  const normalizedEvent = String(eventName || "").trim().toLowerCase();
  if (!userId || !webhookAllowedEvents.has(normalizedEvent)) {
    return;
  }
  try {
    const settings = await readSettingsForUserAsync(userId, req);
    const targets = normalizeWebhookEndpoints(settings.webhooks || []).filter((item) => item.isActive && item.events.includes(normalizedEvent));
    if (!targets.length) return;
    await Promise.allSettled(targets.map((endpoint) => deliverWebhookEvent(userId, endpoint, normalizedEvent, data, req)));
  } catch {
    // Webhooks should never block product workflows.
  }
}

async function handleVerifyDomain(domain, req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  const sanitizedDomain = sanitizeDomainInput(domain, req);

  if (!sanitizedDomain) {
    return sendJson(res, 400, { error: "Invalid domain." });
  }

  const knownDomains = new Set([
    ...(Array.isArray(settings.domains) ? settings.domains : []),
    ...((settings.domainEntries || []).map((entry) => entry.host).filter(Boolean)),
  ]);

  if (!knownDomains.has(sanitizedDomain)) {
    return sendJson(res, 404, { error: "Domain not found in your workspace." });
  }

  let autoDnsAttempted = false;
  let autoDnsError = null;
  if (sanitizedDomain !== publicAppDomain) {
    try {
      const result = await ensureGoDaddyCnameRecord(user.id, sanitizedDomain, getProviderDnsTarget());
      autoDnsAttempted = Boolean(result.attempted);
    } catch (error) {
      autoDnsAttempted = true;
      autoDnsError = error.message;
    }
  }

  if (sanitizedDomain !== publicAppDomain && isCloudflareSaasConfigured()) {
    try {
      const hostname = await ensureCloudflareCustomHostname(sanitizedDomain);
      const syncedEntry = mapCloudflareDomainStatus(hostname, settings.defaultDomain, sanitizedDomain);
      const nextEntries = settings.domainEntries.map((entry) => {
        if (entry.host !== sanitizedDomain) {
          return entry;
        }

        return {
          ...entry,
          ...syncedEntry,
          isActive: entry.host === settings.defaultDomain,
        };
      });

      const nextSettings = normalizeSettings({
        ...settings,
        domainEntries: nextEntries,
      }, req);

      if (!dbOnlyMode) {
        const store = readSettingsStore().filter((item) => item.userId !== user.id);
        store.push(nextSettings);
        writeSettingsStore(store);
      }

      try {
        await upsertDomain(user.id, sanitizedDomain, toPersistedDomainRecord({
          status: syncedEntry.status,
          isActive: sanitizedDomain === settings.defaultDomain && syncedEntry.status === "ACTIVE",
          dnsTarget: getProviderDnsTarget(),
          verifiedAt: syncedEntry.verifiedAt ? new Date(syncedEntry.verifiedAt) : null,
        }));
      } catch {
        // Keep the Cloudflare sync usable even if the DB domain mirror is behind the current schema/state.
      }

      const ready = syncedEntry.status === "VERIFIED" || syncedEntry.status === "ACTIVE";
      return sendJson(res, 200, {
        domain: sanitizedDomain,
        verified: ready,
        status: syncedEntry.status,
        message: ready
          ? `Domain is SSL-ready. You can now set ${sanitizedDomain} active for new short links.`
          : `Cloudflare is still provisioning ${sanitizedDomain}. Keep the CNAME for ${sanitizedDomain} pointed to ${getProviderDnsTarget()} and try Verify / Sync again in a moment.`,
        dnsTarget: getProviderDnsTarget(),
        recordType: "CNAME",
        hostHint: sanitizedDomain.split(".")[0] || sanitizedDomain,
        sslStatus: syncedEntry.sslStatus,
        ownershipStatus: syncedEntry.ownershipStatus,
        autoDnsAttempted,
        autoDnsError,
        settings: nextSettings,
      });
    } catch (error) {
      return sendJson(res, 500, { error: `Cloudflare sync failed: ${error.message}` });
    }
  }

  const nextEntries = settings.domainEntries.map((entry) => {
    if (entry.host !== sanitizedDomain) {
      return entry;
    }
    return {
      ...entry,
      status: sanitizedDomain === settings.defaultDomain ? "ACTIVE" : "VERIFIED",
      verifiedAt: new Date().toISOString(),
      dnsTarget: customDomainDnsTarget,
      provider: "manual",
      };
  });

  const nextSettings = normalizeSettings({
    ...settings,
    domainEntries: nextEntries,
  }, req);

  if (!dbOnlyMode) {
    const store = readSettingsStore().filter((item) => item.userId !== user.id);
    store.push(nextSettings);
    writeSettingsStore(store);
  }

  try {
    if (sanitizedDomain !== publicAppDomain) {
      await upsertDomain(user.id, sanitizedDomain, toPersistedDomainRecord({
        status: sanitizedDomain === settings.defaultDomain ? "ACTIVE" : "VERIFIED",
        isActive: sanitizedDomain === settings.defaultDomain,
        dnsTarget: customDomainDnsTarget,
        verifiedAt: new Date(),
      }));
    }
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to update domain verification right now." });
    }
  }

  return sendJson(res, 200, {
    domain: sanitizedDomain,
    verified: true,
    status: sanitizedDomain === settings.defaultDomain ? "ACTIVE" : "VERIFIED",
    message: `Domain marked as verified. Keep the CNAME for ${sanitizedDomain} pointed to ${customDomainDnsTarget} so new links can use it.`,
    dnsTarget: customDomainDnsTarget,
    recordType: "CNAME",
    hostHint: sanitizedDomain.split(".")[0] || sanitizedDomain,
    autoDnsAttempted,
    autoDnsError,
    settings: nextSettings,
  });
}

function handleAdminSaveCoupon(body, res, adminUser) {
  const code = String(body.code || "").trim().toUpperCase();
  const type = String(body.type || "plan").trim().toLowerCase();
  const label = String(body.label || "").trim();
  const value = Math.max(0, Number(body.value || 0));
  const planId = String(body.planId || "").trim();
  const active = body.active !== false;

  if (!code || !/^[A-Z0-9_-]{3,32}$/.test(code)) {
    return sendJson(res, 400, { error: "Enter a valid coupon code (3-32 letters/numbers)." });
  }

  if (!["plan", "free_days", "lifetime"].includes(type)) {
    return sendJson(res, 400, { error: "Invalid coupon type." });
  }

  if (type === "plan" && !planId) {
    return sendJson(res, 400, { error: "Plan coupons need a Razorpay plan id." });
  }

  if (type === "free_days" && value < 1) {
    return sendJson(res, 400, { error: "Free-days coupons need at least 1 day." });
  }

  const coupons = readCoupons();
  const existingIndex = coupons.findIndex((coupon) => coupon.code === code);
  const now = Date.now();
  const nextCoupon = normalizeCoupon({
    code,
    label,
    type,
    value: type === "free_days" ? value : 0,
    planId: type === "plan" ? planId : "",
    active,
    createdAt: existingIndex >= 0 ? coupons[existingIndex].createdAt : now,
    updatedAt: now,
  });

  if (existingIndex >= 0) {
    coupons[existingIndex] = nextCoupon;
  } else {
    coupons.push(nextCoupon);
  }

  writeCoupons(coupons);
  appendAuditLog("admin.coupon.save", { userId: adminUser?.id, email: adminUser?.email, type: "admin" }, {
    code: nextCoupon.code,
    type: nextCoupon.type,
    planId: nextCoupon.planId || "",
    value: Number(nextCoupon.value || 0),
    active: Boolean(nextCoupon.active),
  });
  return sendJson(res, 200, { success: true, coupon: serializeCouponForClient(nextCoupon) });
}

function handleAdminDeleteCoupon(couponCode, res, adminUser) {
  const normalizedCode = String(couponCode || "").trim().toUpperCase();
  const coupons = readCoupons();
  const nextCoupons = coupons.filter((coupon) => coupon.code !== normalizedCode);

  if (nextCoupons.length === coupons.length) {
    return sendJson(res, 404, { error: "Coupon not found." });
  }

  writeCoupons(nextCoupons);
  appendAuditLog("admin.coupon.delete", { userId: adminUser?.id, email: adminUser?.email, type: "admin" }, {
    code: normalizedCode,
  });
  return sendJson(res, 200, { success: true });
}

function isCloudflareSaasConfigured() {
  return Boolean(cloudflareApiToken && cloudflareZoneId && cloudflareSaasCnameTarget && cloudflareFallbackOrigin);
}

function getProviderDnsTarget() {
  return isCloudflareSaasConfigured() ? cloudflareSaasCnameTarget : customDomainDnsTarget;
}

function buildGoDaddyAuthHeader(token) {
  return `sso-key ${token.apiKey}:${token.apiSecret}`;
}

async function fetchGoDaddyApi(token, endpoint, options = {}) {
  const response = await fetch(`${godaddyApiBase}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: buildGoDaddyAuthHeader(token),
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = payload?.message || payload?.errors?.[0]?.message || `GoDaddy request failed with status ${response.status}`;
    throw new Error(details);
  }

  return payload;
}

async function validateGoDaddyCredentials(token) {
  await fetchGoDaddyApi(token, "/domains?limit=1");
  return true;
}

function splitDomainForGoDaddy(hostname) {
  const labels = String(hostname || "").split(".").filter(Boolean);
  if (labels.length < 2) {
    return { rootDomain: hostname, name: "" };
  }

  const lastTwo = labels.slice(-2).join(".");
  const useThree = godaddySecondLevelTlds.has(lastTwo);
  const rootLabelsCount = useThree ? 3 : 2;
  if (labels.length < rootLabelsCount) {
    return { rootDomain: hostname, name: "" };
  }

  const rootDomain = labels.slice(-rootLabelsCount).join(".");
  const name = labels.slice(0, -rootLabelsCount).join(".");
  return { rootDomain, name };
}

async function ensureGoDaddyCnameRecord(userId, hostname, target) {
  const token = getGoDaddyTokenForUser(userId);
  if (!token) {
    return { attempted: false };
  }

  const { rootDomain, name } = splitDomainForGoDaddy(hostname);
  if (!name) {
    throw new Error("Root domains need an A record. Please use a subdomain like go.yourbrand.com.");
  }

  await fetchGoDaddyApi(token, `/domains/${rootDomain}/records/CNAME/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: [
      {
        data: target,
        ttl: 600,
      },
    ],
  });

  return { attempted: true, rootDomain, name };
}

function toPersistedDomainRecord(data = {}) {
  return {
    status: data.status,
    isActive: data.isActive,
    dnsTarget: data.dnsTarget,
    verifiedAt: data.verifiedAt,
  };
}

async function fetchCloudflareApi(endpoint, options = {}) {
  if (!isCloudflareSaasConfigured()) {
    throw new Error("Cloudflare SaaS is not configured.");
  }

  const response = await fetch(`${cloudflareApiBase}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${cloudflareApiToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const details = Array.isArray(payload.errors) && payload.errors.length
      ? payload.errors.map((item) => item.message || item.code || "Cloudflare error").join("; ")
      : `Cloudflare request failed with status ${response.status}`;
    throw new Error(details);
  }

  return payload.result;
}

async function findCloudflareCustomHostname(hostname) {
  const query = new URLSearchParams({ hostname }).toString();
  const result = await fetchCloudflareApi(`/zones/${cloudflareZoneId}/custom_hostnames?${query}`);
  if (Array.isArray(result) && result.length) {
    return result[0];
  }
  if (result && Array.isArray(result.result) && result.result.length) {
    return result.result[0];
  }
  return null;
}

async function createCloudflareCustomHostname(hostname) {
  return fetchCloudflareApi(`/zones/${cloudflareZoneId}/custom_hostnames`, {
    method: "POST",
    body: {
      hostname,
      ssl: {
        method: cloudflareHostnameSslMethod || "http",
        type: "dv",
      },
    },
  });
}

async function ensureCloudflareCustomHostname(hostname) {
  const existing = await findCloudflareCustomHostname(hostname);
  if (existing) {
    return existing;
  }
  return createCloudflareCustomHostname(hostname);
}

function mapCloudflareDomainStatus(hostname, defaultDomain, host) {
  const hostnameStatus = String(hostname?.status || hostname?.hostname_status || "").trim().toLowerCase();
  const sslStatus = String(hostname?.ssl?.status || hostname?.ssl_status || "").trim().toLowerCase();
  const ownershipStatus = String(hostname?.ownership_verification?.status || hostname?.ownership_status || "").trim().toLowerCase();
  const sslReady = sslStatus === "active";
  const hostnameReady = hostnameStatus === "active" || hostnameStatus === "moved";
  const ownershipReady = !ownershipStatus || ownershipStatus === "active";
  const ready = sslReady && hostnameReady && ownershipReady;
  const isActive = ready && host === defaultDomain;

  return {
    status: ready ? (isActive ? "ACTIVE" : "VERIFIED") : "PENDING",
    verifiedAt: ready ? new Date().toISOString() : null,
    dnsTarget: getProviderDnsTarget(),
    provider: "cloudflare",
    sslStatus: sslStatus || "pending",
    ownershipStatus: ownershipStatus || "pending",
    providerHostnameId: hostname?.id || null,
    verificationErrors: Array.isArray(hostname?.verification_errors)
      ? hostname.verification_errors.map((item) => item?.message || item?.error || String(item)).filter(Boolean)
      : [],
  };
}

function sanitizeFormSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

const defaultFormFieldLibrary = [
  { key: "name", label: "Full name", type: "text", required: true, enabled: true, builtIn: true, options: [] },
  { key: "email", label: "Email address", type: "email", required: true, enabled: true, builtIn: true, options: [] },
  { key: "phone", label: "Phone number", type: "tel", required: false, enabled: false, builtIn: true, options: [] },
  { key: "company", label: "Company", type: "text", required: false, enabled: false, builtIn: true, options: [] },
  { key: "message", label: "Message", type: "textarea", required: true, enabled: true, builtIn: true, options: [] },
];

function sanitizeFormFieldKey(value, fallback = "field") {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");

  return clean || fallback;
}

function normalizeFormFieldType(type) {
  const normalized = String(type || "text").trim().toLowerCase();
  if ([
    "email", "tel", "textarea", "select", "radio", "checkbox", "multiselect",
    "number", "url", "file", "date", "time", "scale",
    "pagebreak", "thankyou", "textblock", "heading1", "heading2", "heading3",
    "divider", "title", "label", "image", "video", "audio", "embed",
  ].includes(normalized)) {
    return normalized;
  }
  return "text";
}

function normalizeFieldOptions(options) {
  const rawItems = Array.isArray(options)
    ? options
    : String(options || "").split(/\r?\n|,/);

  return [...new Set(rawItems
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

function isInteractiveFormFieldType(type) {
  return [
    "text", "email", "tel", "textarea", "select", "radio", "checkbox", "multiselect",
    "number", "url", "file", "date", "time", "scale",
  ].includes(normalizeFormFieldType(type));
}

function supportsFieldOptions(type) {
  return ["select", "radio", "checkbox", "multiselect"].includes(normalizeFormFieldType(type));
}

function supportsFieldContent(type) {
  return ["pagebreak", "thankyou", "textblock", "heading1", "heading2", "heading3", "title", "label"].includes(normalizeFormFieldType(type));
}

function supportsFieldUrl(type) {
  return ["image", "video", "audio", "embed"].includes(normalizeFormFieldType(type));
}

function supportsFieldScale(type) {
  return normalizeFormFieldType(type) === "scale";
}

function normalizeFormFields(fields) {
  const source = Array.isArray(fields)
    ? fields
    : defaultFormFieldLibrary.map((field) => ({
      ...field,
      enabled: Object.prototype.hasOwnProperty.call(fields || {}, field.key)
        ? Boolean(fields[field.key])
        : field.enabled,
    }));

  const seen = new Set();
  const normalized = [];

  for (const baseField of source) {
    if (!baseField || typeof baseField !== "object") {
      continue;
    }

    const builtIn = Boolean(baseField.builtIn || defaultFormFieldLibrary.some((field) => field.key === baseField.key));
    const key = sanitizeFormFieldKey(baseField.key || baseField.label, builtIn ? baseField.key : "field");
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    const type = normalizeFormFieldType(baseField.type);
    const options = supportsFieldOptions(type) ? normalizeFieldOptions(baseField.options) : [];
    normalized.push({
      key,
      label: String(baseField.label || key).trim() || key,
      type,
      required: Boolean(baseField.required),
      enabled: supportsFieldContent(type) || supportsFieldUrl(type) || type === "divider" ? true : Boolean(baseField.enabled !== false),
      builtIn,
      options,
      content: String(baseField.content || "").trim(),
      url: String(baseField.url || "").trim(),
      min: Number.isFinite(Number(baseField.min)) ? Number(baseField.min) : 1,
      max: Number.isFinite(Number(baseField.max)) ? Number(baseField.max) : 5,
    });
  }

  for (const defaultField of defaultFormFieldLibrary) {
    if (!seen.has(defaultField.key)) {
      normalized.push({ ...defaultField });
    }
  }

  return normalized;
}

function mapInputTypeToDb(type) {
  const normalized = String(type || "text").toLowerCase();
  if (normalized === "email") return "EMAIL";
  if (normalized === "tel") return "TEL";
  if (normalized === "textarea") return "TEXTAREA";
  return "TEXT";
}

function mapFieldTypeToHtmlInput(type) {
  const normalized = normalizeFormFieldType(type);
  if (["email", "tel", "number", "url", "date", "time", "file"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "scale") {
    return "range";
  }
  return "text";
}

function getThankYouContent(page) {
  const thankYouBlock = normalizeFormFields(page?.fields || []).find((field) => field.type === "thankyou" && field.content);
  return thankYouBlock?.content || page?.thanksMessage || "Thanks, your response has been received.";
}

function serializeDbFormFields(fields) {
  return getEnabledFormFields(fields).map((field) => ({
    key: field.key,
    label: field.label,
    type: mapInputTypeToDb(field.type),
    required: Boolean(field.required),
    enabled: true,
  }));
}

function mapDbPageRecord(page, req, fallbackPage = null) {
  const fieldState = Array.isArray(fallbackPage?.fields) && fallbackPage.fields.length
    ? normalizeFormFields(fallbackPage.fields)
    : (page.fields || []).map((field) => ({
      key: field.key,
      label: field.label,
      type: String(field.type || "TEXT").toLowerCase(),
      required: Boolean(field.required),
      enabled: field.enabled !== false,
      builtIn: defaultFormFieldLibrary.some((item) => item.key === field.key),
      options: [],
      content: "",
      url: "",
      min: 1,
      max: 5,
    }));

  const submissions = (page.submissions || []).map((submission) => ({
    id: submission.id,
    submittedAt: submission.createdAt instanceof Date ? submission.createdAt.toISOString() : submission.createdAt,
    answers: Object.fromEntries((submission.answers || []).map((answer) => [answer.fieldKey, answer.value || ""])),
    meta: {
      ip: submission.ipAddress || "",
      country: submission.country || "Unknown",
      city: submission.city || "Unknown",
      browser: submission.browser || "Unknown",
      platform: submission.platform || "Unknown",
      device: submission.device || "Web",
    },
  }));

  return normalizePage({
    id: page.id,
    userId: page.userId,
    title: page.title,
    headline: page.headline,
    description: page.description || "",
    submitLabel: page.submitLabel,
    thanksMessage: page.thanksMessage,
    slug: page.slug,
    fields: fieldState,
    submissions,
    createdAt: page.createdAt instanceof Date ? page.createdAt.toISOString() : page.createdAt,
    updatedAt: page.updatedAt instanceof Date ? page.updatedAt.toISOString() : page.updatedAt,
  }, req);
}

function getEnabledFormFields(fields) {
  return normalizeFormFields(fields).filter((field) => field.enabled && isInteractiveFormFieldType(field.type));
}

function normalizePage(page, req) {
  const normalized = {
    id: page.id || crypto.randomUUID(),
    userId: page.userId || "",
    title: String(page.title || "Untitled form").trim(),
    headline: String(page.headline || page.title || "Untitled form").trim(),
    description: String(page.description || "").trim(),
    submitLabel: String(page.submitLabel || "Submit").trim(),
    thanksMessage: String(page.thanksMessage || "Thanks, your response has been received.").trim(),
    slug: sanitizeFormSlug(page.slug || page.title || "form"),
    fields: normalizeFormFields(page.fields || {}),
    submissions: Array.isArray(page.submissions) ? page.submissions : [],
    createdAt: page.createdAt || new Date().toISOString(),
    updatedAt: page.updatedAt || page.createdAt || new Date().toISOString(),
  };

  return {
    ...normalized,
    publicUrl: buildPublicFormUrl(normalized.slug, req),
    submissionCount: normalized.submissions.length,
  };
}

function buildPublicFormUrl(slug, req) {
  const hostHeader = req?.headers?.host || publicAppDomain;
  const protocol = getRequestProtocol(req, hostHeader);
  const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostHeader) ? hostHeader : publicAppDomain;
  return `${protocol}://${localHost}/forms/${slug}`;
}

function formatAnalyticsExportList(items) {
  return Array.isArray(items)
    ? items.map((item) => `${item.label} (${item.count})`).join("; ")
    : "";
}

function ensureUserSettings(userId, req) {
  const store = readSettingsStore();

  if (store.some((item) => item.userId === userId)) {
    return;
  }

  store.push(normalizeSettings({ userId }, req));
  writeSettingsStore(store);
}

function createEmptyAnalytics() {
  return {
    totalClicks: 0,
    lastClickedAt: "",
    clicks: [],
  };
}

function buildClickEvent(req, tracking = {}) {
  const geo = getGeoDetails(req);
  const client = parseUserAgent(req.headers["user-agent"] || "");
  return {
    id: crypto.randomUUID(),
    clickedAt: new Date().toISOString(),
    ip: getClientIp(req),
    country: geo.country,
    city: geo.city,
    cityLabel: geo.city && geo.country !== "Unknown" ? (geo.city + ", " + geo.country) : (geo.city || geo.country),
    platform: client.platform,
    deviceType: client.deviceType,
    browser: client.browser,
    referrer: String(req.headers.referer || req.headers.referrer || "").trim(),
    visitorId: tracking.visitorId || "",
    sessionId: tracking.sessionId || "",
    language: tracking.language || "Unknown",
  };
}

function recordLinkVisit(link, req, tracking = {}) {
  if (!link.analytics || typeof link.analytics !== "object") {
    link.analytics = createEmptyAnalytics();
  }

  if (!Array.isArray(link.analytics.clicks)) {
    link.analytics.clicks = [];
  }

  const click = buildClickEvent(req, tracking);
  link.analytics.totalClicks = Number(link.analytics.totalClicks || 0) + 1;
  link.analytics.lastClickedAt = click.clickedAt;
  link.analytics.clicks.unshift(click);
  link.analytics.clicks = link.analytics.clicks.slice(0, 500);
  return click;
}

async function recordLinkVisitAsync(link, req) {
  const click = buildClickEvent(req, getTrackingContext(req));
  await recordDbClickEvent(link.id, link.userId, click);
  return click;
}

async function getGoalAlertUser(userId) {
  try {
    const dbUser = await findUserById(userId);
    if (dbUser) {
      return dbUser;
    }
  } catch {
    // Fall back to file storage during migration.
  }

  return readUsers().find((item) => item.id === userId) || null;
}

function shouldSendGoalAlert(settings, slug, currentClicks) {
  const goal = Number(settings?.conversionGoals?.[slug] || 0);
  if (!goal || currentClicks < goal) {
    return { shouldSend: false, goal: 0 };
  }

  const alertedGoal = Number(settings?.goalAlertState?.[slug] || 0);
  if (alertedGoal >= goal) {
    return { shouldSend: false, goal };
  }

  return { shouldSend: true, goal };
}

function markGoalAlertSent(userId, slug, goal, req) {
  writeSettingsExtras(userId, req, (existing) => ({
    goalAlertState: {
      ...(existing.goalAlertState || {}),
      [slug]: goal,
    },
  }));
}

async function maybeSendGoalAchievementEmail(link, currentClicks, req) {
  const settings = await readSettingsForUserAsync(link.userId, req);
  const { shouldSend, goal } = shouldSendGoalAlert(settings, link.slug, currentClicks);

  if (!shouldSend) {
    return;
  }

  const user = await getGoalAlertUser(link.userId);
  if (!user?.email) {
    return;
  }

  const shortUrl = link.shortUrl || buildShortUrl(settings.defaultDomain || publicAppDomain, link.slug);
  const emailSent = await sendTransactionalEmail({
    to: user.email,
    subject: `Goal achieved for ${link.slug}`,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#183153"><h2 style="margin:0 0 12px;">Conversion goal achieved</h2><p style="margin:0 0 12px;">Your short link <strong>${link.slug}</strong> has reached its conversion goal.</p><p style="margin:0 0 12px;"><strong>Current clicks:</strong> ${currentClicks}</p><p style="margin:0 0 12px;"><strong>Goal target:</strong> ${goal}</p><p style="margin:0 0 18px;"><a href="${shortUrl}" style="color:#2852e0;text-decoration:none;font-weight:700;">${shortUrl}</a></p><p style="margin:0;color:#5f7399;">Open your analytics dashboard to review the latest traffic and audience details.</p></div>`,
    text: `Goal achieved for ${link.slug}. Current clicks: ${currentClicks}. Goal target: ${goal}. Link: ${shortUrl}`,
  });

  if (emailSent) {
    markGoalAlertSent(link.userId, link.slug, goal, req);
  }
}

function getProtectedLinkCookieName(slug) {
  return `${protectedLinkCookiePrefix}${slug}`;
}

function markOneTimeLinkUsed(userId, slug, req) {
  writeSettingsExtras(userId, req, (existing) => {
    const previousRule = existing.linkRules?.[slug] || {};
    return {
      linkRules: {
        ...(existing.linkRules || {}),
        [slug]: {
          ...previousRule,
          isOneTime: true,
          oneTimeUsedAt: new Date().toISOString(),
        },
      },
    };
  });
}

function hasProtectedLinkAccess(req, rule, slug) {
  if (!rule?.passwordHash || !rule?.accessToken) {
    return true;
  }

  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[getProtectedLinkCookieName(slug)] === rule.accessToken;
}

function appendPixelParam(url, pixelId) {
  if (!pixelId) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("anylink_px", pixelId);
    return parsed.toString();
  } catch {
    return url;
  }
}

function resolveSmartDestination(baseDestination, rule, req) {
  const fallback = normalizeUrl(baseDestination) || baseDestination;
  if (!rule || typeof rule !== "object") {
    return fallback;
  }

  const geo = getGeoDetails(req);
  const country = String(geo.country || "").trim().toUpperCase();
  if (country && Array.isArray(rule.geoRedirects)) {
    const geoMatch = rule.geoRedirects.find((item) => String(item.country || "").toUpperCase() === country);
    if (geoMatch?.destination) {
      return appendPixelParam(geoMatch.destination, rule.pixelId);
    }
  }

  const agent = parseUserAgent(req.headers["user-agent"] || "");
  const device = String(agent.deviceType || "").toLowerCase();
  if (device && Array.isArray(rule.deviceRedirects)) {
    const deviceMatch = rule.deviceRedirects.find((item) => String(item.device || "").toLowerCase() === device);
    if (deviceMatch?.destination) {
      return appendPixelParam(deviceMatch.destination, rule.pixelId);
    }
  }

  if (rule.abEnabled && rule.abDestinationA && rule.abDestinationB) {
    const weightA = Math.min(95, Math.max(5, Number(rule.abWeightA || 50) || 50));
    const roll = Math.random() * 100;
    const picked = roll < weightA ? rule.abDestinationA : rule.abDestinationB;
    return appendPixelParam(picked, rule.pixelId);
  }

  return appendPixelParam(fallback, rule.pixelId);
}

function renderProtectedLinkPage(link, errorMessage = "") {
  const shortUrl = escapeHtml(link.shortUrl || link.slug);
  const errorBlock = errorMessage ? `<div style="margin:0 0 16px;padding:12px 14px;border-radius:14px;background:#fff1f1;color:#b42318;font-weight:600;">${escapeHtml(errorMessage)}</div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Protected Link | AnyLink</title>
  <style>
    body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:linear-gradient(135deg,#eef6ff,#f9fbff);color:#17315f;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{width:min(100%,480px);background:#fff;border:1px solid #dfe8f7;border-radius:28px;padding:30px;box-shadow:0 18px 45px rgba(45,90,232,.10)}
    .eyebrow{margin:0 0 10px;font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;color:#5d78a4}
    h1{margin:0 0 12px;font-size:2rem;line-height:1.08}
    p{margin:0 0 20px;color:#58719b;line-height:1.7}
    .field{display:grid;gap:8px;margin-bottom:16px}
    label{font-weight:700}
    input{width:100%;box-sizing:border-box;min-height:52px;border-radius:18px;border:1px solid #bfd3fb;padding:0 16px;font-size:1rem}
    button{width:100%;min-height:52px;border:none;border-radius:18px;background:linear-gradient(90deg,#2e57e5,#169fd0);color:#fff;font-size:1rem;font-weight:800;cursor:pointer}
    .meta{margin-top:14px;font-size:.88rem;color:#6a81aa}
  </style>
</head>
<body>
  <main class="card">
    <p class="eyebrow">Protected Link</p>
    <h1>Password required</h1>
    <p>Enter the password to continue to <strong>${shortUrl}</strong>.</p>
    ${errorBlock}
    <form id="unlockForm">
      <div class="field">
        <label for="linkPassword">Password</label>
        <input id="linkPassword" type="password" placeholder="Enter access password" required>
      </div>
      <button type="submit">Unlock link</button>
    </form>
    <p class="meta">This destination is protected by the link owner.</p>
  </main>
  <script>
    const form = document.getElementById("unlockForm");
    const passwordInput = document.getElementById("linkPassword");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await fetch("/api/unlock/${encodeURIComponent(link.slug)}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput.value })
      });
      const payload = await response.json();
      if (!response.ok) {
        window.location.replace("/${encodeURIComponent(link.slug)}?error=" + encodeURIComponent(payload.error || "Invalid password"));
        return;
      }
      window.location.replace(payload.destination);
    });
  </script>
</body>
</html>`;
}

async function handleUnlockProtectedLink(slug, body, req, res) {
  const password = String(body.password || "");
  if (!password) {
    return sendJson(res, 400, { error: "Password is required." });
  }

  const link = await findLinkBySlug(slug);
  if (!link) {
    return sendJson(res, 404, { error: "Link not found." });
  }

  const settings = await readSettingsForUserAsync(link.userId, req);
  const rule = settings.linkRules?.[link.slug];
  if (!rule?.passwordHash || !rule?.passwordSalt || !rule?.accessToken) {
    return sendJson(res, 400, { error: "This link is not password protected." });
  }

  if (hashPassword(password, rule.passwordSalt) !== rule.passwordHash) {
    return sendJson(res, 401, { error: "Incorrect password." });
  }

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": `${getProtectedLinkCookieName(link.slug)}=${rule.accessToken}; Path=/; Max-Age=${protectedLinkLifetimeSeconds}; HttpOnly; SameSite=Lax${isProduction ? "; Secure" : ""}`,
  });
  res.end(JSON.stringify({ success: true, destination: `/${encodeURIComponent(link.slug)}` }));
}

async function handleRedirect(slug, req, res) {
  const tracking = getTrackingContext(req);
  try {
    const dbMatch = await findLinkBySlug(slug);
    if (dbMatch) {
      const settings = await readSettingsForUserAsync(dbMatch.userId, req);
      const rule = settings.linkRules?.[dbMatch.slug];
      if (rule?.startsAt && Date.now() < new Date(rule.startsAt).getTime()) {
        return sendJson(res, 425, { error: "This short link is scheduled and is not live yet." });
      }
      if (rule?.isPaused) {
        return sendJson(res, 410, { error: "This short link is paused." });
      }
      if (rule?.expiresAt && Date.now() > new Date(rule.expiresAt).getTime()) {
        return sendJson(res, 410, { error: "This short link has expired." });
      }
      if (rule?.isOneTime && rule?.oneTimeUsedAt) {
        return sendJson(res, 410, { error: "This one-time link has already been used." });
      }
      if (rule?.passwordHash && !hasProtectedLinkAccess(req, rule, dbMatch.slug)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderProtectedLinkPage(dbMatch, new URL(req.url, `http://${req.headers.host || publicAppDomain}`).searchParams.get("error") || ""));
        return;
      }
      try {
        const clickEvent = buildClickEvent(req, tracking);
        await recordDbClickEvent(dbMatch.id, dbMatch.userId, clickEvent);
        await maybeSendGoalAchievementEmail(dbMatch, Number(dbMatch.clickCount || 0) + 1, req);
        queueWebhookEvent(dbMatch.userId, "link.clicked", {
          link: {
            id: String(dbMatch.id || ""),
            slug: dbMatch.slug,
            destination: dbMatch.destination,
            shortUrl: dbMatch.shortUrl,
          },
          click: clickEvent,
        }, req).catch(() => {});
      } catch {
        // Redirect should still work even if analytics write fails.
      }
      const destination = resolveSmartDestination(dbMatch.destination, rule, req);
      if (rule?.isOneTime) {
        markOneTimeLinkUsed(dbMatch.userId, dbMatch.slug, req);
      }
      const headers = { Location: destination };
      if (tracking.setCookies.length) {
        headers["Set-Cookie"] = tracking.setCookies;
      }
      res.writeHead(302, headers);
      res.end();
      return;
    }
    if (dbOnlyMode) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
  } catch {
    if (dbOnlyMode) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
  }

  const links = readLinks();
  const match = links.find((item) => item.slug === slug);

  if (match) {
    const settings = await readSettingsForUserAsync(match.userId, req);
    const rule = settings.linkRules?.[match.slug];
    if (rule?.startsAt && Date.now() < new Date(rule.startsAt).getTime()) {
      return sendJson(res, 425, { error: "This short link is scheduled and is not live yet." });
    }
    if (rule?.isPaused) {
      return sendJson(res, 410, { error: "This short link is paused." });
    }
    if (rule?.expiresAt && Date.now() > new Date(rule.expiresAt).getTime()) {
      return sendJson(res, 410, { error: "This short link has expired." });
    }
    if (rule?.isOneTime && rule?.oneTimeUsedAt) {
      return sendJson(res, 410, { error: "This one-time link has already been used." });
    }
    if (rule?.passwordHash && !hasProtectedLinkAccess(req, rule, match.slug)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderProtectedLinkPage(match, new URL(req.url, `http://${req.headers.host || publicAppDomain}`).searchParams.get("error") || ""));
      return;
    }
    const clickEvent = recordLinkVisit(match, req, tracking);
    writeLinks(links);
    try {
      await maybeSendGoalAchievementEmail(match, Number(match.analytics?.totalClicks || 0), req);
    } catch {
      // Redirect should still work even if goal email fails.
    }
    queueWebhookEvent(match.userId, "link.clicked", {
      link: {
        id: String(match.id || ""),
        slug: match.slug,
        destination: match.destination,
        shortUrl: match.shortUrl,
      },
      click: clickEvent,
    }, req).catch(() => {});
    const destination = resolveSmartDestination(match.destination, rule, req);
    if (rule?.isOneTime) {
      markOneTimeLinkUsed(match.userId, match.slug, req);
    }
    const headers = { Location: destination };
    if (tracking.setCookies.length) {
      headers["Set-Cookie"] = tracking.setCookies;
    }
    res.writeHead(302, headers);
    res.end();
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function normalizeUrl(input) {
  let value = input;

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const parsed = new URL(value);
    if (!parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function summarizeClicks(clicks, key) {
  const counts = new Map();

  for (const click of clicks || []) {
    const value = String(click?.[key] || "Unknown").trim() || "Unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);
}

function getUniqueClickKey(click) {
  const visitorId = String(click?.visitorId || "").trim();
  if (visitorId) {
    return `visitor:${visitorId}`;
  }

  const ip = String(click?.ip || click?.ipAddress || "").trim();
  if (ip && ip !== "Unknown") {
    return `ip:${ip}`;
  }

  const browser = String(click?.browser || "unknown").trim().toLowerCase();
  const platform = String(click?.platform || "unknown").trim().toLowerCase();
  const device = String(click?.deviceType || click?.device || "unknown").trim().toLowerCase();
  const country = String(click?.country || "unknown").trim().toLowerCase();
  const city = String(click?.city || "unknown").trim().toLowerCase();
  return `fp:${browser}|${platform}|${device}|${country}|${city}`;
}

function countUniqueClicks(clicks) {
  return new Set((clicks || []).map((click) => getUniqueClickKey(click))).size;
}

function parseAnalyticsFilters(searchParams) {
  const range = String(searchParams?.get("range") || "30d").trim().toLowerCase();
  const now = new Date();
  let startAt = null;
  let endAt = null;
  let label = "Last 30 days";
  let customStart = "";
  let customEnd = "";

  if (range === "today") {
    startAt = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    label = "Today";
  } else if (range === "7d") {
    startAt = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    label = "Last 7 days";
  } else if (range === "all") {
    startAt = null;
    label = "All time";
  } else if (range === "custom") {
    customStart = String(searchParams?.get("start") || "").trim();
    customEnd = String(searchParams?.get("end") || "").trim();
    startAt = customStart ? new Date(`${customStart}T00:00:00`) : null;
    endAt = customEnd ? new Date(`${customEnd}T23:59:59.999`) : null;
    label = customStart && customEnd ? `${customStart} to ${customEnd}` : "Custom range";
  } else {
    startAt = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  }

  return {
    range: ["today", "7d", "30d", "all", "custom"].includes(range) ? range : "30d",
    startAt,
    endAt,
    label,
    customStart,
    customEnd,
  };
}

function filterClicksByAnalyticsRange(clicks, filters) {
  if (!filters?.startAt && !filters?.endAt) {
    return Array.isArray(clicks) ? clicks : [];
  }

  const startTime = filters?.startAt ? filters.startAt.getTime() : null;
  const endTime = filters?.endAt ? filters.endAt.getTime() : null;
  return (clicks || []).filter((click) => {
    const clickedAt = new Date(click.clickedAt || click.createdAt || 0).getTime();
    return Number.isFinite(clickedAt)
      && (startTime === null || clickedAt >= startTime)
      && (endTime === null || clickedAt <= endTime);
  });
}

function generateSlug(links) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";

  for (let attempt = 0; attempt < 12; attempt += 1) {
    let slug = "";
    for (let index = 0; index < 6; index += 1) {
      slug += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!links.some((item) => item.slug === slug)) {
      return slug;
    }
  }

  return `link-${Date.now()}`;
}

function sanitizeSlugInput(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function defaultSettings(req) {
  const fallbackDomain = getDefaultShortDomain(req);
  return {
    userId: "",
    workspaceName: "AnyLink Workspace",
    defaultDomain: fallbackDomain,
    domains: [fallbackDomain],
    domainEntries: [{ host: fallbackDomain, status: "APP_DEFAULT", isActive: true, dnsTarget: getProviderDnsTarget(), verifiedAt: null }],
    providerDnsTarget: getProviderDnsTarget(),
    conversionGoals: {},
    goalAlertState: {},
    linkRules: {},
    linkHealth: {},
    campaignTemplates: [],
    pixelTemplates: [],
    teamMembers: [],
    webhooks: [],
    trashLinks: [],
    campaigns: [],
  };
}

function normalizeConversionGoals(input) {
  const goals = {};

  for (const [key, value] of Object.entries(input || {})) {
    const slug = sanitizeSlugInput(String(key || ""));
    const goal = Math.max(0, Number(value) || 0);

    if (slug && goal > 0) {
      goals[slug] = goal;
    }
  }

  return goals;
}

function normalizeGoalAlertState(input) {
  const alerts = {};

  for (const [key, value] of Object.entries(input || {})) {
    const slug = sanitizeSlugInput(String(key || ""));
    const goal = Math.max(0, Number(value) || 0);

    if (slug && goal > 0) {
      alerts[slug] = goal;
    }
  }

  return alerts;
}

function normalizeLinkRules(input, previousRules = {}) {
  const rules = {};

  for (const [key, value] of Object.entries(input || {})) {
    const slug = sanitizeSlugInput(String(key || ""));
    if (!slug || !value || typeof value !== "object") {
      continue;
    }

    const expiresAt = String(value.expiresAt || "").trim();
    const startsAt = String(value.startsAt || "").trim();
    const isPaused = Boolean(value.isPaused);
    const abEnabled = Boolean(value.abEnabled);
    const abDestinationA = normalizeUrl(String(value.abDestinationA || "").trim()) || "";
    const abDestinationB = normalizeUrl(String(value.abDestinationB || "").trim()) || "";
    const abWeightA = Math.min(95, Math.max(5, Number(value.abWeightA || 50) || 50));
    const pixelId = String(value.pixelId || "").trim().slice(0, 80);
    const geoRedirects = Array.isArray(value.geoRedirects)
      ? value.geoRedirects
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const country = String(item.country || "").trim().toUpperCase().slice(0, 2);
          const destination = normalizeUrl(String(item.destination || "").trim());
          if (!country || !destination) return null;
          return { country, destination };
        })
        .filter(Boolean)
      : [];
    const deviceRedirects = Array.isArray(value.deviceRedirects)
      ? value.deviceRedirects
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const device = String(item.device || "").trim().toLowerCase();
          const destination = normalizeUrl(String(item.destination || "").trim());
          if (!["mobile", "desktop", "tablet"].includes(device) || !destination) return null;
          return { device, destination };
        })
        .filter(Boolean)
      : [];
    const previous = previousRules?.[slug] || {};
    const nextRule = {
      startsAt,
      expiresAt,
      isPaused,
      isOneTime: Boolean(value.isOneTime || previous.isOneTime),
      abEnabled,
      abDestinationA,
      abDestinationB,
      abWeightA,
      geoRedirects,
      deviceRedirects,
      pixelId,
    };

    const passwordPlain = String(value.passwordPlain || "").trim();
    const clearPassword = Boolean(value.clearPassword);

    if (passwordPlain) {
      const salt = crypto.randomBytes(16).toString("hex");
      nextRule.passwordSalt = salt;
      nextRule.passwordHash = hashPassword(passwordPlain, salt);
      nextRule.accessToken = crypto.randomBytes(18).toString("hex");
    } else if (!clearPassword && previous.passwordHash && previous.passwordSalt && previous.accessToken) {
      nextRule.passwordHash = previous.passwordHash;
      nextRule.passwordSalt = previous.passwordSalt;
      nextRule.accessToken = previous.accessToken;
    }

    if (value.oneTimeUsedAt || previous.oneTimeUsedAt) {
      nextRule.oneTimeUsedAt = String(value.oneTimeUsedAt || previous.oneTimeUsedAt || "");
    }

    if (!startsAt && !expiresAt && !isPaused && !nextRule.passwordHash && !nextRule.isOneTime && !abEnabled && !pixelId && !geoRedirects.length && !deviceRedirects.length) {
      continue;
    }

    rules[slug] = nextRule;
  }

  return rules;
}

function normalizeTrashLinks(input) {
  const seen = new Set();
  const items = [];

  for (const rawItem of input || []) {
    if (!rawItem || typeof rawItem !== "object") {
      continue;
    }

    const slug = sanitizeSlugInput(String(rawItem.slug || ""));
    const destination = normalizeUrl(String(rawItem.destination || "").trim());

    if (!slug || !destination || seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    items.push({
      id: rawItem.id || `trash-${slug}`,
      userId: rawItem.userId || "",
      slug,
      destination,
      shortUrl: String(rawItem.shortUrl || ""),
      includeQr: Boolean(rawItem.includeQr),
      createdAt: String(rawItem.createdAt || new Date().toISOString()),
      deletedAt: String(rawItem.deletedAt || new Date().toISOString()),
      analytics: rawItem.analytics && typeof rawItem.analytics === "object" ? rawItem.analytics : createEmptyAnalytics(),
    });
  }

  return items.sort((left, right) => new Date(right.deletedAt || 0).getTime() - new Date(left.deletedAt || 0).getTime());
}

function normalizeCampaigns(input) {
  const items = [];
  const seen = new Set();

  for (const rawItem of input || []) {
    if (!rawItem || typeof rawItem !== "object") {
      continue;
    }

    const id = String(rawItem.id || "").trim() || crypto.randomUUID();
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    items.push({
      id,
      name: String(rawItem.name || "").trim() || "Untitled campaign",
      status: ["draft", "active", "paused", "completed"].includes(String(rawItem.status || "").trim().toLowerCase())
        ? String(rawItem.status || "").trim().toLowerCase()
        : "draft",
      source: String(rawItem.source || "").trim(),
      medium: String(rawItem.medium || "").trim(),
      campaign: String(rawItem.campaign || "").trim(),
      term: String(rawItem.term || "").trim(),
      content: String(rawItem.content || "").trim(),
      destination: normalizeUrl(String(rawItem.destination || "").trim()),
      generatedUrl: normalizeUrl(String(rawItem.generatedUrl || "").trim()),
      shortUrl: String(rawItem.shortUrl || "").trim(),
      slug: sanitizeSlugInput(String(rawItem.slug || "").trim()),
      notes: String(rawItem.notes || "").trim(),
      createdAt: String(rawItem.createdAt || new Date().toISOString()),
      updatedAt: String(rawItem.updatedAt || new Date().toISOString()),
    });
  }

  return items.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function buildDomainEntries(domains, defaultDomain, req, sourceEntries = []) {
  const fallback = getDefaultShortDomain(req);
  const sourceMap = new Map((sourceEntries || []).map((entry) => [entry.host, entry]));

  return domains.map((host) => {
      if (host === fallback) {
      return {
        host,
        status: "APP_DEFAULT",
        isActive: host === defaultDomain,
        dnsTarget: getProviderDnsTarget(),
        verifiedAt: null,
        provider: "system",
        sslStatus: "active",
        ownershipStatus: "active",
        providerHostnameId: null,
      };
      }

    const existing = sourceMap.get(host) || {};
    const isActive = host === defaultDomain;
    const baseStatus = String(existing.status || "PENDING").toUpperCase();
    const status = isActive ? "ACTIVE" : (baseStatus === "ACTIVE" ? "VERIFIED" : baseStatus);

      return {
        host,
        status,
        isActive,
        dnsTarget: existing.dnsTarget || getProviderDnsTarget(),
        verifiedAt: existing.verifiedAt || null,
        provider: existing.provider || (isCloudflareSaasConfigured() ? "cloudflare" : "manual"),
        sslStatus: existing.sslStatus || null,
        ownershipStatus: existing.ownershipStatus || null,
        providerHostnameId: existing.providerHostnameId || null,
        verificationErrors: Array.isArray(existing.verificationErrors) ? existing.verificationErrors : [],
      };
    });
}

function normalizeLinkHealth(input) {
  const health = {};

  for (const [key, value] of Object.entries(input || {})) {
    const slug = sanitizeSlugInput(String(key || ""));
    if (!slug || !value || typeof value !== "object") {
      continue;
    }

    const status = ["healthy", "degraded", "broken", "unknown"].includes(String(value.status || "").toLowerCase())
      ? String(value.status || "").toLowerCase()
      : "unknown";
    const httpStatus = Number(value.httpStatus || 0);
    const checkedAt = String(value.checkedAt || "").trim();
    const error = String(value.error || "").trim();

    health[slug] = {
      status,
      httpStatus: httpStatus > 0 ? httpStatus : 0,
      checkedAt: checkedAt || "",
      error: error || "",
    };
  }

  return health;
}

function normalizeCampaignTemplates(input) {
  const templates = [];
  const seen = new Set();

  for (const item of input || []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const id = String(item.id || "").trim() || crypto.randomUUID();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    templates.push({
      id,
      name: String(item.name || "").trim() || "Template",
      source: String(item.source || "").trim(),
      medium: String(item.medium || "").trim(),
      campaign: String(item.campaign || "").trim(),
      term: String(item.term || "").trim(),
      content: String(item.content || "").trim(),
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString()),
    });
  }

  return templates.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function normalizePixelTemplates(input) {
  const templates = [];
  const seen = new Set();

  for (const item of input || []) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim() || crypto.randomUUID();
    if (seen.has(id)) continue;
    seen.add(id);
    templates.push({
      id,
      name: String(item.name || "").trim() || "Pixel template",
      pixelId: String(item.pixelId || "").trim().slice(0, 80),
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString()),
    });
  }

  return templates.filter((item) => item.pixelId).sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function normalizeTeamMembers(input) {
  const members = [];
  const seen = new Set();
  for (const item of input || []) {
    if (!item || typeof item !== "object") continue;
    const email = String(item.email || "").trim().toLowerCase();
    const role = ["admin", "editor", "viewer"].includes(String(item.role || "").trim().toLowerCase())
      ? String(item.role || "").trim().toLowerCase()
      : "viewer";
    if (!email || seen.has(email)) continue;
    seen.add(email);
    members.push({
      id: String(item.id || "").trim() || crypto.randomUUID(),
      name: String(item.name || "").trim() || email.split("@")[0] || "Member",
      email,
      role,
      status: String(item.status || "active").trim().toLowerCase(),
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString()),
    });
  }
  return members.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function normalizeWebhookEvents(input) {
  const source = Array.isArray(input)
    ? input
    : String(input || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const seen = new Set();
  const events = [];
  for (const raw of source) {
    const eventName = String(raw || "").trim().toLowerCase();
    if (!webhookAllowedEvents.has(eventName) || seen.has(eventName)) continue;
    seen.add(eventName);
    events.push(eventName);
  }
  return events.length ? events : [...webhookAllowedEvents];
}

function normalizeWebhookEndpoint(input) {
  if (!input || typeof input !== "object") return null;
  const id = String(input.id || "").trim() || crypto.randomUUID();
  const name = String(input.name || "Automation webhook").trim() || "Automation webhook";
  const urlValue = String(input.url || "").trim();
  if (!urlValue) return null;
  let url = "";
  try {
    const parsed = new URL(urlValue);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    url = parsed.toString();
  } catch {
    return null;
  }
  const secret = String(input.secret || "").trim() || `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const nowIso = new Date().toISOString();
  return {
    id,
    name,
    url,
    events: normalizeWebhookEvents(input.events),
    isActive: input.isActive !== false,
    secret,
    createdAt: String(input.createdAt || nowIso),
    updatedAt: String(input.updatedAt || nowIso),
    lastTriggeredAt: String(input.lastTriggeredAt || ""),
    lastStatus: Number(input.lastStatus || 0),
    lastError: String(input.lastError || ""),
    totalSuccess: Math.max(0, Number(input.totalSuccess || 0)),
    totalFailed: Math.max(0, Number(input.totalFailed || 0)),
  };
}

function normalizeWebhookEndpoints(input) {
  const endpoints = [];
  const seen = new Set();
  for (const item of Array.isArray(input) ? input : []) {
    const normalized = normalizeWebhookEndpoint(item);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    endpoints.push(normalized);
  }
  return endpoints.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function normalizeSettings(settings, req) {
  const base = defaultSettings(req);
  const workspaceName = String(settings?.workspaceName || base.workspaceName).trim() || base.workspaceName;
  const sourceEntryHosts = Array.isArray(settings?.domainEntries) ? settings.domainEntries.map((entry) => entry?.host).filter(Boolean) : [];
  const domains = normalizeDomains([
    ...(Array.isArray(settings?.domains) ? settings.domains : []),
    ...sourceEntryHosts,
  ].length ? [
    ...(Array.isArray(settings?.domains) ? settings.domains : []),
    ...sourceEntryHosts,
  ] : [settings?.defaultDomain || base.defaultDomain], req);
  const requestedDefault = sanitizeDomainInput(String(settings?.defaultDomain || "").trim(), req);
  const defaultDomain = requestedDefault && domains.includes(requestedDefault) ? requestedDefault : domains[0];

  if (!domains.includes(defaultDomain)) {
    domains.unshift(defaultDomain);
  }

  const domainEntries = buildDomainEntries(domains, defaultDomain, req, settings?.domainEntries || []);

  return {
    userId: settings?.userId || "",
    workspaceName,
    defaultDomain,
    domains,
    domainEntries,
    providerDnsTarget: getProviderDnsTarget(),
    domainAutomation: getDomainAutomationStateForUser(settings?.userId || ""),
    conversionGoals: normalizeConversionGoals(settings?.conversionGoals || {}),
    goalAlertState: normalizeGoalAlertState(settings?.goalAlertState || {}),
    linkRules: normalizeLinkRules(settings?.linkRules || {}, settings?.linkRules || {}),
    linkHealth: normalizeLinkHealth(settings?.linkHealth || {}),
    campaignTemplates: normalizeCampaignTemplates(settings?.campaignTemplates || []),
    pixelTemplates: normalizePixelTemplates(settings?.pixelTemplates || []),
    teamMembers: normalizeTeamMembers(settings?.teamMembers || []),
    webhooks: normalizeWebhookEndpoints(settings?.webhooks || []),
    trashLinks: normalizeTrashLinks(settings?.trashLinks || []),
    campaigns: normalizeCampaigns(settings?.campaigns || []),
  };
}

function normalizeDomains(domains, req) {
  const fallback = getDefaultShortDomain(req);
  const seen = new Set();
  const normalized = [];

  for (const domain of domains || []) {
    const cleaned = sanitizeDomainInput(String(domain || "").trim(), req);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      normalized.push(cleaned);
    }
  }

  if (!normalized.length) {
    normalized.push(fallback);
  } else if (!seen.has(fallback)) {
    normalized.unshift(fallback);
  }

  return normalized;
}

function sanitizeDomainInput(value, req) {
  const fallback = getDefaultShortDomain(req);

  if (!value) {
    return fallback;
  }

  const normalized = value
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (!/^[a-z0-9.-]+(?::\d+)?$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function getDefaultShortDomain(req) {
  const hostHeader = String(req?.headers?.host || "").trim();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostHeader)) {
    return hostHeader || "127.0.0.1:3000";
  }

  return publicAppDomain;
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map((item) => item.trim()).filter(Boolean)[0];
  const realIp = String(req.headers["x-real-ip"] || "").trim();
  const socketIp = String(req.socket?.remoteAddress || "").trim();
  return forwarded || realIp || socketIp || "Unknown";
}

function getGeoDetails(req) {
  const country = firstHeaderValue(req, [
    "cf-ipcountry",
    "x-vercel-ip-country",
    "x-country-code",
    "x-geo-country",
    "x-appengine-country",
  ]);
  const city = firstHeaderValue(req, [
    "x-vercel-ip-city",
    "x-geo-city",
    "x-appengine-city",
  ]);

  return {
    country: country || "Unknown",
    city: city || "Unknown",
  };
}

function firstHeaderValue(req, keys) {
  for (const key of keys) {
    const value = String(req.headers[key] || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function getPreferredLanguage(req) {
  const header = String(req?.headers?.["accept-language"] || "").trim();
  if (!header) {
    return "Unknown";
  }

  const firstValue = header.split(",")[0]?.trim() || "";
  if (!firstValue) {
    return "Unknown";
  }

  return firstValue.split(";")[0].trim() || "Unknown";
}

function parseUserAgent(userAgent) {
  const ua = String(userAgent || "");
  const lower = ua.toLowerCase();

  let deviceType = "Web";
  if (lower.includes("iphone")) deviceType = "iPhone";
  else if (lower.includes("ipad")) deviceType = "iPad";
  else if (lower.includes("android")) deviceType = "Android";
  else if (lower.includes("macintosh") || lower.includes("mac os")) deviceType = "Mac";
  else if (lower.includes("windows")) deviceType = "Windows PC";
  else if (lower.includes("linux")) deviceType = "Linux";

  let platform = "Unknown";
  if (lower.includes("iphone")) platform = "iOS";
  else if (lower.includes("ipad")) platform = "iPadOS";
  else if (lower.includes("android")) platform = "Android";
  else if (lower.includes("mac os") || lower.includes("macintosh")) platform = "macOS";
  else if (lower.includes("windows")) platform = "Windows";
  else if (lower.includes("linux")) platform = "Linux";

  let browser = "Unknown";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome/") && !lower.includes("edg/")) browser = "Chrome";
  else if (lower.includes("safari/") && !lower.includes("chrome/")) browser = "Safari";
  else if (lower.includes("firefox/")) browser = "Firefox";
  else if (lower.includes("opr/") || lower.includes("opera/")) browser = "Opera";
  else if (lower.includes("samsungbrowser/")) browser = "Samsung Internet";

  return { deviceType, platform, browser };
}

function buildShortUrl(domain, slug) {
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(domain);
  const protocol = isLocalHost ? "http" : "https";
  return `${protocol}://${domain}/${slug}`;
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function createOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function buildResetOtpToken(email, otp) {
  return crypto
    .createHash("sha256")
    .update(`${String(email || "").trim().toLowerCase()}:${String(otp || "").trim()}`)
    .digest("hex");
}

function isAdminUser(user) {
  if (!user) {
    return false;
  }

  if (user.isAdmin) {
    return true;
  }

  const adminEmails = [
    ...builtInAdminEmails,
    ...String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  ];

  if (adminEmails.includes(String(user.email || "").toLowerCase())) {
    return true;
  }

  const users = readUsers();
  const hasStoredAdmin = users.some((item) => item.isAdmin);

  if (hasStoredAdmin || adminEmails.length) {
    return false;
  }

  const oldestUser = [...users]
    .sort((left, right) => new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime())[0];

  return Boolean(oldestUser && oldestUser.id === user.id);
}

function buildAuthUrl(req, mode, token) {
  const { protocol, host } = getPublicBaseUrl(req);
  return `${protocol}://${host}/auth?mode=${encodeURIComponent(mode)}&token=${encodeURIComponent(token)}`;
}

function buildAbsoluteUrl(req, pathname) {
  const { protocol, host } = getPublicBaseUrl(req);
  return `${protocol}://${host}${pathname}`;
}

function getPublicBaseUrl(req) {
  const hostHeader = String(req?.headers?.host || "").trim().toLowerCase();
  const defaultHost = String(publicAppDomain || "go.shortlinks.in").trim().toLowerCase();
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostHeader);
  const host = isLocal && hostHeader ? hostHeader : defaultHost;
  const protocol = getRequestProtocol(req, host);
  return { protocol, host };
}

function getEmailDeliveryConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "").trim();
  const replyTo = String(process.env.EMAIL_REPLY_TO || "").trim();
  return {
    apiKey,
    from,
    replyTo,
    enabled: Boolean(apiKey && from),
  };
}

async function sendTransactionalEmail({ to, subject, html, text }) {
  const config = getEmailDeliveryConfig();

  if (!config.enabled) {
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject,
        html,
        text,
        reply_to: config.replyTo || undefined,
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error("Resend send failed:", response.status, details);
    }

    return response.ok;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toCsvValue(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function sendCsv(res, fileName, headers, rows) {
  const csvLines = [
    headers.map(toCsvValue).join(","),
    ...rows.map((row) => row.map(toCsvValue).join(",")),
  ];

  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-store",
  });
  res.end(`\uFEFF${csvLines.join("\n")}`);
}

function getRequestProtocol(req, hostHeader = "") {
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();

  if (forwardedProto === "https") {
    return "https";
  }

  if (forwardedProto === "http") {
    return "http";
  }

  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostHeader) ? "http" : "https";
}

function serveFile(filePath, res) {
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: "File not found" });
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.end(JSON.stringify(payload));
}











