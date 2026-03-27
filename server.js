const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { createUser: createDbUser, findUserByEmail, findUserById, updateUser: updateDbUser } = require("./repositories/usersRepository");
const { createSession: createDbSession, deleteSessionByToken: deleteDbSessionByToken, findSessionByToken } = require("./repositories/sessionsRepository");
const { getWorkspaceSettings: getDbWorkspaceSettings, upsertWorkspaceSettings } = require("./repositories/settingsRepository");
const { listLinksByUser, createLink: createDbLink, deleteLinkBySlug, findLinkBySlug } = require("./repositories/linksRepository");
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
const sessionCookieName = "anylink_session";
const protectedLinkCookiePrefix = "anylink_gate_";
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 14;
const protectedLinkLifetimeSeconds = 60 * 60 * 24;
const verificationLifetimeMs = 1000 * 60 * 30;
const resetLifetimeMs = 1000 * 60 * 30;
const trialLifetimeMs = 1000 * 60 * 60 * 24 * 3;
const publicAppDomain = process.env.PUBLIC_APP_DOMAIN || "go.shortlinks.in";
const dbOnlyMode = String(process.env.DB_ONLY_MODE || "").toLowerCase() === "true";
const builtInAdminEmails = ["yogshkukadiya92@gmail.com", "yogeshkukadiya92@gmail.com"];
const builtInLifetimeEmails = ["yogeshkukadiya92@gmail.com"];

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
      return handleResetPassword(body, req, res);
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
      return withAuth(req, res, (user) => sendJson(res, 200, { billing: serializeBilling(user) }));
    }

    if (req.method === "POST" && pathname === "/api/billing/subscribe") {
      return withAuth(req, res, (user) => handleCreateSubscription(user, res));
    }

    if (req.method === "GET" && pathname === "/api/admin/overview") {
      return withAdmin(req, res, () => handleAdminOverview(res));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/subscription")) {
      const body = await readRequestBody(req);
      const userId = pathname.split("/")[4];
      return withAdmin(req, res, () => handleAdminSubscriptionUpdate(userId, body, res));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/trial")) {
      const body = await readRequestBody(req);
      const userId = pathname.split("/")[4];
      return withAdmin(req, res, () => handleAdminTrialUpdate(userId, body, res));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/users/") && pathname.endsWith("/verify")) {
      const userId = pathname.split("/")[4];
      return withAdmin(req, res, () => handleAdminVerifyUser(userId, res));
    }

    if (req.method === "POST" && pathname.startsWith("/api/admin/sessions/") && pathname.endsWith("/revoke")) {
      const sessionToken = pathname.split("/")[4];
      return withAdmin(req, res, () => handleAdminRevokeSession(sessionToken, res));
    }

    if (req.method === "GET" && pathname === "/api/links") {
      return await withAppAccess(req, res, async (user) => sendJson(res, 200, { links: await readLinksForUserAsync(user.id) }));
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

    if (req.method === "DELETE" && pathname.startsWith("/api/links/")) {
      const slug = pathname.split("/").pop();
      return await withAppAccess(req, res, (user) => handleDeleteLink(slug, res, user));
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
    sendJson(res, 500, { error: "Server error", details: error.message });
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
      return pages.map((page) => mapDbPageRecord(page, req));
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
      return mapDbPageRecord(page, req);
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
      return mapDbPageRecord(page, req);
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

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
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

function withAuth(req, res, handler) {
  const user = getAuthenticatedUser(req);

  if (!user) {
    return sendJson(res, 401, { error: "Authentication required." });
  }

  return handler(user);
}

function withAppAccess(req, res, handler) {
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

function withAdmin(req, res, handler) {
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
      return normalizeDbUser(session.user);
    }
  } catch {
    if (dbOnlyMode) {
      return null;
    }
    // Fall back to file-backed session lookup while migration is in progress.
  }

  return dbOnlyMode ? null : getAuthenticatedUser(req);
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
      user = normalizeDbUser(dbUser);
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
  const users = readUsers();
  const user = users.find((item) => item.email === email);

  if (!user) {
    return sendJson(res, 200, {
      success: true,
      delivery: "email",
      message: "If that email exists, a password reset link has been sent.",
    });
  }

  user.resetToken = createToken();
  user.resetExpiresAt = Date.now() + resetLifetimeMs;
  writeUsers(users);

  const resetUrl = buildAuthUrl(req, "reset", user.resetToken);
  const emailSent = await sendTransactionalEmail({
    to: user.email,
    subject: "Reset your AnyLink password",
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#183153"><h2 style="margin:0 0 12px;">Reset your password</h2><p style="margin:0 0 14px;">We received a request to reset your AnyLink password.</p><p style="margin:0 0 20px;"><a href="${resetUrl}" style="display:inline-block;background:#2852e0;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Reset password</a></p><p style="margin:0;color:#5f7399;">If you did not request this, you can safely ignore this email.</p></div>`,
    text: `Reset your AnyLink password: ${resetUrl}`,
  });

  return sendJson(res, 200, {
    success: true,
    delivery: emailSent ? "email" : "link",
    message: emailSent ? "Password reset link sent to your email." : "Email is not configured yet. Use the reset link below.",
    resetUrl: emailSent ? "" : resetUrl,
  });
}

function handleResetPassword(body, req, res) {
  const token = String(body.token || "").trim();
  const password = String(body.password || "");
  const users = readUsers();
  const user = users.find((item) => item.resetToken === token && Number(item.resetExpiresAt) > Date.now());

  if (!user) {
    return sendJson(res, 400, { error: "This reset link is invalid or expired." });
  }

  if (password.length < 6) {
    return sendJson(res, 400, { error: "Password must be at least 6 characters." });
  }

  user.salt = crypto.randomBytes(16).toString("hex");
  user.passwordHash = hashPassword(password, user.salt);
  user.resetToken = "";
  user.resetExpiresAt = 0;
  writeUsers(users);

  return sendJson(res, 200, { success: true, message: "Password updated. You can sign in now." });
}

async function handleSendVerification(body, req, res) {
  const email = String(body.email || "").trim().toLowerCase();
  const users = readUsers();
  const user = users.find((item) => item.email === email);

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

function handleCreateSubscription(user, res) {
  const paymentUrl = process.env.SUBSCRIPTION_PAYMENT_URL || "";

  if (!paymentUrl) {
    return sendJson(res, 501, {
      error: "Payment link is not configured yet. Set SUBSCRIPTION_PAYMENT_URL to enable live subscription checkout.",
    });
  }

  return sendJson(res, 200, { paymentUrl });
}

function handleAdminOverview(res) {
  const users = readUsers();
  const sessions = readSessions();
  const links = readLinks();

  const userSummaries = users.map((user) => {
    const userSessions = sessions.filter((session) => session.userId === user.id);
    const userLinks = links.filter((link) => link.userId === user.id);
    return {
      ...serializeUser(user),
      billing: serializeBilling(user),
      totalLinks: userLinks.length,
      lastLinkAt: userLinks[0]?.createdAt || "",
      activeSessions: userSessions.length,
    };
  });

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
    users: userSummaries.sort((left, right) => right.billing.trialStartedAt - left.billing.trialStartedAt),
    sessions: sessionSummaries,
    summary: {
      totalUsers: userSummaries.length,
      activeSubscriptions: userSummaries.filter((user) => user.billing.subscriptionStatus === "active" && user.billing.hasAccess).length,
      trialingUsers: userSummaries.filter((user) => user.billing.subscriptionStatus === "trialing" && user.billing.hasAccess).length,
      expiredUsers: userSummaries.filter((user) => !user.billing.hasAccess).length,
    },
  });
}

function handleAdminSubscriptionUpdate(userId, body, res) {
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
    user.trialEndsAt = 0;
    user.subscriptionStartedAt = 0;
    user.subscriptionExpiresAt = 0;
  } else if (mode === "lifetime") {
    user.subscriptionStatus = "lifetime";
    user.subscriptionStartedAt = now;
    user.subscriptionExpiresAt = 0;
  } else {
    return sendJson(res, 400, { error: "Invalid subscription mode." });
  }

  writeUsers(users);

  return sendJson(res, 200, { success: true, billing: serializeBilling(user) });
}

function handleAdminTrialUpdate(userId, body, res) {
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
  writeUsers(users);

  return sendJson(res, 200, { success: true, billing: serializeBilling(user) });
}

function handleAdminVerifyUser(userId, res) {
  const users = readUsers();
  const user = users.find((item) => item.id === userId);

  if (!user) {
    return sendJson(res, 404, { error: "User not found." });
  }

  user.emailVerified = true;
  user.verificationToken = "";
  user.verificationExpiresAt = 0;
  writeUsers(users);

  return sendJson(res, 200, { success: true, user: serializeUser(user) });
}

function handleAdminRevokeSession(sessionToken, res) {
  const sessions = readSessions();
  const nextSessions = sessions.filter((session) => session.token !== sessionToken);

  if (sessions.length === nextSessions.length) {
    return sendJson(res, 404, { error: "Session not found." });
  }

  writeSessions(nextSessions);
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
    "SameSite=Lax",
  ];

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
  const subscriptionStatus = user.subscriptionStatus || "inactive";
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
  if (hasLifetimeAccess(user)) {
    return true;
  }

  const now = Date.now();
  if (user.subscriptionStatus === "active" && Number(user.subscriptionExpiresAt || 0) > now) {
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
  const shortUrl = buildShortUrl(settings.defaultDomain || req.headers.host, slug);
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
  sendJson(res, 201, { link: nextLink });
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
    return sendJson(res, existingIndex >= 0 ? 200 : 201, { page: mapDbPageRecord(dbSaved, req) });
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
  const fieldMarkup = getEnabledFormFields(normalizedPage.fields).map((field) => `
    <label style="display:grid;gap:8px;">
      <span style="font-weight:600;color:#1f356c;">${escapeHtml(field.label)}</span>
      ${field.type === "textarea"
        ? `<textarea name="${field.key}" ${field.required ? "required" : ""} rows="5" style="padding:14px 16px;border:1px solid #d9e2f0;border-radius:14px;font:inherit;"></textarea>`
        : `<input type="${field.type}" name="${field.key}" ${field.required ? "required" : ""} style="padding:14px 16px;border:1px solid #d9e2f0;border-radius:14px;font:inherit;">`}
    </label>
  `).join("");

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
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const entries = Object.fromEntries(new FormData(form).entries());
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
            status.textContent = payload.message || ${JSON.stringify(normalizedPage.thanksMessage)};
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
    const value = String(body[field.key] || "").trim();
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

  return sendJson(res, 201, { success: true, message: normalizedPage.thanksMessage });
}

async function handleDeleteLink(slug, res, user) {
  const links = dbOnlyMode ? [] : readLinks();
  const nextLinks = links.filter((item) => !(item.slug === slug && item.userId === user.id));

  if (dbOnlyMode || nextLinks.length === links.length) {
    try {
      const result = await deleteLinkBySlug(slug, user.id);
      if (!result.count) {
        return sendJson(res, 404, { error: "Link not found." });
      }
      return sendJson(res, 200, { success: true });
    } catch {
      return sendJson(res, 404, { error: "Link not found." });
    }
  }

  if (!dbOnlyMode) {
    writeLinks(nextLinks);
  }
  try {
    await deleteLinkBySlug(slug, user.id);
  } catch {
    if (dbOnlyMode) {
      return sendJson(res, 500, { error: "Unable to complete this request right now. Please try again." });
    }
    // JSON remains fallback during DB migration.
  }
  return sendJson(res, 200, { success: true });
}

async function buildAnalyticsReport(userId, filters = parseAnalyticsFilters()) {
  try {
      const links = await listAnalyticsByUser(userId);
      if (Array.isArray(links) && links.length) {
        const normalizedLinks = links.map((link) => {
          const clicks = filterClicksByAnalyticsRange((link.clickEvents || []).map((click) => ({
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
            slug: link.slug,
            shortUrl: link.shortUrl,
          })), filters);

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
        dnsTarget: entry.dnsTarget || publicAppDomain,
        verifiedAt: entry.verifiedAt ? new Date(entry.verifiedAt) : null,
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

async function handleVerifyDomain(domain, req, res, user) {
  const settings = await readSettingsForUserAsync(user.id, req);
  const sanitizedDomain = sanitizeDomainInput(domain, req);

  if (!sanitizedDomain) {
    return sendJson(res, 400, { error: "Invalid domain." });
  }

  if (!settings.domains.includes(sanitizedDomain)) {
    return sendJson(res, 404, { error: "Domain not found in your workspace." });
  }

  const nextEntries = settings.domainEntries.map((entry) => {
    if (entry.host !== sanitizedDomain) {
      return entry;
    }
    return {
      ...entry,
      status: sanitizedDomain === settings.defaultDomain ? "ACTIVE" : "VERIFIED",
      verifiedAt: new Date().toISOString(),
      dnsTarget: publicAppDomain,
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
      await upsertDomain(user.id, sanitizedDomain, {
        status: sanitizedDomain === settings.defaultDomain ? "ACTIVE" : "VERIFIED",
        isActive: sanitizedDomain === settings.defaultDomain,
        dnsTarget: publicAppDomain,
        verifiedAt: new Date(),
      });
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
    message: `Domain marked as verified. Keep the CNAME for ${sanitizedDomain} pointed to ${publicAppDomain} so new links can use it.`,
    dnsTarget: publicAppDomain,
    recordType: "CNAME",
    hostHint: sanitizedDomain.split(".")[0] || sanitizedDomain,
    settings: nextSettings,
  });
}

function sanitizeFormSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeFormFields(fields) {
  return {
    name: fields.name !== false,
    email: fields.email !== false,
    phone: fields.phone === true,
    company: fields.company === true,
    message: fields.message !== false,
  };
}

function mapInputTypeToDb(type) {
  const normalized = String(type || "text").toLowerCase();
  if (normalized === "email") return "EMAIL";
  if (normalized === "tel") return "TEL";
  if (normalized === "textarea") return "TEXTAREA";
  return "TEXT";
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

function mapDbPageRecord(page, req) {
  const fieldState = {
    name: false,
    email: false,
    phone: false,
    company: false,
    message: false,
  };

  for (const field of page.fields || []) {
    if (Object.prototype.hasOwnProperty.call(fieldState, field.key)) {
      fieldState[field.key] = field.enabled !== false;
    }
  }

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
  const normalized = normalizeFormFields(fields);
  const allFields = [
    { key: "name", label: "Full name", type: "text", required: normalized.name },
    { key: "email", label: "Email address", type: "email", required: normalized.email },
    { key: "phone", label: "Phone number", type: "tel", required: false },
    { key: "company", label: "Company", type: "text", required: false },
    { key: "message", label: "Message", type: "textarea", required: normalized.message },
  ];

  return allFields.filter((field) => normalized[field.key]);
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

function buildClickEvent(req) {
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
  };
}

function recordLinkVisit(link, req) {
  if (!link.analytics || typeof link.analytics !== "object") {
    link.analytics = createEmptyAnalytics();
  }

  if (!Array.isArray(link.analytics.clicks)) {
    link.analytics.clicks = [];
  }

  const click = buildClickEvent(req);
  link.analytics.totalClicks = Number(link.analytics.totalClicks || 0) + 1;
  link.analytics.lastClickedAt = click.clickedAt;
  link.analytics.clicks.unshift(click);
  link.analytics.clicks = link.analytics.clicks.slice(0, 500);
  return click;
}

async function recordLinkVisitAsync(link, req) {
  const click = buildClickEvent(req);
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
  if (dbOnlyMode) {
    return;
  }

  const store = readSettingsStore();
  const existing = store.find((item) => item.userId === userId) || normalizeSettings({ userId }, req);
  const normalized = normalizeSettings({
    ...existing,
    goalAlertState: {
      ...(existing.goalAlertState || {}),
      [slug]: goal,
    },
  }, req);

  const nextStore = store.filter((item) => item.userId !== userId);
  nextStore.push(normalized);
  writeSettingsStore(nextStore);
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
  if (dbOnlyMode) {
    return;
  }

  const store = readSettingsStore();
  const existing = store.find((item) => item.userId === userId) || normalizeSettings({ userId }, req);
  const previousRule = existing.linkRules?.[slug] || {};
  const normalized = normalizeSettings({
    ...existing,
    linkRules: {
      ...(existing.linkRules || {}),
      [slug]: {
        ...previousRule,
        isOneTime: true,
        oneTimeUsedAt: new Date().toISOString(),
      },
    },
  }, req);

  const nextStore = store.filter((item) => item.userId !== userId);
  nextStore.push(normalized);
  writeSettingsStore(nextStore);
}

function hasProtectedLinkAccess(req, rule, slug) {
  if (!rule?.passwordHash || !rule?.accessToken) {
    return true;
  }

  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[getProtectedLinkCookieName(slug)] === rule.accessToken;
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
    "Set-Cookie": `${getProtectedLinkCookieName(link.slug)}=${rule.accessToken}; Path=/; Max-Age=${protectedLinkLifetimeSeconds}; SameSite=Lax`,
  });
  res.end(JSON.stringify({ success: true, destination: link.destination }));
}

async function handleRedirect(slug, req, res) {
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
        await recordLinkVisitAsync(dbMatch, req);
        await maybeSendGoalAchievementEmail(dbMatch, Number(dbMatch.clickCount || 0) + 1, req);
      } catch {
        // Redirect should still work even if analytics write fails.
      }
      if (rule?.isOneTime) {
        markOneTimeLinkUsed(dbMatch.userId, dbMatch.slug, req);
      }
      res.writeHead(302, { Location: dbMatch.destination });
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
    recordLinkVisit(match, req);
    writeLinks(links);
    try {
      await maybeSendGoalAchievementEmail(match, Number(match.analytics?.totalClicks || 0), req);
    } catch {
      // Redirect should still work even if goal email fails.
    }
    if (rule?.isOneTime) {
      markOneTimeLinkUsed(match.userId, match.slug, req);
    }
    res.writeHead(302, { Location: match.destination });
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

function defaultSettings(req) {
  const fallbackDomain = getDefaultShortDomain(req);
  return {
    userId: "",
    workspaceName: "AnyLink Workspace",
    defaultDomain: fallbackDomain,
    domains: [fallbackDomain],
    domainEntries: [{ host: fallbackDomain, status: "APP_DEFAULT", isActive: true, dnsTarget: publicAppDomain, verifiedAt: null }],
    conversionGoals: {},
    goalAlertState: {},
    linkRules: {},
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
    const previous = previousRules?.[slug] || {};
    const nextRule = {
      startsAt,
      expiresAt,
      isPaused,
      isOneTime: Boolean(value.isOneTime || previous.isOneTime),
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

    if (!startsAt && !expiresAt && !isPaused && !nextRule.passwordHash && !nextRule.isOneTime) {
      continue;
    }

    rules[slug] = nextRule;
  }

  return rules;
}

function buildDomainEntries(domains, defaultDomain, req, sourceEntries = []) {
  const fallback = getDefaultShortDomain(req);
  const sourceMap = new Map((sourceEntries || []).map((entry) => [entry.host, entry]));

  return domains.map((host) => {
    if (host === fallback) {
      return { host, status: "APP_DEFAULT", isActive: host === defaultDomain, dnsTarget: publicAppDomain, verifiedAt: null };
    }

    const existing = sourceMap.get(host) || {};
    const isActive = host === defaultDomain;
    const baseStatus = String(existing.status || "PENDING").toUpperCase();
    const status = isActive ? "ACTIVE" : (baseStatus === "ACTIVE" ? "VERIFIED" : baseStatus);

    return {
      host,
      status,
      isActive,
      dnsTarget: existing.dnsTarget || publicAppDomain,
      verifiedAt: existing.verifiedAt || null,
    };
  });
}

function normalizeSettings(settings, req) {
  const base = defaultSettings(req);
  const workspaceName = String(settings?.workspaceName || base.workspaceName).trim() || base.workspaceName;
  const domains = normalizeDomains(settings?.domains || [settings?.defaultDomain || base.defaultDomain], req);
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
    conversionGoals: normalizeConversionGoals(settings?.conversionGoals || {}),
    goalAlertState: normalizeGoalAlertState(settings?.goalAlertState || {}),
    linkRules: normalizeLinkRules(settings?.linkRules || {}, settings?.linkRules || {}),
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
  const hostHeader = req?.headers?.host || "127.0.0.1:3000";
  const protocol = getRequestProtocol(req, hostHeader);
  return `${protocol}://${hostHeader}/auth?mode=${encodeURIComponent(mode)}&token=${encodeURIComponent(token)}`;
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
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}








