/**
 * ConnectSphere — demo seed data
 *
 * Run with:  npx prisma db seed
 *
 * Safe to re-run: it clears every table first, in reverse dependency order.
 * Dates are fixed: every one is SEED_ANCHOR + n days (see below), so a reseed
 * on any day, from any machine, writes the same dates the test cases expect.
 *
 * Replace PLACEHOLDER_HASH before any real demo — see the note at the bottom.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Every seeded account uses this password.
const DEMO_PASSWORD = "password123";

/// Every date below is built as `day(n)` = this anchor + n days. It used to be
/// today + n, so the whole data set slid with whoever reseeded last and the
/// dates in docs/test-cases/ went stale on the shared database. It is now a
/// fixed date, and every test case is written against it — do not change it
/// without re-basing every date in docs/test-cases/ by the same number of days.
///
/// Override it only for a one-off local run:
///
///   SEED_ANCHOR=2026-12-01 npx prisma db seed
const SEED_ANCHOR = process.env.SEED_ANCHOR ?? "2026-09-26";
const anchorMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(SEED_ANCHOR);
if (!anchorMatch) {
  throw new Error(`SEED_ANCHOR must be YYYY-MM-DD, got "${SEED_ANCHOR}"`);
}
const [anchorYear, anchorMonth, anchorDay] = anchorMatch.slice(1).map(Number);
console.log(`Seeding relative to ${SEED_ANCHOR}${process.env.SEED_ANCHOR ? " (SEED_ANCHOR override)" : ""}`);

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

/**
 * n days from the anchor, at the given Singapore wall-clock time. Built in
 * UTC so the result doesn't depend on the time zone of whoever runs the seed.
 */
function day(n: number, hour = 9, minute = 0): Date {
  return new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay + n, hour - SGT_OFFSET_HOURS, minute));
}

/** Whole days from SEED_ANCHOR to a fixed calendar date ("2026-11-15"), so
 *  `day(daysUntil(date))` lands on that date whatever the anchor is. Lets a
 *  scenario be written as the date its test case quotes
 *  (docs/test-cases/SPM-48_Test_Cases.xlsx). Negative before the anchor. */
function daysUntil(isoDate: string): number {
  const [year, month, date] = isoDate.split("-").map(Number);
  const target = Date.UTC(year, month - 1, date);
  const anchor = Date.UTC(anchorYear, anchorMonth - 1, anchorDay);
  return Math.round((target - anchor) / 86_400_000);
}

async function main() {
  console.log("Clearing existing data…");
  // Reverse dependency order so foreign keys never block a delete.
  await prisma.notification.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.equipmentRequest.deleteMany();
  await prisma.venueUnavailability.deleteMany();
  await prisma.venueBooking.deleteMany();
  await prisma.eventChangeRequest.deleteMany();
  await prisma.clarificationRequest.deleteMany();
  await prisma.eventStatusHistory.deleteMany();
  await prisma.eventFacilityRequirement.deleteMany();
  await prisma.event.deleteMany();
  // deleteMany() never resets sequence_number's underlying Postgres sequence,
  // so without this, re-running the seed repeatedly would push every event's
  // EVT-###### reference higher each time instead of restarting at EVT-000001.
  await prisma.$executeRawUnsafe(
    `ALTER SEQUENCE "events_sequence_number_seq" RESTART WITH 1`,
  );
  await prisma.venueFacility.deleteMany();
  await prisma.venueLayout.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.facility.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // -------------------------------------------------------------------
  // ORGANISATIONS
  // -------------------------------------------------------------------
  console.log("Creating organisations…");
  const orgData = [
    ["Meridian Financial Group", "events@meridianfg.com", "+65 6555 0101"],
    ["Nusantara Tech Labs", "admin@nusantaratech.id", "+62 21 555 0102"],
    ["Straits Medical Institute", "conf@straitsmed.sg", "+65 6555 0103"],
    ["Kirana Retail Holdings", "events@kiranaretail.my", "+60 3 555 0104"],
    ["Anchorpoint Logistics", "ops@anchorpoint.sg", "+65 6555 0105"],
    ["Bayu Energy Partners", "corporate@bayuenergy.my", "+60 3 555 0106"],
    ["Sundara Hospitality Group", "events@sundarahotels.id", "+62 21 555 0107"],
    ["Pearl Delta Manufacturing", "admin@pearldelta.sg", "+65 6555 0108"],
    ["Civic Education Trust", "programmes@civictrust.sg", "+65 6555 0109"],
    ["Tanjong Legal Chambers", "events@tanjonglegal.sg", "+65 6555 0110"],
    ["Selaras Agritech", "info@selarasagri.my", "+60 3 555 0111"],
    ["Harbourline Insurance", "events@harbourline.sg", "+65 6555 0112"],
  ];
  const orgs: Record<string, string> = {};
  for (const [name, contactEmail, contactPhone] of orgData) {
    const o = await prisma.organisation.create({
      data: { name, contactEmail, contactPhone },
    });
    orgs[name] = o.id;
  }

  // -------------------------------------------------------------------
  // USERS
  // -------------------------------------------------------------------
  console.log("Creating users…");
  const users: Record<string, string> = {}; // email -> id

  // Internal ConnectSphere staff — no organisation.
  const staff: [string, string, string, string][] = [
    ["Grace Lim", "grace.lim", "ops_manager", "Operations"],
    ["Nadia Rahman", "nadia.rahman", "ops_manager", "Operations"],
    ["Daniel Tan", "daniel.tan", "coordinator", "Event Management"],
    ["Priya Raj", "priya.raj", "coordinator", "Event Management"],
    ["Joel Fernandez", "joel.fernandez", "coordinator", "Event Management"],
    ["Hui Shan Neo", "huishan.neo", "coordinator", "Event Management"],
    ["Arif Mansor", "arif.mansor", "coordinator", "Event Management"],
    ["Marcus Wong", "marcus.wong", "venue_staff", "Venue Operations"],
    ["Siti Hassan", "siti.hassan", "venue_staff", "Venue Operations"],
    ["Roy Chandra", "roy.chandra", "venue_staff", "Venue Operations"],
    ["Lena Goh", "lena.goh", "venue_staff", "Venue Operations"],
    ["Kenji Sato", "kenji.sato", "tech_support", "Technical Services"],
    ["Aisha Omar", "aisha.omar", "tech_support", "Technical Services"],
    ["Vikram Nair", "vikram.nair", "tech_support", "Technical Services"],
    ["Chloe Teo", "chloe.teo", "tech_support", "Technical Services"],
  ];
  for (const [fullName, handle, role, department] of staff) {
    const email = `${handle}@connectsphere.com`;
    const u = await prisma.user.create({
      data: { email, passwordHash, fullName, role, department },
    });
    users[email] = u.id;
  }

  // Event Organisers — each belongs to a client organisation.
  const organisers: [string, string, string][] = [
    ["Rachel Ng", "rachel.ng", "Meridian Financial Group"],
    ["James Koh", "james.koh", "Meridian Financial Group"],
    ["Budi Santoso", "budi.santoso", "Nusantara Tech Labs"],
    ["Sari Widodo", "sari.widodo", "Nusantara Tech Labs"],
    ["Evelyn Chen", "evelyn.chen", "Straits Medical Institute"],
    ["Raj Kumar", "raj.kumar", "Straits Medical Institute"],
    ["Faridah Aziz", "faridah.aziz", "Kirana Retail Holdings"],
    ["Melissa Yap", "melissa.yap", "Anchorpoint Logistics"],
    ["Hakim Zulkifli", "hakim.zulkifli", "Bayu Energy Partners"],
    ["Dewi Kartika", "dewi.kartika", "Sundara Hospitality Group"],
    ["Samuel Ong", "samuel.ong", "Pearl Delta Manufacturing"],
    ["Grace Abdullah", "grace.abdullah", "Civic Education Trust"],
    ["Aaron Sim", "aaron.sim", "Tanjong Legal Chambers"],
    ["Nurul Izzah", "nurul.izzah", "Selaras Agritech"],
    ["Preeti Sharma", "preeti.sharma", "Harbourline Insurance"],
    ["Kelvin Loh", "kelvin.loh", "Harbourline Insurance"],
  ];
  for (const [fullName, handle, orgName] of organisers) {
    const email = `${handle}@${orgName.toLowerCase().replace(/[^a-z]/g, "").slice(0, 12)}.com`;
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: "organiser",
        organisationId: orgs[orgName],
      },
    });
    users[email] = u.id;
    users[`organiser:${fullName}`] = u.id; // convenient alias
  }

  // Attendees.
  const attendeeNames = [
    "Lee Wei Ming", "Anita Devi", "Tom Harris", "Chua Mei Ling", "Farhan Ismail",
    "Jocelyn Pang", "Ravi Subramaniam", "Tan Jia Hui", "Marcus Yeo", "Siti Nurhaliza",
    "Bryan Chua", "Kavitha Menon", "Daniel Lim", "Amirah Rashid", "Wong Kai Xin",
    "Joseph Tan", "Indira Putri", "Ryan Choo", "Nadhirah Salleh", "Cheryl Ang",
    "Hafiz Rahman", "Michelle Foo", "Arjun Pillai", "Serene Lau", "Zahra Ibrahim",
    "Kelvin Toh", "Priscilla Ng", "Danish Iqbal", "Yvonne Seah", "Gopal Krishnan",
    "Charmaine Low", "Adib Hamzah", "Rebecca Tay", "Sunil Menon", "Jasmine Koh",
    "Eugene Sim", "Farah Nabila", "Terence Goh", "Divya Raman", "Natalie Chong",
  ];
  const attendeeIds: string[] = [];
  const orgNames = Object.keys(orgs);
  for (let i = 0; i < attendeeNames.length; i++) {
    const fullName = attendeeNames[i];
    const email = `${fullName.toLowerCase().replace(/[^a-z]/g, ".")}@example.com`;
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: "attendee",
        organisationId: orgs[orgNames[i % orgNames.length]],
      },
    });
    attendeeIds.push(u.id);
  }

  // -------------------------------------------------------------------
  // FACILITIES
  // -------------------------------------------------------------------
  console.log("Creating facilities…");
  const facilityData: [string, string][] = [
    ["High-density WiFi", "facility"],
    ["Fixed ceiling projector", "facility"],
    ["Built-in PA system", "facility"],
    ["Raised stage", "facility"],
    ["Video conferencing suite", "facility"],
    ["Livestream capability", "facility"],
    ["Adjacent breakout rooms", "facility"],
    ["Catering pantry", "facility"],
    ["Natural light", "facility"],
    ["Blackout blinds", "facility"],
    ["Loading bay access", "facility"],
    ["Green room", "facility"],
    ["Step-free access", "accessibility"],
    ["Wheelchair spaces", "accessibility"],
    ["Hearing induction loop", "accessibility"],
    ["Accessible toilet", "accessibility"],
    ["Braille signage", "accessibility"],
    ["Assistance animal friendly", "accessibility"],
  ];
  const fac: Record<string, string> = {};
  for (const [name, category] of facilityData) {
    const f = await prisma.facility.create({ data: { name, category } });
    fac[name] = f.id;
  }

  // -------------------------------------------------------------------
  // VENUES
  // -------------------------------------------------------------------
  console.log("Creating venues…");
  const ADDR: Record<string, string> = {
    "Marina Centre": "12 Marina Boulevard, Singapore 018982",
    "Orchard Hub": "88 Orchard Road, Singapore 238841",
    "Jurong Gateway": "5 Jurong Gateway Road, Singapore 608621",
    "Changi Business Park": "31 Changi Business Park Ave 2, Singapore 486066",
    "One-North": "3 Fusionopolis Way, Singapore 138633",
  };

  type VenueSeed = {
    code: string; name: string; description: string; building: string;
    floor: string; maxCapacity: number; opensAt: string; closesAt: string;
    setupMinutes: number; teardownMinutes: number;
    layouts: [string, number][]; facilities: string[];
  };

  const venueData: VenueSeed[] = [
    { code: "MAR-GH", name: "Marina Grand Hall", description: "Flagship pillarless hall with a full AV rig and green room",
      building: "Marina Centre", floor: "L1", maxCapacity: 500, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 180, teardownMinutes: 120,
      layouts: [["theatre", 500], ["classroom", 250], ["banquet", 320], ["exhibition", 400], ["cabaret", 300]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Built-in PA system", "Raised stage",
        "Video conferencing suite", "Livestream capability", "Catering pantry", "Blackout blinds",
        "Loading bay access", "Green room", "Step-free access", "Wheelchair spaces",
        "Hearing induction loop", "Accessible toilet", "Assistance animal friendly"] },
    { code: "MAR-AUD", name: "Marina Auditorium", description: "Tiered auditorium with fixed theatre seating",
      building: "Marina Centre", floor: "L2", maxCapacity: 220, opensAt: "08:00", closesAt: "22:00",
      setupMinutes: 60, teardownMinutes: 30,
      layouts: [["theatre", 220]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Built-in PA system", "Raised stage",
        "Video conferencing suite", "Livestream capability", "Blackout blinds", "Green room",
        "Step-free access", "Wheelchair spaces", "Hearing induction loop", "Accessible toilet", "Braille signage"] },
    { code: "MAR-BR1", name: "Marina Boardroom 1", description: "Executive boardroom with hybrid conferencing",
      building: "Marina Centre", floor: "L5", maxCapacity: 24, opensAt: "08:00", closesAt: "20:00",
      setupMinutes: 30, teardownMinutes: 15,
      layouts: [["boardroom", 24], ["u_shape", 18]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Video conferencing suite",
        "Natural light", "Step-free access", "Accessible toilet"] },
    { code: "MAR-BR2", name: "Marina Boardroom 2", description: "Smaller executive boardroom, harbour view",
      building: "Marina Centre", floor: "L5", maxCapacity: 16, opensAt: "08:00", closesAt: "20:00",
      setupMinutes: 30, teardownMinutes: 15,
      layouts: [["boardroom", 16], ["u_shape", 12]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Video conferencing suite",
        "Natural light", "Step-free access", "Accessible toilet"] },
    { code: "ORC-SEM", name: "Orchard Seminar Room", description: "Flexible seminar space with movable partitions",
      building: "Orchard Hub", floor: "L3", maxCapacity: 120, opensAt: "08:00", closesAt: "22:00",
      setupMinutes: 60, teardownMinutes: 30,
      layouts: [["theatre", 120], ["classroom", 70], ["u_shape", 45], ["cabaret", 80]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Built-in PA system",
        "Adjacent breakout rooms", "Catering pantry", "Natural light", "Blackout blinds",
        "Step-free access", "Wheelchair spaces", "Accessible toilet"] },
    { code: "ORC-STU", name: "Orchard Studio", description: "Small studio for workshops and hands-on training",
      building: "Orchard Hub", floor: "L3", maxCapacity: 40, opensAt: "08:00", closesAt: "21:00",
      setupMinutes: 30, teardownMinutes: 30,
      layouts: [["classroom", 40], ["boardroom", 20], ["u_shape", 24]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Natural light",
        "Step-free access", "Accessible toilet"] },
    { code: "ORC-GAL", name: "Orchard Gallery", description: "Naturally lit gallery for receptions and showcases",
      building: "Orchard Hub", floor: "L2", maxCapacity: 150, opensAt: "09:00", closesAt: "23:00",
      setupMinutes: 120, teardownMinutes: 90,
      layouts: [["exhibition", 150], ["banquet", 90], ["theatre", 110]],
      facilities: ["High-density WiFi", "Built-in PA system", "Catering pantry", "Natural light",
        "Loading bay access", "Step-free access", "Wheelchair spaces", "Accessible toilet",
        "Assistance animal friendly"] },
    { code: "JUR-EXP", name: "Jurong Expo Floor", description: "Open exhibition floor with direct loading bay access",
      building: "Jurong Gateway", floor: "L1", maxCapacity: 800, opensAt: "06:00", closesAt: "23:00",
      setupMinutes: 240, teardownMinutes: 180,
      layouts: [["exhibition", 800], ["theatre", 600], ["banquet", 450]],
      facilities: ["High-density WiFi", "Built-in PA system", "Raised stage", "Catering pantry",
        "Loading bay access", "Step-free access", "Wheelchair spaces", "Accessible toilet",
        "Assistance animal friendly"] },
    { code: "JUR-TRN", name: "Jurong Training Room", description: "Classroom-style training room with fixed AV",
      building: "Jurong Gateway", floor: "L4", maxCapacity: 60, opensAt: "08:00", closesAt: "21:00",
      setupMinutes: 45, teardownMinutes: 30,
      // CHANGED: classroom reduced 60 -> 40. This is the state that justifies
      // the flagged booking created below: the Harbourline claims training
      // expects 55 in classroom layout and no longer fits.
      layouts: [["classroom", 40], ["u_shape", 36], ["theatre", 70]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Built-in PA system",
        "Natural light", "Blackout blinds", "Step-free access", "Accessible toilet"] },
    { code: "JUR-LAB", name: "Jurong Skills Lab", description: "Workshop room with benches and heavy power supply",
      building: "Jurong Gateway", floor: "L4", maxCapacity: 30, opensAt: "08:00", closesAt: "20:00",
      setupMinutes: 45, teardownMinutes: 45,
      layouts: [["classroom", 30], ["u_shape", 20]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Loading bay access",
        "Step-free access", "Accessible toilet"] },
    { code: "CBP-CONF", name: "Changi Conference Centre", description: "Mid-size conference room with hybrid streaming",
      building: "Changi Business Park", floor: "L1", maxCapacity: 260, opensAt: "07:30", closesAt: "22:30",
      setupMinutes: 120, teardownMinutes: 90,
      layouts: [["theatre", 260], ["classroom", 140], ["cabaret", 160], ["banquet", 180]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Built-in PA system", "Raised stage",
        "Video conferencing suite", "Livestream capability", "Adjacent breakout rooms", "Catering pantry",
        "Blackout blinds", "Step-free access", "Wheelchair spaces", "Hearing induction loop", "Accessible toilet"] },
    { code: "CBP-MTG1", name: "Changi Meeting Room 1", description: "Standard meeting room for planning sessions",
      building: "Changi Business Park", floor: "L3", maxCapacity: 20, opensAt: "08:00", closesAt: "20:00",
      setupMinutes: 20, teardownMinutes: 15,
      layouts: [["boardroom", 20], ["u_shape", 14]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Video conferencing suite",
        "Natural light", "Step-free access", "Accessible toilet"] },
    { code: "CBP-MTG2", name: "Changi Meeting Room 2", description: "Standard meeting room, adjacent to Room 1",
      building: "Changi Business Park", floor: "L3", maxCapacity: 20, opensAt: "08:00", closesAt: "20:00",
      setupMinutes: 20, teardownMinutes: 15,
      layouts: [["boardroom", 20], ["u_shape", 14]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Video conferencing suite",
        "Natural light", "Step-free access", "Accessible toilet"] },
    { code: "ONE-AUD", name: "One-North Auditorium", description: "Research auditorium with recording and captioning",
      building: "One-North", floor: "L1", maxCapacity: 180, opensAt: "08:00", closesAt: "22:00",
      setupMinutes: 90, teardownMinutes: 60,
      layouts: [["theatre", 180], ["classroom", 100]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Built-in PA system", "Raised stage",
        "Video conferencing suite", "Livestream capability", "Blackout blinds", "Green room",
        "Step-free access", "Wheelchair spaces", "Hearing induction loop", "Accessible toilet", "Braille signage"] },
    { code: "ONE-SEM", name: "One-North Seminar Room", description: "Seminar room used for symposia and journal clubs",
      building: "One-North", floor: "L2", maxCapacity: 80, opensAt: "08:00", closesAt: "21:00",
      setupMinutes: 45, teardownMinutes: 30,
      layouts: [["theatre", 80], ["classroom", 48], ["u_shape", 32], ["boardroom", 24]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Built-in PA system",
        "Adjacent breakout rooms", "Natural light", "Blackout blinds", "Step-free access",
        "Hearing induction loop", "Accessible toilet"] },
    { code: "ONE-ROOF", name: "One-North Rooftop Terrace", description: "Open-air terrace for receptions and networking",
      building: "One-North", floor: "L8", maxCapacity: 100, opensAt: "16:00", closesAt: "23:00",
      setupMinutes: 90, teardownMinutes: 60,
      layouts: [["exhibition", 100], ["banquet", 60]],
      facilities: ["High-density WiFi", "Built-in PA system", "Catering pantry", "Natural light",
        "Step-free access", "Wheelchair spaces", "Accessible toilet", "Assistance animal friendly"] },
    // SPM-42 fixture (scripts/seed-spm42.ts): the only venue with no setup or
    // turnaround, for SPM-42-TC07.
    { code: "SPM42-PLN", name: "SPM42 Plain Room", description: "SPM-42 test venue: needs no setup or turnaround",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
  ];

  const venues: Record<string, string> = {};
  for (const v of venueData) {
    const created = await prisma.venue.create({
      data: {
        code: v.code,
        name: v.name,
        description: v.description,
        building: v.building,
        floor: v.floor,
        address: ADDR[v.building],
        maxCapacity: v.maxCapacity,
        opensAt: v.opensAt,
        closesAt: v.closesAt,
        setupMinutes: v.setupMinutes,
        teardownMinutes: v.teardownMinutes,
        layouts: {
          create: v.layouts.map(([layoutName, capacity]) => ({ layoutName, capacity })),
        },
        facilities: {
          create: v.facilities.map((name) => ({ facilityId: fac[name] })),
        },
      },
    });
    venues[v.code] = created.id;
  }

  // -------------------------------------------------------------------
  // EQUIPMENT
  // -------------------------------------------------------------------
  console.log("Creating equipment…");
  const equipmentData: [string, string, string, number, number][] = [
    ["4K Portable Projector", "AV", "5000-lumen portable projector with lens kit", 8, 2],
    ["Ultra-Short-Throw Projector", "AV", "For rooms with no ceiling mount", 3, 0],
    ["Portable Projection Screen", "AV", "2.4m tripod screen", 6, 0],
    ["Handheld Wireless Mic", "AV", "UHF handheld with receiver", 16, 1],
    ["Lavalier Wireless Mic", "AV", "Clip-on presenter microphone", 10, 2],
    ["Gooseneck Table Mic", "AV", "Wired table mic for panels", 12, 0],
    ["Powered Speaker", "AV", "12-inch active speaker on stand", 8, 1],
    ["Audio Mixing Desk", "AV", "16-channel digital mixer", 4, 0],
    ["PTZ Streaming Camera", "AV", "Remote pan-tilt-zoom camera", 6, 1],
    ["Camcorder and Tripod", "AV", "Handheld camcorder with fluid-head tripod", 4, 0],
    ["Streaming Encoder", "AV", "Hardware encoder for livestream uplink", 3, 0],
    ["HDMI Distribution Amplifier", "AV", "1-in 4-out powered HDMI splitter", 5, 0],
    ["Stage Monitor Wedge", "AV", "Floor monitor for presenters", 6, 2],
    ["Presentation Laptop", "IT", "Preloaded presentation laptop", 8, 0],
    ["Presentation Clicker", "IT", "Wireless slide advancer with laser", 10, 0],
    ["Check-in Tablet", "IT", "Tablet running the registration check-in app", 12, 1],
    ["Portable Badge Printer", "IT", "On-site name badge printer", 4, 1],
    ["Portable Network Switch", "Networking", "24-port gigabit switch", 4, 0],
    ["Portable WiFi Access Point", "Networking", "Additional AP for high-density sessions", 8, 0],
    ["4G Backup Router", "Networking", "Failover connectivity for livestreams", 3, 0],
    ["LED Video Wall Panel", "Staging", "2m x 1m modular LED panel", 10, 1],
    ["Powered Lectern", "Staging", "Lectern with mic, light and power", 5, 0],
    ["Stage Riser Section", "Staging", "2m x 1m modular riser", 12, 0],
    ["Truss Lighting Bar", "Staging", "Lighting bar with four LED pars", 6, 1],
    ["Hearing Loop Receiver Kit", "Accessibility", "Portable loop receivers, set of 10", 4, 0],
    ["Wheelchair Access Ramp", "Accessibility", "Portable ramp for staged areas", 3, 0],
  ];
  const equip: Record<string, string> = {};
  for (const [name, category, description, totalQuantity, quantityInMaintenance] of equipmentData) {
    const e = await prisma.equipment.create({
      data: { name, category, description, totalQuantity, quantityInMaintenance },
    });
    equip[name] = e.id;
  }
  // SPM-48: kit with a location other than ConnectSphere storage, and a retired
  // item that an existing request still names.
  const marinaSound = await prisma.equipment.create({
    data: {
      name: "Marina Hall Sound System",
      category: "AV",
      description: "Installed PA and mixer, kept in Marina Grand Hall",
      totalQuantity: 1,
      quantityInMaintenance: 0,
      locationVenueId: venues["MAR-GH"],
    },
  });
  equip["Marina Hall Sound System"] = marinaSound.id;
  const legacyProjector = await prisma.equipment.create({
    data: {
      name: "Legacy Overhead Projector",
      category: "AV",
      description: "Retired - replaced by the portable projectors",
      totalQuantity: 4,
      quantityInMaintenance: 0,
      isActive: false,
    },
  });
  equip["Legacy Overhead Projector"] = legacyProjector.id;

  // SPM-48 test-case equipment. One item per stock level the cases need, kept
  // apart from the real catalogue above so its numbers never disturb it.
  // [name, category, description, total, in maintenance, active]
  const fixtureEquipment: [string, string, string, number, number, boolean][] = [
    ["Cordless Mic Set", "AV", "SPM-48 test item: 5 in stock", 5, 0, true],
    ["Tripod Screen", "AV", "SPM-48 test item: 4 in stock", 4, 0, true],
    ["Smoke Machine", "Staging", "SPM-48 test item: none in stock", 0, 0, true],
    ["PA Speaker", "AV", "SPM-48 test item: 2 in stock", 2, 0, true],
    ["HD Projector", "AV", "SPM-48 test item: 3 in stock", 3, 0, true],
    ["Conference Phone", "IT", "SPM-48 test item: 5 in stock", 5, 0, true],
    ["Presenter Tablet", "IT", "SPM-48 test item: 2 in stock", 2, 0, true],
    ["Lighting Rig", "Staging", "SPM-48 test item: a single unit", 1, 0, true],
    ["Stage Wash Light", "Staging", "SPM-48 test item: 2 in stock", 2, 0, true],
    ["Follow Spot", "Staging", "SPM-48 test item: a single unit, kept in storage", 1, 0, true],
    ["Podium Mic", "AV", "SPM-48 test item: a single unit", 1, 0, true],
    ["Document Camera", "AV", "SPM-48 test item: 5 in stock, 2 in maintenance", 5, 2, true],
    ["Laser Pointer", "AV", "SPM-48 test item: retired", 10, 0, false],
  ];
  for (const [name, category, description, totalQuantity, quantityInMaintenance, isActive] of fixtureEquipment) {
    const e = await prisma.equipment.create({
      data: { name, category, description, totalQuantity, quantityInMaintenance, isActive },
    });
    equip[name] = e.id;
  }

  // SPM-49 test-case equipment (Reserve Equipment). Also kept apart from the
  // real catalogue, and from SPM-48's fixtures above, so reserving one does
  // not change what any other story's test cases see.
  const fixtureEquipment49: [string, string, string, number, number][] = [
    ["Portable Stage", "Staging", "SPM-49 test item: 6 in stock", 6, 0],
    ["Ring Light", "AV", "SPM-49 test item: 2 in stock", 2, 0],
    ["Confidence Monitor", "AV", "SPM-49 test item: 4 in stock", 4, 0],
    ["Podium Light", "Staging", "SPM-49 test item: 4 in stock", 4, 0],
    ["Mobile Charging Cart", "IT", "SPM-49 test item: a single unit", 1, 0],
    ["Backup Laptop", "IT", "SPM-49 test item: 5 in stock, 2 in maintenance", 5, 2],
    ["Wireless Presenter", "AV", "SPM-49 test item: 4 in stock", 4, 0],
  ];
  for (const [name, category, description, totalQuantity, quantityInMaintenance] of fixtureEquipment49) {
    const e = await prisma.equipment.create({
      data: { name, category, description, totalQuantity, quantityInMaintenance },
    });
    equip[name] = e.id;
  }

  // -------------------------------------------------------------------
  // EVENTS
  // -------------------------------------------------------------------
  console.log("Creating events…");
  type EventSeed = {
    key: string; title: string; purpose?: string; description?: string;
    category?: string; organiser: string; coordinator?: string; status: string;
    days: number; startHour?: number; durationHours?: number;
    attendance?: number; layout?: string; regEnabled?: boolean; regCapacity?: number;
    accessibilityNotes?: string; rejectionReason?: string; cancellationReason?: string;
    specialRequirements?: string;
    /// Overrides CHAIN[status] - SPM-27's events carry their own history.
    chain?: string[];
  };

  const eventData: EventSeed[] = [
    { key: "draft", title: "Q1 Investor Update (rough idea)", status: "draft",
      description: "Still checking dates with the exec team.",
      organiser: "Rachel Ng", days: 60 },

    { key: "submitted", title: "Nusantara Developer Summit", status: "submitted",
      purpose: "Annual developer community gathering",
      description: "Full-day technical conference with a keynote and three parallel tracks.",
      category: "conference", organiser: "Budi Santoso", days: 36,
      startHour: 9, durationHours: 9, attendance: 180, layout: "theatre",
      accessibilityNotes: "Two attendees are wheelchair users." },

    { key: "under_review", title: "Kirana Regional Managers Offsite", status: "under_review",
      purpose: "Half-year strategy alignment",
      description: "Asked for a large room but has not confirmed headcount.",
      category: "meeting", organiser: "Faridah Aziz", coordinator: "priya.raj@connectsphere.com",
      days: 57, startHour: 9, durationHours: 8, attendance: 45, layout: "u_shape" },

    { key: "planning", title: "Straits Medical Research Symposium", status: "planning",
      purpose: "Present findings from the 2026 cohort study",
      description: "Hybrid symposium; sessions must be livestreamed to regional partners.",
      category: "seminar", organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
      days: 72, startHour: 9, durationHours: 9, attendance: 200, layout: "theatre",
      accessibilityNotes: "Hearing loop required; one presenter uses a wheelchair." },

    { key: "confirmed_forum", title: "Meridian Wealth Management Forum", status: "confirmed",
      purpose: "Client-facing forum on the 2027 market outlook",
      description: "Half-day forum followed by a networking lunch.",
      category: "conference", organiser: "James Koh", coordinator: "daniel.tan@connectsphere.com",
      days: 85, startHour: 13, durationHours: 5, attendance: 150, layout: "theatre",
      regEnabled: true, regCapacity: 150 },

    { key: "completed_training", title: "Meridian Compliance Training", status: "completed",
      purpose: "Mandatory annual compliance refresher",
      category: "training", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: -26, startHour: 9, durationHours: 4, attendance: 55, layout: "classroom" },

    { key: "rejected", title: "Overnight Hackathon", status: "rejected",
      purpose: "24-hour continuous hackathon",
      category: "workshop", organiser: "Budi Santoso", coordinator: "priya.raj@connectsphere.com",
      days: 17, startHour: 20, durationHours: 24, attendance: 90, layout: "exhibition",
      rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy." },

    { key: "confirmed_briefing", title: "Anchorpoint Supply Chain Briefing", status: "confirmed",
      purpose: "Quarterly partner briefing", description: "Morning briefing with a facilitated Q&A.",
      category: "seminar", organiser: "Melissa Yap", coordinator: "joel.fernandez@connectsphere.com",
      days: 30, startHour: 9, durationHours: 4, attendance: 90, layout: "theatre",
      regEnabled: true, regCapacity: 100 },

    { key: "confirmed_panel", title: "Bayu Energy Transition Panel", status: "confirmed",
      purpose: "Public panel on regional energy policy",
      description: "Evening panel discussion, livestreamed.",
      category: "seminar", organiser: "Hakim Zulkifli", coordinator: "huishan.neo@connectsphere.com",
      days: 44, startHour: 18, durationHours: 3, attendance: 160, layout: "theatre",
      regEnabled: true, regCapacity: 160, accessibilityNotes: "Live captioning requested." },

    { key: "confirmed_workshop", title: "Civic Trust Teachers Workshop", status: "confirmed",
      purpose: "Curriculum development workshop",
      description: "Hands-on workshop in a single studio room.",
      category: "workshop", organiser: "Grace Abdullah", coordinator: "arif.mansor@connectsphere.com",
      days: 51, startHour: 9, durationHours: 7, attendance: 35, layout: "classroom",
      regEnabled: true, regCapacity: 40 },

    { key: "confirmed_showcase", title: "Sundara Hospitality Trade Showcase", status: "confirmed",
      purpose: "Supplier showcase and trade floor",
      description: "Full exhibition floor with 40 supplier booths.",
      category: "exhibition", organiser: "Dewi Kartika", coordinator: "daniel.tan@connectsphere.com",
      days: 65, startHour: 10, durationHours: 8, attendance: 600, layout: "exhibition",
      regEnabled: true, regCapacity: 600 },

    { key: "confirmed_claims", title: "Harbourline Claims Systems Training", status: "confirmed",
      purpose: "Roll-out training for the new claims platform",
      category: "training", organiser: "Preeti Sharma", coordinator: "priya.raj@connectsphere.com",
      days: 23, startHour: 9, durationHours: 8, attendance: 55, layout: "classroom" },

    { key: "confirmed_cpd", title: "Tanjong Legal CPD Seminar", status: "confirmed",
      purpose: "Continuing professional development seminar",
      category: "seminar", organiser: "Aaron Sim", coordinator: "joel.fernandez@connectsphere.com",
      days: 38, startHour: 14, durationHours: 4, attendance: 70, layout: "theatre",
      regEnabled: true, regCapacity: 75 },

    { key: "planning_safety", title: "Pearl Delta Safety Conference", status: "planning",
      purpose: "Annual plant safety conference",
      description: "Requires exhibition space for equipment demonstrations.",
      category: "conference", organiser: "Samuel Ong", coordinator: "huishan.neo@connectsphere.com",
      days: 79, startHour: 9, durationHours: 8, attendance: 240, layout: "theatre" },

    { key: "planning_field", title: "Selaras Agritech Field Day Briefing", status: "planning",
      purpose: "Pre-season briefing for growers",
      category: "meeting", organiser: "Nurul Izzah", coordinator: "arif.mansor@connectsphere.com",
      days: 47, startHour: 9, durationHours: 3, attendance: 40, layout: "u_shape" },

    { key: "submitted_recruit", title: "Meridian Graduate Recruitment Evening", status: "submitted",
      purpose: "Campus recruitment networking evening",
      category: "networking", organiser: "James Koh", days: 54,
      startHour: 18, durationHours: 3, attendance: 120, layout: "exhibition" },

    { key: "review_journal", title: "Straits Medical Journal Club", status: "under_review",
      purpose: "Monthly journal club",
      category: "seminar", organiser: "Raj Kumar", coordinator: "joel.fernandez@connectsphere.com",
      days: 26, startHour: 12, durationHours: 2, attendance: 30, layout: "boardroom" },

    { key: "review_launch", title: "Nusantara Product Launch", status: "under_review",
      purpose: "Regional product launch and press event",
      description: "Press event with livestream and product demonstration area.",
      category: "exhibition", organiser: "Sari Widodo", coordinator: "daniel.tan@connectsphere.com",
      days: 90, startHour: 15, durationHours: 4, attendance: 200, layout: "theatre" },

    { key: "completed_annual", title: "Kirana Retail Annual Conference", status: "completed",
      purpose: "Annual all-hands conference",
      category: "conference", organiser: "Faridah Aziz", coordinator: "daniel.tan@connectsphere.com",
      days: -75, startHour: 9, durationHours: 9, attendance: 350, layout: "theatre",
      regEnabled: true, regCapacity: 350 },

    { key: "completed_induction", title: "Civic Trust Volunteer Induction", status: "completed",
      purpose: "Induction for new programme volunteers",
      category: "training", organiser: "Grace Abdullah", coordinator: "huishan.neo@connectsphere.com",
      days: -47, startHour: 9, durationHours: 4, attendance: 45, layout: "classroom",
      regEnabled: true, regCapacity: 50 },

    { key: "completed_retreat", title: "Anchorpoint Leadership Retreat", status: "completed",
      purpose: "Senior leadership planning retreat",
      category: "meeting", organiser: "Melissa Yap", coordinator: "priya.raj@connectsphere.com",
      days: -19, startHour: 9, durationHours: 8, attendance: 18, layout: "boardroom" },

    { key: "completed_roadshow", title: "Harbourline Broker Roadshow", status: "completed",
      purpose: "Broker engagement roadshow",
      category: "networking", organiser: "Kelvin Loh", coordinator: "arif.mansor@connectsphere.com",
      days: -12, startHour: 14, durationHours: 4, attendance: 85, layout: "banquet",
      regEnabled: true, regCapacity: 90 },

    { key: "cancelled", title: "Pearl Delta Supplier Forum", status: "cancelled",
      purpose: "Supplier engagement forum",
      category: "meeting", organiser: "Samuel Ong", coordinator: "joel.fernandez@connectsphere.com",
      days: 33, startHour: 9, durationHours: 5, attendance: 60, layout: "u_shape",
      cancellationReason: "Client cancelled after a change in the procurement schedule." },

    // -----------------------------------------------------------------
    // SPM-41 QA fixtures — "Find a venue" suitability test cases.
    // One event per test case (see docs/test-cases/SPM-41_test_cases.json);
    // names used to collide across cases with different attendance/layout/
    // facility data, so each case now gets its own event.
    // -----------------------------------------------------------------
    { key: "spm41_training_60", title: "SPM41 Training Day 60", status: "under_review",
      purpose: "Internal training session",
      category: "training", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 60, layout: "classroom" },

    { key: "spm41_training_55", title: "SPM41 Training Day 55", status: "under_review",
      purpose: "Internal training session",
      category: "training", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 55, layout: "classroom" },

    { key: "spm41_training_70", title: "SPM41 Training Day 70", status: "under_review",
      purpose: "Internal training session",
      category: "training", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 70, layout: "classroom" },

    { key: "spm41_training_71", title: "SPM41 Training Day 71", status: "under_review",
      purpose: "Internal training session",
      category: "training", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 71, layout: "classroom" },

    { key: "spm41_training_55_loop", title: "SPM41 Training Day 55 Loop", status: "under_review",
      purpose: "Internal training session",
      category: "training", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 55, layout: "classroom" },

    { key: "spm41_layout_theatre", title: "SPM41 Layout Theatre", status: "under_review",
      purpose: "Layout comparison fixture",
      category: "seminar", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 100, layout: "theatre" },

    { key: "spm41_layout_classroom", title: "SPM41 Layout Classroom", status: "under_review",
      purpose: "Layout comparison fixture",
      category: "seminar", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 100, layout: "classroom" },

    { key: "spm41_hybrid_vc_live", title: "SPM41 Hybrid Forum VC+Live", status: "under_review",
      purpose: "Hybrid forum, livestreamed",
      category: "conference", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 100, layout: "theatre" },

    { key: "spm41_hybrid_vc_only", title: "SPM41 Hybrid Forum VC Only", status: "under_review",
      purpose: "Hybrid forum, video conferencing only",
      category: "conference", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 100, layout: "theatre" },

    { key: "spm41_symposium", title: "SPM41 Symposium", status: "under_review",
      purpose: "Symposium requiring multiple facilities",
      category: "seminar", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 40, layout: "theatre" },

    { key: "spm41_lecture_200", title: "SPM41 Open Lecture 200", status: "under_review",
      purpose: "Public lecture requiring accessibility features",
      category: "seminar", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 200, layout: "theatre" },

    { key: "spm41_lecture_100", title: "SPM41 Open Lecture 100", status: "under_review",
      purpose: "Public lecture requiring accessibility features",
      category: "seminar", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 100, layout: "theatre" },

    { key: "spm41_gala_300", title: "SPM41 Gala Dinner 300", status: "under_review",
      purpose: "Gala dinner",
      category: "networking", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 300, layout: "banquet" },

    { key: "spm41_gala_50", title: "SPM41 Gala Dinner 50", status: "under_review",
      purpose: "Gala dinner",
      category: "networking", organiser: "Rachel Ng", coordinator: "priya.raj@connectsphere.com",
      days: 173, startHour: 9, durationHours: 8, attendance: 50, layout: "banquet" },

    // --- SPM-48 availability scenarios ---------------------------------
    // Three events on neighbouring days that compete for the same kit, so the
    // Equipment request screen has real shortfalls to show:
    //   expo_day (day 49) and awards_night (day 51) each hold equipment, and
    //   vendor_evening (day 50) falls the day after one and the day before the
    //   other - blocked by both through the D-1 / Return Day+1 rule.
    { key: "expo_day", title: "Regional Tech Expo", status: "confirmed",
      purpose: "Trade expo for regional technology vendors",
      description: "Full-day expo with two livestreamed stages.",
      category: "conference", organiser: "Budi Santoso", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2026-11-14"), startHour: 9, durationHours: 9, attendance: 220, layout: "exhibition" },

    { key: "vendor_evening", title: "Vendor Networking Evening", status: "planning",
      purpose: "Evening pitches and networking for expo vendors",
      description: "Short vendor pitches followed by networking; closing pitches livestreamed.",
      category: "networking", organiser: "Hakim Zulkifli", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2026-11-15"), startHour: 17, durationHours: 5, attendance: 120, layout: "banquet" },

    // No venue booked yet, so the availability screen says "venue not yet
    // chosen" and adds no transfer time.
    { key: "awards_night", title: "Annual Partner Awards Night", status: "planning",
      purpose: "Recognise long-standing partners",
      description: "Evening ceremony, livestreamed to partners abroad.",
      category: "networking", organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2026-11-16"), startHour: 18, durationHours: 4, attendance: 130, layout: "banquet" },
  ];

  // SPM-48 test-case events (docs/test-cases/SPM-48_Test_Cases.xlsx): each case
  // names its event and the date it happens on, so the dates are fixed.
  const fixture = (
    key: string, title: string, date: string, startHour: number, durationHours: number,
    organiser: string, options: { status?: string } & Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, organiser, coordinator: "daniel.tan@connectsphere.com",
    days: daysUntil(date), startHour, durationHours, status: "planning", ...options,
  });
  eventData.push(
    fixture("fx_town_hall", "Town Hall Q4", "2026-10-20", 9, 8, "Rachel Ng"),
    fixture("fx_keynote", "Keynote Rehearsal", "2026-10-20", 14, 2, "James Koh"),
    fixture("fx_halloween", "Halloween Party", "2026-10-30", 19, 4, "Grace Abdullah"),
    fixture("fx_career_fair", "Career Fair", "2026-10-14", 10, 6, "Faridah Aziz"),
    fixture("fx_career_fair2", "Career Fair 2", "2026-10-15", 10, 6, "Faridah Aziz"),
    fixture("fx_prod_launch", "Product Launch", "2026-10-16", 10, 4, "Melissa Yap"),
    fixture("fx_prod_launch2", "Product Launch 2", "2026-10-17", 10, 4, "Melissa Yap"),
    fixture("fx_open_house", "Open House", "2026-10-05", 9, 8, "Kelvin Loh"),
    fixture("fx_orientation", "Orientation Day", "2026-10-05", 9, 8, "Samuel Ong"),
    fixture("fx_sports_meet", "Sports Meet", "2026-11-20", 9, 8, "Samuel Ong"),
    fixture("fx_faculty_day", "Faculty Day", "2026-11-10", 9, 8, "Grace Abdullah"),
    fixture("fx_homecoming", "Homecoming Weekend", "2026-11-10", 10, 6, "Grace Abdullah"),
    fixture("fx_board_meeting", "Board Meeting", "2026-10-26", 10, 2, "James Koh"),
    fixture("fx_investor_briefing", "Investor Briefing", "2026-10-26", 11, 2, "James Koh"),
    fixture("fx_year_end_gala", "Year-End Gala", "2027-01-15", 18, 4, "Rachel Ng"),
    fixture("fx_staff_retreat", "Staff Retreat", "2026-12-14", 9, 8, "Rachel Ng"),
    fixture("fx_board_meeting2", "Board Meeting 2", "2026-12-14", 10, 3, "Rachel Ng"),
    fixture("fx_open_day", "Open Day", "2026-11-06", 9, 8, "Faridah Aziz"),
    fixture("fx_alumni_mixer", "Alumni Mixer", "2026-11-06", 18, 3, "Faridah Aziz"),
    fixture("fx_cancelled_summit", "Cancelled Summit", "2026-11-12", 9, 8, "Budi Santoso",
      { status: "cancelled", cancellationReason: "Client cancelled after a change in plans." }),
    fixture("fx_product_demo", "Product Demo", "2026-11-12", 10, 4, "Budi Santoso"),
    fixture("fx_gala_dinner", "Gala Dinner", "2026-11-02", 10, 6, "Evelyn Chen"),
    fixture("fx_charity_concert", "Charity Concert", "2026-11-03", 18, 3, "Evelyn Chen"),
    fixture("fx_school_concert", "School Concert", "2026-11-04", 18, 3, "Evelyn Chen"),
    fixture("fx_wrap_up", "Workshop Wrap-up", "2026-11-11", 10, 6, "Hakim Zulkifli"),
    fixture("fx_setup_talk", "Setup Day Talk", "2026-11-10", 10, 6, "Hakim Zulkifli"),
    fixture("fx_expo3", "Three-Day Expo", "2026-11-16", 9, 56, "Budi Santoso"),
    fixture("fx_post_expo", "Post-Expo Mixer", "2026-11-19", 18, 3, "Budi Santoso"),
    fixture("fx_later_concert", "Later Concert", "2026-11-20", 18, 3, "Evelyn Chen"),
    fixture("fx_late_gala", "Late Gala", "2026-11-23", 19, 4.5, "Evelyn Chen"),
    fixture("fx_wed_fair", "Wednesday Fair", "2026-11-25", 10, 6, "Melissa Yap"),
    fixture("fx_morning_ws", "Morning Workshop", "2026-12-01", 9, 3, "Hakim Zulkifli"),
    fixture("fx_evening_recital", "Evening Recital", "2026-12-01", 18, 3, "Hakim Zulkifli"),
    // Runs 5 to 20 Oct in two sessions (Day 1 and Day 2), created further down.
    fixture("fx_two_day_summit", "Two-Day Summit", "2026-10-05", 9, 368, "Budi Santoso"),
    fixture("fx_prod_showcase", "Product Showcase", "2026-10-21", 11, 4, "Melissa Yap"),
    fixture("fx_welcome_assembly", "Welcome Assembly", "2026-10-21", 11, 4, "Kelvin Loh"),
    fixture("fx_planning_workshop", "Planning Workshop", "2026-11-03", 11, 4, "Kelvin Loh"),
    fixture("fx_alumni_talk", "Alumni Talk", "2026-10-28", 10, 3, "Grace Abdullah"),
    fixture("fx_debate_finals", "Debate Finals", "2026-11-05", 10, 6, "Samuel Ong"),
    fixture("fx_grad", "Graduation Ceremony", "2026-10-29", 10, 4, "Grace Abdullah"),
    fixture("fx_grad2", "Graduation Ceremony 2", "2026-10-30", 10, 4, "Grace Abdullah"),

    // SPM-49 test-case events (docs/test-cases/SPM-49_Test_Cases.xlsx): Reserve
    // Equipment. Several of these are reserved by an actual call to
    // POST .../reserve while running the cases, not seeded already-reserved -
    // only the events that need to already HOLD stock before the case starts
    // (Fashion Show, Gala Night, Trade Mixer, Summit Lunch, Reserved Showcase)
    // are seeded with a reservation below.
    fixture("fx49_spring_fair", "Spring Fair", "2027-02-02", 9, 6, "Rachel Ng", { status: "under_review" }),
    fixture("fx49_founders_day", "Founders Day", "2027-02-04", 9, 6, "James Koh", { status: "under_review" }),
    fixture("fx49_autumn_fair", "Autumn Fair", "2027-02-09", 9, 6, "Melissa Yap", { status: "under_review" }),
    fixture("fx49_winter_fair", "Winter Fair", "2027-02-16", 9, 6, "Kelvin Loh", { status: "under_review" }),
    fixture("fx49_harvest_fair", "Harvest Fair", "2027-03-02", 9, 6, "Samuel Ong", { status: "under_review" }),
    fixture("fx49_summer_fair", "Summer Fair", "2027-03-09", 9, 6, "Faridah Aziz", { status: "under_review" }),
    fixture("fx49_craft_market", "Craft Market", "2027-03-16", 9, 6, "Grace Abdullah", { status: "under_review" }),
    fixture("fx49_fashion_show", "Fashion Show", "2027-03-23", 14, 6, "Evelyn Chen", { status: "under_review" }),
    fixture("fx49_after_party", "After Party", "2027-03-23", 20, 3, "Hakim Zulkifli", { status: "under_review" }),
    fixture("fx49_product_demo_day", "Product Demo Day", "2027-03-15", 10, 4, "Budi Santoso", { status: "under_review" }),
    fixture("fx49_partner_lunch", "Partner Lunch", "2027-03-15", 11, 2, "Rachel Ng", { status: "under_review" }),
    fixture("fx49_sales_kickoff", "Sales Kickoff", "2027-04-05", 9, 6, "James Koh", { status: "under_review" }),
    fixture("fx49_board_retreat", "Board Retreat", "2027-04-26", 9, 6, "Melissa Yap", { status: "under_review" }),
    fixture("fx49_trade_show", "Trade Show", "2027-04-12", 9, 6, "Kelvin Loh", { status: "under_review" }),
    fixture("fx49_media_briefing", "Media Briefing", "2027-04-13", 9, 6, "Samuel Ong", { status: "under_review" }),
    fixture("fx49_careers_day", "Careers Day", "2027-04-19", 9, 6, "Faridah Aziz", { status: "under_review" }),
    fixture("fx49_wrap_party", "Wrap Party", "2027-04-21", 18, 3, "Grace Abdullah", { status: "under_review" }),
    fixture("fx49_innovation_day", "Innovation Day", "2027-05-03", 9, 6, "Evelyn Chen", { status: "under_review" }),
    fixture("fx49_gala_night", "Gala Night", "2027-05-10", 18, 4, "Hakim Zulkifli", { status: "under_review" }),
    fixture("fx49_awards_dinner", "Awards Dinner", "2027-05-10", 19, 4, "Budi Santoso", { status: "under_review" }),
    fixture("fx49_popup_store", "Pop-up Store", "2027-05-17", 9, 6, "Rachel Ng", { status: "under_review" }),
    fixture("fx49_flash_sale", "Flash Sale", "2027-05-17", 9, 6, "James Koh", { status: "under_review" }),
    fixture("fx49_it_bootcamp", "IT Bootcamp", "2027-05-24", 9, 6, "Melissa Yap", { status: "under_review" }),
    fixture("fx49_cancelled_roadshow", "Cancelled Roadshow", "2027-06-01", 9, 6, "Kelvin Loh",
      { status: "cancelled", cancellationReason: "Client withdrew the request." }),
    fixture("fx49_trade_mixer", "Trade Mixer", "2027-06-07", 18, 3, "Samuel Ong", { status: "under_review" }),
    // Runs its Day 1 session on the same date Trade Mixer holds all the stock,
    // and Day 2 three weeks later - sessions created further down.
    fixture("fx49_two_day_forum", "Two-Day Forum", "2027-06-07", 9, 368, "Faridah Aziz", { status: "under_review" }),
    fixture("fx49_summit_lunch", "Summit Lunch", "2027-06-14", 12, 2, "Grace Abdullah", { status: "under_review" }),
    fixture("fx49_product_expo", "Product Expo", "2027-06-14", 9, 6, "Evelyn Chen", { status: "under_review" }),
    fixture("fx49_reserved_showcase", "Reserved Showcase", "2027-07-05", 9, 6, "Rachel Ng", { status: "under_review" }),
  );

  // -----------------------------------------------------------------
  // SPM-40 QA fixture: the only seeded event in APPROVED status, so the
  // "opening Find a venue moves Approved -> Planning" case can be run by
  // hand (nothing in the app can approve an event yet - S-13 is not built).
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  eventData.push(
    { key: "spm40_approved", title: "SPM40 Approved Workshop", status: "approved",
      purpose: "Venue search walkthrough",
      category: "workshop", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
      days: 180, startHour: 9, durationHours: 3, attendance: 30, layout: "classroom" },
  );

  // -----------------------------------------------------------------
  // SPM-30 QA fixtures (Assign Event Coordinator) - one event per starting
  // state docs/test-cases/SPM-30_test_cases.json needs. The SAME events as
  // scripts/seed-spm30.ts (`npm run fixtures:spm30`), which adds or resets
  // them on the shared database without a reseed - keep the two in step.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  eventData.push(
    // Awaiting assignment - submitted, no coordinator.
    { key: "spm30_unassigned_nusantara", title: "SPM30 Nusantara Developer Meetup", status: "submitted",
      purpose: "Community developer meetup",
      category: "conference", organiser: "Budi Santoso",
      days: daysUntil("2027-01-22"), startHour: 9, durationHours: 6, attendance: 120, layout: "theatre" },
    { key: "spm30_unassigned_meridian", title: "SPM30 Meridian Graduate Evening", status: "submitted",
      purpose: "Campus recruitment networking evening",
      category: "networking", organiser: "James Koh",
      days: daysUntil("2027-02-09"), startHour: 18, durationHours: 3, attendance: 100, layout: "exhibition" },
    // Must NOT appear on the Assignments page.
    { key: "spm30_draft", title: "SPM30 Draft Investor Update", status: "draft",
      purpose: "Still checking dates",
      category: "meeting", organiser: "Rachel Ng",
      days: daysUntil("2027-03-01"), startHour: 9, durationHours: 2, attendance: 20, layout: "boardroom" },
    // Already assigned - reassignment.
    { key: "spm30_reassign_kirana", title: "SPM30 Kirana Regional Offsite", status: "under_review",
      purpose: "Half-year strategy alignment",
      category: "meeting", organiser: "Faridah Aziz", coordinator: "priya.raj@connectsphere.com",
      days: daysUntil("2027-02-15"), startHour: 9, durationHours: 8, attendance: 45, layout: "u_shape" },
    { key: "spm30_same_coordinator", title: "SPM30 Straits Journal Club", status: "under_review",
      purpose: "Monthly journal club",
      category: "seminar", organiser: "Raj Kumar", coordinator: "joel.fernandez@connectsphere.com",
      days: daysUntil("2027-01-28"), startHour: 12, durationHours: 2, attendance: 30, layout: "boardroom" },
    { key: "spm30_reassign_queue", title: "SPM30 Nusantara Product Launch", status: "under_review",
      purpose: "Regional product launch",
      category: "exhibition", organiser: "Sari Widodo", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-03-03"), startHour: 15, durationHours: 4, attendance: 200, layout: "theatre" },
    { key: "spm30_confirmed", title: "SPM30 Anchorpoint Partner Briefing", status: "confirmed",
      purpose: "Quarterly partner briefing",
      category: "seminar", organiser: "Melissa Yap", coordinator: "joel.fernandez@connectsphere.com",
      days: daysUntil("2027-01-19"), startHour: 9, durationHours: 4, attendance: 90, layout: "theatre" },
    { key: "spm30_postponed", title: "SPM30 Civic Trust Workshop", status: "postponed",
      purpose: "Teachers' curriculum workshop",
      category: "workshop", organiser: "Grace Abdullah", coordinator: "arif.mansor@connectsphere.com",
      days: daysUntil("2027-03-10"), startHour: 9, durationHours: 5, attendance: 40, layout: "classroom" },
    // Closed statuses - cannot be reassigned.
    { key: "spm30_completed", title: "SPM30 Harbourline Claims Training", status: "completed",
      purpose: "Claims systems training",
      category: "training", organiser: "Preeti Sharma", coordinator: "priya.raj@connectsphere.com",
      days: daysUntil("2026-08-20"), startHour: 9, durationHours: 4, attendance: 35, layout: "classroom" },
    { key: "spm30_cancelled", title: "SPM30 Pearl Delta Supplier Forum", status: "cancelled",
      purpose: "Supplier engagement forum",
      category: "meeting", organiser: "Samuel Ong", coordinator: "joel.fernandez@connectsphere.com",
      days: daysUntil("2027-01-12"), startHour: 9, durationHours: 5, attendance: 60, layout: "u_shape",
      cancellationReason: "Client cancelled after a change in the procurement schedule." },
    { key: "spm30_rejected", title: "SPM30 Selaras Overnight Field Day", status: "rejected",
      purpose: "Overnight field demonstration",
      category: "workshop", organiser: "Nurul Izzah", coordinator: "priya.raj@connectsphere.com",
      days: daysUntil("2027-01-15"), startHour: 20, durationHours: 24, attendance: 80, layout: "exhibition",
      rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy." },
    // Attendee view - confirmed with registration open.
    { key: "spm30_attendee_forum", title: "SPM30 Meridian Client Forum", status: "confirmed",
      purpose: "Client-facing market outlook forum",
      category: "conference", organiser: "James Koh", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-02-24"), startHour: 13, durationHours: 5, attendance: 150, layout: "theatre",
      regEnabled: true, regCapacity: 150 },
  );

  // -----------------------------------------------------------------
  // SPM-28 QA fixtures (Review Event Request) - the events
  // docs/test-cases/SPM-28_test_cases.json uses. The SAME events as
  // scripts/seed-spm28.ts (`npm run fixtures:spm28`), which resets them on
  // the shared database without a reseed after a test case approves or
  // rejects one - keep the two in step, including their facility and
  // equipment requirements below.
  // Pushed LAST so no earlier event's EVT- reference number shifts. They are
  // events 124-130, so they get EVT-000124 to EVT-000130 - the numbers the
  // fixture script pins and the SPM-28 test cases quote. Add new events AFTER
  // this block, or those numbers move.
  // -----------------------------------------------------------------
  eventData.push(
    { key: "spm28_launch", title: "SPM28 Nusantara Product Launch", status: "under_review",
      purpose: "Regional product launch and press event",
      description: "Press event with livestream and product demonstration area.",
      category: "exhibition", organiser: "Sari Widodo", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-03-17"), startHour: 15, durationHours: 4, attendance: 200, layout: "theatre" },
    { key: "spm28_approve", title: "SPM28 Harbourline Client Seminar", status: "under_review",
      purpose: "Client briefing on the 2027 policy changes",
      description: "Morning seminar with a Q&A panel.",
      category: "seminar", organiser: "Preeti Sharma", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-03-24"), startHour: 9, durationHours: 4, attendance: 80, layout: "theatre",
      accessibilityNotes: "Step-free access to the room.",
      specialRequirements: "Reserved front row for panellists." },
    { key: "spm28_reject", title: "SPM28 Kirana Regional Offsite", status: "under_review",
      purpose: "Half-year strategy alignment",
      description: "Asked for a large room but has not confirmed headcount.",
      category: "meeting", organiser: "Faridah Aziz", coordinator: "priya.raj@connectsphere.com",
      days: daysUntil("2027-03-10"), startHour: 9, durationHours: 8, attendance: 45, layout: "u_shape" },
    { key: "spm28_sparse", title: "SPM28 Straits Journal Club", status: "under_review",
      purpose: "Monthly journal club",
      category: "seminar", organiser: "Raj Kumar", coordinator: "joel.fernandez@connectsphere.com",
      days: daysUntil("2027-02-25"), startHour: 12, durationHours: 2, attendance: 30, layout: "boardroom" },
    { key: "spm28_planning", title: "SPM28 Straits Research Symposium", status: "planning",
      purpose: "Present findings from the 2026 cohort study",
      category: "seminar", organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-04-07"), startHour: 9, durationHours: 9, attendance: 200, layout: "theatre" },
    { key: "spm28_approved", title: "SPM28 Meridian Wealth Forum", status: "approved",
      purpose: "Client-facing forum on the 2027 market outlook",
      category: "conference", organiser: "James Koh", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-04-14"), startHour: 13, durationHours: 5, attendance: 150, layout: "theatre" },
    { key: "spm28_rejected", title: "SPM28 Overnight Hackathon", status: "rejected",
      purpose: "24-hour continuous hackathon",
      category: "workshop", organiser: "Budi Santoso", coordinator: "priya.raj@connectsphere.com",
      days: daysUntil("2027-02-18"), startHour: 20, durationHours: 24, attendance: 90, layout: "exhibition",
      rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy." },
  );

  // -----------------------------------------------------------------
  // SPM-42 QA fixtures (Request Venue Booking). The SAME events as
  // scripts/seed-spm42.ts (`npm run fixtures:spm42`) - keep the two in step.
  // Sessions and the two blocker bookings are created further down.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm42 = (
    key: string, title: string, date: string, startHour: number, durationHours: number,
    options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com", status: "planning",
    purpose: "SPM-42 venue booking request test event", category: "meeting",
    days: daysUntil(date), startHour, durationHours, ...options,
  });
  eventData.push(
    spm42("spm42_symposium", "SPM42 Research Symposium", "2027-03-04", 9, 9, { attendance: 200, layout: "theatre" }),
    spm42("spm42_morning_talk", "SPM42 Morning Talk", "2027-03-05", 10, 2, { attendance: 40, layout: "theatre" }),
    spm42("spm42_town_hall", "SPM42 Town Hall", "2027-03-06", 9, 8, { attendance: 100, layout: "theatre" }),
    spm42("spm42_refusals", "SPM42 Refusal Checks", "2027-03-07", 9, 8, { attendance: 50, layout: "theatre" }),
    spm42("spm42_early_briefing", "SPM42 Early Briefing", "2027-03-08", 9, 3, { attendance: 40, layout: "theatre" }),
    spm42("spm42_late_show", "SPM42 Late Show", "2027-03-09", 19, 3, { attendance: 40, layout: "theatre" }),
    spm42("spm42_plain_pm", "SPM42 Plain Afternoon", "2027-03-10", 14, 3, { attendance: 30, layout: "classroom" }),
    spm42("spm42_networking", "SPM42 Networking Evening", "2027-03-11", 17, 5, { attendance: 120, layout: "banquet" }),
    spm42("spm42_three_sessions", "SPM42 Three-Session Forum", "2027-03-01", 9, 61,
      { status: "approved", attendance: 80, layout: "theatre" }),
    spm42("spm42_clash_check", "SPM42 Clash Check", "2026-10-21", 11, 4),
    spm42("spm42_cancelled_hold", "SPM42 Cancelled Hold", "2027-03-15", 9, 8, { coordinator: "priya.raj@connectsphere.com" }),
    spm42("spm42_rejected_hold", "SPM42 Rejected Hold", "2027-03-16", 9, 9, { coordinator: "priya.raj@connectsphere.com" }),
    spm42("spm42_after_cancel", "SPM42 After Cancellation", "2027-03-15", 10, 6),
    spm42("spm42_after_reject", "SPM42 After Rejection", "2027-03-17", 10, 6),
  );

  // -----------------------------------------------------------------
  // SPM-54 QA fixtures (Begin Event Planning) - the events
  // docs/test-cases/SPM-54_test_cases.json uses. The SAME events as
  // scripts/seed-spm54.ts (`npm run fixtures:spm54`), which resets them on
  // the shared database without a reseed after a test case moves one to
  // Planning - keep the two in step.
  // Pushed LAST so no earlier event's EVT- reference number shifts. They are
  // events 145-154, so they get EVT-000145 to EVT-000154 - the numbers the
  // fixture script pins and the SPM-54 test cases quote. Add new events AFTER
  // this block, or those numbers move.
  // -----------------------------------------------------------------
  eventData.push(
    { key: "spm54_begin", title: "SPM54 Straits Clinical Forum", status: "approved",
      purpose: "Share the 2027 clinical audit results",
      category: "seminar", organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-04"), startHour: 9, durationHours: 4, attendance: 120, layout: "theatre" },
    { key: "spm54_approved", title: "SPM54 Meridian Budget Briefing", status: "approved",
      purpose: "Brief department heads on the 2028 budget",
      category: "meeting", organiser: "James Koh", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-05"), startHour: 14, durationHours: 3, attendance: 20, layout: "boardroom" },
    { key: "spm54_under_review", title: "SPM54 Harbourline Agents Seminar", status: "under_review",
      purpose: "Product update for insurance agents",
      category: "seminar", organiser: "Preeti Sharma", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-10"), startHour: 9, durationHours: 3, attendance: 60, layout: "theatre" },
    { key: "spm54_confirmed", title: "SPM54 Anchorpoint Fleet Briefing", status: "confirmed",
      purpose: "Annual fleet safety briefing",
      category: "seminar", organiser: "Melissa Yap", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-11"), startHour: 9, durationHours: 3, attendance: 90, layout: "theatre" },
    { key: "spm54_rejected", title: "SPM54 Nusantara Overnight Sprint", status: "rejected",
      purpose: "Overnight product sprint",
      category: "workshop", organiser: "Budi Santoso", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-12"), startHour: 20, durationHours: 24, attendance: 70, layout: "exhibition",
      rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy." },
    { key: "spm54_planning", title: "SPM54 Kirana Store Managers Workshop", status: "planning",
      purpose: "Store operations workshop",
      category: "workshop", organiser: "Faridah Aziz", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-18"), startHour: 9, durationHours: 3, attendance: 40, layout: "classroom" },
    { key: "spm54_begin_booking", title: "SPM54 Pearl Delta Supplier Briefing", status: "approved",
      purpose: "Brief suppliers on the 2028 sourcing plan",
      category: "seminar", organiser: "Samuel Ong", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-25"), startHour: 9, durationHours: 3, attendance: 50, layout: "theatre" },
    { key: "spm54_begin_equipment", title: "SPM54 Sundara Service Workshop", status: "approved",
      purpose: "Front-of-house service workshop",
      category: "workshop", organiser: "Dewi Kartika", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-26"), startHour: 14, durationHours: 3, attendance: 30, layout: "classroom" },
    { key: "spm54_begin_save", title: "SPM54 Tanjong Legal Seminar", status: "approved",
      purpose: "Client seminar on the 2027 employment law changes",
      category: "seminar", organiser: "Aaron Sim", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-27"), startHour: 9, durationHours: 3, attendance: 45, layout: "theatre" },
    { key: "spm54_begin_remove", title: "SPM54 Civic Trust Teachers Briefing", status: "approved",
      purpose: "Briefing for teachers on the 2028 curriculum",
      category: "seminar", organiser: "Grace Abdullah", coordinator: "daniel.tan@connectsphere.com",
      days: daysUntil("2027-08-31"), startHour: 9, durationHours: 3, attendance: 35, layout: "classroom" },
  );

  // -----------------------------------------------------------------
  // SPM-27 QA fixtures (View Event Status) - one event per status for one
  // organiser. The SAME events as scripts/seed-spm27.ts
  // (`npm run fixtures:spm27`) - keep the two in step.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm27Review = ["submitted", "under_review"];
  const spm27Planning = [...spm27Review, "approved", "planning"];
  const spm27 = (
    key: string, title: string, status: string, chain: string[], days: number, startHour: number,
    durationHours: number, category: string, attendance: number, layout: string,
    options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, status, chain, days, startHour, durationHours, category, attendance, layout,
    organiser: "Hakim Zulkifli", purpose: "SPM-27 event status test event",
    coordinator: chain.includes("under_review") ? "huishan.neo@connectsphere.com" : undefined,
    ...options,
  });
  eventData.push(
    spm27("spm27_safety_briefing", "SPM27 Bayu Safety Briefing", "submitted", ["submitted"], 70, 9, 3, "training", 40, "classroom"),
    spm27("spm27_grid_workshop", "SPM27 Bayu Grid Workshop", "under_review", spm27Review, 72, 9, 6, "workshop", 30, "u_shape"),
    spm27("spm27_investor_day", "SPM27 Bayu Investor Day", "submitted", ["submitted"], 74, 10, 5, "conference", 120, "theatre"),
    spm27("spm27_town_hall", "SPM27 Bayu Town Hall", "submitted", ["submitted"], 76, 15, 2, "meeting", 150, "theatre"),
    spm27("spm27_contractor_briefing", "SPM27 Bayu Contractor Briefing", "under_review", spm27Review, 78, 9, 3, "seminar", 50, "theatre"),
    spm27("spm27_supplier_day", "SPM27 Bayu Supplier Day", "approved", [...spm27Review, "approved"], 80, 9, 7, "exhibition", 90, "exhibition"),
    spm27("spm27_leadership_retreat", "SPM27 Bayu Leadership Retreat", "planning", spm27Planning, 82, 9, 8, "meeting", 25, "boardroom"),
    spm27("spm27_annual_conference", "SPM27 Bayu Annual Conference", "confirmed", [...spm27Planning, "confirmed"], 84, 9, 9, "conference", 200, "theatre"),
    spm27("spm27_graduate_induction", "SPM27 Bayu Graduate Induction", "completed", [...spm27Planning, "confirmed", "completed"], -20, 9, 6, "training", 35, "classroom"),
    spm27("spm27_overnight_site_visit", "SPM27 Bayu Overnight Site Visit", "rejected", [...spm27Review, "rejected"], 86, 20, 14, "workshop", 60, "exhibition",
      { rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy." }),
    spm27("spm27_community_fair", "SPM27 Bayu Community Fair", "postponed", [...spm27Planning, "postponed"], 88, 10, 6, "exhibition", 300, "exhibition"),
    spm27("spm27_partner_lunch", "SPM27 Bayu Partner Lunch", "withdrawn", [...spm27Review, "withdrawn"], 90, 12, 2, "networking", 40, "banquet"),
    spm27("spm27_wind_farm_tour", "SPM27 Bayu Wind Farm Tour", "withdrawn", [...spm27Review, "withdrawn"], 92, 9, 4, "seminar", 30, "theatre"),
    spm27("spm27_product_showcase", "SPM27 Bayu Product Showcase", "cancelled", [...spm27Planning, "cancelled"], 94, 14, 4, "exhibition", 150, "exhibition",
      { cancellationReason: "Product launch moved to next financial year." }),
  );

  // -----------------------------------------------------------------
  // SPM-34 QA fixtures (Confirm Event). The SAME events as
  // scripts/seed-spm34.ts (`npm run fixtures:spm34`) - keep the two in step.
  //
  // The events only. The bookings, equipment requests and sessions that put
  // each one in its particular state are created by that script alone, so run
  // it once after a full reseed or every one of these confirms trivially.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm34 = (
    key: string, title: string, date: string, durationHours: number,
    options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    status: "planning", purpose: "SPM-34 confirm event test event", category: "meeting",
    days: daysUntil(date), startHour: 9, durationHours, attendance: 40, layout: "theatre",
    ...options,
  });
  eventData.push(
    spm34("spm34_ready", "SPM34 Ready To Confirm", "2027-05-10", 6),
    spm34("spm34_venue_only", "SPM34 Venue Only", "2027-05-11", 4),
    spm34("spm34_partial", "SPM34 Partially Fulfilled", "2027-05-12", 4),
    spm34("spm34_no_venue", "SPM34 No Venue", "2027-05-13", 4),
    spm34("spm34_pending_venue", "SPM34 Pending Venue", "2027-05-14", 4),
    spm34("spm34_equipment_short", "SPM34 Equipment Short", "2027-05-15", 4),
    spm34("spm34_sessions", "SPM34 Two Day Forum", "2027-05-17", 27),
    spm34("spm34_other_coordinator", "SPM34 Another Coordinator", "2027-05-18", 4,
      { coordinator: "priya.raj@connectsphere.com" }),
  );

  const events: Record<string, { id: string; startsAt: Date | null; endsAt: Date | null; days: number }> = {};

  for (const e of eventData) {
    const organiserId = users[`organiser:${e.organiser}`];
    const organiser = await prisma.user.findUnique({
      where: { id: organiserId },
      select: { organisationId: true },
    });
    const startsAt = e.status === "draft" ? null : day(e.days, e.startHour ?? 9);
    const endsAt = startsAt ? new Date(startsAt.getTime() + (e.durationHours ?? 4) * 3_600_000) : null;

    const created = await prisma.event.create({
      data: {
        // ADDED: persists this seed's own natural key (e.g.
        // "confirmed_claims") so a test fixture, report, or anything else
        // that needs to refer back to "the same event" survives a reseed -
        // see the comment on Event.seedKey in schema.prisma.
        seedKey: e.key,
        title: e.title,
        purpose: e.purpose,
        description: e.description,
        category: e.category,
        organiserId,
        organisationId: organiser?.organisationId,
        coordinatorId: e.coordinator ? users[e.coordinator] : undefined,
        status: e.status,
        startsAt,
        endsAt,
        expectedAttendance: e.attendance,
        preferredLayout: e.layout,
        accessibilityNotes: e.accessibilityNotes,
        specialRequirements: e.specialRequirements,
        registrationEnabled: e.regEnabled ?? false,
        registrationCapacity: e.regCapacity,
        registrationOpensAt: e.regEnabled ? day(e.days - 30) : undefined,
        registrationClosesAt: e.regEnabled ? day(e.days - 2) : undefined,
        submittedAt: e.status === "draft" ? undefined : day(e.days - 40),
        confirmedAt: ["confirmed", "completed"].includes(e.status) ? day(e.days - 12) : undefined,
        rejectionReason: e.rejectionReason,
        cancellationReason: e.cancellationReason,
      },
    });
    events[e.key] = { id: created.id, startsAt, endsAt, days: e.days };
  }

  // -------------------------------------------------------------------
  // FACILITY REQUIREMENTS
  // -------------------------------------------------------------------
  console.log("Creating facility requirements…");
  const facReqs: [string, [string, boolean][]][] = [
    ["submitted", [["High-density WiFi", true], ["Fixed ceiling projector", true],
      ["Built-in PA system", true], ["Wheelchair spaces", true], ["Adjacent breakout rooms", false]]],
    ["planning", [["High-density WiFi", true], ["Video conferencing suite", true],
      ["Livestream capability", true], ["Hearing induction loop", true],
      ["Wheelchair spaces", true], ["Catering pantry", false]]],
    ["confirmed_forum", [["High-density WiFi", true], ["Built-in PA system", true],
      ["Catering pantry", true], ["Step-free access", true], ["Raised stage", false]]],
    ["confirmed_panel", [["High-density WiFi", true], ["Built-in PA system", true],
      ["Livestream capability", true], ["Hearing induction loop", true], ["Green room", false]]],
    ["confirmed_showcase", [["High-density WiFi", true], ["Loading bay access", true],
      ["Raised stage", true], ["Catering pantry", true], ["Wheelchair spaces", true]]],
    ["planning_safety", [["High-density WiFi", true], ["Fixed ceiling projector", true],
      ["Adjacent breakout rooms", true], ["Step-free access", true]]],
    ["review_launch", [["High-density WiFi", true], ["Raised stage", true],
      ["Livestream capability", true], ["Green room", false]]],

    // SPM-41 QA fixtures
    ["spm41_training_55_loop", [["Hearing induction loop", true]]],
    ["spm41_hybrid_vc_live", [["Video conferencing suite", true], ["Livestream capability", true]]],
    ["spm41_hybrid_vc_only", [["Video conferencing suite", true]]],
    ["spm41_symposium", [["Video conferencing suite", true], ["Livestream capability", true],
      ["Green room", true]]],
    ["spm41_lecture_200", [["Hearing induction loop", true], ["Wheelchair spaces", true]]],
    ["spm41_lecture_100", [["Hearing induction loop", true]]],
  ];
  // SPM-28 fixtures - same as scripts/seed-spm28.ts.
  facReqs.push(
    ["spm28_launch", [["High-density WiFi", true], ["Raised stage", true],
      ["Livestream capability", true], ["Green room", false]]],
    ["spm28_approve", [["Built-in PA system", true], ["Fixed ceiling projector", true]]],
  );
  for (const [eventKey, reqs] of facReqs) {
    for (const [facilityName, isMandatory] of reqs) {
      await prisma.eventFacilityRequirement.create({
        data: { eventId: events[eventKey].id, facilityId: fac[facilityName], isMandatory },
      });
    }
  }

  // -------------------------------------------------------------------
  // STATUS HISTORY
  // -------------------------------------------------------------------
  console.log("Creating status history…");
  const CHAIN: Record<string, string[]> = {
    draft: [],
    submitted: ["submitted"],
    under_review: ["submitted", "under_review"],
    approved: ["submitted", "under_review", "approved"],
    planning: ["submitted", "under_review", "approved", "planning"],
    confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
    completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
    rejected: ["submitted", "under_review", "rejected"],
    cancelled: ["submitted", "under_review", "approved", "planning", "cancelled"],
    // SPM-30's postponed fixture; same chain as scripts/seed-spm30.ts.
    postponed: ["submitted", "under_review", "approved", "planning", "postponed"],
  };
  const REASONS: Record<string, string> = {
    under_review: "Coordinator assigned",
    approved: "Requirements sufficiently clear",
    planning: "Venue search started",
    confirmed: "Essential arrangements complete",
    completed: "Event took place",
    rejected: "Overnight occupancy not licensed",
    cancelled: "Client withdrew the request",
    postponed: "Client requested a later date",
    withdrawn: "Organiser asked to withdraw; coordinator recorded it",
  };
  for (const e of eventData) {
    const chain = e.chain ?? CHAIN[e.status];
    let prev = "draft";
    for (let i = 0; i < chain.length; i++) {
      const to = chain[i];
      await prisma.eventStatusHistory.create({
        data: {
          eventId: events[e.key].id,
          fromStatus: prev,
          toStatus: to,
          changedBy: to === "submitted"
            ? users[`organiser:${e.organiser}`]
            : e.coordinator ? users[e.coordinator] : users["grace.lim@connectsphere.com"],
          changedAt: day(e.days - 40 + i * 5),
          reason: REASONS[to],
        },
      });
      prev = to;
    }
  }

  // -------------------------------------------------------------------
  // CLARIFICATION REQUESTS
  // -------------------------------------------------------------------
  console.log("Creating clarification requests…");
  await prisma.clarificationRequest.create({
    data: {
      eventId: events["under_review"].id,
      requestedBy: users["priya.raj@connectsphere.com"],
      requestedAt: day(-3),
      message: "You have asked for a large room but listed 45 attendees. Please confirm the final headcount and whether you need breakout space.",
      status: "open",
    },
  });
  await prisma.clarificationRequest.create({
    data: {
      eventId: events["review_journal"].id,
      requestedBy: users["joel.fernandez@connectsphere.com"],
      requestedAt: day(-6),
      message: "Please confirm whether this is a one-off booking or the start of a recurring monthly series.",
      status: "answered",
      responseMessage: "One-off for now. We will raise separate requests for later months.",
      respondedAt: day(-4),
    },
  });
  await prisma.clarificationRequest.create({
    data: {
      eventId: events["review_launch"].id,
      requestedBy: users["daniel.tan@connectsphere.com"],
      requestedAt: day(-2),
      message: "The livestream requirement is not clear. Do you need a public stream, a private link for press, or both?",
      status: "open",
    },
  });

  // -------------------------------------------------------------------
  // VENUE BOOKINGS
  // -------------------------------------------------------------------
  console.log("Creating venue bookings…");
  const venueStaff = [
    "marcus.wong@connectsphere.com", "siti.hassan@connectsphere.com",
    "roy.chandra@connectsphere.com", "lena.goh@connectsphere.com",
  ];
  // [eventKey, venueCode, status] — no two 'approved' rows share a venue and
  // an overlapping time. That rule is enforced by route code, not the
  // database, so the seed has to respect it itself.
  const bookings: [string, string, string, string?][] = [
    ["submitted", "ORC-SEM", "pending"],
    ["submitted", "MAR-AUD", "rejected", "Auditorium seating is fixed theatre-style and cannot support parallel tracks."],
    ["planning", "MAR-GH", "approved"],
    ["expo_day", "ORC-GAL", "approved"],
    ["vendor_evening", "MAR-GH", "approved"],
    ["fx_prod_showcase", "MAR-AUD", "approved"],
    ["fx_welcome_assembly", "MAR-GH", "approved"],
    ["confirmed_forum", "MAR-GH", "approved"],
    ["completed_training", "JUR-TRN", "approved"],
    ["confirmed_briefing", "CBP-CONF", "approved"],
    ["confirmed_panel", "ONE-AUD", "approved"],
    ["confirmed_workshop", "ORC-STU", "approved"],
    ["confirmed_showcase", "JUR-EXP", "approved"],
    ["confirmed_claims", "JUR-TRN", "approved"],
    ["confirmed_cpd", "ONE-SEM", "approved"],
    ["planning_safety", "CBP-CONF", "pending"],
    ["planning_field", "ORC-STU", "pending"],
    ["review_journal", "CBP-MTG1", "pending"],
    ["completed_annual", "MAR-GH", "approved"],
    ["completed_induction", "ORC-SEM", "approved"],
    ["completed_retreat", "MAR-BR1", "approved"],
    ["completed_roadshow", "ORC-GAL", "approved"],
    ["cancelled", "CBP-MTG2", "cancelled", "Released after the client cancelled the event."],
    // SPM-42-TC16: decided bookings that must NOT block a new request.
    ["spm42_cancelled_hold", "ORC-GAL", "cancelled", "Released by the coordinator."],
    ["spm42_rejected_hold", "MAR-AUD", "rejected", "Auditorium needed for internal rigging work."],
  ];
  for (let i = 0; i < bookings.length; i++) {
    const [eventKey, venueCode, status, reason] = bookings[i];
    const ev = events[eventKey];
    const seed = eventData.find((x) => x.key === eventKey)!;
    const decided = ["approved", "rejected", "cancelled"].includes(status);
    await prisma.venueBooking.create({
      data: {
        eventId: ev.id,
        venueId: venues[venueCode],
        layoutName: seed.layout,
        startsAt: ev.startsAt!,
        endsAt: ev.endsAt!,
        status,
        requestedBy: seed.coordinator ? users[seed.coordinator] : users["daniel.tan@connectsphere.com"],
        requestedAt: day(seed.days - 30),
        decidedBy: decided ? users[venueStaff[i % venueStaff.length]] : undefined,
        decidedAt: decided ? day(seed.days - 28) : undefined,
        decisionReason: reason,
      },
    });
  }

  // One future approved booking starts out flagged for review, so a coordinator
  // has something in their review queue on a fresh database. The story the data
  // tells: Venue Staff reduced Jurong Training Room's classroom layout from 60
  // seats to 40 (see venueData above), the Harbourline claims training expects
  // 55, and PATCH /api/venues/[id] flagged the approved booking rather than
  // changing it. Reason codes come from src/lib/venueImpact.ts; the matching
  // notification to its coordinator is in the notifications block below.
  await prisma.venueBooking.updateMany({
    where: {
      eventId: events["confirmed_claims"].id,
      venueId: venues["JUR-TRN"],
      status: "approved",
    },
    data: {
      needsReview: true,
      reviewReason: "layout_capacity_below_attendance",
      flaggedAt: day(-2),
    },
  });

  // -------------------------------------------------------------------
  // VENUE UNAVAILABILITY
  // -------------------------------------------------------------------
  console.log("Creating venue unavailability…");
  const unavailable: [string, number, number, string, string][] = [
    ["JUR-EXP", 21, 28, "renovation", "Floor resurfacing and loading bay works."],
    ["MAR-AUD", 55, 56, "maintenance", "Annual projector and rigging inspection."],
    ["ORC-STU", 106, 109, "internal_activity", "ConnectSphere staff year-end function."],
    ["ONE-ROOF", 40, 42, "safety", "High-wind advisory; terrace closed."],
    ["MAR-BR2", 60, 74, "renovation", "Refurbishment of the boardroom fit-out."],
    // The only OVERLAPPING pair in the demo data, and the only way SPM-46's
    // AC5 ("overlapping unavailable periods are identifiable") can be tested
    // by hand: nothing in the app writes to this table until the Block venue
    // screen (S-23) is built, and every other period above sits at a different
    // venue. They overlap each other in the middle, days 42-44, and touch
    // nothing else - Jurong Expo Floor's renovation is days 21-28, its only
    // booking is day 65, and no test case looks at this venue in this window.
    ["JUR-EXP", 40, 44, "maintenance", "Loading bay hoist inspection."],
    ["JUR-EXP", 42, 46, "safety", "Fire suppression system recertification."],
  ];
  for (let i = 0; i < unavailable.length; i++) {
    const [code, from, to, reason, notes] = unavailable[i];
    await prisma.venueUnavailability.create({
      data: {
        venueId: venues[code],
        startsAt: day(from, 0),
        endsAt: day(to, 23, 59),
        reason,
        notes,
        createdBy: users[venueStaff[i % venueStaff.length]],
      },
    });
  }

  // -------------------------------------------------------------------
  // EQUIPMENT REQUESTS
  // -------------------------------------------------------------------
  console.log("Creating equipment requests…");
  const techStaff = [
    "kenji.sato@connectsphere.com", "aisha.omar@connectsphere.com",
    "vikram.nair@connectsphere.com", "chloe.teo@connectsphere.com",
  ];
  // [eventKey, equipmentName, requested, reserved|null, status, note]
  const eqReqs: [string, string, number, number | null, string, string?][] = [
    ["submitted", "4K Portable Projector", 3, null, "requested", "One projector per parallel track."],
    ["submitted", "Handheld Wireless Mic", 4, null, "requested", "Two per plenary, two roaming."],
    ["planning", "PTZ Streaming Camera", 2, 2, "reserved", "Stage wide and presenter close-up."],
    ["planning", "Audio Mixing Desk", 1, 1, "reserved", "Must feed both the room PA and the stream."],
    ["planning", "Lavalier Wireless Mic", 3, 2, "partially_fulfilled", "Presenters move around the stage."],
    ["planning", "Streaming Encoder", 1, 1, "reserved", "Livestream uplink to regional partners."],
    ["planning", "Hearing Loop Receiver Kit", 1, 1, "reserved", "Loop receivers for the plenary."],
    ["confirmed_forum", "Handheld Wireless Mic", 4, 4, "reserved", "Two on stage, two for floor questions."],
    ["confirmed_forum", "Presentation Laptop", 1, 1, "reserved"],
    ["confirmed_forum", "Powered Lectern", 1, 1, "reserved"],
    ["confirmed_briefing", "4K Portable Projector", 1, 1, "reserved"],
    ["confirmed_briefing", "Handheld Wireless Mic", 2, 2, "reserved"],
    ["confirmed_panel", "PTZ Streaming Camera", 2, 2, "reserved", "Panel wide and audience reverse."],
    ["confirmed_panel", "Streaming Encoder", 1, 1, "reserved", "Public livestream."],
    ["confirmed_panel", "Gooseneck Table Mic", 5, 5, "reserved", "One per panellist."],
    ["confirmed_workshop", "4K Portable Projector", 2, 2, "reserved"],
    ["confirmed_workshop", "Presentation Clicker", 2, 2, "reserved"],
    ["confirmed_showcase", "LED Video Wall Panel", 6, 6, "reserved", "Video wall for the main stage."],
    ["confirmed_showcase", "Stage Riser Section", 8, 8, "reserved", "Staging for the demo area."],
    ["confirmed_showcase", "Check-in Tablet", 6, 6, "reserved", "Check-in desks at both entrances."],
    ["confirmed_showcase", "Portable Badge Printer", 2, 1, "partially_fulfilled", "Second printer is in for repair."],
    ["confirmed_claims", "4K Portable Projector", 1, 1, "reserved"],
    ["confirmed_claims", "Presentation Laptop", 1, 1, "reserved"],
    ["confirmed_cpd", "Handheld Wireless Mic", 1, 1, "reserved"],
    ["planning_safety", "4K Portable Projector", 4, null, "under_review", "Four demonstration stations."],
    ["planning_safety", "Portable WiFi Access Point", 4, null, "under_review", "High-density WiFi for the demo area."],
    ["review_launch", "LED Video Wall Panel", 4, null, "under_review", "Product reveal wall."],
    ["review_launch", "Streaming Encoder", 1, null, "unavailable", "All encoders committed to the trade showcase that week."],
    // SPM-47-TC15: recorded while the event was still in planning, before it
    // was cancelled, so the locked Equipment tab has a row to show.
    ["cancelled", "4K Portable Projector", 2, null, "requested", "Projectors for the supplier presentations."],
    // SPM-48 scenarios. Streaming Encoder has 3 in total: the expo holds 2 and
    // the awards night 1, so the vendor evening between them gets none.
    // Lavalier Wireless Mic has 10 - 2 in maintenance = 8: the expo holds 4,
    // so the vendor evening's 6 is only partly available.
    ["expo_day", "Lavalier Wireless Mic", 4, 4, "reserved", "Presenter mics for both stages."],
    ["expo_day", "Streaming Encoder", 2, 2, "reserved", "One per livestreamed stage."],
    ["awards_night", "Streaming Encoder", 1, 1, "reserved", "Livestream of the ceremony."],
    ["awards_night", "Legacy Overhead Projector", 1, null, "requested", "Asked for the old overhead projector by name."],
    ["vendor_evening", "Lavalier Wireless Mic", 6, null, "under_review", "One per vendor pitch, plus spares."],
    ["vendor_evening", "Streaming Encoder", 1, null, "under_review", "Livestream the closing pitches."],
    ["vendor_evening", "Truss Lighting Bar", 2, null, "under_review", "Stage wash for the pitches."],
    ["vendor_evening", "Marina Hall Sound System", 1, null, "under_review", "Already installed in the hall."],
  ];
  // SPM-48 test-case requests. Only `reserved` / `partially_fulfilled` rows hold
  // stock, so the events that HOLD equipment are marked below; every other row
  // is a request still under review that only asks.
  eqReqs.push(
    ["fx_town_hall", "Cordless Mic Set", 2, null, "under_review"],
    ["fx_keynote", "Podium Mic", 1, 1, "reserved"],
    ["fx_halloween", "Smoke Machine", 1, null, "requested"],
    ["fx_career_fair", "Cordless Mic Set", 3, null, "under_review"],
    ["fx_career_fair2", "Cordless Mic Set", 10, null, "under_review"],
    ["fx_prod_launch", "Tripod Screen", 4, null, "under_review"],
    ["fx_prod_launch2", "Tripod Screen", 5, null, "under_review"],
    ["fx_open_house", "PA Speaker", 2, 2, "reserved"],
    ["fx_orientation", "PA Speaker", 2, null, "under_review"],
    ["fx_sports_meet", "PA Speaker", 2, null, "under_review"],
    ["fx_faculty_day", "Follow Spot", 1, 1, "reserved"],
    ["fx_homecoming", "Follow Spot", 1, null, "under_review"],
    ["fx_board_meeting", "HD Projector", 2, 2, "reserved"],
    ["fx_investor_briefing", "HD Projector", 2, null, "under_review"],
    ["fx_year_end_gala", "HD Projector", 3, null, "under_review"],
    ["fx_staff_retreat", "HD Projector", 2, null, "under_review"],
    ["fx_board_meeting2", "HD Projector", 3, null, "under_review"],
    ["fx_open_day", "Conference Phone", 4, 2, "partially_fulfilled"],
    ["fx_alumni_mixer", "Conference Phone", 3, null, "under_review"],
    ["fx_cancelled_summit", "Presenter Tablet", 2, 2, "reserved"],
    ["fx_product_demo", "Presenter Tablet", 2, null, "under_review"],
    ["fx_gala_dinner", "Lighting Rig", 1, 1, "reserved"],
    ["fx_charity_concert", "Lighting Rig", 1, null, "under_review"],
    ["fx_school_concert", "Lighting Rig", 1, null, "under_review"],
    ["fx_wrap_up", "Lighting Rig", 1, 1, "reserved"],
    ["fx_setup_talk", "Lighting Rig", 1, null, "under_review"],
    ["fx_expo3", "Lighting Rig", 1, 1, "reserved"],
    ["fx_post_expo", "Lighting Rig", 1, null, "under_review"],
    ["fx_later_concert", "Lighting Rig", 1, null, "under_review"],
    ["fx_late_gala", "Lighting Rig", 1, 1, "reserved"],
    ["fx_wed_fair", "Lighting Rig", 1, null, "under_review"],
    ["fx_morning_ws", "Lighting Rig", 1, 1, "reserved"],
    ["fx_morning_ws", "Stage Wash Light", 1, 1, "reserved"],
    ["fx_evening_recital", "Lighting Rig", 1, null, "under_review"],
    ["fx_evening_recital", "Stage Wash Light", 1, null, "under_review"],
    ["fx_prod_showcase", "Follow Spot", 1, null, "under_review"],
    ["fx_welcome_assembly", "Marina Hall Sound System", 1, null, "under_review"],
    ["fx_planning_workshop", "Podium Mic", 1, null, "under_review"],
    ["fx_alumni_talk", "Document Camera", 3, null, "under_review"],
    ["fx_debate_finals", "Laser Pointer", 1, null, "requested"],
    ["fx_grad", "Cordless Mic Set", 2, null, "under_review"],
    ["fx_grad2", "Cordless Mic Set", 6, null, "under_review"],
    // SPM-49 test-case requests (Reserve Equipment). Most are left `under_review`
    // with nothing reserved yet - the test cases themselves call
    // POST .../reserve and check the result. Only the events a case needs to
    // find ALREADY holding stock (Fashion Show, Gala Night, Trade Mixer, Summit
    // Lunch, Reserved Showcase) are seeded pre-reserved.
    ["fx49_spring_fair", "Portable Stage", 3, null, "under_review"],
    ["fx49_founders_day", "Ring Light", 4, null, "under_review"],
    ["fx49_autumn_fair", "Portable Stage", 2, null, "under_review"],
    ["fx49_winter_fair", "Portable Stage", 2, null, "under_review"],
    ["fx49_harvest_fair", "Portable Stage", 2, null, "under_review"],
    ["fx49_summer_fair", "Portable Stage", 2, null, "under_review"],
    ["fx49_craft_market", "Portable Stage", 5, null, "under_review"],
    ["fx49_fashion_show", "Ring Light", 2, 2, "reserved"],
    ["fx49_after_party", "Ring Light", 1, null, "under_review"],
    ["fx49_product_demo_day", "Confidence Monitor", 3, null, "under_review"],
    ["fx49_partner_lunch", "Confidence Monitor", 2, null, "under_review"],
    ["fx49_sales_kickoff", "Confidence Monitor", 3, null, "under_review"],
    ["fx49_board_retreat", "Confidence Monitor", 2, null, "under_review"],
    ["fx49_trade_show", "Confidence Monitor", 3, null, "under_review"],
    ["fx49_media_briefing", "Confidence Monitor", 2, null, "under_review"],
    ["fx49_careers_day", "Confidence Monitor", 3, null, "under_review"],
    ["fx49_wrap_party", "Confidence Monitor", 2, null, "under_review"],
    ["fx49_innovation_day", "Confidence Monitor", 3, null, "under_review"],
    ["fx49_gala_night", "Podium Light", 3, 3, "reserved"],
    ["fx49_awards_dinner", "Podium Light", 2, null, "under_review"],
    ["fx49_popup_store", "Mobile Charging Cart", 1, null, "under_review"],
    ["fx49_flash_sale", "Mobile Charging Cart", 1, null, "under_review"],
    ["fx49_it_bootcamp", "Backup Laptop", 4, null, "under_review"],
    ["fx49_cancelled_roadshow", "Portable Stage", 2, null, "under_review"],
    ["fx49_trade_mixer", "Wireless Presenter", 4, 4, "reserved"],
    ["fx49_summit_lunch", "Mobile Charging Cart", 1, 1, "reserved"],
    ["fx49_product_expo", "Portable Stage", 2, null, "under_review"],
    ["fx49_product_expo", "Ring Light", 4, null, "under_review"],
    ["fx49_product_expo", "Mobile Charging Cart", 1, null, "under_review"],
    ["fx49_reserved_showcase", "Portable Stage", 3, 3, "reserved"],
  );
  // SPM-28 fixtures - same as scripts/seed-spm28.ts. "requested" never counts
  // against stock, so these change no other story's availability results.
  eqReqs.push(
    ["spm28_launch", "LED Video Wall Panel", 4, null, "requested"],
    ["spm28_launch", "Streaming Encoder", 1, null, "requested"],
    ["spm28_approve", "Handheld Wireless Mic", 2, null, "requested"],
  );
  // SPM-54 fixtures - same as scripts/seed-spm54.ts. Requested by the organiser.
  eqReqs.push(
    ["spm54_begin_save", "Handheld Wireless Mic", 2, null, "requested"],
    ["spm54_begin_remove", "Handheld Wireless Mic", 1, null, "requested"],
  );
  for (let i = 0; i < eqReqs.length; i++) {
    const [eventKey, eqName, requested, reserved, status, note] = eqReqs[i];
    const ev = events[eventKey];
    const seed = eventData.find((x) => x.key === eventKey)!;
    const reviewed = status !== "requested";
    await prisma.equipmentRequest.create({
      data: {
        eventId: ev.id,
        equipmentId: equip[eqName],
        quantityRequested: requested,
        quantityReserved: reserved ?? undefined,
        technicalRequirements: note,
        // Kit leaves the store early and comes back late.
        startsAt: new Date(ev.startsAt!.getTime() - 3 * 3_600_000),
        endsAt: new Date(ev.endsAt!.getTime() + 2 * 3_600_000),
        status,
        // SPM-54's items stand for what the organiser asked for on the request
        // form: on an Approved event the coordinator cannot have recorded
        // anything yet, since their first equipment action begins planning.
        requestedBy: eventKey.startsWith("spm54_")
          ? users[`organiser:${seed.organiser}`]
          : seed.coordinator ? users[seed.coordinator] : users["daniel.tan@connectsphere.com"],
        requestedAt: day(seed.days - 27),
        // SPM-49-TC20 is run as chloe.teo and needs a reservation someone
        // else made, so that one reviewer is fixed rather than rotated.
        reviewedBy: reviewed
          ? users[eventKey === "fx49_reserved_showcase" ? "kenji.sato@connectsphere.com" : techStaff[i % techStaff.length]]
          : undefined,
        reviewedAt: reviewed ? day(seed.days - 25) : undefined,
      },
    });
  }

  // -------------------------------------------------------------------
  // EVENT SESSIONS (SPM-48): a two-day event whose sessions each ask for the
  // same equipment, so availability is checked against each session's own date.
  // -------------------------------------------------------------------
  console.log("Creating event sessions…");
  const summit = events["fx_two_day_summit"];
  for (const [label, date] of [["Day 1", "2026-10-05"], ["Day 2", "2026-10-20"]] as const) {
    const startsAt = day(daysUntil(date), 9);
    const endsAt = day(daysUntil(date), 17);
    const session = await prisma.eventSession.create({
      data: { eventId: summit.id, label, startsAt, endsAt },
    });
    await prisma.equipmentRequest.create({
      data: {
        eventId: summit.id,
        sessionId: session.id,
        equipmentId: equip["PA Speaker"],
        quantityRequested: 2,
        technicalRequirements: `Speakers for ${label}.`,
        startsAt,
        endsAt,
        status: "under_review",
        requestedBy: users["daniel.tan@connectsphere.com"],
        requestedAt: day(summit.days - 27),
        reviewedBy: users[techStaff[0]],
        reviewedAt: day(summit.days - 25),
      },
    });
  }

  // SPM-49 (TC19): a second multi-session event, so a session-scoped
  // reservation is checked against its own session's dates, not the other
  // session's or the whole event's. Day 1 shares its date with Trade Mixer,
  // which already holds every Wireless Presenter; Day 2 is unrelated.
  const forum = events["fx49_two_day_forum"];
  for (const [label, date] of [["Day 1", "2027-06-07"], ["Day 2", "2027-06-21"]] as const) {
    const startsAt = day(daysUntil(date), 9);
    const endsAt = day(daysUntil(date), 17);
    const session = await prisma.eventSession.create({
      data: { eventId: forum.id, label, startsAt, endsAt },
    });
    await prisma.equipmentRequest.create({
      data: {
        eventId: forum.id,
        sessionId: session.id,
        equipmentId: equip["Wireless Presenter"],
        quantityRequested: 2,
        technicalRequirements: `Presenters for ${label}.`,
        startsAt,
        endsAt,
        status: "under_review",
        requestedBy: users["daniel.tan@connectsphere.com"],
        requestedAt: day(forum.days - 27),
        reviewedBy: users[techStaff[0]],
        reviewedAt: day(forum.days - 25),
      },
    });
  }

  // SPM-47 test cases (TC17, TC19, TC21): Pearl Delta Safety Conference split
  // into a morning and an afternoon session on its own day, with Audio Mixing
  // Desk already requested for the morning one. There is no in-app way to add
  // a session to an existing event, so the cases rely on these rows.
  const safety = events["planning_safety"];
  const safetySessions: Record<string, string> = {};
  for (const [label, from, to] of [["Morning briefing", 9, 12], ["Afternoon workshop", 13, 17]] as const) {
    const session = await prisma.eventSession.create({
      data: { eventId: safety.id, label, startsAt: day(safety.days, from), endsAt: day(safety.days, to) },
    });
    safetySessions[label] = session.id;
  }
  await prisma.equipmentRequest.create({
    data: {
      eventId: safety.id,
      sessionId: safetySessions["Morning briefing"],
      equipmentId: equip["Audio Mixing Desk"],
      quantityRequested: 1,
      technicalRequirements: "Mixing for the briefing panel.",
      startsAt: day(safety.days, 9),
      endsAt: day(safety.days, 12),
      status: "requested",
      requestedBy: users["huishan.neo@connectsphere.com"],
      requestedAt: day(safety.days - 20),
    },
  });

  // SPM-42 (TC08, TC09): one venue booking request per session, each on its
  // own date, time, attendance and layout. Same as scripts/seed-spm42.ts.
  const spm42Forum = events["spm42_three_sessions"];
  for (const [label, date, from, attendance, layout] of [
    ["Day 1", "2027-03-01", 9, 80, "theatre"],
    ["Day 2", "2027-03-02", 14, 30, "classroom"],
    ["Day 3", "2027-03-03", 19, 60, "banquet"],
  ] as const) {
    await prisma.eventSession.create({
      data: {
        eventId: spm42Forum.id, label,
        startsAt: day(daysUntil(date), from), endsAt: day(daysUntil(date), from + 3),
        expectedAttendance: attendance, preferredLayout: layout,
      },
    });
  }

  // -------------------------------------------------------------------
  // REGISTRATIONS
  // -------------------------------------------------------------------
  console.log("Creating registrations…");
  const dietary = [null, null, null, "Vegetarian", null, "No shellfish", null,
    "Halal", null, null, "Vegan", null, "No nuts", null, null];
  const access = [...new Array(12).fill(null),
    "Wheelchair user - please reserve a front space",
    "Requires a hearing loop receiver", null];

  let regCount = 0;
  for (const e of eventData) {
    if (!e.regEnabled || !e.regCapacity) continue;
    // SPM-30's fixtures carry no registrations, so a reseed matches what
    // `npm run fixtures:spm30` writes to the shared database.
    if (e.key.startsWith("spm30_")) continue;
    const ev = events[e.key];
    const past = e.days < 0;
    // A realistic fraction of capacity, capped by how many attendees exist.
    const n = Math.min(attendeeIds.length, Math.max(6, Math.floor(e.regCapacity * 0.22)));
    const offset = (e.title.length * 7) % attendeeIds.length;
    for (let j = 0; j < n; j++) {
      const attendeeId = attendeeIds[(offset + j) % attendeeIds.length];
      const status = past
        ? (j % 7 !== 0 ? "attended" : "registered")
        : (j % 9 === 0 ? "withdrawn" : "registered");
      await prisma.registration.create({
        data: {
          eventId: ev.id,
          attendeeId,
          status,
          registeredAt: day(e.days - 25 + (j % 15)),
          withdrawnAt: status === "withdrawn" ? day(e.days - 5) : undefined,
          dietaryRequirements: dietary[j % dietary.length] ?? undefined,
          accessibilityRequirements: access[j % access.length] ?? undefined,
        },
      });
      regCount++;
    }
  }

  // -------------------------------------------------------------------
  // CHANGE REQUESTS
  // -------------------------------------------------------------------
  console.log("Creating change requests…");
  await prisma.eventChangeRequest.create({
    data: {
      eventId: events["confirmed_forum"].id,
      requestedBy: users["organiser:James Koh"],
      requestedAt: day(-1),
      reason: "Stronger client uptake than forecast; we would like to open more places.",
      proposedAttendance: 180,
      isSignificant: true,
      status: "pending",
    },
  });
  await prisma.eventChangeRequest.create({
    data: {
      eventId: events["confirmed_briefing"].id,
      requestedBy: users["organiser:Melissa Yap"],
      requestedAt: day(-9),
      reason: "Our keynote speaker can no longer make the morning; please move to the afternoon.",
      proposedStartsAt: new Date(events["confirmed_briefing"].startsAt!.getTime() + 5 * 3_600_000),
      proposedEndsAt: new Date(events["confirmed_briefing"].endsAt!.getTime() + 5 * 3_600_000),
      isSignificant: true,
      status: "approved",
      reviewedBy: users["joel.fernandez@connectsphere.com"],
      reviewedAt: day(-7),
      reviewNotes: "Venue is free in the afternoon; booking amended and re-approved.",
    },
  });
  await prisma.eventChangeRequest.create({
    data: {
      eventId: events["confirmed_workshop"].id,
      requestedBy: users["organiser:Grace Abdullah"],
      requestedAt: day(-2),
      reason: "We may need to double the group size after a late partner school joined.",
      proposedAttendance: 110,
      isSignificant: true,
      status: "rejected",
      reviewedBy: users["arif.mansor@connectsphere.com"],
      reviewedAt: day(-1),
      reviewNotes: "Orchard Studio caps at 40 in classroom layout. Please raise a new request to move venue.",
    },
  });

  // -------------------------------------------------------------------
  // NOTIFICATIONS
  // -------------------------------------------------------------------
  console.log("Creating notifications…");
  const notifs: [string, string, string, string, string, boolean][] = [
    [users["grace.lim@connectsphere.com"], "event_submitted", "New event request",
      "Nusantara Developer Summit has been submitted and needs a coordinator.", events["submitted"].id, false],
    [users["grace.lim@connectsphere.com"], "event_submitted", "New event request",
      "Meridian Graduate Recruitment Evening has been submitted and needs a coordinator.", events["submitted_recruit"].id, false],
    [users["organiser:Faridah Aziz"], "clarification_requested", "Information needed",
      "Priya Raj has asked you to confirm the headcount for your offsite.", events["under_review"].id, false],
    [users["organiser:Sari Widodo"], "clarification_requested", "Information needed",
      "Please clarify the livestream requirement for your product launch.", events["review_launch"].id, false],
    [users["daniel.tan@connectsphere.com"], "booking_approved", "Venue approved",
      "Marina Grand Hall is confirmed for the Straits Medical Research Symposium.", events["planning"].id, true],
    [users["daniel.tan@connectsphere.com"], "booking_rejected", "Venue request declined",
      "Marina Auditorium cannot support parallel tracks; please choose another venue.", events["submitted"].id, false],
    [users["organiser:Evelyn Chen"], "event_confirmed", "Your event is confirmed",
      "All essential arrangements for your symposium are in place.", events["planning"].id, false],
    [users["daniel.tan@connectsphere.com"], "change_requested", "Change request received",
      "Meridian have asked to raise capacity from 150 to 180.", events["confirmed_forum"].id, false],
    [users["organiser:Melissa Yap"], "change_decided", "Change approved",
      "Your briefing has been moved to the afternoon and the venue re-approved.", events["confirmed_briefing"].id, true],
    [users["organiser:Grace Abdullah"], "change_decided", "Change not approved",
      "Orchard Studio caps at 40 in classroom layout; please raise a new venue request.", events["confirmed_workshop"].id, false],
    [users["organiser:Budi Santoso"], "event_rejected", "Request not approved",
      "Your overnight hackathon request could not be accepted.", events["rejected"].id, true],
    [users["kenji.sato@connectsphere.com"], "equipment_unavailable", "Equipment not available",
      "All streaming encoders are committed that week; the product launch request needs review.", events["review_launch"].id, false],
    [users["organiser:Samuel Ong"], "event_cancelled", "Event cancelled",
      "Pearl Delta Supplier Forum has been cancelled and its room released.", events["cancelled"].id, true],
    [users["priya.raj@connectsphere.com"], "booking_needs_review", "Booking needs review",
      "Jurong Training Room (JUR-TRN): the booked layout no longer seats the expected attendance. " +
      "The approved booking for Harbourline Claims Systems Training is flagged for review - " +
      "nothing has been changed automatically.", events["confirmed_claims"].id, false],
  ];
  for (const [recipientId, type, title, body, eventId, isRead] of notifs) {
    await prisma.notification.create({
      data: { recipientId, type, title, body, eventId, isRead },
    });
  }

  // -------------------------------------------------------------------
  console.log("\nDone.");
  console.log(`  organisations : ${orgData.length}`);
  console.log(`  users         : ${staff.length + organisers.length + attendeeNames.length}`);
  console.log(`  venues        : ${venueData.length}`);
  console.log(`  facilities    : ${facilityData.length}`);
  console.log(`  equipment     : ${Object.keys(equip).length}`);
  console.log(`  events        : ${eventData.length}`);
  console.log(`  bookings      : ${bookings.length}`);
  console.log(`  eq. requests  : ${eqReqs.length}`);
  console.log(`  registrations : ${regCount}`);
  console.log(`  notifications : ${notifs.length}`);
  console.log(`\nEvery account's password is: ${DEMO_PASSWORD}`);
  console.log("Log in as  daniel.tan@connectsphere.com  (coordinator)");
  console.log("       or  rachel.ng@meridianfina.com  (organiser)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
