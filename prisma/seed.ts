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
    // SPM-85 (Week 7 change #6). Same account as scripts/seed-spm85.ts.
    ["Hana Yusof", "hana.yusof", "safety_officer", "Safety & Compliance"],
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

  // SPM-71 (View Notifications) test accounts - the same four as
  // scripts/seed-spm71.ts, which also gives them their notifications. Kept out
  // of attendeeIds on purpose: its length decides which attendee the base seed
  // registers for which event, so adding to it would reshuffle every story's
  // registrations.
  const spm71Accounts: [string, string, string, string | null][] = [
    ["Leon Koh", "leon.koh@connectsphere.com", "coordinator", "Event Management"],
    ["Ivy Lim", "ivy.lim@connectsphere.com", "coordinator", "Event Management"],
    ["Owen Teo", "owen.teo@connectsphere.com", "venue_staff", "Venue Operations"],
    ["Zara Ong", "zara.ong@example.com", "attendee", null],
  ];
  for (const [fullName, email, role, department] of spm71Accounts) {
    const u = await prisma.user.create({ data: { email, passwordHash, fullName, role, department } });
    users[email] = u.id;
  }

  // SPM-84 (Event Coordinator Lead) coordinator accounts - the same four as
  // scripts/seed-spm84.ts. Dennis Ho is deactivated but still holds an event.
  const spm84Accounts: [string, string, boolean][] = [
    ["Aisha Karim", "aisha.karim@connectsphere.com", true],
    ["Benjamin Lau", "benjamin.lau@connectsphere.com", true],
    ["Clara Tay", "clara.tay@connectsphere.com", true],
    ["Dennis Ho", "dennis.ho@connectsphere.com", false],
  ];
  for (const [fullName, email, isActive] of spm84Accounts) {
    const u = await prisma.user.create({
      data: { email, passwordHash, fullName, role: "coordinator", department: "Event Management", isActive },
    });
    users[email] = u.id;
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
      setupMinutes: 30, teardownMinutes: 15, // SPM-93: was 20, rounded up to a 15-minute step
      layouts: [["boardroom", 20], ["u_shape", 14]],
      facilities: ["High-density WiFi", "Fixed ceiling projector", "Video conferencing suite",
        "Natural light", "Step-free access", "Accessible toilet"] },
    { code: "CBP-MTG2", name: "Changi Meeting Room 2", description: "Standard meeting room, adjacent to Room 1",
      building: "Changi Business Park", floor: "L3", maxCapacity: 20, opensAt: "08:00", closesAt: "20:00",
      setupMinutes: 30, teardownMinutes: 15, // SPM-93: was 20, rounded up to a 15-minute step
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
    // SPM-43 fixtures (scripts/seed-spm43.ts): a room with one maintenance
    // period (SPM-43-TC13) and a room the tester retires and restores
    // (SPM-43-TC14) - dedicated, so neither touches another story's bookings.
    { code: "SPM43-MNT", name: "SPM43 Maintenance Room", description: "SPM-43 test venue: closed for maintenance on 14 May 2027",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
    { code: "SPM43-RET", name: "SPM43 Retire Test Room", description: "SPM-43 test venue: retired and restored by SPM-43-TC14",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
    // SPM-44 fixture (scripts/seed-spm44.ts, PLAIN_ROOM there - keep in step):
    // no setup or turnaround, so a booking holds exactly the slots asked for.
    { code: "SPM44-PLN", name: "SPM44 Conflict Room", description: "SPM-44 test venue: no setup or turnaround, so slots are exact",
      building: "Orchard Hub", floor: "L2", maxCapacity: 60, opensAt: "07:00", closesAt: "24:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 60], ["theatre", 60]],
      facilities: [] },
    // SPM-93 fixtures (scripts/seed-spm93.ts): the Week 7 example room (30 min
    // setup, 45 min turnaround), a room needing neither, and a room whose
    // minutes SPM-93-TC07 edits - dedicated, so the cases' bookings meet no one else's.
    { code: "SPM93-STU", name: "SPM93 Studio", description: "SPM-93 test venue: 30 min setup, 45 min turnaround",
      building: "Orchard Hub", floor: "L2", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 30, teardownMinutes: 45,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    { code: "SPM93-QCK", name: "SPM93 Quick Room", description: "SPM-93 test venue: no setup or turnaround",
      building: "Orchard Hub", floor: "L2", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    { code: "SPM93-SET", name: "SPM93 Settings Room", description: "SPM-93 test venue: setup and turnaround edited by SPM-93-TC07",
      building: "Orchard Hub", floor: "L2", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 30, teardownMinutes: 45,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    // SPM-45 fixtures (scripts/seed-spm45.ts): six rooms Venue Staff mark
    // unavailable - dedicated, so doing so flags no other story's bookings.
    // Only SPM45-SET has setup and turnaround time (the Week 7 example's).
    { code: "SPM45-DAT", name: "SPM45 Dates Room", description: "SPM-45 test venue: no unavailable period, no bookings",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
    { code: "SPM45-PER", name: "SPM45 Period Room", description: "SPM-45 test venue: four bookings around 10-15 Jun 2027",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
    { code: "SPM45-SET", name: "SPM45 Setup Room", description: "SPM-45 test venue: 30 min setup, 45 min turnaround",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 30, teardownMinutes: 45,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
    { code: "SPM45-STA", name: "SPM45 Status Room", description: "SPM-45 test venue: an approved, a pending and a finished booking",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
    { code: "SPM45-NOW", name: "SPM45 Closure Room", description: "SPM-45 test venue: unavailable from 1 Oct 2026 to 1 Dec 2028, 09:00",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
    { code: "SPM45-BAK", name: "SPM45 Reopened Room", description: "SPM-45 test venue: was unavailable 1 Sep to 1 Oct 2026, 12:00",
      building: "Orchard Hub", floor: "L1", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [] },
    // SPM-81 fixtures (scripts/seed-spm81.ts): a main room and two breakout
    // rooms, so one event can ask for several - dedicated, so the cases'
    // bookings meet no one else's.
    { code: "SPM81-AUD", name: "SPM81 Auditorium", description: "SPM-81 test venue: the main room, 30 min setup and turnaround",
      building: "Orchard Hub", floor: "L3", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 30, teardownMinutes: 30,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    { code: "SPM81-BRA", name: "SPM81 Breakout Room A", description: "SPM-81 test venue: breakout room, no setup or turnaround",
      building: "Orchard Hub", floor: "L3", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    { code: "SPM81-BRB", name: "SPM81 Breakout Room B", description: "SPM-81 test venue: breakout room, unavailable on 10 Aug 2027 (SPM-81-TC03)",
      building: "Orchard Hub", floor: "L3", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    // SPM-67 fixtures (scripts/seed-spm67.ts): a room with setup and
    // turnaround, and two without - dedicated, so the bookings the cases
    // withdraw, release and request meet no one else's.
    { code: "SPM67-HAL", name: "SPM67 Hall", description: "SPM-67 test venue: 30 min setup and turnaround",
      building: "Orchard Hub", floor: "L4", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 30, teardownMinutes: 30,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    { code: "SPM67-STU", name: "SPM67 Studio", description: "SPM-67 test venue: no setup or turnaround",
      building: "Orchard Hub", floor: "L4", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    { code: "SPM67-ANX", name: "SPM67 Annex", description: "SPM-67 test venue: no setup or turnaround",
      building: "Orchard Hub", floor: "L4", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", 60], ["classroom", 40]],
      facilities: [] },
    // SPM-90 fixtures (scripts/seed-spm90.ts): a hall that seats the whole
    // event, a breakout room that only suits a smaller space, and an annexe
    // without the step-free access every SPM90 event requires.
    { code: "SPM90-HALL", name: "SPM90 Main Hall", description: "SPM-90 test venue: seats the whole event",
      building: "Orchard Hub", floor: "L5", maxCapacity: 200, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", 200], ["classroom", 120]],
      facilities: ["Step-free access"] },
    { code: "SPM90-BRK", name: "SPM90 Breakout Room", description: "SPM-90 test venue: suits a breakout space, not the whole event",
      building: "Orchard Hub", floor: "L5", maxCapacity: 30, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", 30], ["classroom", 20]],
      facilities: ["Step-free access"] },
    { code: "SPM90-ANX", name: "SPM90 Annexe", description: "SPM-90 test venue: no step-free access",
      building: "Orchard Hub", floor: "L5", maxCapacity: 30, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", 30], ["classroom", 20]],
      facilities: [] },
    // SPM-68 fixtures (scripts/seed-spm68.ts): rooms of different sizes for
    // the flagged bookings and their replacement - dedicated, so the live
    // availability the cases quote depends on no one else's bookings. The
    // script also retires the Retired Room and gives the Closed Room its
    // unavailable period; here they are plain rooms.
    ...([
      ["SPM68-HAL", "SPM68 Hall", "seats 100 in theatre layout", 100],
      ["SPM68-ANX", "SPM68 Annex", "seats 60 in theatre layout", 60],
      ["SPM68-SPR", "SPM68 Spare Room", "the replacement, seats 200 in theatre layout", 200],
      ["SPM68-CLS", "SPM68 Closed Room", "unavailable for maintenance on 9 Oct 2027, 08:00-18:00", 60],
      ["SPM68-RET", "SPM68 Retired Room", "retired", 60],
    ] as const).map(([code, name, what, theatre]): VenueSeed => ({
      code, name, description: `SPM-68 test venue: ${what}`,
      building: "Orchard Hub", floor: "L5", maxCapacity: theatre, opensAt: "07:00", closesAt: "22:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["theatre", theatre], ["classroom", 40]],
      facilities: ["Fixed ceiling projector", "Step-free access"],
    })),
    // SPM-82 fixture (scripts/seed-spm82.ts, HOLD_ROOM there - keep in step):
    // 60 minutes of setup and of turnaround, so a lapsed hold's freed time
    // visibly includes them (SPM-82-TC10).
    { code: "SPM82-HOLD", name: "SPM82 Hold Room", description: "SPM-82 test venue: 60 minutes of setup and of turnaround",
      building: "Orchard Hub", floor: "L3", maxCapacity: 80, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 60, teardownMinutes: 60,
      layouts: [["theatre", 80], ["classroom", 40]],
      facilities: [] },
    // SPM-80 fixtures (scripts/seed-spm80.ts - keep in step): four rooms with
    // no setup or turnaround, whose times the cases change.
    ...([
      ["SPM80-TRN", "SPM80 Turnaround Room", "bookings half an hour apart on 3 Aug 2027"],
      ["SPM80-SET", "SPM80 Setup Room", "an approved booking and a pending request on 4 Aug 2027"],
      ["SPM80-MNT", "SPM80 Maintenance Room", "maintenance on 5 Aug 2027, 14:00-16:00"],
      ["SPM80-REQ", "SPM80 Request Room", "an approved booking on 6 Aug 2027, 10:00-12:00"],
    ] as const).map(([code, name, what]): VenueSeed => ({
      code, name, description: `SPM-80 test venue: ${what}`,
      building: "Orchard Hub", floor: "L6", maxCapacity: 40, opensAt: "07:00", closesAt: "23:00",
      setupMinutes: 0, teardownMinutes: 0,
      layouts: [["classroom", 40], ["theatre", 40]],
      facilities: [],
    })),
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
    /// Minutes past startHour - day() truncates a fractional hour. SPM-93's
    /// off-grid events (14:10, 09:05) need it; everything else starts on the hour.
    startMinute?: number;
    attendance?: number; layout?: string; regEnabled?: boolean; regCapacity?: number;
    accessibilityNotes?: string; rejectionReason?: string; cancellationReason?: string;
    specialRequirements?: string;
    /// Overrides CHAIN[status] - SPM-27's events carry their own history.
    chain?: string[];
    /// Overrides REASONS for this event's history, by the status moved to -
    /// so a fixture's history can say what its own script says (SPM-59).
    historyReasons?: Partial<Record<string, string>>;
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
    // Equipment. In Planning - Technical Support only sees and reserves an
    // event's equipment once the Coordinator has started planning (BPMN). Several of these are reserved by an actual call to
    // POST .../reserve while running the cases, not seeded already-reserved -
    // only the events that need to already HOLD stock before the case starts
    // (Fashion Show, Gala Night, Trade Mixer, Summit Lunch, Reserved Showcase)
    // are seeded with a reservation below.
    fixture("fx49_spring_fair", "Spring Fair", "2027-02-02", 9, 6, "Rachel Ng"),
    fixture("fx49_founders_day", "Founders Day", "2027-02-04", 9, 6, "James Koh"),
    fixture("fx49_autumn_fair", "Autumn Fair", "2027-02-09", 9, 6, "Melissa Yap"),
    fixture("fx49_winter_fair", "Winter Fair", "2027-02-16", 9, 6, "Kelvin Loh"),
    fixture("fx49_harvest_fair", "Harvest Fair", "2027-03-02", 9, 6, "Samuel Ong"),
    fixture("fx49_summer_fair", "Summer Fair", "2027-03-09", 9, 6, "Faridah Aziz"),
    fixture("fx49_craft_market", "Craft Market", "2027-03-16", 9, 6, "Grace Abdullah"),
    fixture("fx49_fashion_show", "Fashion Show", "2027-03-23", 14, 6, "Evelyn Chen"),
    fixture("fx49_after_party", "After Party", "2027-03-23", 20, 3, "Hakim Zulkifli"),
    fixture("fx49_product_demo_day", "Product Demo Day", "2027-03-15", 10, 4, "Budi Santoso"),
    fixture("fx49_partner_lunch", "Partner Lunch", "2027-03-15", 11, 2, "Rachel Ng"),
    fixture("fx49_sales_kickoff", "Sales Kickoff", "2027-04-05", 9, 6, "James Koh"),
    fixture("fx49_board_retreat", "Board Retreat", "2027-04-26", 9, 6, "Melissa Yap"),
    fixture("fx49_trade_show", "Trade Show", "2027-04-12", 9, 6, "Kelvin Loh"),
    fixture("fx49_media_briefing", "Media Briefing", "2027-04-13", 9, 6, "Samuel Ong"),
    fixture("fx49_careers_day", "Careers Day", "2027-04-19", 9, 6, "Faridah Aziz"),
    fixture("fx49_wrap_party", "Wrap Party", "2027-04-21", 18, 3, "Grace Abdullah"),
    fixture("fx49_innovation_day", "Innovation Day", "2027-05-03", 9, 6, "Evelyn Chen"),
    fixture("fx49_gala_night", "Gala Night", "2027-05-10", 18, 4, "Hakim Zulkifli"),
    fixture("fx49_awards_dinner", "Awards Dinner", "2027-05-10", 19, 4, "Budi Santoso"),
    fixture("fx49_popup_store", "Pop-up Store", "2027-05-17", 9, 6, "Rachel Ng"),
    fixture("fx49_flash_sale", "Flash Sale", "2027-05-17", 9, 6, "James Koh"),
    fixture("fx49_it_bootcamp", "IT Bootcamp", "2027-05-24", 9, 6, "Melissa Yap"),
    fixture("fx49_cancelled_roadshow", "Cancelled Roadshow", "2027-06-01", 9, 6, "Kelvin Loh",
      { status: "cancelled", cancellationReason: "Client withdrew the request." }),
    fixture("fx49_trade_mixer", "Trade Mixer", "2027-06-07", 18, 3, "Samuel Ong"),
    // Runs its Day 1 session on the same date Trade Mixer holds all the stock,
    // and Day 2 three weeks later - sessions created further down.
    fixture("fx49_two_day_forum", "Two-Day Forum", "2027-06-07", 9, 368, "Faridah Aziz"),
    fixture("fx49_summit_lunch", "Summit Lunch", "2027-06-14", 12, 2, "Grace Abdullah"),
    fixture("fx49_product_expo", "Product Expo", "2027-06-14", 9, 6, "Evelyn Chen"),
    fixture("fx49_reserved_showcase", "Reserved Showcase", "2027-07-05", 9, 6, "Rachel Ng"),
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
  // After SPM-54, whose events are pinned to EVT-000145..154.
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

  // -----------------------------------------------------------------
  // SPM-50 QA fixtures (Review and Update Equipment Request). The SAME events
  // and equipment lines as scripts/seed-spm50.ts (`npm run fixtures:spm50`) -
  // keep the two in step. In August 2027, clear of every SPM-49 event, so
  // their SPM-49 equipment items show the numbers the SPM-50 cases expect.
  // Their equipment lines are created further down (spm50Requests).
  // Pushed LAST - after SPM-54 (whose events are pinned to EVT-000145..154)
  // and SPM-27 - so no earlier event's EVT- reference number shifts. Add
  // new events AFTER this block.
  // -----------------------------------------------------------------
  eventData.push(
    fixture("spm50_robotics_expo", "Robotics Expo", "2027-08-02", 9, 6, "Rachel Ng"),
    fixture("spm50_design_week", "Design Week", "2027-08-16", 9, 6, "Melissa Yap"),
    fixture("spm50_charity_briefing", "Charity Briefing", "2027-08-23", 9, 3, "Evelyn Chen"),
    fixture("spm50_charity_gala", "Charity Gala", "2027-08-23", 10, 4, "Hakim Zulkifli"),
    // Confirmed: Technical Support still sees its equipment (to prepare it) but
    // cannot change it.
    fixture("spm50_confirmed_launch", "Confirmed Launch", "2027-08-30", 9, 6, "Budi Santoso", { status: "confirmed" }),
    // Not in Planning yet, so Technical Support does not see their equipment.
    fixture("spm50_pending_showcase", "Pending Showcase", "2027-09-06", 9, 6, "Samuel Ong", { status: "under_review" }),
    fixture("spm50_approved_briefing", "Approved Briefing", "2027-09-13", 9, 3, "Kelvin Loh", { status: "approved" }),
  );

  // -----------------------------------------------------------------
  // SPM-43 QA fixtures (Review Venue Booking Request). The SAME events as
  // scripts/seed-spm43.ts (`npm run fixtures:spm43`) - keep the two in step.
  // Their sessions, booking requests and the maintenance period are created
  // further down.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm43 = (
    key: string, title: string, date: string, startHour: number, durationHours: number,
    attendance: number, layout: string, options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com", status: "planning",
    purpose: "SPM-43 venue booking review test event", category: "meeting",
    days: daysUntil(date), startHour, durationHours, attendance, layout, ...options,
  });
  eventData.push(
    spm43("spm43_approve", "SPM43 Leadership Offsite", "2027-05-04", 9, 8, 100, "theatre"),
    spm43("spm43_reject", "SPM43 Product Briefing", "2027-05-05", 14, 3, 150, "theatre"),
    spm43("spm43_suggest", "SPM43 Awards Dinner", "2027-05-06", 19, 3, 80, "banquet"),
    spm43("spm43_arrangement", "SPM43 Investor Update", "2027-05-08", 14, 2, 90, "theatre"),
    spm43("spm43_confirmed", "SPM43 Board Strategy Day", "2027-05-07", 9, 8, 120, "theatre"),
    spm43("spm43_turnaround", "SPM43 Evening Recital", "2027-05-07", 19, 3, 200, "theatre"),
    spm43("spm43_rival_a", "SPM43 Design Workshop", "2027-05-10", 14, 3, 30, "classroom"),
    spm43("spm43_rival_b", "SPM43 Coding Workshop", "2027-05-10", 13, 4, 24, "classroom"),
    spm43("spm43_sessions", "SPM43 Two-Day Forum", "2027-05-11", 9, 32, 60, "theatre"),
    spm43("spm43_cancelled_event", "SPM43 Cancelled Launch", "2027-05-13", 9, 8, 140, "theatre",
      { status: "cancelled", cancellationReason: "Client withdrew the launch" }),
    spm43("spm43_maintenance", "SPM43 Staff Briefing", "2027-05-14", 9, 2, 30, "classroom"),
    spm43("spm43_retire", "SPM43 Team Retrospective", "2027-05-17", 14, 2, 20, "classroom"),
    spm43("spm43_under_review", "SPM43 Policy Briefing", "2027-05-18", 9, 3, 30, "classroom", { status: "under_review" }),
    spm43("spm43_after_turnaround", "SPM43 Alumni Lecture", "2027-05-08", 14, 3, 150, "theatre"),
  );

  // -----------------------------------------------------------------
  // SPM-62 QA fixtures (Update Event Information). The SAME events as
  // scripts/seed-spm62.ts (`npm run fixtures:spm62`) - keep the two in step.
  //
  // The events only. Their venue bookings, reserved equipment, registrations
  // and required facility are created by that script alone, so run it once
  // after a full reseed or there is nothing for a change to flag.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm62 = (
    key: string, title: string, status: string, organiser: string, date: string,
    startHour: number, durationHours: number, attendance: number, layout: string,
    options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, status, organiser, coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-62 update event information test event", category: "conference",
    days: daysUntil(date), startHour, durationHours, attendance, layout, ...options,
  });
  eventData.push(
    spm62("spm62_harbour", "SPM62 Harbour Leadership Summit", "planning", "Evelyn Chen", "2027-03-17", 9, 8, 80, "theatre",
      { regEnabled: true, regCapacity: 100 }),
    spm62("spm62_kirana", "SPM62 Kirana Supplier Day", "planning", "Faridah Aziz", "2027-04-21", 10, 6, 60, "theatre",
      { regEnabled: true, regCapacity: 50 }),
    spm62("spm62_bayu", "SPM62 Bayu Energy Outlook", "approved", "Hakim Zulkifli", "2027-05-12", 9, 3, 40, "theatre",
      { category: "seminar" }),
    spm62("spm62_anchorpoint", "SPM62 Anchorpoint Logistics Forum", "approved", "Melissa Yap", "2027-05-18", 9, 3, 50, "theatre",
      { category: "seminar" }),
    spm62("spm62_pharmacy", "SPM62 Straits Pharmacy Forum", "confirmed", "Evelyn Chen", "2027-06-09", 9, 8, 120, "theatre",
      { regEnabled: true, regCapacity: 150 }),
    spm62("spm62_meridian", "SPM62 Meridian Quarterly Review", "confirmed", "James Koh", "2027-06-16", 14, 3, 30, "boardroom",
      { category: "meeting" }),
    spm62("spm62_sundara", "SPM62 Sundara Hospitality Showcase", "confirmed", "Dewi Kartika", "2027-06-23", 10, 8, 70, "exhibition",
      { category: "exhibition" }),
    spm62("spm62_civic", "SPM62 Civic Learning Day", "under_review", "Grace Abdullah", "2027-07-07", 9, 6, 60, "classroom",
      { category: "training" }),
    spm62("spm62_pearl", "SPM62 Pearl Delta Plant Tour", "completed", "Samuel Ong", "2026-09-10", 9, 4, 25, "theatre",
      { category: "networking" }),
  );

  // -----------------------------------------------------------------
  // SPM-44 QA fixtures (Booking Conflict Detection). The SAME events as
  // scripts/seed-spm44.ts (`npm run fixtures:spm44`) - keep the two in step.
  //
  // The SPM44-PLN room is in venueData above, and the bookings these events
  // hold plus the room's maintenance period (AC8) are created after the SPM-43
  // bookings below, so a full reseed leaves the conflict cases ready to run.
  // Pushed LAST - after SPM-54 (pinned to EVT-000145..154), SPM-62 and every
  // other story's fixtures - so no earlier event's EVT- reference number shifts.
  // SPM-64's block follows.
  // -----------------------------------------------------------------
  const spm44 = (
    key: string, title: string, date: string, startHour: number, durationHours: number,
    options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com", status: "planning",
    purpose: "SPM-44 booking conflict test event", category: "meeting",
    days: daysUntil(date), startHour, durationHours, attendance: 30, layout: "classroom", ...options,
  });
  const PRIYA = "priya.raj@connectsphere.com";
  eventData.push(
    spm44("spm44_holder_approved", "SPM44 Approved Holder", "2027-04-05", 14, 2, { coordinator: PRIYA }),
    spm44("spm44_clash_approved", "SPM44 Clash With Approved", "2027-04-05", 14, 2),
    spm44("spm44_adjacent", "SPM44 Adjacent Slot", "2027-04-05", 9, 2),
    spm44("spm44_holder_pending", "SPM44 Pending Holder", "2027-04-06", 14, 2, { coordinator: PRIYA }),
    spm44("spm44_clash_pending", "SPM44 Clash With Pending", "2027-04-06", 14, 2),
    spm44("spm44_holder_rejected", "SPM44 Rejected Holder", "2027-04-07", 14, 2, { coordinator: PRIYA }),
    spm44("spm44_after_rejected", "SPM44 After Rejected", "2027-04-07", 14, 2),
    spm44("spm44_holder_cancelled", "SPM44 Cancelled Holder", "2027-04-08", 14, 2, { coordinator: PRIYA }),
    spm44("spm44_after_cancelled", "SPM44 After Cancelled", "2027-04-08", 14, 2),
    spm44("spm44_setup_holder", "SPM44 Setup Holder", "2027-04-09", 14, 2,
      { coordinator: PRIYA, attendance: 40, layout: "theatre" }),
    spm44("spm44_setup_clash", "SPM44 Setup Clash", "2027-04-09", 9, 2, { attendance: 40, layout: "theatre" }),
    spm44("spm44_midnight_holder", "SPM44 Midnight Holder", "2027-04-12", 20, 2,
      { coordinator: PRIYA, attendance: 40, layout: "theatre" }),
    spm44("spm44_midnight_clash", "SPM44 Midnight Clash", "2027-04-13", 9, 2,
      { attendance: 40, layout: "theatre" }),
    spm44("spm44_approval_holder", "SPM44 Approval Holder", "2027-04-25", 14, 2, { coordinator: PRIYA }),
    spm44("spm44_approval_rival", "SPM44 Approval Rival", "2027-04-25", 14, 2),
    spm44("spm44_blocked", "SPM44 Blocked Room", "2027-04-20", 9, 2),
  );

  // -----------------------------------------------------------------
  // SPM-93 QA fixtures (Book Venues in 15-Minute Units). The SAME events as
  // scripts/seed-spm93.ts (`npm run fixtures:spm93`) - keep the two in step.
  //
  // The events only. Their bookings, the Two-Day Forum's sessions and SPM93
  // Studio's maintenance period are created by that script alone, so run it
  // once after a full reseed.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm93 = (key: string, title: string, date: string, from: string, to: string): EventSeed => {
    const [startHour, startMinute] = from.split(":").map(Number);
    const [endHour, endMinute] = to.split(":").map(Number);
    return {
      key, title, status: "planning", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
      purpose: "SPM-93 venue booking in 15-minute units test event", category: "meeting",
      days: daysUntil(date), startHour, startMinute,
      durationHours: (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60,
      attendance: 30, layout: "theatre",
    };
  };
  eventData.push(
    spm93("spm93_masterclass", "SPM93 Morning Masterclass", "2027-06-08", "10:00", "12:00"),
    spm93("spm93_quick_demo", "SPM93 Quick Demo", "2027-06-08", "10:00", "12:00"),
    spm93("spm93_early_huddle", "SPM93 Early Huddle", "2027-06-08", "08:15", "08:45"),
    spm93("spm93_afternoon_review", "SPM93 Afternoon Review", "2027-06-08", "13:15", "14:00"),
    spm93("spm93_follow_on", "SPM93 Follow-on Session", "2027-06-08", "12:00", "13:00"),
    spm93("spm93_product_clinic", "SPM93 Product Clinic", "2027-06-09", "14:10", "15:50"),
    spm93("spm93_partner_lunch", "SPM93 Partner Lunch", "2027-06-10", "12:00", "13:00"),
    spm93("spm93_team_sync", "SPM93 Team Sync", "2027-06-10", "14:15", "15:00"),
    spm93("spm93_validation", "SPM93 Validation Workshop", "2027-06-11", "10:00", "12:00"),
    spm93("spm93_breakfast", "SPM93 Breakfast Briefing", "2027-06-13", "07:30", "09:00"),
    spm93("spm93_evening_forum", "SPM93 Evening Forum", "2027-06-13", "20:00", "21:15"),
    spm93("spm93_lunch_and_learn", "SPM93 Lunch and Learn", "2027-06-14", "12:00", "13:00"),
    spm93("spm93_sunset_talk", "SPM93 Sunset Talk", "2027-06-14", "18:00", "19:00"),
    spm93("spm93_supplier_day", "SPM93 Supplier Day", "2027-06-15", "10:00", "12:00"),
    spm93("spm93_vendor_qa", "SPM93 Vendor Q&A", "2027-06-15", "13:00", "14:00"),
    spm93("spm93_buyer_briefing", "SPM93 Buyer Briefing", "2027-06-15", "13:15", "14:00"),
    spm93("spm93_twilight_workshop", "SPM93 Twilight Workshop", "2027-06-16", "18:30", "20:00"),
    // Runs from Day 1's start (17 Jun 09:05) to Day 2's end (18 Jun 17:30).
    { ...spm93("spm93_two_day_forum", "SPM93 Two-Day Forum", "2027-06-17", "09:05", "17:30"), durationHours: 32 + 25 / 60 },
  );

  // -----------------------------------------------------------------
  // SPM-86 QA fixtures (Submit Event for Operational Safety Check). The SAME
  // events as scripts/seed-spm86.ts (`npm run fixtures:spm86`) - keep the two
  // in step.
  //
  // The events only. Their venue bookings, equipment and review flags are
  // created by that script alone, so run it once after a full reseed.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm86 = (key: string, title: string, date: string, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status: "planning", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-86 submit for safety check test event", category: "meeting",
    days: daysUntil(date), startHour: 9, durationHours: 4, attendance: 40, layout: "theatre", ...options,
  });
  eventData.push(
    spm86("spm86_ready", "SPM86 Harbour Safety Ready", "2027-07-19"),
    spm86("spm86_partial", "SPM86 Partly Reserved Kit", "2027-07-20"),
    spm86("spm86_outstanding", "SPM86 Arrangements Outstanding", "2027-07-21"),
    spm86("spm86_flagged_venue", "SPM86 Flagged Venue Booking", "2027-07-22"),
    spm86("spm86_flagged_equipment", "SPM86 Flagged Equipment", "2027-07-23"),
    spm86("spm86_two_tabs", "SPM86 Two Tabs Submit", "2027-07-26"),
    spm86("spm86_other_coordinator", "SPM86 Another Coordinator", "2027-07-27",
      { coordinator: "priya.raj@connectsphere.com" }),
    spm86("spm86_approved", "SPM86 Not Yet Planning", "2027-07-28", { status: "approved" }),
  );

  // -----------------------------------------------------------------
  // SPM-45 QA fixtures (Record Venue Unavailability). The SAME events as
  // scripts/seed-spm45.ts (`npm run fixtures:spm45`) - keep the two in step.
  // Their approved bookings and the two unavailable periods are created
  // further down.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm45 = (key: string, title: string, date: string, from: string, to: string, options: Partial<EventSeed> = {}): EventSeed => {
    const [startHour, startMinute] = from.split(":").map(Number);
    const [endHour, endMinute] = to.split(":").map(Number);
    return {
      key, title, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com", status: "planning",
      purpose: "SPM-45 venue unavailability test event", category: "meeting",
      days: daysUntil(date), startHour, startMinute,
      durationHours: (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60,
      attendance: 30, layout: "classroom", ...options,
    };
  };
  eventData.push(
    spm45("spm45_before", "SPM45 Morning Briefing", "2027-06-10", "11:00", "13:00"),
    spm45("spm45_first", "SPM45 Afternoon Workshop", "2027-06-10", "13:00", "15:00"),
    spm45("spm45_last", "SPM45 Closing Seminar", "2027-06-15", "10:00", "13:00"),
    spm45("spm45_after", "SPM45 Return Forum", "2027-06-15", "13:00", "15:00"),
    spm45("spm45_turnaround", "SPM45 Early Talk", "2027-06-21", "07:30", "08:30"),
    spm45("spm45_setup", "SPM45 Later Talk", "2027-06-22", "13:30", "14:30"),
    spm45("spm45_approved", "SPM45 Approved Review", "2027-07-05", "09:00", "12:00"),
    spm45("spm45_pending", "SPM45 Pending Request", "2027-07-05", "14:00", "17:00"),
    spm45("spm45_finished", "SPM45 Finished Meeting", "2026-09-15", "09:00", "12:00", { status: "completed" }),
  );

  // -----------------------------------------------------------------
  // SPM-81 QA fixtures (Request More Than One Venue for an Event). The SAME
  // events as scripts/seed-spm81.ts (`npm run fixtures:spm81`) - keep the two
  // in step.
  //
  // The events only. Their bookings, the Two-Track Conference's sessions and
  // SPM81 Breakout Room B's maintenance period are created by that script
  // alone, so run it once after a full reseed.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm81 = (key: string, title: string, date: string, startHour: number, durationHours: number): EventSeed => ({
    key, title, status: "planning", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-81 more than one venue for an event test event", category: "meeting",
    days: daysUntil(date), startHour, durationHours, attendance: 30, layout: "theatre",
  });
  eventData.push(
    spm81("spm81_summit", "SPM81 Leadership Summit", "2027-08-03", 9, 8),
    // Runs from Day 1's start (5 Aug 09:00) to Day 2's end (6 Aug 12:00).
    spm81("spm81_conference", "SPM81 Two-Track Conference", "2027-08-05", 9, 27),
    spm81("spm81_rival", "SPM81 Rival Booking", "2027-08-10", 10, 2),
    spm81("spm81_kickoff", "SPM81 Sales Kickoff", "2027-08-10", 10, 2),
    spm81("spm81_repeat", "SPM81 Repeat Request", "2027-08-12", 9, 3),
    spm81("spm81_partner_day", "SPM81 Partner Day", "2027-08-17", 9, 3),
    spm81("spm81_showcase", "SPM81 Showcase Day", "2027-08-19", 9, 8),
    spm81("spm81_solo", "SPM81 Solo Workshop", "2027-08-26", 9, 3),
    spm81("spm81_parallel", "SPM81 Parallel Tracks", "2027-08-24", 9, 6),
    spm81("spm81_second_attempt", "SPM81 Second Attempt", "2027-08-31", 9, 3),
    spm81("spm81_twin_rooms", "SPM81 Twin Rooms", "2027-09-02", 9, 3),
  );

  // -----------------------------------------------------------------
  // SPM-64 QA fixtures (Configure Event Registration). The SAME events as
  // scripts/seed-spm64.ts (`npm run fixtures:spm64`) - keep the two in step.
  //
  // The events only. Their venue bookings, the booking each capacity is
  // measured against, the exact registration periods and the registered,
  // waitlisted and withdrawn attendees are created by that script alone, so
  // run it once after a full reseed. Pushed LAST, after SPM-81, so no earlier
  // event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm64 = (
    key: string, title: string, status: string, date: string, startHour: number, durationHours: number,
    attendance: number, options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, status, organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-64 configure event registration test event", category: "seminar",
    days: daysUntil(date), startHour, durationHours, attendance, layout: "classroom", ...options,
  });
  eventData.push(
    spm64("spm64_orchard", "SPM64 Orchard Data Forum", "planning", "2027-03-18", 9, 8, 60, { category: "conference" }),
    spm64("spm64_twin", "SPM64 Twin Room Workshop", "planning", "2027-03-24", 9, 8, 60, { category: "workshop" }),
    spm64("spm64_unbooked", "SPM64 Unbooked Strategy Day", "approved", "2027-03-31", 9, 8, 30, { category: "meeting" }),
    spm64("spm64_layoutfree", "SPM64 Layout-Free Networking Night", "planning", "2027-04-07", 18, 4, 50,
      { category: "networking", layout: undefined }),
    spm64("spm64_closed", "SPM64 Closed Registration Seminar", "confirmed", "2027-03-10", 9, 8, 50,
      { regEnabled: true, regCapacity: 50 }),
    spm64("spm64_started", "SPM64 Started Showcase", "confirmed", "2026-10-01", 9, 32, 40,
      { category: "exhibition", regEnabled: true, regCapacity: 40 }),
    spm64("spm64_fullhouse", "SPM64 Full House Masterclass", "planning", "2027-04-14", 9, 8, 20,
      { category: "training", regEnabled: true, regCapacity: 20 }),
    spm64("spm64_waitlist", "SPM64 Waitlist Only Briefing", "planning", "2027-04-21", 9, 3, 10,
      { regEnabled: true, regCapacity: 10 }),
    spm64("spm64_incomplete", "SPM64 Incomplete Setup Gala", "planning", "2027-04-28", 18, 4, 60,
      { category: "networking", regEnabled: true }),
    spm64("spm64_lost", "SPM64 Lost Booking Expo", "planning", "2027-05-05", 9, 8, 40,
      { category: "exhibition", regEnabled: true, regCapacity: 40 }),
    spm64("spm64_openday", "SPM64 Attendee Open Day", "confirmed", "2027-05-13", 9, 8, 60,
      { regEnabled: true, regCapacity: 60 }),
    spm64("spm64_postponed", "SPM64 Postponed Product Talk", "postponed", "2027-05-19", 9, 3, 30),
  );

  // -----------------------------------------------------------------
  // SPM-55 QA fixtures (Record Equipment Unavailability). The SAME events as
  // scripts/seed-spm55.ts (`npm run fixtures:spm55`) - keep the two in step.
  //
  // The events only. Their dedicated "SPM55 …" equipment items and the
  // reservations on them are created by that script alone, so run it once
  // after a full reseed.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm55 = (key: string, title: string, date: string, startHour: number, durationHours: number,
    options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com", status: "planning",
    purpose: "SPM-55 record equipment unavailability test event", category: "meeting",
    days: daysUntil(date), startHour, durationHours, attendance: 40, layout: "theatre", ...options,
  });
  eventData.push(
    spm55("spm55_availability_check", "SPM55 Availability Check Forum", "2027-08-09", 9, 4),
    spm55("spm55_return_check", "SPM55 Return Check Seminar", "2027-08-23", 9, 4),
    spm55("spm55_harbour_launch", "SPM55 Harbour Product Launch", "2027-08-10", 9, 6),
    spm55("spm55_quiet_board", "SPM55 Quiet Board Meeting", "2027-08-24", 14, 2),
    spm55("spm55_past_roadshow", "SPM55 Past Roadshow", "2026-09-01", 9, 6, { status: "completed" }),
    spm55("spm55_morning_showcase", "SPM55 Morning Showcase", "2027-08-17", 9, 3),
    spm55("spm55_evening_showcase", "SPM55 Evening Showcase", "2027-08-17", 18, 3),
  );

  // -----------------------------------------------------------------
  // SPM-33 QA fixtures (Track Outstanding Arrangements). The SAME events as
  // scripts/seed-spm33.ts (`npm run fixtures:spm33`) - keep the two in step.
  //
  // The events only. The sessions, venue bookings and equipment requests that
  // put each one in its particular state - pending, flagged, cannot be provided,
  // marked as not required - are created by that script alone, so run it once
  // after a full reseed or every Readiness list shows only "No venue booked".
  // Pushed LAST so no earlier event's EVT- reference number shifts. SPM-85's
  // block follows.
  // -----------------------------------------------------------------
  const spm33 = (
    key: string, title: string, date: string, options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com", status: "planning",
    purpose: "SPM-33 track outstanding arrangements test event", category: "meeting",
    days: daysUntil(date), startHour: 9, durationHours: 4, attendance: 30, layout: "theatre", ...options,
  });
  eventData.push(
    spm33("spm33_two_room", "SPM33 Two Room Conference", "2027-07-12"),
    spm33("spm33_nothing", "SPM33 Nothing Booked", "2027-07-13"),
    spm33("spm33_sessions", "SPM33 Two Day Forum", "2027-07-14", { durationHours: 27 }),
    spm33("spm33_date_changed", "SPM33 Date Changed", "2027-07-16"),
    spm33("spm33_stage", "SPM33 Stage Unavailable", "2027-07-19"),
    spm33("spm33_breakout", "SPM33 Breakout Not Needed", "2027-07-20"),
    spm33("spm33_single_pending", "SPM33 Single Pending Room", "2027-07-21"),
    // Registration on, with its dates but no capacity: outstanding setup.
    spm33("spm33_registration", "SPM33 Registration Not Needed", "2027-07-22", { regEnabled: true }),
    spm33("spm33_waive_confirm", "SPM33 Waive Then Confirm", "2027-07-23"),
    spm33("spm33_other_coordinator", "SPM33 Another Coordinator", "2027-07-26", { coordinator: PRIYA }),
    spm33("spm33_confirmed", "SPM33 Confirmed With Waiver", "2027-07-27", { status: "confirmed" }),
    // Added 2026-10-12, after SPM-81 and SPM-86 reached main: a second venue
    // requested through the Venue tab, and the safety check's four states.
    // Their bookings, equipment and safety checks come from the script.
    spm33("spm33_add_breakout", "SPM33 Add A Breakout Room", "2027-08-02"),
    spm33("spm33_safety_pending", "SPM33 Awaiting Safety Review", "2027-07-28", { status: "safety_review" }),
    spm33("spm33_safety_approved", "SPM33 Safety Approved", "2027-07-29"),
    spm33("spm33_safety_changes", "SPM33 Safety Changes Requested", "2027-07-30"),
    spm33("spm33_safety_rejected", "SPM33 Safety Rejected", "2027-07-31"),
  );

  // -----------------------------------------------------------------
  // SPM-85 QA fixtures (Safety Officer Role and Access). The SAME events as
  // scripts/seed-spm85.ts (`npm run fixtures:spm85`) - keep the two in step.
  //
  // The events only. Their sessions, venue bookings, equipment, facility
  // requirements, the Harbour forum's safety check submission and the launch's
  // registrations are created by that script alone, so run it once after a
  // full reseed. The Safety Officer account is in the staff list above.
  // Pushed LAST so no earlier event's EVT- reference number shifts. SPM-51's
  // block follows.
  // -----------------------------------------------------------------
  const spm85 = (key: string, title: string, status: string, date: string, startHour: number,
    durationHours: number, attendance: number, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-85 Safety Officer role and access test event", category: "conference",
    days: daysUntil(date), startHour, durationHours, attendance, layout: "theatre", ...options,
  });
  eventData.push(
    spm85("spm85_forum", "SPM85 Harbour Safety Forum", "safety_review", "2027-09-27", 9, 8, 200,
      { accessibilityNotes: "Two wheelchair users attending; keep the aisle beside row A clear." }),
    spm85("spm85_launch", "SPM85 Riverside Product Launch", "confirmed", "2027-09-24", 19, 3, 80,
      { regEnabled: true, regCapacity: 80 }),
    spm85("spm85_planning", "SPM85 Marina Networking Night", "planning", "2027-09-20", 18, 3, 50),
  );

  // -----------------------------------------------------------------
  // SPM-71 QA fixtures (View Notifications). The SAME events as
  // scripts/seed-spm71.ts (`npm run fixtures:spm71`) - keep the two in step.
  //
  // The events only. Their booking, equipment, Zara Ong's registration and
  // every notification the cases read are created by that script alone, so
  // run it once after a full reseed. The test accounts are created above.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm71 = (key: string, title: string, status: string, date: string, startHour: number,
    durationHours: number, attendance: number, coordinator: string, layout: string): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator,
    purpose: "SPM-71 view notifications test event", category: "networking",
    days: daysUntil(date), startHour, durationHours, attendance, layout,
  });
  eventData.push(
    spm71("spm71_gala", "SPM71 Harbour Lights Gala", "planning", "2027-11-08", 18, 4, 120, "leon.koh@connectsphere.com", "theatre"),
    spm71("spm71_fair", "SPM71 Riverside Tech Fair", "planning", "2027-11-15", 9, 8, 60, "leon.koh@connectsphere.com", "classroom"),
    spm71("spm71_showcase", "SPM71 Reassigned Showcase", "planning", "2027-11-22", 10, 6, 80, "ivy.lim@connectsphere.com", "theatre"),
    spm71("spm71_supper", "SPM71 Postponed Supper Club", "postponed", "2027-11-29", 19, 3, 40, "leon.koh@connectsphere.com", "banquet"),
  );

  // -----------------------------------------------------------------
  // SPM-51 QA fixtures (Register for Event). The SAME events as
  // scripts/seed-spm51.ts (`npm run fixtures:spm51`) - keep the two in step.
  //
  // The events only. Their exact registration periods (some open, one not
  // yet, one closed, one with none) and the registered, waitlisted and
  // withdrawn attendees are created by that script alone, so run it once
  // after a full reseed. Pushed LAST, after SPM-85, so no earlier event's EVT-
  // reference number shifts. SPM-67's block follows.
  // -----------------------------------------------------------------
  const spm51 = (key: string, title: string, status: string, date: string, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-51 register for event test event", category: "seminar",
    days: daysUntil(date), startHour: 9, durationHours: 8, attendance: 50, layout: "classroom",
    regEnabled: true, regCapacity: 50, ...options,
  });
  eventData.push(
    spm51("spm51_harbour", "SPM51 Harbour Open House", "confirmed", "2028-01-15"),
    spm51("spm51_lastseat", "SPM51 Last Seat Masterclass", "confirmed", "2028-01-22", { regCapacity: 3, attendance: 3 }),
    spm51("spm51_soldout", "SPM51 Sold Out Summit", "confirmed", "2028-01-29", { regCapacity: 3, attendance: 3 }),
    spm51("spm51_earlybird", "SPM51 Early Bird Seminar", "confirmed", "2028-01-20"),
    spm51("spm51_closed", "SPM51 Closed Doors Workshop", "confirmed", "2027-12-10"),
    spm51("spm51_undated", "SPM51 Undated Talk", "confirmed", "2028-02-05"),
    spm51("spm51_private", "SPM51 Private Board Dinner", "confirmed", "2028-02-12", { regEnabled: false, regCapacity: undefined }),
    spm51("spm51_planning", "SPM51 Planning Stage Forum", "planning", "2028-02-19"),
  );

  // -----------------------------------------------------------------
  // SPM-67 QA fixtures (Withdraw or Release Venue Booking). The SAME events
  // as scripts/seed-spm67.ts (`npm run fixtures:spm67`) - keep the two in
  // step.
  //
  // The events only. Their bookings - pending, approved, rejected, withdrawn
  // and released - are created by that script alone, so run it once after a
  // full reseed.
  // Pushed LAST, after SPM-51, so no earlier event's EVT- reference number
  // shifts. Add new events AFTER this block.
  // -----------------------------------------------------------------
  const spm67 = (key: string, title: string, date: string, from: string, to: string): EventSeed => {
    const [startHour, startMinute] = from.split(":").map(Number);
    const [endHour, endMinute] = to.split(":").map(Number);
    return {
      key, title, status: "planning", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
      purpose: "SPM-67 withdraw or release venue booking test event", category: "meeting",
      days: daysUntil(date), startHour, startMinute,
      durationHours: (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60,
      attendance: 30, layout: "theatre",
    };
  };
  eventData.push(
    spm67("spm67_pending_pair", "SPM67 Pending Pair", "2027-11-02", "09:00", "12:00"),
    spm67("spm67_release_pair", "SPM67 Release Pair", "2027-11-04", "09:00", "12:00"),
    spm67("spm67_held_hall", "SPM67 Held Hall", "2027-11-09", "10:00", "12:00"),
    spm67("spm67_booked_hall", "SPM67 Booked Hall", "2027-11-09", "15:00", "16:00"),
    spm67("spm67_afternoon_briefing", "SPM67 Afternoon Briefing", "2027-11-09", "12:15", "14:15"),
    spm67("spm67_only_room", "SPM67 Only Room", "2027-11-16", "09:00", "12:00"),
    spm67("spm67_fresh_start", "SPM67 Fresh Start", "2027-11-18", "09:00", "12:00"),
    spm67("spm67_status_mix", "SPM67 Status Mix", "2027-11-23", "09:00", "12:00"),
  );

  // -----------------------------------------------------------------
  // SPM-87 QA fixtures (Conduct Operational Safety Check). The SAME events as
  // scripts/seed-spm87.ts (`npm run fixtures:spm87`) - keep the two in step.
  //
  // The events only. Their dedicated venue (SPM87 Hillside Studio) and its
  // maintenance period, the bookings, equipment and pending safety checks are
  // created by that script alone, so run it once after a full reseed.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm87 = (key: string, title: string, status: string, date: string, startHour: number,
    durationHours: number, attendance: number, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-87 conduct operational safety check test event", category: "conference",
    days: daysUntil(date), startHour, durationHours, attendance, layout: "theatre", ...options,
  });
  eventData.push(
    spm87("spm87_hillside", "SPM87 Hillside Workshop", "safety_review", "2027-10-08", 10, 3, 50,
      { accessibilityNotes: "Two attendees use wheelchairs; step-free route needed" }),
    spm87("spm87_lakeside", "SPM87 Lakeside Conference", "safety_review", "2027-10-12", 9, 8, 60),
    spm87("spm87_waterfront", "SPM87 Waterfront Gala", "safety_review", "2027-10-18", 18, 4, 60),
    spm87("spm87_rooftop", "SPM87 Rooftop Launch Party", "safety_review", "2027-10-20", 19, 3, 300),
    spm87("spm87_twin_tab", "SPM87 Twin Tab Briefing", "safety_review", "2027-10-22", 9, 2, 30),
    spm87("spm87_unsubmitted", "SPM87 Unsubmitted Planning Day", "planning", "2027-10-26", 9, 4, 40),
  );

  // SPM-90 QA fixtures (Check Each Venue Against Its Own Requirements). The
  // SAME events as scripts/seed-spm90.ts (`npm run fixtures:spm90`) - keep the
  // two in step.
  //
  // The events and their mandatory "Step-free access" requirement (in the
  // facility requirements block below). Their bookings - each with what its
  // space is for and that space's own attendance and layout - and the Two-Day
  // Forum's sessions are created by that script alone, so run it once after a
  // full reseed.
  // Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm90 = (key: string, title: string, date: string, durationHours: number): EventSeed => ({
    key, title, status: "planning", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-90 check each venue against its own requirements test event", category: "conference",
    days: daysUntil(date), startHour: 9, durationHours, attendance: 150, layout: "theatre",
  });
  const SPM90_EVENTS: EventSeed[] = [
    spm90("spm90_conference", "SPM90 Annual Conference", "2027-09-07", 8),
    spm90("spm90_training", "SPM90 Training Day", "2027-09-09", 8),
    spm90("spm90_expo", "SPM90 Product Expo", "2027-09-14", 8),
    spm90("spm90_awards", "SPM90 Awards Night", "2027-09-16", 8),
    spm90("spm90_solo", "SPM90 Solo Seminar", "2027-09-21", 3),
    // Runs from Day 1's start (23 Sep 09:00) to Day 2's end (24 Sep 12:00).
    spm90("spm90_forum", "SPM90 Two-Day Forum", "2027-09-23", 27),
  ];
  eventData.push(...SPM90_EVENTS);

  // SPM-68 QA fixtures (Review Flagged Arrangements). The SAME events as
  // scripts/seed-spm68.ts (`npm run fixtures:spm68`) - keep the two in step.
  //
  // The events only. Their bookings, equipment reservations, registrations
  // and review flags - and the two SPM68 equipment items - are created by
  // that script alone, so run it once after a full reseed.
  // Pushed LAST, after SPM-87 and SPM-90, so no earlier event's EVT- reference
  // number shifts. Add new events AFTER this block.
  // -----------------------------------------------------------------
  const spm68 = (
    key: string, title: string, date: string, attendance: number, extra: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, status: "planning", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-68 review flagged arrangements test event", category: "meeting",
    days: daysUntil(date), startHour: 9, durationHours: 8,
    attendance, layout: "theatre", ...extra,
  });
  eventData.push(
    spm68("spm68_listing", "SPM68 Listing Summit", "2027-10-07", 50, { regEnabled: true, regCapacity: 60 }),
    spm68("spm68_attendance", "SPM68 Attendance Review", "2027-10-06", 80),
    spm68("spm68_outgrown", "SPM68 Outgrown Room", "2027-10-08", 150),
    spm68("spm68_trouble", "SPM68 Venue Trouble Day", "2027-10-09", 40),
    spm68("spm68_moved", "SPM68 Moved Date", "2027-10-14", 40),
    spm68("spm68_kit", "SPM68 Kit Recheck", "2027-10-15", 40),
    spm68("spm68_short", "SPM68 Short Kit", "2027-10-16", 40),
    spm68("spm68_capacity", "SPM68 Capacity Cut", "2027-10-17", 40, { regEnabled: true, regCapacity: 10 }),
    spm68("spm68_off", "SPM68 Registration Off", "2027-10-18", 40),
    spm68("spm68_ready", "SPM68 Ready To Confirm", "2027-10-20", 40, { regEnabled: true, regCapacity: 30 }),
    spm68("spm68_partner", "SPM68 Partner Briefing", "2027-10-21", 40, { coordinator: "priya.raj@connectsphere.com" }),
    spm68("spm68_waived", "SPM68 Waived Room", "2027-10-23", 40),
    spm68("spm68_breakout", "SPM68 Breakout Growth", "2027-10-25", 150),
    spm68("spm68_cancelled", "SPM68 Cancelled Day", "2027-10-24", 40, {
      status: "cancelled", cancellationReason: "Client called the event off",
    }),
  );

  // -----------------------------------------------------------------
  // SPM-82 QA fixtures (Expire Tentative Venue Hold). The SAME events as
  // scripts/seed-spm82.ts (`npm run fixtures:spm82`) - keep the two in step.
  //
  // The events only. Their venue bookings - the holds that expire, and the
  // approved, rejected and withdrawn ones beside them - are created by that
  // script alone, so run it once after a full reseed. It also moves SPM82
  // Short Notice Meetup to 3 days after it is run; the date here is a
  // placeholder. Pushed LAST so no earlier event's EVT- reference number shifts.
  // -----------------------------------------------------------------
  const spm82 = (key: string, title: string, date: string, startHour: number, durationHours: number): EventSeed => ({
    key, title, status: "planning", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-82 expire tentative venue hold test event", category: "meeting",
    days: daysUntil(date), startHour, durationHours, attendance: 30, layout: "theatre",
  });
  eventData.push(
    spm82("spm82_briefing", "SPM82 Harbour Product Briefing", "2027-02-08", 9, 3),
    spm82("spm82_countdown", "SPM82 Countdown Clinic", "2027-02-15", 9, 3),
    spm82("spm82_lapsed", "SPM82 Lapsed Workshop", "2027-02-22", 14, 3),
    spm82("spm82_warn", "SPM82 Closing Soon Forum", "2027-03-01", 9, 3),
    spm82("spm82_expired_only", "SPM82 Expired Only Talk", "2027-03-01", 14, 2),
    spm82("spm82_rival", "SPM82 Rival Seminar", "2027-02-22", 17, 2),
    spm82("spm82_fresh", "SPM82 Fresh Request Expo", "2027-03-08", 9, 3),
    spm82("spm82_short", "SPM82 Short Notice Meetup", "2027-03-15", 10, 2),
  );

  // -----------------------------------------------------------------
  // SPM-88 QA fixtures (Resolve Safety Check Outcome). The SAME events as
  // scripts/seed-spm88.ts (`npm run fixtures:spm88`) - keep the two in step.
  //
  // The events only. Their dedicated venue (SPM88 Harbour Studio), bookings,
  // equipment and safety checks - with the dates SPM-88-TC01 quotes - are
  // created by that script alone, so run it once after a full reseed.
  // Pushed LAST, after SPM-82, so no earlier event's EVT- reference number
  // shifts. Add new events AFTER this block.
  // -----------------------------------------------------------------
  const SPM88_BEFORE_SAFETY = ["submitted", "under_review", "approved", "planning"];
  const spm88 = (key: string, title: string, status: string, date: string, startHour: number,
    durationHours: number, attendance: number): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-88 resolve safety check outcome test event", category: "conference",
    days: daysUntil(date), startHour, durationHours, attendance, layout: "theatre",
    chain: {
      planning: SPM88_BEFORE_SAFETY,
      safety_review: [...SPM88_BEFORE_SAFETY, "safety_review"],
      safety_cleared: [...SPM88_BEFORE_SAFETY, "safety_review", "safety_cleared"],
      confirmed: [...SPM88_BEFORE_SAFETY, "safety_review", "safety_cleared", "confirmed"],
    }[status],
  });
  eventData.push(
    spm88("spm88_returned", "SPM88 Harbour Returned Forum", "planning", "2027-11-02", 9, 4, 60),
    spm88("spm88_riverside", "SPM88 Riverside Review", "safety_review", "2027-11-04", 9, 4, 200),
    spm88("spm88_gala", "SPM88 Approved Gala", "safety_cleared", "2027-11-09", 18, 4, 60),
    spm88("spm88_seminar", "SPM88 Approved Seminar", "safety_cleared", "2027-11-11", 9, 4, 40),
    spm88("spm88_showcase", "SPM88 Pending Showcase", "safety_review", "2027-11-12", 9, 4, 50),
    spm88("spm88_workshop", "SPM88 Pending Workshop", "safety_review", "2027-11-16", 9, 4, 30),
    spm88("spm88_expo", "SPM88 Confirmed Expo", "confirmed", "2027-11-18", 9, 8, 120),
    spm88("spm88_unchecked", "SPM88 Unchecked Launch", "planning", "2027-11-23", 9, 4, 40),
  );

  // -----------------------------------------------------------------
  // SPM-52 QA fixtures (Withdraw from Event). The SAME events as
  // scripts/seed-spm52.ts (`npm run fixtures:spm52`) - keep the two in step.
  //
  // The events only. Their exact registration periods and Marcus Yeo's
  // registered, waitlisted, withdrawn and attended registrations are created
  // by that script alone, so run it once after a full reseed. Pushed LAST,
  // after SPM-88, so no earlier event's EVT- reference number shifts. Add new
  // events AFTER this block.
  // -----------------------------------------------------------------
  const spm52 = (key: string, title: string, status: string, date: string, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-52 withdraw from event test event", category: "seminar",
    days: daysUntil(date), startHour: 9, durationHours: 8, attendance: 20, layout: "classroom",
    regEnabled: true, regCapacity: 20, ...options,
  });
  eventData.push(
    spm52("spm52_riverside", "SPM52 Riverside Forum", "confirmed", "2028-03-04", { regCapacity: 10, attendance: 10 }),
    spm52("spm52_lastplace", "SPM52 Last Place Clinic", "confirmed", "2028-03-11", { regCapacity: 2, attendance: 2 }),
    spm52("spm52_waitlist", "SPM52 Waiting List Workshop", "confirmed", "2028-03-18", { regCapacity: 1, attendance: 1 }),
    spm52("spm52_dropped", "SPM52 Dropped Plans Seminar", "confirmed", "2028-03-25"),
    spm52("spm52_past", "SPM52 Past Wellness Clinic", "completed", "2026-09-15"),
    spm52("spm52_gala", "SPM52 Members Gala", "confirmed", "2028-04-01", { regEnabled: false }),
  );

  // -----------------------------------------------------------------
  // SPM-65 QA fixtures (View Registration List). The SAME events as
  // scripts/seed-spm65.ts (`npm run fixtures:spm65`) - keep the two in step.
  //
  // The events only. Their registration periods and their registered,
  // waitlisted, withdrawn, attended and organiser-added registrations are
  // created by that script alone, so run it once after a full reseed. Pushed
  // LAST, after SPM-52, so no earlier event's EVT- reference number shifts.
  // Add new events AFTER this block.
  // -----------------------------------------------------------------
  const spm65 = (key: string, title: string, status: string, date: string, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-65 view registration list test event", category: "seminar",
    days: daysUntil(date), startHour: 9, durationHours: 8, attendance: 30, layout: "classroom",
    regEnabled: true, ...options,
  });
  eventData.push(
    spm65("spm65_harbour", "SPM65 Harbourfront Seminar", "confirmed", "2028-05-04", { regCapacity: 3, attendance: 3 }),
    spm65("spm65_past", "SPM65 Past Health Talk", "completed", "2026-09-20", { regCapacity: 10, attendance: 10 }),
    spm65("spm65_live", "SPM65 Live Update Workshop", "confirmed", "2028-05-11", { regCapacity: 5, attendance: 5 }),
    spm65("spm65_open", "SPM65 Open Lecture", "confirmed", "2028-05-18"),
    spm65("spm65_closed", "SPM65 Closed Doors Gala", "confirmed", "2028-05-25", { regEnabled: false }),
    spm65("spm65_paused", "SPM65 Paused Forum", "confirmed", "2028-06-01", { regEnabled: false, regCapacity: 20, attendance: 20 }),
  );

  // -----------------------------------------------------------------
  // SPM-29 QA fixtures (Request Event Clarification). The SAME events as
  // scripts/seed-spm29.ts (`npm run fixtures:spm29`) - keep the two in step.
  //
  // The events only. The open clarification on SPM29 Meridian Open Question
  // Forum - with the date SPM-29-TC03 quotes - is created by that script
  // alone, so run it once after a full reseed. Pushed LAST, after SPM-65, so
  // no earlier event's EVT- reference number shifts. Add new events AFTER
  // this block.
  // -----------------------------------------------------------------
  const spm29 = (key: string, title: string, date: string): EventSeed => ({
    key, title, status: "under_review", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "Client update for Meridian's wealth advisory team", category: "conference",
    days: daysUntil(date), startHour: 9, durationHours: 4, attendance: 80, layout: "theatre",
  });
  eventData.push(
    spm29("spm29_summit", "SPM29 Meridian Clarity Summit", "2028-04-06"),
    spm29("spm29_forum", "SPM29 Meridian Open Question Forum", "2028-04-13"),
  );

  // -----------------------------------------------------------------
  // SPM-84 QA fixtures (Event Coordinator Lead: Rename Role and View
  // Assignments). The SAME events as scripts/seed-spm84.ts
  // (`npm run fixtures:spm84`) - keep the two in step. Pushed LAST, after
  // SPM-29, so no earlier event's EVT- reference number shifts. Add new events
  // AFTER this block.
  // -----------------------------------------------------------------
  const spm84 = (key: string, title: string, status: string, coordinator: string | undefined, date: string,
    chain?: string[]): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator,
    purpose: "SPM-84 event coordinator lead test event", category: "conference",
    days: daysUntil(date), startHour: 9, durationHours: 4, attendance: 60, layout: "theatre",
    ...(chain ? { chain } : {}),
  });
  const aisha = "aisha.karim@connectsphere.com";
  eventData.push(
    spm84("spm84_harbour_gala", "SPM84 Harbour Gala", "planning", aisha, "2027-11-09"),
    spm84("spm84_orchard_forum", "SPM84 Orchard Forum", "under_review", aisha, "2027-11-11"),
    spm84("spm84_postponed_retreat", "SPM84 Postponed Retreat", "postponed", aisha, "2027-11-16"),
    spm84("spm84_closed_showcase", "SPM84 Closed Showcase", "completed", aisha, "2026-09-08"),
    spm84("spm84_called_off_expo", "SPM84 Called Off Expo", "cancelled", aisha, "2027-11-18"),
    spm84("spm84_rejected_request", "SPM84 Rejected Request", "rejected", aisha, "2027-11-23"),
    spm84("spm84_withdrawn_request", "SPM84 Withdrawn Request", "withdrawn", aisha, "2027-11-25",
      ["submitted", "under_review", "withdrawn"]),
    spm84("spm84_riverside_launch", "SPM84 Riverside Launch", "confirmed", "benjamin.lau@connectsphere.com", "2027-11-30"),
    spm84("spm84_past_seminar", "SPM84 Past Seminar", "completed", "clara.tay@connectsphere.com", "2026-09-10"),
    spm84("spm84_inherited_workshop", "SPM84 Inherited Workshop", "planning", "dennis.ho@connectsphere.com", "2027-12-02"),
    spm84("spm84_unassigned_request", "SPM84 Unassigned Request", "submitted", undefined, "2027-12-07"),
  );

  // -----------------------------------------------------------------
  // SPM-35 QA fixtures (Request Event Change). The SAME events as
  // scripts/seed-spm35.ts (`npm run fixtures:spm35`) - keep the two in step.
  //
  // The events only. SPM35 Harbour Townhall's facility, SPM35 Riverside
  // Roadshow's approved booking and reserved projectors, and SPM35 Requests
  // Showcase's five pending change requests are created by that script alone,
  // so run it once after a full reseed. Pushed LAST, after SPM-84, so no earlier
  // event's EVT- reference number shifts. Add new events AFTER this block.
  // -----------------------------------------------------------------
  const spm35 = (
    key: string, title: string, status: string, date: string, startHour: number, durationHours: number,
    attendance: number, options: Partial<EventSeed> = {}
  ): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    category: "meeting", days: daysUntil(date), startHour, durationHours, attendance, layout: "theatre", ...options,
  });
  eventData.push(
    spm35("spm35_townhall", "SPM35 Harbour Townhall", "approved", "2027-04-12", 9, 3, 80,
      { purpose: "Quarterly all-hands", description: "Leadership update and Q&A." }),
    spm35("spm35_roadshow", "SPM35 Riverside Roadshow", "planning", "2027-04-19", 10, 6, 100,
      { purpose: "Client roadshow", description: "Product briefings for wealth clients." }),
    spm35("spm35_forum", "SPM35 Marina Client Forum", "confirmed", "2027-04-26", 14, 3, 50,
      { purpose: "Client forum", description: "Market outlook for key clients." }),
    spm35("spm35_postponed", "SPM35 Postponed Product Showcase", "postponed", "2027-05-03", 9, 4, 60,
      { purpose: "Product showcase", description: "New savings products on show." }),
    spm35("spm35_under_review", "SPM35 Under Review Workshop", "under_review", "2027-05-24", 9, 3, 30,
      { purpose: "Advisers' workshop", description: "Hands-on session for advisers." }),
    spm35("spm35_cancelled", "SPM35 Cancelled Gala Dinner", "cancelled", "2027-05-31", 19, 3, 120,
      { purpose: "Year-end gala", description: "Dinner for staff and partners.", cancellationReason: "Client cancelled the gala." }),
    spm35("spm35_requests", "SPM35 Requests Showcase", "confirmed", "2027-05-10", 9, 8, 100,
      { purpose: "Client showcase", description: "A day of client presentations." }),
  );

  // -----------------------------------------------------------------
  // SPM-80 QA fixtures (Re-check Bookings When Setup or Turnaround Time
  // Changes). The SAME events as scripts/seed-spm80.ts (`npm run
  // fixtures:spm80`) - keep the two in step. Their bookings and the
  // maintenance period are created further down. Pushed LAST, after SPM-35,
  // so no earlier event's EVT- reference number shifts. Add new events AFTER
  // this block.
  // -----------------------------------------------------------------
  const spm80 = (key: string, title: string, date: string, from: string, to: string, options: Partial<EventSeed> = {}): EventSeed => {
    const [startHour, startMinute] = from.split(":").map(Number);
    const [endHour, endMinute] = to.split(":").map(Number);
    return {
      key, title, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com", status: "planning",
      purpose: "SPM-80 setup and turnaround re-check test event", category: "meeting",
      days: daysUntil(date), startHour, startMinute,
      durationHours: (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60,
      attendance: 30, layout: "classroom", ...options,
    };
  };
  eventData.push(
    spm80("spm80_morning", "SPM80 Morning Seminar", "2027-08-03", "10:00", "12:00"),
    spm80("spm80_lunch", "SPM80 Lunch Forum", "2027-08-03", "12:30", "14:00"),
    spm80("spm80_evening", "SPM80 Evening Workshop", "2027-08-03", "18:00", "20:00"),
    spm80("spm80_past_first", "SPM80 Past Briefing", "2026-09-01", "10:00", "12:00", { status: "completed" }),
    spm80("spm80_past_second", "SPM80 Past Review", "2026-09-01", "12:30", "14:00", { status: "completed" }),
    spm80("spm80_demo", "SPM80 Product Demo", "2027-08-04", "10:00", "12:00"),
    spm80("spm80_meetup", "SPM80 Partner Meetup", "2027-08-04", "12:30", "14:00"),
    spm80("spm80_talk", "SPM80 Afternoon Talk", "2027-08-05", "12:00", "13:30"),
    spm80("spm80_booked", "SPM80 Booked Seminar", "2027-08-06", "10:00", "12:00"),
    spm80("spm80_followon", "SPM80 Follow-on Workshop", "2027-08-06", "12:15", "14:00"),
  );

  // -----------------------------------------------------------------
  // SPM-26 QA fixtures (Respond to Clarification Request). The SAME events
  // as scripts/seed-spm26.ts (`npm run fixtures:spm26`) - keep the two in
  // step.
  //
  // The events only. Their clarifications - open on the Advisory Briefing,
  // answered on the Answered Workshop, with the dates SPM-26's cases quote -
  // are created by that script alone, so run it once after a full reseed.
  // Pushed LAST, after SPM-80, so no earlier event's EVT- reference number
  // shifts. Add new events AFTER this block.
  // -----------------------------------------------------------------
  const spm26 = (key: string, title: string, date: string): EventSeed => ({
    key, title, status: "under_review", organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "Quarterly briefing for Meridian's wealth advisers", category: "conference",
    description: "Half-day session followed by networking.",
    days: daysUntil(date), startHour: 9, durationHours: 4, attendance: 80, layout: "theatre",
  });
  eventData.push(
    spm26("spm26_briefing", "SPM26 Meridian Advisory Briefing", "2028-05-04"),
    spm26("spm26_answered", "SPM26 Meridian Answered Workshop", "2028-05-11"),
  );

  // -----------------------------------------------------------------
  // SPM-59 QA fixtures (Record Request Withdrawal). The SAME events as
  // scripts/seed-spm59.ts (`npm run fixtures:spm59`) - keep the two in step.
  // One request in each status before planning, the withdrawn one among them.
  // Pushed LAST, after SPM-26, so no earlier event's EVT- reference number
  // shifts. Add new events AFTER this block.
  // -----------------------------------------------------------------
  const spm59 = (key: string, title: string, status: string, date: string, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-59 record request withdrawal test event", description: "A request for Meridian's client team.",
    category: "seminar", days: daysUntil(date), startHour: 9, durationHours: 4, attendance: 60, layout: "theatre", ...options,
  });
  eventData.push(
    spm59("spm59_strategy_day", "SPM59 Harbour Strategy Day", "under_review", "2027-06-07"),
    spm59("spm59_withdrawn", "SPM59 Withdrawn Product Launch", "withdrawn", "2027-06-14",
      { chain: ["submitted", "under_review", "withdrawn"] }),
    spm59("spm59_draft", "SPM59 Draft Offsite", "draft", "2027-06-21", { coordinator: undefined }),
    spm59("spm59_submitted", "SPM59 Submitted Briefing", "submitted", "2027-06-28", { coordinator: undefined }),
    spm59("spm59_approved", "SPM59 Approved Seminar", "approved", "2027-07-05"),
    spm59("spm59_rejected", "SPM59 Rejected Gala", "rejected", "2027-07-12", {
      rejectionReason: "Budget for the gala was not confirmed.",
      historyReasons: { rejected: "Budget for the gala was not confirmed." },
    }),
  );

  // -----------------------------------------------------------------
  // SPM-36 QA fixtures (Mark Event as Completed). The SAME events as
  // scripts/seed-spm36.ts (`npm run fixtures:spm36`) - keep the two in step.
  //
  // The events only. Their approved bookings, reserved equipment and Lee Wei
  // Ming's registration are created by that script alone, so run it once
  // after a full reseed.
  // SPM36 Harbour Awards Night ended YESTERDAY, counted from when the seed
  // runs, not from SEED_ANCHOR: over (AC1) but not yet 7 days over (AC6). The
  // other dates are fixed. Pushed LAST, after SPM-59, so no earlier event's
  // EVT- reference number shifts. Add new events AFTER this block.
  // -----------------------------------------------------------------
  const spm36Yesterday = new Date(Date.now() + SGT_OFFSET_HOURS * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  const spm36 = (
    key: string, title: string, status: string, date: string, startHour: number, durationHours: number
  ): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-36 mark event as completed test event", category: "conference",
    days: daysUntil(date), startHour, durationHours, attendance: 80, layout: "theatre",
  });
  eventData.push(
    spm36("spm36_awards", "SPM36 Harbour Awards Night", "confirmed", spm36Yesterday, 19, 3),
    spm36("spm36_launch", "SPM36 Riverside Product Launch", "confirmed", "2027-11-18", 9, 4),
    spm36("spm36_planning", "SPM36 Overdue Planning Forum", "planning", "2026-10-05", 9, 3),
    spm36("spm36_expo", "SPM36 Forgotten Trade Expo", "confirmed", "2026-10-01", 10, 7),
  );

  // -----------------------------------------------------------------
  // SPM-37 QA fixtures (Cancel Event). The SAME events as
  // scripts/seed-spm37.ts (`npm run fixtures:spm37`) - keep the two in step.
  //
  // The events only. Their test rooms (SPM37 Hall, SPM37 Studio), equipment
  // (SPM37 Projector, SPM37 Lectern Mic), bookings, equipment lines, safety
  // check, change requests and registration are created by that script alone,
  // so run it once after a full reseed. Pushed LAST, after SPM-36, so no
  // earlier event's EVT- reference number shifts. Add new events AFTER this
  // block.
  // -----------------------------------------------------------------
  const spm37 = (key: string, title: string, status: string, date: string, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-37 cancel event test event", category: "meeting",
    days: daysUntil(date), startHour: 9, durationHours: 3, attendance: 30, layout: "theatre",
    ...options,
  });
  eventData.push(
    spm37("spm37_harbour_summit", "SPM37 Harbour Summit", "planning", "2027-11-02"),
    spm37("spm37_blocking_expo", "SPM37 Blocking Expo", "planning", "2027-11-16"),
    spm37("spm37_rival_forum", "SPM37 Rival Forum", "planning", "2027-11-16"),
    spm37("spm37_safety_pending", "SPM37 Safety Pending", "safety_review", "2027-11-18"),
    spm37("spm37_change_pending", "SPM37 Change Pending", "confirmed", "2027-11-23"),
    spm37("spm37_open_workshop", "SPM37 Open Workshop", "confirmed", "2027-11-25", { regEnabled: true, regCapacity: 40 }),
    spm37("spm37_quiet_approval", "SPM37 Quiet Approval", "approved", "2027-11-30"),
    spm37("spm37_early_call", "SPM37 Early Call", "under_review", "2027-12-02"),
    spm37("spm37_on_hold", "SPM37 On Hold", "postponed", "2027-12-07"),
    spm37("spm37_turned_down", "SPM37 Turned Down", "rejected", "2027-12-09",
      { rejectionReason: "The client's budget does not cover a venue of this size." }),
    spm37("spm37_wrapped_up", "SPM37 Wrapped Up", "completed", "2026-10-05"),
    spm37("spm37_guarded_event", "SPM37 Guarded Event", "planning", "2027-12-14"),
    spm37("spm37_already_cancelled", "SPM37 Already Cancelled", "cancelled", "2027-12-16",
      { cancellationReason: "The client's product launch was called off." }),
    spm37("spm37_change_closed", "SPM37 Change Closed", "planning", "2027-12-21"),
  );

  // -----------------------------------------------------------------
  // SPM-94 QA fixtures (Limit Who Sees a Request's Review Outcome). The SAME
  // events as scripts/seed-spm94.ts (`npm run fixtures:spm94`) - keep the two
  // in step. One per status the story turns on, all Rachel Ng's, so James Koh
  // is her colleague (AC4) and Priya Raj the unassigned coordinator (AC3).
  // Pushed LAST, after SPM-37, so no earlier event's EVT- reference number
  // shifts. Add new events AFTER this block.
  // -----------------------------------------------------------------
  const spm94 = (key: string, title: string, status: string, date: string, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Rachel Ng",
    coordinator: status === "submitted" ? undefined : "daniel.tan@connectsphere.com",
    purpose: "SPM-94 review outcome visibility test event", category: "conference",
    days: daysUntil(date), startHour: 9, durationHours: 4, attendance: 80, layout: "theatre", ...options,
  });
  eventData.push(
    spm94("spm94_rejected", "SPM94 Meridian Rejected Gala", "rejected", "2027-11-03",
      { rejectionReason: "The requested ballroom is closed for renovation in November 2027." }),
    spm94("spm94_submitted", "SPM94 Meridian Submitted Townhall", "submitted", "2027-11-04"),
    spm94("spm94_under_review", "SPM94 Meridian Review Seminar", "under_review", "2027-11-05"),
    spm94("spm94_withdrawn", "SPM94 Meridian Withdrawn Workshop", "withdrawn", "2027-11-08",
      { chain: ["submitted", "under_review", "withdrawn"] }),
    spm94("spm94_approved", "SPM94 Meridian Approved Launch", "approved", "2027-11-09"),
    spm94("spm94_confirmed", "SPM94 Meridian Open Forum", "confirmed", "2027-11-10",
      { regEnabled: true, regCapacity: 100 }),
    spm94("spm94_approval_flow", "SPM94 Meridian Approval Flow Briefing", "under_review", "2027-11-11"),
    // TC11: cancelled straight from Under review (SPM-37), and after approval.
    spm94("spm94_cancelled_in_review", "SPM94 Meridian Cancelled Review Dinner", "cancelled", "2027-11-12",
      { chain: ["submitted", "under_review", "cancelled"], cancellationReason: "The client called the event off." }),
    spm94("spm94_cancelled_after_approval", "SPM94 Meridian Cancelled Approved Expo", "cancelled", "2027-11-15",
      { chain: ["submitted", "under_review", "approved", "cancelled"], cancellationReason: "The client called the event off." }),
  );

  // -----------------------------------------------------------------
  // SPM-38 QA fixtures (Postpone Event). The SAME events as
  // scripts/seed-spm38.ts (`npm run fixtures:spm38`) - keep the two in step.
  //
  // The events only. Their test rooms (SPM38 Hall, SPM38 Studio), equipment
  // (SPM38 Projector, SPM38 Lectern Mic), bookings, equipment lines, safety
  // checks, change requests and registration are created by that script alone,
  // so run it once after a full reseed. A postponed event's reason is its
  // status history's (historyReasons). Pushed LAST, after SPM-94, so no
  // earlier event's EVT- reference number shifts. Add new events AFTER this
  // block.
  // -----------------------------------------------------------------
  const spm38 = (key: string, title: string, status: string, date: string, options: Partial<EventSeed> = {}): EventSeed => ({
    key, title, status, organiser: "Rachel Ng", coordinator: "daniel.tan@connectsphere.com",
    purpose: "SPM-38 postpone event test event", category: "meeting",
    days: daysUntil(date), startHour: 9, durationHours: 3, attendance: 30, layout: "theatre",
    ...options,
  });
  eventData.push(
    spm38("spm38_lantern_gala", "SPM38 Lantern Gala", "planning", "2028-01-12"),
    spm38("spm38_riverside_expo", "SPM38 Riverside Expo", "planning", "2028-01-19"),
    spm38("spm38_rival_seminar", "SPM38 Rival Seminar", "planning", "2028-01-19"),
    spm38("spm38_safety_pending", "SPM38 Safety Pending", "safety_review", "2028-01-21"),
    spm38("spm38_safety_cleared", "SPM38 Safety Cleared", "safety_cleared", "2028-01-26",
      { chain: ["submitted", "under_review", "approved", "planning", "safety_review", "safety_cleared"] }),
    spm38("spm38_client_asks", "SPM38 Client Asks", "confirmed", "2028-01-28"),
    spm38("spm38_open_workshop", "SPM38 Open Workshop", "confirmed", "2028-02-02", { regEnabled: true, regCapacity: 40 }),
    spm38("spm38_quiet_approval", "SPM38 Quiet Approval", "approved", "2028-02-04"),
    spm38("spm38_guarded_forum", "SPM38 Guarded Forum", "planning", "2028-02-09"),
    spm38("spm38_early_review", "SPM38 Early Review", "under_review", "2028-02-11"),
    spm38("spm38_called_off", "SPM38 Called Off", "cancelled", "2028-02-14",
      { cancellationReason: "The client has called off the event.",
        historyReasons: { cancelled: "The client has called off the event." } }),
    spm38("spm38_on_hold", "SPM38 On Hold", "postponed", "2028-02-16",
      { historyReasons: { postponed: "Waiting on the client's revised budget." } }),
    spm38("spm38_new_date_wanted", "SPM38 New Date Wanted", "postponed", "2028-02-23",
      { historyReasons: { postponed: "Venue renovation at the client's office." } }),
    spm38("spm38_wrapped_up", "SPM38 Wrapped Up", "completed", "2026-10-06"),
  );

  const events: Record<string, { id: string; startsAt: Date | null; endsAt: Date | null; days: number }> = {};

  for (const e of eventData) {
    const organiserId = users[`organiser:${e.organiser}`];
    const organiser = await prisma.user.findUnique({
      where: { id: organiserId },
      select: { organisationId: true },
    });
    const startsAt = e.status === "draft" ? null : day(e.days, e.startHour ?? 9, e.startMinute ?? 0);
    // Rounded: a fractional duration (SPM-93: 32h25m) would otherwise end a millisecond early.
    const endsAt = startsAt ? new Date(startsAt.getTime() + Math.round((e.durationHours ?? 4) * 3_600_000)) : null;

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
  // SPM-90 fixtures - same as scripts/seed-spm90.ts: every space of these
  // events, a breakout room included, must have step-free access.
  facReqs.push(...SPM90_EVENTS.map((e): [string, [string, boolean][]] => [e.key, [["Step-free access", true]]]));
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
    // SPM-85's forum is waiting for its Operational Safety Check (SPM-86).
    safety_review: ["submitted", "under_review", "approved", "planning", "safety_review"],
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
    safety_review: "Submitted for an Operational Safety Check",
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
          reason: e.historyReasons?.[to] ?? REASONS[to],
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
  // No PENDING row belongs to a Submitted or Under review event: since SPM-54
  // a venue can only be requested once the event is approved.
  const bookings: [string, string, string, string?][] = [
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
        // SPM-90: each of these is its event's only room, so its space is the
        // main programme, on the event's own attendance and layout.
        purpose: "Main programme",
        expectedAttendance: seed.attendance,
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

  // One rejected request carries a suggested alternative (SPM-43 AC6), so the
  // two columns that story added - suggestedVenueId and suggestedAlternative -
  // hold something on a fresh database. Venue Staff refused Marina Auditorium
  // for the developer summit's parallel tracks and pointed at the room whose
  // partitions can split; nothing was booked by the suggestion.
  await prisma.venueBooking.updateMany({
    where: { eventId: events["submitted"].id, venueId: venues["MAR-AUD"], status: "rejected" },
    data: {
      suggestedVenueId: venues["ORC-SEM"],
      suggestedAlternative: "The movable partitions there can split the room for parallel tracks.",
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

  // SPM-50 test-case requests - same rows as scripts/seed-spm50.ts. Kept out
  // of eqReqs because some already carry Technical Support's notes, and the
  // reviewer is fixed rather than rotated, so the names the cases see are stable.
  // [eventKey, equipment, requested, reserved|null, status, technical requirements, staff notes, reviewer]
  const spm50Requests: [string, string, number, number | null, string, string | null, string | null, string | null][] = [
    ["spm50_robotics_expo", "Wireless Presenter", 2, null, "requested", "Must pair with the stage laptop over USB-C", null, null],
    ["spm50_robotics_expo", "Confidence Monitor", 3, null, "requested", "Floor wedges facing the speaker, HDMI from the lectern", null, null],
    ["spm50_design_week", "Ring Light", 2, null, "unavailable", null, "Both units out for repair", "aisha.omar@connectsphere.com"],
    ["spm50_design_week", "Confidence Monitor", 1, null, "requested", null, null, null],
    ["spm50_charity_briefing", "Mobile Charging Cart", 1, 1, "reserved", null, null, "kenji.sato@connectsphere.com"],
    ["spm50_charity_gala", "Mobile Charging Cart", 1, null, "requested", null, null, null],
    ["spm50_confirmed_launch", "Wireless Presenter", 2, 2, "reserved", null, null, "kenji.sato@connectsphere.com"],
    ["spm50_pending_showcase", "Wireless Presenter", 1, null, "requested", null, null, null],
    ["spm50_approved_briefing", "Wireless Presenter", 1, null, "requested", null, null, null],
  ];
  for (const [eventKey, eqName, requested, reserved, status, requirements, staffNotes, reviewer] of spm50Requests) {
    const ev = events[eventKey];
    await prisma.equipmentRequest.create({
      data: {
        eventId: ev.id,
        equipmentId: equip[eqName],
        quantityRequested: requested,
        quantityReserved: reserved ?? undefined,
        technicalRequirements: requirements ?? undefined,
        startsAt: new Date(ev.startsAt!.getTime() - 3 * 3_600_000),
        endsAt: new Date(ev.endsAt!.getTime() + 2 * 3_600_000),
        status,
        requestedBy: users["daniel.tan@connectsphere.com"],
        requestedAt: day(ev.days - 27),
        reviewedBy: reviewer ? users[reviewer] : undefined,
        reviewedAt: reviewer ? day(ev.days - 25) : undefined,
        staffNotes: staffNotes ?? undefined,
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

  // SPM-43: the booking requests Venue Staff find on Booking Requests, the
  // two sessions of the Two-Day Forum, and the one maintenance period on
  // SPM43-MNT (SPM-43-TC13). Same as scripts/seed-spm43.ts. Each request
  // holds whole slots on its own date - [first hour, last hour] below are the
  // customer's slot edges (#50): AM 7-12, PM 13-18, Night 19-24.
  const spm43Sessions: Record<string, string> = {};
  for (const [label, date, from, attendance, layout] of [
    ["Day 1", "2027-05-11", 9, 60, "theatre"],
    ["Day 2", "2027-05-12", 14, 30, "classroom"],
  ] as const) {
    const session = await prisma.eventSession.create({
      data: {
        eventId: events["spm43_sessions"].id, label,
        startsAt: day(daysUntil(date), from), endsAt: day(daysUntil(date), from + 3),
        expectedAttendance: attendance, preferredLayout: layout,
      },
    });
    spm43Sessions[label] = session.id;
  }
  const spm43Bookings: {
    event: string; venue: string; date: string; from: number; to: number; layout: string;
    status?: "approved"; session?: string; note?: string;
  }[] = [
    { event: "spm43_approve", venue: "ORC-SEM", date: "2027-05-04", from: 7, to: 18, layout: "theatre",
      note: "Lectern and two handheld microphones." },
    { event: "spm43_reject", venue: "MAR-AUD", date: "2027-05-05", from: 13, to: 18, layout: "theatre" },
    { event: "spm43_suggest", venue: "ORC-GAL", date: "2027-05-06", from: 19, to: 24, layout: "banquet",
      note: "Round tables of ten, stage for the awards." },
    { event: "spm43_arrangement", venue: "ONE-AUD", date: "2027-05-08", from: 13, to: 18, layout: "theatre" },
    { event: "spm43_confirmed", venue: "MAR-AUD", date: "2027-05-07", from: 7, to: 18, layout: "theatre",
      status: "approved" },
    { event: "spm43_turnaround", venue: "MAR-AUD", date: "2027-05-07", from: 19, to: 24, layout: "theatre" },
    { event: "spm43_rival_a", venue: "ORC-STU", date: "2027-05-10", from: 13, to: 18, layout: "classroom" },
    { event: "spm43_rival_b", venue: "ORC-STU", date: "2027-05-10", from: 13, to: 18, layout: "classroom" },
    { event: "spm43_sessions", venue: "ONE-SEM", date: "2027-05-11", from: 7, to: 12, layout: "theatre",
      session: "Day 1" },
    { event: "spm43_sessions", venue: "JUR-TRN", date: "2027-05-12", from: 13, to: 18, layout: "classroom",
      session: "Day 2", note: "Tables in rows, power at every seat." },
    { event: "spm43_cancelled_event", venue: "CBP-CONF", date: "2027-05-13", from: 7, to: 18, layout: "theatre" },
    { event: "spm43_maintenance", venue: "SPM43-MNT", date: "2027-05-14", from: 7, to: 12, layout: "classroom" },
    { event: "spm43_retire", venue: "SPM43-RET", date: "2027-05-17", from: 13, to: 18, layout: "classroom" },
    // Not creatable in the app since SPM-54 - stands for a request made
    // before that rule (SPM-43-TC15).
    { event: "spm43_under_review", venue: "ORC-STU", date: "2027-05-18", from: 7, to: 12, layout: "classroom" },
    // Its setup slot (8 May AM) follows Board Strategy Day's turnaround
    // (7 May Night), so it does not clash (SPM-43-TC16).
    { event: "spm43_after_turnaround", venue: "MAR-AUD", date: "2027-05-08", from: 13, to: 18, layout: "theatre" },
  ];
  for (const b of spm43Bookings) {
    await prisma.venueBooking.create({
      data: {
        eventId: events[b.event].id,
        sessionId: b.session ? spm43Sessions[b.session] : undefined,
        venueId: venues[b.venue],
        layoutName: b.layout,
        startsAt: day(daysUntil(b.date), b.from),
        endsAt: day(daysUntil(b.date), b.to),
        status: b.status ?? "pending",
        requestedBy: users["daniel.tan@connectsphere.com"],
        requestedAt: day(-3),
        requirementsNote: b.note,
        decidedBy: b.status ? users["marcus.wong@connectsphere.com"] : undefined,
        decidedAt: b.status ? day(-2) : undefined,
      },
    });
  }
  await prisma.venueUnavailability.create({
    data: {
      venueId: venues["SPM43-MNT"],
      startsAt: day(daysUntil("2027-05-14"), 0),
      endsAt: day(daysUntil("2027-05-14"), 24),
      reason: "maintenance",
      notes: "SPM-43 fixture: floor resurfacing",
      createdBy: users["marcus.wong@connectsphere.com"],
    },
  });

  // SPM-44: the bookings its holder events already have, and SPM44-PLN's
  // maintenance period (AC8). Same as scripts/seed-spm44.ts - each booking
  // spans its event's own times, as the script stores it. The block's notes
  // start "SPM44" because that is how the script finds it to replace it.
  const spm44Bookings: {
    event: string; venue: string; date: string; from: number; to: number; layout: string;
    status: "approved" | "pending" | "rejected" | "cancelled"; by: string; reason?: string;
  }[] = [
    { event: "spm44_holder_approved", venue: "SPM44-PLN", date: "2027-04-05", from: 14, to: 16, layout: "classroom",
      status: "approved", by: PRIYA },
    { event: "spm44_holder_pending", venue: "SPM44-PLN", date: "2027-04-06", from: 14, to: 16, layout: "classroom",
      status: "pending", by: PRIYA },
    { event: "spm44_holder_rejected", venue: "SPM44-PLN", date: "2027-04-07", from: 14, to: 16, layout: "classroom",
      status: "rejected", by: PRIYA, reason: "Room needed for internal works." },
    { event: "spm44_holder_cancelled", venue: "SPM44-PLN", date: "2027-04-08", from: 14, to: 16, layout: "classroom",
      status: "cancelled", by: PRIYA, reason: "Released by the coordinator." },
    { event: "spm44_setup_holder", venue: "ORC-SEM", date: "2027-04-09", from: 14, to: 16, layout: "theatre",
      status: "approved", by: PRIYA },
    { event: "spm44_midnight_holder", venue: "ORC-SEM", date: "2027-04-12", from: 20, to: 22, layout: "theatre",
      status: "approved", by: PRIYA },
    // AC6: approved first, so the rival below can no longer be approved.
    { event: "spm44_approval_holder", venue: "SPM44-PLN", date: "2027-04-25", from: 14, to: 16, layout: "classroom",
      status: "approved", by: PRIYA },
    { event: "spm44_approval_rival", venue: "SPM44-PLN", date: "2027-04-25", from: 14, to: 16, layout: "classroom",
      status: "pending", by: "daniel.tan@connectsphere.com" },
  ];
  for (const b of spm44Bookings) {
    const decided = b.status !== "pending";
    await prisma.venueBooking.create({
      data: {
        eventId: events[b.event].id,
        venueId: venues[b.venue],
        layoutName: b.layout,
        startsAt: day(daysUntil(b.date), b.from),
        endsAt: day(daysUntil(b.date), b.to),
        status: b.status,
        requestedBy: users[b.by],
        requestedAt: day(-3),
        decidedBy: decided ? users["marcus.wong@connectsphere.com"] : undefined,
        decidedAt: decided ? day(-2) : undefined,
        decisionReason: b.reason,
      },
    });
  }
  await prisma.venueUnavailability.create({
    data: {
      venueId: venues["SPM44-PLN"],
      startsAt: day(daysUntil("2027-04-20"), 0),
      endsAt: day(daysUntil("2027-04-22"), 0),
      reason: "maintenance",
      notes: "SPM44 test block: air-handling unit replacement.",
      createdBy: users["marcus.wong@connectsphere.com"],
    },
  });

  // SPM-45 fixtures, the same as scripts/seed-spm45.ts. Each booking spans its
  // event's own times, placed against the period its test case records:
  //   SPM45-PER  each meets an edge of 10 Jun 13:00 - 15 Jun 13:00, two from
  //              outside it and two from inside (TC09)
  //   SPM45-SET  a turnaround that runs into 21 Jun 09:00 - 22 Jun 13:00, and a
  //              setup that starts as it ends (TC13)
  //   SPM45-STA  an approved, a pending and a finished booking (TC14)
  // and two periods that already exist - one under way (TC15, TC16), one that
  // has passed (TC17).
  const spm45Bookings: [string, string, string][] = [
    ["spm45_before", "SPM45-PER", "approved"],
    ["spm45_first", "SPM45-PER", "approved"],
    ["spm45_last", "SPM45-PER", "approved"],
    ["spm45_after", "SPM45-PER", "approved"],
    ["spm45_turnaround", "SPM45-SET", "approved"],
    ["spm45_setup", "SPM45-SET", "approved"],
    ["spm45_approved", "SPM45-STA", "approved"],
    ["spm45_pending", "SPM45-STA", "pending"],
    ["spm45_finished", "SPM45-STA", "approved"],
  ];
  for (const [event, venueCode, status] of spm45Bookings) {
    const approved = status === "approved";
    await prisma.venueBooking.create({
      data: {
        eventId: events[event].id,
        venueId: venues[venueCode],
        layoutName: "classroom",
        startsAt: events[event].startsAt!,
        endsAt: events[event].endsAt!,
        status,
        requestedBy: users["daniel.tan@connectsphere.com"],
        requestedAt: day(-3),
        decidedBy: approved ? users["marcus.wong@connectsphere.com"] : undefined,
        decidedAt: approved ? day(-2) : undefined,
      },
    });
  }
  // [venue, unavailable from (date, hour), available again (date, hour), reason]
  const spm45Periods: [string, string, number, string, number, string][] = [
    ["SPM45-NOW", "2026-10-01", 0, "2028-12-01", 9, "renovation"],
    ["SPM45-BAK", "2026-09-01", 0, "2026-10-01", 12, "maintenance"],
  ];
  for (const [code, from, fromHour, until, untilHour, reason] of spm45Periods) {
    await prisma.venueUnavailability.create({
      data: {
        venueId: venues[code],
        startsAt: day(daysUntil(from), fromHour),
        endsAt: day(daysUntil(until), untilHour),
        reason,
        createdBy: users["marcus.wong@connectsphere.com"],
      },
    });
  }

  // SPM-80 fixtures, the same as scripts/seed-spm80.ts. Each booking spans its
  // event's own times; SPM80 Follow-on Workshop has none (the cases request
  // it), and SPM80 Partner Meetup's is a pending request.
  const spm80Bookings: [string, string, string][] = [
    ["spm80_morning", "SPM80-TRN", "approved"],
    ["spm80_lunch", "SPM80-TRN", "approved"],
    ["spm80_evening", "SPM80-TRN", "approved"],
    ["spm80_past_first", "SPM80-TRN", "approved"],
    ["spm80_past_second", "SPM80-TRN", "approved"],
    ["spm80_demo", "SPM80-SET", "approved"],
    ["spm80_meetup", "SPM80-SET", "pending"],
    ["spm80_talk", "SPM80-MNT", "approved"],
    ["spm80_booked", "SPM80-REQ", "approved"],
  ];
  for (const [event, venueCode, status] of spm80Bookings) {
    const approved = status === "approved";
    await prisma.venueBooking.create({
      data: {
        eventId: events[event].id,
        venueId: venues[venueCode],
        layoutName: "classroom",
        startsAt: events[event].startsAt!,
        endsAt: events[event].endsAt!,
        status,
        requestedBy: users["daniel.tan@connectsphere.com"],
        requestedAt: day(-3),
        decidedBy: approved ? users["marcus.wong@connectsphere.com"] : undefined,
        decidedAt: approved ? day(-2) : undefined,
      },
    });
  }
  await prisma.venueUnavailability.create({
    data: {
      venueId: venues["SPM80-MNT"],
      startsAt: day(daysUntil("2027-08-05"), 14),
      endsAt: day(daysUntil("2027-08-05"), 16),
      reason: "maintenance",
      createdBy: users["marcus.wong@connectsphere.com"],
    },
  });

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
    // SPM-52's exact registrations come from `npm run fixtures:spm52`; random
    // ones would overfill its one- and two-place events.
    if (e.key.startsWith("spm52_")) continue;
    // SPM-65's exact registrations come from `npm run fixtures:spm65`.
    if (e.key.startsWith("spm65_")) continue;
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
