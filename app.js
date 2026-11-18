let currentUser = null;
let data = { properties: [], tenants: [], payments: [], requests: [], users: [], activity: [], expenses: [], announcements: [], leases: [], messages: [], stats: {} };
let currentPage = "dashboard";
let currentView = "grid"; // "grid", "list", or "map"
let searchQuery = "";
let typeFilter = "all";
let statusFilter = "all";
let sortBy = "default";
let socket = null;
let activeChatPartnerId = null;
let leafletMapInstance = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

const money = (amount) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
}).format(Number(amount) || 0);

const dateLabel = (value) => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const timeAgo = (isoString) => {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
};

const today = () => new Date().toISOString().slice(0, 10);
const getTenant = (id) => data.tenants.find((t) => t.id === id) || data.users.find((u) => u.id === id);
const getProperty = (id) => data.properties.find((p) => p.id === id);
const tenantRecord = () => data.tenants.find((t) => t.id === currentUser?.id) || data.tenants[0] || null;
const tenantProperty = () => data.properties.find((p) => p.tenantId === currentUser?.id) || null;
const isManager = () => currentUser?.role === "landlord" || currentUser?.role === "admin";

function initials(name) {
  return String(name || "User")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

// ----------------- THEME TOGGLE (DARK / LIGHT) -----------------

function initTheme() {
  const saved = localStorage.getItem("rentease_theme");
  if (saved === "dark") {
    document.body.classList.add("dark-theme");
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark-theme");
  const isDark = document.body.classList.contains("dark-theme");
  localStorage.setItem("rentease_theme", isDark ? "dark" : "light");
  showToast(`Switched to ${isDark ? "Dark" : "Light"} mode`);
}

// ----------------- SVG ICONS LIBRARY -----------------

function svgIcon(name, size = 16) {
  const icons = {
    home: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
    building: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"></rect><path d="M9 22v-4h6v4"></path><path d="M8 6h.01"></path><path d="M16 6h.01"></path><path d="M12 6h.01"></path><path d="M12 10h.01"></path><path d="M12 14h.01"></path><path d="M16 10h.01"></path><path d="M16 14h.01"></path><path d="M8 10h.01"></path><path d="M8 14h.01"></path></svg>`,
    users: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    dollar: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`,
    wrench: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
    shield: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path></svg>`,
    database: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5V19A9 3 0 0 0 21 19V5"></path><path d="M3 12A9 3 0 0 0 21 12"></path></svg>`,
    search: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line></svg>`,
    plus: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"></line><line x1="5" x2="19" y1="12" y2="12"></line></svg>`,
    check: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    clock: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    alert: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>`,
    mapPin: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg>`,
    bed: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"></path><path d="M2 8h18a2 2 0 0 1 2 2v10"></path><path d="M2 17h20"></path><path d="M6 8v9"></path></svg>`,
    bath: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.68 3 4 3.68 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"></path><line x1="10" x2="10" y1="5" y2="5.01"></line><path d="M10 8h10a2 2 0 0 1 2 2v2H2"></path></svg>`,
    maximize: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path></svg>`,
    grid: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect></svg>`,
    list: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"></line><line x1="8" x2="21" y1="12" y2="12"></line><line x1="8" x2="21" y1="18" y2="18"></line><line x1="3" x2="3.01" y1="6" y2="6"></line><line x1="3" x2="3.01" y1="12" y2="12"></line><line x1="3" x2="3.01" y1="18" y2="18"></line></svg>`,
    map: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" x2="9" y1="3" y2="18"></line><line x1="15" x2="15" y1="6" y2="21"></line></svg>`,
    message: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
    trendingUp: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>`,
    sparkles: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"></path></svg>`,
    download: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>`,
    pen: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>`
  };
  return icons[name] || "";
}

// ----------------- CSV EXPORT UTILITY -----------------

function exportToCsv(filename, rows) {
  if (!rows || !rows.length) return showToast("No records to export.", true);
  const keys = Object.keys(rows[0]);
  const csvContent = [
    keys.join(","),
    ...rows.map((row) => keys.map((k) => `"${String(row[k] ?? "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported ${rows.length} rows to ${filename}`);
}

// ----------------- API CLIENT -----------------

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers };
  const response = await fetch(url, { credentials: "same-origin", ...options, headers });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && currentUser) {
      currentUser = null;
      showAuth();
    }
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return result;
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.innerHTML = `<span>${isError ? svgIcon("alert", 16) : svgIcon("check", 16)}</span><span>${escapeHtml(message)}</span>`;
  $("#toast-region").append(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

// ----------------- AUTHENTICATION VIEWS -----------------

function showAuth(mode = "login") {
  $("#app-shell").hidden = true;
  const root = $("#auth-root");
  root.hidden = false;
  root.dataset.mode = mode;
  root.innerHTML = `<div class="auth-card">
    <a class="brand" href="/" aria-label="RentEase home">
      <span class="brand-mark">${svgIcon("home", 18)}</span>
      <span class="brand-text">rent<span class="brand-accent">ease</span></span>
    </a>
    <div class="auth-intro">
      <div class="eyebrow">MODERN RENTAL MANAGEMENT</div>
      <h1>${mode === "login" ? "Welcome back" : "Create your account"}</h1>
      <p>${mode === "login" ? "Sign in to your RentEase portfolio workspace." : "Create a landlord or tenant account to get started."}</p>
    </div>
    <div class="auth-tabs" role="tablist">
      <button type="button" class="auth-tab${mode === "login" ? " active" : ""}" data-auth-mode="login">Sign in</button>
      <button type="button" class="auth-tab${mode === "signup" ? " active" : ""}" data-auth-mode="signup">Create account</button>
    </div>
    <form class="auth-form" id="auth-form" novalidate>
      ${mode === "signup" ? authField("name", "Full name", "text", true, null, "", "e.g. Jane Doe") : ""}
      ${mode === "signup" ? authField("role", "Account type", "select", true, [["tenant", "Tenant (Resident)"], ["landlord", "Landlord (Property Owner)"]]) : ""}
      ${authField("email", "Email address", "email", true, null, "", "name@example.com")}
      ${authField("password", "Password", "password", true, null, "", "Min 10 characters")}
      <div class="form-error" id="auth-error" role="alert"></div>
      <button class="button auth-submit" type="submit">${mode === "login" ? "Sign in to workspace" : "Create account"}</button>
    </form>
    <p class="auth-note">RentEase demo utilizes persistent SQLite with WAL transactions and real-time Socket.IO synchronization. Simulated payments do not charge real money.</p>
    <div class="auth-footer-links">
      <button type="button" data-page="about">About Us</button>
      <span>·</span>
      <button type="button" data-page="contact">Contact</button>
      <span>·</span>
      <button type="button" data-page="help">Help & FAQs</button>
    </div>
  </div>`;
  $("#auth-form").addEventListener("submit", submitAuth);
  const first = $(".form-control", root);
  if (first) first.focus();
}

async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const mode = $("#auth-root").dataset.mode;
  const submit = $(".auth-submit", form);
  submit.disabled = true;
  submit.textContent = "Please wait…";
  try {
    const result = await api(`/api/auth/${mode === "signup" ? "signup" : "login"}`, {
      method: "POST",
      body: JSON.stringify(values)
    });
    currentUser = result.user;
    await enterWorkspace();
  } catch (error) {
    $("#auth-error").textContent = error.message;
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      submit.textContent = mode === "login" ? "Sign in to workspace" : "Create account";
    }
  }
}

async function enterWorkspace() {
  $("#auth-root").hidden = true;
  $("#app-shell").hidden = false;
  $("#profile-name").textContent = currentUser.name;
  $("#profile-role").textContent = currentUser.role === "admin" ? "Platform Administrator" : currentUser.role === "landlord" ? "Property Owner" : "Resident Tenant";
  $("#profile-avatar").textContent = initials(currentUser.name);
  $("#header-avatar").textContent = initials(currentUser.name);
  $("#account-email").textContent = currentUser.email;
  $("#workspace-name").textContent = currentUser.role === "admin" ? "ADMIN CONSOLE" : currentUser.role === "landlord" ? "LANDLORD PORTFOLIO" : "RESIDENT HUB";
  currentPage = "dashboard";
  connectRealtime();
  await loadData();
}

function connectRealtime() {
  if (socket) socket.disconnect();
  socket = window.io({ withCredentials: true });
  socket.on("data:changed", () => {
    if (!currentUser) return;
    loadData().catch((error) => showToast(error.message, true));
  });
  socket.on("chat:message", (msg) => {
    if (!currentUser) return;
    data.messages.push(msg);
    if (currentPage === "messages") {
      render();
    } else {
      showToast(`New message from ${msg.senderName}: "${msg.message.slice(0, 30)}..."`);
    }
  });
  socket.on("connect_error", (error) => {
    if (currentUser && /Authentication required/.test(error.message)) {
      showToast("Your session ended. Sign in again.", true);
    }
  });
  socket.on("disconnect", (reason) => {
    if (currentUser && reason === "io server disconnect") showAuth();
  });
}

async function loadData() {
  const fresh = await api("/api/data");
  currentUser = fresh.user;
  data = fresh;
  render();
}

// ----------------- NAVIGATION & PAGE CONFIG -----------------

const navItems = {
  landlord: [
    ["dashboard", "home", "Overview"],
    ["properties", "building", "Properties"],
    ["tenants", "users", "Tenants"],
    ["payments", "dollar", "Payments & Rent"],
    ["expenses", "trendingUp", "Expenses & NOI"],
    ["messages", "message", "Messages"],
    ["maintenance", "wrench", "Maintenance"]
  ],
  tenant: [
    ["dashboard", "home", "My Home"],
    ["payments", "dollar", "Rent & Receipts"],
    ["messages", "message", "Messages"],
    ["maintenance", "wrench", "Maintenance"]
  ],
  admin: [
    ["dashboard", "home", "Overview"],
    ["properties", "building", "Properties"],
    ["tenants", "users", "Tenants"],
    ["payments", "dollar", "Payments"],
    ["expenses", "trendingUp", "Expenses"],
    ["messages", "message", "Messages"],
    ["maintenance", "wrench", "Maintenance"],
    ["users", "shield", "Accounts & DB"]
  ]
};

const pageNames = {
  dashboard: { landlord: "Portfolio Overview", tenant: "My Home Portal", admin: "Administrator Overview" },
  properties: { landlord: "Property Portfolio", admin: "All Properties" },
  tenants: { landlord: "Tenant Directory", admin: "Tenant Management" },
  payments: { landlord: "Rent & Collections", tenant: "Rent & Invoices", admin: "Financial Transactions" },
  expenses: { landlord: "Expense & Net Profit Tracker", admin: "Portfolio Expenses" },
  messages: { landlord: "Resident Communications", tenant: "Landlord Chat", admin: "Global Messages" },
  maintenance: { landlord: "Maintenance Requests", tenant: "Maintenance Portal", admin: "Maintenance Dispatch" },
  users: { admin: "User Accounts & Database Health" },
  about: { landlord: "About RentEase", tenant: "About RentEase", admin: "About RentEase" },
  contact: { landlord: "Contact Us", tenant: "Contact Us", admin: "Contact Us" },
  help: { landlord: "Help Center", tenant: "Help Center", admin: "Help Center" }
};

function renderNav() {
  const items = navItems[currentUser.role] || [];
  const publicPages = ["about", "contact", "help"];
  if (!items.some(([key]) => key === currentPage) && !publicPages.includes(currentPage)) {
    currentPage = "dashboard";
  }

  // Active state for sidebar help button
  $("#sidebar-help-btn")?.classList.toggle("active", currentPage === "help");

  // Active state for topbar links
  $$(".topbar-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === currentPage);
  });

  $("#main-nav").innerHTML = items.map(([key, iconName, label]) => {
    const count = key === "maintenance" && isManager()
      ? data.requests.filter((r) => r.status === "Open").length
      : key === "messages"
        ? data.messages.filter((m) => m.recipientId === currentUser?.id).length
        : 0;
    return `<a class="nav-link${currentPage === key ? " active" : ""}" href="#${key}" data-page="${key}"${currentPage === key ? ' aria-current="page"' : ""}>
      <span class="nav-icon" aria-hidden="true">${svgIcon(iconName, 18)}</span>
      <span>${label}</span>
      ${count ? `<span class="nav-badge">${count}</span>` : ""}
    </a>`;
  }).join("");
}

function render() {
  const publicPages = ["about", "contact", "help"];

  // Guest viewing a public page — render into auth-root
  if (!currentUser && publicPages.includes(currentPage)) {
    renderGuestPublicPage();
    return;
  }

  if (!currentUser) return showAuth();
  renderNav();
  $("#page-title").textContent = pageNames[currentPage]?.[currentUser.role] || "Overview";
  const renderers = {
    dashboard: currentUser.role === "tenant" ? renderTenantDashboard : renderLandlordDashboard,
    properties: renderProperties,
    tenants: renderTenants,
    payments: renderPayments,
    expenses: renderExpenses,
    messages: renderMessages,
    maintenance: renderMaintenance,
    users: renderUsers,
    about: renderAbout,
    contact: renderContact,
    help: renderHelp
  };
  $("#page-content").innerHTML = (renderers[currentPage] || renderLandlordDashboard)();

  // If map view is active in properties, initialize Leaflet map
  if (currentPage === "properties" && currentView === "map") {
    setTimeout(initPropertiesMap, 100);
  }

  // Wire up FAQ accordion & contact form after rendering
  if (currentPage === "help") setTimeout(initHelpInteractions, 0);
  if (currentPage === "contact") setTimeout(initContactForm, 0);
}

// ----------------- UI COMPONENTS & HELPERS -----------------

function pageHeading(eyebrow, title, subtitle, action = "") {
  return `<div class="page-heading">
    <div>
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      <p class="heading-subtitle">${subtitle}</p>
    </div>
    ${action}
  </div>`;
}

function statCard(label, value, iconName, foot, trend = "") {
  return `<article class="stat-card">
    <div class="stat-top">
      <span>${label}</span>
      <span class="stat-icon">${svgIcon(iconName, 18)}</span>
    </div>
    <div class="stat-value">${value}</div>
    <div class="stat-foot">
      ${trend ? `<span class="trend-badge">${svgIcon("trendingUp", 12)} ${trend}</span> ` : ""}
      <span>${foot}</span>
    </div>
  </article>`;
}

function statusClass(status) {
  const val = String(status).toLowerCase();
  if (["paid", "active", "resolved"].includes(val)) return "status-paid";
  if (["pending", "open"].includes(val)) return "status-pending";
  if (["overdue", "high", "urgent"].includes(val)) return "status-overdue";
  if (val.includes("progress")) return "status-progress";
  return "status-normal";
}

function statusPill(status) {
  return `<span class="status ${statusClass(status)}">${escapeHtml(status)}</span>`;
}

// ----------------- LANDLORD & ADMIN DASHBOARD -----------------

function renderLandlordDashboard() {
  const totalRentPotential = data.properties.reduce((sum, p) => sum + Number(p.rent), 0);
  const collectedThisMonth = data.payments.filter((p) => p.status === "Paid").reduce((sum, p) => sum + Number(p.amount), 0);
  const pendingRent = data.payments.filter((p) => p.status === "Pending").reduce((sum, p) => sum + Number(p.amount), 0);
  const totalExpenses = (data.expenses || []).reduce((sum, e) => sum + Number(e.amount), 0);
  const netIncome = collectedThisMonth - totalExpenses;
  const openIssues = data.requests.filter((r) => r.status !== "Resolved").length;
  const occupiedCount = data.properties.filter((p) => p.tenantId).length;
  const occupancyRate = data.properties.length ? Math.round((occupiedCount / data.properties.length) * 100) : 0;

  const totalDue = collectedThisMonth + pendingRent;
  const paidPercent = totalDue > 0 ? Math.round((collectedThisMonth / totalDue) * 100) : 100;
  const pendingPercent = 100 - paidPercent;

  const chartBars = [
    { month: "Jun", amount: totalRentPotential * 0.85 },
    { month: "Jul", amount: totalRentPotential * 0.90 },
    { month: "Aug", amount: totalRentPotential * 0.95 },
    { month: "Sep", amount: totalRentPotential * 0.92 },
    { month: "Oct", amount: totalRentPotential * 0.98 },
    { month: "Nov", amount: collectedThisMonth || totalRentPotential }
  ];
  const maxBar = Math.max(...chartBars.map((b) => b.amount), 1);

  const announcements = data.announcements || [];
  const activityItems = data.activity && data.activity.length ? data.activity.slice(0, 5) : [];

  const actions = `<div class="toolbar">
    ${isManager() && data.properties.length === 0 ? `<button class="button button-secondary" data-action="seed-demo"><span>${svgIcon("sparkles", 14)}</span> Populate Sample Data</button>` : ""}
    <button class="button button-secondary" data-action="post-announcement"><span>${svgIcon("message", 14)}</span> Post Notice</button>
    <button class="button" data-action="add-property"><span>${svgIcon("plus", 14)}</span> Add Property</button>
  </div>`;

  return `${pageHeading("LIVE PORTFOLIO METRICS", `Welcome, ${escapeHtml(currentUser.name.split(" ")[0])}`, currentUser.role === "admin" ? "Oversee multi-tenant accounts, financial performance, and system operations." : "Real-time updates on your rental portfolio, expenses, and net profit.", actions)}
    
    <div class="stats-grid">
      ${statCard("Properties", data.properties.length, "building", `${occupancyRate}% occupancy (${occupiedCount}/${data.properties.length} leased)`)}
      ${statCard("Monthly Potential", money(totalRentPotential), "dollar", "Scheduled rent roll", "+4.2%")}
      ${statCard("Net Operating Income", money(netIncome), "trendingUp", `Collected ${money(collectedThisMonth)} - Expenses ${money(totalExpenses)}`)}
      ${statCard("Active Tickets", openIssues, "wrench", `${data.payments.filter((p) => p.status === "Pending").length} pending payments`)}
    </div>

    ${announcements.length ? `
      <section class="panel" style="margin-bottom:24px">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Community Announcements & Notices</h2>
            <p class="panel-subtitle">Live broadcasts visible to tenants</p>
          </div>
          ${isManager() ? '<button class="button button-quiet" data-action="post-announcement">＋ Post Notice</button>' : ""}
        </div>
        <div style="padding:16px 20px" class="announcements-grid">
          ${announcements.slice(0, 3).map((a) => `
            <div class="announcement-card priority-${escapeHtml(a.priority)}">
              <div class="announcement-header">
                <strong>${escapeHtml(a.title)}</strong>
                <span class="status ${a.priority === "Urgent" ? "status-urgent" : a.priority === "Important" ? "status-pending" : "status-paid"}">${escapeHtml(a.priority)}</span>
              </div>
              <p>${escapeHtml(a.content)}</p>
              <div style="font-size:11px;color:var(--text-subtle);margin-top:6px">${dateLabel(a.createdAt)} · By ${escapeHtml(a.authorName)}</div>
            </div>
          `).join("")}
        </div>
      </section>
    ` : ""}

    <div class="analytics-banner">
      <div class="metric-panel">
        <div class="metric-panel-header">
          <div>
            <div class="metric-panel-title">Rent Collection Performance</div>
            <div class="metric-panel-sub">Current billing cycle distribution</div>
          </div>
          <strong>${money(collectedThisMonth)} <span style="font-size:12px;color:var(--text-subtle)">/ ${money(totalDue || totalRentPotential)}</span></strong>
        </div>
        <div class="collection-bar-wrap">
          <div class="collection-bar">
            <div class="collection-segment-paid" style="width: ${paidPercent}%" title="Paid: ${money(collectedThisMonth)} (${paidPercent}%)"></div>
            <div class="collection-segment-pending" style="width: ${pendingPercent}%" title="Pending: ${money(pendingRent)} (${pendingPercent}%)"></div>
          </div>
          <div class="collection-legend">
            <div class="legend-item"><span class="legend-dot legend-paid"></span> Paid (${paidPercent}%)</div>
            <div class="legend-item"><span class="legend-dot legend-pending"></span> Pending (${pendingPercent}%)</div>
            <div class="legend-item" style="font-weight:700;color:var(--primary);">${money(pendingRent)} Outstanding</div>
          </div>
        </div>
      </div>

      <div class="metric-panel">
        <div class="metric-panel-header">
          <div>
            <div class="metric-panel-title">6-Month Revenue Trend</div>
            <div class="metric-panel-sub">Historical cash flow</div>
          </div>
        </div>
        <div class="chart-container">
          ${chartBars.map((bar) => {
            const heightPercent = Math.max(12, Math.round((bar.amount / maxBar) * 90));
            return `<div class="chart-bar-col">
              <div class="chart-bar-pillar" style="height: ${heightPercent}%" title="${bar.month}: ${money(bar.amount)}"></div>
              <span class="chart-month-label">${bar.month}</span>
            </div>`;
          }).join("")}
        </div>
      </div>
    </div>

    <div class="content-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Recent Rent Transactions</h2>
            <p class="panel-subtitle">Latest payments recorded in SQLite</p>
          </div>
          <button class="button button-quiet" data-page="payments">View all payments →</button>
        </div>
        ${paymentsTable(data.payments.slice(0, 5), true)}
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Audit Activity Log</h2>
            <p class="panel-subtitle">Real-time transactional audit trail</p>
          </div>
        </div>
        <div class="activity-list">
          ${activityItems.map((item) => `
            <div class="activity-item">
              <span class="activity-dot">${svgIcon(item.actionType.includes("payment") ? "dollar" : item.actionType.includes("maintenance") ? "wrench" : item.actionType.includes("expense") ? "trendingUp" : item.actionType.includes("property") ? "building" : "users", 16)}</span>
              <div class="activity-copy">
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.details)} · <em style="font-style:normal;color:var(--text-subtle)">${timeAgo(item.createdAt)}</em></span>
              </div>
            </div>
          `).join("") || '<div class="empty-state">No activity logged yet. Updates appear here in real time.</div>'}
        </div>
      </section>
    </div>`;
}

// ----------------- TENANT DASHBOARD (MY HOME) -----------------

function renderTenantDashboard() {
  const property = tenantProperty();
  const payments = data.payments.filter((p) => p.tenantId === currentUser.id);
  const pendingPayment = payments.find((p) => p.status === "Pending");
  const outstandingAmount = pendingPayment ? pendingPayment.amount : (property ? property.rent : 0);
  const requests = data.requests.filter((r) => r.tenantId === currentUser.id);
  const announcements = data.announcements || [];

  const heroBanner = property
    ? `<div class="tenant-hero-card">
        <div class="tenant-hero-info">
          <div class="eyebrow" style="color:#6ee7b7">YOUR ASSIGNED RESIDENCE</div>
          <h2>${escapeHtml(property.name)}</h2>
          <p>${escapeHtml(property.address)}${property.city ? `, ${escapeHtml(property.city)}` : ""}</p>
          <div style="display:flex;gap:14px;margin-top:14px;font-size:13px;color:rgba(255,255,255,0.9)">
            <span>${svgIcon("bed", 14)} ${property.bedrooms} Bedrooms</span>
            <span>${svgIcon("bath", 14)} ${property.bathrooms} Bathrooms</span>
            ${property.sqft ? `<span>${svgIcon("maximize", 14)} ${property.sqft} sqft</span>` : ""}
          </div>
        </div>
        <div class="tenant-hero-due">
          <span>Current Amount Due</span>
          <strong>${money(outstandingAmount)}</strong>
          <span style="margin-top:4px">${pendingPayment ? `Due ${dateLabel(pendingPayment.date)}` : `Monthly rent · ${money(property.rent)}`}</span>
          <button class="button button-small" data-action="pay-rent" style="margin-top:12px;background:white;color:#065f46;font-weight:700;width:100%">Pay Rent Online</button>
        </div>
      </div>`
    : `<div class="empty-state panel" style="margin-bottom:24px">
        <strong>No rental property assigned yet</strong>
        Your landlord can assign your account to a property using your registered email: <code>${escapeHtml(currentUser.email)}</code>.
      </div>`;

  return `${pageHeading("RESIDENT HUB", `Welcome home, ${escapeHtml(currentUser.name.split(" ")[0])}`, "View lease terms, make instant simulated rent payments, and track maintenance.")}
    ${heroBanner}

    ${announcements.length ? `
      <section class="panel" style="margin-bottom:24px">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Building Notices & Announcements</h2>
            <p class="panel-subtitle">Important updates from your property manager</p>
          </div>
        </div>
        <div style="padding:16px 20px" class="announcements-grid">
          ${announcements.map((a) => `
            <div class="announcement-card priority-${escapeHtml(a.priority)}">
              <div class="announcement-header">
                <strong>${escapeHtml(a.title)}</strong>
                <span class="status ${a.priority === "Urgent" ? "status-urgent" : a.priority === "Important" ? "status-pending" : "status-paid"}">${escapeHtml(a.priority)}</span>
              </div>
              <p>${escapeHtml(a.content)}</p>
              <div style="font-size:11px;color:var(--text-subtle);margin-top:6px">${dateLabel(a.createdAt)}</div>
            </div>
          `).join("")}
        </div>
      </section>
    ` : ""}

    <div class="stats-grid">
      ${statCard("Monthly Rent", property ? money(property.rent) : "—", "dollar", "Scheduled monthly lease")}
      ${statCard("Lease Expiration", property?.leaseEnd ? dateLabel(property.leaseEnd) : "—", "clock", "Fixed term lease contract")}
      ${statCard("Payments Made", payments.filter((p) => p.status === "Paid").length, "check", "Digital receipts available")}
      ${statCard("Maintenance Tickets", requests.filter((r) => r.status !== "Resolved").length, "wrench", "Active requests")}
    </div>

    <div class="content-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Your Rent Payment History</h2>
            <p class="panel-subtitle">Official payment records and receipts</p>
          </div>
          <button class="button button-quiet" data-page="payments">All receipts →</button>
        </div>
        ${paymentsTable(payments.slice(0, 5), false)}
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Maintenance Requests</h2>
            <p class="panel-subtitle">Reported issues for your residence</p>
          </div>
          <button class="button button-small" data-action="add-request"><span>${svgIcon("plus", 12)}</span> New Request</button>
        </div>
        <div class="activity-list">
          ${requests.map((r) => `
            <div class="activity-item">
              <span class="activity-dot">${svgIcon("wrench", 16)}</span>
              <div class="activity-copy">
                <strong>${escapeHtml(r.title)}</strong>
                <span>${statusPill(r.status)} · ${escapeHtml(r.category)} · Reported ${dateLabel(r.date)}</span>
              </div>
            </div>
          `).join("") || '<div class="empty-state">No maintenance requests submitted yet.</div>'}
        </div>
      </section>
    </div>`;
}

// ----------------- PROPERTIES VIEW WITH MAP TOGGLE -----------------

function renderProperties() {
  let filtered = data.properties.filter((p) => {
    const matchSearch = `${p.name} ${p.address} ${p.city} ${p.type}`.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = typeFilter === "all" || p.type.toLowerCase() === typeFilter.toLowerCase();
    const isOccupied = Boolean(p.tenantId);
    const matchStatus = statusFilter === "all" || (statusFilter === "occupied" ? isOccupied : !isOccupied);
    return matchSearch && matchType && matchStatus;
  });

  if (sortBy === "rent-desc") filtered.sort((a, b) => b.rent - a.rent);
  else if (sortBy === "rent-asc") filtered.sort((a, b) => a.rent - b.rent);
  else if (sortBy === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));

  const toolbar = `<div class="toolbar">
    <div class="search-wrap">
      <span class="search-icon">${svgIcon("search", 15)}</span>
      <input class="search-input" type="search" placeholder="Search properties, city, type..." aria-label="Search properties" data-search="properties" value="${escapeHtml(searchQuery)}">
    </div>
    <select class="filter-select" data-action="filter-type" aria-label="Filter by type">
      <option value="all"${typeFilter === "all" ? " selected" : ""}>All Types</option>
      <option value="Apartment"${typeFilter === "Apartment" ? " selected" : ""}>Apartment</option>
      <option value="House"${typeFilter === "House" ? " selected" : ""}>House</option>
      <option value="Townhouse"${typeFilter === "Townhouse" ? " selected" : ""}>Townhouse</option>
      <option value="Condo"${typeFilter === "Condo" ? " selected" : ""}>Condo</option>
    </select>
    <select class="filter-select" data-action="filter-status" aria-label="Filter by status">
      <option value="all"${statusFilter === "all" ? " selected" : ""}>All Status</option>
      <option value="occupied"${statusFilter === "occupied" ? " selected" : ""}>Occupied</option>
      <option value="available"${statusFilter === "available" ? " selected" : ""}>Vacant</option>
    </select>
    <select class="filter-select" data-action="sort-properties" aria-label="Sort properties">
      <option value="default"${sortBy === "default" ? " selected" : ""}>Sort: Newest</option>
      <option value="rent-desc"${sortBy === "rent-desc" ? " selected" : ""}>Rent: High to Low</option>
      <option value="rent-asc"${sortBy === "rent-asc" ? " selected" : ""}>Rent: Low to High</option>
      <option value="name"${sortBy === "name" ? " selected" : ""}>Name A-Z</option>
    </select>
    <div class="view-toggle">
      <button class="view-toggle-btn${currentView === "grid" ? " active" : ""}" data-action="view-grid" title="Grid View">${svgIcon("grid", 16)}</button>
      <button class="view-toggle-btn${currentView === "list" ? " active" : ""}" data-action="view-list" title="List View">${svgIcon("list", 16)}</button>
      <button class="view-toggle-btn${currentView === "map" ? " active" : ""}" data-action="view-map" title="Map View">${svgIcon("map", 16)}</button>
    </div>
    ${isManager() ? `<button class="button" data-action="add-property"><span>${svgIcon("plus", 14)}</span> Add Property</button>` : ""}
  </div>`;

  let viewHtml = "";
  if (currentView === "grid") viewHtml = renderPropertiesGrid(filtered);
  else if (currentView === "list") viewHtml = renderPropertiesList(filtered);
  else if (currentView === "map") {
    viewHtml = `
      ${data.properties.length === 0 ? `
        <div style="background:var(--bg-panel);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:14px 20px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <strong>Interactive Map is ready</strong>
            <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Add properties with latitude and longitude, or populate sample data to see live interactive map pins.</p>
          </div>
          ${isManager() ? `<button class="button button-sm button-secondary" data-action="seed-demo"><span>${svgIcon("sparkles", 14)}</span> Populate Sample Data</button>` : ""}
        </div>
      ` : ""}
      <div id="property-map"></div>
    `;
  }

  return `${pageHeading("PORTFOLIO ASSETS", "Properties", `${data.properties.length} rental unit${data.properties.length === 1 ? "" : "s"} in portfolio.`, toolbar)}
    ${viewHtml}`;
}

function renderPropertiesGrid(properties) {
  if (!properties.length) {
    return `<div class="empty-state panel" style="padding:40px 20px;text-align:center;">
      <div style="font-size:36px;margin-bottom:10px;">🏢</div>
      <strong style="font-size:16px;display:block;margin-bottom:6px;">No matching properties found</strong>
      <p style="color:var(--text-muted);font-size:13px;max-width:440px;margin:0 auto 18px;">${data.properties.length === 0 ? "You haven't added any properties to your portfolio yet. Add your first rental unit or populate sample data." : "Try adjusting your search query or filters to find what you're looking for."}</p>
      ${isManager() && data.properties.length === 0 ? `
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <button class="button" data-action="add-property"><span>${svgIcon("plus", 14)}</span> Add Property</button>
          <button class="button button-secondary" data-action="seed-demo"><span>${svgIcon("sparkles", 14)}</span> Populate Sample Portfolio</button>
        </div>
      ` : ""}
    </div>`;
  }

  return `<div class="property-grid">${properties.map((p) => {
    const isOccupied = Boolean(p.tenantId);
    const tenant = getTenant(p.tenantId);
    const fallbackImage = "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80";
    const image = p.imageUrl || fallbackImage;

    return `<article class="property-card" data-action="view-property-details" data-id="${escapeHtml(p.id)}">
      <div class="property-visual-frame">
        <img class="property-img" src="${escapeHtml(image)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.src='${fallbackImage}'">
        <span class="property-tag-badge">${escapeHtml(p.type)}</span>
        <div class="property-rent-badge">${money(p.rent)} <span>/mo</span></div>
      </div>
      <div class="property-card-body">
        <h2 class="property-card-title">${escapeHtml(p.name)}</h2>
        <div class="property-address">
          <span>${svgIcon("mapPin", 13)}</span>
          <span>${escapeHtml(p.address)}${p.city ? `, ${escapeHtml(p.city)}` : ""}</span>
        </div>
        <div class="property-specs">
          <span class="spec-item">${svgIcon("bed", 13)} ${p.bedrooms} bed</span>
          <span class="spec-item">${svgIcon("bath", 13)} ${p.bathrooms} bath</span>
          ${p.sqft ? `<span class="spec-item">${svgIcon("maximize", 13)} ${p.sqft} sqft</span>` : ""}
          <span class="spec-item" style="margin-left:auto">${statusPill(isOccupied ? "Occupied" : "Vacant")}</span>
        </div>
        ${p.amenities && p.amenities.length ? `
          <div class="amenities-preview">
            ${p.amenities.slice(0, 3).map((a) => `<span class="amenity-chip">${escapeHtml(a)}</span>`).join("")}
            ${p.amenities.length > 3 ? `<span class="amenity-chip">+${p.amenities.length - 3}</span>` : ""}
          </div>
        ` : ""}
        <div class="property-card-bottom">
          ${isOccupied ? `
            <div class="tenant-badge-cell">
              <span class="avatar avatar-emerald">${escapeHtml(initials(p.tenantName || tenant?.name))}</span>
              <div>
                <strong style="font-size:12px;color:var(--text-main);display:block">${escapeHtml(p.tenantName || tenant?.name || "Tenant")}</strong>
                <span style="font-size:11px;color:var(--text-muted)">Lease ends ${dateLabel(p.leaseEnd)}</span>
              </div>
            </div>
          ` : `
            <button class="button button-quiet" data-action="add-tenant" data-property="${escapeHtml(p.id)}">＋ Assign tenant</button>
          `}
          <button class="button button-quiet" data-action="view-property-details" data-id="${escapeHtml(p.id)}">Details →</button>
        </div>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function renderPropertiesList(properties) {
  if (!properties.length) return '<div class="empty-state panel">No matching properties.</div>';
  return `<section class="panel">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>PROPERTY</th>
            <th>LOCATION</th>
            <th>SPECS</th>
            <th>RENT</th>
            <th>STATUS</th>
            <th>TENANT</th>
            <th>ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${properties.map((p) => {
            const isOccupied = Boolean(p.tenantId);
            return `<tr>
              <td>
                <span class="table-primary">${escapeHtml(p.name)}</span>
                <span class="table-secondary">${escapeHtml(p.type)}</span>
              </td>
              <td>${escapeHtml(p.address)}${p.city ? `, ${escapeHtml(p.city)}` : ""}</td>
              <td>${p.bedrooms}b / ${p.bathrooms}ba ${p.sqft ? `· ${p.sqft} sqft` : ""}</td>
              <td class="table-primary">${money(p.rent)}</td>
              <td>${statusPill(isOccupied ? "Occupied" : "Vacant")}</td>
              <td>${isOccupied ? escapeHtml(p.tenantName || "Assigned") : '<span style="color:var(--text-muted)">None</span>'}</td>
              <td>
                <div style="display:flex;gap:10px">
                  <button class="button button-quiet" data-action="view-property-details" data-id="${escapeHtml(p.id)}">View</button>
                  ${!isOccupied && isManager() ? `<button class="button button-quiet" data-action="add-tenant" data-property="${escapeHtml(p.id)}">Assign</button>` : ""}
                </div>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

function initPropertiesMap() {
  const container = $("#property-map");
  if (!container || typeof window.L === "undefined") {
    if (container) container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:14px;">Map library could not be loaded. Check your internet connection for Leaflet CDN.</div>';
    return;
  }

  if (leafletMapInstance) {
    leafletMapInstance.remove();
    leafletMapInstance = null;
  }

  const defaultCenter = [37.7749, -122.4194];

  // Determine valid property coordinates
  const coords = data.properties.map((p) => {
    const lat = (p.latitude && p.latitude !== 0) ? p.latitude : null;
    const lng = (p.longitude && p.longitude !== 0) ? p.longitude : null;
    return { ...p, _lat: lat, _lng: lng };
  });

  const withCoords = coords.filter((p) => p._lat !== null && p._lng !== null);
  const center = withCoords.length ? [withCoords[0]._lat, withCoords[0]._lng] : defaultCenter;

  const map = window.L.map("property-map", { scrollWheelZoom: true }).setView(center, 5);
  leafletMapInstance = map;

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  const markers = [];
  data.properties.forEach((p) => {
    const lat = (p.latitude && p.latitude !== 0) ? p.latitude : (defaultCenter[0] + (Math.random() - 0.5) * 0.05);
    const lng = (p.longitude && p.longitude !== 0) ? p.longitude : (defaultCenter[1] + (Math.random() - 0.5) * 0.05);

    const marker = window.L.marker([lat, lng]).addTo(map);
    markers.push(marker);
    marker.bindPopup(`
      <div class="map-popup-card">
        <strong>${escapeHtml(p.name)}</strong>
        <span>${escapeHtml(p.address)}${p.city ? ', ' + escapeHtml(p.city) : ''} · ${money(p.rent)}/mo</span>
        <div style="margin-top:6px">
          ${statusPill(p.tenantId ? "Occupied" : "Vacant")}
          <button class="button button-small button-quiet" style="margin-left:8px" data-action="view-property-details" data-id="${escapeHtml(p.id)}">View</button>
        </div>
      </div>
    `);
  });

  // Fit map to show all markers nicely without over-zooming on single points
  if (markers.length === 1) {
    const m = markers[0].getLatLng();
    map.setView([m.lat, m.lng], 13);
  } else if (markers.length > 1) {
    const group = window.L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.15));
  }

  // Force Leaflet to recalculate container size (fixes grey/partial render)
  setTimeout(() => { map.invalidateSize(); }, 150);
  setTimeout(() => { map.invalidateSize(); }, 500);
}

// ----------------- EXPENSES & NOI PROFIT TRACKER -----------------

function renderExpenses() {
  const expenses = data.expenses || [];
  const totalCollected = data.payments.filter((p) => p.status === "Paid").reduce((sum, p) => sum + Number(p.amount), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const netIncome = totalCollected - totalExpenses;
  const marginPercent = totalCollected > 0 ? Math.round((netIncome / totalCollected) * 100) : 0;

  const action = `<div class="toolbar">
    <button class="button button-secondary" data-action="export-expenses"><span>${svgIcon("download", 14)}</span> Export CSV</button>
    ${isManager() ? '<button class="button" data-action="record-expense"><span>' + svgIcon("plus", 14) + '</span> Record Expense</button>' : ""}
  </div>`;

  return `${pageHeading("CASH FLOW & PROFITABILITY", "Expenses & Net Operating Income", "Track maintenance costs, taxes, insurance, and net yield.", action)}
    
    <div class="noi-summary-grid">
      <div class="noi-card">
        <span style="font-size:12px;color:var(--text-muted);text-transform:uppercase">Gross Rent Revenue</span>
        <strong style="color:var(--primary)">${money(totalCollected)}</strong>
        <span style="font-size:12px;color:var(--text-subtle)">Total collected rent</span>
      </div>
      <div class="noi-card">
        <span style="font-size:12px;color:var(--text-muted);text-transform:uppercase">Operating Expenses</span>
        <strong style="color:var(--rose-600)">${money(totalExpenses)}</strong>
        <span style="font-size:12px;color:var(--text-subtle)">${expenses.length} recorded expense entries</span>
      </div>
      <div class="noi-card">
        <span style="font-size:12px;color:var(--text-muted);text-transform:uppercase">Net Operating Income (NOI)</span>
        <strong style="color:var(--text-main)">${money(netIncome)}</strong>
        <span style="font-size:12px;color:var(--emerald-600);font-weight:600">${marginPercent}% net profit margin</span>
      </div>
    </div>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Expense Ledger</h2>
          <p class="panel-subtitle">Itemized property operating costs</p>
        </div>
      </div>
      ${expenses.length ? `<div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DATE</th>
              <th>PROPERTY</th>
              <th>CATEGORY</th>
              <th>DESCRIPTION</th>
              <th>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            ${expenses.map((e) => `<tr>
              <td>${dateLabel(e.date)}</td>
              <td>${escapeHtml(e.propertyName)}</td>
              <td><span class="status status-normal">${escapeHtml(e.category)}</span></td>
              <td>${escapeHtml(e.description)}</td>
              <td class="table-primary" style="color:var(--rose-600)">-${money(e.amount)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>` : '<div class="empty-state"><strong>No expenses recorded</strong>Click "Record Expense" to log maintenance, taxes, or utility bills.</div>'}
    </section>`;
}

// ----------------- REAL-TIME IN-APP MESSAGING -----------------

function renderMessages() {
  const users = data.users.filter((u) => u.id !== currentUser.id && u.active);
  // Default to first contact if none selected
  if (!activeChatPartnerId && users.length) {
    activeChatPartnerId = users[0].id;
  }
  const activePartner = data.users.find((u) => u.id === activeChatPartnerId);

  const conversation = data.messages.filter((m) =>
    (m.senderId === currentUser.id && m.recipientId === activeChatPartnerId) ||
    (m.senderId === activeChatPartnerId && m.recipientId === currentUser.id)
  );

  return `${pageHeading("RESIDENT & OWNER CHAT", "Messages", "Direct communication between property managers and residents.")}
    <div class="chat-container">
      <aside class="chat-contacts-pane">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle);font-size:12px;font-weight:700;color:var(--text-muted)">
          CONVERSATIONS (${users.length})
        </div>
        <div style="overflow-y:auto;flex:1">
          ${users.map((u) => `
            <div class="chat-contact-item${u.id === activeChatPartnerId ? " active" : ""}" data-action="select-chat-partner" data-id="${escapeHtml(u.id)}">
              <span class="avatar avatar-emerald">${escapeHtml(initials(u.name))}</span>
              <div style="min-width:0;flex:1">
                <strong style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.name)}</strong>
                <span style="font-size:11px;color:var(--text-subtle)">${statusPill(u.role)}</span>
              </div>
            </div>
          `).join("") || '<div style="padding:16px;font-size:12px;color:var(--text-muted)">No other users.</div>'}
        </div>
      </aside>

      <section class="chat-history-pane">
        <div class="chat-header">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="avatar avatar-emerald">${escapeHtml(initials(activePartner?.name))}</span>
            <div>
              <strong style="font-size:14px;color:var(--text-main)">${escapeHtml(activePartner?.name || "Direct Message")}</strong>
              <span style="display:block;font-size:11px;color:var(--text-muted)">${escapeHtml(activePartner?.email || "")}</span>
            </div>
          </div>
          <span class="live-indicator"><span class="pulse-dot"></span> Live Chat</span>
        </div>

        <div class="chat-messages-scroll" id="chat-messages-scroll">
          ${conversation.map((m) => {
            const isMe = m.senderId === currentUser.id;
            return `<div class="chat-bubble ${isMe ? "chat-bubble-sent" : "chat-bubble-received"}">
              <div>${escapeHtml(m.message)}</div>
              <span class="chat-bubble-meta">${timeAgo(m.createdAt)}</span>
            </div>`;
          }).join("") || '<div class="empty-state">No messages yet. Send a message to start the conversation!</div>'}
        </div>

        <form class="chat-input-bar" id="chat-form">
          <input class="form-control" id="chat-input" type="text" placeholder="Type a message..." autocomplete="off" required>
          <button class="button" type="submit">Send</button>
        </form>
      </section>
    </div>`;
}

// ----------------- TENANTS DIRECTORY -----------------

function renderTenants() {
  const rows = data.tenants.filter((t) => t.propertyId).map((t) => {
    const property = getProperty(t.propertyId);
    return `<tr>
      <td>
        <div class="tenant-badge-cell">
          <span class="avatar avatar-emerald">${escapeHtml(initials(t.name))}</span>
          <div>
            <span class="table-primary">${escapeHtml(t.name)}</span>
            <span class="table-secondary">Resident</span>
          </div>
        </div>
      </td>
      <td>${escapeHtml(t.email)}</td>
      <td>${escapeHtml(property?.name || t.propertyName || "—")}</td>
      <td class="table-primary">${money(property?.rent || t.rent)}</td>
      <td>${t.leaseEnd ? dateLabel(t.leaseEnd) : "—"}</td>
      <td>${statusPill("Active")}</td>
      <td>
        <button class="button button-quiet" data-action="view-property-details" data-id="${escapeHtml(t.propertyId)}">View lease</button>
      </td>
    </tr>`;
  }).join("");

  return `${pageHeading("PEOPLE & RESIDENTS", "Tenants", "Manage resident accounts and active property leases.", isManager() ? '<button class="button" data-action="add-tenant"><span>' + svgIcon("plus", 14) + '</span> Assign Tenant</button>' : "")}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Current Residents</h2>
          <p class="panel-subtitle">Tenants must register an account before lease assignment</p>
        </div>
      </div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>TENANT</th><th>EMAIL</th><th>ASSIGNED RESIDENCE</th><th>MONTHLY RENT</th><th>LEASE EXPIRATION</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><strong>No active tenant assignments</strong>Assign registered tenants to vacant properties.</div>'}
    </section>`;
}

// ----------------- PAYMENTS & DIGITAL INVOICES -----------------

function renderPayments() {
  const payments = currentUser.role === "tenant"
    ? data.payments.filter((p) => p.tenantId === currentUser.id)
    : [...data.payments];

  const totalCollected = payments.filter((p) => p.status === "Paid").reduce((sum, p) => sum + Number(p.amount), 0);
  const pendingAmount = payments.filter((p) => p.status === "Pending").reduce((sum, p) => sum + Number(p.amount), 0);

  const action = `<div class="toolbar">
    <button class="button button-secondary" data-action="export-payments"><span>${svgIcon("download", 14)}</span> Export CSV</button>
    ${currentUser.role === "tenant"
      ? '<button class="button" data-action="pay-rent"><span>' + svgIcon("dollar", 14) + '</span> Pay Rent Online</button>'
      : '<button class="button" data-action="record-payment"><span>' + svgIcon("plus", 14) + '</span> Record Payment</button>'}
  </div>`;

  return `${pageHeading(currentUser.role === "tenant" ? "RENT & INVOICES" : "FINANCIAL TRANSACTIONS", currentUser.role === "tenant" ? "Rent & Invoices" : "Payment Records", currentUser.role === "tenant" ? "View digital payment receipts and settle rent dues." : "Review collections, outstanding dues, and payment records.", action)}
    
    <div class="stats-grid">
      ${statCard(currentUser.role === "tenant" ? "Paid to Date" : "Total Collected", money(totalCollected), "dollar", "Cleared transactions", "+100%")}
      ${statCard(currentUser.role === "tenant" ? "Pending Dues" : "Awaiting Collection", money(pendingAmount), "clock", `${payments.filter((p) => p.status === "Pending").length} pending invoices`)}
      ${statCard("Recorded Payments", payments.length, "check", "Total database records")}
      ${statCard("Monthly Base", money(currentUser.role === "tenant" ? (tenantProperty()?.rent || 0) : data.properties.reduce((s, p) => s + Number(p.rent), 0)), "building", "Current contract amount")}
    </div>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${currentUser.role === "tenant" ? "Your Payment Receipts" : "All Payment Transactions"}</h2>
          <p class="panel-subtitle">Official invoice reference numbers and receipt generation</p>
        </div>
      </div>
      ${payments.length ? `<div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${currentUser.role !== "tenant" ? "<th>TENANT</th>" : ""}
              <th>PROPERTY</th>
              <th>REFERENCE NO</th>
              <th>PAYMENT DATE</th>
              <th>AMOUNT</th>
              <th>METHOD</th>
              <th>STATUS</th>
              <th>RECEIPT</th>
              ${isManager() ? "<th>ACTION</th>" : ""}
            </tr>
          </thead>
          <tbody>
            ${payments.map((p) => {
              const property = getProperty(p.propertyId);
              return `<tr>
                ${currentUser.role !== "tenant" ? `<td><span class="table-primary">${escapeHtml(p.tenantName || "Tenant")}</span></td>` : ""}
                <td>${escapeHtml(property?.name || p.propertyName || "Residence")}</td>
                <td><code style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${escapeHtml(p.referenceNo)}</code></td>
                <td>${dateLabel(p.date)}</td>
                <td class="table-primary">${money(p.amount)}</td>
                <td>${escapeHtml(p.method)}</td>
                <td>${statusPill(p.status)}</td>
                <td>
                  <button class="button button-quiet" data-action="receipt" data-id="${escapeHtml(p.id)}">Invoice ↗</button>
                </td>
                ${isManager() ? `<td>${p.status === "Pending" ? `<button class="button button-quiet" data-action="mark-paid" data-id="${escapeHtml(p.id)}">Mark paid</button>` : "—"}</td>` : ""}
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : '<div class="empty-state"><strong>No payments recorded yet</strong>Recorded transactions and receipts will appear here.</div>'}
    </section>`;
}

function paymentsTable(payments, showTenant = true) {
  if (!payments.length) return '<div class="empty-state"><strong>No transactions yet</strong>Payment history will appear here.</div>';
  return `<div class="table-wrap"><table><thead><tr>${showTenant ? "<th>TENANT</th>" : ""}<th>PROPERTY</th><th>DATE</th><th>AMOUNT</th><th>STATUS</th><th>INVOICE</th></tr></thead><tbody>${payments.map((p) => {
    const property = getProperty(p.propertyId);
    return `<tr>
      ${showTenant ? `<td><span class="table-primary">${escapeHtml(p.tenantName || "Resident")}</span></td>` : ""}
      <td>${escapeHtml(property?.name || p.propertyName || "Property")}</td>
      <td>${dateLabel(p.date)}</td>
      <td class="table-primary">${money(p.amount)}</td>
      <td>${statusPill(p.status)}</td>
      <td><button class="button button-quiet" data-action="receipt" data-id="${escapeHtml(p.id)}">View ↗</button></td>
    </tr>`;
  }).join("")}</tbody></table></div>`;
}

// ----------------- MAINTENANCE CENTER WITH PHOTOS -----------------

function renderMaintenance() {
  const requests = currentUser.role === "tenant"
    ? data.requests.filter((r) => r.tenantId === currentUser.id)
    : data.requests;

  const action = currentUser.role === "tenant"
    ? '<button class="button" data-action="add-request"><span>' + svgIcon("plus", 14) + '</span> Submit Request</button>'
    : "";

  return `${pageHeading("PROPERTY CARE", "Maintenance", currentUser.role === "tenant" ? "Submit repair requests, attach photos, and track resolution live." : "Manage service tickets, review issue photos, and dispatch maintenance.", action)}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${currentUser.role === "tenant" ? "Your Service Tickets" : "Active Service Requests"}</h2>
          <p class="panel-subtitle">${requests.filter((r) => r.status !== "Resolved").length} open ticket${requests.filter((r) => r.status !== "Resolved").length === 1 ? "" : "s"} requiring attention</p>
        </div>
      </div>
      ${maintenanceTable(requests, currentUser.role !== "tenant")}
    </section>`;
}

function maintenanceTable(requests, showTenant = true) {
  if (!requests.length) return '<div class="empty-state"><strong>All caught up!</strong>No open maintenance requests.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>REQUEST TITLE</th>${showTenant ? "<th>RESIDENT</th>" : ""}<th>PROPERTY</th><th>PHOTO</th><th>PRIORITY</th><th>STATUS</th>${isManager() ? "<th>PROGRESSION</th>" : ""}</tr></thead><tbody>${requests.map((r) => {
    const property = getProperty(r.propertyId);
    const nextStatus = r.status === "Open" ? "In progress" : r.status === "In progress" ? "Resolved" : "";
    return `<tr>
      <td>
        <span class="table-primary">${escapeHtml(r.title)}</span>
        <span class="table-secondary">${escapeHtml(r.category)} · ${dateLabel(r.date)}</span>
      </td>
      ${showTenant ? `<td>${escapeHtml(r.tenantName || "Resident")}</td>` : ""}
      <td>${escapeHtml(property?.name || r.propertyName || "Property")}</td>
      <td>
        ${r.photoUrl ? `<a href="${escapeHtml(r.photoUrl)}" target="_blank" class="button button-quiet" style="font-size:11px">📷 View photo</a>` : '<span style="color:var(--text-subtle)">—</span>'}
      </td>
      <td>${statusPill(r.priority)}</td>
      <td>${statusPill(r.status)}</td>
      ${isManager() ? `<td>
        ${nextStatus ? `<button class="button button-small button-secondary" data-action="advance-request" data-id="${escapeHtml(r.id)}">Mark ${escapeHtml(nextStatus)}</button>` : `<span style="color:var(--emerald-600);font-size:12px;font-weight:600">✓ Resolved</span>`}
      </td>` : ""}
    </tr>`;
  }).join("")}</tbody></table></div>`;
}

// ----------------- ADMIN & SYSTEM DATABASE MONITOR -----------------

function renderUsers() {
  const usersRows = data.users.map((u) => `<tr>
    <td><span class="table-primary">${escapeHtml(u.name)}</span></td>
    <td>${escapeHtml(u.email)}</td>
    <td>${statusPill(u.role)}</td>
    <td>${dateLabel(u.created_at)}</td>
    <td>${statusPill(u.active ? "Active" : "Inactive")}</td>
    <td>
      ${u.role === "admin" ? '<span style="color:var(--text-muted);font-size:12px">Protected</span>' : `<button class="button button-quiet" data-action="toggle-user" data-id="${escapeHtml(u.id)}" data-active="${u.active ? "false" : "true"}">${u.active ? "Deactivate" : "Activate"}</button>`}
    </td>
  </tr>`).join("");

  const actions = `<div class="toolbar">
    <a href="/api/admin/db-backup" class="button button-secondary" download><span>${svgIcon("download", 14)}</span> Download SQLite Backup</a>
    <button class="button" data-action="seed-demo"><span>${svgIcon("sparkles", 14)}</span> Populate Sample Portfolio</button>
  </div>`;

  return `${pageHeading("SYSTEM ADMINISTRATION", "Accounts & Database", "Platform account permissions, SQLite WAL engine health, and point-in-time backups.", actions)}
    
    <div class="system-db-stats">
      <div class="db-metric-box">
        <span>Storage Engine</span>
        <strong>SQLite WAL</strong>
      </div>
      <div class="db-metric-box">
        <span>Registered Users</span>
        <strong>${data.users.length}</strong>
      </div>
      <div class="db-metric-box">
        <span>Properties / Leases</span>
        <strong>${data.properties.length} units</strong>
      </div>
      <div class="db-metric-box">
        <span>Audited Activity</span>
        <strong>${(data.activity || []).length} logs</strong>
      </div>
    </div>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Registered Accounts</h2>
          <p class="panel-subtitle">Role permissions and session lifecycle controls</p>
        </div>
      </div>
      ${usersRows ? `<div class="table-wrap"><table><thead><tr><th>USER NAME</th><th>EMAIL</th><th>SYSTEM ROLE</th><th>CREATED</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${usersRows}</tbody></table></div>` : '<div class="empty-state">No users registered yet.</div>'}
    </section>`;
}

// ----------------- FORM CONTROLS & MODALS -----------------

function field(name, label, type = "text", required = true, options = null, value = "", placeholder = "") {
  let input = "";
  if (options) {
    input = `<select class="form-control" id="field-${name}" name="${name}"${required ? " required" : ""}>
      ${options.map(([optVal, optLabel]) => `<option value="${escapeHtml(optVal)}"${optVal === value ? " selected" : ""}>${escapeHtml(optLabel)}</option>`).join("")}
    </select>`;
  } else if (type === "textarea") {
    input = `<textarea class="form-control" id="field-${name}" name="${name}" placeholder="${escapeHtml(placeholder)}"${required ? " required" : ""}>${escapeHtml(value)}</textarea>`;
  } else {
    const isCoordinate = name === "latitude" || name === "longitude" || name.includes("coord");
    const minAttr = type === "number" && !isCoordinate ? ' min="0"' : "";
    input = `<input class="form-control" id="field-${name}" name="${name}" type="${type}" placeholder="${escapeHtml(placeholder)}"${required ? " required" : ""}${type === "number" ? `${minAttr} step="any"` : ""}${type === "password" ? ' minlength="10" maxlength="128" autocomplete="new-password"' : ""} value="${escapeHtml(value)}">`;
  }
  return `<div class="form-field"><label for="field-${name}">${label}${required ? " *" : ""}</label>${input}</div>`;
}

function authField(name, label, type = "text", required = true, options = null, value = "", placeholder = "") {
  return field(name, label, type, required, options, value, placeholder).replaceAll(`field-${name}`, `auth-field-${name}`);
}

function openModal(title, formContent, onSubmit, submitLabel = "Save", modalClass = "") {
  const root = $("#modal-root");
  const content = Array.isArray(formContent) ? formContent.join("") : formContent;
  const isInfoOnly = !onSubmit;
  root.innerHTML = `<div class="modal-backdrop">
    <section class="modal ${modalClass}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 id="modal-title">${escapeHtml(title)}</h2>
        <button class="modal-close" type="button" data-action="close-modal" aria-label="Close dialog">×</button>
      </div>
      <form class="modal-form" id="modal-form" novalidate>
        ${content}
        <div class="form-error" id="form-error" role="alert"></div>
        <div class="modal-actions">
          <button class="button button-secondary" type="button" data-action="close-modal">${isInfoOnly ? escapeHtml(submitLabel) : "Cancel"}</button>
          ${isInfoOnly ? "" : `<button class="button" type="submit">${escapeHtml(submitLabel)}</button>`}
        </div>
      </form>
    </section>
  </div>`;

  $("#modal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!onSubmit) { root.innerHTML = ""; return; }
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const submit = $('button[type="submit"]', form);
    submit.disabled = true;
    submit.textContent = "Processing…";
    try {
      await onSubmit(values);
      root.innerHTML = "";
      await loadData();
    } catch (error) {
      $("#form-error").textContent = error.message;
      submit.disabled = false;
      submit.textContent = submitLabel;
    }
  });

  $(".modal-backdrop", root).addEventListener("click", (event) => {
    if (event.target === event.currentTarget) root.innerHTML = "";
  });

  const firstInput = $(".form-control", root);
  if (firstInput) firstInput.focus();
}

// ----------------- MODAL WORKFLOWS -----------------

function addProperty() {
  const ownerOptions = data.users.filter((u) => u.role === "landlord" && u.active).map((u) => [u.id, u.name]);
  const presets = [
    { name: "Modern Penthouse", url: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80" },
    { name: "Designer Townhome", url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80" },
    { name: "Lakeside Craftsman", url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80" }
  ];

  const presetPicker = `<div>
    <div class="preset-picker-label">Featured Photography Preset:</div>
    <div class="photo-presets-grid">
      ${presets.map((p, idx) => `
        <button type="button" class="photo-preset-btn${idx === 0 ? " selected" : ""}" data-preset-url="${escapeHtml(p.url)}">
          <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.name)}">
        </button>
      `).join("")}
    </div>
  </div>`;

  const fields = [
    presetPicker,
    field("name", "Property title", "text", true, null, "", "e.g. Skyline Luxury Apartment 4B"),
    `<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
      ${field("address", "Street address", "text", true, null, "", "123 Main St")}
      ${field("city", "City", "text", false, null, "San Francisco")}
    </div>`,
    field("type", "Property type", "select", true, [
      ["Apartment", "Apartment"],
      ["House", "Single Family House"],
      ["Townhouse", "Townhouse"],
      ["Condo", "Condo"]
    ]),
    `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      ${field("bedrooms", "Beds", "number", true, null, "2")}
      ${field("bathrooms", "Baths", "number", true, null, "2")}
      ${field("sqft", "Sq. Ft", "number", false, null, "1250")}
    </div>`,
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${field("rent", "Monthly rent ($)", "number", true, null, "2500")}
      ${field("deposit", "Security deposit ($)", "number", false, null, "2500")}
    </div>`,
    field("imageUrl", "Custom image URL (optional)", "text", false, null, presets[0].url),
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${field("latitude", "Latitude", "number", false, null, "", "e.g. 37.7749")}
      ${field("longitude", "Longitude", "number", false, null, "", "e.g. -122.4194")}
    </div>`
  ];

  if (currentUser.role === "admin" && ownerOptions.length) {
    fields.push(field("landlordId", "Assigned landlord owner", "select", false, [["", "Admin-managed"], ...ownerOptions]));
  }

  openModal("Add Property to Portfolio", fields, async (values) => {
    await api("/api/properties", { method: "POST", body: JSON.stringify(values) });
    showToast("Property added successfully.");
  }, "Create Property", "modal-large");

  $$(".photo-preset-btn", $("#modal-root")).forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".photo-preset-btn", $("#modal-root")).forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      const urlInput = $("#field-imageUrl");
      if (urlInput) urlInput.value = btn.dataset.presetUrl;
    });
  });
}

function addTenant(preselectedProperty = "") {
  const vacant = data.properties.filter((p) => !p.tenantId);
  if (!vacant.length) return showToast("No vacant properties available. Add a property first.", true);
  const options = vacant.map((p) => [p.id, `${p.name} ($${p.rent}/mo)`]);
  const selected = options.some(([id]) => id === preselectedProperty) ? preselectedProperty : options[0][0];

  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  const defaultLeaseEnd = oneYearFromNow.toISOString().slice(0, 10);

  openModal("Assign Resident to Property", [
    field("email", "Registered resident email", "email", true, null, "", "tenant@example.com"),
    field("propertyId", "Vacant unit", "select", true, options, selected),
    field("leaseEnd", "Lease expiration date", "date", true, null, defaultLeaseEnd)
  ], async (values) => {
    await api("/api/tenants/assign", { method: "POST", body: JSON.stringify(values) });
    showToast("Resident assigned and active lease generated.");
  }, "Confirm Lease Assignment");
}

function addRequest() {
  if (!tenantProperty()) return showToast("Your account must be assigned to a property to submit requests.", true);
  
  const photoPresets = [
    ["https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=600&q=80", "Plumbing Leak"],
    ["https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80", "Electrical Issue"],
    ["https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=600&q=80", "Kitchen Appliance"]
  ];

  openModal("Submit Maintenance Request", [
    field("title", "Issue title", "text", true, null, "", "e.g. Water leak under bathroom sink"),
    field("category", "Service category", "select", true, [
      ["Plumbing", "Plumbing"],
      ["Electrical", "Electrical"],
      ["Appliance", "Kitchen & Appliances"],
      ["HVAC", "Heating & AC"],
      ["Repairs", "General Carpentry & Repairs"],
      ["Other", "Other"]
    ]),
    field("priority", "Urgency level", "select", true, [
      ["Normal", "Normal (Standard resolution)"],
      ["High", "High (Priority response)"],
      ["Urgent", "Urgent (Immediate attention)"]
    ]),
    field("description", "Describe the problem in detail", "textarea", true, null, "", "Please describe when the issue started and any relevant details..."),
    field("photoUrl", "Issue photo URL (optional)", "text", false, null, photoPresets[0][0])
  ], async (values) => {
    await api("/api/maintenance", { method: "POST", body: JSON.stringify(values) });
    showToast("Maintenance request submitted with photo attachment.");
  }, "Submit Ticket");
}

function recordExpense() {
  const propertyOptions = [["", "General Portfolio / Overhead"], ...data.properties.map((p) => [p.id, p.name])];
  openModal("Record Operating Expense", [
    field("propertyId", "Property attribution", "select", false, propertyOptions),
    field("category", "Expense category", "select", true, [
      ["Repairs", "Repairs & Maintenance"],
      ["Taxes", "Property Taxes"],
      ["Insurance", "Property Hazard / Flood Insurance"],
      ["Utilities", "Water / Trash / Electric"],
      ["Mortgage", "Mortgage Interest / Principal"],
      ["Management", "Property Management Fee"],
      ["Other", "Other Miscellaneous"]
    ]),
    field("amount", "Expense amount ($)", "number", true, null, "150"),
    field("date", "Expense date", "date", true, null, today()),
    field("description", "Description / Vendor", "text", true, null, "", "e.g. Roof repair by ABC Contractors")
  ], async (values) => {
    await api("/api/expenses", { method: "POST", body: JSON.stringify(values) });
    showToast("Operating expense logged to cash flow ledger.");
  }, "Save Expense");
}

function postAnnouncement() {
  const propOptions = [["", "All Properties (Global Notice)"], ...data.properties.map((p) => [p.id, p.name])];
  openModal("Broadcast Community Notice", [
    field("propertyId", "Target property", "select", false, propOptions),
    field("priority", "Notice priority", "select", true, [
      ["Normal", "Normal Notice"],
      ["Important", "Important (Highlighted)"],
      ["Urgent", "Urgent Alert (Immediate Attention)"]
    ]),
    field("title", "Announcement title", "text", true, null, "", "e.g. Scheduled water shutoff on Friday"),
    field("content", "Notice details", "textarea", true, null, "", "Please provide details for the residents...")
  ], async (values) => {
    await api("/api/announcements", { method: "POST", body: JSON.stringify(values) });
    showToast("Community notice published live.");
  }, "Broadcast Announcement");
}

function payRent() {
  const prop = tenantProperty();
  if (!prop) return showToast("No rental property assigned to your account.", true);
  openModal("Simulated Online Rent Checkout", `
    <div class="receipt-card" style="margin-bottom:16px;background:var(--bg-panel-subtle)">
      <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase">PAYMENT SUMMARY</div>
      <div style="font-size:24px;font-weight:800;color:var(--text-main);margin:4px 0">${money(prop.rent)}</div>
      <div style="font-size:13px;color:var(--text-muted)">Residence: <strong>${escapeHtml(prop.name)}</strong></div>
    </div>
    ${field("method", "Payment method", "select", true, [
      ["Card", "Debit / Credit Card (•••• 4242)"],
      ["Bank transfer", "ACH Direct Deposit (Bank of America)"],
      ["Apple Pay", "Apple Pay / Digital Wallet"]
    ])}
  `, async (values) => {
    await api("/api/payments/pay", { method: "POST", body: JSON.stringify(values) });
    showToast("Demo payment confirmed! Your official receipt is ready.");
  }, "Authorize Demo Payment");
}

function recordPayment() {
  const occupied = data.properties.filter((p) => p.tenantId);
  if (!occupied.length) return showToast("Assign a tenant to a property before recording rent.", true);

  openModal("Record Rent Payment", [
    field("propertyId", "Occupied unit", "select", true, occupied.map((p) => [p.id, `${p.name} — ${p.tenantName || "Tenant"}`])),
    field("amount", "Amount received ($)", "number", true, null, occupied[0].rent),
    field("date", "Transaction date", "date", true, null, today()),
    field("method", "Payment method", "select", true, [
      ["Bank transfer", "Bank ACH Transfer"],
      ["Card", "Credit / Debit Card"],
      ["Check", "Paper Check"],
      ["Cash", "Cash Deposit"],
      ["Other", "Other"]
    ]),
    field("notes", "Internal payment notes (optional)", "text", false, null, "", "e.g. Cleared via online portal")
  ], async (values) => {
    await api("/api/payments", { method: "POST", body: JSON.stringify(values) });
    showToast("Payment transaction logged.");
  }, "Record Payment");
}

function showReceipt(paymentId) {
  const payment = data.payments.find((p) => p.id === paymentId);
  if (!payment) return showToast("Payment record not found.", true);
  const property = getProperty(payment.propertyId);

  openModal("Official Rent Invoice & Receipt", `
    <div class="receipt-card">
      <div class="receipt-stamp">PAID</div>
      <div class="receipt-header">
        <div class="receipt-id-tag">OFFICIAL RECEIPT · ${escapeHtml(payment.referenceNo || `RE-${payment.id.slice(0, 8)}`)}</div>
        <div class="receipt-amount-display">${money(payment.amount)}</div>
        <p style="color:var(--text-muted);font-size:13px">Payment cleared on ${dateLabel(payment.date)}</p>
      </div>
      <div class="receipt-meta-grid">
        <div class="receipt-meta-item">
          <strong>Resident / Billed To</strong>
          <span>${escapeHtml(payment.tenantName || currentUser.name)}</span>
          <span style="display:block;font-size:12px;color:var(--text-subtle)">${escapeHtml(payment.tenantEmail || "")}</span>
        </div>
        <div class="receipt-meta-item">
          <strong>Rental Residence</strong>
          <span>${escapeHtml(property?.name || payment.propertyName || "Rental Unit")}</span>
          <span style="display:block;font-size:12px;color:var(--text-subtle)">${escapeHtml(property?.address || "")}</span>
        </div>
        <div class="receipt-meta-item">
          <strong>Payment Method</strong>
          <span>${escapeHtml(payment.method)}</span>
        </div>
        <div class="receipt-meta-item">
          <strong>Billing Period</strong>
          <span>${escapeHtml(payment.periodMonth || dateLabel(payment.date))}</span>
        </div>
      </div>
      <table class="receipt-breakdown">
        <tbody>
          <tr>
            <td>Monthly Lease Rent</td>
            <td style="text-align:right;font-weight:600">${money(payment.amount)}</td>
          </tr>
          <tr>
            <td>Processing & Platform Fee</td>
            <td style="text-align:right;color:var(--text-subtle)">$0.00</td>
          </tr>
          <tr style="border-top:1px solid var(--border-subtle);font-size:15px">
            <td style="padding-top:10px;font-weight:700">Total Cleared</td>
            <td style="padding-top:10px;text-align:right;font-weight:800;color:var(--primary)">${money(payment.amount)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="modal-actions" style="margin-top:16px">
      <button class="button button-secondary" type="button" data-action="close-modal">Close</button>
      <button class="button" type="button" data-action="print-receipt">Print Receipt</button>
    </div>
  `, async () => {});

  const form = $("#modal-form");
  form.querySelectorAll("input,textarea,select,button[type='submit']").forEach((el) => el.remove());
  form.addEventListener("submit", (e) => e.preventDefault());
}

function showPropertyDetails(propertyId) {
  const p = getProperty(propertyId);
  if (!p) return;
  const isOccupied = Boolean(p.tenantId);
  const tenant = getTenant(p.tenantId);
  const lease = (data.leases || []).find((l) => l.propertyId === p.id);
  const payments = data.payments.filter((item) => item.propertyId === p.id);
  const expenses = (data.expenses || []).filter((item) => item.propertyId === p.id);

  openModal(`Property Overview: ${p.name}`, `
    <div style="display:flex;flex-direction:column;gap:18px">
      <div style="border-radius:var(--radius-md);overflow:hidden;height:180px">
        <img src="${escapeHtml(p.imageUrl || "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80")}" alt="${escapeHtml(p.name)}" style="width:100%;height:100%;object-fit:cover">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
        <div><strong>Type:</strong> ${escapeHtml(p.type)}</div>
        <div><strong>Monthly Rent:</strong> ${money(p.rent)}</div>
        <div><strong>Address:</strong> ${escapeHtml(p.address)}${p.city ? `, ${escapeHtml(p.city)}` : ""}</div>
        <div><strong>Specs:</strong> ${p.bedrooms} Bed · ${p.bathrooms} Bath ${p.sqft ? `· ${p.sqft} sqft` : ""}</div>
        <div><strong>Status:</strong> ${statusPill(isOccupied ? "Occupied" : "Vacant")}</div>
        <div><strong>Deposit:</strong> ${money(p.deposit || p.rent)}</div>
      </div>

      <!-- Digital Lease & Signature Section -->
      <div style="padding:14px;background:var(--bg-panel-subtle);border-radius:var(--radius-md);border:1px solid var(--border-subtle)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <h4 style="margin:0;font-size:14px;font-weight:700">Digital Lease Agreement</h4>
          ${lease?.signatureData ? '<span class="signed-badge">✓ Digitally Signed</span>' : '<span class="status status-pending">Awaiting Signature</span>'}
        </div>
        ${isOccupied ? `
          <p style="margin:0;font-size:13px">Resident: <strong>${escapeHtml(p.tenantName || tenant?.name)}</strong> (${escapeHtml(p.tenantEmail || tenant?.email)})</p>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-muted)">Lease term ends: ${dateLabel(p.leaseEnd)}</p>
          ${lease && !lease.signatureData ? `
            <div class="signature-box" style="margin-top:12px">
              <label style="font-size:12px;font-weight:600;color:var(--text-muted)">Sign Lease Agreement Below:</label>
              <canvas class="signature-canvas" id="lease-sign-canvas"></canvas>
              <div class="signature-actions">
                <button type="button" class="button button-quiet" id="clear-sig-btn">Clear</button>
                <button type="button" class="button button-small" id="confirm-sig-btn" data-lease-id="${escapeHtml(lease.id)}">Confirm Digital Signature</button>
              </div>
            </div>
          ` : lease?.signatureData ? `
            <div style="margin-top:10px;padding:8px;background:var(--bg-panel);border-radius:6px;border:1px solid var(--border-subtle)">
              <div style="font-size:11px;color:var(--text-muted)">Verified Signature of ${escapeHtml(lease.signedBy)}:</div>
              <img src="${escapeHtml(lease.signatureData)}" alt="Signature" style="height:48px;display:block;margin-top:4px">
            </div>
          ` : ""}
        ` : `
          <p style="margin:0;font-size:13px;color:var(--text-muted)">No tenant assigned.</p>
          ${isManager() ? `<button class="button button-small" type="button" data-action="add-tenant" data-property="${escapeHtml(p.id)}" style="margin-top:8px">Assign Tenant</button>` : ""}
        `}
      </div>

      <div>
        <h4 style="margin:0 0 8px;font-size:13px">Property Payments (${payments.length})</h4>
        ${payments.slice(0, 3).map((pay) => `<div style="font-size:12px;padding:6px 0;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between"><span>${dateLabel(pay.date)} (${pay.method})</span><strong>${money(pay.amount)} · ${pay.status}</strong></div>`).join("") || '<p style="font-size:12px;color:var(--text-subtle);margin:0">No payment history recorded.</p>'}
      </div>
    </div>
    <div class="modal-actions" style="margin-top:14px">
      <button class="button button-secondary" type="button" data-action="close-modal">Close</button>
    </div>
  `, async () => {}, "Close", "modal-large");

  const form = $("#modal-form");
  form.querySelectorAll("input,textarea,select,button[type='submit']").forEach((el) => el.remove());
  form.addEventListener("submit", (e) => e.preventDefault());

  // Initialize signature canvas pad if available
  const canvas = $("#lease-sign-canvas");
  if (canvas) {
    initSignatureCanvas(canvas, $("#confirm-sig-btn"));
  }
}

// ----------------- INTERACTIVE SIGNATURE PAD -----------------

function initSignatureCanvas(canvas, confirmBtn) {
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.offsetWidth || 400;
  canvas.height = 140;
  ctx.strokeStyle = "#059669";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";

  let drawing = false;

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e) => {
    drawing = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  };

  const moveDraw = (e) => {
    if (!drawing) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
  };

  const stopDraw = () => { drawing = false; };

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", stopDraw);

  canvas.addEventListener("touchstart", startDraw, { passive: false });
  canvas.addEventListener("touchmove", moveDraw, { passive: false });
  window.addEventListener("touchend", stopDraw);

  $("#clear-sig-btn")?.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  confirmBtn?.addEventListener("click", async () => {
    const dataUrl = canvas.toDataURL("image/png");
    const leaseId = confirmBtn.dataset.leaseId;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Signing…";
    try {
      await api(`/api/leases/${encodeURIComponent(leaseId)}/sign`, {
        method: "POST",
        body: JSON.stringify({ signatureData: dataUrl })
      });
      showToast("Lease agreement digitally signed!");
      $("#modal-root").innerHTML = "";
      await loadData();
    } catch (err) {
      showToast(err.message, true);
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirm Digital Signature";
    }
  });
}

// ----------------- ACTION HANDLERS -----------------

async function advanceRequest(id) {
  await api(`/api/maintenance/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({}) });
  showToast("Maintenance ticket status progressed.");
  await loadData();
}

async function markPaid(id) {
  await api(`/api/payments/${encodeURIComponent(id)}/paid`, { method: "PATCH", body: JSON.stringify({}) });
  showToast("Payment status confirmed as Paid.");
  await loadData();
}

async function toggleUser(id, active) {
  await api(`/api/admin/users/${encodeURIComponent(id)}/active`, { method: "PATCH", body: JSON.stringify({ active }) });
  showToast(active ? "Account access restored." : "Account deactivated.");
  await loadData();
}

async function seedDemoData() {
  try {
    const res = await api("/api/demo/seed", { method: "POST", body: JSON.stringify({}) });
    showToast(`Successfully populated ${res.count} curated sample properties!`);
    await loadData();
  } catch (error) {
    showToast(error.message, true);
  }
}

// ----------------- PUBLIC PAGES: ABOUT, CONTACT, HELP -----------------

function renderGuestPublicPage() {
  $("#app-shell").hidden = true;
  const root = $("#auth-root");
  root.hidden = false;
  const renderers = { about: renderAbout, contact: renderContact, help: renderHelp };
  const pageFn = renderers[currentPage];
  root.innerHTML = `<div class="guest-public-wrapper" style="max-width:960px;margin:0 auto;padding:30px 20px 40px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
      <a class="brand" href="/" aria-label="RentEase home" style="display:flex;align-items:center;gap:8px;text-decoration:none;">
        <span class="brand-mark">${svgIcon("home", 18)}</span>
        <span class="brand-text">rent<span class="brand-accent">ease</span></span>
      </a>
      <button class="button button-quiet" id="guest-back-btn" type="button">← Back to Sign In</button>
    </div>
    ${pageFn ? pageFn() : ""}
  </div>`;
  $("#guest-back-btn")?.addEventListener("click", () => { currentPage = "dashboard"; showAuth(); });
  if (currentPage === "help") setTimeout(initHelpInteractions, 0);
  if (currentPage === "contact") setTimeout(initContactForm, 0);
}

function renderAbout() {
  return `
    <div class="about-hero">
      <div class="eyebrow">ABOUT RENTEASE</div>
      <h2>Modern Property Management, Reimagined</h2>
      <p>RentEase is a comprehensive property and tenant management platform engineered to simplify every aspect of rental operations — from lease signing and rent collection to real-time maintenance tracking and financial analytics. Built for landlords, property managers, and tenants who demand clarity, speed, and reliability.</p>
    </div>

    <div class="pillars-grid">
      <div class="pillar-card">
        <div class="pillar-icon">${svgIcon("database", 22)}</div>
        <h3>Robust Data Architecture</h3>
        <p>Powered by SQLite in WAL mode with multi-table transactions, activity logging, and automatic migrations. Your data is always consistent and instantly queryable.</p>
      </div>
      <div class="pillar-card">
        <div class="pillar-icon">${svgIcon("shield", 22)}</div>
        <h3>Security First</h3>
        <p>bcrypt password hashing, server-side session management, Helmet security headers, and CORS policies. Every API endpoint is authenticated and rate-limited.</p>
      </div>
      <div class="pillar-card">
        <div class="pillar-icon">${svgIcon("sparkles", 22)}</div>
        <h3>Real-Time Collaboration</h3>
        <p>Socket.IO-powered live synchronization ensures every dashboard, payment record, and maintenance ticket updates instantly across all connected devices.</p>
      </div>
    </div>

    <div class="pillars-grid">
      <div class="pillar-card">
        <div class="pillar-icon">${svgIcon("building", 22)}</div>
        <h3>Property Portfolio</h3>
        <p>Manage unlimited properties with grid, list, and interactive Leaflet map views. Filter by type, status, and rent range with CSV export support.</p>
      </div>
      <div class="pillar-card">
        <div class="pillar-icon">${svgIcon("dollar", 22)}</div>
        <h3>Financial Intelligence</h3>
        <p>Track rent collection, expenses, and Net Operating Income with visual breakdowns. Generate payment receipts and export financial data instantly.</p>
      </div>
      <div class="pillar-card">
        <div class="pillar-icon">${svgIcon("message", 22)}</div>
        <h3>Integrated Messaging</h3>
        <p>Built-in landlord-tenant messaging with real-time delivery, read tracking, and conversation history. No external tools required.</p>
      </div>
    </div>

    <section class="panel" style="margin-top:10px;">
      <div class="panel-header"><h2 class="panel-title">Platform Metrics</h2></div>
      <div class="stats-grid">
        ${statCard("Architecture", "SQLite WAL", "database", "ACID-compliant transactions")}
        ${statCard("Real-Time", "Socket.IO", "sparkles", "Sub-second event delivery")}
        ${statCard("Security", "bcrypt + Helmet", "shield", "Industry-standard protection")}
        ${statCard("API Endpoints", "25+", "trendingUp", "RESTful JSON architecture")}
      </div>
    </section>`;
}

function renderContact() {
  return `
    ${pageHeading("GET IN TOUCH", "Contact Us", "Have a question, feature request, or need support? Our team is here to help.")}

    <div class="contact-split-grid">
      <div class="contact-info-panel">
        <div class="contact-method-card">
          <div class="contact-method-icon">${svgIcon("message", 20)}</div>
          <div class="contact-method-details">
            <strong>Email Support</strong>
            <p>support@rentease.io</p>
            <span>Typical reply within 4 hours</span>
          </div>
        </div>
        <div class="contact-method-card">
          <div class="contact-method-icon">${svgIcon("building", 20)}</div>
          <div class="contact-method-details">
            <strong>Headquarters</strong>
            <p>742 Evergreen Terrace, Suite 300<br>San Francisco, CA 94102</p>
            <span>Mon – Fri, 9 AM – 6 PM PT</span>
          </div>
        </div>
        <div class="contact-method-card">
          <div class="contact-method-icon">${svgIcon("shield", 20)}</div>
          <div class="contact-method-details">
            <strong>Platform Status</strong>
            <p>All systems operational</p>
            <span>99.98% uptime this quarter</span>
          </div>
        </div>
      </div>

      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">Send Us a Message</h2>
          <p class="panel-subtitle">We'll respond as quickly as possible</p>
        </div>
        <form id="contact-support-form" class="auth-form" style="padding:20px 24px 24px;" novalidate>
          ${field("contact_name", "Your Name", "text", true, null, "", "Jane Doe")}
          ${field("contact_email", "Email Address", "email", true, null, "", "name@example.com")}
          ${field("contact_subject", "Subject", "text", true, null, "", "e.g. Billing question")}
          <div class="form-group">
            <label class="form-label" for="field-contact_message">Message</label>
            <textarea class="form-control" id="field-contact_message" name="contact_message" rows="5" required placeholder="How can we help you today?"></textarea>
          </div>
          <div class="form-error" id="contact-error" role="alert"></div>
          <button class="button auth-submit" type="submit">Send Message</button>
        </form>
      </section>
    </div>`;
}

function renderHelp() {
  const faqData = [
    { cat: "getting-started", q: "How do I create an account?", a: "Click the \"Create account\" tab on the sign-in page. Choose your role (Landlord or Tenant), enter your details, and you're in. The whole process takes under 30 seconds." },
    { cat: "getting-started", q: "What is the demo seed data?", a: "Landlords can click \"Seed Demo Data\" on the dashboard to populate the database with curated sample properties, tenants, and payment records — great for exploring the platform without entering real data." },
    { cat: "properties", q: "How do I add a new property?", a: "Navigate to Properties → click \"Add Property\". Fill in the address, type, bedrooms, bathrooms, rent amount, and status. The property appears instantly on your grid, list, and map views." },
    { cat: "properties", q: "Can I see my properties on a map?", a: "Yes! On the Properties page, click the Map view toggle. RentEase uses Leaflet.js to plot each property with latitude and longitude on an interactive map with markers and popups." },
    { cat: "payments", q: "How does rent collection work?", a: "Landlords can record payments manually or mark invoices as paid. Tenants see their rent balance and can submit a payment request. All transactions are logged in the activity feed with timestamps." },
    { cat: "payments", q: "Can I export payment records?", a: "Absolutely. On the Payments page, click the \"Export CSV\" button to download a spreadsheet of all payment records including date, amount, status, and tenant details." },
    { cat: "maintenance", q: "How do I submit a maintenance request?", a: "Tenants can go to Maintenance → \"New Request\". Describe the issue, set the priority (Low, Medium, High, Urgent), and submit. The landlord sees it instantly via real-time sync." },
    { cat: "maintenance", q: "How does the maintenance workflow progress?", a: "Requests move through statuses: Open → In Progress → Resolved. Landlords advance the status with one click, and tenants are updated in real time." },
    { cat: "messaging", q: "Is the messaging system real-time?", a: "Yes. RentEase uses Socket.IO for instant message delivery. When someone sends you a message, it appears immediately without refreshing — and you get a toast notification on other pages." },
    { cat: "security", q: "How is my data protected?", a: "Passwords are hashed with bcrypt (10 salt rounds). Sessions are server-side with secure cookies. Helmet sets security headers, and all endpoints require authentication. The database uses WAL mode for crash resilience." },
    { cat: "security", q: "Can I switch between dark and light themes?", a: "Yes — click the sun/moon icon in the top navigation bar. Your preference is saved in localStorage and persists across sessions." },
    { cat: "account", q: "How do I sign out?", a: "Click the sign-out icon next to your profile card in the sidebar. Your session is destroyed server-side and you're returned to the login screen." },
    { cat: "account", q: "What roles are available?", a: "Three roles: Tenant (resident with rent/maintenance access), Landlord (property owner with full portfolio management), and Admin (platform-wide control including user management and database health)." }
  ];

  const categories = [
    { key: "all", icon: svgIcon("search", 16), label: "All Topics" },
    { key: "getting-started", icon: svgIcon("sparkles", 16), label: "Getting Started" },
    { key: "properties", icon: svgIcon("building", 16), label: "Properties" },
    { key: "payments", icon: svgIcon("dollar", 16), label: "Payments" },
    { key: "maintenance", icon: svgIcon("wrench", 16), label: "Maintenance" },
    { key: "messaging", icon: svgIcon("message", 16), label: "Messaging" },
    { key: "security", icon: svgIcon("shield", 16), label: "Security" },
    { key: "account", icon: svgIcon("users", 16), label: "Account" }
  ];

  return `
    <div class="help-search-hero">
      <div class="eyebrow">HELP CENTER</div>
      <h2>How can we help you?</h2>
      <p style="color:var(--text-muted);font-size:14px;margin-bottom:0;">Search our knowledge base or browse topics below</p>
      <input class="help-search-input" id="help-faq-search" type="text" placeholder="Search FAQs — e.g. 'payment', 'maintenance', 'map'…" autocomplete="off" />
    </div>

    <div class="help-topics-grid">
      ${categories.filter(c => c.key !== "all").map(c => `
        <div class="help-topic-card" data-action="filter-faq" data-cat="${c.key}">
          <span>${c.icon}</span>
          <strong>${c.label}</strong>
          <p>${faqData.filter(f => f.cat === c.key).length} articles</p>
        </div>
      `).join("")}
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;">
      ${categories.map(c => `<button class="button button-quiet faq-cat-btn${c.key === "all" ? " active" : ""}" data-action="filter-faq" data-cat="${c.key}" type="button">${c.icon} ${c.label}</button>`).join("")}
    </div>

    <div class="faq-accordion-group" id="faq-accordion-group">
      ${faqData.map((item, i) => `
        <div class="faq-item" data-faq-cat="${item.cat}" data-faq-index="${i}">
          <button class="faq-question" type="button">
            <span>${escapeHtml(item.q)}</span>
            <span class="faq-chevron">▼</span>
          </button>
          <div class="faq-answer">${escapeHtml(item.a)}</div>
        </div>
      `).join("")}
    </div>`;
}

// Init FAQ accordion toggles, search filter, and category filter
function initHelpInteractions() {
  // Accordion toggle
  $$("#faq-accordion-group .faq-question").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".faq-item");
      item.classList.toggle("open");
    });
  });

  // Search filter
  const searchInput = $("#help-faq-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      $$("#faq-accordion-group .faq-item").forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = query && !text.includes(query) ? "none" : "";
      });
    });
  }
}

// Init contact form submission
function initContactForm() {
  const form = $("#contact-support-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const vals = Object.fromEntries(new FormData(form).entries());
    const btn = $(".auth-submit", form);
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await api("/api/contact", {
        method: "POST",
        body: JSON.stringify({
          name: vals.contact_name,
          email: vals.contact_email,
          subject: vals.contact_subject,
          message: vals.contact_message
        })
      });
      showToast("Your message has been sent! We'll get back to you soon.");
      form.reset();
    } catch (err) {
      const errEl = $("#contact-error");
      if (errEl) errEl.textContent = err.message;
      showToast(err.message, true);
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = "Send Message";
      }
    }
  });
}

// ----------------- EVENT LISTENERS -----------------

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-page], [data-action], [data-auth-mode], #theme-toggle-btn");
  if (!target) return;

  if (target.id === "theme-toggle-btn") {
    return toggleTheme();
  }

  if (target.dataset.authMode) {
    return showAuth(target.dataset.authMode);
  }

  if (target.dataset.page) {
    event.preventDefault();
    const page = target.dataset.page;
    const publicPages = ["about", "contact", "help"];
    // Allow public pages even without login
    if (!currentUser && !publicPages.includes(page)) return;
    currentPage = page;
    searchQuery = "";
    $("#sidebar")?.classList.remove("open");
    render();
    return;
  }

  const { action, id, property } = target.dataset;

  if (action === "close-modal") {
    $("#modal-root").innerHTML = "";
  } else if (action === "print-receipt") {
    window.print();
  } else if (action === "add-property") {
    addProperty();
  } else if (action === "add-tenant") {
    addTenant(property || "");
  } else if (action === "add-request") {
    addRequest();
  } else if (action === "pay-rent") {
    payRent();
  } else if (action === "record-payment") {
    recordPayment();
  } else if (action === "record-expense") {
    recordExpense();
  } else if (action === "post-announcement") {
    postAnnouncement();
  } else if (action === "receipt") {
    showReceipt(id);
  } else if (action === "view-property-details") {
    showPropertyDetails(id);
  } else if (action === "advance-request") {
    try { await advanceRequest(id); } catch (e) { showToast(e.message, true); }
  } else if (action === "mark-paid") {
    try { await markPaid(id); } catch (e) { showToast(e.message, true); }
  } else if (action === "toggle-user") {
    try { await toggleUser(id, target.dataset.active === "true"); } catch (e) { showToast(e.message, true); }
  } else if (action === "seed-demo") {
    await seedDemoData();
  } else if (action === "view-grid") {
    currentView = "grid";
    render();
  } else if (action === "view-list") {
    currentView = "list";
    render();
  } else if (action === "view-map") {
    currentView = "map";
    render();
  } else if (action === "select-chat-partner") {
    activeChatPartnerId = id;
    render();
  } else if (action === "export-payments") {
    exportToCsv("RentEase_Payments_2026.csv", data.payments);
  } else if (action === "export-expenses") {
    exportToCsv("RentEase_Expenses_2026.csv", data.expenses);
  } else if (action === "filter-faq") {
    const cat = target.dataset.cat || "all";
    // Update active button
    $$(".faq-cat-btn").forEach(b => b.classList.toggle("active", b.dataset.cat === cat));
    // Filter FAQ items
    $$("#faq-accordion-group .faq-item").forEach(item => {
      item.style.display = (cat === "all" || item.dataset.faqCat === cat) ? "" : "none";
    });
  } else if (action === "privacy-policy") {
    openModal("Privacy Policy", `<div style="padding:20px;font-size:14px;line-height:1.7;color:var(--text-muted);">
      <p><strong>RentEase Privacy Policy</strong> — Last updated: November 2026</p>
      <p>RentEase collects only the information necessary to operate the platform: your name, email, and account credentials. Passwords are hashed with bcrypt and never stored in plain text.</p>
      <p>Your property, tenant, and financial data is stored locally in an SQLite database on the server. We do not sell, share, or transmit your data to third parties.</p>
      <p>Session cookies are used for authentication only. No tracking cookies or analytics scripts are employed. You may delete your account and all associated data at any time by contacting support.</p>
      <p>This is a demo platform. No real financial transactions are processed.</p>
    </div>`, null, "Close");
  } else if (action === "terms-of-service") {
    openModal("Terms of Service", `<div style="padding:20px;font-size:14px;line-height:1.7;color:var(--text-muted);">
      <p><strong>RentEase Terms of Service</strong> — Last updated: November 2026</p>
      <p>By using RentEase, you agree to use the platform for lawful property management purposes only. Unauthorized access, data scraping, or abuse of the API is prohibited.</p>
      <p>RentEase is provided "as is" for demonstration purposes. We make no warranties regarding uptime, data durability, or fitness for production use.</p>
      <p>Users are responsible for the accuracy of property listings, tenant records, and financial data they enter. RentEase is not liable for decisions made based on platform data.</p>
      <p>We reserve the right to suspend accounts that violate these terms or compromise platform security.</p>
    </div>`, null, "Close");
  }
});

// Chat submit handler
document.addEventListener("submit", async (event) => {
  if (event.target.id === "chat-form") {
    event.preventDefault();
    const input = $("#chat-input");
    const msg = input.value.trim();
    if (!msg || !activeChatPartnerId) return;
    input.value = "";
    try {
      const sent = await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({ recipientId: activeChatPartnerId, message: msg })
      });
      // Append and scroll
      const scroll = $("#chat-messages-scroll");
      if (scroll) {
        scroll.insertAdjacentHTML("beforeend", `
          <div class="chat-bubble chat-bubble-sent">
            <div>${escapeHtml(sent.message)}</div>
            <span class="chat-bubble-meta">Just now</span>
          </div>
        `);
        scroll.scrollTop = scroll.scrollHeight;
      }
    } catch (e) {
      showToast(e.message, true);
    }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-search='properties']")) {
    searchQuery = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const input = $("[data-search='properties']");
    if (input) {
      input.focus();
      input.setSelectionRange(cursor, cursor);
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-action='filter-type']")) {
    typeFilter = event.target.value;
    render();
  } else if (event.target.matches("[data-action='filter-status']")) {
    statusFilter = event.target.value;
    render();
  } else if (event.target.matches("[data-action='sort-properties']")) {
    sortBy = event.target.value;
    render();
  }
});

$("#mobile-menu")?.addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#sidebar-close")?.addEventListener("click", () => $("#sidebar").classList.remove("open"));

$("#logout-button")?.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    if (socket) socket.disconnect();
    currentUser = null;
    data = { properties: [], tenants: [], payments: [], requests: [], users: [], activity: [], expenses: [], announcements: [], leases: [], messages: [], stats: {} };
    $("#modal-root").innerHTML = "";
    showAuth();
  } catch (error) {
    showToast(error.message, true);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("#modal-root").innerHTML = "";
});

async function bootstrap() {
  initTheme();
  try {
    const { user } = await api("/api/auth/session");
    if (user) {
      currentUser = user;
      await enterWorkspace();
    } else {
      showAuth();
    }
  } catch (error) {
    showAuth();
    showToast(`Connecting to RentEase: ${error.message}`, true);
  }
}

bootstrap();
