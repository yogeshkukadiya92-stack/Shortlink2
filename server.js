const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const host = "0.0.0.0";
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const linksFile = path.join(dataDir, "links.json");
const settingsFile = path.join(dataDir, "settings.json");
const usersFile = path.join(dataDir, "users.json");
const sessionsFile = path.join(dataDir, "sessions.json");
const sessionCookieName = "anylink_session";
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 14;
const verificationLifetimeMs = 1000 * 60 * 30;
const resetLifetimeMs = 1000 * 60 * 30;
const trialLifetimeMs = 1000 * 60 * 60 * 24 * 3;
const builtInAdminEmails = ["yogshkukadiya92@gmail.com", "yogeshkukadiya92@gmail.com"];

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
      return handleSignup(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await readRequestBody(req);
      return handleLogin(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/profile") {
      const body = await readRequestBody(req);
      return withAuth(req, res, (user) => handleUpdateProfile(body, req, res, user));
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      return handleLogout(req, res);
    }

    if (req.method === "GET" && pathname === "/api/auth/me") {
      return handleAuthMe(req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/forgot-password") {
      const body = await readRequestBody(req);
      return handleForgotPassword(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/reset-password") {
      const body = await readRequestBody(req);
      return handleResetPassword(body, req, res);
    }

    if (req.method === "POST" && pathname === "/api/auth/send-verification") {
      const body = await readRequestBody(req);
      return handleSendVerification(body, req, res);
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
      return withAppAccess(req, res, (user) => sendJson(res, 200, { links: readLinksForUser(user.id) }));
    }

    if (req.method === "POST" && pathname === "/api/links") {
      const body = await readRequestBody(req);
      return withAppAccess(req, res, (user) => handleCreateLink(body, req, res, user));
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/links/")) {
      const slug = pathname.split("/").pop();
      return withAppAccess(req, res, (user) => handleDeleteLink(slug, res, user));
    }

    if (req.method === "GET" && pathname === "/api/settings") {
      return withAppAccess(req, res, (user) => sendJson(res, 200, { settings: readSettingsForUser(user.id, req) }));
    }

    if (req.method === "POST" && pathname === "/api/settings") {
      const body = await readRequestBody(req);
      return withAppAccess(req, res, (user) => handleSaveSettings(body, req, res, user));
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
        const links = readLinks();
        const match = links.find((item) => item.slug === slug);

        if (match) {
          res.writeHead(302, { Location: match.destination });
          res.end();
          return;
        }
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

function readLinksForUser(userId) {
  return readLinks().filter((item) => item.userId === userId);
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

function handleSignup(body, req, res) {
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

  const users = readUsers();

  if (users.some((item) => item.email === email)) {
    return sendJson(res, 409, { error: "An account with this email already exists." });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    salt,
    passwordHash,
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

  users.push(user);
  writeUsers(users);
  ensureUserSettings(user.id, req);
  return createSessionResponse(user, req, res, 201, {
    verificationUrl: buildAuthUrl(req, "verify", user.verificationToken),
  });
}

function handleLogin(body, req, res) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = readUsers().find((item) => item.email === email);

  if (!user) {
    return sendJson(res, 401, { error: "Invalid email or password." });
  }

  const passwordHash = hashPassword(password, user.salt);

  if (passwordHash !== user.passwordHash) {
    return sendJson(res, 401, { error: "Invalid email or password." });
  }

  return createSessionResponse(user, req, res, 200);
}

function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[sessionCookieName];

  if (token) {
    const sessions = readSessions().filter((item) => item.token !== token);
    writeSessions(sessions);
  }

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": buildSessionCookie("", { maxAge: 0 }),
  });
  res.end(JSON.stringify({ success: true }));
}

function handleUpdateProfile(body, req, res, user) {
  const users = readUsers();
  const record = users.find((item) => item.id === user.id);

  if (!record) {
    return sendJson(res, 404, { error: "User not found." });
  }

  const nextName = String(body.name || "").trim();

  if (nextName.length < 2) {
    return sendJson(res, 400, { error: "Name must be at least 2 characters." });
  }

  record.name = nextName;
  writeUsers(users);

  return sendJson(res, 200, { user: serializeUser(record) });
}

function handleAuthMe(req, res) {
  const user = getAuthenticatedUser(req);

  if (!user) {
    return sendJson(res, 200, { user: null });
  }

  return sendJson(res, 200, { user: serializeUser(user), billing: serializeBilling(user) });
}

function handleForgotPassword(body, req, res) {
  const email = String(body.email || "").trim().toLowerCase();
  const users = readUsers();
  const user = users.find((item) => item.email === email);

  if (!user) {
    return sendJson(res, 200, { success: true, message: "If that email exists, a reset link has been created." });
  }

  user.resetToken = createToken();
  user.resetExpiresAt = Date.now() + resetLifetimeMs;
  writeUsers(users);

  return sendJson(res, 200, {
    success: true,
    message: "Reset link generated.",
    resetUrl: buildAuthUrl(req, "reset", user.resetToken),
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

function handleSendVerification(body, req, res) {
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

  return sendJson(res, 200, {
    success: true,
    message: "Verification link generated.",
    verificationUrl: buildAuthUrl(req, "verify", user.verificationToken),
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

  const days = Math.max(1, Number(body.days) || 30);
  user.subscriptionStatus = "active";
  user.subscriptionStartedAt = Date.now();
  user.subscriptionExpiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
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

function createSessionResponse(user, req, res, statusCode, extras = {}) {
  const sessions = readSessions().filter((item) => item.userId !== user.id);
  const token = crypto.randomBytes(32).toString("hex");
  const session = {
    token,
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionLifetimeMs,
  };

  sessions.push(session);
  writeSessions(sessions);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": buildSessionCookie(token, { maxAge: sessionLifetimeMs / 1000 }),
  });
  res.end(JSON.stringify({ user: serializeUser(user), settings: readSettingsForUser(user.id, req), billing: serializeBilling(user), ...extras }));
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
  const now = Date.now();
  if (user.subscriptionStatus === "active" && Number(user.subscriptionExpiresAt || 0) > now) {
    return true;
  }

  return Number(user.trialEndsAt || 0) > now;
}

function handleCreateLink(body, req, res, user) {
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

  const links = readLinks();
  const slug = customSlug || generateSlug(links);

  if (!/^[a-z0-9-]{3,32}$/.test(slug)) {
    return sendJson(res, 400, { error: "Slug must be 3-32 characters and use only letters, numbers, or hyphens." });
  }

  if (links.some((item) => item.slug === slug)) {
    return sendJson(res, 409, { error: "That short link already exists. Try another custom slug." });
  }

  const settings = readSettingsForUser(user.id, req);
  const shortUrl = buildShortUrl(settings.defaultDomain || req.headers.host, slug);
  const nextLink = {
    id: Date.now(),
    userId: user.id,
    slug,
    destination,
    shortUrl,
    includeQr,
    createdAt: new Date().toISOString(),
  };

  links.unshift(nextLink);
  writeLinks(links);
  sendJson(res, 201, { link: nextLink });
}

function handleDeleteLink(slug, res, user) {
  const links = readLinks();
  const nextLinks = links.filter((item) => !(item.slug === slug && item.userId === user.id));

  if (nextLinks.length === links.length) {
    return sendJson(res, 404, { error: "Link not found." });
  }

  writeLinks(nextLinks);
  return sendJson(res, 200, { success: true });
}

function handleSaveSettings(body, req, res, user) {
  const currentSettings = readSettingsForUser(user.id, req);
  const workspaceName = String(body.workspaceName || currentSettings.workspaceName || "").trim();
  const defaultDomain = sanitizeDomainInput(String(body.defaultDomain || currentSettings.defaultDomain || "").trim(), req);
  const requestedDomains = Array.isArray(body.domains) ? body.domains : currentSettings.domains;
  const domains = normalizeDomains(requestedDomains, req);

  if (!workspaceName) {
    return sendJson(res, 400, { error: "Workspace name is required." });
  }

  if (!defaultDomain) {
    return sendJson(res, 400, { error: "Enter a valid domain or host." });
  }

  if (!domains.includes(defaultDomain)) {
    domains.unshift(defaultDomain);
  }

  const nextSettings = normalizeSettings({
    userId: user.id,
    workspaceName,
    defaultDomain,
    domains,
  }, req);

  const store = readSettingsStore().filter((item) => item.userId !== user.id);
  store.push(nextSettings);
  writeSettingsStore(store);
  return sendJson(res, 200, { settings: nextSettings });
}

function ensureUserSettings(userId, req) {
  const store = readSettingsStore();

  if (store.some((item) => item.userId === userId)) {
    return;
  }

  store.push(normalizeSettings({ userId }, req));
  writeSettingsStore(store);
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
  const fallbackDomain = req?.headers?.host || "127.0.0.1:3000";
  return {
    userId: "",
    workspaceName: "AnyLink Workspace",
    defaultDomain: fallbackDomain,
    domains: [fallbackDomain],
  };
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

  return {
    userId: settings?.userId || "",
    workspaceName,
    defaultDomain,
    domains,
  };
}

function normalizeDomains(domains, req) {
  const fallback = req?.headers?.host || "127.0.0.1:3000";
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
  }

  return normalized;
}

function sanitizeDomainInput(value, req) {
  const fallback = req?.headers?.host || "127.0.0.1:3000";

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
  const protocol = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostHeader) ? "http" : "https";
  return `${protocol}://${hostHeader}/auth?mode=${encodeURIComponent(mode)}&token=${encodeURIComponent(token)}`;
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
