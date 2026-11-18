const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { test } = require("node:test");

const root = path.join(__dirname, "..");

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, "127.0.0.1", resolve).on("error", reject));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = "";
  }

  async request(route, { method = "GET", body } = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookies = response.headers.getSetCookie?.() || [];
    if (setCookies.length) this.cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
}

test("authenticated rental workflows are role-scoped and persisted", async (t) => {
  const port = await unusedPort();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rentease-test-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const processHandle = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      RENTEASE_DATA_DIR: directory,
      SESSION_SECRET: "automated-test-session-secret-with-more-than-32-characters",
      ADMIN_NAME: "Integration Admin",
      ADMIN_EMAIL: "admin@example.test",
      ADMIN_PASSWORD: "Integration-test-admin-password-2026"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  processHandle.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  processHandle.stderr.on("data", (chunk) => { logs += chunk.toString(); });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (processHandle.exitCode !== null) throw new Error(`RentEase server exited early:\n${logs}`);
      try {
        await fetch(`${baseUrl}/api/auth/session`);
        ready = true;
        break;
      } catch {
        await delay(50);
      }
    }
    assert.equal(ready, true, `RentEase server did not start:\n${logs}`);

    const anonymous = new Client(baseUrl);
    assert.equal((await anonymous.request("/api/data")).status, 401);
    assert.equal((await anonymous.request("/api/auth/signup", {
      method: "POST",
      body: { name: "Bad Admin", email: "bad-admin@example.test", password: "A-long-test-password-2026", role: "admin" }
    })).status, 400, "Public sign-up must not grant admin access.");

    const admin = new Client(baseUrl);
    const adminLogin = await admin.request("/api/auth/login", {
      method: "POST",
      body: { email: "admin@example.test", password: "Integration-test-admin-password-2026" }
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.user.role, "admin");

    const landlord = new Client(baseUrl);
    const landlordSignup = await landlord.request("/api/auth/signup", {
      method: "POST",
      body: { name: "Test Landlord", email: "landlord@example.test", password: "Landlord-test-password-2026", role: "landlord" }
    });
    assert.equal(landlordSignup.status, 201);

    const createdProperty = await landlord.request("/api/properties", {
      method: "POST",
      body: { name: "Test Rental", address: "1 Test Street", type: "House", bedrooms: 2, bathrooms: 1, rent: 1500 }
    });
    assert.equal(createdProperty.status, 201);
    assert.equal((await landlord.request("/api/tenants/assign", {
      method: "POST",
      body: { email: "not-registered@example.test", propertyId: createdProperty.body.id, leaseEnd: "2027-12-31" }
    })).status, 404);
    const tenant = new Client(baseUrl);
    const tenantSignup = await tenant.request("/api/auth/signup", {
      method: "POST",
      body: { name: "Test Tenant", email: "tenant@example.test", password: "Tenant-test-password-2026", role: "tenant" }
    });
    assert.equal(tenantSignup.status, 201);
    assert.equal((await tenant.request("/api/properties", { method: "POST", body: {} })).status, 403);
    assert.equal((await tenant.request("/api/data")).body.properties.length, 0);

    assert.equal((await landlord.request("/api/tenants/assign", {
      method: "POST",
      body: { email: "tenant@example.test", propertyId: createdProperty.body.id, leaseEnd: "2027-02-31" }
    })).status, 400, "Invalid calendar dates must be rejected.");
    assert.equal((await landlord.request("/api/tenants/assign", {
      method: "POST",
      body: { email: "tenant@example.test", propertyId: createdProperty.body.id, leaseEnd: "2027-12-31" }
    })).status, 200);
    assert.equal((await landlord.request("/api/tenants/assign", {
      method: "POST",
      body: { email: "tenant@example.test", propertyId: createdProperty.body.id, leaseEnd: "2027-12-31" }
    })).status, 409);
    assert.equal((await tenant.request("/api/data")).body.properties[0].name, "Test Rental");

    const request = await tenant.request("/api/maintenance", {
      method: "POST",
      body: { title: "Leaking tap", description: "Tap is dripping under the sink.", category: "Plumbing", priority: "High" }
    });
    assert.equal(request.status, 201);
    assert.equal((await landlord.request("/api/data")).body.requests[0].status, "Open");
    assert.equal((await landlord.request(`/api/maintenance/${request.body.id}/status`, { method: "PATCH", body: {} })).body.status, "In progress");
    assert.equal((await tenant.request("/api/data")).body.requests[0].status, "In progress");

    assert.equal((await tenant.request("/api/payments/pay", {
      method: "POST",
      body: { method: "Card (demo)" }
    })).status, 201);
    assert.equal((await landlord.request("/api/data")).body.payments[0].status, "Paid");

    const otherLandlord = new Client(baseUrl);
    assert.equal((await otherLandlord.request("/api/auth/signup", {
      method: "POST",
      body: { name: "Other Landlord", email: `other-${crypto.randomUUID()}@example.test`, password: "Other-landlord-password-2026", role: "landlord" }
    })).status, 201);
    assert.equal((await otherLandlord.request("/api/data")).body.properties.length, 0);
    const adminData = await admin.request("/api/data");
    assert.equal(adminData.body.users.length, 4);
    assert.equal((await admin.request(`/api/admin/users/${adminLogin.body.user.id}/active`, {
      method: "PATCH",
      body: { active: false }
    })).status, 400, "An admin must not deactivate their own account.");
    assert.equal((await admin.request(`/api/admin/users/${tenantSignup.body.user.id}/active`, {
      method: "PATCH",
      body: { active: false }
    })).status, 200);
    assert.equal((await tenant.request("/api/data")).status, 401, "Deactivation must revoke existing sessions.");
    assert.equal((await admin.request(`/api/admin/users/${tenantSignup.body.user.id}/active`, {
      method: "PATCH",
      body: { active: true }
    })).status, 200);
    assert.equal((await tenant.request("/api/auth/login", {
      method: "POST",
      body: { email: "tenant@example.test", password: "Tenant-test-password-2026" }
    })).status, 200);

    // Verify enhanced database metrics & activity logs
    const dbStats = await admin.request("/api/admin/db-stats");
    assert.equal(dbStats.status, 200);
    assert.equal(dbStats.body.journalMode.toLowerCase(), "wal");
    assert.ok(dbStats.body.tableCounts.properties >= 1);
    assert.ok(dbStats.body.tableCounts.payments >= 1);
    assert.ok(dbStats.body.tableCounts.activity_logs >= 1);
    assert.ok(dbStats.body.indices.length >= 8);

    const refreshedLandlord = await landlord.request("/api/data");
    assert.ok(refreshedLandlord.body.activity.length >= 1);
    assert.ok(refreshedLandlord.body.stats.totalProperties >= 1);

    const seedRes = await landlord.request("/api/demo/seed", { method: "POST", body: {} });
    assert.equal(seedRes.status, 201);
    assert.equal(seedRes.body.count, 3);
  } finally {
    if (processHandle.exitCode === null) {
      processHandle.kill();
      await Promise.race([
        new Promise((resolve) => processHandle.once("exit", resolve)),
        delay(3000)
      ]);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
