const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const mainContent = document.getElementById("mainContent");
const pageTitle = document.getElementById("pageTitle");
const pageEyebrow = document.getElementById("pageEyebrow");
const searchInput = document.getElementById("searchInput");
const currentPage = getCurrentPage();

let linksCache = [];
let settingsCache = {
  workspaceName: "AnyLink Workspace",
  defaultDomain: window.location.host,
};

const pageMeta = {
  home: { eyebrow: "Workspace", title: "Home" },
  links: { eyebrow: "Library", title: "Links" },
  "qr-codes": { eyebrow: "Create", title: "QR Codes" },
  pages: { eyebrow: "Microsites", title: "Pages" },
  analytics: { eyebrow: "Performance", title: "Analytics" },
  campaigns: { eyebrow: "UTM Studio", title: "Campaigns" },
  "custom-domains": { eyebrow: "Branding", title: "Custom domains" },
  settings: { eyebrow: "Account", title: "Settings" },
};

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
  item.classList.toggle("active", item.dataset.page === currentPage);
});

searchInput.addEventListener("input", () => {
  if (currentPage === "links") {
    renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
  }
});

initialize();

async function initialize() {
  await loadSettings();

  const meta = pageMeta[currentPage] || pageMeta.home;
  pageEyebrow.textContent = meta.eyebrow;
  pageTitle.textContent = meta.title;
  document.title = `${meta.title} | ${settingsCache.workspaceName}`;

  if (["home", "links", "analytics", "qr-codes"].includes(currentPage)) {
    await loadLinks();
  }

  renderPage();
}

function getCurrentPage() {
  const cleaned = window.location.pathname.replace(/^\/+|\/+$/g, "");
  return cleaned || "home";
}

async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load settings");
    }

    settingsCache = {
      ...settingsCache,
      ...(payload.settings || {}),
    };
  } catch (error) {
    showGlobalMessage(`Could not load settings. ${error.message}`, true);
  }
}

async function saveSettings(nextSettings) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(nextSettings),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to save settings");
  }

  settingsCache = payload.settings;
  document.title = `${pageMeta[currentPage]?.title || "AnyLink"} | ${settingsCache.workspaceName}`;
  return payload.settings;
}

async function loadLinks() {
  try {
    const response = await fetch("/api/links");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load links");
    }

    linksCache = payload.links || [];
  } catch (error) {
    linksCache = [];
    showGlobalMessage(`Could not load links. ${error.message}`, true);
  }
}

function renderPage() {
  if (currentPage === "home") {
    renderHomePage();
    return;
  }

  if (currentPage === "links") {
    renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
    return;
  }

  if (currentPage === "qr-codes") {
    renderQrPage();
    return;
  }

  if (currentPage === "pages") {
    renderPagesBuilder();
    return;
  }

  if (currentPage === "analytics") {
    renderAnalyticsPage();
    return;
  }

  if (currentPage === "campaigns") {
    renderCampaignsPage();
    return;
  }

  if (currentPage === "custom-domains") {
    renderDomainsPage();
    return;
  }

  if (currentPage === "settings") {
    renderSettingsPage();
    return;
  }

  mainContent.innerHTML = `
    <section class="surface-card">
      <h2>Page not found</h2>
      <p>This dashboard page is not available.</p>
    </section>
  `;
}

function renderHomePage() {
  const activeDomain = escapeHtml(settingsCache.defaultDomain);

  mainContent.innerHTML = `
    <div class="creation-tabs">
      <button class="creation-tab active">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.5 14.5 7 17a4 4 0 1 1-5.7-5.6l3.3-3.4A4 4 0 0 1 10.3 9" />
          <path d="m14.5 9.5 2.5-2.5a4 4 0 1 1 5.7 5.6l-3.3 3.4A4 4 0 0 1 13.7 15" />
          <path d="m8.5 15.5 7-7" />
        </svg>
        <span>Short link</span>
      </button>
      <a class="creation-tab" href="/qr-codes">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
          <path d="M16 14h2M14 17h6M14 20h6M19 15v5" />
        </svg>
        <span>QR Code</span>
      </a>
    </div>

    <section class="hero-card">
      <div class="hero-main">
        <div class="hero-heading">
          <div>
            <h1>Quick create: Short link</h1>
            <p class="meta-line">Domain: <strong>${activeDomain}</strong></p>
          </div>
          <p class="limit-copy">Create, save, and open any destination with your own short URL.</p>
        </div>

        <div class="input-row">
          <div class="input-stack">
            <label for="destination" class="field-label">Enter your destination URL</label>
            <input id="destination" class="url-input" type="url" placeholder="https://example.com/my-long-url">
          </div>
          <button class="primary-action" id="createLinkButton">Create your AnyLink</button>
        </div>

        <div class="input-row secondary-row">
          <div class="input-stack">
            <label for="slug" class="field-label">Custom back-half (optional)</label>
            <input id="slug" class="url-input" type="text" placeholder="offer-2026">
          </div>
          <div class="inline-note">
            Your short link will look like:
            <strong id="shortBaseLabel">${escapeHtml(buildShortPreview("your-slug"))}</strong>
          </div>
        </div>

        <label class="checkbox-row">
          <input type="checkbox" id="qrToggle">
          <span>Also create a QR-ready entry for this link</span>
        </label>

        <div class="promo-strip">
          <span>Active domain: ${activeDomain}</span>
          <a href="/custom-domains">Change domain</a>
        </div>

        <div class="result-banner hidden" id="resultBanner" aria-live="polite"></div>
      </div>

      <aside class="hero-aside">
        <h2>Make every link easy to open</h2>
        <p>Create short links for any page, campaign, or document and share them in seconds.</p>
        <a class="aside-pill" href="/links">View all AnyLinks</a>
        <a class="aside-pill" href="/analytics">Check performance</a>
        <a class="aside-upgrade" href="/custom-domains">Set your brand domain</a>
      </aside>
    </section>

    <section class="bottom-grid">
      <article class="mini-card">
        <div class="mini-card-header">
          <h3>Recent AnyLinks</h3>
          <a href="/links">Open library</a>
        </div>
        <div class="links-list" id="homeLinksList">${renderLinkItems(linksCache.slice(0, 3), false)}</div>
      </article>

      <article class="mini-card">
        <div class="mini-card-header">
          <h3>How it works</h3>
          <div class="progress-ring">3</div>
        </div>
        <div class="task-list">
          <div class="task-item">
            <span class="task-check filled"></span>
            <span>Add any destination URL</span>
          </div>
          <div class="task-item">
            <span class="task-check filled"></span>
            <span>Choose a custom short slug if you want</span>
          </div>
          <div class="task-item">
            <span class="task-check filled"></span>
            <span>Open the short link and get redirected automatically</span>
          </div>
        </div>
      </article>
    </section>
  `;

  wireCreateForm();
}

function renderLinksPage(links, query = "") {
  const filtered = links.filter((link) => {
    if (!query) {
      return true;
    }

    return [link.slug, link.destination, link.shortUrl].some((value) =>
      String(value).toLowerCase().includes(query),
    );
  });

  mainContent.innerHTML = `
    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>All short links</h2>
          <p>Search, copy, open, and delete saved AnyLinks.</p>
        </div>
        <a class="chip-link" href="/home">Create another</a>
      </div>
      <div class="links-list" id="linksPageList">${renderLinkItems(filtered, true)}</div>
    </section>
  `;

  wireLinkActions();
}

function renderQrPage() {
  const sample = linksCache[0];

  mainContent.innerHTML = `
    <section class="surface-card two-column">
      <div>
        <div class="surface-header">
          <div>
            <h2>QR Code workspace</h2>
            <p>Create scan-ready entries for your short links.</p>
          </div>
        </div>
        <div class="qr-panel">
          <div class="qr-box">
            <div class="qr-grid"></div>
          </div>
          <div class="qr-copy">
            <strong>${sample ? escapeHtml(sample.shortUrl) : "Create a link first"}</strong>
            <p>${sample ? "Use this short link in posters, packaging, or flyers." : "Once you create a link on Home, it can appear here as a QR-ready item."}</p>
            <a class="primary-action inline-action" href="/home">Create link</a>
          </div>
        </div>
      </div>
      <div class="stack-card-group">
        <article class="mini-card inset-card">
          <h3>Best uses</h3>
          <div class="task-list">
            <div class="task-item"><span class="task-check filled"></span><span>Menu cards</span></div>
            <div class="task-item"><span class="task-check filled"></span><span>Packaging stickers</span></div>
            <div class="task-item"><span class="task-check filled"></span><span>Store displays</span></div>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderPagesBuilder() {
  mainContent.innerHTML = `
    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>Page builder</h2>
          <p>Create a simple landing page structure for campaigns.</p>
        </div>
      </div>
      <div class="builder-grid">
        <div class="form-card">
          <label class="field-label" for="pageName">Page name</label>
          <input id="pageName" class="url-input" type="text" placeholder="Summer launch page">
          <label class="field-label" for="pageHeadline">Headline</label>
          <input id="pageHeadline" class="url-input" type="text" placeholder="Everything you need in one short page">
          <label class="field-label" for="pageCta">CTA label</label>
          <input id="pageCta" class="url-input" type="text" placeholder="Get started">
        </div>
        <div class="preview-card">
          <span class="eyebrow">Live preview</span>
          <h3>Summer launch page</h3>
          <p>Everything you need in one short page</p>
          <button class="primary-action inline-action">Get started</button>
        </div>
      </div>
    </section>
  `;
}

function renderAnalyticsPage() {
  const total = linksCache.length;
  const qrReady = linksCache.filter((item) => item.includeQr).length;

  mainContent.innerHTML = `
    <section class="stat-grid">
      <article class="stat-card">
        <span>Total links</span>
        <strong>${total}</strong>
      </article>
      <article class="stat-card">
        <span>QR-ready links</span>
        <strong>${qrReady}</strong>
      </article>
      <article class="stat-card">
        <span>Active campaigns</span>
        <strong>4</strong>
      </article>
    </section>

    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>Traffic snapshot</h2>
          <p>A simple view of how your workspace is performing.</p>
        </div>
      </div>
      <div class="chart-bars">
        <div class="bar-wrap"><span>Mon</span><i style="height: 42%"></i></div>
        <div class="bar-wrap"><span>Tue</span><i style="height: 58%"></i></div>
        <div class="bar-wrap"><span>Wed</span><i style="height: 76%"></i></div>
        <div class="bar-wrap"><span>Thu</span><i style="height: 64%"></i></div>
        <div class="bar-wrap"><span>Fri</span><i style="height: 88%"></i></div>
        <div class="bar-wrap"><span>Sat</span><i style="height: 52%"></i></div>
        <div class="bar-wrap"><span>Sun</span><i style="height: 39%"></i></div>
      </div>
    </section>
  `;
}

function renderCampaignsPage() {
  mainContent.innerHTML = `
    <section class="surface-card">
      <div class="surface-header">
        <div>
          <h2>Campaign tracker</h2>
          <p>Keep your UTM campaigns organized in one place.</p>
        </div>
      </div>
      <div class="campaign-list">
        <div class="campaign-item"><strong>Summer Sale</strong><span>Email - Active</span></div>
        <div class="campaign-item"><strong>Creator Outreach</strong><span>Social - Draft</span></div>
        <div class="campaign-item"><strong>Retail Posters</strong><span>Offline - Active</span></div>
      </div>
    </section>
  `;
}

function renderDomainsPage() {
  mainContent.innerHTML = `
    <section class="surface-card two-column">
      <div>
        <div class="surface-header">
          <div>
            <h2>Custom domains</h2>
            <p>Save one active domain and use it as the base for all new short links.</p>
          </div>
        </div>
        <div class="domain-list">
          <div class="domain-item"><strong>${escapeHtml(settingsCache.defaultDomain)}</strong><span>Active domain</span></div>
          <div class="domain-item"><strong>${escapeHtml(buildShortPreview("sample-link"))}</strong><span>Preview</span></div>
        </div>
      </div>
      <div class="form-card">
        <label class="field-label" for="domainName">Add a domain</label>
        <input id="domainName" class="url-input" type="text" value="${escapeHtml(settingsCache.defaultDomain)}" placeholder="go.yourbrand.com">
        <button class="primary-action inline-action" id="saveDomainButton">Save domain</button>
        <p class="helper-copy">Example: go.yourbrand.com or localhost:3000</p>
      </div>
    </section>
  `;

  document.getElementById("saveDomainButton").addEventListener("click", async () => {
    const domainName = document.getElementById("domainName").value.trim();

    try {
      await saveSettings({
        workspaceName: settingsCache.workspaceName,
        defaultDomain: domainName,
      });
      renderDomainsPage();
      showGlobalMessage(`Active domain saved: ${settingsCache.defaultDomain}`, false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });
}

function renderSettingsPage() {
  mainContent.innerHTML = `
    <section class="surface-card two-column">
      <div class="form-card">
        <label class="field-label" for="workspaceName">Workspace name</label>
        <input id="workspaceName" class="url-input" type="text" value="${escapeHtml(settingsCache.workspaceName)}">
        <label class="field-label" for="defaultDomain">Default domain</label>
        <input id="defaultDomain" class="url-input" type="text" value="${escapeHtml(settingsCache.defaultDomain)}">
        <button class="primary-action inline-action" id="saveSettingsButton">Save settings</button>
      </div>
      <div class="mini-card inset-card">
        <h3>Workspace status</h3>
        <div class="task-list">
          <div class="task-item"><span class="task-check filled"></span><span>API online</span></div>
          <div class="task-item"><span class="task-check filled"></span><span>Redirect engine ready</span></div>
          <div class="task-item"><span class="task-check filled"></span><span>Default domain: ${escapeHtml(settingsCache.defaultDomain)}</span></div>
        </div>
      </div>
    </section>
  `;

  document.getElementById("saveSettingsButton").addEventListener("click", async () => {
    const workspaceName = document.getElementById("workspaceName").value.trim();
    const defaultDomain = document.getElementById("defaultDomain").value.trim();

    try {
      await saveSettings({ workspaceName, defaultDomain });
      renderSettingsPage();
      showGlobalMessage("Settings saved successfully.", false);
    } catch (error) {
      showGlobalMessage(error.message, true);
    }
  });
}

function wireCreateForm() {
  const createLinkButton = document.getElementById("createLinkButton");
  const destinationInput = document.getElementById("destination");
  const slugInput = document.getElementById("slug");
  const qrToggle = document.getElementById("qrToggle");
  const resultBanner = document.getElementById("resultBanner");
  const shortBaseLabel = document.getElementById("shortBaseLabel");

  const updateShortBasePreview = () => {
    const previewSlug = sanitizeSlug(slugInput.value.trim()) || "your-slug";
    shortBaseLabel.textContent = buildShortPreview(previewSlug);
  };

  const setBanner = (message, isError) => {
    resultBanner.textContent = message;
    resultBanner.classList.remove("hidden", "error");
    if (isError) {
      resultBanner.classList.add("error");
    }
  };

  const handleCreateLink = async () => {
    const destination = destinationInput.value.trim();
    const slug = sanitizeSlug(slugInput.value.trim());

    setBanner("Creating your AnyLink...", false);

    try {
      const response = await fetch("/api/links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          destination,
          slug,
          includeQr: qrToggle.checked,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setBanner(payload.error || "Something went wrong while creating the short link.", true);
        return;
      }

      linksCache.unshift(payload.link);
      setBanner(`AnyLink created: ${payload.link.shortUrl}`, false);
      destinationInput.value = "";
      slugInput.value = "";
      qrToggle.checked = false;
      updateShortBasePreview();

      const homeLinksList = document.getElementById("homeLinksList");
      if (homeLinksList) {
        homeLinksList.innerHTML = renderLinkItems(linksCache.slice(0, 3), false);
      }
    } catch (error) {
      setBanner(`Could not reach the server. ${error.message}`, true);
    }
  };

  slugInput.addEventListener("input", updateShortBasePreview);
  destinationInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleCreateLink();
    }
  });
  slugInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleCreateLink();
    }
  });
  createLinkButton.addEventListener("click", handleCreateLink);
  updateShortBasePreview();
}

function wireLinkActions() {
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const shortUrl = button.getAttribute("data-copy");

      try {
        await navigator.clipboard.writeText(shortUrl);
        showGlobalMessage(`Copied: ${shortUrl}`, false);
      } catch {
        showGlobalMessage(`Copy failed. Open this link manually: ${shortUrl}`, true);
      }
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slug = button.getAttribute("data-delete");

      try {
        const response = await fetch(`/api/links/${encodeURIComponent(slug)}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Delete failed");
        }

        linksCache = linksCache.filter((item) => item.slug !== slug);
        renderLinksPage(linksCache, searchInput.value.trim().toLowerCase());
        showGlobalMessage(`Deleted: ${slug}`, false);
      } catch (error) {
        showGlobalMessage(error.message, true);
      }
    });
  });
}

function renderLinkItems(links, includeDelete) {
  if (!links.length) {
    return '<div class="empty-state">No links yet. Create your first AnyLink above.</div>';
  }

  return links
    .map((link) => {
      const createdAt = new Date(link.createdAt).toLocaleString();
      return `
        <div class="link-item">
          <div class="link-copy">
            <a href="${escapeHtml(link.shortUrl)}" target="_blank" rel="noreferrer">${escapeHtml(link.shortUrl)}</a>
            <strong>${escapeHtml(link.slug)}</strong>
            <p>${escapeHtml(link.destination)}</p>
            <p>Created: ${escapeHtml(createdAt)}</p>
          </div>
          <div class="link-actions">
            <button class="link-button" data-copy="${escapeHtml(link.shortUrl)}">Copy</button>
            <a class="link-button secondary" href="${escapeHtml(link.shortUrl)}" target="_blank" rel="noreferrer">Open</a>
            ${includeDelete ? `<button class="link-button danger" data-delete="${escapeHtml(link.slug)}">Delete</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

function buildShortPreview(slug) {
  const domain = settingsCache.defaultDomain || window.location.host;
  const localPattern = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(domain);
  const protocol = localPattern ? "http" : "https";
  return `${protocol}://${domain}/${slug}`;
}

function sanitizeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  showGlobalMessage.timeoutId = window.setTimeout(() => {
    banner.classList.remove("visible");
  }, 2200);
}
