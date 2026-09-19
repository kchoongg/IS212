/**
 * ConnectSphere — demo seed data
 *
 * Run with:  npx prisma db seed
 *
 * Safe to re-run: it clears every table first, in reverse dependency order.
 * Dates are relative to the day you run it, so the calendar always has
 * past events (for reporting) and future ones (for the venue calendar).
 *
 * Replace PLACEHOLDER_HASH before any real demo — see the note at the bottom.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Every seeded account uses this password.
const DEMO_PASSWORD = "password123";

const now = new Date();
/** n days from today, at the given hour (local time). */
function day(n: number, hour = 9, minute = 0): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  d.setHours(hour, minute, 0, 0);
  return d;
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
  ];

  const events: Record<string, { id: string; startsAt: Date | null; endsAt: Date | null; days: number }> = {};

  for (const e of eventData) {
    const organiserId = users[`organiser:${e.organiser}`];
    const organiser = await prisma.user.findUnique({
      where: { id: organiserId },
      select: { organisationId: true },
    });
    const startsAt = e.status === "draft" ? null : day(e.days, e.startHour ?? 9);
    const endsAt = startsAt ? new Date(startsAt.getTime() + (e.durationHours ?? 4) * 3600_000) : null;

    const created = await prisma.event.create({
      data: {
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
  ];
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
    planning: ["submitted", "under_review", "approved", "planning"],
    confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
    completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
    rejected: ["submitted", "under_review", "rejected"],
    cancelled: ["submitted", "under_review", "approved", "planning", "cancelled"],
  };
  const REASONS: Record<string, string> = {
    under_review: "Coordinator assigned",
    approved: "Requirements sufficiently clear",
    planning: "Venue search started",
    confirmed: "Essential arrangements complete",
    completed: "Event took place",
    rejected: "Overnight occupancy not licensed",
    cancelled: "Client withdrew the request",
  };
  for (const e of eventData) {
    const chain = CHAIN[e.status];
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
  ];
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
        startsAt: new Date(ev.startsAt!.getTime() - 3 * 3600_000),
        endsAt: new Date(ev.endsAt!.getTime() + 2 * 3600_000),
        status,
        requestedBy: seed.coordinator ? users[seed.coordinator] : users["daniel.tan@connectsphere.com"],
        requestedAt: day(seed.days - 27),
        reviewedBy: reviewed ? users[techStaff[i % techStaff.length]] : undefined,
        reviewedAt: reviewed ? day(seed.days - 25) : undefined,
      },
    });
  }

  // -------------------------------------------------------------------
  // REGISTRATIONS
  // -------------------------------------------------------------------
  console.log("Creating registrations…");
  const dietary = [null, null, null, "Vegetarian", null, "No shellfish", null,
    "Halal", null, null, "Vegan", null, "No nuts", null, null];
  const access = [...Array(12).fill(null),
    "Wheelchair user - please reserve a front space",
    "Requires a hearing loop receiver", null];

  let regCount = 0;
  for (const e of eventData) {
    if (!e.regEnabled || !e.regCapacity) continue;
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
      proposedStartsAt: new Date(events["confirmed_briefing"].startsAt!.getTime() + 5 * 3600_000),
      proposedEndsAt: new Date(events["confirmed_briefing"].endsAt!.getTime() + 5 * 3600_000),
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
  console.log(`  equipment     : ${equipmentData.length}`);
  console.log(`  events        : ${eventData.length}`);
  console.log(`  bookings      : ${bookings.length}`);
  console.log(`  eq. requests  : ${eqReqs.length}`);
  console.log(`  registrations : ${regCount}`);
  console.log(`  notifications : ${notifs.length}`);
  console.log(`\nEvery account's password is: ${DEMO_PASSWORD}`);
  console.log("Log in as  daniel.tan@connectsphere.com  (coordinator)");
  console.log("       or  rachel.ng@meridianfinanc.com  (organiser)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
