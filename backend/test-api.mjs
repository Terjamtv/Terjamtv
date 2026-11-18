/**
 * TranslateTV — Automated API Integration Test
 * Tests: Health, QR Pairing, Translation, Subtitle Relay, Admin Subscriptions
 */

const API_BASE = process.env.API_BASE || "http://localhost:8787";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "translatetv-admin-secret-2026";

console.log(`\n🚀 Testing TranslateTV Backend at: ${API_BASE}\n`);

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`⏳ Testing: ${name}... `);
      await fn();
      console.log(`✅ PASSED`);
      passed++;
    } catch (err) {
      console.log(`❌ FAILED`);
      console.error(`   Error: ${err.message}\n`);
      failed++;
    }
  }

  // 1. Health Check
  await test("GET /health", async () => {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error("Status is not 'ok'");
  });

  // 2. TV Pairing Initialization
  let pairingCode = "";
  let deviceId = "";
  await test("POST /api/pair/init (TV requests QR)", async () => {
    const res = await fetch(`${API_BASE}/api/pair/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_type: "webos",
        device_name: "LG OLED C3 Test",
        device_model: "webOS-23"
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.pairing_code || !data.device_id) throw new Error("Missing pairing_code or device_id");
    pairingCode = data.pairing_code;
    deviceId = data.device_id;
  });

  // 3. TV Pairing Status (Before Claiming)
  await test("GET /api/pair/status (Status: Pending)", async () => {
    const res = await fetch(`${API_BASE}/api/pair/status?device_id=${deviceId}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.paired !== false) throw new Error("Device should not be paired yet");
  });

  // 4. Mobile Claims Pairing Code
  await test("POST /api/pair/claim (Mobile scans QR)", async () => {
    const res = await fetch(`${API_BASE}/api/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairing_code: pairingCode
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error("Claim failed");
  });

  // 5. TV Pairing Status (After Claiming)
  await test("GET /api/pair/status (Status: Paired)", async () => {
    const res = await fetch(`${API_BASE}/api/pair/status?device_id=${deviceId}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.paired !== true) throw new Error("Device should now be paired");
  });

  // 6. Translation Engine
  await test("POST /api/translate (EN -> AR)", async () => {
    const res = await fetch(`${API_BASE}/api/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer TEST_TOKEN"
      },
      body: JSON.stringify({
        text: "The universe is vast and full of mysteries.",
        source_lang: "en",
        target_lang: "ar",
        device_id: deviceId
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.translated_text) throw new Error("Missing translated_text in response");
  });

  // 7. Subtitle Relay (Phone pushes subtitle to TV)
  let packetId = "";
  await test("POST /api/relay/subtitle (Push live subtitle)", async () => {
    const res = await fetch(`${API_BASE}/api/relay/subtitle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: deviceId,
        original: "Mission accomplished.",
        translated: "تمت المهمة بنجاح."
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.packet_id) throw new Error("Missing packet_id");
    packetId = data.packet_id;
  });

  // 8. TV receives live subtitle from Relay
  await test("GET /api/relay/latest (TV polls live subtitle)", async () => {
    const res = await fetch(`${API_BASE}/api/relay/latest?device_id=${deviceId}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.has_update || data.packet.translated !== "تمت المهمة بنجاح.") {
      throw new Error("Relay packet content mismatch");
    }
  });

  // 9. Admin List Users
  await test("GET /api/admin/users (Admin Auth Check)", async () => {
    const res = await fetch(`${API_BASE}/api/admin/users`, {
      headers: { "X-Admin-Secret": ADMIN_SECRET }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.users)) throw new Error("Expected users array");
  });

  // 10. Admin Cash Subscription Activation
  await test("POST /api/admin/users/:id/subscription (Upgrade to PRO)", async () => {
    const res = await fetch(`${API_BASE}/api/admin/users/usr-demo-1/subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Secret": ADMIN_SECRET
      },
      body: JSON.stringify({
        tier: "pro",
        duration_months: 6,
        reset_usage: true
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error("Failed to update subscription");
  });

  // 11. Generate Pre-paid Cash Vouchers
  let voucherCode = "";
  await test("POST /api/voucher/generate (Generate Cash Voucher)", async () => {
    const res = await fetch(`${API_BASE}/api/voucher/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Secret": ADMIN_SECRET
      },
      body: JSON.stringify({
        tier: "pro",
        duration_months: 3,
        count: 1,
        batch_name: "موزع الرياض 1"
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.vouchers || data.vouchers.length === 0) throw new Error("No vouchers generated");
    voucherCode = data.vouchers[0].code;
  });

  // 12. Redeem Cash Voucher
  await test("POST /api/voucher/redeem (User redeems scratch card)", async () => {
    const res = await fetch(`${API_BASE}/api/voucher/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: voucherCode,
        user_id: "usr-demo-2"
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error("Voucher redeem failed");
  });

  console.log(`\n================================`);
  console.log(`🏁 Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log(`================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
