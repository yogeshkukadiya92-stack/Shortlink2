const body = document.body;
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const mainContent = document.getElementById("mainContent");
const pageTitle = document.getElementById("pageTitle");
const pageEyebrow = document.getElementById("pageEyebrow");
const searchInput = document.getElementById("searchInput");
const logoutButton = document.getElementById("logoutButton");
const profileName = document.querySelector(".profile-name");
const avatar = document.querySelector(".avatar");
const profileMenu = document.getElementById("profileMenu");
const profileMenuButton = document.getElementById("profileMenuButton");
const profileDropdown = document.getElementById("profileDropdown");
const profileAdminLink = document.getElementById("profileAdminLink");
const adminNavItem = document.getElementById("adminNavItem");
const publicShortDomain = "go.shortlinks.in";

let currentPage = getCurrentPage();
let currentUser = null;
let linksCache = [];
let pagesCache = [];
let selectedQrSlug = null;
let selectedFormId = "";
let analyticsRange = "30d";
let analyticsCustomStart = "";
let analyticsCustomEnd = "";
let settingsCache = {
  workspaceName: "AnyLink Workspace",
  defaultDomain: getDefaultShortDomain(),
  domains: [getDefaultShortDomain()],
  conversionGoals: {},
  linkRules: {},
};
let billingCache = {
  subscriptionStatus: "trialing",
  trialStartedAt: 0,
  trialEndsAt: 0,
  trialRemainingMs: 0,
  subscriptionStartedAt: 0,
  subscriptionExpiresAt: 0,
  hasAccess: true,
};
function getAuthQuery() {
  return new URLSearchParams(window.location.search);
}

const pageMeta = {
  auth: { eyebrow: "Secure Access", title: "Sign in" },
  home: { eyebrow: "Workspace", title: "Home" },
  links: { eyebrow: "Library", title: "Links" },
  "qr-codes": { eyebrow: "Create", title: "QR Codes" },
  pages: { eyebrow: "Microsites", title: "Pages" },
  analytics: { eyebrow: "Performance", title: "Analytics" },
  campaigns: { eyebrow: "UTM Studio", title: "Campaigns" },
  admin: { eyebrow: "Control Center", title: "Admin Panel" },
  "custom-domains": { eyebrow: "Branding", title: "Custom domains" },
  settings: { eyebrow: "Account", title: "Settings" },
  billing: { eyebrow: "Billing", title: "Subscription" },
};

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/auth";
});

profileMenuButton.addEventListener("click", () => {
  const isOpen = !profileDropdown.classList.contains("hidden");
  profileDropdown.classList.toggle("hidden", isOpen);
  profileMenuButton.setAttribute("aria-expanded", String(!isOpen));
});

searchInput.addEventListener("input", () => {
  if (currentPage === "links" && currentUser) {
    renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
  }
});

document.addEventListener("click", (event) => {
  const qrLink = event.target.closest("[data-open-qr]");
  if (qrLink) {
    selectedQrSlug = qrLink.getAttribute("data-open-qr");
  }

  if (profileMenu && !profileMenu.contains(event.target)) {
    profileDropdown.classList.add("hidden");
    profileMenuButton.setAttribute("aria-expanded", "false");
  }
});

initialize();

async function initialize() {
  currentPage = getCurrentPage();
  try {
    await loadCurrentUser();

    if (!currentUser && currentPage !== "auth") {
      window.location.replace("/auth");
      return;
    }

    if (currentUser && currentPage === "auth") {
      window.location.replace("/home");
      return;
    }

    applyShellMode();

    if (currentUser) {
      const canLoadWorkspace = billingCache.hasAccess || currentUser.isAdmin;

      if (canLoadWorkspace) {
        await loadSettings();
        if (["home", "links", "analytics", "qr-codes"].includes(currentPage)) {
          await loadLinks();
        }
        if (currentPage === "pages") {
          await loadPages();
        }
      } else {
        settingsCache = normalizeSettings({
          workspaceName: "AnyLink Workspace",
          defaultDomain: getDefaultShortDomain(),
          domains: [getDefaultShortDomain()],
        });
      }
    }

    updateHeaderMeta();
    renderPage();
  } catch (error) {
    updateHeaderMeta();
    if (currentUser && !billingCache.hasAccess && !currentUser.isAdmin) {
      renderBillingPage();
      return;
    }

    mainContent.innerHTML = `
      <section class="surface-card">
        <h2>Workspace error</h2>
        <p>${escapeHtml(error.message || "Something went wrong while loading your dashboard.")}</p>
      </section>
    `;
  }
}

function getCurrentPage() {
  const cleaned = window.location.pathname.replace(/^\/+|\/+$/g, "");
  return cleaned || "auth";
}

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/auth/me");
    const payload = await response.json();
    currentUser = payload.user || null;
    billingCache = payload.billing || billingCache;
  } catch {
    currentUser = null;
  }
}

async function saveProfile(nextProfile) {
  const response = await fetch("/api/auth/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextProfile),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to save profile");
  }

  currentUser = payload.user || currentUser;
  applyShellMode();
  return currentUser;
}

async function changePassword(payload) {
  const response = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to change password");
  }

  return data;
}

function applyShellMode() {
  const authMode = !currentUser || currentPage === "auth";
  body.classList.toggle("auth-screen", authMode);
  adminNavItem.classList.toggle("hidden", !(currentUser && currentUser.isAdmin));
  profileAdminLink.classList.toggle("hidden", !(currentUser && currentUser.isAdmin));

  if (currentUser) {
    profileName.textContent = currentUser.name;
    avatar.textContent = currentUser.name.charAt(0).toUpperCase();
  } else {
    profileName.textContent = "Guest";
    avatar.textContent = "A";
  }

  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === currentPage);
  });

  if (!currentUser) {
    profileDropdown.classList.add("hidden");
    profileMenuButton.setAttribute("aria-expanded", "false");
  }
}

function updateHeaderMeta() {
  const meta = pageMeta[currentPage] || pageMeta.home;
  pageEyebrow.textContent = meta.eyebrow;
  pageTitle.textContent = currentUser ? meta.title : "AnyLink";
  document.title = currentUser ? `${meta.title} | ${settingsCache.workspaceName}` : "AnyLink | Auth";
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load settings");
  }

  settingsCache = normalizeSettings(payload.settings || settingsCache);
}

async function loadBilling() {
  const response = await fetch("/api/billing/status");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load billing");
  }

  billingCache = payload.billing || billingCache;
}

async function saveSettings(nextSettings) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextSettings),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to save settings");
  }

  settingsCache = normalizeSettings(payload.settings);
  updateHeaderMeta();
  return settingsCache;
}

function normalizeSettings(settings) {
  const domains = Array.isArray(settings.domains) && settings.domains.length
    ? [...new Set(settings.domains)]
    : [settings.defaultDomain || getDefaultShortDomain()];

  if (!domains.includes(publicShortDomain)) {
    domains.unshift(publicShortDomain);
  }

  const requestedDefault = settings.defaultDomain || getDefaultShortDomain();
  const defaultDomain = domains.includes(requestedDefault) ? requestedDefault : getDefaultShortDomain();
  const rawEntries = Array.isArray(settings.domainEntries) ? settings.domainEntries : [];
  const entryMap = new Map(rawEntries.map((entry) => [entry.host, entry]));
  const domainEntries = domains.map((host) => {
    const existing = entryMap.get(host) || {};
    if (host === publicShortDomain) {
      return { host, status: "APP_DEFAULT", isActive: host === defaultDomain, dnsTarget: publicShortDomain, verifiedAt: null };
    }
    const isActive = host === defaultDomain;
    const status = isActive ? "ACTIVE" : (existing.status || "PENDING");
    return {
      host,
      status,
      isActive,
      dnsTarget: existing.dnsTarget || publicShortDomain,
      verifiedAt: existing.verifiedAt || null,
    };
  });

  return {
    workspaceName: settings.workspaceName || "AnyLink Workspace",
    defaultDomain,
    domains,
    domainEntries,
    conversionGoals: normalizeConversionGoals(settings.conversionGoals || {}),
    linkRules: normalizeLinkRules(settings.linkRules || {}),
  };
}

function normalizeConversionGoals(goals) {
  const normalized = {};

  Object.entries(goals || {}).forEach(([slug, value]) => {
    const cleanSlug = sanitizeSlug(slug);
    const goal = Math.max(0, Number(value) || 0);

    if (cleanSlug && goal > 0) {
      normalized[cleanSlug] = goal;
    }
  });

  return normalized;
}

function normalizeLinkRules(rules) {
  const normalized = {};

  Object.entries(rules || {}).forEach(([slug, value]) => {
    const cleanSlug = sanitizeSlug(slug);
    if (!cleanSlug || !value || typeof value !== "object") {
      return;
    }

    const expiresAt = String(value.expiresAt || "").trim();
    const isPaused = Boolean(value.isPaused);
    const isProtected = Boolean(value.passwordHash || value.isProtected);
    const isOneTime = Boolean(value.isOneTime);
    const oneTimeUsedAt = String(value.oneTimeUsedAt || "").trim();
    if (!expiresAt && !isPaused && !isProtected && !isOneTime) {
      return;
    }

    normalized[cleanSlug] = { expiresAt, isPaused, isProtected, isOneTime, oneTimeUsedAt };
  });

  return normalized;
}

function getLinkRule(slug) {
  return settingsCache.linkRules?.[slug] || { expiresAt: "", isPaused: false, isProtected: false, isOneTime: false, oneTimeUsedAt: "" };
}

function getLinkGoal(slug) {
  return Number(settingsCache.conversionGoals?.[slug] || 0);
}

function getGoalStatus(link) {
  const goal = getLinkGoal(link.slug);
  const clicks = Number(link.totalClicks ?? link.clickCount ?? 0);
  const achieved = goal > 0 && clicks >= goal;
  const progress = goal ? Math.min(100, Math.round((clicks / goal) * 100)) : 0;
  return { goal, clicks, achieved, progress };
}

function buildGoalMarkup(link) {
  const { goal, clicks, achieved, progress } = getGoalStatus(link);
  if (!goal) {
    return '<span class="analytics-tag">No goal set</span>';
  }

  return `<span class="analytics-tag strong ${achieved ? "success" : ""}">${achieved ? `Goal achieved · ${clicks}/${goal}` : `Goal ${goal} · ${progress}% reached`}</span>`;
}

function emitGoalAlerts() {
  const reached = linksCache
    .map((link) => ({ link, status: getGoalStatus(link) }))
    .filter((entry) => entry.status.achieved);

  if (!reached.length) {
    return;
  }

  try {
    const key = "goal-achievements-shown";
    const shown = JSON.parse(sessionStorage.getItem(key) || "[]");
    const shownSet = new Set(Array.isArray(shown) ? shown : []);
    const fresh = reached.filter((entry) => !shownSet.has(entry.link.slug));

    if (!fresh.length) {
      return;
    }

    fresh.forEach((entry) => shownSet.add(entry.link.slug));
    sessionStorage.setItem(key, JSON.stringify([...shownSet]));

    const labels = fresh.map((entry) => entry.link.slug).slice(0, 3).join(", ");
    showGlobalMessage(`Goal achieved for ${labels}${fresh.length > 3 ? " and more" : ""}.`, false);
  } catch {
    // Ignore storage issues.
  }
}

async function loadLinks() {
  const response = await fetch("/api/links");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load links");
  }

  linksCache = payload.links || [];
  emitGoalAlerts();
}

async function loadAnalytics() {
  const customQuery = analyticsRange === "custom"
    ? `&start=${encodeURIComponent(analyticsCustomStart || "")}&end=${encodeURIComponent(analyticsCustomEnd || "")}`
    : "";
  const response = await fetch(`/api/analytics?range=${encodeURIComponent(analyticsRange)}${customQuery}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load analytics");
  }

  return payload.analytics;
}

async function loadPages() {
  const response = await fetch("/api/pages");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load forms");
  }

  pagesCache = payload.pages || [];

  if (!selectedFormId && pagesCache.length) {
    selectedFormId = pagesCache[0].id;
  }
}

function renderPage() {
  if (!currentUser || currentPage === "auth") return renderAuthPage();
  if (!billingCache.hasAccess && currentPage !== "admin" && !currentUser.isAdmin) return renderBillingPage();
  if (currentPage === "home") return renderHomePage();
  if (currentPage === "links") return renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
  if (currentPage === "qr-codes") return renderQrPage();
  if (currentPage === "pages") return renderPagesBuilder();
  if (currentPage === "analytics") return renderAnalyticsPage();
  if (currentPage === "campaigns") return renderCampaignsPage();
  if (currentPage === "admin") return renderAdminPage();
  if (currentPage === "custom-domains") return renderDomainsPage();
  if (currentPage === "settings") return renderSettingsPage();

  mainContent.innerHTML = `<section class="surface-card"><h2>Page not found</h2><p>This dashboard page is not available.</p></section>`;
}

function renderBillingPage() {
  const daysLeft = Math.max(0, Math.ceil((billingCache.trialRemainingMs || 0) / (1000 * 60 * 60 * 24)));
  currentPage = "billing";
  updateHeaderMeta();
  mainContent.innerHTML = `
    <section class="auth-shell">
      <div class="auth-card auth-copy-card">
        <p class="eyebrow">Subscription Required</p>
        <h1>Your trial has ended.</h1>
        <p class="auth-copy">You had a 3-day free trial. Subscribe to continue creating links, QR codes, domains, and private workspace access.</p>
        <div class="auth-feature-list">
          <div class="auth-feature"><span class="task-check filled"></span><span>Unlimited private short links</span></div>
          <div class="auth-feature"><span class="task-check filled"></span><span>Unlimited custom domains</span></div>
          <div class="auth-feature"><span class="task-check filled"></span><span>QR codes, analytics, and secure account access</span></div>
        </div>
      </div>
      <div class="auth-card auth-form-card">
        <div class="billing-card">
          <p class="eyebrow">Plan</p>
          <h2>Pro Subscription</h2>
          <p class="billing-copy">Trial remaining: <strong>${daysLeft}</strong> day${daysLeft === 1 ? "" : "s"}.</p>
          <button class="primary-action auth-submit" id="subscribeButton" type="button">Continue to payment</button>
          <div class="result-banner hidden" id="billingBanner" aria-live="polite"></div>
        </div>
      </div>
    </section>
  `;

  document.getElementById("subscribeButton").addEventListener("click", async () => {
    const banner = document.getElementById("billingBanner");
    setInlineBanner(banner, "Preparing payment...", false);
    try {
      const response = await fetch("/api/billing/subscribe", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        setInlineBanner(banner, payload.error || "Payment setup is not ready yet.", true);
        return;
      }
      window.location.href = payload.paymentUrl;
    } catch (error) {
      setInlineBanner(banner, error.message, true);
    }
  });
}

async function renderAdminPage() {
  if (!currentUser.isAdmin) {
    mainContent.innerHTML = `<section class="surface-card"><h2>Admin access required</h2><p>Your account does not have permission to view this page.</p></section>`;
    return;
  }

  mainContent.innerHTML = `<section class="surface-card"><p>Loading admin dashboard...</p></section>`;

  try {
    const response = await fetch("/api/admin/overview");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Could not load admin dashboard.");
    }

    mainContent.innerHTML = `
      <section class="stat-grid">
        <article class="stat-card"><span>Total users</span><strong>${payload.summary.totalUsers}</strong></article>
        <article class="stat-card"><span>Active subscriptions</span><strong>${payload.summary.activeSubscriptions}</strong></article>
        <article class="stat-card"><span>Expired users</span><strong>${payload.summary.expiredUsers}</strong></article>
      </section>
      <section class="surface-card">
        <div class="surface-header">
          <div>
            <h2>User management</h2>
            <p>Manage verification, trial access, subscriptions, and private user accounts.</p>
          </div>
        </div>
        <div class="admin-table">
          ${payload.users.map((user) => `
            <div class="admin-row">
              <div class="admin-main">
                <strong>${escapeHtml(user.name)}</strong>
                <span>${escapeHtml(user.email)}</span>
                <span>${user.emailVerified ? "Verified" : "Not verified"} • ${escapeHtml(user.billing.subscriptionStatus)}</span>
                <span>${user.totalLinks} links • ${user.activeSessions} sessions</span>
              </div>
              <div class="admin-actions">
                <select class="admin-select" data-admin-mode="${escapeHtml(user.id)}">
                  <option value="active" ${user.billing.subscriptionStatus === "active" ? "selected" : ""}>Active</option>
                  <option value="trial" ${user.billing.subscriptionStatus === "trialing" ? "selected" : ""}>Trial</option>
                  <option value="inactive" ${user.billing.subscriptionStatus === "inactive" ? "selected" : ""}>Inactive</option>
                  <option value="lifetime" ${user.billing.subscriptionStatus === "lifetime" ? "selected" : ""}>Lifetime</option>
                </select>
                <input class="admin-days-input" data-admin-days="${escapeHtml(user.id)}" type="number" min="1" value="${user.billing.subscriptionStatus === "trialing" ? 3 : 30}" />
                <button class="link-button" data-admin-apply="${escapeHtml(user.id)}">Apply</button>
                ${user.emailVerified ? "" : `<button class="link-button secondary" data-admin-verify="${escapeHtml(user.id)}">Verify</button>`}
              </div>
            </div>
          `).join("")}
        </div>
      </section>
      <section class="surface-card">
        <div class="surface-header">
          <div>
            <h2>Active sessions</h2>
            <p>Review and revoke active user sessions when needed.</p>
          </div>
        </div>
        <div class="admin-table">
          ${payload.sessions.length
            ? payload.sessions.map((session) => `
              <div class="admin-row">
                <div class="admin-main">
                  <strong>${escapeHtml(session.userName)}</strong>
                  <span>${escapeHtml(session.email)}</span>
                  <span>Created: ${escapeHtml(new Date(session.createdAt).toLocaleString())}</span>
                  <span>Expires: ${escapeHtml(new Date(session.expiresAt).toLocaleString())}</span>
                </div>
                <div class="admin-actions">
                  <button class="link-button danger" data-admin-revoke="${escapeHtml(session.token)}">Revoke</button>
                </div>
              </div>
            `).join("")
            : '<div class="empty-state">No active sessions right now.</div>'}
        </div>
      </section>
    `;

    bindAdminActions();
  } catch (error) {
    mainContent.innerHTML = `<section class="surface-card"><h2>Admin error</h2><p>${escapeHtml(error.message)}</p></section>`;
  }
}

function bindAdminActions() {
  document.querySelectorAll("[data-admin-apply]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = button.getAttribute("data-admin-apply");
      const mode = document.querySelector(`[data-admin-mode="${userId}"]`)?.value || "active";
      const daysValue = Number(document.querySelector(`[data-admin-days="${userId}"]`)?.value || 30);
      await runAdminAction(
        `/api/admin/users/${userId}/subscription`,
        { mode, days: daysValue },
        `Subscription updated to ${mode}.`
      );
    });
  });

  document.querySelectorAll("[data-admin-verify]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runAdminAction(`/api/admin/users/${button.getAttribute("data-admin-verify")}/verify`, {}, "User verified.");
    });
  });

  document.querySelectorAll("[data-admin-revoke]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runAdminAction(`/api/admin/sessions/${button.getAttribute("data-admin-revoke")}/revoke`, {}, "Session revoked.");
    });
  });
}

async function runAdminAction(url, body, successMessage) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Admin action failed.");
    }

    showGlobalMessage(successMessage, false);
    await renderAdminPage();
  } catch (error) {
    showGlobalMessage(error.message, true);
  }
}

function renderAuthPage() {
  const authQuery = getAuthQuery();
  const authMode = authQuery.get("mode") || "signin";
  const token = authQuery.get("token") || "";
  const activeMode = ["signin", "signup", "forgot", "reset", "verify"].includes(authMode) ? authMode : "signin";
  const isSignin = activeMode === "signin";
  const isSignup = activeMode === "signup";
  const isForgot = activeMode === "forgot";
  const isReset = activeMode === "reset";
  const isVerify = activeMode === "verify";

  const authPanelMarkup = isSignup
    ? `<form class="auth-form" id="signupForm">
            <label class="field-label" for="signupName">Full name</label>
            <input class="url-input" id="signupName" type="text" placeholder="Your name" required>
            <label class="field-label" for="signupEmail">Email</label>
            <input class="url-input" id="signupEmail" type="email" placeholder="you@example.com" required>
            <label class="field-label" for="signupPassword">Password</label>
            <div class="password-field"><input class="url-input" id="signupPassword" type="password" placeholder="Minimum 6 characters" required><button class="password-toggle" type="button" data-password-toggle="signupPassword">Show</button></div>
            <button class="primary-action auth-submit" type="submit">Create account</button>
          </form>`
    : isForgot
      ? `<form class="auth-form" id="forgotForm">
            <p class="helper-copy auth-helper-copy">Enter your email and we will generate a secure password reset link for your account.</p>
            <label class="field-label" for="forgotEmail">Email</label>
            <input class="url-input" id="forgotEmail" type="email" placeholder="you@example.com" required>
            <button class="primary-action auth-submit" type="submit">Send reset link</button>
            <button class="auth-inline-link" type="button" id="backToSignin">Back to sign in</button>
          </form>`
      : isReset
        ? `<form class="auth-form" id="resetForm">
            <p class="helper-copy auth-helper-copy">Create a new password for your account.</p>
            <label class="field-label" for="resetPassword">New password</label>
            <div class="password-field"><input class="url-input" id="resetPassword" type="password" placeholder="Minimum 6 characters" required><button class="password-toggle" type="button" data-password-toggle="resetPassword">Show</button></div>
            <button class="primary-action auth-submit" type="submit">Reset password</button>
          </form>`
        : isVerify
          ? `<div class="auth-form auth-state-panel">
            <p class="helper-copy auth-helper-copy">We are checking your email verification link now.</p>
          </div>`
          : `<form class="auth-form" id="signinForm">
            <label class="field-label" for="signinEmail">Email</label>
            <input class="url-input" id="signinEmail" type="email" placeholder="you@example.com" required>
            <label class="field-label" for="signinPassword">Password</label>
            <div class="password-field"><input class="url-input" id="signinPassword" type="password" placeholder="Enter password" required><button class="password-toggle" type="button" data-password-toggle="signinPassword">Show</button></div>
            <button class="primary-action auth-submit" type="submit">Sign in</button>
            <button class="auth-inline-link auth-inline-link-muted" type="button" id="forgotPasswordLink">Forgot password?</button>
          </form>`;

  mainContent.innerHTML = `
    <section class="auth-shell">
      <div class="auth-card auth-copy-card">
        <p class="eyebrow">Private Workspace</p>
        <h1>Own your links, securely.</h1>
        <p class="auth-copy">Create a personal AnyLink account, keep your links private, and manage your own domains, QR codes, and analytics without mixing data with anyone else.</p>
        <div class="auth-feature-list">
          <div class="auth-feature"><span class="task-check filled"></span><span>Personal sign up and sign in</span></div>
          <div class="auth-feature"><span class="task-check filled"></span><span>Private links and settings per user</span></div>
          <div class="auth-feature"><span class="task-check filled"></span><span>Separate custom domains and QR workspace</span></div>
        </div>
      </div>
      <div class="auth-card auth-form-card">
        ${isReset || isVerify || isForgot ? "" : `<div class="auth-tabs">
          <button class="auth-tab ${isSignin ? "active" : ""}" data-auth-tab="signin">Sign in</button>
          <button class="auth-tab ${isSignup ? "active" : ""}" data-auth-tab="signup">Sign up</button>
        </div>`}
        ${authPanelMarkup}
        <div class="result-banner hidden" id="authBanner" aria-live="polite"></div>
      </div>
    </section>
  `;

  const signinForm = document.getElementById("signinForm");
  const signupForm = document.getElementById("signupForm");
  const resetForm = document.getElementById("resetForm");
  const forgotForm = document.getElementById("forgotForm");
  const authBanner = document.getElementById("authBanner");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const backToSignin = document.getElementById("backToSignin");

  document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.getAttribute("data-auth-tab");
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("mode", mode);
      nextUrl.searchParams.delete("token");
      window.history.replaceState({}, "", nextUrl);
      renderAuthPage();
    });
  });

  forgotPasswordLink?.addEventListener("click", () => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "forgot");
    nextUrl.searchParams.delete("token");
    window.history.replaceState({}, "", nextUrl);
    renderAuthPage();
  });

  backToSignin?.addEventListener("click", () => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", "signin");
    nextUrl.searchParams.delete("token");
    window.history.replaceState({}, "", nextUrl);
    renderAuthPage();
  });

  signinForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineBanner(authBanner, "Signing in...", false);
    await submitAuth("/api/auth/login", {
      email: document.getElementById("signinEmail").value.trim(),
      password: document.getElementById("signinPassword").value,
    }, authBanner);
  });

  signupForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineBanner(authBanner, "Creating your account...", false);
    await submitAuth("/api/auth/signup", {
      name: document.getElementById("signupName").value.trim(),
      email: document.getElementById("signupEmail").value.trim(),
      password: document.getElementById("signupPassword").value,
    }, authBanner);
  });

  forgotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInlineBanner(authBanner, "Sending reset link...", false);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: document.getElementById("forgotEmail").value.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setInlineBanner(authBanner, payload.error || "Could not generate reset link.", true);
        return;
      }
      setInlineBanner(authBanner, payload.delivery === "link" && payload.resetUrl ? `Email is not configured yet. Use this reset link: ${payload.resetUrl}` : (payload.message || "Password reset link sent to your email."), false);
    } catch (error) {
      setInlineBanner(authBanner, error.message, true);
    }
  });

  if (resetForm && token) {
    setInlineBanner(authBanner, "Enter a new password to finish resetting your account.", false);
    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setInlineBanner(authBanner, "Resetting password...", false);
      try {
        const response = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            password: document.getElementById("resetPassword").value,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setInlineBanner(authBanner, payload.error || "Could not reset password.", true);
          return;
        }
        setInlineBanner(authBanner, `${payload.message} Go back to sign in.`, false);
      } catch (error) {
        setInlineBanner(authBanner, error.message, true);
      }
    });
  }

  if (isVerify && token) {
    verifyEmailToken(token, authBanner);
  }

  bindPasswordToggles();
}
async function submitAuth(url, payload, banner) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      setInlineBanner(banner, data.error || "Authentication failed.", true);
      return;
    }

    currentUser = data.user;
    settingsCache = normalizeSettings(data.settings || settingsCache);
    billingCache = data.billing || billingCache;
    try {
      if (data.verificationMessage) {
        sessionStorage.setItem("postSignupVerificationMessage", data.verificationMessage);
      }
      if (data.verificationDelivery) {
        sessionStorage.setItem("postSignupVerificationDelivery", data.verificationDelivery);
      }
      if (data.verificationUrl) {
        sessionStorage.setItem("postSignupVerificationUrl", data.verificationUrl);
      }
    } catch {
      // Ignore storage failures and continue the login flow.
    }
    window.location.href = "/home";
  } catch (error) {
    setInlineBanner(banner, error.message, true);
  }
}

async function verifyEmailToken(token, banner) {
  setInlineBanner(banner, "Verifying your email...", false);
  try {
    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setInlineBanner(banner, payload.error || "Could not verify email.", true);
      return;
    }
    setInlineBanner(banner, `${payload.message} You can sign in now.`, false);
  } catch (error) {
    setInlineBanner(banner, error.message, true);
  }
}

function bindVerificationAction() {
  const button = document.getElementById("sendVerificationButton");
  const notice = document.getElementById("verificationNotice");

  if (!button || !notice || currentUser.emailVerified) {
    return;
  }

  button.addEventListener("click", async () => {
    setInlineBanner(notice, "Generating verification link...", false);
    try {
      const response = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentUser.email }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setInlineBanner(notice, payload.error || "Could not generate verification link.", true);
        return;
      }
      setInlineBanner(notice, payload.delivery === "link" && payload.verificationUrl ? `Email is not configured yet. Use this verification link: ${payload.verificationUrl}` : payload.message, false);
    } catch (error) {
      setInlineBanner(notice, error.message, true);
    }
  });
}

function renderHomePage() {
  const activeDomain = escapeHtml(settingsCache.defaultDomain);
  const trialDaysLeft = Math.max(0, Math.ceil((billingCache.trialRemainingMs || 0) / (1000 * 60 * 60 * 24)));
  mainContent.innerHTML = `
    <section class="clean-home-shell">
      <article class="surface-card clean-create-card">
        <div class="clean-create-head">
          <div>
            <h2>New short link</h2>
            <p>Active domain: <strong>${activeDomain}</strong></p>
          </div>
          <div class="clean-home-badges">
            <span class="chip-link">${settingsCache.domains.length} domain${settingsCache.domains.length === 1 ? "" : "s"}</span>
            <span class="chip-link">${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left</span>
          </div>
        </div>
        <div class="clean-create-grid">
          <div class="input-stack full-span"><label for="destination" class="field-label">Destination URL</label><input id="destination" class="url-input" type="url" placeholder="https://example.com/my-long-url"></div>
          <div class="input-stack"><label for="slug" class="field-label">Custom slug</label><input id="slug" class="url-input" type="text" placeholder="offer-2026"></div>
          <div class="inline-note clean-preview-note">Preview:<strong id="shortBaseLabel">${escapeHtml(buildShortPreview("your-slug"))}</strong></div>
          <label class="checkbox-row clean-checkbox"><input type="checkbox" id="qrToggle"><span>Generate QR-ready link</span></label>
          <button class="primary-action clean-create-button" id="createLinkButton">Create link</button>
        </div>
        <div class="result-banner hidden" id="resultBanner" aria-live="polite"></div>
        ${currentUser.emailVerified ? "" : '<div class="result-banner" id="verificationNotice">Email not verified. <button class="auth-inline-link" type="button" id="sendVerificationButton">Generate verification link</button></div>'}
      </article>
      <article class="mini-card clean-recent-card">
        <div class="mini-card-header"><h3>Recent links</h3><a href="/links">Open library</a></div>
        <div class="links-list" id="homeLinksList">${renderLinkItems(linksCache.slice(0, 3), true)}</div>
      </article>
      <details class="surface-card clean-more-card">
        <summary>More details</summary>
        <div class="clean-more-grid">
          <div class="domain-stack">${settingsCache.domains.slice(0, 4).map((domain) => `<div class="domain-pill ${domain === settingsCache.defaultDomain ? "active" : ""}"><strong>${escapeHtml(domain)}</strong><span>${domain === settingsCache.defaultDomain ? "Active" : "Ready"}</span></div>`).join("")}</div>
          <div class="clean-quick-links">
            <a class="aside-pill" href="/custom-domains">Manage domains</a>
            <a class="aside-pill" href="/links">All links</a>
            <a class="aside-pill" href="/analytics">Analytics</a>
          </div>
        </div>
      </details>
    </section>
  `;
  wireCreateForm();
  bindVerificationAction();
  try {
    const verificationMessage = sessionStorage.getItem("postSignupVerificationMessage");
    const verificationDelivery = sessionStorage.getItem("postSignupVerificationDelivery");
    const verificationUrl = sessionStorage.getItem("postSignupVerificationUrl");
    if (verificationMessage || verificationUrl) {
      showGlobalMessage(
        verificationDelivery === "link" && verificationUrl
          ? `${verificationMessage || "Verification link ready."} ${verificationUrl}`
          : (verificationMessage || "Verification email sent to your inbox."),
        false
      );
      sessionStorage.removeItem("postSignupVerificationMessage");
      sessionStorage.removeItem("postSignupVerificationDelivery");
      sessionStorage.removeItem("postSignupVerificationUrl");
    }
  } catch {
    // Ignore storage access issues.
  }
  wireLinkActions();
}

function renderLinksPage(links, query = "") {
  const filtered = links.filter((link) => !query || [link.slug, link.destination, link.shortUrl].some((value) => String(value).toLowerCase().includes(query)));
  mainContent.innerHTML = `
    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>Your short links</h2>
          <p>Only links created inside your account appear here.</p>
        </div>
        <a class="chip-link" href="/home">Create another</a>
      </div>
      <div class="goal-grid">
        ${filtered.length ? filtered.map((link) => {
          const { goal, clicks, progress, achieved } = getGoalStatus(link);
          const rule = getLinkRule(link.slug);
          return `
            <article class="goal-card">
              <div class="goal-card-head">
                <div>
                  <strong>${escapeHtml(link.slug)}</strong>
                  <p>${escapeHtml(getLinkUrl(link))}</p>
                </div>
                <span class="chip-link ${achieved ? "success" : ""}">${achieved ? "Goal hit" : `${clicks} clicks`}</span>
              </div>
              <div class="goal-progress">
                <div class="goal-progress-bar"><span style="width:${progress}%"></span></div>
                <span>${goal ? (achieved ? `${clicks} of ${goal} reached` : `${progress}% of ${goal}`) : "No goal set"}</span>
              </div>
              <div class="goal-action-row">
                <input class="url-input goal-input" type="number" min="1" step="1" value="${goal || ""}" placeholder="Target clicks" data-goal-input="${escapeHtml(link.slug)}">
                <button class="link-button" type="button" data-save-goal="${escapeHtml(link.slug)}">Save goal</button>
                ${goal ? `<button class="link-button secondary" type="button" data-clear-goal="${escapeHtml(link.slug)}">Clear</button>` : ""}
              </div>
              <div class="goal-action-row">
                <input class="url-input goal-input" type="date" value="${escapeHtml(rule.expiresAt || "")}" data-expiry-input="${escapeHtml(link.slug)}">
                <label class="field-toggle compact-toggle"><input type="checkbox" data-pause-input="${escapeHtml(link.slug)}" ${rule.isPaused ? "checked" : ""}><span>Pause link</span></label>
                <label class="field-toggle compact-toggle"><input type="checkbox" data-onetime-input="${escapeHtml(link.slug)}" ${rule.isOneTime ? "checked" : ""}><span>One-time</span></label>
                <button class="link-button secondary" type="button" data-save-rule="${escapeHtml(link.slug)}">Save rule</button>
              </div>
              ${rule.isOneTime && rule.oneTimeUsedAt ? `<div class="helper-copy">Used on ${escapeHtml(new Date(rule.oneTimeUsedAt).toLocaleString())}</div>` : ""}
              <div class="goal-action-row">
                <input class="url-input password-rule-input" type="text" placeholder="${rule.isProtected ? "Change password" : "Protect with password"}" data-password-input="${escapeHtml(link.slug)}">
                <button class="link-button secondary" type="button" data-save-password="${escapeHtml(link.slug)}">${rule.isProtected ? "Update password" : "Set password"}</button>
                ${rule.isProtected ? `<button class="link-button danger" type="button" data-clear-password="${escapeHtml(link.slug)}">Remove password</button>` : ""}
              </div>
            </article>
          `;
        }).join("") : '<div class="empty-state">No links yet. Create your first short link to start setting goals.</div>'}
      </div>
      <div class="links-list">${renderLinkItems(filtered, true)}</div>
    </section>
  `;
  wireLinkActions();
  bindGoalActions();
}

function renderQrPage() {
  const sample = getSelectedQrLink();
  const qrTargetUrl = sample ? getLinkUrl(sample) : "";
  const qrImageUrl = sample ? buildQrImageUrl(qrTargetUrl) : "";

  mainContent.innerHTML = `
    <section class="surface-card two-column">
      <div>
        <div class="surface-header"><div><h2>QR Code workspace</h2><p>Generate scannable QR codes for links inside your private account.</p></div></div>
        <div class="qr-panel">
          <div class="qr-box">${sample ? `<img class="qr-image" src="${escapeHtml(qrImageUrl)}" alt="QR code for ${escapeHtml(qrTargetUrl)}">` : `<div class="qr-grid"></div>`}</div>
          <div class="qr-copy">
            <strong>${sample ? escapeHtml(qrTargetUrl) : "Create a link first"}</strong>
            <p>${sample ? "Use this QR in posters, packaging, menus, business cards, or flyers." : "Once you create a link on Home, it can appear here as a QR-ready item."}</p>
            <div class="qr-action-row">
              ${sample ? `<a class="primary-action inline-action" href="${escapeHtml(qrImageUrl)}" target="_blank" rel="noreferrer">Open QR</a><a class="link-button secondary qr-download" href="${escapeHtml(qrImageUrl)}" download="anylink-${escapeHtml(sample.slug)}-qr.png">Download</a>` : `<a class="primary-action inline-action" href="/home">Create link</a>`}
            </div>
          </div>
        </div>
      </div>
      <div class="stack-card-group"><article class="mini-card inset-card"><h3>Your QR-ready links</h3><div class="qr-link-list">${renderQrLinkItems()}</div></article></div>
    </section>
  `;

  document.querySelectorAll("[data-select-qr]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedQrSlug = button.getAttribute("data-select-qr");
      renderQrPage();
    });
  });
}

function renderPagesBuilder() {
  const selectedPage = getSelectedForm();
  const draft = selectedPage || createEmptyFormDraft();
  const totalSubmissions = pagesCache.reduce((sum, page) => sum + (page.submissionCount || 0), 0);

  mainContent.innerHTML = `
    <section class="stat-grid">
      <article class="stat-card"><span>Total forms</span><strong>${pagesCache.length}</strong></article>
      <article class="stat-card"><span>Total submissions</span><strong>${totalSubmissions}</strong></article>
      <article class="stat-card"><span>Live form domain</span><strong>${escapeHtml(publicShortDomain)}</strong></article>
    </section>
    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>Form builder</h2>
          <p>Create lead capture forms, share the public link, and collect every response in one place.</p>
        </div>
        <button class="link-button" id="newFormButton" type="button">New form</button>
      </div>
      <div class="builder-grid">
        <div class="form-card">
          <input id="formId" type="hidden" value="${escapeHtml(draft.id || "")}">
          <label class="field-label" for="formTitle">Form name</label>
          <input id="formTitle" class="url-input" type="text" value="${escapeHtml(draft.title)}" placeholder="Lead capture form">
          <label class="field-label" for="formSlug">Public slug</label>
          <input id="formSlug" class="url-input" type="text" value="${escapeHtml(draft.slug)}" placeholder="lead-capture">
          <label class="field-label" for="formHeadline">Headline</label>
          <input id="formHeadline" class="url-input" type="text" value="${escapeHtml(draft.headline)}" placeholder="Let us know what you need">
          <label class="field-label" for="formDescription">Description</label>
          <textarea id="formDescription" class="url-input textarea-input" rows="4" placeholder="Short message under the headline">${escapeHtml(draft.description)}</textarea>
          <label class="field-label" for="formSubmitLabel">Submit button label</label>
          <input id="formSubmitLabel" class="url-input" type="text" value="${escapeHtml(draft.submitLabel)}" placeholder="Submit">
          <label class="field-label" for="formThanksMessage">Thank-you message</label>
          <textarea id="formThanksMessage" class="url-input textarea-input" rows="3" placeholder="Thanks, your response has been received.">${escapeHtml(draft.thanksMessage)}</textarea>
          <div class="form-field-toggle-group">
            ${renderFieldToggle("name", "Full name", draft.fields.name)}
            ${renderFieldToggle("email", "Email address", draft.fields.email)}
            ${renderFieldToggle("phone", "Phone number", draft.fields.phone)}
            ${renderFieldToggle("company", "Company", draft.fields.company)}
            ${renderFieldToggle("message", "Message", draft.fields.message)}
          </div>
          <div class="form-builder-actions">
            <button class="primary-action inline-action" id="saveFormButton" type="button">${draft.id ? "Update form" : "Create form"}</button>
            ${draft.id ? '<button class="link-button danger" id="deleteCurrentFormButton" type="button">Delete</button>' : ""}
          </div>
        </div>
        <div class="stack-card-group">
          <article class="preview-card">
            <span class="eyebrow">Live preview</span>
            <h3>${escapeHtml(draft.headline || "Your form headline")}</h3>
            <p>${escapeHtml(draft.description || "This is how your public form will feel to visitors before they submit their details.")}</p>
            <div class="dns-helper-grid">
              <span><strong>Public link</strong>${escapeHtml(getPublicFormUrl(draft.slug || "your-form"))}</span>
              <span><strong>Responses</strong>${draft.submissionCount || 0}</span>
              <span><strong>Submit CTA</strong>${escapeHtml(draft.submitLabel || "Submit")}</span>
            </div>
            <div class="managed-domain-actions">
              <button class="link-button secondary" id="copyFormLinkButton" type="button">Copy link</button>
              <a class="link-button secondary" href="${escapeHtml(getPublicFormUrl(draft.slug || "your-form"))}" target="_blank" rel="noreferrer">Open form</a>
            </div>
          </article>
          <article class="mini-card inset-card">
            <div class="surface-header">
              <div>
                <h3>Your forms</h3>
                <p>Click any form to edit it or review submissions.</p>
              </div>
            </div>
            <div class="form-library">
              ${pagesCache.length ? pagesCache.map((page) => `
                <button class="form-library-item ${page.id === draft.id ? "active" : ""}" data-edit-form="${escapeHtml(page.id)}" type="button">
                  <strong>${escapeHtml(page.title)}</strong>
                  <span>${escapeHtml(page.publicUrl)}</span>
                  <em>${page.submissionCount || 0} submission${page.submissionCount === 1 ? "" : "s"}</em>
                </button>
              `).join("") : '<div class="empty-state">No forms yet. Build your first form on the left.</div>'}
            </div>
          </article>
        </div>
      </div>
    </section>
    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>Submissions</h2>
          <p>${draft.id ? `Latest responses for ${escapeHtml(draft.title)}.` : "Create a form to start collecting submissions."}</p>
        </div>
        ${draft.id ? '<button class="link-button secondary" id="exportResponsesButton" type="button">Export Excel</button>' : ""}
      </div>
      ${draft.id ? renderFormSubmissions(draft.submissions || []) : '<div class="empty-state">No form selected yet.</div>'}
    </section>
  `;

  document.getElementById("newFormButton").addEventListener("click", () => {
    selectedFormId = "";
    renderPagesBuilder();
  });

  document.getElementById("copyFormLinkButton").addEventListener("click", async () => {
    const url = getPublicFormUrl(draft.slug || "your-form");
    try {
      await navigator.clipboard.writeText(url);
      showGlobalMessage(`Copied form link: ${url}`, false);
    } catch {
      showGlobalMessage(`Copy failed. Open this link manually: ${url}`, true);
    }
  });

  document.getElementById("saveFormButton").addEventListener("click", async () => {
    await saveFormFromBuilder();
  });

  document.querySelectorAll("[data-edit-form]").forEach((button) => button.addEventListener("click", () => {
    selectedFormId = button.getAttribute("data-edit-form");
    renderPagesBuilder();
  }));

  const deleteButton = document.getElementById("deleteCurrentFormButton");
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      await deleteForm(draft.id);
    });
  }

  const exportResponsesButton = document.getElementById("exportResponsesButton");
  if (exportResponsesButton) {
    exportResponsesButton.addEventListener("click", () => {
      window.location.href = `/api/pages/${encodeURIComponent(draft.id)}/export`;
    });
  }
}

function createEmptyFormDraft() {
  return {
    id: "",
    title: "",
    slug: "",
    headline: "",
    description: "",
    submitLabel: "Submit",
    thanksMessage: "Thanks, your response has been received.",
    publicUrl: getPublicFormUrl("your-form"),
    submissionCount: 0,
    submissions: [],
    fields: {
      name: true,
      email: true,
      phone: false,
      company: false,
      message: true,
    },
  };
}

function getSelectedForm() {
  return pagesCache.find((page) => page.id === selectedFormId) || null;
}

function renderFieldToggle(key, label, checked) {
  return `
    <label class="field-toggle">
      <input type="checkbox" data-form-field="${escapeHtml(key)}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function getPublicFormUrl(slug) {
  const cleanSlug = sanitizeSlug(slug || "your-form");
  const protocol = window.location.protocol === "http:" && window.location.hostname.includes("localhost") ? "http" : "https";
  return `${protocol}://${publicShortDomain}/forms/${cleanSlug}`;
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function saveFormFromBuilder() {
  const id = document.getElementById("formId").value.trim();
  const title = document.getElementById("formTitle").value.trim();
  const slug = sanitizeSlug(document.getElementById("formSlug").value.trim() || title);
  const headline = document.getElementById("formHeadline").value.trim();
  const description = document.getElementById("formDescription").value.trim();
  const submitLabel = document.getElementById("formSubmitLabel").value.trim();
  const thanksMessage = document.getElementById("formThanksMessage").value.trim();
  const fields = Object.fromEntries(
    [...document.querySelectorAll("[data-form-field]")].map((input) => [input.getAttribute("data-form-field"), input.checked]),
  );

  if (!title) return showGlobalMessage("Form name is required.", true);
  if (!slug) return showGlobalMessage("Public slug is required.", true);

  try {
    const response = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title, slug, headline, description, submitLabel, thanksMessage, fields }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to save form.");
    await loadPages();
    selectedFormId = payload.page.id;
    renderPagesBuilder();
    showGlobalMessage(id ? "Form updated successfully." : "Form created successfully.", false);
  } catch (error) {
    showGlobalMessage(error.message, true);
  }
}

async function deleteForm(pageId) {
  try {
    const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to delete form.");
    selectedFormId = "";
    await loadPages();
    renderPagesBuilder();
    showGlobalMessage("Form deleted successfully.", false);
  } catch (error) {
    showGlobalMessage(error.message, true);
  }
}

function renderFormSubmissions(submissions) {
  if (!submissions.length) {
    return '<div class="empty-state">No submissions yet. Share the public form link and new responses will appear here.</div>';
  }

  return `
    <div class="form-submission-list">
      ${submissions.map((submission) => `
        <article class="mini-card inset-card submission-card">
          <div class="surface-header">
            <div>
              <h3>${escapeHtml(new Date(submission.submittedAt).toLocaleString())}</h3>
              <p>${escapeHtml(submission.meta?.city || "Unknown city")}, ${escapeHtml(submission.meta?.country || "Unknown country")} • ${escapeHtml(submission.meta?.device || "Web")} • ${escapeHtml(submission.meta?.browser || "Unknown browser")}</p>
            </div>
            <span class="chip-link">${escapeHtml(submission.meta?.ip || "Unknown IP")}</span>
          </div>
          <div class="submission-answer-grid">
            ${Object.entries(submission.answers || {}).map(([key, value]) => `
              <div class="submission-answer">
                <strong>${escapeHtml(formatFieldLabel(key))}</strong>
                <span>${escapeHtml(value || "-")}</span>
              </div>
            `).join("")}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function formatFieldLabel(key) {
  return String(key || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (match) => match.toUpperCase());
}

async function renderAnalyticsPage() {
  mainContent.innerHTML = `<section class="surface-card"><p>Loading analytics...</p></section>`;

  try {
    const analytics = await loadAnalytics();
    const avgClicksPerLink = analytics.totalLinks ? (analytics.totalClicks / analytics.totalLinks).toFixed(1) : "0.0";
    const topCountry = analytics.topCountries?.[0]?.label || "No traffic yet";
    const topDevice = analytics.topDevices?.[0]?.label || "No traffic yet";
    const topBrowser = analytics.topBrowsers?.[0]?.label || "No traffic yet";
    const activeDomain = settingsCache.defaultDomain || publicShortDomain;
    const countriesReached = analytics.topCountries?.length || 0;
    const devicesSeen = analytics.topDevices?.length || 0;
    const bestLink = analytics.links?.[0] || null;
    analyticsCustomStart = analytics.customStart || analyticsCustomStart;
    analyticsCustomEnd = analytics.customEnd || analyticsCustomEnd;
    const repeatClicks = Math.max(0, analytics.repeatClicks || (analytics.totalClicks - (analytics.uniqueClicks || 0)));
    const bestLinkMarkup = bestLink
      ? `<strong>${escapeHtml(bestLink.slug)}</strong><p>${bestLink.totalClicks} clicks on <a href="${escapeHtml(bestLink.shortUrl)}" target="_blank" rel="noreferrer">${escapeHtml(bestLink.shortUrl)}</a></p>`
      : `<strong>No traffic yet</strong><p>Create and share a short link to start collecting performance data.</p>`;

    mainContent.innerHTML = `
      <section class="surface-card analytics-overview-card">
        <div class="surface-header analytics-overview-header">
          <div>
            <p class="eyebrow">Performance dashboard</p>
            <h2>Traffic command center</h2>
            <p>Track your strongest links, leading geographies, devices, and the latest visits from one clean analytics view.</p>
          </div>
          <div class="analytics-top-actions">
            <label class="analytics-filter-control" for="analyticsRangeFilter">
              <span>Range</span>
              <select id="analyticsRangeFilter" class="url-input analytics-range-select">
                <option value="today" ${analytics.appliedRange === "today" ? "selected" : ""}>Today</option>
                <option value="7d" ${analytics.appliedRange === "7d" ? "selected" : ""}>Last 7 days</option>
                <option value="30d" ${analytics.appliedRange === "30d" ? "selected" : ""}>Last 30 days</option>
                <option value="all" ${analytics.appliedRange === "all" ? "selected" : ""}>All time</option>
                <option value="custom" ${analytics.appliedRange === "custom" ? "selected" : ""}>Custom</option>
              </select>
            </label>
            <label class="analytics-filter-control analytics-date-control" for="analyticsCustomStart">
              <span>Start date</span>
              <input id="analyticsCustomStart" class="url-input analytics-range-select" type="date" value="${escapeHtml(analytics.customStart || "")}" ${analytics.appliedRange === "custom" ? "" : "disabled"}>
            </label>
            <label class="analytics-filter-control analytics-date-control" for="analyticsCustomEnd">
              <span>End date</span>
              <input id="analyticsCustomEnd" class="url-input analytics-range-select" type="date" value="${escapeHtml(analytics.customEnd || "")}" ${analytics.appliedRange === "custom" ? "" : "disabled"}>
            </label>
            <span class="analytics-chip">Live domain: ${escapeHtml(activeDomain)}</span>
            <button class="link-button secondary" id="exportAnalyticsButton" type="button">Export Excel</button>
          </div>
        </div>

        <div class="analytics-kpi-grid">
          <article class="analytics-kpi-card featured">
            <span>Total clicks</span>
            <strong>${analytics.totalClicks}</strong>
            <p>${analytics.totalLinks} tracked short links are contributing to your traffic in ${escapeHtml(analytics.appliedRangeLabel || "this range")}.</p>
          </article>
          <article class="analytics-kpi-card">
            <span>Unique visitors</span>
            <strong>${analytics.uniqueClicks || 0}</strong>
            <p>Estimated distinct visitors for the selected analytics range.</p>
          </article>
          <article class="analytics-kpi-card">
            <span>Repeat visits</span>
            <strong>${repeatClicks}</strong>
            <p>Returning traffic measured after unique visitors are removed from total clicks.</p>
          </article>
          <article class="analytics-kpi-card">
            <span>Countries reached</span>
            <strong>${countriesReached}</strong>
            <p>${escapeHtml(topCountry)} is currently your strongest traffic market.</p>
          </article>
          <article class="analytics-kpi-card">
            <span>Devices seen</span>
            <strong>${devicesSeen}</strong>
            <p>${escapeHtml(topDevice)} users are leading your click volume right now.</p>
          </article>
        </div>

        <div class="analytics-spotlight-grid">
          <article class="mini-card inset-card analytics-spotlight-card">
            <span class="analytics-kicker">Top country</span>
            <strong>${escapeHtml(topCountry)}</strong>
            <p>${analytics.topCountries?.[0]?.count || 0} clicks are coming from your strongest region.</p>
          </article>
          <article class="mini-card inset-card analytics-spotlight-card">
            <span class="analytics-kicker">Top browser</span>
            <strong>${escapeHtml(topBrowser)}</strong>
            <p>${analytics.topBrowsers?.[0]?.count || 0} tracked visits are using this browser.</p>
          </article>
          <article class="mini-card inset-card analytics-spotlight-card wide">
            <span class="analytics-kicker">Top performing link</span>
            ${bestLinkMarkup}
          </article>
        </div>
      </section>

      <section class="analytics-dual-grid analytics-comparison-grid">
        <article class="surface-card analytics-panel-card">
          <div class="surface-header compact"><div><h2>Visitor split</h2><p>See how much of your traffic is new versus repeat activity.</p></div></div>
          ${renderVisitorSplit(analytics.uniqueClicks || 0, repeatClicks)}
        </article>

        <article class="surface-card analytics-panel-card">
          <div class="surface-header compact"><div><h2>Country comparison</h2><p>Top countries ranked against your total click volume.</p></div></div>
          <div class="analytics-list comparison-list">${renderComparisonRows(analytics.topCountries, analytics.totalClicks)}</div>
        </article>

        <article class="surface-card analytics-panel-card">
          <div class="surface-header compact"><div><h2>Device comparison</h2><p>Compare traffic share across mobile, desktop, and other device groups.</p></div></div>
          <div class="analytics-list comparison-list">${renderComparisonRows(analytics.topDevices, analytics.totalClicks)}</div>
        </article>
      </section>

      <section class="analytics-dual-grid">
        <article class="surface-card analytics-panel-card">
          <div class="surface-header compact"><div><h2>Traffic distribution</h2><p>Countries and devices contributing the most clicks.</p></div></div>
          <div class="analytics-split-grid">
            <div>
              <strong class="analytics-section-title">Country mix</strong>
              <div class="chart-bars compact-chart">${renderAnalyticsBars(analytics.topCountries)}</div>
            </div>
            <div>
              <strong class="analytics-section-title">Device split</strong>
              <div class="chart-bars compact-chart">${renderAnalyticsBars(analytics.topDevices)}</div>
            </div>
          </div>
        </article>

        <article class="surface-card analytics-panel-card">
          <div class="surface-header compact"><div><h2>Audience details</h2><p>Cities, browsers, and platforms behind your traffic.</p></div></div>
          <div class="analytics-stacked-lists">
            <div>
              <strong class="analytics-section-title">Top cities</strong>
              <div class="analytics-list compact-list">${renderAnalyticsBadges(analytics.topCities)}</div>
            </div>
            <div>
              <strong class="analytics-section-title">Browsers</strong>
              <div class="analytics-list compact-list">${renderAnalyticsBadges(analytics.topBrowsers)}</div>
            </div>
            <div>
              <strong class="analytics-section-title">Platforms</strong>
              <div class="analytics-list compact-list">${renderAnalyticsBadges(analytics.topPlatforms)}</div>
            </div>
            <div>
              <strong class="analytics-section-title">Referrers</strong>
              <div class="analytics-list compact-list">${renderAnalyticsBadges(analytics.topReferrers)}</div>
            </div>
          </div>
        </article>
      </section>

      <section class="surface-card analytics-panel-card">
        <div class="surface-header compact"><div><h2>Top links chart</h2><p>Quick visual ranking of the links driving the most traffic in the selected range.</p></div></div>
        <div class="chart-bars compact-chart">${renderTopLinkBars(analytics.links)}</div>
      </section>

      <section class="surface-card analytics-panel-card">
        <div class="surface-header compact"><div><h2>Recent clicks</h2><p>Latest visits with time, device, location, referrer, and IP visibility.</p></div></div>
        <div class="admin-table analytics-recent-table">${renderClickRows(analytics.recentClicks, false)}</div>
      </section>

      <section class="surface-card analytics-panel-card">
        <div class="surface-header compact"><div><h2>Link performance leaderboard</h2><p>Rank your short links by traffic and inspect the audience mix for each one.</p></div></div>
        <div class="analytics-report-grid leaderboard-grid">
          ${analytics.links.length ? analytics.links.map((link, index) => `
            <article class="mini-card inset-card analytics-report-card leaderboard-card">
              <div class="analytics-report-topline">
                <span class="analytics-rank">#${index + 1}</span>
                <div>
                  <h3>${escapeHtml(link.slug)}</h3>
                  <p><a href="${escapeHtml(link.shortUrl)}" target="_blank" rel="noreferrer">${escapeHtml(link.shortUrl)}</a></p>
                </div>
                <span class="chip-link">${link.totalClicks} clicks · ${link.uniqueClicks || 0} unique · ${link.repeatClicks || 0} repeat</span>
              </div>
              <div class="analytics-summary-strip">
                <span class="analytics-tag strong">${escapeHtml(link.topCountries?.[0]?.label || "No country data")}</span>
                <span class="analytics-tag strong">${escapeHtml(link.topDevices?.[0]?.label || "No device data")}</span>
                <span class="analytics-tag strong">${escapeHtml(link.topBrowsers?.[0]?.label || "No browser data")}</span>
                <span class="analytics-tag strong">${escapeHtml(link.topReferrers?.[0]?.label || "Direct")}</span>
                ${buildGoalMarkup(link)}
              </div>
              <div class="analytics-meta-grid compact-meta-grid">
                <div><strong>Countries</strong><div class="analytics-list compact-list">${renderAnalyticsBadges(link.topCountries)}</div></div>
                <div><strong>Devices</strong><div class="analytics-list compact-list">${renderAnalyticsBadges(link.topDevices)}</div></div>
                <div><strong>Cities</strong><div class="analytics-list compact-list">${renderAnalyticsBadges(link.topCities)}</div></div>
                <div><strong>Browsers</strong><div class="analytics-list compact-list">${renderAnalyticsBadges(link.topBrowsers)}</div></div>
                <div><strong>Referrers</strong><div class="analytics-list compact-list">${renderAnalyticsBadges(link.topReferrers)}</div></div>
              </div>
              <div class="admin-table analytics-click-table">${renderClickRows(link.recentClicks, true)}</div>
            </article>
          `).join("") : '<div class="empty-state">No analytics yet. Share a short link and visits will appear here.</div>'}
        </div>
      </section>
    `;

    const exportAnalyticsButton = document.getElementById("exportAnalyticsButton");
    if (exportAnalyticsButton) {
      exportAnalyticsButton.addEventListener("click", () => {
        const customQuery = analyticsRange === "custom"
          ? `&start=${encodeURIComponent(analyticsCustomStart || "")}&end=${encodeURIComponent(analyticsCustomEnd || "")}`
          : "";
        window.location.href = `/api/analytics/export?range=${encodeURIComponent(analyticsRange)}${customQuery}`;
      });
    }

    const analyticsRangeFilter = document.getElementById("analyticsRangeFilter");
    if (analyticsRangeFilter) {
      analyticsRangeFilter.addEventListener("change", async (event) => {
        analyticsRange = event.target.value || "30d";
        const startInput = document.getElementById("analyticsCustomStart");
        const endInput = document.getElementById("analyticsCustomEnd");
        if (startInput) startInput.disabled = analyticsRange !== "custom";
        if (endInput) endInput.disabled = analyticsRange !== "custom";
        await renderAnalyticsPage();
      });
    }

    const analyticsCustomStartInput = document.getElementById("analyticsCustomStart");
    const analyticsCustomEndInput = document.getElementById("analyticsCustomEnd");
    const applyCustomRange = async () => {
      analyticsCustomStart = analyticsCustomStartInput?.value || "";
      analyticsCustomEnd = analyticsCustomEndInput?.value || "";
      analyticsRange = "custom";
      const filter = document.getElementById("analyticsRangeFilter");
      if (filter) filter.value = "custom";
      await renderAnalyticsPage();
    };

    if (analyticsCustomStartInput) {
      analyticsCustomStartInput.addEventListener("change", applyCustomRange);
    }

    if (analyticsCustomEndInput) {
      analyticsCustomEndInput.addEventListener("change", applyCustomRange);
    }
  } catch (error) {
    mainContent.innerHTML = `<section class="surface-card"><h2>Analytics error</h2><p>${escapeHtml(error.message)}</p></section>`;
  }
}

function renderAnalyticsBars(items) {
  if (!items || !items.length) {
    return '<div class="empty-state">No data yet.</div>';
  }

  const maxCount = Math.max(...items.map((item) => Number(item.count || 0)), 1);
  return items.slice(0, 5).map((item) => {
    const ratio = Number(item.count || 0) / maxCount;
    const height = Math.max(28, Math.round(ratio * 132));
    return `<div class="bar-wrap"><span class="bar-value">${item.count}</span><i style="height:${height}px"></i><span class="bar-label">${escapeHtml(item.label)}</span></div>`;
  }).join("");
}

function renderTopLinkBars(links) {
  if (!links || !links.length) {
    return '<div class="empty-state">No link data yet.</div>';
  }

  const maxCount = Math.max(...links.map((link) => Number(link.totalClicks || 0)), 1);
  return links.slice(0, 5).map((link) => {
    const ratio = Number(link.totalClicks || 0) / maxCount;
    const height = Math.max(28, Math.round(ratio * 132));
    return `<div class="bar-wrap"><span class="bar-value">${link.totalClicks}</span><i style="height:${height}px"></i><span class="bar-label">${escapeHtml(link.slug)}</span></div>`;
  }).join("");
}

function renderVisitorSplit(uniqueClicks, repeatClicks) {
  const total = Math.max(1, Number(uniqueClicks || 0) + Number(repeatClicks || 0));
  const uniqueWidth = Math.max(10, Math.round((Number(uniqueClicks || 0) / total) * 100));
  const repeatWidth = Math.max(10, 100 - uniqueWidth);

  return `
    <div class="visitor-split-card">
      <div class="visitor-split-bar">
        <span class="visitor-split-segment unique" style="width:${uniqueWidth}%"></span>
        <span class="visitor-split-segment repeat" style="width:${repeatWidth}%"></span>
      </div>
      <div class="visitor-split-legend">
        <div class="visitor-split-item">
          <span class="split-dot unique"></span>
          <div><strong>${uniqueClicks}</strong><span>Unique visitors</span></div>
        </div>
        <div class="visitor-split-item">
          <span class="split-dot repeat"></span>
          <div><strong>${repeatClicks}</strong><span>Repeat visits</span></div>
        </div>
      </div>
    </div>
  `;
}

function renderComparisonRows(items, total) {
  if (!items || !items.length) {
    return '<div class="empty-state">No comparison data yet.</div>';
  }

  const safeTotal = Math.max(1, Number(total || 0));
  return items.slice(0, 5).map((item) => {
    const percent = Math.max(4, Math.round((Number(item.count || 0) / safeTotal) * 100));
    return `
      <div class="comparison-row">
        <div class="comparison-head">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${item.count} clicks</span>
        </div>
        <div class="comparison-track"><i style="width:${percent}%"></i></div>
      </div>
    `;
  }).join("");
}
function renderAnalyticsBadges(items) {
  if (!items || !items.length) {
    return '<div class="empty-state">No data yet.</div>';
  }

  return items.map((item) => `<div class="analytics-pill"><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></div>`).join("");
}

function renderClickRows(clicks, compact) {
  if (!clicks || !clicks.length) {
    return '<div class="empty-state">No clicks recorded yet.</div>';
  }

  return clicks.map((click) => `
    <div class="admin-row analytics-row ${compact ? "compact" : ""}">
      <div class="admin-main">
        ${click.slug ? `<strong>${escapeHtml(click.slug)}</strong>` : ""}
        <span>${escapeHtml(new Date(click.clickedAt).toLocaleString())}</span>
        <span>${escapeHtml(click.country || "Unknown")} • ${escapeHtml(click.city || "Unknown")}</span>
        <span>${escapeHtml(click.deviceType || "Unknown")} • ${escapeHtml(click.platform || "Unknown")} • ${escapeHtml(click.browser || "Unknown")}</span>
      </div>
      <div class="admin-actions analytics-actions">
        <span class="analytics-tag">${escapeHtml(click.ip || "Unknown")}</span>
        ${click.referrer ? `<span class="analytics-tag muted">${escapeHtml(click.referrer)}</span>` : ""}
      </div>
    </div>
  `).join("");
}

function wireCreateForm() {
  const destinationInput = document.getElementById("destination");
  const slugInput = document.getElementById("slug");
  const qrToggle = document.getElementById("qrToggle");
  const resultBanner = document.getElementById("resultBanner");
  const shortBaseLabel = document.getElementById("shortBaseLabel");

  const updatePreview = () => {
    shortBaseLabel.textContent = buildShortPreview(sanitizeSlug(slugInput.value.trim()) || "your-slug");
  };

  const createLink = async () => {
    setInlineBanner(resultBanner, "Creating your AnyLink...", false);
    try {
      const response = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: destinationInput.value.trim(),
          slug: sanitizeSlug(slugInput.value.trim()),
          includeQr: qrToggle.checked,
        }),
      });
      const payload = await response.json();
      if (!response.ok) return setInlineBanner(resultBanner, payload.error || "Could not create link.", true);

      linksCache.unshift(payload.link);
      if (qrToggle.checked) selectedQrSlug = payload.link.slug;
      setInlineBanner(resultBanner, `AnyLink created: ${getLinkUrl(payload.link)}`, false);
      destinationInput.value = "";
      slugInput.value = "";
      qrToggle.checked = false;
      updatePreview();
      const list = document.getElementById("homeLinksList");
      if (list) {
        list.innerHTML = renderLinkItems(linksCache.slice(0, 3), true);
        wireLinkActions();
      }
    } catch (error) {
      setInlineBanner(resultBanner, error.message, true);
    }
  };

  document.getElementById("createLinkButton").addEventListener("click", createLink);
  destinationInput.addEventListener("keydown", (event) => event.key === "Enter" && createLink());
  slugInput.addEventListener("keydown", (event) => event.key === "Enter" && createLink());
  slugInput.addEventListener("input", updatePreview);
  updatePreview();
}

function wireLinkActions() {
  document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
    const shortUrl = button.getAttribute("data-copy");
    try {
      await navigator.clipboard.writeText(shortUrl);
      showGlobalMessage(`Copied: ${shortUrl}`, false);
    } catch {
      showGlobalMessage(`Copy failed. Open this link manually: ${shortUrl}`, true);
    }
  }));

  document.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-delete");
    try {
      const response = await fetch(`/api/links/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Delete failed");
      linksCache = linksCache.filter((item) => item.slug !== slug);
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Deleted: ${slug}`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));
}

function bindGoalActions() {
  document.querySelectorAll("[data-save-goal]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-save-goal");
    const input = document.querySelector(`[data-goal-input="${slug}"]`);
    const goal = Math.max(0, Number(input?.value || 0));

    if (!goal) {
      showGlobalMessage("Enter a valid target greater than 0.", true);
      return;
    }

    try {
      const nextGoals = {
        ...(settingsCache.conversionGoals || {}),
        [slug]: goal,
      };
      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: settingsCache.defaultDomain,
        domains: settingsCache.domains,
        conversionGoals: nextGoals,
      });
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Conversion goal saved for ${slug}.`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));

  document.querySelectorAll("[data-clear-goal]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-clear-goal");

    try {
      const nextGoals = { ...(settingsCache.conversionGoals || {}) };
      delete nextGoals[slug];
      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: settingsCache.defaultDomain,
        domains: settingsCache.domains,
        conversionGoals: nextGoals,
      });
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Conversion goal cleared for ${slug}.`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));

  document.querySelectorAll("[data-save-rule]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-save-rule");
    const expiryInput = document.querySelector(`[data-expiry-input="${slug}"]`);
    const pauseInput = document.querySelector(`[data-pause-input="${slug}"]`);
    const oneTimeInput = document.querySelector(`[data-onetime-input="${slug}"]`);
    const expiresAt = String(expiryInput?.value || "").trim();
    const isPaused = Boolean(pauseInput?.checked);
    const isOneTime = Boolean(oneTimeInput?.checked);

    try {
      const nextRules = {
        ...(settingsCache.linkRules || {}),
      };

      if (!expiresAt && !isPaused && !isOneTime) {
        delete nextRules[slug];
      } else {
        nextRules[slug] = {
          ...(settingsCache.linkRules?.[slug] || {}),
          expiresAt,
          isPaused,
          isOneTime,
          oneTimeUsedAt: isOneTime ? (settingsCache.linkRules?.[slug]?.oneTimeUsedAt || "") : "",
        };
      }

      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: settingsCache.defaultDomain,
        domains: settingsCache.domains,
        conversionGoals: settingsCache.conversionGoals,
        linkRules: nextRules,
      });
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Link rule saved for ${slug}.`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));

  document.querySelectorAll("[data-save-password]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-save-password");
    const passwordInput = document.querySelector(`[data-password-input="${slug}"]`);
    const passwordPlain = String(passwordInput?.value || "").trim();

    if (passwordPlain.length < 4) {
      showGlobalMessage("Password must be at least 4 characters.", true);
      return;
    }

    try {
      const nextRules = {
        ...(settingsCache.linkRules || {}),
        [slug]: {
          ...(settingsCache.linkRules?.[slug] || {}),
          passwordPlain,
        },
      };
      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: settingsCache.defaultDomain,
        domains: settingsCache.domains,
        conversionGoals: settingsCache.conversionGoals,
        linkRules: nextRules,
      });
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Password protection saved for ${slug}.`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));

  document.querySelectorAll("[data-clear-password]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-clear-password");

    try {
      const nextRules = {
        ...(settingsCache.linkRules || {}),
        [slug]: {
          ...(settingsCache.linkRules?.[slug] || {}),
          clearPassword: true,
        },
      };
      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: settingsCache.defaultDomain,
        domains: settingsCache.domains,
        conversionGoals: settingsCache.conversionGoals,
        linkRules: nextRules,
      });
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Password removed for ${slug}.`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));
}

function renderLinkItems(links, includeDelete) {
  if (!links.length) return '<div class="empty-state">No links yet. Create your first AnyLink above.</div>';

  return links.map((link) => {
    const createdAt = new Date(link.createdAt).toLocaleString();
    const liveUrl = getLinkUrl(link);
    return `<div class="link-item"><div class="link-copy"><a href="${escapeHtml(liveUrl)}" target="_blank" rel="noreferrer">${escapeHtml(liveUrl)}</a><strong>${escapeHtml(link.slug)}</strong><p>${escapeHtml(link.destination)}</p><p>Created: ${escapeHtml(createdAt)}</p></div><div class="link-actions"><button class="link-button" data-copy="${escapeHtml(liveUrl)}">Copy</button><a class="link-button secondary" href="${escapeHtml(liveUrl)}" target="_blank" rel="noreferrer">Open</a><a class="link-button secondary" href="/qr-codes" data-open-qr="${escapeHtml(link.slug)}">QR</a>${includeDelete ? `<button class="link-button danger" data-delete="${escapeHtml(link.slug)}">Delete</button>` : ""}</div></div>`;
  }).join("");
}

function buildShortPreview(slug) {
  return buildDomainPreview(settingsCache.defaultDomain, slug);
}

function buildLiveLinkUrl(slug) {
  return buildDomainPreview(settingsCache.defaultDomain, slug);
}

function getLinkUrl(link) {
  if (link && link.shortUrl) {
    return link.shortUrl;
  }

  return buildLiveLinkUrl(link?.slug || "");
}

function buildQrImageUrl(targetUrl) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=${encodeURIComponent(targetUrl)}`;
}

function getSelectedQrLink() {
  if (selectedQrSlug) {
    const found = linksCache.find((item) => item.slug === selectedQrSlug);
    if (found) return found;
  }
  return linksCache.find((item) => item.includeQr) || linksCache[0] || null;
}

function renderQrLinkItems() {
  if (!linksCache.length) return '<div class="empty-state">No links available yet. Create one from Home first.</div>';

  return linksCache.slice(0, 6).map((link) => `<button class="qr-link-item ${link.slug === (getSelectedQrLink()?.slug || "") ? "active" : ""}" data-select-qr="${escapeHtml(link.slug)}"><strong>${escapeHtml(link.slug)}</strong><span>${escapeHtml(getLinkUrl(link))}</span></button>`).join("");
}

function renderCampaignsPage() {
  mainContent.innerHTML = `<section class="surface-card"><div class="surface-header"><div><h2>Campaign tracker</h2><p>Keep your UTM campaigns organized in one private place.</p></div></div><div class="campaign-list"><div class="campaign-item"><strong>Summer Sale</strong><span>Email - Active</span></div><div class="campaign-item"><strong>Creator Outreach</strong><span>Social - Draft</span></div><div class="campaign-item"><strong>Retail Posters</strong><span>Offline - Active</span></div></div></section>`;
}

function renderDomainsPage() {
  const domainEntries = settingsCache.domainEntries || settingsCache.domains.map((domain) => ({
    host: domain,
    status: domain === publicShortDomain ? "APP_DEFAULT" : (domain === settingsCache.defaultDomain ? "ACTIVE" : "PENDING"),
    isActive: domain === settingsCache.defaultDomain,
    dnsTarget: publicShortDomain,
  }));

  const managedDomainsMarkup = domainEntries.map((entry) => {
    const domain = entry.host;
    const isDefaultAppDomain = domain === publicShortDomain;
    const isActive = Boolean(entry.isActive) || domain === settingsCache.defaultDomain;
    const normalizedStatus = String(entry.status || "PENDING").toUpperCase();
    const hostHint = domain.split(".")[0] || domain;
    const statusLabel = isDefaultAppDomain
      ? "App Default"
      : (isActive ? "Active" : normalizedStatus.charAt(0) + normalizedStatus.slice(1).toLowerCase());

    return `
      <div class="managed-domain ${isActive ? "active" : ""}">
        <div class="managed-domain-copy">
          <strong>${escapeHtml(domain)}</strong>
          <span>${escapeHtml(buildDomainPreview(domain))}</span>
          ${!isDefaultAppDomain ? `<div class="dns-helper-grid"><span><strong>Type</strong>CNAME</span><span><strong>Host</strong>${escapeHtml(hostHint)}</span><span><strong>Value</strong>${escapeHtml(entry.dnsTarget || publicShortDomain)}</span></div>` : ""}
        </div>
        <div class="managed-domain-actions">
          <span class="domain-status ${normalizedStatus.toLowerCase()}">${escapeHtml(statusLabel)}</span>
          ${!isDefaultAppDomain && !isActive ? `<button class="link-button" data-activate-domain="${escapeHtml(domain)}">Set active</button>` : ""}
          ${!isDefaultAppDomain ? `<button class="link-button secondary" data-copy-dns="${escapeHtml(domain)}">Copy DNS</button>` : ""}
          ${!isDefaultAppDomain && normalizedStatus !== "VERIFIED" && normalizedStatus !== "ACTIVE" ? `<button class="link-button secondary" data-verify-domain="${escapeHtml(domain)}">Mark verified</button>` : ""}
          ${!isDefaultAppDomain ? `<button class="link-button danger" data-remove-domain="${escapeHtml(domain)}">Remove</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  mainContent.innerHTML = `
    <section class="surface-card two-column">
      <div>
        <div class="surface-header">
          <div>
            <h2>Custom domains</h2>
            <p>Your app always stays on <strong>${escapeHtml(publicShortDomain)}</strong>. Users can optionally create short links from their own connected domain.</p>
          </div>
          <span class="chip-link">${settingsCache.domains.length} saved</span>
        </div>
        <div class="managed-domain-list">${managedDomainsMarkup}</div>
      </div>
      <div class="stack-card-group">
        <div class="form-card">
          <label class="field-label" for="domainName">Add a new custom domain</label>
          <input id="domainName" class="url-input" type="text" placeholder="go.yourbrand.com">
          <button class="primary-action inline-action" id="addDomainButton">Add domain</button>
          <p class="helper-copy">If no custom domain is active, new short links automatically use ${escapeHtml(publicShortDomain)}.</p>
        </div>
        <div class="form-card">
          <h3>DNS setup</h3>
          <p class="helper-copy">Create a <strong>CNAME</strong> record for your branded subdomain and point it to <strong>${escapeHtml(publicShortDomain)}</strong>.</p>
          <div class="dns-helper-grid">
            <span><strong>Type</strong>CNAME</span>
            <span><strong>Host</strong>go</span>
            <span><strong>Value</strong>${escapeHtml(publicShortDomain)}</span>
          </div>
          <p class="helper-copy">Example: <code>go.clientdomain.com -> ${escapeHtml(publicShortDomain)}</code></p>
          <p class="helper-copy">After DNS is live, click <strong>Mark verified</strong> and then set that domain active for fresh links.</p>
        </div>
      </div>
    </section>
  `;

  document.getElementById("addDomainButton").addEventListener("click", async () => {
    const domain = sanitizeDomain(document.getElementById("domainName").value.trim());
    if (!domain) return showGlobalMessage("Enter a valid domain or host.", true);
    if (settingsCache.domains.includes(domain)) return showGlobalMessage("That domain is already added.", true);
    await persistDomains([...settingsCache.domains, domain], settingsCache.defaultDomain, `Domain added: ${domain}. Next step: add the DNS CNAME and mark it verified.`);
  });

  document.querySelectorAll("[data-activate-domain]").forEach((button) => button.addEventListener("click", async () => {
    const domain = button.getAttribute("data-activate-domain");
    await persistDomains(settingsCache.domains, domain, `Active domain changed to ${domain}`);
  }));

  document.querySelectorAll("[data-remove-domain]").forEach((button) => button.addEventListener("click", async () => {
    const domain = button.getAttribute("data-remove-domain");
    const domains = settingsCache.domains.filter((item) => item !== domain);
    const nextDefault = settingsCache.defaultDomain === domain ? domains[0] : settingsCache.defaultDomain;
    await persistDomains(domains, nextDefault, `Removed domain: ${domain}`);
  }));

  document.querySelectorAll("[data-copy-dns]").forEach((button) => button.addEventListener("click", async () => {
    const domain = button.getAttribute("data-copy-dns");
    try {
      await navigator.clipboard.writeText(publicShortDomain);
      showGlobalMessage(`DNS target copied for ${domain}: ${publicShortDomain}`, false);
    } catch {
      showGlobalMessage(`Copy failed. Use this DNS target manually: ${publicShortDomain}`, true);
    }
  }));

  document.querySelectorAll("[data-verify-domain]").forEach((button) => button.addEventListener("click", async () => {
    const domain = button.getAttribute("data-verify-domain");
    await verifyDomain(domain);
  }));
}

async function persistDomains(domains, defaultDomain, successMessage) {
  try {
    await saveSettings({ workspaceName: settingsCache.workspaceName, domains, defaultDomain });
    renderDomainsPage();
    showGlobalMessage(successMessage, false);
  } catch (error) {
    showGlobalMessage(error.message, true);
  }
}

async function verifyDomain(domain) {
  try {
    const response = await fetch(`/api/domains/verify/${encodeURIComponent(domain)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to verify domain.");
    if (payload.settings) {
      settingsCache = normalizeSettings(payload.settings);
      renderDomainsPage();
    }
    const hostHint = payload.hostHint || domain.split(".")[0] || domain;
    showGlobalMessage(`${payload.message} DNS record: ${payload.recordType || "CNAME"} ${hostHint} -> ${payload.dnsTarget || publicShortDomain}`, false);
  } catch (error) {
    showGlobalMessage(error.message, true);
  }
}

function renderSettingsPage() {
  mainContent.innerHTML = `
    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>Profile and settings</h2>
          <p>Manage your personal profile, workspace identity, and default short-link domain.</p>
        </div>
      </div>
      <div class="two-column">
        <div class="stack-card-group">
          <div class="form-card">
            <h3>Profile</h3>
            <label class="field-label" for="profileNameInput">Display name</label>
            <input id="profileNameInput" class="url-input" type="text" value="${escapeHtml(currentUser.name)}">
            <label class="field-label" for="profileEmail">Email</label>
            <input id="profileEmail" class="url-input" type="text" value="${escapeHtml(currentUser.email)}" disabled>
            <div class="profile-meta">
              <span class="domain-status">${currentUser.emailVerified ? "Verified account" : "Email not verified"}</span>
              ${currentUser.isAdmin ? '<span class="domain-status admin-badge">Admin access</span>' : ""}
            </div>
            <button class="primary-action inline-action" id="saveProfileButton">Save profile</button>
          </div>
          <div class="form-card">
            <h3>Change password</h3>
            <label class="field-label" for="currentPasswordInput">Current password</label>
            <div class="password-field"><input id="currentPasswordInput" class="url-input" type="password" placeholder="Enter current password"><button class="password-toggle" type="button" data-password-toggle="currentPasswordInput">Show</button></div>
            <label class="field-label" for="newPasswordInput">New password</label>
            <div class="password-field"><input id="newPasswordInput" class="url-input" type="password" placeholder="Minimum 6 characters"><button class="password-toggle" type="button" data-password-toggle="newPasswordInput">Show</button></div>
            <label class="field-label" for="confirmPasswordInput">Confirm new password</label>
            <div class="password-field"><input id="confirmPasswordInput" class="url-input" type="password" placeholder="Re-enter new password"><button class="password-toggle" type="button" data-password-toggle="confirmPasswordInput">Show</button></div>
            <button class="primary-action inline-action" id="changePasswordButton">Update password</button>
          </div>
          <div class="form-card">
            <h3>Workspace</h3>
            <label class="field-label" for="workspaceName">Workspace name</label>
            <input id="workspaceName" class="url-input" type="text" value="${escapeHtml(settingsCache.workspaceName)}">
            <label class="field-label" for="defaultDomain">Active domain</label>
            <select id="defaultDomain" class="url-input domain-select">${settingsCache.domains.map((domain) => `<option value="${escapeHtml(domain)}" ${domain === settingsCache.defaultDomain ? "selected" : ""}>${escapeHtml(domain)}</option>`).join("")}</select>
            <button class="primary-action inline-action" id="saveSettingsButton">Save settings</button>
          </div>
        </div>
        <div class="mini-card inset-card profile-card">
          <div class="profile-card-head">
            <div class="profile-card-avatar">${escapeHtml(currentUser.name.charAt(0).toUpperCase())}</div>
            <div>
              <h3>${escapeHtml(currentUser.name)}</h3>
              <p>${escapeHtml(currentUser.email)}</p>
            </div>
          </div>
          <div class="task-list">
            <div class="task-item"><span class="task-check filled"></span><span>${currentUser.emailVerified ? "Email verified" : "Email verification pending"}</span></div>
            <div class="task-item"><span class="task-check filled"></span><span>${settingsCache.domains.length} domain${settingsCache.domains.length === 1 ? "" : "s"} connected</span></div>
            <div class="task-item"><span class="task-check filled"></span><span>Workspace: ${escapeHtml(settingsCache.workspaceName)}</span></div>
            <div class="task-item"><span class="task-check filled"></span><span>Plan: ${escapeHtml(billingCache.subscriptionStatus)}</span></div>
          </div>
        </div>
      </div>
    </section>
  `;

  document.getElementById("saveProfileButton").addEventListener("click", async () => {
    try {
      await saveProfile({
        name: document.getElementById("profileNameInput").value.trim(),
      });
      renderSettingsPage();
      showGlobalMessage("Profile updated successfully.", false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });

  document.getElementById("changePasswordButton").addEventListener("click", async () => {
    try {
      await changePassword({
        currentPassword: document.getElementById("currentPasswordInput").value,
        newPassword: document.getElementById("newPasswordInput").value,
        confirmPassword: document.getElementById("confirmPasswordInput").value,
      });
      document.getElementById("currentPasswordInput").value = "";
      document.getElementById("newPasswordInput").value = "";
      document.getElementById("confirmPasswordInput").value = "";
      showGlobalMessage("Password updated successfully.", false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });

  document.getElementById("saveSettingsButton").addEventListener("click", async () => {
    try {
      await saveSettings({
        workspaceName: document.getElementById("workspaceName").value.trim(),
        defaultDomain: document.getElementById("defaultDomain").value.trim(),
        domains: settingsCache.domains,
      });
      renderSettingsPage();
      showGlobalMessage("Settings saved successfully.", false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });

  bindPasswordToggles();
}

function buildDomainPreview(domain, slug = "sample-link") {
  const localPattern = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(domain);
  const activeHost = window.location.host;
  const activeProtocol = window.location.protocol === "http:" ? "http" : "https";
  const protocol = localPattern ? "http" : (domain === activeHost ? activeProtocol : "https");
  return `${protocol}://${domain}/${slug}`;
}

function getDefaultShortDomain() {
  const host = window.location.host;
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? host : publicShortDomain;
}

function sanitizeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function sanitizeDomain(value) {
  const cleaned = String(value || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
  return cleaned && /^[a-z0-9.-]+(?::\d+)?$/.test(cleaned) ? cleaned : null;
}

function setInlineBanner(element, message, isError) {
  element.textContent = message;
  element.classList.remove("hidden", "error");
  if (isError) element.classList.add("error");
}

function bindPasswordToggles() {
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const inputId = button.getAttribute("data-password-toggle");
      const input = document.getElementById(inputId);

      if (!input) {
        return;
      }

      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      button.textContent = shouldShow ? "Hide" : "Show";
    });
  });
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function showGlobalMessage(message, isError) {
  let banner = document.getElementById("globalBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "globalBanner";
    banner.className = "global-banner";
    document.body.appendChild(banner);
  }
  banner.textContent = message;
  banner.classList.toggle("error", Boolean(isError));
  banner.classList.add("visible");
  window.clearTimeout(showGlobalMessage.timeoutId);
  showGlobalMessage.timeoutId = window.setTimeout(() => banner.classList.remove("visible"), 2200);
}













