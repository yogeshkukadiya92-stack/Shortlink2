const body = document.body;
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const mainContent = document.getElementById("mainContent");
const pageTitle = document.getElementById("pageTitle");
const pageEyebrow = document.getElementById("pageEyebrow");
const searchInput = document.getElementById("searchInput");
const logoutButton = document.getElementById("logoutButton");
const upgradeButton = document.getElementById("upgradeButton");
const compactToggleButton = document.getElementById("compactToggleButton");
const profileName = document.querySelector(".profile-name");
const avatar = document.querySelector(".avatar");
const profileMenu = document.getElementById("profileMenu");
const profileMenuButton = document.getElementById("profileMenuButton");
const profileDropdown = document.getElementById("profileDropdown");
const profileDropdownPlan = document.getElementById("profileDropdownPlan");
const profileDropdownDates = document.getElementById("profileDropdownDates");
const profileAdminLink = document.getElementById("profileAdminLink");
const adminNavItem = document.getElementById("adminNavItem");
const mobileShellBreakpoint = 1160;
const publicShortDomain = "go.shortlinks.in";
let deferredInstallPrompt = null;
const defaultFormFieldLibrary = [
  { key: "name", label: "Full name", type: "text", required: true, enabled: true, builtIn: true, options: [] },
  { key: "email", label: "Email address", type: "email", required: true, enabled: true, builtIn: true, options: [] },
  { key: "phone", label: "Phone number", type: "tel", required: false, enabled: false, builtIn: true, options: [] },
  { key: "company", label: "Company", type: "text", required: false, enabled: false, builtIn: true, options: [] },
  { key: "message", label: "Message", type: "textarea", required: true, enabled: true, builtIn: true, options: [] },
];
const formBlockCatalog = {
  input: [
    ["text", "Short answer"],
    ["textarea", "Long answer"],
    ["radio", "Multiple choice"],
    ["checkbox", "Checkboxes"],
    ["select", "Dropdown"],
    ["multiselect", "Multi-select"],
    ["number", "Number"],
    ["email", "Email"],
    ["tel", "Phone number"],
    ["url", "Link"],
    ["file", "File upload"],
    ["date", "Date"],
    ["time", "Time"],
    ["scale", "Linear scale"],
  ],
  layout: [
    ["pagebreak", "New page"],
    ["thankyou", "Thank you page"],
    ["textblock", "Text"],
    ["heading1", "Heading 1"],
    ["heading2", "Heading 2"],
    ["heading3", "Heading 3"],
    ["divider", "Divider"],
    ["title", "Title"],
    ["label", "Label"],
  ],
  embed: [
    ["image", "Image"],
    ["video", "Video"],
    ["audio", "Audio"],
    ["embed", "Embed anything"],
  ],
};
const builtInCampaignTemplates = [
  { id: "tpl-meta-ads", name: "Meta Ads", source: "facebook", medium: "paid-social", campaign: "launch", term: "", content: "ad-a" },
  { id: "tpl-google-search", name: "Google Search", source: "google", medium: "cpc", campaign: "search", term: "brand", content: "text-a" },
  { id: "tpl-whatsapp", name: "WhatsApp Broadcast", source: "whatsapp", medium: "broadcast", campaign: "promo", term: "", content: "list-a" },
  { id: "tpl-email-newsletter", name: "Email Newsletter", source: "newsletter", medium: "email", campaign: "monthly", term: "", content: "header-cta" },
];

let currentPage = getCurrentPage();
let currentUser = null;
let linksCache = [];
let selectedLinkSlug = "";
let pagesCache = [];
let selectedQrSlug = null;
let selectedFormId = "";
let formBuilderDraftCache = null;
let analyticsRange = "30d";
let analyticsCustomStart = "";
let analyticsCustomEnd = "";
let qrCustomization = {
  foreground: "#2046d9",
  background: "#ffffff",
  logoText: "SL",
};
let selectedCampaignId = "";
let settingsCache = {
  workspaceName: "AnyLink Workspace",
  defaultDomain: getDefaultShortDomain(),
  domains: [getDefaultShortDomain()],
  domainAutomation: { provider: "godaddy", connected: false },
  conversionGoals: {},
  linkRules: {},
  linkHealth: {},
  campaignTemplates: [],
  pixelTemplates: [],
  teamMembers: [],
  trashLinks: [],
  campaigns: [],
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
let billingRefreshTimer = null;
let billingCouponState = null;
let activityHeartbeatTimer = null;
let activityPageStartedAt = Date.now();
let lastTrackedActivityPage = "";
const DOMAIN_SYNC_INTERVAL_MS = 20000;
const DOMAIN_SYNC_MAX_ATTEMPTS = 12;
const domainSyncState = {};
const uiDensityStorageKey = "anylink_ui_density";
let uiDensity = localStorage.getItem(uiDensityStorageKey) || "compact";

function updateDomainSyncState(domain, updates) {
  if (!domain) return;
  const current = domainSyncState[domain] || {};
  domainSyncState[domain] = { ...current, ...updates };
}

function clearDomainSyncTimer(domain) {
  const current = domainSyncState[domain];
  if (current && current.timerId) {
    clearTimeout(current.timerId);
    updateDomainSyncState(domain, { timerId: null });
  }
}

function scheduleDomainSync(domain) {
  clearDomainSyncTimer(domain);
  const timerId = setTimeout(() => {
    verifyDomain(domain, { autoRetry: true, silent: true });
  }, DOMAIN_SYNC_INTERVAL_MS);
  updateDomainSyncState(domain, { timerId });
}

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

document.querySelectorAll(".side-nav .nav-item, .sidebar-footer .nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    if (!isMobileShell()) {
      return;
    }
    sidebar.classList.add("collapsed");
    document.body.classList.remove("mobile-nav-open");
  });
});

sidebarToggle.addEventListener("click", () => {
  if (isMobileShell()) {
    const willOpen = sidebar.classList.contains("collapsed");
    sidebar.classList.toggle("collapsed", !willOpen);
    document.body.classList.toggle("mobile-nav-open", willOpen);
    return;
  }

  sidebar.classList.toggle("collapsed");
});

window.addEventListener("resize", syncResponsiveShell);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/auth";
});

upgradeButton.addEventListener("click", () => {
  if (!currentUser) {
    window.location.href = "/auth";
    return;
  }

  if (billingCache.hasAccess && billingCache.subscriptionStatus !== "trialing" && !currentUser.isAdmin) {
    window.location.href = "/settings";
    return;
  }

  currentPage = "billing";
  updateHeaderMeta();
  renderBillingPage();
});

compactToggleButton?.addEventListener("click", () => {
  uiDensity = uiDensity === "compact" ? "expanded" : "compact";
  localStorage.setItem(uiDensityStorageKey, uiDensity);
  applyDensityMode();
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

document.addEventListener("visibilitychange", () => {
  if (!currentUser || currentPage === "auth") {
    return;
  }

  if (document.visibilityState === "hidden") {
    sendActivityPing("background");
  } else {
    activityPageStartedAt = Date.now();
  }
});

window.addEventListener("beforeunload", () => {
  if (!currentUser || currentPage === "auth") {
    return;
  }

  const durationMs = Math.max(0, Date.now() - activityPageStartedAt);
  try {
    const payload = JSON.stringify({ page: currentPage, event: "leave", durationMs });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/activity", new Blob([payload], { type: "application/json" }));
    }
  } catch {
    // Ignore unload tracking errors.
  }
});
document.addEventListener("click", (event) => {
  const qrLink = event.target.closest("[data-open-qr]");
  if (qrLink) {
    selectedQrSlug = qrLink.getAttribute("data-open-qr");
  }

  if (
    isMobileShell()
    && !sidebar.classList.contains("collapsed")
    && !sidebar.contains(event.target)
    && !sidebarToggle.contains(event.target)
  ) {
    sidebar.classList.add("collapsed");
    document.body.classList.remove("mobile-nav-open");
  }

  if (profileMenu && !profileMenu.contains(event.target)) {
    profileDropdown.classList.add("hidden");
    profileMenuButton.setAttribute("aria-expanded", "false");
  }
});

initialize();

async function initialize() {
  registerServiceWorker();
  syncResponsiveShell();
  applyDensityMode();
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
          trashLinks: [],
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }, { once: true });
}

function syncResponsiveShell() {
  if (isMobileShell()) {
    document.body.classList.add("mobile-shell");
    sidebar.classList.add("collapsed");
    document.body.classList.remove("mobile-nav-open");
  } else {
    document.body.classList.remove("mobile-shell", "mobile-nav-open");
    sidebar.classList.remove("collapsed");
  }
}

function applyDensityMode() {
  body.classList.toggle("compact-ui", uiDensity === "compact");
  if (!compactToggleButton) return;
  compactToggleButton.textContent = uiDensity === "compact" ? "Show details" : "Compact view";
}

function isMobileShell() {
  return window.innerWidth <= mobileShellBreakpoint;
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
  upgradeButton.classList.toggle("hidden", !shouldShowUpgradeButton());

  if (currentUser) {
    profileName.textContent = currentUser.name;
    avatar.textContent = currentUser.name.charAt(0).toUpperCase();
    updateProfileDropdownSummary();
  } else {
    profileName.textContent = "Guest";
    avatar.textContent = "A";
    profileDropdownPlan.textContent = "Plan: Guest";
    profileDropdownDates.classList.add("hidden");
    profileDropdownDates.textContent = "";
  }

  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === currentPage);
  });

  if (!currentUser) {
    profileDropdown.classList.add("hidden");
    profileMenuButton.setAttribute("aria-expanded", "false");
  }
}

function shouldShowUpgradeButton() {
  if (!currentUser || currentPage === "auth") return false;
  if (currentUser.isAdmin) return false;
  const status = String(billingCache.subscriptionStatus || "").toLowerCase();
  if (status === "active" || status === "lifetime") return false;
  return status === "trialing" || status === "inactive" || !billingCache.hasAccess;
}

function updateProfileDropdownSummary() {
  const status = String(billingCache.subscriptionStatus || "inactive").toLowerCase();
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  profileDropdownPlan.textContent = `Plan: ${statusLabel}`;

  const start = formatDateDisplay(billingCache.subscriptionStartedAt);
  const end = formatDateDisplay(billingCache.subscriptionExpiresAt);

  if (start || end) {
    profileDropdownDates.classList.remove("hidden");
    profileDropdownDates.textContent = `${start || "Started"}${end ? ` - ${end}` : ""}`;
    return;
  }

  profileDropdownDates.classList.add("hidden");
  profileDropdownDates.textContent = "";
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
  const providerDnsTarget = settings.providerDnsTarget || publicShortDomain;
  const domainAutomation = settings.domainAutomation || { provider: "godaddy", connected: false };
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
      return {
        host,
        status: "APP_DEFAULT",
        isActive: host === defaultDomain,
        dnsTarget: providerDnsTarget,
        verifiedAt: null,
        provider: existing.provider || null,
        sslStatus: existing.sslStatus || null,
        ownershipStatus: existing.ownershipStatus || null,
        providerHostnameId: existing.providerHostnameId || null,
        verificationErrors: Array.isArray(existing.verificationErrors) ? existing.verificationErrors : [],
      };
    }
    const isActive = host === defaultDomain;
    const status = isActive ? "ACTIVE" : (existing.status || "PENDING");
    return {
      host,
      status,
      isActive,
      dnsTarget: existing.dnsTarget || providerDnsTarget,
      verifiedAt: existing.verifiedAt || null,
      provider: existing.provider || null,
      sslStatus: existing.sslStatus || null,
      ownershipStatus: existing.ownershipStatus || null,
      providerHostnameId: existing.providerHostnameId || null,
      verificationErrors: Array.isArray(existing.verificationErrors) ? existing.verificationErrors : [],
    };
  });

  return {
    workspaceName: settings.workspaceName || "AnyLink Workspace",
    defaultDomain,
    domains,
    domainEntries,
    providerDnsTarget,
    domainAutomation,
    conversionGoals: normalizeConversionGoals(settings.conversionGoals || {}),
    linkRules: normalizeLinkRules(settings.linkRules || {}),
    linkHealth: normalizeLinkHealth(settings.linkHealth || {}),
    campaignTemplates: normalizeCampaignTemplates(settings.campaignTemplates || []),
    pixelTemplates: normalizePixelTemplates(settings.pixelTemplates || []),
    teamMembers: normalizeTeamMembers(settings.teamMembers || []),
    trashLinks: normalizeTrashLinks(settings.trashLinks || []),
    campaigns: normalizeCampaigns(settings.campaigns || []),
  };
}

function normalizeLinkHealth(input) {
  const health = {};
  for (const [slug, value] of Object.entries(input || {})) {
    const cleanSlug = sanitizeSlug(slug);
    if (!cleanSlug || !value || typeof value !== "object") continue;
    const status = ["healthy", "degraded", "broken", "unknown"].includes(String(value.status || "").toLowerCase())
      ? String(value.status || "").toLowerCase()
      : "unknown";
    health[cleanSlug] = {
      status,
      httpStatus: Math.max(0, Number(value.httpStatus || 0)),
      checkedAt: String(value.checkedAt || ""),
      error: String(value.error || ""),
    };
  }
  return health;
}

function normalizeCampaignTemplates(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : []).map((item) => {
    if (!item || typeof item !== "object") return null;
    const id = String(item.id || "").trim() || crypto.randomUUID();
    if (seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      name: String(item.name || "").trim() || "Template",
      source: String(item.source || "").trim(),
      medium: String(item.medium || "").trim(),
      campaign: String(item.campaign || "").trim(),
      term: String(item.term || "").trim(),
      content: String(item.content || "").trim(),
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString()),
    };
  }).filter(Boolean).sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function normalizePixelTemplates(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = String(item.id || "").trim() || crypto.randomUUID();
      const pixelId = String(item.pixelId || "").trim();
      if (seen.has(id) || !pixelId) return null;
      seen.add(id);
      return {
        id,
        name: String(item.name || "").trim() || "Pixel template",
        pixelId,
        createdAt: String(item.createdAt || new Date().toISOString()),
        updatedAt: String(item.updatedAt || new Date().toISOString()),
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function normalizeTeamMembers(input) {
  const seenId = new Set();
  const seenEmail = new Set();
  return (Array.isArray(input) ? input : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = String(item.id || "").trim() || crypto.randomUUID();
      const email = String(item.email || "").trim().toLowerCase();
      if (!email || seenId.has(id) || seenEmail.has(email)) return null;
      seenId.add(id);
      seenEmail.add(email);
      const role = ["admin", "editor", "viewer"].includes(String(item.role || "").trim().toLowerCase())
        ? String(item.role || "").trim().toLowerCase()
        : "viewer";
      return {
        id,
        email,
        role,
        name: String(item.name || "").trim() || email.split("@")[0] || "Member",
        status: String(item.status || "active").trim().toLowerCase() || "active",
        createdAt: String(item.createdAt || new Date().toISOString()),
        updatedAt: String(item.updatedAt || new Date().toISOString()),
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function normalizeCampaigns(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== "object") {
      return null;
    }

    const id = String(item.id || "").trim() || crypto.randomUUID();
    if (seen.has(id)) {
      return null;
    }
    seen.add(id);

    return {
      id,
      name: String(item.name || "").trim() || "Untitled campaign",
      status: ["draft", "active", "paused", "completed"].includes(String(item.status || "").trim().toLowerCase())
        ? String(item.status || "").trim().toLowerCase()
        : "draft",
      source: String(item.source || "").trim(),
      medium: String(item.medium || "").trim(),
      campaign: String(item.campaign || "").trim(),
      term: String(item.term || "").trim(),
      content: String(item.content || "").trim(),
      pixelTemplateId: String(item.pixelTemplateId || "").trim(),
      pixelId: String(item.pixelId || "").trim(),
      destination: String(item.destination || "").trim(),
      generatedUrl: String(item.generatedUrl || "").trim(),
      shortUrl: String(item.shortUrl || "").trim(),
      slug: sanitizeSlug(String(item.slug || "").trim()),
      notes: String(item.notes || "").trim(),
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString()),
    };
  }).filter(Boolean);
}

function normalizeTrashLinks(items) {
  const seen = new Set();

  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const slug = sanitizeSlug(item.slug || "");
      const destination = String(item.destination || "").trim();
      if (!slug || !destination || seen.has(slug)) {
        return null;
      }

      seen.add(slug);
      return {
        id: item.id || `trash-${slug}`,
        slug,
        destination,
        shortUrl: String(item.shortUrl || ""),
        includeQr: Boolean(item.includeQr),
        createdAt: String(item.createdAt || ""),
        deletedAt: String(item.deletedAt || ""),
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.deletedAt || 0).getTime() - new Date(left.deletedAt || 0).getTime());
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
    const startsAt = String(value.startsAt || "").trim();
    const isPaused = Boolean(value.isPaused);
    const isProtected = Boolean(value.passwordHash || value.isProtected);
    const isOneTime = Boolean(value.isOneTime);
    const oneTimeUsedAt = String(value.oneTimeUsedAt || "").trim();
    const abEnabled = Boolean(value.abEnabled);
    const abDestinationA = String(value.abDestinationA || "").trim();
    const abDestinationB = String(value.abDestinationB || "").trim();
    const abWeightA = Math.min(95, Math.max(5, Number(value.abWeightA || 50) || 50));
    const pixelId = String(value.pixelId || "").trim();
    const geoRedirects = Array.isArray(value.geoRedirects) ? value.geoRedirects
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const country = String(item.country || "").trim().toUpperCase().slice(0, 2);
        const destination = String(item.destination || "").trim();
        if (!country || !destination) return null;
        return { country, destination };
      })
      .filter(Boolean) : [];
    const deviceRedirects = Array.isArray(value.deviceRedirects) ? value.deviceRedirects
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const device = String(item.device || "").trim().toLowerCase();
        const destination = String(item.destination || "").trim();
        if (!["mobile", "desktop", "tablet"].includes(device) || !destination) return null;
        return { device, destination };
      })
      .filter(Boolean) : [];

    if (!startsAt && !expiresAt && !isPaused && !isProtected && !isOneTime && !abEnabled && !pixelId && !geoRedirects.length && !deviceRedirects.length) {
      return;
    }

    normalized[cleanSlug] = {
      startsAt,
      expiresAt,
      isPaused,
      isProtected,
      isOneTime,
      oneTimeUsedAt,
      abEnabled,
      abDestinationA,
      abDestinationB,
      abWeightA,
      pixelId,
      geoRedirects,
      deviceRedirects,
    };
  });

  return normalized;
}

function normalizeBuilderFieldType(type) {
  const normalized = String(type || "text").trim().toLowerCase();
  return [
    "text", "email", "tel", "textarea", "select", "radio", "checkbox", "multiselect",
    "number", "url", "file", "date", "time", "scale",
    "pagebreak", "thankyou", "textblock", "heading1", "heading2", "heading3",
    "divider", "title", "label", "image", "video", "audio", "embed",
  ].includes(normalized) ? normalized : "text";
}

function normalizeBuilderFieldKey(value, fallback = "field") {
  return sanitizeSlug(String(value || fallback).replaceAll("_", "-")) || fallback;
}

function normalizeBuilderFieldOptions(options) {
  const rawItems = Array.isArray(options) ? options : String(options || "").split(/\r?\n|,/);
  return [...new Set(rawItems.map((item) => String(item || "").trim()).filter(Boolean))];
}

function isInteractiveFieldType(type) {
  return [
    "text", "email", "tel", "textarea", "select", "radio", "checkbox",
    "multiselect", "number", "url", "file", "date", "time", "scale",
  ].includes(normalizeBuilderFieldType(type));
}

function supportsOptionsType(type) {
  return ["select", "radio", "checkbox", "multiselect"].includes(normalizeBuilderFieldType(type));
}

function supportsContentType(type) {
  return ["pagebreak", "thankyou", "textblock", "heading1", "heading2", "heading3", "title", "label"].includes(normalizeBuilderFieldType(type));
}

function supportsUrlType(type) {
  return ["image", "video", "audio", "embed"].includes(normalizeBuilderFieldType(type));
}

function supportsScaleType(type) {
  return normalizeBuilderFieldType(type) === "scale";
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

  source.forEach((field) => {
    if (!field || typeof field !== "object") {
      return;
    }

    const builtIn = Boolean(field.builtIn || defaultFormFieldLibrary.some((item) => item.key === field.key));
    const key = normalizeBuilderFieldKey(field.key || field.label, builtIn ? field.key : "field");
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    const type = normalizeBuilderFieldType(field.type);
    normalized.push({
      key,
      label: String(field.label || key).trim() || key,
      type,
      required: Boolean(field.required),
      enabled: supportsContentType(type) || supportsUrlType(type) || type === "divider" ? true : Boolean(field.enabled !== false),
      builtIn,
      options: supportsOptionsType(type) ? normalizeBuilderFieldOptions(field.options) : [],
      content: String(field.content || "").trim(),
      url: String(field.url || "").trim(),
      min: Number.isFinite(Number(field.min)) ? Number(field.min) : 1,
      max: Number.isFinite(Number(field.max)) ? Number(field.max) : 5,
    });
  });

  defaultFormFieldLibrary.forEach((field) => {
    if (!seen.has(field.key)) {
      normalized.push({ ...field });
    }
  });

  return normalized;
}

function getLinkRule(slug) {
  return settingsCache.linkRules?.[slug] || {
    startsAt: "",
    expiresAt: "",
    isPaused: false,
    isProtected: false,
    isOneTime: false,
    oneTimeUsedAt: "",
    abEnabled: false,
    abDestinationA: "",
    abDestinationB: "",
    abWeightA: 50,
    pixelId: "",
    geoRedirects: [],
    deviceRedirects: [],
  };
}

function getLinkHealthStatus(slug) {
  const fallback = { status: "unknown", httpStatus: 0, checkedAt: "", error: "" };
  const value = settingsCache.linkHealth?.[slug];
  if (!value || typeof value !== "object") return fallback;
  return {
    status: ["healthy", "degraded", "broken", "unknown"].includes(String(value.status || "").toLowerCase())
      ? String(value.status || "").toLowerCase()
      : "unknown",
    httpStatus: Math.max(0, Number(value.httpStatus || 0)),
    checkedAt: String(value.checkedAt || ""),
    error: String(value.error || ""),
  };
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
  const normalizedBillingStatus = String(billingCache.subscriptionStatus || "").toLowerCase();
  const canOpenBillingPage = !currentUser.isAdmin && (normalizedBillingStatus === "trialing" || !billingCache.hasAccess);

  if (billingCache.hasAccess && currentPage === "billing" && !canOpenBillingPage && !currentUser.isAdmin) {
    currentPage = "home";
    updateHeaderMeta();
    return renderHomePage();
  }
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
  const billingStatus = String(billingCache.subscriptionStatus || "").toLowerCase();
  const isTrialing = billingStatus === "trialing";

  if (billingCache.hasAccess && !isTrialing && !currentUser?.isAdmin) {
    currentPage = "home";
    updateHeaderMeta();
    renderHomePage();
    return;
  }
  const daysLeft = Math.max(0, Math.ceil((billingCache.trialRemainingMs || 0) / (1000 * 60 * 60 * 24)));
  const subscriptionStart = formatDateDisplay(billingCache.subscriptionStartedAt);
  const subscriptionEnd = formatDateDisplay(billingCache.subscriptionExpiresAt);
  currentPage = "billing";
  updateHeaderMeta();
  mainContent.innerHTML = `
    <section class="auth-shell">
      <div class="auth-card auth-copy-card">
        <p class="eyebrow">Subscription Required</p>
        <h1>${isTrialing ? "Upgrade anytime." : "Your trial has ended."}</h1>
        <p class="auth-copy">${isTrialing
          ? `You still have ${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial. Upgrade now to activate your paid plan immediately and keep everything running without interruption.`
          : "You had a 3-day free trial. Subscribe to continue creating links, QR codes, domains, and private workspace access."}</p>
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
          <p class="billing-copy">${isTrialing
            ? `Trial remaining: <strong>${daysLeft}</strong> day${daysLeft === 1 ? "" : "s"}. You can upgrade right now.`
            : `Trial remaining: <strong>${daysLeft}</strong> day${daysLeft === 1 ? "" : "s"}.`}</p>
          ${(subscriptionStart || subscriptionEnd) ? `
            <div class="billing-date-list">
              ${subscriptionStart ? `<div class="billing-date-item"><span>Start date</span><strong>${escapeHtml(subscriptionStart)}</strong></div>` : ""}
              ${subscriptionEnd ? `<div class="billing-date-item"><span>End date</span><strong>${escapeHtml(subscriptionEnd)}</strong></div>` : ""}
            </div>
          ` : ""}
          <div class="campaign-builder-grid">
            <input class="url-input" id="billingCouponCode" type="text" placeholder="Offer / coupon code" value="${escapeHtml(billingCouponState?.code || "")}" />
            <button class="link-button secondary" id="billingCouponApply" type="button">Apply code</button>
          </div>
          ${billingCouponState ? `<div class="task-item"><span class="task-check filled"></span><span>Applied: ${escapeHtml(billingCouponState.code)} • ${escapeHtml(billingCouponState.message || billingCouponState.label || billingCouponState.type || "Offer")}</span></div>` : ""}
          <button class="primary-action auth-submit" id="subscribeButton" type="button">Continue to payment</button>
          <button class="link-button secondary hidden" id="refreshBillingButton" type="button">I already paid</button>
          <div class="result-banner hidden" id="billingBanner" aria-live="polite"></div>
        </div>
      </div>
    </section>
  `;

  document.getElementById("subscribeButton").addEventListener("click", async () => {
    const banner = document.getElementById("billingBanner");
    setInlineBanner(banner, "Preparing payment...", false);
    try {
      const response = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ couponCode: billingCouponState?.code || "" }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setInlineBanner(banner, payload.error || "Payment setup is not ready yet.", true);
        return;
      }
      if (payload.provider === "coupon" && payload.billing) {
        billingCache = payload.billing || billingCache;
        billingCouponState = null;
        setInlineBanner(banner, payload.message || "Offer applied successfully.", false);
        setTimeout(() => {
          window.location.replace("/home");
        }, 700);
        return;
      }
      sessionStorage.setItem("anylink_pending_billing_sync", "1");
      startPendingBillingSync();
      setTimeout(() => {
        const refreshButton = document.getElementById("refreshBillingButton");
        if (refreshButton) refreshButton.classList.remove("hidden");
      }, 12000);

      const openedWindow = window.open(payload.paymentUrl, "_blank", "noopener,noreferrer");
      if (openedWindow) {
        setInlineBanner(banner, "Payment opened in a new tab. We will activate your subscription automatically once payment is confirmed.", false);
        return;
      }

      window.location.href = payload.paymentUrl;
    } catch (error) {
      setInlineBanner(banner, error.message, true);
    }
  });

  document.getElementById("refreshBillingButton").addEventListener("click", async () => {
    await refreshBillingAfterPayment();
  });

  document.getElementById("billingCouponApply")?.addEventListener("click", async () => {
    const banner = document.getElementById("billingBanner");
    const code = document.getElementById("billingCouponCode")?.value?.trim() || "";
    if (!code) {
      billingCouponState = null;
      setInlineBanner(banner, "Enter a coupon code first.", true);
      return;
    }
    setInlineBanner(banner, "Checking coupon...", false);
    try {
      const response = await fetch("/api/billing/coupon/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json();
      if (!response.ok) {
        billingCouponState = null;
        setInlineBanner(banner, payload.error || "Coupon is not valid.", true);
        return;
      }
      billingCouponState = {
        code: payload.coupon?.code || code.toUpperCase(),
        label: payload.coupon?.label || "",
        type: payload.coupon?.type || "",
        message: payload.message || "",
      };
      setInlineBanner(banner, payload.message || "Coupon applied.", false);
      renderBillingPage();
    } catch (error) {
      billingCouponState = null;
      setInlineBanner(banner, error.message, true);
    }
  });

  if (sessionStorage.getItem("anylink_pending_billing_sync") === "1") {
    startPendingBillingSync(true);
  }
}

async function refreshBillingAfterPayment(silent = false) {
  const banner = document.getElementById("billingBanner");
  if (!silent) {
    setInlineBanner(banner, "Checking your payment status...", false);
  }

  try {
    const response = await fetch("/api/billing/refresh", { method: "POST" });
    const payload = await response.json();

    if (!response.ok) {
      setInlineBanner(banner, payload.error || "We could not verify your payment yet. Please try again in a moment.", true);
      return;
    }

    billingCache = payload.billing || billingCache;
    if (billingCache.hasAccess) {
      stopPendingBillingSync();
      sessionStorage.removeItem("anylink_pending_billing_sync");
      setInlineBanner(banner, "Subscription activated successfully.", false);
      setTimeout(() => {
        window.location.replace("/home");
      }, 700);
      return;
    }

    setInlineBanner(banner, `Payment found, but access is still ${payload.razorpayStatus || "pending"}. Try again in a few moments.`, true);
  } catch (error) {
    setInlineBanner(banner, error.message, true);
  }
}

function startPendingBillingSync(silent = false) {
  stopPendingBillingSync();
  refreshBillingAfterPayment(silent);
  billingRefreshTimer = window.setInterval(() => {
    refreshBillingAfterPayment(true);
  }, 5000);
}

async function sendActivityPing(event = "heartbeat", durationOverride = null) {
  if (!currentUser || currentPage === "auth") {
    return;
  }

  const now = Date.now();
  const durationMs = Math.max(0, durationOverride === null ? now - activityPageStartedAt : durationOverride);
  activityPageStartedAt = now;

  try {
    await fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: currentPage, event, durationMs }),
      keepalive: true,
    });
  } catch {
    // Activity tracking should never interrupt the dashboard.
  }
}

function stopActivityTracking() {
  if (activityHeartbeatTimer) {
    window.clearInterval(activityHeartbeatTimer);
    activityHeartbeatTimer = null;
  }
}

function startActivityTracking() {
  stopActivityTracking();
  activityPageStartedAt = Date.now();
  sendActivityPing("view", 0);
  activityHeartbeatTimer = window.setInterval(() => {
    sendActivityPing("heartbeat");
  }, 30000);
}

function syncActivityTrackingForPage() {
  if (!currentUser || currentPage === "auth") {
    stopActivityTracking();
    lastTrackedActivityPage = "";
    return;
  }

  if (lastTrackedActivityPage !== currentPage) {
    lastTrackedActivityPage = currentPage;
    startActivityTracking();
  }
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}
function stopPendingBillingSync() {
  if (billingRefreshTimer) {
    window.clearInterval(billingRefreshTimer);
    billingRefreshTimer = null;
  }
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
        <article class="stat-card"><span>Total page views</span><strong>${payload.summary.totalPageViews}</strong></article>
        <article class="stat-card"><span>Links created</span><strong>${payload.summary.totalLinksCreated}</strong></article>
        <article class="stat-card"><span>Time spent</span><strong>${formatDuration(payload.summary.totalTimeMs)}</strong></article>
      </section>
      <section class="surface-card">
        <div class="surface-header">
          <div>
            <h2>User management</h2>
            <p>Manage verification, trial access, subscriptions, and review detailed user usage.</p>
          </div>
        </div>
        <div class="admin-table">
          ${payload.users.map((user) => `
            <div class="admin-row admin-row-usage">
              <div class="admin-main">
                <strong>${escapeHtml(user.name)}</strong>
                <span>${escapeHtml(user.email)}</span>
                <span>${user.emailVerified ? "Verified" : "Not verified"} � ${escapeHtml(user.billing.subscriptionStatus)}</span>
                <span>${user.totalLinks} live links � ${user.usage.linksCreated} created � ${user.activeSessions} sessions</span>
                <span>${user.usage.pageViews} page views � ${formatDuration(user.usage.totalTimeMs)} spent � Last active: ${user.usage.lastActiveAt ? escapeHtml(new Date(user.usage.lastActiveAt).toLocaleString()) : "Never"}</span>
                <span>Last page: ${escapeHtml(user.usage.lastPage || "- ")} ${user.usage.topPages?.length ? `� Top pages: ${escapeHtml(user.usage.topPages.map((item) => `${item.page} (${item.count})`).join(", "))}` : ""}</span>
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
            <h2>Coupons & offers</h2>
            <p>Create discount-plan coupons or free-access offers for billing.</p>
          </div>
        </div>
        <div class="campaign-builder-grid">
          <input class="url-input" id="adminCouponCode" type="text" placeholder="Code e.g. SUMMER20" />
          <input class="url-input" id="adminCouponLabel" type="text" placeholder="Label e.g. 20% Off Plan" />
          <select class="url-input" id="adminCouponType">
            <option value="plan">Discounted plan</option>
            <option value="free_days">Free days</option>
            <option value="lifetime">Lifetime access</option>
          </select>
          <input class="url-input" id="adminCouponValue" type="text" placeholder="Days or note" />
          <input class="url-input" id="adminCouponPlanId" type="text" placeholder="Razorpay plan id (for discounted plan)" />
          <button class="primary-action" id="adminCouponSave" type="button">Save coupon</button>
        </div>
        <div class="admin-table">
          ${(payload.coupons || []).length
            ? payload.coupons.map((coupon) => `
              <div class="admin-row">
                <div class="admin-main">
                  <strong>${escapeHtml(coupon.code)}</strong>
                  <span>${escapeHtml(coupon.label || coupon.type)}</span>
                  <span>Type: ${escapeHtml(coupon.type)}${coupon.type === "free_days" ? ` • ${escapeHtml(String(coupon.value || 0))} days` : ""}${coupon.type === "plan" ? ` • Plan: ${escapeHtml(coupon.planId || "-")}` : ""}</span>
                </div>
                <div class="admin-actions">
                  <button class="link-button danger" data-admin-coupon-delete="${escapeHtml(coupon.code)}">Delete</button>
                </div>
              </div>
            `).join("")
            : '<div class="empty-state">No coupons created yet.</div>'}
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
      <section class="surface-card">
        <div class="surface-header">
          <div>
            <h2>Audit timeline</h2>
            <p>Latest admin and workspace actions with actor and timestamp.</p>
          </div>
        </div>
        <div class="campaign-template-row audit-toolbar">
          <input id="adminAuditSearch" class="url-input" type="text" placeholder="Search actor/action/metadata">
          <select id="adminAuditActionFilter" class="url-input">
            <option value="all">All actions</option>
            <option value="admin.">Admin actions</option>
            <option value="team.">Team actions</option>
          </select>
        </div>
        <div class="admin-table">
          ${renderAuditRows(payload.auditLogs || [])}
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

  document.getElementById("adminCouponSave")?.addEventListener("click", async () => {
    const code = document.getElementById("adminCouponCode")?.value?.trim() || "";
    const label = document.getElementById("adminCouponLabel")?.value?.trim() || "";
    const type = document.getElementById("adminCouponType")?.value || "plan";
    const value = document.getElementById("adminCouponValue")?.value?.trim() || "";
    const planId = document.getElementById("adminCouponPlanId")?.value?.trim() || "";
    await runAdminAction(
      "/api/admin/coupons",
      { code, label, type, value, planId, active: true },
      `Coupon ${code.toUpperCase()} saved.`
    );
  });

  document.querySelectorAll("[data-admin-coupon-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runAdminAction(`/api/admin/coupons/${button.getAttribute("data-admin-coupon-delete")}/delete`, {}, "Coupon deleted.");
    });
  });

  const auditSearch = document.getElementById("adminAuditSearch");
  const auditActionFilter = document.getElementById("adminAuditActionFilter");
  auditSearch?.addEventListener("input", applyAuditFilters);
  auditActionFilter?.addEventListener("change", applyAuditFilters);
  applyAuditFilters();
}

function renderAuditRows(auditLogs) {
  const rows = Array.isArray(auditLogs) ? auditLogs : [];
  if (!rows.length) {
    return '<div class="empty-state">No audit events yet.</div>';
  }
  return rows.slice(0, 80).map((log) => {
    const action = escapeHtml(String(log.action || "event"));
    const actorEmail = escapeHtml(String(log.actorEmail || "system"));
    const createdAt = Number(log.createdAt || 0);
    const createdLabel = createdAt ? escapeHtml(new Date(createdAt).toLocaleString()) : "-";
    const metadata = log.metadata && typeof log.metadata === "object"
      ? Object.entries(log.metadata)
        .filter(([key, value]) => value !== null && value !== undefined && String(value).trim() !== "")
        .slice(0, 4)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(" | ")
      : "";
    const searchable = [action, actorEmail, metadata].join(" ").toLowerCase();
    return `
      <div class="admin-row audit-row" data-audit-action="${action.toLowerCase()}" data-audit-search="${escapeHtml(searchable)}">
        <div class="admin-main">
          <strong>${action}</strong>
          <span>Actor: ${actorEmail}</span>
          <span>At: ${createdLabel}</span>
          ${metadata ? `<span>${escapeHtml(metadata)}</span>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function applyAuditFilters() {
  const search = String(document.getElementById("adminAuditSearch")?.value || "").trim().toLowerCase();
  const actionPrefix = String(document.getElementById("adminAuditActionFilter")?.value || "all").trim().toLowerCase();
  document.querySelectorAll(".audit-row").forEach((row) => {
    const action = String(row.getAttribute("data-audit-action") || "").toLowerCase();
    const haystack = String(row.getAttribute("data-audit-search") || "").toLowerCase();
    const actionOk = actionPrefix === "all" ? true : action.startsWith(actionPrefix);
    const searchOk = !search || haystack.includes(search);
    row.classList.toggle("hidden", !(actionOk && searchOk));
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
  const domainOptions = settingsCache.domains.map((domain) => `<option value="${escapeHtml(domain)}" ${domain === settingsCache.defaultDomain ? "selected" : ""}>${escapeHtml(domain)}</option>`).join("");
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
          <div class="input-stack"><label for="linkDomain" class="field-label">Link domain</label><select id="linkDomain" class="url-input domain-select">${domainOptions}</select></div>
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
  const trashMarkup = renderTrashLinkItems(settingsCache.trashLinks || []);
  const editingLink = filtered.find((link) => link.slug === selectedLinkSlug) || linksCache.find((link) => link.slug === selectedLinkSlug) || null;
  const editDomainOptions = settingsCache.domains.map((domain) => `<option value="${escapeHtml(domain)}" ${editingLink && getLinkDomain(editingLink) === domain ? "selected" : ""}>${escapeHtml(domain)}</option>`).join("");
  const editingRule = editingLink ? getLinkRule(editingLink.slug) : null;
  const editingGoal = editingLink ? getLinkGoal(editingLink.slug) : 0;
  const editingHealth = editingLink ? getLinkHealthStatus(editingLink.slug) : null;
  const editingScheduled = editingRule ? (editingRule.startsAt && Date.now() < new Date(editingRule.startsAt).getTime()) : false;
  const editingHealthLabel = editingHealth
    ? (editingHealth.status === "healthy"
      ? `Healthy${editingHealth.httpStatus ? ` (${editingHealth.httpStatus})` : ""}`
      : editingHealth.status === "degraded"
        ? `Needs check${editingHealth.httpStatus ? ` (${editingHealth.httpStatus})` : ""}`
        : editingHealth.status === "broken"
          ? "Broken"
          : "Not checked")
    : "Not checked";
  mainContent.innerHTML = `
    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>Your short links</h2>
          <p>Compact list view. Click Edit to open full settings for one link.</p>
        </div>
        <div class="goal-action-row">
          <button class="link-button secondary" type="button" id="checkAllLinksHealthButton">Check all links</button>
          <a class="chip-link" href="/home">Create another</a>
        </div>
      </div>
      ${editingLink ? `
        <div class="form-card link-editor-card">
          <div class="surface-header">
            <div>
              <h3>Edit link</h3>
              <p>All details for <strong>${escapeHtml(editingLink.slug)}</strong> are shown here only.</p>
            </div>
            <button class="link-button secondary" type="button" id="closeLinkEditorButton">Close</button>
          </div>
          <div class="goal-action-row link-editor-grid">
            <input class="url-input" id="editLinkSlugInput" type="text" value="${escapeHtml(editingLink.slug)}" placeholder="custom-slug">
            <input class="url-input" id="editLinkDestinationInput" type="url" value="${escapeHtml(editingLink.destination)}" placeholder="https://example.com">
            <select class="url-input domain-select" id="editLinkDomainInput">${editDomainOptions}</select>
            <label class="field-toggle compact-toggle"><input type="checkbox" id="editLinkQrInput" ${editingLink.includeQr ? "checked" : ""}><span>Include QR</span></label>
            <button class="link-button" type="button" id="saveLinkEditButton" data-edit-link="${escapeHtml(editingLink.slug)}">Save changes</button>
          </div>
          <div class="goal-action-row">
            <span class="domain-status ${escapeHtml(editingHealth?.status || "pending")}">${escapeHtml(editingHealthLabel)}</span>
            ${editingHealth.checkedAt ? `<span class="helper-copy">Checked: ${escapeHtml(new Date(editingHealth.checkedAt).toLocaleString())}</span>` : ""}
            <button class="link-button secondary" type="button" data-check-health="${escapeHtml(editingLink.slug)}">Check</button>
          </div>
          ${editingHealth.error ? `<div class="helper-copy">${escapeHtml(editingHealth.error)}</div>` : ""}
          <div class="goal-action-row">
            <input class="url-input goal-input" type="number" min="1" step="1" value="${editingGoal || ""}" placeholder="Target clicks" data-goal-input="${escapeHtml(editingLink.slug)}">
            <button class="link-button" type="button" data-save-goal="${escapeHtml(editingLink.slug)}">Save goal</button>
            ${editingGoal ? `<button class="link-button secondary" type="button" data-clear-goal="${escapeHtml(editingLink.slug)}">Clear</button>` : ""}
            ${editingScheduled ? `<span class="chip-link">Scheduled</span>` : ""}
          </div>
          <div class="goal-action-row">
            <input class="url-input schedule-rule-input" type="datetime-local" value="${escapeHtml(editingRule.startsAt || "")}" data-start-input="${escapeHtml(editingLink.slug)}">
            <input class="url-input goal-input" type="date" value="${escapeHtml(editingRule.expiresAt || "")}" data-expiry-input="${escapeHtml(editingLink.slug)}">
            <label class="field-toggle compact-toggle"><input type="checkbox" data-pause-input="${escapeHtml(editingLink.slug)}" ${editingRule.isPaused ? "checked" : ""}><span>Pause link</span></label>
            <label class="field-toggle compact-toggle"><input type="checkbox" data-onetime-input="${escapeHtml(editingLink.slug)}" ${editingRule.isOneTime ? "checked" : ""}><span>One-time</span></label>
            <button class="link-button secondary" type="button" data-save-rule="${escapeHtml(editingLink.slug)}">Save rule</button>
          </div>
          <div class="goal-action-row">
            <label class="field-toggle compact-toggle"><input type="checkbox" data-ab-enabled-input="${escapeHtml(editingLink.slug)}" ${editingRule.abEnabled ? "checked" : ""}><span>A/B split</span></label>
            <input class="url-input goal-input" type="number" min="5" max="95" step="1" value="${escapeHtml(String(editingRule.abWeightA || 50))}" data-ab-weight-input="${escapeHtml(editingLink.slug)}" placeholder="A %">
            <input class="url-input" type="url" value="${escapeHtml(editingRule.abDestinationA || "")}" data-ab-a-input="${escapeHtml(editingLink.slug)}" placeholder="Destination A">
            <input class="url-input" type="url" value="${escapeHtml(editingRule.abDestinationB || "")}" data-ab-b-input="${escapeHtml(editingLink.slug)}" placeholder="Destination B">
          </div>
          <div class="goal-action-row">
            <input class="url-input goal-input" type="text" maxlength="2" value="${escapeHtml((editingRule.geoRedirects?.[0]?.country || "").toUpperCase())}" data-geo-country-input="${escapeHtml(editingLink.slug)}" placeholder="Country code (IN)">
            <input class="url-input" type="url" value="${escapeHtml(editingRule.geoRedirects?.[0]?.destination || "")}" data-geo-destination-input="${escapeHtml(editingLink.slug)}" placeholder="Geo redirect URL">
            <select class="url-input goal-input" data-device-type-input="${escapeHtml(editingLink.slug)}">
              <option value="">Device</option>
              <option value="mobile" ${editingRule.deviceRedirects?.[0]?.device === "mobile" ? "selected" : ""}>Mobile</option>
              <option value="desktop" ${editingRule.deviceRedirects?.[0]?.device === "desktop" ? "selected" : ""}>Desktop</option>
              <option value="tablet" ${editingRule.deviceRedirects?.[0]?.device === "tablet" ? "selected" : ""}>Tablet</option>
            </select>
            <input class="url-input" type="url" value="${escapeHtml(editingRule.deviceRedirects?.[0]?.destination || "")}" data-device-destination-input="${escapeHtml(editingLink.slug)}" placeholder="Device redirect URL">
          </div>
          <div class="goal-action-row">
            <input class="url-input" type="text" value="${escapeHtml(editingRule.pixelId || "")}" data-pixel-id-input="${escapeHtml(editingLink.slug)}" placeholder="Pixel tag (appends anylink_px)">
          </div>
          <div class="goal-action-row">
            <input class="url-input password-rule-input" type="text" placeholder="${editingRule.isProtected ? "Change password" : "Protect with password"}" data-password-input="${escapeHtml(editingLink.slug)}">
            <button class="link-button secondary" type="button" data-save-password="${escapeHtml(editingLink.slug)}">${editingRule.isProtected ? "Update password" : "Set password"}</button>
            ${editingRule.isProtected ? `<button class="link-button danger" type="button" data-clear-password="${escapeHtml(editingLink.slug)}">Remove password</button>` : ""}
          </div>
        </div>
      ` : ""}
      <div class="links-list">${renderLinkItems(filtered, true)}</div>
      <div class="recycle-bin-panel">
        <div class="surface-header recycle-bin-header">
          <div>
            <h3>Recycle Bin</h3>
            <p>Deleted links stay here until you restore them or delete them forever.</p>
          </div>
          <span class="chip-link">${(settingsCache.trashLinks || []).length} item${(settingsCache.trashLinks || []).length === 1 ? "" : "s"}</span>
        </div>
        <div class="links-list recycle-bin-list">${trashMarkup}</div>
      </div>
    </section>
  `;
  wireLinkActions();
  bindGoalActions();
}

function renderQrPage() {
  const sample = getSelectedQrLink();
  const qrTargetUrl = sample ? getLinkUrl(sample) : "";
  const qrImageUrl = sample ? buildQrImageUrl(qrTargetUrl, qrCustomization) : "";

  mainContent.innerHTML = `
    <section class="surface-card two-column">
      <div>
        <div class="surface-header"><div><h2>QR Code workspace</h2><p>Generate scannable QR codes for links inside your private account.</p></div></div>
        <div class="qr-panel">
          <div class="qr-box">${sample ? `<img class="qr-image" id="qrPreviewImage" src="${escapeHtml(qrImageUrl)}" alt="QR code for ${escapeHtml(qrTargetUrl)}">` : `<div class="qr-grid"></div>`}</div>
          <div class="qr-copy">
            <strong>${sample ? escapeHtml(qrTargetUrl) : "Create a link first"}</strong>
            <p>${sample ? "Use this QR in posters, packaging, menus, business cards, or flyers." : "Once you create a link on Home, it can appear here as a QR-ready item."}</p>
            ${sample ? `
              <div class="qr-customizer-grid">
                <label class="field-label qr-color-field">Foreground<input id="qrForeground" type="color" value="${escapeHtml(qrCustomization.foreground)}"></label>
                <label class="field-label qr-color-field">Background<input id="qrBackground" type="color" value="${escapeHtml(qrCustomization.background)}"></label>
                <label class="field-label qr-logo-field">Logo text<input id="qrLogoText" class="url-input" type="text" maxlength="3" value="${escapeHtml(qrCustomization.logoText)}" placeholder="SL"></label>
              </div>
            ` : ""}
            <div class="qr-action-row">
              ${sample ? `
                <button class="primary-action inline-action" id="openQrButton" type="button">Open QR</button>
                <button class="link-button secondary" id="downloadQrPngButton" type="button">PNG</button>
                <button class="link-button secondary" id="downloadQrSvgButton" type="button">SVG</button>
                <button class="link-button secondary" id="downloadQrPdfButton" type="button">PDF</button>
              ` : `<a class="primary-action inline-action" href="/home">Create link</a>`}
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

  if (sample) {
    bindQrCustomizer(sample, qrTargetUrl);
  }
}

function renderPagesBuilder() {
  const selectedPage = getSelectedForm();
  const draft = formBuilderDraftCache || selectedPage || createEmptyFormDraft();
  const totalSubmissions = pagesCache.reduce((sum, page) => sum + (page.submissionCount || 0), 0);
  const draftFields = normalizeFormFields(draft.fields || []);

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
          <div class="surface-header compact form-builder-header-row">
            <div>
              <h3>Fields</h3>
              <p>Mix input, layout, and embed blocks to shape the form exactly the way you want.</p>
            </div>
            <button class="link-button secondary" id="addCustomFieldButton" type="button">Add custom field</button>
          </div>
          <div class="block-palette-grid">
            <div class="block-palette-group">
              <strong>Input blocks</strong>
              <div class="block-palette-list">
                ${formBlockCatalog.input.map(([type, label]) => `<button class="block-palette-item" type="button" data-add-block="${type}">${escapeHtml(label)}</button>`).join("")}
              </div>
            </div>
            <div class="block-palette-group">
              <strong>Layout blocks</strong>
              <div class="block-palette-list">
                ${formBlockCatalog.layout.map(([type, label]) => `<button class="block-palette-item" type="button" data-add-block="${type}">${escapeHtml(label)}</button>`).join("")}
              </div>
            </div>
            <div class="block-palette-group">
              <strong>Embed blocks</strong>
              <div class="block-palette-list">
                ${formBlockCatalog.embed.map(([type, label]) => `<button class="block-palette-item" type="button" data-add-block="${type}">${escapeHtml(label)}</button>`).join("")}
              </div>
            </div>
          </div>
          <div class="builder-field-list" id="builderFieldList">
            ${draftFields.map((field, index) => renderBuilderFieldRow(field, index)).join("")}
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
              <span><strong>Active fields</strong>${draftFields.filter((field) => field.enabled && isInteractiveFieldType(field.type)).length}</span>
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
                <article class="form-library-item ${page.id === draft.id ? "active" : ""}">
                  <button class="form-library-main" data-edit-form="${escapeHtml(page.id)}" type="button">
                    <strong>${escapeHtml(page.title)}</strong>
                    <span>${escapeHtml(page.publicUrl)}</span>
                    <em>${page.submissionCount || 0} submission${page.submissionCount === 1 ? "" : "s"}</em>
                  </button>
                  <div class="form-library-actions">
                    <button class="link-button secondary" data-edit-form="${escapeHtml(page.id)}" type="button">Edit</button>
                    <button class="link-button danger" data-delete-form-card="${escapeHtml(page.id)}" type="button">Delete</button>
                  </div>
                </article>
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
      ${draft.id ? renderFormSubmissions(draft.submissions || [], draftFields) : '<div class="empty-state">No form selected yet.</div>'}
    </section>
  `;

  document.getElementById("newFormButton").addEventListener("click", () => {
    selectedFormId = "";
    formBuilderDraftCache = createEmptyFormDraft();
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

  document.getElementById("addCustomFieldButton").addEventListener("click", () => {
    const nextDraft = {
      ...collectFormBuilderDraftFromDom(),
      fields: [...collectFormBuilderDraftFromDom().fields, createCustomFieldDraft()],
    };
    renderPagesBuilderFromDraft(nextDraft);
  });

  document.querySelectorAll("[data-add-block]").forEach((button) => button.addEventListener("click", () => {
    const type = button.getAttribute("data-add-block");
    const currentDraft = collectFormBuilderDraftFromDom();
    renderPagesBuilderFromDraft({
      ...currentDraft,
      fields: [...currentDraft.fields, createBlockDraft(type)],
    });
  }));

  document.querySelectorAll("[data-edit-form]").forEach((button) => button.addEventListener("click", () => {
    selectedFormId = button.getAttribute("data-edit-form");
    formBuilderDraftCache = null;
    renderPagesBuilder();
  }));

  document.querySelectorAll("[data-delete-form-card]").forEach((button) => button.addEventListener("click", async () => {
    const pageId = button.getAttribute("data-delete-form-card");
    const page = pagesCache.find((item) => item.id === pageId);
    const confirmed = window.confirm(`Delete "${page?.title || "this form"}"? You can create it again later, but existing responses will also be removed.`);
    if (!confirmed) return;
    await deleteForm(pageId);
  }));

  document.querySelectorAll("[data-remove-builder-field]").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.getAttribute("data-remove-builder-field"));
    const currentDraft = collectFormBuilderDraftFromDom();
    const nextFields = currentDraft.fields.filter((_, fieldIndex) => fieldIndex !== index);
    renderPagesBuilderFromDraft({ ...currentDraft, fields: nextFields });
  }));

  document.querySelectorAll("[data-builder-type]").forEach((input) => input.addEventListener("change", () => {
    syncBuilderOptionVisibility();
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

  syncBuilderOptionVisibility();
}

function renderPagesBuilderFromDraft(draft) {
  formBuilderDraftCache = {
    ...draft,
    fields: normalizeFormFields(draft.fields || []),
  };
  renderPagesBuilder();
}

function collectFormBuilderDraftFromDom() {
  const existing = formBuilderDraftCache || getSelectedForm() || createEmptyFormDraft();
  const fieldRows = [...document.querySelectorAll("[data-builder-field-row]")];
  const fields = fieldRows.map((row) => {
    const index = row.getAttribute("data-builder-field-row");
    return {
      key: normalizeBuilderFieldKey(document.querySelector(`[data-builder-key="${index}"]`)?.value || "", `field-${Number(index) + 1}`),
      label: String(document.querySelector(`[data-builder-label="${index}"]`)?.value || "").trim() || `Field ${Number(index) + 1}`,
      type: normalizeBuilderFieldType(document.querySelector(`[data-builder-type="${index}"]`)?.value || "text"),
      required: Boolean(document.querySelector(`[data-builder-required="${index}"]`)?.checked),
      enabled: Boolean(document.querySelector(`[data-builder-enabled="${index}"]`)?.checked),
      builtIn: row.querySelector(".chip-link") !== null,
      options: normalizeBuilderFieldOptions(document.querySelector(`[data-builder-options="${index}"]`)?.value || ""),
      content: String(document.querySelector(`[data-builder-content="${index}"]`)?.value || "").trim(),
      url: String(document.querySelector(`[data-builder-url="${index}"]`)?.value || "").trim(),
      min: Number(document.querySelector(`[data-builder-min="${index}"]`)?.value || 1),
      max: Number(document.querySelector(`[data-builder-max="${index}"]`)?.value || 5),
    };
  });

  return {
    ...existing,
    id: document.getElementById("formId")?.value.trim() || existing.id || "",
    title: document.getElementById("formTitle")?.value.trim() || existing.title || "",
    slug: sanitizeSlug(document.getElementById("formSlug")?.value.trim() || existing.slug || existing.title || ""),
    headline: document.getElementById("formHeadline")?.value.trim() || existing.headline || "",
    description: document.getElementById("formDescription")?.value.trim() || existing.description || "",
    submitLabel: document.getElementById("formSubmitLabel")?.value.trim() || existing.submitLabel || "Submit",
    thanksMessage: document.getElementById("formThanksMessage")?.value.trim() || existing.thanksMessage || "Thanks, your response has been received.",
    fields: normalizeFormFields(fields),
  };
}

function syncBuilderOptionVisibility() {
  document.querySelectorAll("[data-builder-type]").forEach((select) => {
    const index = select.getAttribute("data-builder-type");
    const type = normalizeBuilderFieldType(select.value);
    const wrap = document.querySelector(`[data-builder-options-wrap="${index}"]`);
    const contentWrap = document.querySelector(`[data-builder-content-wrap="${index}"]`);
    const urlWrap = document.querySelector(`[data-builder-url-wrap="${index}"]`);
    const toggleWrap = document.querySelector(`[data-builder-toggle-wrap="${index}"]`);
    const scaleWrap = document.querySelector(`[data-builder-scale-wrap="${index}"]`);

    if (wrap) {
      wrap.classList.toggle("hidden", !supportsOptionsType(type));
    }
    if (contentWrap) {
      contentWrap.classList.toggle("hidden", !supportsContentType(type));
    }
    if (urlWrap) {
      urlWrap.classList.toggle("hidden", !supportsUrlType(type));
    }
    if (toggleWrap) {
      toggleWrap.classList.toggle("hidden", !isInteractiveFieldType(type));
    }
    if (scaleWrap) {
      scaleWrap.classList.toggle("hidden", !supportsScaleType(type));
    }
  });
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
    fields: normalizeFormFields(defaultFormFieldLibrary),
  };
}

function getSelectedForm() {
  return pagesCache.find((page) => page.id === selectedFormId) || null;
}

function createCustomFieldDraft() {
  const suffix = Math.random().toString(36).slice(2, 7);
  return {
    key: `custom-${suffix}`,
    label: "Custom field",
    type: "text",
    required: false,
    enabled: true,
    builtIn: false,
    options: [],
  };
}

function createBlockDraft(type) {
  const normalizedType = normalizeBuilderFieldType(type);
  const base = createCustomFieldDraft();
  const labelMap = new Map([
    ...formBlockCatalog.input,
    ...formBlockCatalog.layout,
    ...formBlockCatalog.embed,
  ]);

  return normalizeFormFields([{
    ...base,
    label: labelMap.get(normalizedType) || "Custom field",
    type: normalizedType,
    required: normalizedType === "email" || normalizedType === "text",
    enabled: !supportsContentType(normalizedType) && !supportsUrlType(normalizedType) && normalizedType !== "divider",
    content: supportsContentType(normalizedType) ? (labelMap.get(normalizedType) || "") : "",
    url: supportsUrlType(normalizedType) ? "https://" : "",
    options: supportsOptionsType(normalizedType) ? ["Option 1", "Option 2"] : [],
    min: normalizedType === "scale" ? 1 : undefined,
    max: normalizedType === "scale" ? 5 : undefined,
  }])[0];
}

function renderBuilderFieldRow(field, index) {
  const optionsValue = (field.options || []).join("\n");
  const type = normalizeBuilderFieldType(field.type);
  const supportsOptions = supportsOptionsType(type);
  const supportsContent = supportsContentType(type);
  const supportsUrl = supportsUrlType(type);
  const supportsScale = supportsScaleType(type);
  const isInteractive = isInteractiveFieldType(type);
  return `
    <article class="builder-field-card" data-builder-field-row="${index}">
      <div class="builder-field-head">
        <strong>${escapeHtml(field.builtIn ? "Core field" : "Custom field")}</strong>
        ${field.builtIn ? '<span class="chip-link">Built-in</span>' : `<button class="link-button danger" type="button" data-remove-builder-field="${index}">Remove</button>`}
      </div>
      <div class="builder-field-grid">
        <label class="field-label">Label<input class="url-input" type="text" value="${escapeHtml(field.label)}" data-builder-label="${index}" placeholder="Field label"></label>
        <label class="field-label">Key<input class="url-input" type="text" value="${escapeHtml(field.key)}" data-builder-key="${index}" placeholder="field-key" ${field.builtIn ? "disabled" : ""}></label>
        <label class="field-label">Type
          <select class="url-input domain-select" data-builder-type="${index}">
            ${[
              "text", "textarea", "radio", "checkbox", "select", "multiselect", "number", "email", "tel", "url", "file", "date", "time", "scale",
              "pagebreak", "thankyou", "textblock", "heading1", "heading2", "heading3", "divider", "title", "label", "image", "video", "audio", "embed",
            ].map((optionType) => `<option value="${optionType}" ${type === optionType ? "selected" : ""}>${optionType}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="builder-field-toggle-row ${isInteractive ? "" : "hidden"}" data-builder-toggle-wrap="${index}">
        <label class="field-toggle"><input type="checkbox" data-builder-enabled="${index}" ${field.enabled ? "checked" : ""}><span>Show field</span></label>
        <label class="field-toggle"><input type="checkbox" data-builder-required="${index}" ${field.required ? "checked" : ""}><span>Required</span></label>
      </div>
      <label class="field-label builder-content-block ${supportsContent ? "" : "hidden"}" data-builder-content-wrap="${index}">
        Content
        <textarea class="url-input textarea-input builder-options-input" rows="4" data-builder-content="${index}" placeholder="Write the block content here">${escapeHtml(field.content || "")}</textarea>
      </label>
      <label class="field-label builder-content-block ${supportsUrl ? "" : "hidden"}" data-builder-url-wrap="${index}">
        Media / Embed URL
        <input class="url-input" type="text" value="${escapeHtml(field.url || "")}" data-builder-url="${index}" placeholder="https://...">
      </label>
      <label class="field-label builder-options-block ${supportsOptions ? "" : "hidden"}" data-builder-options-wrap="${index}">
        Options
        <textarea class="url-input textarea-input builder-options-input" rows="4" data-builder-options="${index}" placeholder="One option per line">${escapeHtml(optionsValue)}</textarea>
      </label>
      <div class="builder-field-grid builder-scale-grid ${supportsScale ? "" : "hidden"}" data-builder-scale-wrap="${index}">
        <label class="field-label">Min<input class="url-input" type="number" value="${escapeHtml(field.min ?? 1)}" data-builder-min="${index}" min="0" step="1"></label>
        <label class="field-label">Max<input class="url-input" type="number" value="${escapeHtml(field.max ?? 5)}" data-builder-max="${index}" min="1" step="1"></label>
      </div>
    </article>
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
  const draft = collectFormBuilderDraftFromDom();
  const {
    id,
    title,
    slug,
    headline,
    description,
    submitLabel,
    thanksMessage,
    fields,
  } = draft;

  if (!title) return showGlobalMessage("Form name is required.", true);
  if (!slug) return showGlobalMessage("Public slug is required.", true);
  if (!fields.some((field) => field.enabled)) return showGlobalMessage("Enable at least one field in your form.", true);

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
    formBuilderDraftCache = null;
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
    formBuilderDraftCache = createEmptyFormDraft();
    await loadPages();
    renderPagesBuilder();
    showGlobalMessage("Form deleted successfully.", false);
  } catch (error) {
    showGlobalMessage(error.message, true);
  }
}

function renderFormSubmissions(submissions, fields = []) {
  if (!submissions.length) {
    return '<div class="empty-state">No submissions yet. Share the public form link and new responses will appear here.</div>';
  }

  const labelMap = new Map((fields || []).map((field) => [field.key, field.label]));

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
                <strong>${escapeHtml(labelMap.get(key) || formatFieldLabel(key))}</strong>
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
              <strong class="analytics-section-title">Languages</strong>
              <div class="analytics-list compact-list">${renderAnalyticsBadges(analytics.topLanguages)}</div>
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
        <div class="admin-table analytics-recent-table">${renderTrackedClickRows(analytics.recentClicks, false)}</div>
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
                <div><strong>Languages</strong><div class="analytics-list compact-list">${renderAnalyticsBadges(link.topLanguages)}</div></div>
                <div><strong>Referrers</strong><div class="analytics-list compact-list">${renderAnalyticsBadges(link.topReferrers)}</div></div>
              </div>
              <div class="admin-table analytics-click-table">${renderTrackedClickRows(link.recentClicks, true)}</div>
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

function renderTrackedClickRows(clicks, compact) {
  if (!clicks || !clicks.length) {
    return '<div class="empty-state">No clicks recorded yet.</div>';
  }

  return clicks.map((click) => `
    <div class="admin-row analytics-row ${compact ? "compact" : ""}">
      <div class="admin-main">
        ${click.slug ? `<strong>${escapeHtml(click.slug)}</strong>` : ""}
        <span>${escapeHtml(new Date(click.clickedAt).toLocaleString())}</span>
        <span>${escapeHtml(click.country || "Unknown")} / ${escapeHtml(click.city || "Unknown")}</span>
        <span>${escapeHtml(click.deviceType || "Unknown")} / ${escapeHtml(click.platform || "Unknown")} / ${escapeHtml(click.browser || "Unknown")}</span>
        <span>${escapeHtml(click.language || "Unknown")} / ${click.visitorId ? "Known visitor" : "Fingerprint estimate"}</span>
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
  const linkDomainInput = document.getElementById("linkDomain");
  const qrToggle = document.getElementById("qrToggle");
  const resultBanner = document.getElementById("resultBanner");
  const shortBaseLabel = document.getElementById("shortBaseLabel");

  const updatePreview = () => {
    const previewDomain = sanitizeDomain(linkDomainInput?.value || "") || settingsCache.defaultDomain;
    shortBaseLabel.textContent = buildDomainPreview(previewDomain, sanitizeSlug(slugInput.value.trim()) || "your-slug");
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
          domain: linkDomainInput?.value || settingsCache.defaultDomain,
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
  linkDomainInput?.addEventListener("change", updatePreview);
  updatePreview();
}

function wireLinkActions() {
  document.querySelectorAll("[data-edit-link-card]").forEach((button) => button.addEventListener("click", () => {
    selectedLinkSlug = button.getAttribute("data-edit-link-card");
    renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
  }));

  document.getElementById("closeLinkEditorButton")?.addEventListener("click", () => {
    selectedLinkSlug = "";
    renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
  });

  document.getElementById("saveLinkEditButton")?.addEventListener("click", async () => {
    const currentSlug = document.getElementById("saveLinkEditButton").getAttribute("data-edit-link");
    const nextSlug = sanitizeSlug(document.getElementById("editLinkSlugInput").value.trim());
    const destination = document.getElementById("editLinkDestinationInput").value.trim();
    const domain = document.getElementById("editLinkDomainInput")?.value || settingsCache.defaultDomain;
    const includeQr = Boolean(document.getElementById("editLinkQrInput")?.checked);

    try {
      const response = await fetch(`/api/links/${encodeURIComponent(currentSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: nextSlug, destination, domain, includeQr }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.details || payload.error || "Unable to update link.");

      linksCache = linksCache.map((item) => (item.slug === currentSlug ? payload.link : item));

      let nextSettings = settingsCache;

      if (currentSlug !== payload.link.slug && settingsCache.linkRules?.[currentSlug]) {
        const nextRules = { ...(settingsCache.linkRules || {}) };
        nextRules[payload.link.slug] = nextRules[currentSlug];
        delete nextRules[currentSlug];
        nextSettings = normalizeSettings({ ...nextSettings, linkRules: nextRules });
      }

      if (currentSlug !== payload.link.slug && settingsCache.conversionGoals?.[currentSlug]) {
        const nextGoals = { ...(nextSettings.conversionGoals || {}) };
        nextGoals[payload.link.slug] = nextGoals[currentSlug];
        delete nextGoals[currentSlug];
        nextSettings = normalizeSettings({ ...nextSettings, conversionGoals: nextGoals });
      }

      if (nextSettings !== settingsCache) {
        await saveSettings({
          workspaceName: nextSettings.workspaceName,
          defaultDomain: nextSettings.defaultDomain,
          domains: nextSettings.domains,
          conversionGoals: nextSettings.conversionGoals,
          linkRules: nextSettings.linkRules,
          campaigns: nextSettings.campaigns,
        });
      }

      selectedLinkSlug = payload.link.slug;
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Updated link: ${payload.link.slug}`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });

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
      if (!response.ok) throw new Error(payload.details || payload.error || "Delete failed");
      linksCache = linksCache.filter((item) => item.slug !== slug);
      if (selectedLinkSlug === slug) {
        selectedLinkSlug = "";
      }
      settingsCache = normalizeSettings({
        ...settingsCache,
        trashLinks: payload.trashLinks || settingsCache.trashLinks,
      });
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Deleted: ${slug}`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));

  document.querySelectorAll("[data-restore-link]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-restore-link");
    try {
      const response = await fetch(`/api/trash-links/${encodeURIComponent(slug)}/restore`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Restore failed");
      if (payload.link) {
        linksCache.unshift(payload.link);
      }
      settingsCache = normalizeSettings({
        ...settingsCache,
        trashLinks: payload.trashLinks || [],
      });
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Restored: ${slug}`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));

  document.querySelectorAll("[data-delete-forever]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-delete-forever");
    try {
      const response = await fetch(`/api/trash-links/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Permanent delete failed");
      settingsCache = normalizeSettings({
        ...settingsCache,
        trashLinks: payload.trashLinks || [],
      });
      renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
      showGlobalMessage(`Removed forever: ${slug}`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));
}

function bindGoalActions() {
  document.getElementById("checkAllLinksHealthButton")?.addEventListener("click", async () => {
    await runLinksHealthCheck();
  });

  document.querySelectorAll("[data-check-health]").forEach((button) => button.addEventListener("click", async () => {
    const slug = button.getAttribute("data-check-health");
    await runLinksHealthCheck(slug);
  }));

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
    const startInput = document.querySelector(`[data-start-input="${slug}"]`);
    const expiryInput = document.querySelector(`[data-expiry-input="${slug}"]`);
    const pauseInput = document.querySelector(`[data-pause-input="${slug}"]`);
    const oneTimeInput = document.querySelector(`[data-onetime-input="${slug}"]`);
    const abEnabledInput = document.querySelector(`[data-ab-enabled-input="${slug}"]`);
    const abWeightInput = document.querySelector(`[data-ab-weight-input="${slug}"]`);
    const abAInput = document.querySelector(`[data-ab-a-input="${slug}"]`);
    const abBInput = document.querySelector(`[data-ab-b-input="${slug}"]`);
    const geoCountryInput = document.querySelector(`[data-geo-country-input="${slug}"]`);
    const geoDestinationInput = document.querySelector(`[data-geo-destination-input="${slug}"]`);
    const deviceTypeInput = document.querySelector(`[data-device-type-input="${slug}"]`);
    const deviceDestinationInput = document.querySelector(`[data-device-destination-input="${slug}"]`);
    const pixelIdInput = document.querySelector(`[data-pixel-id-input="${slug}"]`);
    const startsAt = String(startInput?.value || "").trim();
    const expiresAt = String(expiryInput?.value || "").trim();
    const isPaused = Boolean(pauseInput?.checked);
    const isOneTime = Boolean(oneTimeInput?.checked);
    const abEnabled = Boolean(abEnabledInput?.checked);
    const abWeightA = Math.min(95, Math.max(5, Number(abWeightInput?.value || 50) || 50));
    const abDestinationA = String(abAInput?.value || "").trim();
    const abDestinationB = String(abBInput?.value || "").trim();
    const geoCountry = String(geoCountryInput?.value || "").trim().toUpperCase().slice(0, 2);
    const geoDestination = String(geoDestinationInput?.value || "").trim();
    const geoRedirects = geoCountry && geoDestination ? [{ country: geoCountry, destination: geoDestination }] : [];
    const deviceType = String(deviceTypeInput?.value || "").trim().toLowerCase();
    const deviceDestination = String(deviceDestinationInput?.value || "").trim();
    const deviceRedirects = deviceType && deviceDestination ? [{ device: deviceType, destination: deviceDestination }] : [];
    const pixelId = String(pixelIdInput?.value || "").trim();

    try {
      const nextRules = {
        ...(settingsCache.linkRules || {}),
      };

      if (!startsAt && !expiresAt && !isPaused && !isOneTime && !abEnabled && !pixelId && !geoRedirects.length && !deviceRedirects.length) {
        delete nextRules[slug];
      } else {
        nextRules[slug] = {
          ...(settingsCache.linkRules?.[slug] || {}),
          startsAt,
          expiresAt,
          isPaused,
          isOneTime,
          oneTimeUsedAt: isOneTime ? (settingsCache.linkRules?.[slug]?.oneTimeUsedAt || "") : "",
          abEnabled,
          abDestinationA,
          abDestinationB,
          abWeightA,
          geoRedirects,
          deviceRedirects,
          pixelId,
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

async function runLinksHealthCheck(slug = "") {
  try {
    showGlobalMessage(slug ? `Checking ${slug}...` : "Checking all link destinations...", false);
    const response = await fetch("/api/links/health-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slug ? { slug } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Unable to check link health.");
    }
    if (payload.settings) {
      settingsCache = normalizeSettings(payload.settings);
    }
    renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
    showGlobalMessage(`Health check completed for ${payload.checked || 0} link${(payload.checked || 0) === 1 ? "" : "s"}.`, false);
  } catch (error) {
    showGlobalMessage(error.message, true);
  }
}

function renderLinkItems(links, includeDelete) {
  if (!links.length) return '<div class="empty-state">No links yet. Create your first AnyLink above.</div>';

  return links.map((link) => {
    const liveUrl = getLinkUrl(link);
    return `
      <div class="link-item">
        <div class="link-copy">
          <strong>${escapeHtml(link.slug)}</strong>
          <a href="${escapeHtml(liveUrl)}" target="_blank" rel="noreferrer">${escapeHtml(liveUrl)}</a>
        </div>
        <div class="link-actions">
          <button class="link-button" data-copy="${escapeHtml(liveUrl)}">Copy</button>
          <a class="link-button secondary" href="${escapeHtml(liveUrl)}" target="_blank" rel="noreferrer">Open</a>
          <a class="link-button secondary" href="/qr-codes" data-open-qr="${escapeHtml(link.slug)}">QR</a>
          <button class="link-button secondary" data-edit-link-card="${escapeHtml(link.slug)}">Edit</button>
          ${includeDelete ? `<button class="link-button danger" data-delete="${escapeHtml(link.slug)}">Delete</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderTrashLinkItems(items) {
  if (!items.length) {
    return '<div class="empty-state">Deleted links will appear here for quick recovery.</div>';
  }

  return items.map((link) => `
    <div class="link-item recycle-bin-item">
      <div class="link-copy">
        <strong>${escapeHtml(link.slug)}</strong>
        <p>${escapeHtml(link.destination)}</p>
        <p>Deleted: ${escapeHtml(link.deletedAt ? new Date(link.deletedAt).toLocaleString() : "Recently")}</p>
      </div>
      <div class="link-actions">
        <button class="link-button" type="button" data-restore-link="${escapeHtml(link.slug)}">Restore</button>
        <button class="link-button danger" type="button" data-delete-forever="${escapeHtml(link.slug)}">Delete forever</button>
      </div>
    </div>
  `).join("");
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

function getLinkDomain(link) {
  const shortUrl = String(link?.shortUrl || "");
  try {
    return new URL(shortUrl).host || settingsCache.defaultDomain;
  } catch {
    return settingsCache.defaultDomain;
  }
}

function buildQrImageUrl(targetUrl, options = {}) {
  const color = String(options.foreground || "#2046d9").replace("#", "");
  const bgcolor = String(options.background || "#ffffff").replace("#", "");
  return `https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=${encodeURIComponent(targetUrl)}&color=${encodeURIComponent(color)}&bgcolor=${encodeURIComponent(bgcolor)}`;
}

function buildQrSvgUrl(targetUrl, options = {}) {
  const color = String(options.foreground || "#2046d9").replace("#", "");
  const bgcolor = String(options.background || "#ffffff").replace("#", "");
  return `https://api.qrserver.com/v1/create-qr-code/?size=520x520&format=svg&data=${encodeURIComponent(targetUrl)}&color=${encodeURIComponent(color)}&bgcolor=${encodeURIComponent(bgcolor)}`;
}

function getQrLogoText() {
  return String(qrCustomization.logoText || "SL").trim().slice(0, 3).toUpperCase() || "SL";
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function buildQrCanvas(targetUrl) {
  const canvas = document.createElement("canvas");
  canvas.width = 520;
  canvas.height = 520;
  const context = canvas.getContext("2d");
  context.fillStyle = qrCustomization.background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const qrImage = await loadImage(buildQrImageUrl(targetUrl, qrCustomization));
  context.drawImage(qrImage, 0, 0, canvas.width, canvas.height);

  const logoText = getQrLogoText();
  if (logoText) {
    const centerSize = 108;
    const x = (canvas.width - centerSize) / 2;
    const y = (canvas.height - centerSize) / 2;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect(x, y, centerSize, centerSize, 26);
    context.fill();
    context.strokeStyle = qrCustomization.foreground;
    context.lineWidth = 6;
    context.stroke();
    context.fillStyle = qrCustomization.foreground;
    context.font = "800 44px Segoe UI";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(logoText, canvas.width / 2, canvas.height / 2 + 2);
  }

  return canvas;
}

async function exportQrPng(sample, targetUrl) {
  const canvas = await buildQrCanvas(targetUrl);
  canvas.toBlob((blob) => blob && downloadBlob(`anylink-${sample.slug}-qr.png`, blob), "image/png");
}

async function exportQrSvg(sample, targetUrl) {
  const qrSvg = await fetch(buildQrSvgUrl(targetUrl, qrCustomization)).then((response) => response.text());
  const baseSvg = qrSvg.replace(/<\/svg>\s*$/i, "");
  const logoText = getQrLogoText();
  const overlay = logoText
    ? `<g><rect x="206" y="206" width="108" height="108" rx="24" fill="#ffffff" stroke="${qrCustomization.foreground}" stroke-width="6"/><text x="260" y="268" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="42" font-weight="800" fill="${qrCustomization.foreground}">${escapeHtml(logoText)}</text></g>`
    : "";
  const finalSvg = `${baseSvg}${overlay}</svg>`;
  downloadBlob(`anylink-${sample.slug}-qr.svg`, new Blob([finalSvg], { type: "image/svg+xml;charset=utf-8" }));
}

async function exportQrPdf(sample, targetUrl) {
  const canvas = await buildQrCanvas(targetUrl);
  const dataUrl = canvas.toDataURL("image/png");
  const printWindow = window.open("", "_blank", "width=720,height=920");
  if (!printWindow) {
    showGlobalMessage("Pop-up blocked. Allow pop-ups to export PDF.", true);
    return;
  }
  printWindow.document.write(`<!DOCTYPE html><html><head><title>QR PDF</title><style>body{font-family:Segoe UI,Arial,sans-serif;padding:32px;text-align:center}img{width:360px;height:360px;display:block;margin:0 auto 18px}h1{font-size:22px;margin:0 0 10px}p{color:#4d628c;word-break:break-all}</style></head><body><h1>${escapeHtml(sample.slug)}</h1><img src="${dataUrl}" alt="QR code"><p>${escapeHtml(targetUrl)}</p><script>window.onload=()=>setTimeout(()=>window.print(),200);<\/script></body></html>`);
  printWindow.document.close();
}

function bindQrCustomizer(sample, targetUrl) {
  const previewImage = document.getElementById("qrPreviewImage");
  const foregroundInput = document.getElementById("qrForeground");
  const backgroundInput = document.getElementById("qrBackground");
  const logoInput = document.getElementById("qrLogoText");

  const rerenderPreview = () => {
    qrCustomization.foreground = foregroundInput.value;
    qrCustomization.background = backgroundInput.value;
    qrCustomization.logoText = logoInput.value.trim().slice(0, 3).toUpperCase() || "SL";
    previewImage.src = buildQrImageUrl(targetUrl, qrCustomization);
  };

  foregroundInput?.addEventListener("input", rerenderPreview);
  backgroundInput?.addEventListener("input", rerenderPreview);
  logoInput?.addEventListener("input", rerenderPreview);

  document.getElementById("openQrButton")?.addEventListener("click", () => {
    window.open(buildQrImageUrl(targetUrl, qrCustomization), "_blank", "noreferrer");
  });

  document.getElementById("downloadQrPngButton")?.addEventListener("click", async () => {
    await exportQrPng(sample, targetUrl);
  });

  document.getElementById("downloadQrSvgButton")?.addEventListener("click", async () => {
    await exportQrSvg(sample, targetUrl);
  });

  document.getElementById("downloadQrPdfButton")?.addEventListener("click", async () => {
    await exportQrPdf(sample, targetUrl);
  });
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
  const editing = settingsCache.campaigns.find((item) => item.id === selectedCampaignId) || null;
  const templateMap = new Map();
  builtInCampaignTemplates.forEach((item) => templateMap.set(item.id, item));
  (settingsCache.campaignTemplates || []).forEach((item) => templateMap.set(item.id, item));
  const templateItems = [...templateMap.values()];
  const pixelTemplateItems = settingsCache.pixelTemplates || [];
  const campaignItems = settingsCache.campaigns.map((item) => {
    const statusLabel = item.status.charAt(0).toUpperCase() + item.status.slice(1);
    return `
      <div class="campaign-item">
        <div class="campaign-main">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.source || "No source")} / ${escapeHtml(item.medium || "No medium")} / ${escapeHtml(item.campaign || "No campaign")}</span>
          <span>${escapeHtml(item.generatedUrl || item.destination || "No tracked URL yet")}</span>
          ${item.shortUrl ? `<a class="campaign-inline-link" href="${escapeHtml(item.shortUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.shortUrl)}</a>` : ""}
        </div>
        <div class="campaign-actions">
          <span class="domain-status ${item.status}">${escapeHtml(statusLabel)}</span>
          <button class="link-button secondary" data-copy-campaign-url="${escapeHtml(item.generatedUrl || item.destination || "")}" ${!(item.generatedUrl || item.destination) ? "disabled" : ""}>Copy URL</button>
          <button class="link-button secondary" data-edit-campaign="${escapeHtml(item.id)}">Edit</button>
          <button class="link-button danger" data-delete-campaign="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  mainContent.innerHTML = `
    <section class="surface-card two-column campaign-builder-layout">
      <div class="form-card">
        <div class="surface-header">
          <div>
            <h2>UTM campaign builder</h2>
            <p>Create tracked URLs, save your campaign metadata, and optionally generate a short link instantly.</p>
          </div>
          <span class="chip-link">${settingsCache.campaigns.length} saved</span>
        </div>
        <div class="campaign-template-row">
          ${templateItems.map((tpl) => `<button class="link-button secondary" type="button" data-apply-template="${escapeHtml(tpl.id)}">${escapeHtml(tpl.name)}</button>`).join("")}
          <button class="link-button" type="button" id="saveCampaignTemplateButton">Save as template</button>
        </div>
        <div class="campaign-template-row">
          <select id="campaignPixelTemplate" class="url-input">
            <option value="">Pixel template (optional)</option>
            ${pixelTemplateItems.map((item) => `<option value="${escapeHtml(item.id)}" ${editing?.pixelTemplateId === item.id ? "selected" : ""}>${escapeHtml(item.name)} (${escapeHtml(item.pixelId)})</option>`).join("")}
          </select>
          <input id="campaignPixelId" class="url-input" type="text" value="${escapeHtml(editing?.pixelId || "")}" placeholder="Pixel ID (adds anylink_px query)">
          <button class="link-button secondary" type="button" id="savePixelTemplateButton">Save pixel template</button>
        </div>
        <div class="campaign-builder-grid">
          <div>
            <label class="field-label" for="campaignName">Campaign name</label>
            <input id="campaignName" class="url-input" type="text" value="${escapeHtml(editing?.name || "")}" placeholder="Spring launch">
          </div>
          <div>
            <label class="field-label" for="campaignStatus">Status</label>
            <select id="campaignStatus" class="url-input">
              ${["draft", "active", "paused", "completed"].map((status) => `<option value="${status}" ${editing?.status === status ? "selected" : ""}>${status.charAt(0).toUpperCase() + status.slice(1)}</option>`).join("")}
            </select>
          </div>
          <div class="campaign-span-2">
            <label class="field-label" for="campaignDestination">Destination URL</label>
            <input id="campaignDestination" class="url-input" type="url" value="${escapeHtml(editing?.destination || "")}" placeholder="https://example.com/landing-page">
          </div>
          <div>
            <label class="field-label" for="campaignSource">UTM source</label>
            <input id="campaignSource" class="url-input" type="text" value="${escapeHtml(editing?.source || "")}" placeholder="facebook">
          </div>
          <div>
            <label class="field-label" for="campaignMedium">UTM medium</label>
            <input id="campaignMedium" class="url-input" type="text" value="${escapeHtml(editing?.medium || "")}" placeholder="paid-social">
          </div>
          <div>
            <label class="field-label" for="campaignCode">UTM campaign</label>
            <input id="campaignCode" class="url-input" type="text" value="${escapeHtml(editing?.campaign || "")}" placeholder="spring-launch">
          </div>
          <div>
            <label class="field-label" for="campaignTerm">UTM term</label>
            <input id="campaignTerm" class="url-input" type="text" value="${escapeHtml(editing?.term || "")}" placeholder="lookalike-audience">
          </div>
          <div>
            <label class="field-label" for="campaignContent">UTM content</label>
            <input id="campaignContent" class="url-input" type="text" value="${escapeHtml(editing?.content || "")}" placeholder="video-variation-a">
          </div>
          <div>
            <label class="field-label" for="campaignSlug">Optional short slug</label>
            <input id="campaignSlug" class="url-input" type="text" value="${escapeHtml(editing?.slug || "")}" placeholder="spring-launch">
          </div>
          <div class="campaign-span-2">
            <label class="field-label" for="campaignNotes">Internal notes</label>
            <textarea id="campaignNotes" class="url-input" rows="3" placeholder="Creative brief, audience notes, budget, owner...">${escapeHtml(editing?.notes || "")}</textarea>
          </div>
        </div>
        <div class="campaign-preview-card">
          <span class="field-label">Tracked preview</span>
          <strong id="campaignPreviewUrl">${escapeHtml(buildCampaignTrackedUrl(editing || {}))}</strong>
        </div>
        <div class="campaign-builder-actions">
          <button class="link-button" id="saveCampaignButton">${editing ? "Update campaign" : "Save campaign"}</button>
          <button class="link-button secondary" id="createCampaignLinkButton">Create short link</button>
          <button class="link-button secondary" id="copyCampaignPreviewButton">Copy tracked URL</button>
          ${editing ? '<button class="link-button secondary" id="resetCampaignEditorButton">New campaign</button>' : ""}
        </div>
        <div class="result-banner hidden" id="campaignBanner"></div>
      </div>
      <div class="form-card">
        <div class="surface-header">
          <div>
            <h3>Saved campaigns</h3>
            <p>Use this as your private UTM library and regenerate short links anytime.</p>
          </div>
        </div>
        <div class="campaign-list">${campaignItems || '<div class="empty-state">No campaigns yet. Save your first UTM campaign from the builder.</div>'}</div>
      </div>
    </section>
  `;

  bindCampaignBuilder(editing);
}

function buildCampaignTrackedUrl(campaign) {
  const destination = String(campaign.destination || "").trim();
  if (!destination) {
    return "Add a destination URL to preview the tracked campaign link.";
  }

  try {
    const url = new URL(destination);
    if (campaign.source) url.searchParams.set("utm_source", campaign.source);
    if (campaign.medium) url.searchParams.set("utm_medium", campaign.medium);
    if (campaign.campaign) url.searchParams.set("utm_campaign", campaign.campaign);
    if (campaign.term) url.searchParams.set("utm_term", campaign.term);
    if (campaign.content) url.searchParams.set("utm_content", campaign.content);
    if (campaign.pixelId) url.searchParams.set("anylink_px", campaign.pixelId);
    return url.toString();
  } catch {
    return "Enter a valid destination URL to preview the tracked link.";
  }
}

function collectCampaignFormValue(editing) {
  return {
    id: editing?.id || crypto.randomUUID(),
    name: document.getElementById("campaignName").value.trim(),
    status: document.getElementById("campaignStatus").value,
    destination: document.getElementById("campaignDestination").value.trim(),
    source: document.getElementById("campaignSource").value.trim(),
    medium: document.getElementById("campaignMedium").value.trim(),
    campaign: document.getElementById("campaignCode").value.trim(),
    term: document.getElementById("campaignTerm").value.trim(),
    content: document.getElementById("campaignContent").value.trim(),
    pixelTemplateId: document.getElementById("campaignPixelTemplate")?.value?.trim() || "",
    pixelId: document.getElementById("campaignPixelId")?.value?.trim() || "",
    slug: sanitizeSlug(document.getElementById("campaignSlug").value.trim()),
    notes: document.getElementById("campaignNotes").value.trim(),
    shortUrl: editing?.shortUrl || "",
    createdAt: editing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function persistCampaigns(nextCampaigns, successMessage) {
  await saveSettings({
    workspaceName: settingsCache.workspaceName,
    defaultDomain: settingsCache.defaultDomain,
    domains: settingsCache.domains,
    campaigns: nextCampaigns,
  });
  renderCampaignsPage();
  showGlobalMessage(successMessage, false);
}

function bindCampaignBuilder(editing) {
  const banner = document.getElementById("campaignBanner");
  const previewNode = document.getElementById("campaignPreviewUrl");
  const formIds = ["campaignDestination", "campaignSource", "campaignMedium", "campaignCode", "campaignTerm", "campaignContent", "campaignPixelId"];

  const refreshPreview = () => {
    previewNode.textContent = buildCampaignTrackedUrl(collectCampaignFormValue(editing));
  };

  formIds.forEach((id) => document.getElementById(id)?.addEventListener("input", refreshPreview));

  const applyTemplate = (template) => {
    if (!template) return;
    document.getElementById("campaignSource").value = template.source || "";
    document.getElementById("campaignMedium").value = template.medium || "";
    document.getElementById("campaignCode").value = template.campaign || "";
    document.getElementById("campaignTerm").value = template.term || "";
    document.getElementById("campaignContent").value = template.content || "";
    if (!document.getElementById("campaignName").value.trim()) {
      document.getElementById("campaignName").value = template.name || "";
    }
    refreshPreview();
  };

  const applyPixelTemplate = (templateId) => {
    const selected = (settingsCache.pixelTemplates || []).find((item) => item.id === templateId);
    if (!selected) return;
    document.getElementById("campaignPixelId").value = selected.pixelId || "";
    refreshPreview();
  };

  document.querySelectorAll("[data-apply-template]").forEach((button) => button.addEventListener("click", () => {
    const id = button.getAttribute("data-apply-template");
    const source = [...builtInCampaignTemplates, ...(settingsCache.campaignTemplates || [])]
      .find((item) => item.id === id);
    applyTemplate(source);
    setInlineBanner(banner, `Template applied: ${source?.name || "Campaign template"}.`, false);
  }));

  document.getElementById("campaignPixelTemplate")?.addEventListener("change", (event) => {
    applyPixelTemplate(event.target.value);
  });

  document.getElementById("saveCampaignTemplateButton")?.addEventListener("click", async () => {
    const current = collectCampaignFormValue(editing);
    if (!current.name || !current.source || !current.medium || !current.campaign) {
      setInlineBanner(banner, "Template માટે name + source + medium + campaign required છે.", true);
      return;
    }

    const template = {
      id: crypto.randomUUID(),
      name: current.name,
      source: current.source,
      medium: current.medium,
      campaign: current.campaign,
      term: current.term,
      content: current.content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: settingsCache.defaultDomain,
        domains: settingsCache.domains,
        campaigns: settingsCache.campaigns,
        campaignTemplates: [template, ...(settingsCache.campaignTemplates || []).filter((item) => item.name !== template.name)],
      });
      renderCampaignsPage();
      showGlobalMessage(`Template saved: ${template.name}`, false);
    } catch (error) {
      setInlineBanner(banner, error.message, true);
    }
  });

  document.getElementById("savePixelTemplateButton")?.addEventListener("click", async () => {
    const pixelId = document.getElementById("campaignPixelId")?.value?.trim() || "";
    if (!pixelId) {
      setInlineBanner(banner, "Pixel ID required to save a template.", true);
      return;
    }
    const nameBase = document.getElementById("campaignName")?.value?.trim() || "Pixel";
    const template = {
      id: crypto.randomUUID(),
      name: `${nameBase} Pixel`,
      pixelId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: settingsCache.defaultDomain,
        domains: settingsCache.domains,
        campaigns: settingsCache.campaigns,
        campaignTemplates: settingsCache.campaignTemplates,
        pixelTemplates: [template, ...(settingsCache.pixelTemplates || []).filter((item) => item.pixelId !== template.pixelId)],
      });
      renderCampaignsPage();
      showGlobalMessage(`Pixel template saved: ${template.name}`, false);
    } catch (error) {
      setInlineBanner(banner, error.message, true);
    }
  });

  document.getElementById("saveCampaignButton")?.addEventListener("click", async () => {
    const nextCampaign = collectCampaignFormValue(editing);
    if (!nextCampaign.name || !nextCampaign.destination) {
      setInlineBanner(banner, "Campaign name and destination URL are required.", true);
      return;
    }

    nextCampaign.generatedUrl = buildCampaignTrackedUrl(nextCampaign);
    const nextCampaigns = [
      nextCampaign,
      ...settingsCache.campaigns.filter((item) => item.id !== nextCampaign.id),
    ];

    try {
      await persistCampaigns(nextCampaigns, editing ? "Campaign updated." : "Campaign saved.");
      selectedCampaignId = nextCampaign.id;
    } catch (error) {
      setInlineBanner(banner, error.message, true);
    }
  });

  document.getElementById("copyCampaignPreviewButton")?.addEventListener("click", async () => {
    const preview = buildCampaignTrackedUrl(collectCampaignFormValue(editing));
    if (!preview.startsWith("http")) {
      setInlineBanner(banner, "Enter a valid destination URL first.", true);
      return;
    }

    try {
      await navigator.clipboard.writeText(preview);
      setInlineBanner(banner, "Tracked URL copied.", false);
    } catch {
      setInlineBanner(banner, "Copy failed. Copy the preview URL manually.", true);
    }
  });

  document.getElementById("createCampaignLinkButton")?.addEventListener("click", async () => {
    const nextCampaign = collectCampaignFormValue(editing);
    const trackedUrl = buildCampaignTrackedUrl(nextCampaign);
    if (!nextCampaign.name || !trackedUrl.startsWith("http")) {
      setInlineBanner(banner, "Enter a valid destination URL before generating a short link.", true);
      return;
    }

    setInlineBanner(banner, "Creating tracked short link...", false);
    try {
      const response = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: trackedUrl,
          slug: nextCampaign.slug,
          includeQr: false,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setInlineBanner(banner, payload.error || "Could not create short link.", true);
        return;
      }

      linksCache.unshift(payload.link);
      nextCampaign.generatedUrl = trackedUrl;
      nextCampaign.shortUrl = payload.link.shortUrl;
      nextCampaign.slug = payload.link.slug;
      const nextCampaigns = [
        nextCampaign,
        ...settingsCache.campaigns.filter((item) => item.id !== nextCampaign.id),
      ];
      await persistCampaigns(nextCampaigns, "Tracked short link created.");
      selectedCampaignId = nextCampaign.id;
    } catch (error) {
      setInlineBanner(banner, error.message, true);
    }
  });

  document.getElementById("resetCampaignEditorButton")?.addEventListener("click", () => {
    selectedCampaignId = "";
    renderCampaignsPage();
  });

  document.querySelectorAll("[data-edit-campaign]").forEach((button) => button.addEventListener("click", () => {
    selectedCampaignId = button.getAttribute("data-edit-campaign");
    renderCampaignsPage();
  }));

  document.querySelectorAll("[data-delete-campaign]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.getAttribute("data-delete-campaign");
    const nextCampaigns = settingsCache.campaigns.filter((item) => item.id !== id);
    if (selectedCampaignId === id) {
      selectedCampaignId = "";
    }
    try {
      await persistCampaigns(nextCampaigns, "Campaign deleted.");
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  }));

  document.querySelectorAll("[data-copy-campaign-url]").forEach((button) => button.addEventListener("click", async () => {
    const url = button.getAttribute("data-copy-campaign-url");
    if (!url) {
      showGlobalMessage("No tracked URL saved for this campaign yet.", true);
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      showGlobalMessage("Tracked URL copied.", false);
    } catch {
      showGlobalMessage("Copy failed. Please copy the URL manually.", true);
    }
  }));
}

function renderDomainsPage() {
  const domainEntries = settingsCache.domainEntries || settingsCache.domains.map((domain) => ({
    host: domain,
    status: domain === publicShortDomain ? "APP_DEFAULT" : (domain === settingsCache.defaultDomain ? "ACTIVE" : "PENDING"),
    isActive: domain === settingsCache.defaultDomain,
    dnsTarget: settingsCache.providerDnsTarget || publicShortDomain,
  }));

  const managedDomainsMarkup = domainEntries.map((entry) => {
    const domain = entry.host;
    const isDefaultAppDomain = domain === publicShortDomain;
    const isActive = Boolean(entry.isActive) || domain === settingsCache.defaultDomain;
    const normalizedStatus = String(entry.status || "PENDING").toUpperCase();
    const syncState = domainSyncState[domain];
    const syncInProgress = Boolean(syncState && syncState.inProgress);
    const dnsRecord = inferDnsRecordForDomain(domain);
    const statusLabel = isDefaultAppDomain
      ? "App Default"
      : (isActive ? "Active" : normalizedStatus.charAt(0) + normalizedStatus.slice(1).toLowerCase());
    const finalStatusLabel = (!isActive && normalizedStatus === "PENDING" && syncInProgress)
      ? "Pending (syncing)"
      : statusLabel;

    return `
      <div class="managed-domain ${isActive ? "active" : ""}">
        <div class="managed-domain-copy">
          <strong>${escapeHtml(domain)}</strong>
          <span>${escapeHtml(buildDomainPreview(domain))}</span>
          ${!isDefaultAppDomain ? `<div class="dns-helper-grid"><span><strong>Type</strong>${escapeHtml(dnsRecord.type)}</span><span><strong>Host</strong>${escapeHtml(dnsRecord.host)}</span><span><strong>Value</strong>${escapeHtml(entry.dnsTarget || dnsRecord.value || publicShortDomain)}</span></div>` : ""}
        </div>
        <div class="managed-domain-actions">
          <span class="domain-status ${normalizedStatus.toLowerCase()}">${escapeHtml(finalStatusLabel)}</span>
          ${!isDefaultAppDomain && !isActive && normalizedStatus === "VERIFIED" ? `<button class="link-button" data-activate-domain="${escapeHtml(domain)}">Set active</button>` : ""}
          ${!isDefaultAppDomain ? `<button class="link-button secondary" data-copy-dns="${escapeHtml(domain)}">Copy DNS</button>` : ""}
          ${!isDefaultAppDomain && normalizedStatus !== "VERIFIED" && normalizedStatus !== "ACTIVE" ? `<button class="link-button secondary" data-verify-domain="${escapeHtml(domain)}" ${syncInProgress ? "disabled" : ""}>${syncInProgress ? "Syncing..." : "Verify / Sync"}</button>` : ""}
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
            <p>Add as many custom domains as you want. Only one stays active for fresh short links at a time.</p>
          </div>
          <span class="data-pill">${domainEntries.length} saved</span>
        </div>
        <div class="managed-domain-stack">${managedDomainsMarkup || `<p class="helper-copy">No custom domains added yet.</p>`}</div>
      </div>
      <div>
        <div class="form-card">
          <h3>Auto DNS (GoDaddy)</h3>
          <p class="helper-copy">Connect a GoDaddy API key to let AnyLink add the CNAME record automatically when you add a new domain.</p>
          <div class="domain-automation-status" id="domainAutomationStatus"></div>
          <div id="godaddyConnectFields">
            <label class="field-label" for="godaddyApiKey">GoDaddy API key</label>
            <input id="godaddyApiKey" class="url-input" type="text" placeholder="your-api-key">
            <label class="field-label" for="godaddyApiSecret">GoDaddy API secret</label>
            <input id="godaddyApiSecret" class="url-input" type="password" placeholder="your-api-secret">
            <button class="primary-action inline-action" id="connectGoDaddyButton">Connect GoDaddy</button>
          </div>
          <div id="godaddyDisconnectFields" class="hidden">
            <button class="link-button danger" id="disconnectGoDaddyButton">Disconnect GoDaddy</button>
          </div>
          <p class="helper-copy">Tip: create a dedicated API key in GoDaddy for DNS access only.</p>
        </div>
        <div class="form-card">
          <label class="field-label" for="domainName">Add a new custom domain</label>
          <input id="domainName" class="url-input" type="text" placeholder="yourbrand.com">
          <div class="domain-builder-grid">
            <label>
              <span class="field-label">Domain mode</span>
              <select id="domainModeSelect" class="url-input compact-select">
                <option value="recommended">Recommended subdomain</option>
                <option value="custom-subdomain">Custom subdomain</option>
              </select>
            </label>
            <label id="customSubdomainField" class="hidden">
              <span class="field-label">Subdomain</span>
              <input id="customSubdomainPrefix" class="url-input" type="text" placeholder="links">
            </label>
          </div>
          <div class="domain-mode-toggle">
            <p class="helper-copy" id="domainModeHelp">We recommend creating a branded subdomain like <strong>go.yourbrand.com</strong> because it works on most DNS providers with a simple CNAME record.</p>
          </div>
          <div class="domain-suggestion-card" id="domainSuggestionCard">
            <span class="helper-label">Generated short domain</span>
            <strong id="domainSuggestionValue">go.yourbrand.com</strong>
            <span class="helper-copy" id="domainSuggestionHelp">For most DNS providers, the recommended setup is a CNAME on <strong>go</strong>.</span>
          </div>
          <button class="primary-action inline-action" id="addDomainButton">Add domain</button>
          <p class="helper-copy">If no custom domain is active, new short links automatically use ${escapeHtml(publicShortDomain)}.</p>
        </div>
        <div class="form-card">
          <h3>DNS setup</h3>
          <p class="helper-copy" id="dnsSetupCopy">Create a <strong>CNAME</strong> record for your branded subdomain and point it to <strong>${escapeHtml(settingsCache.providerDnsTarget || publicShortDomain)}</strong>.</p>
          <div id="manualDnsWrapper">
            <div class="dns-helper-grid" id="dnsHelperGrid">
              <span><strong>Type</strong><span id="dnsTypeValue">CNAME</span></span>
              <span><strong>Host</strong><span id="dnsHostValue">go</span></span>
              <span><strong>Value</strong><span id="dnsTargetValue">${escapeHtml(settingsCache.providerDnsTarget || publicShortDomain)}</span></span>
            </div>
            <p class="helper-copy" id="dnsExampleCopy">Example: <code>go.clientdomain.com -> ${escapeHtml(settingsCache.providerDnsTarget || publicShortDomain)}</code></p>
            <p class="helper-copy" id="dnsFinalCopy">After DNS is live, click <strong>Verify / Sync</strong>. Once SSL is ready, you can set that domain active for fresh links.</p>
          </div>
          <button class="link-button secondary hidden" id="showManualDnsButton" type="button">Show manual DNS</button>
        </div>
      </div>
    </section>
  `;

  const domainInput = document.getElementById("domainName");
  const modeSelect = document.getElementById("domainModeSelect");
  const customSubdomainField = document.getElementById("customSubdomainField");
  const customSubdomainPrefix = document.getElementById("customSubdomainPrefix");
  const domainModeHelp = document.getElementById("domainModeHelp");
  const suggestionValue = document.getElementById("domainSuggestionValue");
  const suggestionHelp = document.getElementById("domainSuggestionHelp");
  const dnsSetupCopy = document.getElementById("dnsSetupCopy");
  const dnsTypeValue = document.getElementById("dnsTypeValue");
  const dnsHostValue = document.getElementById("dnsHostValue");
  const dnsTargetValue = document.getElementById("dnsTargetValue");
  const dnsExampleCopy = document.getElementById("dnsExampleCopy");
  const dnsFinalCopy = document.getElementById("dnsFinalCopy");
  const manualDnsWrapper = document.getElementById("manualDnsWrapper");
  const showManualDnsButton = document.getElementById("showManualDnsButton");
  const domainAutomationStatus = document.getElementById("domainAutomationStatus");
  const godaddyConnectFields = document.getElementById("godaddyConnectFields");
  const godaddyDisconnectFields = document.getElementById("godaddyDisconnectFields");

  const automationState = settingsCache.domainAutomation || { provider: "godaddy", connected: false };
  if (automationState.connected) {
    domainAutomationStatus.innerHTML = "<span class=\"domain-status verified\">Connected</span> GoDaddy auto DNS is enabled.";
    godaddyConnectFields.classList.add("hidden");
    godaddyDisconnectFields.classList.remove("hidden");
    dnsSetupCopy.innerHTML = "Auto DNS is ON. We will create the <strong>CNAME</strong> record in GoDaddy automatically after you add a domain.";
    manualDnsWrapper.classList.add("hidden");
    showManualDnsButton.classList.remove("hidden");
  } else {
    domainAutomationStatus.innerHTML = "<span class=\"domain-status pending\">Not connected</span> Add your GoDaddy API keys to enable auto DNS.";
    godaddyConnectFields.classList.remove("hidden");
    godaddyDisconnectFields.classList.add("hidden");
    manualDnsWrapper.classList.remove("hidden");
    showManualDnsButton.classList.add("hidden");
  }

  showManualDnsButton.addEventListener("click", () => {
    manualDnsWrapper.classList.toggle("hidden");
    showManualDnsButton.textContent = manualDnsWrapper.classList.contains("hidden") ? "Show manual DNS" : "Hide manual DNS";
  });

  const syncDomainSuggestion = () => {
    const rawDomain = sanitizeDomain(domainInput.value.trim()) || "yourbrand.com";
    const mode = modeSelect.value || "recommended";
    const customPrefix = customSubdomainPrefix.value.trim();
    const suggestedDomain = buildSuggestedCustomDomain(rawDomain, mode, customPrefix);
    const dnsRecord = buildCustomDomainDnsRecord(rawDomain, mode, customPrefix);

    customSubdomainField.classList.toggle("hidden", mode !== "custom-subdomain");
    domainModeHelp.innerHTML = mode === "custom-subdomain"
      ? "Choose any branded subdomain you want, like <strong>links</strong>, <strong>app</strong>, <strong>promo</strong>, or <strong>shop</strong>."
      : "We recommend creating a branded subdomain like <strong>go.yourbrand.com</strong> because it works on most DNS providers with a simple CNAME record.";

    suggestionValue.textContent = suggestedDomain;
    suggestionHelp.innerHTML = mode === "custom-subdomain"
      ? "This custom branded subdomain uses a simple <strong>CNAME</strong> record and works well for teams that want multiple branded hosts."
      : "For most DNS providers, this recommended setup is easiest because it uses a simple <strong>CNAME</strong> record.";
    const providerTarget = settingsCache.providerDnsTarget || publicShortDomain;
    dnsSetupCopy.innerHTML = `Create a <strong>CNAME</strong> record for your branded subdomain and point it to <strong>${escapeHtml(providerTarget)}</strong>.`;
    dnsTypeValue.textContent = dnsRecord.type;
    dnsHostValue.textContent = dnsRecord.host;
    dnsTargetValue.textContent = dnsRecord.value;
    dnsExampleCopy.innerHTML = `Example: <code>${escapeHtml(suggestedDomain)} -> ${escapeHtml(providerTarget)}</code>`;
    dnsFinalCopy.innerHTML = "After DNS is live, click <strong>Verify / Sync</strong>. Once SSL is ready, you can set that domain active for fresh links.";
  };

  syncDomainSuggestion();
  domainInput.addEventListener("input", syncDomainSuggestion);
  modeSelect.addEventListener("change", syncDomainSuggestion);
  customSubdomainPrefix.addEventListener("input", syncDomainSuggestion);

  document.getElementById("connectGoDaddyButton").addEventListener("click", async () => {
    const apiKey = document.getElementById("godaddyApiKey").value.trim();
    const apiSecret = document.getElementById("godaddyApiSecret").value.trim();
    if (!apiKey || !apiSecret) {
      return showGlobalMessage("Enter your GoDaddy API key and secret.", true);
    }
    try {
      const response = await fetch("/api/domains/godaddy/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to connect GoDaddy.");
      if (payload.settings) {
        settingsCache = normalizeSettings(payload.settings);
      }
      document.getElementById("godaddyApiKey").value = "";
      document.getElementById("godaddyApiSecret").value = "";
      renderDomainsPage();
      showGlobalMessage("GoDaddy connected. DNS will be created automatically.", false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });

  document.getElementById("disconnectGoDaddyButton").addEventListener("click", async () => {
    try {
      const response = await fetch("/api/domains/godaddy/disconnect", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to disconnect GoDaddy.");
      if (payload.settings) {
        settingsCache = normalizeSettings(payload.settings);
      }
      renderDomainsPage();
      showGlobalMessage("GoDaddy disconnected.", false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });

  document.getElementById("addDomainButton").addEventListener("click", async () => {
    const rawDomain = sanitizeDomain(domainInput.value.trim());
    if (!rawDomain) return showGlobalMessage("Enter a valid domain or host.", true);
    const domain = buildSuggestedCustomDomain(rawDomain, modeSelect.value || "recommended", customSubdomainPrefix.value.trim());
    if (settingsCache.domains.includes(domain)) return showGlobalMessage("That domain is already added.", true);
    await persistDomains(
      [...settingsCache.domains, domain],
      settingsCache.defaultDomain,
      `Domain added: ${domain}. We will auto-check DNS in the background.`
    );
    verifyDomain(domain, { autoRetry: true });
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
      const dnsTarget = settingsCache.providerDnsTarget || publicShortDomain;
      await navigator.clipboard.writeText(dnsTarget);
      showGlobalMessage(`DNS target copied for ${domain}: ${settingsCache.providerDnsTarget || publicShortDomain}`, false);
    } catch {
      showGlobalMessage(`Copy failed. Use this DNS target manually: ${settingsCache.providerDnsTarget || publicShortDomain}`, true);
    }
  }));

  document.querySelectorAll("[data-verify-domain]").forEach((button) => button.addEventListener("click", async () => {
    const domain = button.getAttribute("data-verify-domain");
    await verifyDomain(domain, { autoRetry: true });
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

async function verifyDomain(domain, options = {}) {
  const { autoRetry = false, silent = false } = options;
  const syncState = domainSyncState[domain] || {};
  if (autoRetry) {
    const attempts = Number(syncState.attempts || 0);
    updateDomainSyncState(domain, {
      inProgress: true,
      attempts,
    });
    renderDomainsPage();
    if (!syncState.notified && !silent) {
      updateDomainSyncState(domain, { notified: true });
      showGlobalMessage("We will keep checking DNS every 20 seconds until SSL is ready.", false);
    }
  }

  try {
    const response = await fetch(`/api/domains/verify/${encodeURIComponent(domain)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to verify domain.");
    if (payload.settings) {
      settingsCache = normalizeSettings(payload.settings);
      renderDomainsPage();
    }
    const hostHint = payload.hostHint || domain.split(".")[0] || domain;
    if (!silent) {
      showGlobalMessage(`${payload.message} DNS record: ${payload.recordType || "CNAME"} ${hostHint} -> ${payload.dnsTarget || settingsCache.providerDnsTarget || publicShortDomain}`, false);
    }
    if (payload.autoDnsAttempted && !payload.autoDnsError && !silent) {
      showGlobalMessage("GoDaddy DNS record created automatically. Waiting for DNS to propagate.", false);
    }
    if (payload.autoDnsError && !silent) {
      showGlobalMessage(`Auto DNS failed: ${payload.autoDnsError}`, true);
    }

    const normalizedStatus = String(payload.status || "").toUpperCase();
    const ready = payload.verified || normalizedStatus === "VERIFIED" || normalizedStatus === "ACTIVE";
    if (ready) {
      clearDomainSyncTimer(domain);
      updateDomainSyncState(domain, { inProgress: false, attempts: 0 });
      renderDomainsPage();
      return;
    }

    if (autoRetry) {
      const nextAttempts = Number((domainSyncState[domain] || {}).attempts || 0) + 1;
      if (nextAttempts <= DOMAIN_SYNC_MAX_ATTEMPTS) {
        updateDomainSyncState(domain, { attempts: nextAttempts, inProgress: true });
        scheduleDomainSync(domain);
        renderDomainsPage();
      } else {
        clearDomainSyncTimer(domain);
        updateDomainSyncState(domain, { inProgress: false });
        if (!silent) {
          showGlobalMessage("DNS is still not ready. Please confirm the CNAME record and try Verify / Sync again.", true);
        }
      }
    }
  } catch (error) {
    if (autoRetry) {
      const nextAttempts = Number((domainSyncState[domain] || {}).attempts || 0) + 1;
      if (nextAttempts <= DOMAIN_SYNC_MAX_ATTEMPTS) {
        updateDomainSyncState(domain, { attempts: nextAttempts, inProgress: true });
        scheduleDomainSync(domain);
      } else {
        clearDomainSyncTimer(domain);
        updateDomainSyncState(domain, { inProgress: false });
      }
    }
    if (!silent) {
      showGlobalMessage(error.message, true);
    }
    renderDomainsPage();
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
          <div class="form-card">
            <h3>Team & roles</h3>
            <p class="helper-copy">Add collaborators with role-based workspace access.</p>
            <div class="campaign-builder-grid">
              <input id="teamMemberName" class="url-input" type="text" placeholder="Member name">
              <input id="teamMemberEmail" class="url-input" type="email" placeholder="member@company.com">
              <select id="teamMemberRole" class="url-input">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <button class="link-button" id="addTeamMemberButton" type="button">Add member</button>
            </div>
            <div class="admin-table">
              ${renderTeamMemberRows(settingsCache.teamMembers || [])}
            </div>
          </div>
          <div class="form-card">
            <h3>Retargeting pixel templates</h3>
            <p class="helper-copy">Save reusable pixel IDs and apply them in Campaign builder.</p>
            <div class="campaign-builder-grid">
              <input id="settingsPixelTemplateName" class="url-input" type="text" placeholder="Template name (Meta Lead)">
              <input id="settingsPixelTemplateId" class="url-input" type="text" placeholder="Pixel ID">
              <button class="link-button" id="saveSettingsPixelTemplateButton" type="button">Save template</button>
            </div>
            <div class="admin-table">
              ${renderPixelTemplateRows(settingsCache.pixelTemplates || [])}
            </div>
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
            ${billingCache.subscriptionStartedAt ? `<div class="task-item"><span class="task-check filled"></span><span>Subscription start: ${escapeHtml(formatDateDisplay(billingCache.subscriptionStartedAt))}</span></div>` : ""}
            ${billingCache.subscriptionExpiresAt ? `<div class="task-item"><span class="task-check filled"></span><span>Subscription end: ${escapeHtml(formatDateDisplay(billingCache.subscriptionExpiresAt))}</span></div>` : ""}
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

  document.getElementById("addTeamMemberButton")?.addEventListener("click", async () => {
    const name = document.getElementById("teamMemberName")?.value?.trim() || "";
    const email = document.getElementById("teamMemberEmail")?.value?.trim() || "";
    const role = document.getElementById("teamMemberRole")?.value || "viewer";
    if (!email) {
      return showGlobalMessage("Member email is required.", true);
    }
    try {
      const response = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to add team member.");
      settingsCache = normalizeSettings(payload.settings || settingsCache);
      renderSettingsPage();
      showGlobalMessage("Team member added.", false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });

  document.querySelectorAll("[data-remove-team-member]").forEach((button) => {
    button.addEventListener("click", async () => {
      const memberId = button.getAttribute("data-remove-team-member");
      if (!memberId) return;
      try {
        const response = await fetch(`/api/team/${memberId}/remove`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to remove team member.");
        settingsCache = normalizeSettings(payload.settings || settingsCache);
        renderSettingsPage();
        showGlobalMessage("Team member removed.", false);
      } catch (error) {
        showGlobalMessage(error.message, true);
      }
    });
  });

  document.getElementById("saveSettingsPixelTemplateButton")?.addEventListener("click", async () => {
    const name = document.getElementById("settingsPixelTemplateName")?.value?.trim() || "";
    const pixelId = document.getElementById("settingsPixelTemplateId")?.value?.trim() || "";
    if (!pixelId) {
      return showGlobalMessage("Pixel ID is required.", true);
    }
    const nextTemplate = {
      id: crypto.randomUUID(),
      name: name || "Pixel template",
      pixelId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: settingsCache.defaultDomain,
        domains: settingsCache.domains,
        campaigns: settingsCache.campaigns,
        campaignTemplates: settingsCache.campaignTemplates,
        pixelTemplates: [nextTemplate, ...(settingsCache.pixelTemplates || []).filter((item) => item.pixelId !== pixelId)],
      });
      renderSettingsPage();
      showGlobalMessage("Pixel template saved.", false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });

  document.querySelectorAll("[data-remove-pixel-template]").forEach((button) => {
    button.addEventListener("click", async () => {
      const templateId = button.getAttribute("data-remove-pixel-template");
      if (!templateId) return;
      const nextTemplates = (settingsCache.pixelTemplates || []).filter((item) => item.id !== templateId);
      try {
        await saveSettings({
          workspaceName: settingsCache.workspaceName,
          defaultDomain: settingsCache.defaultDomain,
          domains: settingsCache.domains,
          campaigns: settingsCache.campaigns,
          campaignTemplates: settingsCache.campaignTemplates,
          pixelTemplates: nextTemplates,
        });
        renderSettingsPage();
        showGlobalMessage("Pixel template removed.", false);
      } catch (error) {
        showGlobalMessage(error.message, true);
      }
    });
  });

  bindPasswordToggles();
}

function renderTeamMemberRows(teamMembers) {
  const items = Array.isArray(teamMembers) ? teamMembers : [];
  if (!items.length) {
    return '<div class="empty-state">No team members added yet.</div>';
  }
  return items.map((member) => `
    <div class="admin-row">
      <div class="admin-main">
        <strong>${escapeHtml(member.name || member.email)}</strong>
        <span>${escapeHtml(member.email)}</span>
        <span>Role: ${escapeHtml((member.role || "viewer").toUpperCase())}</span>
      </div>
      <div class="admin-actions">
        <button class="link-button danger" data-remove-team-member="${escapeHtml(member.id)}">Remove</button>
      </div>
    </div>
  `).join("");
}

function renderPixelTemplateRows(pixelTemplates) {
  const items = Array.isArray(pixelTemplates) ? pixelTemplates : [];
  if (!items.length) {
    return '<div class="empty-state">No pixel templates saved yet.</div>';
  }
  return items.map((item) => `
    <div class="admin-row">
      <div class="admin-main">
        <strong>${escapeHtml(item.name || "Pixel template")}</strong>
        <span>Pixel: ${escapeHtml(item.pixelId || "")}</span>
        <span>Updated: ${escapeHtml(formatDateDisplay(item.updatedAt || item.createdAt || ""))}</span>
      </div>
      <div class="admin-actions">
        <button class="link-button danger" data-remove-pixel-template="${escapeHtml(item.id)}">Remove</button>
      </div>
    </div>
  `).join("");
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

function sanitizeSubdomainLabel(value) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9.-]/g, "").replace(/^\.+|\.+$/g, "");
  return cleaned || null;
}

function buildSuggestedCustomDomain(domain, mode = "recommended", customSubdomain = "") {
  const sanitized = sanitizeDomain(domain);
  if (!sanitized) return "";
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(sanitized)) return sanitized;
  if (mode === "custom-subdomain") {
    const prefix = sanitizeSubdomainLabel(customSubdomain) || "links";
    if (sanitized.startsWith(`${prefix}.`)) return sanitized;
    return `${prefix}.${sanitized}`;
  }
  if (sanitized.startsWith("go.")) return sanitized;
  const labels = sanitized.split(".").filter(Boolean);
  if (labels.length <= 1) return sanitized;
  return `go.${sanitized}`;
}

function buildCustomDomainDnsRecord(domain, mode = "recommended", customSubdomain = "") {
  const sanitized = sanitizeDomain(domain) || "yourbrand.com";
  const suggested = buildSuggestedCustomDomain(sanitized, mode, customSubdomain);
  const suffix = `.${sanitized}`;
  const host = suggested.endsWith(suffix) ? (suggested.slice(0, -suffix.length) || "go") : "go";
  return {
    type: "CNAME",
    host,
    value: settingsCache.providerDnsTarget || publicShortDomain,
  };
}

function inferDnsRecordForDomain(domain) {
  const sanitized = sanitizeDomain(domain) || "yourbrand.com";
  const labels = sanitized.split(".").filter(Boolean);
  if (labels.length <= 2) {
    return {
      type: "CNAME",
      host: "go",
      value: settingsCache.providerDnsTarget || publicShortDomain,
    };
  }
  return {
    type: "CNAME",
    host: labels.slice(0, -2).join(".") || labels[0] || "go",
    value: settingsCache.providerDnsTarget || publicShortDomain,
  };
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

function formatDateDisplay(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
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



















