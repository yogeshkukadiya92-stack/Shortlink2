const assert = require("node:assert/strict");
const test = require("node:test");
const { assertSafeOutboundUrl, isPrivateIp } = require("../security/networkPolicy");
const { decryptCredential, encryptCredential } = require("../security/secrets");
const { prisma } = require("../lib/prisma");
const { upsertDomain } = require("../repositories/domainsRepository");
const { savePage } = require("../repositories/pagesRepository");

test("private and metadata IP ranges are rejected", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "::1", "fd00::1"]) {
    assert.equal(isPrivateIp(address), true, address);
    const host = address.includes(":") ? `[${address}]` : address;
    await assert.rejects(assertSafeOutboundUrl(`http://${host}/`));
  }
});

test("public literal IP and HTTPS destinations are accepted", async () => {
  assert.equal(isPrivateIp("8.8.8.8"), false);
  const parsed = await assertSafeOutboundUrl("https://8.8.8.8/webhook");
  assert.equal(parsed.protocol, "https:");
});

test("provider credentials round-trip through authenticated encryption", () => {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "test-only-key-with-enough-entropy-for-a-stable-fixture";
  try {
    const encrypted = encryptCredential("secret-value");
    assert.equal(Object.prototype.hasOwnProperty.call(encrypted, "plaintext"), false);
    assert.equal(decryptCredential(encrypted), "secret-value");
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});

test("credential writes fail closed without an encryption key", () => {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  try {
    assert.throws(() => encryptCredential("secret"), /CREDENTIAL_ENCRYPTION_KEY/);
  } finally {
    if (previous !== undefined) process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});

test("domain upsert refuses to transfer a host between tenants", async () => {
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = async (callback) => callback({
    customDomain: {
      findUnique: async () => ({ id: "domain-1", userId: "owner-1", host: "links.example.com" }),
    },
  });
  try {
    await assert.rejects(upsertDomain("attacker-2", "links.example.com", {}), (error) => error.code === "DOMAIN_OWNERSHIP_CONFLICT");
  } finally {
    prisma.$transaction = originalTransaction;
  }
});

test("form update refuses an ID not owned by the tenant", async () => {
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = async (callback) => callback({ page: { findFirst: async () => null } });
  try {
    await assert.rejects(savePage("tenant-1", "foreign-page", {
      title: "Form", slug: "form", headline: "Form", description: "", submitLabel: "Submit", thanksMessage: "Thanks",
    }, []), (error) => error.code === "PAGE_NOT_OWNED");
  } finally {
    prisma.$transaction = originalTransaction;
  }
});
