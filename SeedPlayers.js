/**
 * ============================================================
 *  🏏  CricIn App — Bulk Player Seeder
 * ============================================================
 *
 *  MATCHES YOUR EXACT SETUP:
 *    Base URL  : http://192.168.1.127:5000/api
 *    Send OTP  : POST /auth/send-otp       { phone }
 *    Verify OTP: POST /auth/verify-otp     { phone, otp }
 *    Token path: response.data.data.token
 *    Create    : POST /players             { playerName, playerType, ... }
 *    Get       : GET  /players/me
 *
 *  HOW TO RUN:
 *    1. Make sure your backend is running
 *    2. Make sure your PC and backend are on same network
 *    3. node seedPlayers.js
 *
 * ============================================================
 */

// ─── CONFIG ─────────────────────────────────────────────────
const CONFIG = {
  BASE_URL:     "http://192.168.1.127:5000/api",  // ← your exact base URL
  TOTAL_USERS:  100,                               // ← 100 players
  PHONE_START:  9100000001,                        // ← +91 9100000001 ... +91 9100000100
  FIXED_OTP:    "123456",                          // ← your fixed 6-digit OTP
  DELAY_MS:     400,                               // ← pause between users (ms)
  STOP_ON_ERROR: false,                            // ← skip failed, keep going
};

// ─── FAKE DATA POOLS ────────────────────────────────────────
const PLAYER_TYPES   = ["Batsman", "Bowler", "All-Rounder", "Wicket Keeper"];
const GENDERS        = ["Male", "Female", "Other"];
const BATTING_STYLES = ["Right-Hand Bat", "Left-Hand Bat"];
const BOWLING_STYLES = ["Right-Arm Fast", "Left-Arm Fast", "Right-Arm Medium",
                        "Right-Arm Spin", "Left-Arm Spin", "Leg Spin", ""];
const CITIES  = ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad",
                 "Kolkata", "Pune", "Jaipur", "Lucknow", "Ahmedabad",
                 "Nagpur", "Indore", "Chandigarh", "Surat", "Vadodara"];
const STATES  = ["Maharashtra", "Delhi", "Karnataka", "Tamil Nadu", "Telangana",
                 "West Bengal", "Rajasthan", "Uttar Pradesh", "Gujarat", "Punjab"];
const CRICKETERS = ["Virat Kohli", "Rohit Sharma", "MS Dhoni", "Sachin Tendulkar",
                    "Jasprit Bumrah", "Ravindra Jadeja", "KL Rahul", "Hardik Pandya",
                    "Shubman Gill", "Rishabh Pant", "Suryakumar Yadav"];
const TEAMS   = ["Mumbai Indians", "Chennai Super Kings", "Royal Challengers Bengaluru",
                 "Kolkata Knight Riders", "Sunrisers Hyderabad", "Delhi Capitals",
                 "Punjab Kings", "Rajasthan Royals", "Lucknow Super Giants", "Gujarat Titans"];
const SHOTS   = ["Cover Drive", "Pull Shot", "Sweep", "Cut Shot", "Flick", "Hook Shot", "Straight Drive"];
const BALLS   = ["Swing", "Yorker", "Bouncer", "Googly", "Doosra", "Off-spin", "Leg-spin"];

const FIRST_NAMES = [
  "Aarav","Arjun","Rohit","Virat","Rahul","Suresh","Deepak","Manish","Kiran","Amit",
  "Sumit","Nikhil","Rajan","Tarun","Yash","Dev","Hardik","Shreyas","Rishabh","Ishan",
  "Priya","Sneha","Anita","Pooja","Neha","Kavya","Ritu","Sonal","Divya","Meera",
  "Shubham","Gaurav","Vikram","Aditya","Rohan","Kunal","Sanjay","Rajesh","Vijay","Manoj",
];
const LAST_NAMES = [
  "Sharma","Verma","Singh","Patel","Kumar","Gupta","Joshi","Mehta","Shah","Yadav",
  "Tiwari","Pandey","Chauhan","Malhotra","Nair","Iyer","Reddy","Bose","Das","Kapoor",
  "Gill","Pant","Kishan","Rao","Mishra","Srivastava","Agarwal","Saxena","Tripathi","Dubey",
];

// ─── HELPERS ────────────────────────────────────────────────
const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rInt  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function randomDOB() {
  const y = rInt(1988, 2004);
  const m = String(rInt(1, 12)).padStart(2, "0");
  const d = String(rInt(1, 28)).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildPlayerProfile() {
  const cityIdx    = rInt(0, CITIES.length - 1);
  const playerType = pick(PLAYER_TYPES);
  const firstName  = pick(FIRST_NAMES);
  const lastName   = pick(LAST_NAMES);

  return {
    playerName:        `${firstName} ${lastName}`,
    bio:               `Passionate ${playerType.toLowerCase()} from ${CITIES[cityIdx]}. Love playing cricket!`,
    dob:               randomDOB(),
    gender:            pick(GENDERS),
    city:              CITIES[cityIdx],
    state:             STATES[cityIdx % STATES.length],
    country:           "India",
    playerType,
    battingStyle:      pick(BATTING_STYLES),
    bowlingStyle:      pick(BOWLING_STYLES),
    jerseyNumber:      rInt(1, 99),
    favoriteCricketer: pick(CRICKETERS),
    favoriteTeam:      pick(TEAMS),
    favoriteShot:      pick(SHOTS),
    favoriteBall:      pick(BALLS),
    achievements:      [
      `Best Batsman ${2020 + rInt(0,4)}`,
      `Player of the Match (${rInt(1,5)}x)`,
    ],
  };
}

// ─── API CALLS — Matching your exact endpoints ───────────────

async function sendOtp(phone) {
  const res  = await fetch(`${CONFIG.BASE_URL}/auth/send-otp`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ phone }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`sendOtp → ${JSON.stringify(data)}`);
  return data;
}

async function verifyOtp(phone, otp) {
  const res  = await fetch(`${CONFIG.BASE_URL}/auth/verify-otp`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ phone, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`verifyOtp → ${JSON.stringify(data)}`);

  // ✅ Matches your authSlice: response.data.data.token
  const token = data?.data?.token;
  if (!token) throw new Error(`No token in response: ${JSON.stringify(data)}`);
  return token;
}

async function createPlayerProfile(token, profile) {
  const res  = await fetch(`${CONFIG.BASE_URL}/players`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(profile),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`createProfile → ${JSON.stringify(data)}`);
  return data;
}

async function getPlayerProfile(token) {
  const res  = await fetch(`${CONFIG.BASE_URL}/players/me`, {
    method:  "GET",
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`getProfile → ${JSON.stringify(data)}`);
  return data;
}

// ─── MAIN ───────────────────────────────────────────────────
async function seed() {
  console.log("=".repeat(62));
  console.log("🏏  CricIn Bulk Player Seeder");
  console.log(`📱  Creating ${CONFIG.TOTAL_USERS} players on ${CONFIG.BASE_URL}`);
  console.log("=".repeat(62));

  const success = [];
  const failed  = [];

  for (let i = 0; i < CONFIG.TOTAL_USERS; i++) {
    const phone = String(CONFIG.PHONE_START + i);  // e.g. 9100000001
    const label = `[${String(i + 1).padStart(3, "0")}/${CONFIG.TOTAL_USERS}]`;

    try {
      // ── Step 1: Send OTP ──────────────────────────────────
      process.stdout.write(`${label} ${phone}  →  Sending OTP ...`);
      await sendOtp(phone);

      // ── Step 2: Verify OTP → Get Token ───────────────────
      process.stdout.write(" Verifying ...");
      const token = await verifyOtp(phone, CONFIG.FIXED_OTP);

      // ── Step 3: Create Player Profile ────────────────────
      process.stdout.write(" Creating profile ...");
      const profile = buildPlayerProfile();
      await createPlayerProfile(token, profile);

      // ── Step 4: Get Profile (verify it saved) ────────────
      process.stdout.write(" Fetching ...");
      await getPlayerProfile(token);

      console.log(` ✅  ${profile.playerName} | ${profile.playerType} | ${profile.city}`);
      success.push({ phone, name: profile.playerName, type: profile.playerType });

    } catch (err) {
      console.log(` ❌  ERROR: ${err.message}`);
      failed.push({ phone, error: err.message });
      if (CONFIG.STOP_ON_ERROR) {
        console.log("\n🛑  Stopping — STOP_ON_ERROR=true");
        break;
      }
    }

    if (i < CONFIG.TOTAL_USERS - 1) await delay(CONFIG.DELAY_MS);
  }

  // ── Summary ───────────────────────────────────────────────
  console.log("\n" + "=".repeat(62));
  console.log("📊  SEEDING COMPLETE");
  console.log(`    ✅  Success : ${success.length}`);
  console.log(`    ❌  Failed  : ${failed.length}`);

  if (failed.length > 0) {
    console.log("\n  ❌ Failed numbers:");
    failed.forEach(({ phone, error }) =>
      console.log(`     • ${phone}  →  ${error}`)
    );
  }

  if (success.length > 0) {
    console.log("\n  ✅ Created players:");
    success.forEach(({ phone, name, type }) =>
      console.log(`     • ${phone}  →  ${name} (${type})`)
    );
  }

  console.log("=".repeat(62));
}

seed().catch((err) => {
  console.error("❌ Unexpected crash:", err);
  process.exit(1);
});