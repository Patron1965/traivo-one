"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server/app.ts
var import_express4 = __toESM(require("express"));
var import_cors = __toESM(require("cors"));
var import_path = __toESM(require("path"));
var import_fs = __toESM(require("fs"));
var import_crypto = __toESM(require("crypto"));
var import_http = __toESM(require("http"));
var import_qrcode = __toESM(require("qrcode"));
var import_socket = require("socket.io");

// server/routes/mobile.ts
var import_express = require("express");

// server/db.ts
var import_pg = require("pg");
var pool = new import_pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 3e4,
  connectionTimeoutMillis: 5e3
});
pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});
async function initPushTokensTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id SERIAL PRIMARY KEY,
        driver_id VARCHAR(255) UNIQUE NOT NULL,
        expo_push_token VARCHAR(255) NOT NULL,
        platform VARCHAR(50) NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("push_tokens table ready");
  } catch (err) {
    console.error("Failed to create push_tokens table:", err.message);
  }
}
async function initTimeEntriesTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS time_entries (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        driver_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMP,
        duration_seconds INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("time_entries table ready");
  } catch (err) {
    console.error("Failed to create time_entries table:", err.message);
  }
}
async function initInspectionPhotosTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inspection_photos (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        driver_id VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        photo_slot VARCHAR(50) NOT NULL,
        base64_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_inspection_photos_order
      ON inspection_photos (order_id)
    `);
    console.log("inspection_photos table ready");
  } catch (err) {
    console.error("Failed to create inspection_photos table:", err.message);
  }
}
initPushTokensTable();
initTimeEntriesTable();
initInspectionPhotosTable();
async function sendPushNotification(driverId, title, body, data) {
  try {
    const result = await pool.query(
      "SELECT expo_push_token FROM push_tokens WHERE driver_id = $1",
      [driverId]
    );
    if (result.rows.length === 0) {
      return false;
    }
    const token = result.rows[0].expo_push_token;
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: token,
        sound: "default",
        title,
        body,
        data: data || {}
      })
    });
    const responseData = await response.json();
    if (responseData?.data?.status === "error") {
      const details = responseData.data.details;
      if (details?.error === "DeviceNotRegistered" || details?.error === "InvalidCredentials") {
        await pool.query("DELETE FROM push_tokens WHERE driver_id = $1", [driverId]);
        console.log(`Removed invalid push token for driver ${driverId}`);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Push notification error for driver ${driverId}:`, err.message);
    return false;
  }
}

// server/routes/mobile.ts
var router = (0, import_express.Router)();
var TRAIVO_API_URL = process.env.TRAIVO_API_URL || process.env.KINAB_API_URL || "";
var IS_MOCK_MODE = !TRAIVO_API_URL || process.env.TRAIVO_MOCK_MODE === "true" || process.env.KINAB_MOCK_MODE === "true";
async function traivoFetch(path2, options = {}) {
  const url = `${TRAIVO_API_URL}${path2}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5e3);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...options.headers || {}
      }
    });
    clearTimeout(timeout);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.error(`Traivo API returned non-JSON (${contentType}) for ${path2}`);
      throw new Error("Traivo-servern svarade inte med JSON (kan vara nere)");
    }
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (error) {
    clearTimeout(timeout);
    console.error(`Traivo API error (${path2}):`, error.message);
    throw new Error(`Kunde inte n\xE5 Traivo-servern: ${error.message}`);
  }
}
function getAuthHeader(req) {
  const auth = req.headers.authorization;
  return auth ? { "Authorization": auth } : {};
}
var MOCK_RESOURCE = {
  id: 101,
  tenantId: "traivo-demo",
  name: "Erik Lindqvist",
  type: "driver",
  role: "technician",
  phone: "070-111 22 33",
  email: "erik.lindqvist@traivo.se",
  vehicleRegNo: "ABC 123",
  homeLatitude: 57.7089,
  homeLongitude: 11.9746,
  competencies: ["ADR", "YKB", "C-k\xF6rkort"],
  executionCodes: ["T\xD6M", "H\xC4MT", "FARL"]
};
var MOCK_TOKEN = "mock-driver-token-001";
var MOCK_PROFILES = [
  {
    id: "rpa-1",
    resourceId: MOCK_RESOURCE.id,
    profileId: "rp-1",
    profile: {
      id: "rp-1",
      name: "K\xF6rprofil Lastbil",
      color: "#1B4B6B",
      icon: "truck",
      executionCodes: ["T\xD6M", "H\xC4MT"],
      equipmentTypes: ["Lastbil", "Kranbil"],
      defaultCostCenter: "KS-4010",
      projectCode: "PROJ-2026-A"
    },
    assignedAt: "2026-01-15T08:00:00Z",
    isPrimary: true
  },
  {
    id: "rpa-2",
    resourceId: MOCK_RESOURCE.id,
    profileId: "rp-2",
    profile: {
      id: "rp-2",
      name: "Handplock",
      color: "#4A9B9B",
      icon: "package",
      executionCodes: ["FARL", "SPEC"],
      equipmentTypes: ["Handk\xE4rra"],
      defaultCostCenter: "KS-5020",
      projectCode: "PROJ-2026-B"
    },
    assignedAt: "2026-02-01T08:00:00Z",
    isPrimary: false
  }
];
var MOCK_TEAM = {
  id: "team-1",
  name: "Team G\xF6teborg V\xE4st",
  description: "Kranbilsteam f\xF6r v\xE4stra G\xF6teborg",
  color: "#4A9B9B",
  leaderId: MOCK_RESOURCE.id,
  clusterId: "cluster-gw",
  serviceArea: ["41101", "41102", "41103"],
  projectCode: "PROJ-2026-A",
  profileId: MOCK_PROFILES[0]?.profileId || null,
  status: "active",
  members: [
    {
      id: "tm-1",
      resourceId: MOCK_RESOURCE.id,
      name: MOCK_RESOURCE.name,
      role: "leader",
      phone: MOCK_RESOURCE.phone,
      email: MOCK_RESOURCE.email,
      isOnline: true,
      latitude: 57.7089,
      longitude: 11.9746
    },
    {
      id: "tm-2",
      resourceId: 202,
      name: "Anna Johansson",
      role: "member",
      phone: "070-222 33 44",
      email: "anna.johansson@traivo.se",
      isOnline: true,
      latitude: 57.7055,
      longitude: 11.969
    }
  ]
};
var MOCK_RESOURCES = [
  MOCK_RESOURCE,
  { id: 202, name: "Anna Johansson", phone: "070-222 33 44", email: "anna.johansson@traivo.se", type: "driver" },
  { id: 303, name: "Karl Eriksson", phone: "070-333 44 55", email: "karl.eriksson@traivo.se", type: "driver" },
  { id: 404, name: "Maria Nilsson", phone: "070-444 55 66", email: "maria.nilsson@traivo.se", type: "driver" }
];
var MOCK_TEAM_INVITES = [];
var MOCK_MATERIAL_LOGS = [];
var MOCK_NOTIFICATIONS = [
  { id: "n1", type: "schedule_change", title: "Rutt\xE4ndring", message: "Order WO-2026-0453 har flyttats till kl 10:00", isRead: false, createdAt: new Date(Date.now() - 36e5).toISOString(), orderId: "3" },
  { id: "n2", type: "urgent", title: "Br\xE5dskande uppdrag", message: "Nytt h\xE4mtuppdrag tillagt: G\xF6teborgs Hamn AB", isRead: false, createdAt: new Date(Date.now() - 72e5).toISOString(), orderId: "5" },
  { id: "n3", type: "info", title: "Systeminformation", message: "Ny version av appen tillg\xE4nglig", isRead: true, createdAt: new Date(Date.now() - 864e5).toISOString() }
];
var MOCK_ORDERS = [
  {
    id: 1,
    orderNumber: "WO-2026-0451",
    status: "planned",
    customerName: "BRF Solsidan",
    address: "Storgatan 12",
    city: "G\xF6teborg",
    postalCode: "411 01",
    latitude: 57.7089,
    longitude: 11.9746,
    what3words: "fest.lampa.skog",
    scheduledDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    scheduledTimeStart: "08:00",
    scheduledTimeEnd: "09:00",
    description: "T\xF6mning av k\xE4rl - Hush\xE5llsavfall 370L",
    notes: "Porten har kod 1234",
    objectType: "K\xE4rl",
    objectId: 501,
    clusterId: 10,
    clusterName: "Centrum Norr",
    priority: "normal",
    executionStatus: "not_started",
    object: { id: 501, name: "Sopstation Storgatan 12", address: "Storgatan 12", latitude: 57.7089, longitude: 11.9746, what3words: "fest.lampa.skog" },
    customer: { id: 201, name: "BRF Solsidan", customerNumber: "KN-2201" },
    articles: [
      { id: 1, name: "Hush\xE5llsavfall 370L", articleNumber: "ART-001", unit: "st", quantity: 4, category: "Avfall", isSeasonal: false },
      { id: 2, name: "Matavfall 140L", articleNumber: "ART-002", unit: "st", quantity: 2, category: "Avfall", isSeasonal: false }
    ],
    contacts: [
      { id: 1, name: "Anna Karlsson", phone: "070-123 45 67", email: "anna@brfsolsidan.se", role: "Fastighetssk\xF6tare" }
    ],
    estimatedDuration: 15,
    photos: [],
    deviations: [],
    sortOrder: 1,
    executionCodes: [{ id: 1, code: "T\xD6M", name: "T\xF6mning" }],
    timeRestrictions: [],
    subSteps: [
      { id: 1, name: "H\xE4mta k\xE4rl fr\xE5n g\xE5rd", articleName: "Hush\xE5llsavfall 370L", completed: false, sortOrder: 1 },
      { id: 2, name: "T\xF6m i fordon", articleName: "Hush\xE5llsavfall 370L", completed: false, sortOrder: 2 },
      { id: 3, name: "\xC5terst\xE4ll k\xE4rl", articleName: "Hush\xE5llsavfall 370L", completed: false, sortOrder: 3 },
      { id: 4, name: "H\xE4mta matavfall", articleName: "Matavfall 140L", completed: false, sortOrder: 4 },
      { id: 5, name: "T\xF6m matavfall", articleName: "Matavfall 140L", completed: false, sortOrder: 5 }
    ],
    dependencies: [],
    isLocked: false,
    orderNotes: [
      { id: 1, orderId: 1, text: "Ny kod p\xE5 porten sedan f\xF6rra veckan", createdBy: "Kontor", createdAt: new Date(Date.now() - 864e5).toISOString() }
    ],
    inspections: [],
    creationMethod: "schema",
    resourceId: 101,
    tenantId: "traivo-demo"
  },
  {
    id: 2,
    orderNumber: "WO-2026-0452",
    status: "planned",
    customerName: "Fastighets AB Norden",
    address: "Vasagatan 28",
    city: "G\xF6teborg",
    postalCode: "411 37",
    latitude: 57.7045,
    longitude: 11.9664,
    scheduledDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    scheduledTimeStart: "09:15",
    scheduledTimeEnd: "09:45",
    description: "T\xF6mning av k\xE4rl - Restavfall och kartong",
    notes: "K\xE4rlen st\xE5r i g\xE5rden, g\xE5 genom port till v\xE4nster",
    objectType: "K\xE4rl",
    objectId: 502,
    clusterId: 10,
    clusterName: "Centrum Norr",
    priority: "normal",
    executionStatus: "not_started",
    object: { id: 502, name: "Soprum Vasagatan", address: "Vasagatan 28", latitude: 57.7045, longitude: 11.9664 },
    customer: { id: 202, name: "Fastighets AB Norden", customerNumber: "KN-2202" },
    articles: [
      { id: 3, name: "Restavfall 660L", articleNumber: "ART-003", unit: "st", quantity: 2, category: "Avfall", isSeasonal: false },
      { id: 4, name: "Kartong 660L", articleNumber: "ART-004", unit: "st", quantity: 1, category: "\xC5tervinning", isSeasonal: false }
    ],
    contacts: [
      { id: 2, name: "Lars Svensson", phone: "073-456 78 90", role: "Driftansvarig" }
    ],
    estimatedDuration: 20,
    photos: [],
    deviations: [],
    sortOrder: 2,
    executionCodes: [{ id: 1, code: "T\xD6M", name: "T\xF6mning" }],
    timeRestrictions: [
      { id: 1, type: "parking_ban", description: "P-f\xF6rbud vardagar 07-09", dayOfWeek: void 0, startTime: "07:00", endTime: "09:00", isActive: true }
    ],
    subSteps: [],
    dependencies: [
      { id: 1, dependsOnOrderId: 1, dependsOnOrderNumber: "WO-2026-0451", dependsOnStatus: "completed", isBlocking: false }
    ],
    isLocked: false,
    orderNotes: [],
    inspections: [],
    creationMethod: "avrop",
    resourceId: 101,
    tenantId: "traivo-demo"
  },
  {
    id: 3,
    orderNumber: "WO-2026-0453",
    status: "planned",
    customerName: "Chalmers Tekniska H\xF6gskola",
    address: "Chalmers\xE4ngen 4",
    city: "G\xF6teborg",
    postalCode: "412 96",
    latitude: 57.6896,
    longitude: 11.977,
    what3words: "b\xF6cker.glas.rikt",
    scheduledDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    scheduledTimeStart: "10:00",
    scheduledTimeEnd: "10:45",
    description: "T\xF6mning av containrar - Bygg och verksamhetsavfall",
    notes: "Anm\xE4l vid reception vid leveransentr\xE9n",
    objectType: "Container",
    objectId: 503,
    clusterId: 11,
    clusterName: "Centrum S\xF6der",
    priority: "high",
    executionStatus: "not_started",
    object: { id: 503, name: "Chalmers Leveransentr\xE9", address: "Chalmers\xE4ngen 4", latitude: 57.6896, longitude: 11.977, what3words: "b\xF6cker.glas.rikt" },
    customer: { id: 203, name: "Chalmers Tekniska H\xF6gskola", customerNumber: "KN-2203" },
    articles: [
      { id: 5, name: "Byggavfall container 8m\xB3", articleNumber: "ART-005", unit: "st", quantity: 1, category: "Bygg", isSeasonal: false },
      { id: 6, name: "Verksamhetsavfall 1100L", articleNumber: "ART-006", unit: "st", quantity: 3, category: "Avfall", isSeasonal: false }
    ],
    contacts: [
      { id: 3, name: "Maria Berg", phone: "031-772 10 00", email: "maria.berg@chalmers.se", role: "Milj\xF6samordnare" },
      { id: 4, name: "Johan Ek", phone: "070-987 65 43", role: "Vaktm\xE4stare" }
    ],
    estimatedDuration: 30,
    photos: [],
    deviations: [],
    sortOrder: 3,
    executionCodes: [
      { id: 2, code: "H\xC4MT", name: "H\xE4mtning" },
      { id: 3, code: "FARL", name: "Farligt avfall" }
    ],
    timeRestrictions: [
      { id: 2, type: "quiet_hours", description: "Tysta timmar 22-07, f\xF6rel\xE4sningar p\xE5g\xE5r", startTime: "22:00", endTime: "07:00", isActive: false },
      { id: 3, type: "access_restriction", description: "Kr\xE4ver passerkort vardagar", isActive: true }
    ],
    subSteps: [
      { id: 6, name: "Kontrollera container", articleName: "Byggavfall container 8m\xB3", completed: false, sortOrder: 1 },
      { id: 7, name: "Lyfta container", articleName: "Byggavfall container 8m\xB3", completed: false, sortOrder: 2 },
      { id: 8, name: "Byt container", articleName: "Byggavfall container 8m\xB3", completed: false, sortOrder: 3 },
      { id: 9, name: "T\xF6m verksamhetsavfall", articleName: "Verksamhetsavfall 1100L", completed: false, sortOrder: 4 }
    ],
    dependencies: [],
    isLocked: false,
    orderNotes: [
      { id: 2, orderId: 3, text: "Ny parkeringsplats vid leveransentr\xE9n fr\xE5n mars", createdBy: "Planerare", createdAt: new Date(Date.now() - 1728e5).toISOString() }
    ],
    inspections: [],
    creationMethod: "manual",
    resourceId: 101,
    tenantId: "traivo-demo"
  },
  {
    id: 4,
    orderNumber: "WO-2026-0454",
    status: "planned",
    customerName: "ICA Maxi M\xF6lndal",
    address: "G\xF6teborgsv\xE4gen 88",
    city: "M\xF6lndal",
    postalCode: "431 37",
    latitude: 57.6557,
    longitude: 12.0134,
    scheduledDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    scheduledTimeStart: "11:00",
    scheduledTimeEnd: "11:30",
    description: "T\xF6mning av komprimator - Kartong och plast",
    objectType: "Komprimator",
    objectId: 504,
    clusterId: 12,
    clusterName: "M\xF6lndal",
    priority: "normal",
    executionStatus: "not_started",
    object: { id: 504, name: "ICA Maxi Komprimator", address: "G\xF6teborgsv\xE4gen 88", latitude: 57.6557, longitude: 12.0134 },
    customer: { id: 204, name: "ICA Maxi M\xF6lndal", customerNumber: "KN-2204" },
    articles: [
      { id: 7, name: "Kartongkomprimator", articleNumber: "ART-007", unit: "st", quantity: 1, category: "\xC5tervinning", isSeasonal: false },
      { id: 8, name: "Plastkomprimator", articleNumber: "ART-008", unit: "st", quantity: 1, category: "\xC5tervinning", isSeasonal: false }
    ],
    contacts: [
      { id: 5, name: "Per Nilsson", phone: "071-234 56 78", role: "Butikschef" }
    ],
    estimatedDuration: 25,
    photos: [],
    deviations: [],
    sortOrder: 4,
    executionCodes: [{ id: 1, code: "T\xD6M", name: "T\xF6mning" }],
    timeRestrictions: [
      { id: 4, type: "emptying_day", description: "T\xF6mning endast m\xE5n, ons, fre", dayOfWeek: 1, isActive: false }
    ],
    subSteps: [],
    dependencies: [
      { id: 2, dependsOnOrderId: 3, dependsOnOrderNumber: "WO-2026-0453", dependsOnStatus: "dispatched", isBlocking: true }
    ],
    isLocked: true,
    orderNotes: [],
    inspections: [],
    creationMethod: "schema",
    resourceId: 101,
    tenantId: "traivo-demo"
  },
  {
    id: 5,
    orderNumber: "WO-2026-0455",
    status: "planned",
    customerName: "G\xF6teborgs Hamn AB",
    address: "Terminalgatan 2",
    city: "G\xF6teborg",
    postalCode: "403 14",
    latitude: 57.7148,
    longitude: 11.9414,
    scheduledDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    scheduledTimeStart: "13:00",
    scheduledTimeEnd: "14:00",
    description: "H\xE4mtning av farligt avfall - Oljor och kemikalier",
    notes: "S\xE4kerhetsutrustning kr\xE4vs. Kontakta hamnchefen vid ankomst.",
    objectType: "K\xE4rl",
    objectId: 505,
    priority: "urgent",
    executionStatus: "not_started",
    object: { id: 505, name: "Hamn Terminal 2", address: "Terminalgatan 2", latitude: 57.7148, longitude: 11.9414 },
    customer: { id: 205, name: "G\xF6teborgs Hamn AB", customerNumber: "KN-2205" },
    articles: [
      { id: 9, name: "Spillolja 200L fat", articleNumber: "ART-009", unit: "st", quantity: 2, category: "Farligt avfall", isSeasonal: false },
      { id: 10, name: "Kemikaliecontainer", articleNumber: "ART-010", unit: "st", quantity: 1, category: "Farligt avfall", isSeasonal: false }
    ],
    contacts: [
      { id: 6, name: "Karin Holm", phone: "031-368 75 00", email: "karin.holm@port.goteborg.se", role: "Hamnchef" }
    ],
    estimatedDuration: 45,
    photos: [],
    deviations: [],
    sortOrder: 5,
    executionCodes: [
      { id: 3, code: "FARL", name: "Farligt avfall" },
      { id: 4, code: "SPEC", name: "Specialuppdrag" }
    ],
    timeRestrictions: [],
    subSteps: [
      { id: 10, name: "Kontrollera s\xE4kerhetsutrustning", articleName: "Spillolja 200L fat", completed: false, sortOrder: 1 },
      { id: 11, name: "Dokumentera fat-ID", articleName: "Spillolja 200L fat", completed: false, sortOrder: 2 },
      { id: 12, name: "Lasta fat", articleName: "Spillolja 200L fat", completed: false, sortOrder: 3 },
      { id: 13, name: "Lasta kemikaliecontainer", articleName: "Kemikaliecontainer", completed: false, sortOrder: 4 },
      { id: 14, name: "Signera transportdokument", articleName: "Kemikaliecontainer", completed: false, sortOrder: 5 }
    ],
    dependencies: [],
    isLocked: false,
    orderNotes: [
      { id: 3, orderId: 5, text: "ADR-certifikat kr\xE4vs f\xF6r denna transport", createdBy: "System", createdAt: new Date(Date.now() - 36e5).toISOString() },
      { id: 4, orderId: 5, text: "Kontakta hamnchef Karin Holm minst 30 min innan ankomst", createdBy: "Planerare", createdAt: new Date(Date.now() - 72e5).toISOString() }
    ],
    inspections: [],
    creationMethod: "avrop",
    resourceId: 101,
    tenantId: "traivo-demo"
  }
];
var MOCK_ARTICLES = [
  { id: 1, name: "Hush\xE5llsavfall 140L", articleNumber: "ART-001", unit: "st", category: "Avfall" },
  { id: 2, name: "Hush\xE5llsavfall 370L", articleNumber: "ART-002", unit: "st", category: "Avfall" },
  { id: 3, name: "Matavfall 140L", articleNumber: "ART-003", unit: "st", category: "Avfall" },
  { id: 4, name: "Restavfall 660L", articleNumber: "ART-004", unit: "st", category: "Avfall" },
  { id: 5, name: "Kartong 660L", articleNumber: "ART-005", unit: "st", category: "\xC5tervinning" },
  { id: 6, name: "Plast 660L", articleNumber: "ART-006", unit: "st", category: "\xC5tervinning" },
  { id: 7, name: "Glas - f\xE4rgat 600L", articleNumber: "ART-007", unit: "st", category: "\xC5tervinning" },
  { id: 8, name: "Glas - of\xE4rgat 600L", articleNumber: "ART-008", unit: "st", category: "\xC5tervinning" },
  { id: 9, name: "Metall 240L", articleNumber: "ART-009", unit: "st", category: "\xC5tervinning" },
  { id: 10, name: "Tidningar 660L", articleNumber: "ART-010", unit: "st", category: "\xC5tervinning" },
  { id: 11, name: "Tr\xE4dg\xE5rdsavfall 370L", articleNumber: "ART-011", unit: "st", category: "Avfall" },
  { id: 12, name: "Byggavfall container 8m\xB3", articleNumber: "ART-012", unit: "st", category: "Bygg" },
  { id: 13, name: "Verksamhetsavfall 1100L", articleNumber: "ART-013", unit: "st", category: "Avfall" },
  { id: 14, name: "Spillolja 200L fat", articleNumber: "ART-014", unit: "st", category: "Farligt avfall" },
  { id: 15, name: "Kemikaliecontainer", articleNumber: "ART-015", unit: "st", category: "Farligt avfall" }
];
var MOCK_CHECKLIST_TEMPLATES = {
  "K\xE4rl": {
    templateId: "tmpl-karl",
    name: "K\xE4rlkontroll",
    articleType: "K\xE4rl",
    questions: [
      { id: "q1", text: "\xC4r k\xE4rlet skadat?", type: "boolean", photoRequired: true, photoType: "before_after" },
      { id: "q2", text: "\xC4r k\xE4rlet \xF6verfyllt?", type: "boolean", photoRequired: true, photoType: "single" },
      { id: "q3", text: "Finns felsortering?", type: "boolean", photoRequired: true, photoType: "single" },
      { id: "q4", text: "Tillg\xE4nglighet", type: "select", options: ["Bra", "Begr\xE4nsad", "Blockerad"] },
      { id: "q5", text: "Kommentar", type: "text" }
    ]
  },
  "Container": {
    templateId: "tmpl-container",
    name: "Containerkontroll",
    articleType: "Container",
    questions: [
      { id: "q1", text: "\xC4r containern skadad?", type: "boolean", photoRequired: true, photoType: "before_after" },
      { id: "q2", text: "Finns l\xE4ckage?", type: "boolean", photoRequired: true, photoType: "single" },
      { id: "q3", text: "Fyllnadsgrad", type: "select", options: ["Under 50%", "50-75%", "75-100%", "\xD6verfylld"] },
      { id: "q4", text: "Kommentar", type: "text" }
    ]
  },
  "Komprimator": {
    templateId: "tmpl-komprimator",
    name: "Komprimatorkontroll",
    articleType: "Komprimator",
    questions: [
      { id: "q1", text: "Fungerar komprimatorn?", type: "boolean", photoRequired: true, photoType: "single" },
      { id: "q2", text: "Finns hydraulikl\xE4ckage?", type: "boolean", photoRequired: true, photoType: "single" },
      { id: "q3", text: "Fyllnadsgrad", type: "select", options: ["Under 50%", "50-75%", "75-100%", "\xD6verfylld"] },
      { id: "q4", text: "Kommentar", type: "text" }
    ]
  }
};
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function mapTraivoStatus(traivoStatus, orderStatus) {
  const statusMap = {
    "draft": "planned",
    "scheduled": "planned",
    "dispatched": "dispatched",
    "on_site": "on_site",
    "in_progress": "in_progress",
    "completed": "completed",
    "failed": "failed",
    "cancelled": "cancelled",
    "impossible": "failed"
  };
  return statusMap[traivoStatus] || statusMap[orderStatus || ""] || "planned";
}
function parseAddressParts(fullAddress) {
  if (!fullAddress) return { address: "", city: "", postalCode: "" };
  const parts = fullAddress.split(",").map((s) => s.trim());
  return {
    address: parts[0] || fullAddress,
    city: parts[1] || "",
    postalCode: parts[2] || ""
  };
}
function transformTraivoOrder(raw) {
  const addrParts = parseAddressParts(raw.objectAddress || "");
  return {
    id: raw.id,
    orderNumber: raw.title || raw.externalReference || `ORD-${(raw.id || "").toString().slice(0, 8)}`,
    status: mapTraivoStatus(raw.status, raw.orderStatus),
    customerName: raw.customerName || "Ok\xE4nd kund",
    address: addrParts.address,
    city: addrParts.city,
    postalCode: addrParts.postalCode,
    latitude: raw.taskLatitude || 0,
    longitude: raw.taskLongitude || 0,
    what3words: raw.what3words || void 0,
    scheduledDate: raw.scheduledDate ? raw.scheduledDate.split("T")[0] : (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    scheduledTimeStart: raw.scheduledStartTime || void 0,
    scheduledTimeEnd: void 0,
    scheduledStartTime: raw.scheduledStartTime || void 0,
    scheduledEndTime: void 0,
    title: raw.title || "",
    description: raw.description || "",
    notes: raw.notes || raw.plannedNotes || "",
    objectType: raw.orderType || "",
    objectId: raw.objectId || "",
    clusterId: raw.clusterId || void 0,
    clusterName: void 0,
    priority: raw.priority || "normal",
    articles: [],
    contacts: raw.customerPhone ? [{ id: "c1", name: raw.customerName || "", phone: raw.customerPhone, role: "Kund" }] : [],
    estimatedDuration: raw.estimatedDuration || 30,
    actualStartTime: raw.onSiteAt || void 0,
    actualEndTime: void 0,
    completedAt: raw.completedAt || void 0,
    signatureUrl: void 0,
    photos: [],
    deviations: [],
    sortOrder: 0,
    executionCodes: raw.executionCode ? [{ id: raw.executionCode, code: raw.executionCode, name: raw.executionCode }] : [],
    timeRestrictions: [],
    subSteps: [],
    dependencies: [],
    isLocked: raw.lockedAt ? true : false,
    orderNotes: [],
    inspections: [],
    executionStatus: raw.executionStatus || raw.execution_status || "not_started",
    creationMethod: raw.creationMethod || raw.creation_method || "manual",
    object: raw.objectName ? {
      id: raw.objectId,
      name: raw.objectName,
      address: raw.objectAddress || "",
      latitude: raw.taskLatitude || 0,
      longitude: raw.taskLongitude || 0,
      what3words: raw.what3words || void 0
    } : void 0,
    customer: raw.customerName ? {
      id: raw.customerId,
      name: raw.customerName
    } : void 0,
    resourceId: raw.resourceId,
    tenantId: raw.tenantId,
    metadata: raw.metadata
  };
}
router.post("/login", async (req, res) => {
  if (IS_MOCK_MODE) {
    const { username, password, pin, email } = req.body;
    if (email && pin) {
      if (pin.length === 4 || pin.length === 6) {
        res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
      } else {
        res.status(401).json({ success: false, error: "Ogiltig PIN-kod" });
      }
    } else if (pin) {
      if (pin.length === 4 || pin.length === 6) {
        res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
      } else {
        res.status(401).json({ success: false, error: "Ogiltig PIN-kod" });
      }
    } else if (username && password) {
      res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
    } else {
      res.status(401).json({ success: false, error: "Ogiltiga inloggningsuppgifter" });
    }
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/login", {
      method: "POST",
      body: JSON.stringify(req.body)
    });
    if (status === 200 && data.token) {
      const resource = data.resource || data.user || {};
      res.json({
        success: true,
        token: data.token,
        resource
      });
    } else {
      res.status(status || 401).json({
        success: false,
        error: data.error || data.message || "Inloggningen misslyckades"
      });
    }
  } catch (error) {
    console.error("Login proxy error, falling back to mock login:", error.message);
    const { username, password, pin, email } = req.body;
    if (email && pin && (pin.length === 4 || pin.length === 6) || pin && (pin.length === 4 || pin.length === 6)) {
      res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
    } else if (username && password) {
      res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
    } else {
      res.status(503).json({
        success: false,
        error: "Kunde inte n\xE5 inloggningsservern. F\xF6rs\xF6k igen om en stund."
      });
    }
  }
});
router.post("/logout", async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ success: true });
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/logout", {
      method: "POST",
      headers: getAuthHeader(req)
    });
    res.status(status).json(data);
  } catch {
    res.json({ success: true });
  }
});
router.get("/me", async (req, res) => {
  if (IS_MOCK_MODE) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.includes(MOCK_TOKEN)) {
      res.json({ success: true, resource: MOCK_RESOURCE });
    } else {
      res.status(401).json({ success: false, error: "Ej autentiserad" });
    }
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/me", {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (status === 200) {
      if (data.success !== void 0) {
        res.json(data);
      } else {
        res.json({ success: true, resource: data });
      }
    } else {
      res.status(status).json({
        success: false,
        error: data.error || data.message || "Ej autentiserad"
      });
    }
  } catch (error) {
    console.error("Me proxy error:", error.message);
    res.status(503).json({
      success: false,
      error: "Kunde inte verifiera sessionen. F\xF6rs\xF6k igen."
    });
  }
});
router.get("/my-profiles", async (req, res) => {
  if (IS_MOCK_MODE) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.includes(MOCK_TOKEN)) {
      res.json({ success: true, assignments: MOCK_PROFILES });
    } else {
      res.status(401).json({ success: false, error: "Ej autentiserad" });
    }
    return;
  }
  try {
    const meResponse = await traivoFetch("/api/mobile/me", {
      method: "GET",
      headers: getAuthHeader(req)
    });
    const resourceId = meResponse.data?.resource?.id || meResponse.data?.id;
    if (!resourceId) {
      res.status(401).json({ success: false, error: "Kunde inte identifiera resursen" });
      return;
    }
    const { status, data } = await traivoFetch(`/resource_profile_assignments?resourceId=${resourceId}`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (status === 200) {
      const assignments = Array.isArray(data) ? data : data.assignments || data.data || [];
      res.json({ success: true, assignments });
    } else {
      res.status(status).json({
        success: false,
        error: data.error || data.message || "Kunde inte h\xE4mta profiler"
      });
    }
  } catch (error) {
    console.error("Profiles proxy error:", error.message);
    res.status(503).json({
      success: false,
      error: "Kunde inte h\xE4mta profiler. F\xF6rs\xF6k igen."
    });
  }
});
router.get("/my-team", async (req, res) => {
  if (IS_MOCK_MODE) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.includes(MOCK_TOKEN)) {
      res.json({ success: true, team: MOCK_TEAM });
    } else {
      res.status(401).json({ success: false, error: "Ej autentiserad" });
    }
    return;
  }
  try {
    const meResponse = await traivoFetch("/api/mobile/me", {
      method: "GET",
      headers: getAuthHeader(req)
    });
    const resourceId = meResponse.data?.resource?.id || meResponse.data?.id;
    if (!resourceId) {
      res.status(401).json({ success: false, error: "Kunde inte identifiera resursen" });
      return;
    }
    const { status, data } = await traivoFetch(`/api/teams?memberId=${resourceId}&status=active`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (status === 200) {
      const teams = Array.isArray(data) ? data : data.teams || data.data || [];
      const activeTeam = teams.find((t) => t.status === "active") || teams[0] || null;
      res.json({ success: true, team: activeTeam });
    } else {
      res.json({ success: true, team: null });
    }
  } catch (error) {
    console.error("Team proxy error:", error.message);
    res.status(503).json({
      success: false,
      error: "Kunde inte h\xE4mta teaminfo. F\xF6rs\xF6k igen."
    });
  }
});
router.post("/teams", async (req, res) => {
  if (IS_MOCK_MODE) {
    const { name, description, color, memberId } = req.body;
    if (!name) {
      res.status(400).json({ error: "Teamnamn kr\xE4vs" });
      return;
    }
    const partner = MOCK_RESOURCES.find((r) => r.id === memberId);
    MOCK_TEAM.id = "team-" + Date.now();
    MOCK_TEAM.name = name;
    MOCK_TEAM.description = description || "";
    MOCK_TEAM.color = color || "#4A9B9B";
    MOCK_TEAM.status = "active";
    MOCK_TEAM.leaderId = MOCK_RESOURCE.id;
    MOCK_TEAM.members = [
      { id: "tm-1", resourceId: MOCK_RESOURCE.id, name: MOCK_RESOURCE.name, role: "leader", phone: MOCK_RESOURCE.phone, email: MOCK_RESOURCE.email, isOnline: true }
    ];
    if (partner) {
      MOCK_TEAM.members.push({ id: "tm-" + partner.id, resourceId: partner.id, name: partner.name, role: "member", phone: partner.phone, email: partner.email, isOnline: false });
    }
    res.json({ success: true, team: MOCK_TEAM });
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/teams", { method: "POST", headers: getAuthHeader(req), body: JSON.stringify(req.body) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte skapa team." });
  }
});
router.post("/teams/:id/invite", async (req, res) => {
  if (IS_MOCK_MODE) {
    const { resourceId } = req.body;
    const resource = MOCK_RESOURCES.find((r) => r.id === resourceId);
    if (!resource) {
      res.status(404).json({ error: "Resurs hittades inte" });
      return;
    }
    const invite = { id: "inv-" + Date.now(), teamId: req.params.id, resourceId, resourceName: resource.name, status: "pending", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    MOCK_TEAM_INVITES.push(invite);
    const io2 = req.app.io;
    if (io2) {
      io2.to(`resource:${resourceId}`).emit("team:invite", { invite, teamName: MOCK_TEAM.name });
    }
    res.json({ success: true, invite });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/teams/${req.params.id}/invite`, { method: "POST", headers: getAuthHeader(req), body: JSON.stringify(req.body) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte skicka inbjudan." });
  }
});
router.post("/teams/:id/accept", async (req, res) => {
  if (IS_MOCK_MODE) {
    const invite = MOCK_TEAM_INVITES.find((i) => i.teamId === req.params.id && i.status === "pending");
    if (invite) {
      invite.status = "accepted";
      const resource = MOCK_RESOURCES.find((r) => r.id === invite.resourceId);
      if (resource && !MOCK_TEAM.members.find((m) => m.resourceId === resource.id)) {
        MOCK_TEAM.members.push({ id: "tm-" + resource.id, resourceId: resource.id, name: resource.name, role: "member", phone: resource.phone, email: resource.email, isOnline: false });
      }
    }
    res.json({ success: true, team: MOCK_TEAM });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/teams/${req.params.id}/accept`, { method: "POST", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte acceptera inbjudan." });
  }
});
router.post("/teams/:id/leave", async (req, res) => {
  if (IS_MOCK_MODE) {
    MOCK_TEAM.members = MOCK_TEAM.members.filter((m) => m.resourceId !== MOCK_RESOURCE.id);
    if (MOCK_TEAM.members.length === 0) {
      MOCK_TEAM.status = "inactive";
    }
    const io2 = req.app.io;
    if (io2) {
      io2.to(`team:${req.params.id}`).emit("team:member_left", { resourceId: MOCK_RESOURCE.id, name: MOCK_RESOURCE.name });
    }
    res.json({ success: true });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/teams/${req.params.id}/leave`, { method: "POST", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte l\xE4mna teamet." });
  }
});
router.delete("/teams/:id", async (req, res) => {
  if (IS_MOCK_MODE) {
    MOCK_TEAM.status = "inactive";
    MOCK_TEAM.members = [];
    res.json({ success: true });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/teams/${req.params.id}`, { method: "DELETE", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte ta bort teamet." });
  }
});
router.get("/resources/search", async (req, res) => {
  if (IS_MOCK_MODE) {
    const q = (req.query.q || "").toLowerCase();
    const results = MOCK_RESOURCES.filter((r) => r.id !== MOCK_RESOURCE.id && r.name.toLowerCase().includes(q));
    res.json(results);
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/resources/search?q=${encodeURIComponent(req.query.q || "")}`, { method: "GET", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte s\xF6ka resurser." });
  }
});
router.get("/team-invites", async (req, res) => {
  if (IS_MOCK_MODE) {
    const pending = MOCK_TEAM_INVITES.filter((i) => i.resourceId === MOCK_RESOURCE.id && i.status === "pending");
    res.json(pending);
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/team-invites", { method: "GET", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte h\xE4mta inbjudningar." });
  }
});
router.get("/my-orders", async (req, res) => {
  if (IS_MOCK_MODE) {
    const date = req.query.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const orders = MOCK_ORDERS.filter((o) => o.scheduledDate === date);
    const teamMemberIds = MOCK_TEAM.status === "active" ? MOCK_TEAM.members.map((m) => m.resourceId) : [];
    const tagged = orders.map((o) => ({
      ...o,
      isTeamOrder: teamMemberIds.length > 1 && teamMemberIds.includes(o.resourceId),
      teamName: teamMemberIds.length > 1 && teamMemberIds.includes(o.resourceId) ? MOCK_TEAM.name : void 0
    }));
    res.json(tagged);
    return;
  }
  try {
    const queryString = req.query.date ? `?date=${req.query.date}` : "";
    const { status, data } = await traivoFetch(`/api/mobile/my-orders${queryString}`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (status === 200) {
      const rawOrders = Array.isArray(data) ? data : data.orders || [];
      const transformed = rawOrders.map(transformTraivoOrder);
      res.json(transformed);
    } else {
      res.status(status).json(data);
    }
  } catch (error) {
    console.error("My-orders proxy error:", error.message);
    res.status(503).json({ error: "Kunde inte h\xE4mta ordrar. F\xF6rs\xF6k igen." });
  }
});
router.get("/orders/:id", async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => o.id === parseInt(req.params.id));
    if (order) {
      res.json(order);
    } else {
      res.status(404).json({ error: "Order hittades inte" });
    }
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (status === 200 && data) {
      res.json(transformTraivoOrder(data));
    } else {
      res.status(status).json(data);
    }
  } catch (error) {
    res.status(503).json({ error: "Kunde inte h\xE4mta order. F\xF6rs\xF6k igen." });
  }
});
router.get("/orders/:id/checklist", async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => o.id === parseInt(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Order hittades inte" });
      return;
    }
    const articleTypes = [...new Set(order.articles.map((a) => a.category))];
    const objectTemplate = MOCK_CHECKLIST_TEMPLATES[order.objectType];
    const checklists = objectTemplate ? [objectTemplate] : [];
    res.json({ orderId: order.id.toString(), articleTypes, checklists });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/checklist`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte h\xE4mta checklista. F\xF6rs\xF6k igen." });
  }
});
async function handleTimeEntries(orderId, driverId, newStatus) {
  const now = /* @__PURE__ */ new Date();
  try {
    if (newStatus === "dispatched") {
      await pool.query(
        `INSERT INTO time_entries (order_id, driver_id, status, started_at) VALUES ($1, $2, 'travel', $3)`,
        [orderId, driverId, now]
      );
    } else if (newStatus === "on_site") {
      await pool.query(
        `UPDATE time_entries SET ended_at = $1, duration_seconds = EXTRACT(EPOCH FROM ($1 - started_at))::integer WHERE order_id = $2 AND driver_id = $3 AND status = 'travel' AND ended_at IS NULL`,
        [now, orderId, driverId]
      );
      await pool.query(
        `INSERT INTO time_entries (order_id, driver_id, status, started_at) VALUES ($1, $2, 'on_site', $3)`,
        [orderId, driverId, now]
      );
    } else if (newStatus === "in_progress") {
      await pool.query(
        `UPDATE time_entries SET ended_at = $1, duration_seconds = EXTRACT(EPOCH FROM ($1 - started_at))::integer WHERE order_id = $2 AND driver_id = $3 AND status = 'on_site' AND ended_at IS NULL`,
        [now, orderId, driverId]
      );
      await pool.query(
        `INSERT INTO time_entries (order_id, driver_id, status, started_at) VALUES ($1, $2, 'working', $3)`,
        [orderId, driverId, now]
      );
    } else if (newStatus === "completed" || newStatus === "utford") {
      await pool.query(
        `UPDATE time_entries SET ended_at = $1, duration_seconds = EXTRACT(EPOCH FROM ($1 - started_at))::integer WHERE order_id = $2 AND driver_id = $3 AND ended_at IS NULL`,
        [now, orderId, driverId]
      );
    } else if (newStatus === "failed" || newStatus === "impossible" || newStatus === "cancelled") {
      await pool.query(
        `UPDATE time_entries SET ended_at = $1, duration_seconds = EXTRACT(EPOCH FROM ($1 - started_at))::integer WHERE order_id = $2 AND driver_id = $3 AND ended_at IS NULL`,
        [now, orderId, driverId]
      );
    }
  } catch (err) {
    console.error("Error managing time entries:", err.message);
  }
}
router.patch("/orders/:id/status", async (req, res) => {
  const { status: newStatus } = req.body;
  const allowedStatuses = ["planned", "dispatched", "on_site", "in_progress", "completed", "failed", "cancelled", "planerad_pre", "planerad_resurs", "planerad_las", "utford", "fakturerad", "impossible"];
  if (!newStatus || typeof newStatus !== "string") {
    return res.status(400).json({ error: "Status kr\xE4vs" });
  }
  if (!allowedStatuses.includes(newStatus)) {
    return res.status(400).json({ error: `Ogiltig status: ${newStatus}` });
  }
  const io2 = req.app.io;
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => o.id === parseInt(req.params.id));
    if (order) {
      if (order.isLocked) {
        res.status(403).json({ error: "Uppdraget \xE4r l\xE5st - beroende uppdrag ej slutf\xF6rda" });
        return;
      }
      order.status = newStatus;
      if (newStatus === "on_site" || newStatus === "in_progress" || newStatus === "planerad_las") {
        order.actualStartTime = order.actualStartTime || (/* @__PURE__ */ new Date()).toISOString();
      }
      if (newStatus === "completed" || newStatus === "utford") {
        order.completedAt = (/* @__PURE__ */ new Date()).toISOString();
        order.actualEndTime = (/* @__PURE__ */ new Date()).toISOString();
      }
      if (newStatus === "failed" || newStatus === "impossible") {
        order.actualEndTime = (/* @__PURE__ */ new Date()).toISOString();
        if (req.body.impossibleReason) {
          order.impossibleReason = req.body.impossibleReason;
          order.impossibleAt = (/* @__PURE__ */ new Date()).toISOString();
        }
      }
      if (newStatus === "fakturerad") {
        order.completedAt = order.completedAt || (/* @__PURE__ */ new Date()).toISOString();
      }
      const driverId = String(order.resourceId || MOCK_RESOURCE.id);
      handleTimeEntries(String(order.id), driverId, newStatus).catch((err) => {
        console.error("[time-entries] Error in mock handleTimeEntries:", err.message);
      });
      if (io2) {
        io2.emit("order:updated", { orderId: order.id, status: order.status, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
        if (MOCK_TEAM.status === "active") {
          io2.to(`team:${MOCK_TEAM.id}`).emit("team:order_updated", { orderId: order.id, status: order.status, updatedBy: MOCK_RESOURCE.name, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
        }
      }
      const statusLabels = {
        planned: "Planerad",
        dispatched: "Skickad",
        on_site: "P\xE5 plats",
        in_progress: "P\xE5g\xE5r",
        completed: "Slutf\xF6rd",
        failed: "Misslyckad",
        cancelled: "Avbruten"
      };
      const label = statusLabels[newStatus] || newStatus;
      if (order.resourceId) {
        sendPushNotification(
          String(order.resourceId),
          `Order ${order.orderNumber}`,
          `Status \xE4ndrad till: ${label}`,
          { orderId: String(order.id), orderNumber: order.orderNumber, status: newStatus }
        ).catch(() => {
        });
      }
      res.json(order);
    } else {
      res.status(404).json({ error: "Order hittades inte" });
    }
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/status`, {
      method: "PATCH",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    if (status === 200) {
      const driverId = String(MOCK_RESOURCE.id);
      handleTimeEntries(req.params.id, driverId, newStatus).catch((err) => {
        console.error("[time-entries] Error in non-mock handleTimeEntries:", err.message);
      });
    }
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte uppdatera status. F\xF6rs\xF6k igen." });
  }
});
router.get("/orders/:id/time-entries", async (req, res) => {
  const orderId = req.params.id;
  try {
    const result = await pool.query(
      `SELECT id, order_id, driver_id, status, started_at, ended_at, duration_seconds, created_at FROM time_entries WHERE order_id = $1 ORDER BY started_at ASC`,
      [orderId]
    );
    res.json(result.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      driverId: row.driver_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      createdAt: row.created_at
    })));
  } catch (err) {
    console.error("Error fetching time entries:", err.message);
    res.status(500).json({ error: "Kunde inte h\xE4mta tidrapport" });
  }
});
router.get("/time-summary", async (req, res) => {
  const driverId = String(MOCK_RESOURCE.id);
  const today = /* @__PURE__ */ new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 864e5);
  try {
    const result = await pool.query(
      `SELECT status, started_at, ended_at, duration_seconds FROM time_entries WHERE driver_id = $1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at ASC`,
      [driverId, startOfDay, endOfDay]
    );
    let travelSeconds = 0;
    let onSiteSeconds = 0;
    let workingSeconds = 0;
    const now = /* @__PURE__ */ new Date();
    for (const row of result.rows) {
      const duration = row.duration_seconds != null ? row.duration_seconds : Math.floor((now.getTime() - new Date(row.started_at).getTime()) / 1e3);
      if (row.status === "travel") travelSeconds += duration;
      else if (row.status === "on_site") onSiteSeconds += duration;
      else if (row.status === "working") workingSeconds += duration;
    }
    const totalSeconds = travelSeconds + onSiteSeconds + workingSeconds;
    res.json({
      totalSeconds,
      travelSeconds,
      onSiteSeconds,
      workingSeconds,
      entries: result.rows.length
    });
  } catch (err) {
    console.error("Error fetching time summary:", err.message);
    res.status(500).json({ error: "Kunde inte h\xE4mta tidssammanfattning" });
  }
});
router.get("/statistics", async (req, res) => {
  const driverId = String(MOCK_RESOURCE.id);
  const period = req.query.period || "week";
  const offset = parseInt(req.query.offset) || 0;
  const now = /* @__PURE__ */ new Date();
  let periodStart;
  let periodEnd;
  let prevStart;
  let prevEnd;
  let days;
  if (period === "month") {
    const y = now.getFullYear();
    const m = now.getMonth() - offset;
    periodStart = new Date(y, m, 1);
    periodEnd = new Date(y, m + 1, 1);
    prevStart = new Date(y, m - 1, 1);
    prevEnd = new Date(y, m, 1);
    days = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 864e5);
  } else {
    const dayOfWeek = now.getDay() || 7;
    const mondayThis = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
    periodStart = new Date(mondayThis.getTime() - offset * 7 * 864e5);
    periodEnd = new Date(periodStart.getTime() + 7 * 864e5);
    prevStart = new Date(periodStart.getTime() - 7 * 864e5);
    prevEnd = new Date(periodStart.getTime());
    days = 7;
  }
  try {
    let aggregateEntries2 = function(rows) {
      let travel = 0, onSite = 0, working = 0;
      const orderIds = /* @__PURE__ */ new Set();
      const n = /* @__PURE__ */ new Date();
      for (const r of rows) {
        const dur = r.duration_seconds != null ? r.duration_seconds : Math.floor((n.getTime() - new Date(r.started_at).getTime()) / 1e3);
        if (r.status === "travel") travel += dur;
        else if (r.status === "on_site") onSite += dur;
        else if (r.status === "working") working += dur;
        orderIds.add(r.order_id);
      }
      return { travel, onSite, working, total: travel + onSite + working, orderIds };
    }, trendPercent2 = function(curr, prev) {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round((curr - prev) / prev * 100);
    };
    var aggregateEntries = aggregateEntries2, trendPercent = trendPercent2;
    const [currentEntries, prevEntries] = await Promise.all([
      pool.query(
        `SELECT order_id, status, started_at, ended_at, duration_seconds FROM time_entries WHERE driver_id = $1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at ASC`,
        [driverId, periodStart, periodEnd]
      ),
      pool.query(
        `SELECT order_id, status, started_at, ended_at, duration_seconds FROM time_entries WHERE driver_id = $1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at ASC`,
        [driverId, prevStart, prevEnd]
      )
    ]);
    const current = aggregateEntries2(currentEntries.rows);
    const previous = aggregateEntries2(prevEntries.rows);
    const dailyBreakdown = [];
    for (let d = 0; d < days; d++) {
      const dayStart = new Date(periodStart.getTime() + d * 864e5);
      const dayEnd = new Date(dayStart.getTime() + 864e5);
      let travel = 0, onSite = 0, working = 0;
      for (const r of currentEntries.rows) {
        const start = new Date(r.started_at);
        if (start >= dayStart && start < dayEnd) {
          const dur = r.duration_seconds != null ? r.duration_seconds : Math.floor(((/* @__PURE__ */ new Date()).getTime() - start.getTime()) / 1e3);
          if (r.status === "travel") travel += dur;
          else if (r.status === "on_site") onSite += dur;
          else if (r.status === "working") working += dur;
        }
      }
      dailyBreakdown.push({
        date: dayStart.toISOString().split("T")[0],
        dayLabel: ["S\xF6n", "M\xE5n", "Tis", "Ons", "Tor", "Fre", "L\xF6r"][dayStart.getDay()],
        travel: Math.round(travel / 60),
        onSite: Math.round(onSite / 60),
        working: Math.round(working / 60)
      });
    }
    const periodOrders = MOCK_ORDERS;
    const completedOrders = periodOrders.filter((o) => o.completedAt && new Date(o.completedAt) >= periodStart && new Date(o.completedAt) < periodEnd);
    const prevCompletedOrders = MOCK_ORDERS.filter((o) => o.completedAt && new Date(o.completedAt) >= prevStart && new Date(o.completedAt) < prevEnd);
    const ordersWithDeviations = periodOrders.filter((o) => o.deviations && o.deviations.length > 0);
    const prevOrdersWithDeviations = MOCK_ORDERS.filter((o) => o.deviations && o.deviations.length > 0);
    const ordersWithSignoff = periodOrders.filter((o) => o.customerSignOff);
    const prevOrdersWithSignoff = MOCK_ORDERS.filter((o) => o.customerSignOff);
    const totalOrders = periodOrders.length;
    const uniqueOrdersCurrent = current.orderIds.size || completedOrders.length;
    const avgTimePerOrder = uniqueOrdersCurrent > 0 ? Math.round(current.total / uniqueOrdersCurrent / 60) : 0;
    const avgTravelTime = uniqueOrdersCurrent > 0 ? Math.round(current.travel / uniqueOrdersCurrent / 60) : 0;
    const avgOnSiteTime = uniqueOrdersCurrent > 0 ? Math.round(current.onSite / uniqueOrdersCurrent / 60) : 0;
    const uniqueOrdersPrev = previous.orderIds.size || prevCompletedOrders.length || 1;
    const prevAvgTimePerOrder = uniqueOrdersPrev > 0 ? Math.round(previous.total / uniqueOrdersPrev / 60) : 0;
    const prevAvgTravelTime = uniqueOrdersPrev > 0 ? Math.round(previous.travel / uniqueOrdersPrev / 60) : 0;
    const monthNames = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
    let periodLabel;
    if (period === "month") {
      periodLabel = `${monthNames[periodStart.getMonth()]} ${periodStart.getFullYear()}`;
    } else {
      const weekNum = Math.ceil(((periodStart.getTime() - new Date(periodStart.getFullYear(), 0, 1).getTime()) / 864e5 + 1) / 7);
      periodLabel = offset === 0 ? "Denna vecka" : `Vecka ${weekNum}`;
    }
    res.json({
      period,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      periodLabel,
      dailyBreakdown,
      currentPeriod: {
        completedOrders: completedOrders.length,
        totalOrders,
        ordersWithDeviations: ordersWithDeviations.length,
        ordersWithSignoff: ordersWithSignoff.length,
        avgTimePerOrder,
        avgTravelTime,
        avgOnSiteTime
      },
      previousPeriod: {
        completedOrders: prevCompletedOrders.length,
        avgTimePerOrder: prevAvgTimePerOrder,
        avgTravelTime: prevAvgTravelTime
      },
      trends: {
        orders: trendPercent2(completedOrders.length, prevCompletedOrders.length),
        avgTimePerOrder: trendPercent2(avgTimePerOrder, prevAvgTimePerOrder),
        avgTravelTime: trendPercent2(avgTravelTime, prevAvgTravelTime),
        deviations: trendPercent2(ordersWithDeviations.length, prevOrdersWithDeviations.length),
        signoffs: trendPercent2(ordersWithSignoff.length, prevOrdersWithSignoff.length)
      }
    });
  } catch (err) {
    console.error("Error fetching statistics:", err.message);
    res.status(500).json({ error: "Kunde inte h\xE4mta statistik" });
  }
});
router.post("/orders/:id/deviations", async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const deviation = { id: Date.now(), orderId, ...req.body, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    const order = MOCK_ORDERS.find((o) => o.id === orderId);
    if (order) order.deviations.push(deviation);
    res.json(deviation);
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/deviations`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch (error) {
    console.error("Deviation proxy error:", error?.message);
    res.status(503).json({ error: "Kunde inte rapportera avvikelse." });
  }
});
router.get("/orders/:id/materials", async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const logs = MOCK_MATERIAL_LOGS.filter((m) => m.orderId === orderId);
    res.json(logs);
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/materials`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte h\xE4mta material." });
  }
});
router.post("/orders/:id/materials", async (req, res) => {
  if (IS_MOCK_MODE) {
    const io2 = req.app.io;
    const entry = {
      id: Date.now(),
      orderId: parseInt(req.params.id),
      ...req.body,
      registeredBy: MOCK_RESOURCE.name,
      registeredByResourceId: MOCK_RESOURCE.id,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    MOCK_MATERIAL_LOGS.push(entry);
    if (io2 && MOCK_TEAM.status === "active") {
      io2.to(`team:${MOCK_TEAM.id}`).emit("team:material_logged", { orderId: entry.orderId, entry });
    }
    res.json(entry);
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/materials`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch (error) {
    console.error("Material proxy error:", error?.message);
    res.status(503).json({ error: "Kunde inte logga material." });
  }
});
router.post("/orders/:id/signature", async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => o.id === parseInt(req.params.id));
    if (order) {
      order.signatureUrl = req.body.signatureData;
      res.json({ success: true });
    } else res.status(404).json({ error: "Order hittades inte" });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/signature`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch (error) {
    console.error("Signature proxy error:", error?.message);
    res.status(503).json({ error: "Kunde inte spara signatur." });
  }
});
router.post("/orders/:id/notes", async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const order = MOCK_ORDERS.find((o) => o.id === orderId);
    if (order) {
      const note = { id: Date.now(), orderId, text: req.body.text, createdBy: "Chauff\xF6r", createdAt: (/* @__PURE__ */ new Date()).toISOString() };
      if (!order.orderNotes) order.orderNotes = [];
      order.orderNotes.push(note);
      res.json(note);
    } else res.status(404).json({ error: "Order hittades inte" });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/notes`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte spara anteckning." });
  }
});
router.patch("/orders/:id/substeps/:stepId", async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => o.id === parseInt(req.params.id));
    if (order && order.subSteps) {
      const step = order.subSteps.find((s) => s.id === parseInt(req.params.stepId));
      if (step) {
        step.completed = req.body.completed;
        res.json(step);
      } else res.status(404).json({ error: "Delsteg hittades inte" });
    } else res.status(404).json({ error: "Order hittades inte" });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/substeps/${req.params.stepId}`, {
      method: "PATCH",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte uppdatera delsteg." });
  }
});
router.post("/orders/:id/inspections", async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => o.id === parseInt(req.params.id));
    if (order) {
      order.inspections = req.body.inspections;
      res.json({ success: true, inspections: order.inspections });
    } else res.status(404).json({ error: "Order hittades inte" });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/inspections`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte spara inspektion." });
  }
});
router.post("/inspections/:orderId/photos", async (req, res) => {
  const { orderId } = req.params;
  const { photos } = req.body;
  if (!photos || !Array.isArray(photos) || photos.length === 0) {
    res.status(400).json({ error: "Inga foton att ladda upp" });
    return;
  }
  const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : String(req.driverId || MOCK_RESOURCE.id);
  try {
    const results = [];
    const errors = [];
    for (const photo of photos) {
      const { category, photoSlot, base64Data } = photo;
      if (!category || !photoSlot || !base64Data) {
        errors.push({ category: category || "ok\xE4nd", photoSlot: photoSlot || "ok\xE4nd", error: "Saknar obligatoriska f\xE4lt" });
        continue;
      }
      const dataSize = Buffer.byteLength(base64Data, "utf8");
      if (dataSize > MAX_PHOTO_SIZE) {
        errors.push({ category, photoSlot, error: `Bilden \xE4r f\xF6r stor (${(dataSize / 1024 / 1024).toFixed(1)} MB, max 5 MB)` });
        continue;
      }
      const result = await pool.query(
        `INSERT INTO inspection_photos (order_id, driver_id, category, photo_slot, base64_data)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [orderId, driverId, category, photoSlot, base64Data]
      );
      results.push({ category, photoSlot, id: result.rows[0].id });
    }
    if (errors.length > 0 && results.length === 0) {
      res.status(400).json({ success: false, errors });
      return;
    }
    res.json({ success: true, uploaded: results, errors });
  } catch (err) {
    console.error("Inspection photo upload error:", err.message);
    res.status(500).json({ error: "Kunde inte spara inspektionsfoton" });
  }
});
router.get("/inspections/:orderId/photos", async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, category, photo_slot, base64_data, created_at
       FROM inspection_photos WHERE order_id = $1 ORDER BY created_at`,
      [orderId]
    );
    res.json({ success: true, photos: result.rows.map((r) => ({
      id: r.id,
      category: r.category,
      photoSlot: r.photo_slot,
      base64Data: r.base64_data,
      createdAt: r.created_at
    })) });
  } catch (err) {
    console.error("Fetch inspection photos error:", err.message);
    res.status(500).json({ error: "Kunde inte h\xE4mta inspektionsfoton" });
  }
});
router.post("/orders/:id/upload-photo", async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const order = MOCK_ORDERS.find((o) => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: "Order hittades inte" });
      return;
    }
    const photoId = `photo-${Date.now()}`;
    res.json({ success: true, photoId, presignedUrl: `/api/mobile/photos/${photoId}/upload`, confirmUrl: `/api/mobile/orders/${orderId}/confirm-photo` });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/upload-photo`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte h\xE4mta uppladdnings-URL." });
  }
});
router.post("/orders/:id/confirm-photo", async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => o.id === parseInt(req.params.id));
    if (order) {
      const photoUrl = `/photos/${req.body.photoId}.jpg`;
      order.photos.push(photoUrl);
      res.json({ success: true, photoUrl });
    } else res.status(404).json({ error: "Order hittades inte" });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${req.params.id}/confirm-photo`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte bekr\xE4fta foto." });
  }
});
router.get("/notifications/count", async (req, res) => {
  if (IS_MOCK_MODE) {
    const unread = MOCK_NOTIFICATIONS.filter((n) => !n.isRead).length;
    res.json({ count: unread });
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/notifications/count", { method: "GET", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch {
    res.json({ count: 0 });
  }
});
router.get("/notifications", async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json(MOCK_NOTIFICATIONS);
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/notifications", { method: "GET", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch {
    res.json(MOCK_NOTIFICATIONS);
  }
});
router.patch("/notifications/:id/read", async (req, res) => {
  if (IS_MOCK_MODE) {
    const notification = MOCK_NOTIFICATIONS.find((n) => n.id === req.params.id);
    if (notification) {
      notification.isRead = true;
      res.json(notification);
    } else res.status(404).json({ error: "Notifikation hittades inte" });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/notifications/${req.params.id}/read`, {
      method: "PATCH",
      headers: getAuthHeader(req)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte markera notifikation." });
  }
});
router.patch("/notifications/read-all", async (req, res) => {
  if (IS_MOCK_MODE) {
    MOCK_NOTIFICATIONS.forEach((n) => {
      n.isRead = true;
    });
    res.json({ success: true });
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/notifications/read-all", {
      method: "PATCH",
      headers: getAuthHeader(req)
    });
    res.status(status).json(data);
  } catch {
    res.json({ success: true });
  }
});
router.get("/map-config", async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({
      defaultCenter: { latitude: 57.7089, longitude: 11.9746 },
      defaultZoom: 12,
      clusterRadius: 50,
      showTraffic: false,
      mapStyle: "standard",
      refreshIntervalMs: 3e4,
      maxMarkersVisible: 200
    });
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/map-config", { method: "GET", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch {
    res.json({ defaultCenter: { latitude: 57.7089, longitude: 11.9746 }, defaultZoom: 12, clusterRadius: 50, showTraffic: false, mapStyle: "standard", refreshIntervalMs: 3e4, maxMarkersVisible: 200 });
  }
});
router.post("/sync", async (req, res) => {
  if (IS_MOCK_MODE) {
    const { actions } = req.body;
    if (!Array.isArray(actions)) {
      res.status(400).json({ error: "actions m\xE5ste vara en array" });
      return;
    }
    const results = actions.map((action) => ({ clientId: action.clientId, success: true, serverTimestamp: (/* @__PURE__ */ new Date()).toISOString() }));
    res.json({ success: true, results });
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/sync", {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Synkronisering misslyckades." });
  }
});
router.get("/sync/status", async (req, res) => {
  res.json({ lastSync: (/* @__PURE__ */ new Date()).toISOString(), pendingActions: 0 });
});
router.get("/articles", (req, res) => {
  const search = (req.query.search || "").toLowerCase();
  if (search) {
    res.json(MOCK_ARTICLES.filter((a) => a.name.toLowerCase().includes(search)));
  } else {
    res.json(MOCK_ARTICLES);
  }
});
var MOCK_WORK_SESSION = null;
var MOCK_WORK_SESSION_ENTRIES = [];
router.post("/work-sessions/start", async (req, res) => {
  if (IS_MOCK_MODE) {
    MOCK_WORK_SESSION = {
      id: "ws-" + Date.now(),
      resourceId: MOCK_RESOURCE.id,
      teamId: req.body.teamId || null,
      status: "active",
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      pausedAt: null,
      endedAt: null,
      notes: req.body.notes || "",
      totalWorkMinutes: 0,
      totalBreakMinutes: 0
    };
    MOCK_WORK_SESSION_ENTRIES = [];
    res.json({ success: true, session: MOCK_WORK_SESSION });
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/work-sessions/start", { method: "POST", headers: getAuthHeader(req), body: JSON.stringify(req.body) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte starta arbetspass." });
  }
});
router.get("/work-sessions/active", async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ session: MOCK_WORK_SESSION });
    return;
  }
  try {
    const { status, data } = await traivoFetch("/api/mobile/work-sessions/active", { method: "GET", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte h\xE4mta aktivt arbetspass." });
  }
});
router.post("/work-sessions/:id/stop", async (req, res) => {
  if (IS_MOCK_MODE) {
    if (MOCK_WORK_SESSION && MOCK_WORK_SESSION.id === req.params.id) {
      MOCK_WORK_SESSION.status = "completed";
      MOCK_WORK_SESSION.endedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    res.json({ success: true, session: MOCK_WORK_SESSION });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/work-sessions/${req.params.id}/stop`, { method: "POST", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte avsluta arbetspass." });
  }
});
router.post("/work-sessions/:id/pause", async (req, res) => {
  if (IS_MOCK_MODE) {
    if (MOCK_WORK_SESSION && MOCK_WORK_SESSION.id === req.params.id) {
      MOCK_WORK_SESSION.status = "paused";
      MOCK_WORK_SESSION.pausedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    res.json({ success: true, session: MOCK_WORK_SESSION });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/work-sessions/${req.params.id}/pause`, { method: "POST", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte pausa arbetspass." });
  }
});
router.post("/work-sessions/:id/resume", async (req, res) => {
  if (IS_MOCK_MODE) {
    if (MOCK_WORK_SESSION && MOCK_WORK_SESSION.id === req.params.id) {
      MOCK_WORK_SESSION.status = "active";
      MOCK_WORK_SESSION.pausedAt = null;
    }
    res.json({ success: true, session: MOCK_WORK_SESSION });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/work-sessions/${req.params.id}/resume`, { method: "POST", headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte \xE5teruppta arbetspass." });
  }
});
router.post("/work-sessions/:id/entries", async (req, res) => {
  if (IS_MOCK_MODE) {
    const entry = { id: "wse-" + Date.now(), sessionId: req.params.id, ...req.body, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    MOCK_WORK_SESSION_ENTRIES.push(entry);
    res.json({ success: true, entry });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/work-sessions/${req.params.id}/entries`, { method: "POST", headers: getAuthHeader(req), body: JSON.stringify(req.body) });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte logga tidspost." });
  }
});
router.post("/position", async (req, res) => {
  const { latitude, longitude, speed, heading, accuracy } = req.body;
  if (latitude == null || longitude == null || typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ error: "Giltiga latitude och longitude kr\xE4vs" });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "Koordinater utanf\xF6r giltigt intervall" });
  }
  if (!IS_MOCK_MODE) {
    try {
      await traivoFetch("/api/mobile/position", {
        method: "POST",
        headers: getAuthHeader(req),
        body: JSON.stringify(req.body)
      });
    } catch (e) {
      console.error("Traivo position proxy error:", e.message);
    }
  }
  try {
    if (latitude != null && longitude != null) {
      const driverId = IS_MOCK_MODE ? MOCK_RESOURCE.id : "unknown";
      const driverName = IS_MOCK_MODE ? MOCK_RESOURCE.name : "Ok\xE4nd";
      const vehicleRegNo = IS_MOCK_MODE ? MOCK_RESOURCE.vehicleRegNo : "";
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, speed, heading, accuracy, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           driver_name = EXCLUDED.driver_name,
           vehicle_reg_no = EXCLUDED.vehicle_reg_no,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           speed = COALESCE(EXCLUDED.speed, driver_locations.speed),
           heading = COALESCE(EXCLUDED.heading, driver_locations.heading),
           accuracy = COALESCE(EXCLUDED.accuracy, driver_locations.accuracy),
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName, vehicleRegNo, latitude, longitude, speed || 0, heading || 0, accuracy || 0]
      );
    }
    res.json({ received: true, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  } catch (error) {
    console.error("Error saving GPS position:", error);
    res.json({ received: true, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  }
});
router.post("/status", async (req, res) => {
  const { online } = req.body;
  try {
    const driverId = IS_MOCK_MODE ? MOCK_RESOURCE.id : "unknown";
    const driverName = IS_MOCK_MODE ? MOCK_RESOURCE.name : "Ok\xE4nd";
    const vehicleRegNo = IS_MOCK_MODE ? MOCK_RESOURCE.vehicleRegNo : "";
    if (online) {
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, status, updated_at)
         VALUES ($1, $2, $3, 0, 0, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName, vehicleRegNo]
      );
    } else {
      await pool.query(
        `UPDATE driver_locations SET status = 'offline', updated_at = NOW() WHERE driver_id = $1`,
        [driverId]
      );
    }
    res.json({ success: true, online });
  } catch (error) {
    console.error("Error updating driver status:", error);
    res.json({ success: true, online });
  }
});
router.post("/gps", async (req, res) => {
  const { latitude, longitude, speed, heading, accuracy, driverId, driverName, vehicleRegNo, currentOrderId, currentOrderNumber } = req.body;
  if (latitude == null || longitude == null || !driverId) {
    return res.status(400).json({ error: "latitude, longitude och driverId kr\xE4vs" });
  }
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ error: "Koordinater m\xE5ste vara nummer" });
  }
  try {
    if (latitude != null && longitude != null && driverId) {
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, speed, heading, accuracy, current_order_id, current_order_number, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           driver_name = EXCLUDED.driver_name,
           vehicle_reg_no = EXCLUDED.vehicle_reg_no,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           speed = COALESCE(EXCLUDED.speed, driver_locations.speed),
           heading = COALESCE(EXCLUDED.heading, driver_locations.heading),
           accuracy = COALESCE(EXCLUDED.accuracy, driver_locations.accuracy),
           current_order_id = EXCLUDED.current_order_id,
           current_order_number = EXCLUDED.current_order_number,
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName || "Ok\xE4nd", vehicleRegNo, latitude, longitude, speed || 0, heading || 0, accuracy || 0, currentOrderId, currentOrderNumber]
      );
    }
    res.json({ received: true });
  } catch (error) {
    console.error("Error saving GPS position:", error);
    res.json({ received: true });
  }
});
router.get("/weather", async (_req, res) => {
  try {
    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=57.7089&longitude=11.9746&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe/Stockholm&forecast_days=1"
    );
    const data = await response.json();
    const current = data.current;
    const weatherDescriptions = {
      0: "Klart",
      1: "Mestadels klart",
      2: "Delvis molnigt",
      3: "Mulet",
      45: "Dimma",
      48: "Dimma med rimfrost",
      51: "L\xE4tt duggregn",
      53: "M\xE5ttligt duggregn",
      55: "Kraftigt duggregn",
      61: "L\xE4tt regn",
      63: "M\xE5ttligt regn",
      65: "Kraftigt regn",
      71: "L\xE4tt sn\xF6fall",
      73: "M\xE5ttligt sn\xF6fall",
      75: "Kraftigt sn\xF6fall",
      77: "Sn\xF6korn",
      80: "L\xE4tta regnskurar",
      81: "M\xE5ttliga regnskurar",
      82: "Kraftiga regnskurar",
      85: "L\xE4tta sn\xF6byar",
      86: "Kraftiga sn\xF6byar",
      95: "\xC5skv\xE4der",
      96: "\xC5skv\xE4der med hagel",
      99: "\xC5skv\xE4der med kraftigt hagel"
    };
    const weatherIcons = {
      0: "sun",
      1: "sun",
      2: "cloud",
      3: "cloud",
      45: "cloud",
      48: "cloud",
      51: "cloud-drizzle",
      53: "cloud-drizzle",
      55: "cloud-drizzle",
      61: "cloud-rain",
      63: "cloud-rain",
      65: "cloud-rain",
      71: "cloud-snow",
      73: "cloud-snow",
      75: "cloud-snow",
      77: "cloud-snow",
      80: "cloud-rain",
      81: "cloud-rain",
      82: "cloud-rain",
      85: "cloud-snow",
      86: "cloud-snow",
      95: "cloud-lightning",
      96: "cloud-lightning",
      99: "cloud-lightning"
    };
    const code = current.weather_code;
    const warnings = [];
    if (current.wind_speed_10m > 15) warnings.push("Bl\xE5sigt v\xE4der");
    if (current.precipitation > 5) warnings.push("Kraftig nederb\xF6rd");
    if (current.temperature_2m < 0) warnings.push("Minusgrader - halkrisk");
    if (code >= 95) warnings.push("\xC5skvarning");
    res.json({
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      description: weatherDescriptions[code] || "Ok\xE4nt",
      icon: weatherIcons[code] || "cloud",
      windSpeed: Math.round(current.wind_speed_10m),
      precipitation: current.precipitation,
      warnings
    });
  } catch (error) {
    res.json({
      temperature: 8,
      feelsLike: 5,
      description: "Delvis molnigt",
      icon: "cloud",
      windSpeed: 12,
      precipitation: 0,
      warnings: []
    });
  }
});
router.get("/summary", async (req, res) => {
  if (IS_MOCK_MODE) {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const todayOrders = MOCK_ORDERS.filter((o) => o.scheduledDate === today);
    const remaining = todayOrders.filter((o) => o.status !== "completed" && o.status !== "cancelled" && o.status !== "failed");
    let totalDistance = 0;
    const sortedOrders = [...todayOrders].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 1; i < sortedOrders.length; i++) {
      const prev = sortedOrders[i - 1];
      const curr = sortedOrders[i];
      if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
        totalDistance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      }
    }
    res.json({
      totalOrders: todayOrders.length,
      completedOrders: todayOrders.filter((o) => o.status === "completed").length,
      remainingOrders: remaining.length,
      failedOrders: todayOrders.filter((o) => o.status === "failed").length,
      totalDuration: todayOrders.reduce((sum, o) => sum + o.estimatedDuration, 0),
      estimatedTimeRemaining: remaining.reduce((sum, o) => sum + o.estimatedDuration, 0),
      totalDistance: Math.round(totalDistance * 10) / 10
    });
    return;
  }
  try {
    const { status: summaryStatus, data: summaryData } = await traivoFetch("/api/mobile/summary", {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (summaryStatus === 200 && summaryData && summaryData.totalOrders !== void 0) {
      res.json(summaryData);
      return;
    }
  } catch {
  }
  try {
    const { status: ordersStatus, data: ordersData } = await traivoFetch("/api/mobile/my-orders", {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (ordersStatus === 200) {
      const rawOrders = Array.isArray(ordersData) ? ordersData : ordersData.orders || [];
      const completed = rawOrders.filter((o) => o.status === "completed").length;
      const failed = rawOrders.filter((o) => o.status === "failed" || o.status === "impossible").length;
      const cancelled = rawOrders.filter((o) => o.status === "cancelled").length;
      const remaining = rawOrders.length - completed - failed - cancelled;
      res.json({
        totalOrders: rawOrders.length,
        completedOrders: completed,
        remainingOrders: remaining,
        failedOrders: failed,
        totalDuration: rawOrders.reduce((sum, o) => sum + (o.estimatedDuration || 0), 0),
        estimatedTimeRemaining: rawOrders.filter((o) => o.status !== "completed" && o.status !== "failed" && o.status !== "cancelled").reduce((sum, o) => sum + (o.estimatedDuration || 0), 0)
      });
    } else {
      res.json({ totalOrders: 0, completedOrders: 0, remainingOrders: 0, failedOrders: 0, totalDuration: 0, estimatedTimeRemaining: 0 });
    }
  } catch {
    res.json({ totalOrders: 0, completedOrders: 0, remainingOrders: 0, failedOrders: 0, totalDuration: 0, estimatedTimeRemaining: 0 });
  }
});
function parseCoordPoints(coords) {
  const points = coords.split(";");
  const parsed = [];
  for (const point of points) {
    const parts = point.split(",");
    if (parts.length !== 2) return null;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (isNaN(lon) || isNaN(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    parsed.push({ lon, lat });
  }
  return parsed;
}
function simplifyCoordinates(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;
  const step = (coords.length - 1) / (maxPoints - 1);
  const result = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(coords[Math.round(i * step)]);
  }
  result.push(coords[coords.length - 1]);
  return result;
}
function buildFallbackResponse(parsed) {
  return {
    waypoints: parsed.map((p, i) => ({ location: [p.lon, p.lat], waypointIndex: i, tripsIndex: 0 })),
    trips: [{
      geometry: { type: "LineString", coordinates: parsed.map((p) => [p.lon, p.lat]) },
      distance: 0,
      duration: 0,
      legs: []
    }],
    fallback: true
  };
}
router.get("/route", async (req, res) => {
  const rawCoords = req.query.coords;
  const coords = typeof rawCoords === "string" ? decodeURIComponent(rawCoords).trim() : "";
  console.log("[route] raw coords type:", typeof rawCoords, "value:", JSON.stringify(rawCoords), "decoded length:", coords.length, "hasApiKey:", !!process.env.GEOAPIFY_API_KEY);
  if (!coords) {
    return res.status(400).json({ error: "coords parameter required (lon1,lat1;lon2,lat2;...)" });
  }
  const parsed = parseCoordPoints(coords);
  if (!parsed || parsed.length < 2 || parsed.length > 25) {
    return res.status(400).json({ error: "Between 2 and 25 valid coordinate pairs required" });
  }
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.warn("[route] GEOAPIFY_API_KEY not set, returning fallback");
    return res.json(buildFallbackResponse(parsed));
  }
  const waypoints = parsed.map((p) => `${p.lat},${p.lon}`).join("|");
  const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&details=route_details&traffic=approximated&apiKey=${apiKey}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15e3);
  try {
    const response = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    console.log("[route] Geoapify response status:", response.status);
    if (!response.ok) {
      const text = await response.text();
      console.error("[route] Geoapify error:", response.status, text.substring(0, 300));
      return res.json(buildFallbackResponse(parsed));
    }
    const data = await response.json();
    const features = data?.features;
    if (!features || features.length === 0) {
      console.error("[route] Geoapify: no features in response");
      return res.json(buildFallbackResponse(parsed));
    }
    const feature = features[0];
    const props = feature.properties;
    const geometry = feature.geometry;
    let allCoordinates = [];
    if (geometry.type === "MultiLineString") {
      for (const line of geometry.coordinates) {
        allCoordinates = allCoordinates.concat(line);
      }
    } else if (geometry.type === "LineString") {
      allCoordinates = geometry.coordinates;
    }
    const trafficDuration = props.time || 0;
    const totalDistanceMeters = props.distance || 0;
    const normalDuration = totalDistanceMeters > 0 ? Math.round(totalDistanceMeters / 12.5) : trafficDuration;
    const legs = (props.legs || []).map((leg) => {
      const legTrafficDuration = leg.time || 0;
      const legDist = leg.distance || 0;
      const legNormalDuration = legDist > 0 ? Math.round(legDist / 12.5) : legTrafficDuration;
      return {
        distance: legDist,
        duration: legTrafficDuration,
        durationWithoutTraffic: legNormalDuration,
        steps: []
      };
    });
    const simplified = simplifyCoordinates(allCoordinates, 500);
    console.log("[route] Success: rawCoords=", allCoordinates.length, "simplified=", simplified.length, "dist=", totalDistanceMeters, "dur=", trafficDuration, "normalDur=", normalDuration);
    res.json({
      waypoints: parsed.map((p, i) => ({
        location: [p.lon, p.lat],
        waypointIndex: i,
        tripsIndex: 0
      })),
      trips: [{
        geometry: { type: "LineString", coordinates: simplified },
        distance: totalDistanceMeters,
        duration: trafficDuration,
        durationWithoutTraffic: normalDuration,
        legs
      }]
    });
  } catch (error) {
    clearTimeout(timeout);
    console.error("[route] Geoapify fetch error:", error.message);
    res.json(buildFallbackResponse(parsed));
  }
});
router.get("/route-optimized", async (req, res) => {
  const coords = req.query.coords;
  if (!coords) {
    return res.status(400).json({ error: "coords parameter required (lon1,lat1;lon2,lat2;...)" });
  }
  const parsed = parseCoordPoints(coords);
  if (!parsed || parsed.length < 2 || parsed.length > 25) {
    return res.status(400).json({ error: "Between 2 and 25 valid coordinate pairs required" });
  }
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.warn("GEOAPIFY_API_KEY not set, returning fallback");
    return res.json(buildFallbackResponse(parsed));
  }
  const startPoint = parsed[0];
  const jobPoints = parsed.slice(1);
  const body = {
    mode: "drive",
    agents: [{
      start_location: [startPoint.lon, startPoint.lat]
    }],
    jobs: jobPoints.map((p, i) => ({
      id: `job_${i}`,
      location: [p.lon, p.lat],
      duration: 600
    }))
  };
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 2e4);
  try {
    const response = await fetch(`https://api.geoapify.com/v1/routeplanner?apiKey=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const text = await response.text();
      console.error("Geoapify planner error:", response.status, text.substring(0, 300));
      return res.json(buildFallbackResponse(parsed));
    }
    const data = await response.json();
    const features = data?.features;
    if (!features || features.length === 0) {
      console.error("Geoapify planner: no features");
      return res.json(buildFallbackResponse(parsed));
    }
    const agentFeature = features.find((f) => f.properties?.agent_index !== void 0);
    if (!agentFeature) {
      console.error("Geoapify planner: no agent feature found");
      return res.json(buildFallbackResponse(parsed));
    }
    const props = agentFeature.properties;
    const geometry = agentFeature.geometry;
    let allCoordinates = [];
    if (geometry.type === "MultiLineString") {
      for (const line of geometry.coordinates) {
        allCoordinates = allCoordinates.concat(line);
      }
    } else if (geometry.type === "LineString") {
      allCoordinates = geometry.coordinates;
    }
    const actions = props.actions || [];
    const jobActions = actions.filter((a) => a.type === "job");
    const optimizedOrder = [];
    for (const a of jobActions) {
      const jobIdx = parseInt(a.job_id?.replace("job_", "") || "-1", 10);
      if (jobIdx >= 0 && jobIdx < jobPoints.length) {
        optimizedOrder.push(jobIdx + 1);
      }
    }
    if (optimizedOrder.length === 0) {
      console.warn("Geoapify planner: no valid job actions found");
      return res.json(buildFallbackResponse(parsed));
    }
    const allIndices = [0, ...optimizedOrder];
    const reorderedWaypoints = allIndices.map((origIdx) => ({
      location: [parsed[origIdx].lon, parsed[origIdx].lat],
      waypointIndex: origIdx,
      tripsIndex: 0
    }));
    const reorderedPoints = allIndices.map((i) => parsed[i]);
    const routeWaypoints = reorderedPoints.map((p) => `${p.lat},${p.lon}`).join("|");
    const routeUrl = `https://api.geoapify.com/v1/routing?waypoints=${routeWaypoints}&mode=drive&details=route_details&traffic=approximated&apiKey=${apiKey}`;
    const ctrl2 = new AbortController();
    const timeout2 = setTimeout(() => ctrl2.abort(), 15e3);
    try {
      const routeResp = await fetch(routeUrl, { signal: ctrl2.signal });
      clearTimeout(timeout2);
      if (routeResp.ok) {
        const routeData = await routeResp.json();
        const routeFeature = routeData?.features?.[0];
        if (routeFeature) {
          const routeGeom = routeFeature.geometry;
          let routeCoords = [];
          if (routeGeom.type === "MultiLineString") {
            for (const line of routeGeom.coordinates) {
              routeCoords = routeCoords.concat(line);
            }
          } else if (routeGeom.type === "LineString") {
            routeCoords = routeGeom.coordinates;
          }
          const routeProps = routeFeature.properties;
          const routeTrafficDuration = routeProps.time || props.time || 0;
          const routeTotalDist = routeProps.distance || props.distance || 0;
          const routeNormalDuration = routeTotalDist > 0 ? Math.round(routeTotalDist / 12.5) : routeTrafficDuration;
          const routeLegs = (routeProps.legs || []).map((leg) => {
            const legTrafficDur = leg.time || 0;
            const legDist = leg.distance || 0;
            const legNormalDur = legDist > 0 ? Math.round(legDist / 12.5) : legTrafficDur;
            return {
              distance: legDist,
              duration: legTrafficDur,
              durationWithoutTraffic: legNormalDur,
              steps: (leg.steps || []).map((step) => ({
                geometry: step.geometry || null,
                distance: step.distance || 0,
                duration: step.time || 0
              }))
            };
          });
          return res.json({
            waypoints: reorderedWaypoints,
            trips: [{
              geometry: { type: "LineString", coordinates: simplifyCoordinates(routeCoords, 500) },
              distance: routeTotalDist,
              duration: routeTrafficDuration,
              durationWithoutTraffic: routeNormalDuration,
              legs: routeLegs
            }],
            optimized: true
          });
        }
      }
    } catch (routeErr) {
      clearTimeout(timeout2);
      console.warn("Geoapify routing for optimized order failed:", routeErr.message);
    }
    const fallbackTrafficDur = props.time || 0;
    const fallbackDist = props.distance || 0;
    const fallbackNormalDur = fallbackDist > 0 ? Math.round(fallbackDist / 12.5) : fallbackTrafficDur;
    const legs = (props.legs || []).map((leg) => {
      const ld = leg.distance || 0;
      const lt = leg.time || 0;
      return {
        distance: ld,
        duration: lt,
        durationWithoutTraffic: ld > 0 ? Math.round(ld / 12.5) : lt,
        steps: []
      };
    });
    res.json({
      waypoints: reorderedWaypoints,
      trips: [{
        geometry: { type: "LineString", coordinates: simplifyCoordinates(allCoordinates, 500) },
        distance: fallbackDist,
        duration: fallbackTrafficDur,
        durationWithoutTraffic: fallbackNormalDur,
        legs
      }],
      optimized: true
    });
  } catch (error) {
    clearTimeout(timeout);
    console.error("Geoapify planner fetch error:", error.message);
    res.json(buildFallbackResponse(parsed));
  }
});
router.post("/orders/:id/customer-signoff", async (req, res) => {
  const { id } = req.params;
  const { customerName, signatureData, signedAt } = req.body;
  if (!customerName || !signatureData) {
    return res.status(400).json({ error: "customerName och signatureData kr\xE4vs" });
  }
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => String(o.id) === String(id));
    if (!order) {
      return res.status(404).json({ error: "Order hittades inte" });
    }
    order.customerSignOff = {
      customerName,
      signatureData,
      signedAt: signedAt || (/* @__PURE__ */ new Date()).toISOString()
    };
    return res.json({ success: true, signOff: order.customerSignOff });
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/orders/${id}/customer-signoff`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify({ customerName, signatureData, signedAt })
    });
    res.status(status).json(data);
  } catch (error) {
    console.error("[customer-signoff] Upstream error:", error.message);
    return res.status(503).json({
      error: "Kunde inte spara kundkvittering. F\xF6rs\xF6k igen."
    });
  }
});
router.post("/push-token", async (req, res) => {
  const { expoPushToken, platform } = req.body;
  const token = expoPushToken || req.body.token;
  if (!token) {
    return res.status(400).json({ error: "expoPushToken kr\xE4vs" });
  }
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : String(req.body.driverId || MOCK_RESOURCE.id);
  try {
    await pool.query(
      `INSERT INTO push_tokens (driver_id, expo_push_token, platform, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (driver_id)
       DO UPDATE SET expo_push_token = $2, platform = $3, updated_at = NOW()`,
      [String(driverId), token, platform]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Push token registration error:", err.message);
    res.status(500).json({ error: "Kunde inte registrera push-token" });
  }
});
router.delete("/push-token", async (req, res) => {
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : String(req.body.driverId || req.query.driverId || MOCK_RESOURCE.id);
  try {
    await pool.query("DELETE FROM push_tokens WHERE driver_id = $1", [driverId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Push token removal error:", err.message);
    res.status(500).json({ error: "Kunde inte ta bort push-token" });
  }
});
router.get("/route-feedback/mine", async (req, res) => {
  const driverId = MOCK_RESOURCE.id;
  try {
    const result = await pool.query(
      `SELECT * FROM route_feedback WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [driverId]
    );
    res.json({ success: true, feedback: result.rows });
  } catch (err) {
    console.error("Route feedback fetch error:", err.message);
    res.json({ success: true, feedback: [] });
  }
});
router.post("/route-feedback", async (req, res) => {
  const driverId = MOCK_RESOURCE.id;
  const { rating, reasons, comment, date } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Betyg (1-5) kr\xE4vs" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO route_feedback (driver_id, rating, reasons, comment, feedback_date, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [driverId, rating, JSON.stringify(reasons || []), comment || "", date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0]]
    );
    res.json({ success: true, feedback: result.rows[0] });
  } catch (err) {
    console.error("Route feedback save error:", err.message);
    res.status(500).json({ error: "Kunde inte spara ruttbetyg" });
  }
});
router.get("/terminology", async (req, res) => {
  const terminology = {
    order: "Order",
    work_order: "Arbetsorder",
    deviation: "Avvikelse",
    material: "Material",
    inspection: "Inspektion",
    checklist: "Checklista",
    signature: "Signatur",
    driver: "Chauff\xF6r",
    technician: "Tekniker",
    planner: "Planerare",
    customer: "Kund",
    object: "Objekt",
    article: "Artikel",
    route: "Rutt",
    work_session: "Arbetspass",
    check_in: "Incheckning",
    check_out: "Utcheckning",
    pause: "Paus",
    status_not_started: "Ej p\xE5b\xF6rjad",
    status_in_progress: "P\xE5g\xE5ende",
    status_completed: "Utf\xF6rd",
    status_failed: "Misslyckad",
    status_cancelled: "Inst\xE4lld",
    status_on_site: "P\xE5 plats",
    status_travel: "Under resa",
    status_signed_off: "Kvitterad",
    priority_low: "L\xE5g",
    priority_medium: "Medium",
    priority_high: "H\xF6g",
    priority_urgent: "Br\xE5dskande",
    photo_before: "F\xF6re",
    photo_after: "Efter",
    route_feedback: "Ruttbetyg",
    notification: "Notifiering",
    team: "Team"
  };
  if (!IS_MOCK_MODE) {
    try {
      const { data } = await traivoFetch("/api/mobile/terminology", {
        headers: getAuthHeader(req)
      });
      if (data && typeof data === "object") {
        return res.json({ success: true, terminology: data.terminology || data });
      }
    } catch {
    }
  }
  res.json({ success: true, terminology });
});

// server/routes/ai.ts
var import_express2 = require("express");
var import_openai = __toESM(require("openai"));
var openai = new import_openai.default({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
});
var router2 = (0, import_express2.Router)();
router2.post("/chat", async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Meddelande kr\xE4vs" });
    }
    let contextInfo = "";
    if (context) {
      if (Array.isArray(context)) {
        contextInfo = `Alla dagens ordrar: ${JSON.stringify(context)}
`;
      } else {
        const { currentOrder, allOrders, driverName } = context;
        if (driverName) contextInfo += `F\xF6rarens namn: ${driverName}
`;
        if (currentOrder) contextInfo += `Aktuell order: ${JSON.stringify(currentOrder)}
`;
        if (allOrders && allOrders.length > 0) contextInfo += `Alla dagens ordrar: ${JSON.stringify(allOrders)}
`;
      }
    }
    const systemPrompt = `Du \xE4r "Nordnav Assist", en AI-assistent f\xF6r f\xE4ltservicetekniker inom avfallshantering och logistik.

Du har tillg\xE5ng till kontext om aktuella ordrar, adresser, artiklar, kontaktpersoner och annat relevant f\xF6r dagens arbete.

Regler:
- Svara alltid koncist och tydligt p\xE5 svenska
- Hj\xE4lp med fr\xE5gor om arbetsuppgifter, navigering, procedurer och rapportering
- Om du f\xE5r fr\xE5gor om en order, anv\xE4nd den medf\xF6ljande kontexten
- Formatera svar tydligt med punktlistor eller numrerade listor vid behov
- Var professionell men v\xE4nlig

${contextInfo ? `Aktuell kontext:
${contextInfo}` : ""}`;
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ]
    });
    const reply = response.choices[0]?.message?.content || "Inget svar mottaget.";
    res.json({ response: reply });
  } catch (error) {
    console.error("AI chat error:", error);
    res.status(500).json({ error: "Kunde inte generera svar fr\xE5n AI" });
  }
});
router2.post("/chat/stream", async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Meddelande kr\xE4vs" });
    }
    let contextInfo = "";
    if (context) {
      if (Array.isArray(context)) {
        contextInfo = `Alla dagens ordrar: ${JSON.stringify(context)}
`;
      } else {
        const { currentOrder, allOrders, driverName } = context;
        if (driverName) contextInfo += `F\xF6rarens namn: ${driverName}
`;
        if (currentOrder) contextInfo += `Aktuell order: ${JSON.stringify(currentOrder)}
`;
        if (allOrders && allOrders.length > 0) contextInfo += `Alla dagens ordrar: ${JSON.stringify(allOrders)}
`;
      }
    }
    const systemPrompt = `Du \xE4r "Nordnav Assist", en AI-assistent f\xF6r f\xE4ltservicetekniker inom avfallshantering och logistik.

Du har tillg\xE5ng till kontext om aktuella ordrar, adresser, artiklar, kontaktpersoner och annat relevant f\xF6r dagens arbete.

Regler:
- Svara alltid koncist och tydligt p\xE5 svenska
- Hj\xE4lp med fr\xE5gor om arbetsuppgifter, navigering, procedurer och rapportering
- Om du f\xE5r fr\xE5gor om en order, anv\xE4nd den medf\xF6ljande kontexten
- Formatera svar tydligt med punktlistor eller numrerade listor vid behov
- Var professionell men v\xE4nlig

${contextInfo ? `Aktuell kontext:
${contextInfo}` : ""}`;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const stream = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      stream: true
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}

`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("AI chat stream error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Kunde inte generera svar fr\xE5n AI" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Streaming avbr\xF6ts." })}

`);
      res.end();
    }
  }
});
var MAX_BASE64_SIZE = 10 * 1024 * 1024;
router2.post("/transcribe", async (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) {
      return res.status(400).json({ error: "Ljuddata kr\xE4vs" });
    }
    if (typeof audio !== "string" || audio.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ error: "Ljudfilen \xE4r f\xF6r stor (max 10MB)" });
    }
    const audioBuffer = Buffer.from(audio, "base64");
    const file = await (0, import_openai.toFile)(audioBuffer, "audio.webm");
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe"
    });
    res.json({ text: transcription.text });
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "Kunde inte transkribera ljudet" });
  }
});
router2.post("/voice-command", async (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) {
      return res.status(400).json({ error: "Ljuddata kr\xE4vs" });
    }
    if (typeof audio !== "string" || audio.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ error: "Ljudfilen \xE4r f\xF6r stor (max 10MB)" });
    }
    const audioBuffer = Buffer.from(audio, "base64");
    const file = await (0, import_openai.toFile)(audioBuffer, "audio.webm");
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe"
    });
    const spokenText = transcription.text;
    const classifyPrompt = `Du \xE4r en r\xF6stkommandotolk f\xF6r en f\xE4ltservice-app (avfallshantering/logistik). Analysera f\xF6ljande transkriberad text och klassificera vilken \xE5tg\xE4rd anv\xE4ndaren vill utf\xF6ra.

M\xF6jliga kommandon:
1. "navigate_orders" - Anv\xE4ndaren vill se sina jobb/ordrar/uppdrag (t.ex. "Visa mina jobb", "Visa ordrar", "Mina uppdrag")
2. "start_next" - Anv\xE4ndaren vill starta n\xE4sta jobb (t.ex. "Starta n\xE4sta jobb", "B\xF6rja n\xE4sta uppdrag", "Starta")
3. "report_deviation" - Anv\xE4ndaren vill rapportera en avvikelse (t.ex. "Rapportera avvikelse", "Anm\xE4l problem", "Rapportera fel")
4. "on_site" - Anv\xE4ndaren har anl\xE4nt till platsen (t.ex. "Jag \xE4r p\xE5 plats", "Framme", "Ankommit")
5. "complete_order" - Anv\xE4ndaren vill markera aktuellt uppdrag som klart (t.ex. "Markera klar", "Klar", "Uppdrag klart", "F\xE4rdig")
6. "navigate_to" - Anv\xE4ndaren vill navigera till n\xE4sta uppdragsadress (t.ex. "Navigera dit", "K\xF6r dit", "Visa v\xE4gen", "Navigation")
7. "call_customer" - Anv\xE4ndaren vill ringa kunden (t.ex. "Ring kunden", "Ring kontakten", "Samtal")
8. "start_break" - Anv\xE4ndaren vill ta rast (t.ex. "Ta rast", "Paus", "Rast", "Fikapaus")
9. "navigate_statistics" - Anv\xE4ndaren vill se statistik (t.ex. "Visa statistik", "Statistik", "Hur g\xE5r det")
10. "help" - Anv\xE4ndaren vill h\xF6ra vilka kommandon som finns (t.ex. "Hj\xE4lp", "Vad kan jag s\xE4ga", "Kommandon")
11. "unknown" - Kommandot kunde inte tolkas

Svara ENBART i JSON-format:
{
  "action": "en_av_ovanst\xE5ende",
  "transcript": "den transkriberade texten",
  "confidence": 0.0-1.0,
  "displayMessage": "kort bekr\xE4ftelsemeddelande p\xE5 svenska"
}`;
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: classifyPrompt },
        { role: "user", content: spokenText }
      ]
    });
    const content = response.choices[0]?.message?.content || "";
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        res.json({
          action: parsed.action || "unknown",
          transcript: parsed.transcript || spokenText,
          confidence: parsed.confidence || 0,
          displayMessage: parsed.displayMessage || "Kommandot kunde inte tolkas."
        });
      } else {
        res.json({
          action: "unknown",
          transcript: spokenText,
          confidence: 0,
          displayMessage: "Kommandot kunde inte tolkas."
        });
      }
    } catch {
      res.json({
        action: "unknown",
        transcript: spokenText,
        confidence: 0,
        displayMessage: "Kommandot kunde inte tolkas."
      });
    }
  } catch (error) {
    console.error("Voice command error:", error);
    res.status(500).json({ error: "Kunde inte bearbeta r\xF6stkommandot" });
  }
});
router2.post("/analyze-image", async (req, res) => {
  try {
    const { image, context } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Bilddata kr\xE4vs" });
    }
    if (typeof image !== "string" || image.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ error: "Bilden \xE4r f\xF6r stor (max 10MB)" });
    }
    const systemPrompt = `Du \xE4r en AI som analyserar foton fr\xE5n f\xE4ltservicearbete. Beskriv vad du ser, identifiera problem eller avvikelser, och f\xF6resl\xE5 en kategori, allvarlighetsgrad och beskrivning f\xF6r avvikelserapporteringen.

Kategorier: broken_container, wrong_address, blocked_access, contamination, overfilled, missing_container, damaged_container, wrong_waste, overloaded, other

Allvarlighetsgrader: low, medium, high, critical

Svara alltid p\xE5 svenska.

Svara i f\xF6ljande JSON-format:
{
  "description": "En beskrivning av vad du ser p\xE5 bilden",
  "suggestedCategory": "en_av_kategorierna_ovan",
  "suggestedDescription": "En f\xF6reslagen beskrivning f\xF6r avvikelserapporten",
  "suggestedSeverity": "en_av_allvarlighetsgraderna_ovan",
  "confidence": 0.85
}

confidence ska vara ett tal mellan 0 och 1 som anger hur s\xE4ker du \xE4r p\xE5 din analys.${context ? `

Ytterligare kontext: ${context}` : ""}`;
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Analysera denna bild fr\xE5n f\xE4ltarbete och identifiera eventuella avvikelser." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }
          ]
        }
      ]
    });
    const content = response.choices[0]?.message?.content || "";
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        res.json({
          description: parsed.description || content,
          suggestedCategory: parsed.suggestedCategory || "other",
          suggestedDescription: parsed.suggestedDescription || content,
          suggestedSeverity: parsed.suggestedSeverity || "medium",
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5
        });
      } else {
        res.json({
          description: content,
          suggestedCategory: "other",
          suggestedDescription: content,
          suggestedSeverity: "medium",
          confidence: 0.5
        });
      }
    } catch {
      res.json({
        description: content,
        suggestedCategory: "other",
        suggestedDescription: content,
        suggestedSeverity: "medium",
        confidence: 0.5
      });
    }
  } catch (error) {
    console.error("Image analysis error:", error);
    res.status(500).json({ error: "Kunde inte analysera bilden" });
  }
});

// server/routes/planner.ts
var import_express3 = require("express");
var router3 = (0, import_express3.Router)();
function getWeekDates() {
  const dates = [];
  const now = /* @__PURE__ */ new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}
var EXTRA_WEEK_ORDERS = [
  {
    id: 101,
    orderNumber: "WO-2026-0461",
    status: "planned",
    customerName: "Volvo Cars Torslanda",
    address: "Torslandav\xE4gen 100",
    city: "G\xF6teborg",
    latitude: 57.7186,
    longitude: 11.8087,
    scheduledDate: (() => {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().split("T")[0];
    })(),
    scheduledTimeStart: "07:00",
    scheduledTimeEnd: "08:30",
    description: "T\xF6mning av containrar - Industriavfall",
    priority: "high",
    estimatedDuration: 45,
    executionCodes: [{ id: 2, code: "H\xC4MT", name: "H\xE4mtning" }]
  },
  {
    id: 102,
    orderNumber: "WO-2026-0462",
    status: "planned",
    customerName: "Liseberg AB",
    address: "\xD6rgrytev\xE4gen 5",
    city: "G\xF6teborg",
    latitude: 57.6948,
    longitude: 11.9926,
    scheduledDate: (() => {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().split("T")[0];
    })(),
    scheduledTimeStart: "09:00",
    scheduledTimeEnd: "10:00",
    description: "T\xF6mning av k\xE4rl - Hush\xE5llsavfall och plast",
    priority: "normal",
    estimatedDuration: 30,
    executionCodes: [{ id: 1, code: "T\xD6M", name: "T\xF6mning" }]
  },
  {
    id: 103,
    orderNumber: "WO-2026-0463",
    status: "planned",
    customerName: "Sahlgrenska Universitetssjukhuset",
    address: "Bl\xE5 str\xE5ket 5",
    city: "G\xF6teborg",
    latitude: 57.6838,
    longitude: 11.9618,
    scheduledDate: (() => {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() + 2);
      return d.toISOString().split("T")[0];
    })(),
    scheduledTimeStart: "06:00",
    scheduledTimeEnd: "07:00",
    description: "H\xE4mtning av farligt avfall - Sjukhusavfall",
    priority: "urgent",
    estimatedDuration: 60,
    executionCodes: [{ id: 3, code: "FARL", name: "Farligt avfall" }]
  },
  {
    id: 104,
    orderNumber: "WO-2026-0464",
    status: "planned",
    customerName: "Scandinavium Arena",
    address: "Valhallagatan 1",
    city: "G\xF6teborg",
    latitude: 57.7001,
    longitude: 11.987,
    scheduledDate: (() => {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() + 2);
      return d.toISOString().split("T")[0];
    })(),
    scheduledTimeStart: "10:00",
    scheduledTimeEnd: "11:30",
    description: "T\xF6mning av komprimator - Kartong",
    priority: "normal",
    estimatedDuration: 25,
    executionCodes: [{ id: 1, code: "T\xD6M", name: "T\xF6mning" }]
  },
  {
    id: 105,
    orderNumber: "WO-2026-0465",
    status: "planned",
    customerName: "Stena Line Terminal",
    address: "Emigrantv\xE4gen 1",
    city: "G\xF6teborg",
    latitude: 57.707,
    longitude: 11.932,
    scheduledDate: (() => {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() + 3);
      return d.toISOString().split("T")[0];
    })(),
    scheduledTimeStart: "08:00",
    scheduledTimeEnd: "09:30",
    description: "T\xF6mning av k\xE4rl och containrar",
    priority: "normal",
    estimatedDuration: 40,
    executionCodes: [{ id: 1, code: "T\xD6M", name: "T\xF6mning" }, { id: 2, code: "H\xC4MT", name: "H\xE4mtning" }]
  }
];
var ALL_ORDERS = [...MOCK_ORDERS, ...EXTRA_WEEK_ORDERS];
router3.get("/drivers/locations", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        driver_id as "driverId",
        driver_name as "driverName",
        vehicle_reg_no as "vehicleRegNo",
        latitude,
        longitude,
        speed,
        heading,
        accuracy,
        current_order_id as "currentOrderId",
        current_order_number as "currentOrderNumber",
        status,
        updated_at as "updatedAt"
      FROM driver_locations
      WHERE updated_at > NOW() - INTERVAL '24 hours'
        AND status = 'active'
      ORDER BY driver_name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching driver locations:", error);
    res.status(500).json({ error: "Kunde inte h\xE4mta positioner" });
  }
});
router3.get("/orders", (req, res) => {
  const range = req.query.range || "today";
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  let filteredOrders;
  if (range === "week") {
    const weekDates = getWeekDates();
    filteredOrders = ALL_ORDERS.filter((o) => weekDates.includes(o.scheduledDate));
  } else {
    filteredOrders = ALL_ORDERS.filter((o) => o.scheduledDate === today);
  }
  const mapped = filteredOrders.filter((o) => o.latitude != null && o.longitude != null).map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    customerName: o.customerName,
    address: o.address,
    city: o.city,
    latitude: o.latitude,
    longitude: o.longitude,
    scheduledDate: o.scheduledDate,
    scheduledTimeStart: o.scheduledTimeStart,
    scheduledTimeEnd: o.scheduledTimeEnd,
    description: o.description,
    priority: o.priority,
    estimatedDuration: o.estimatedDuration,
    executionCodes: o.executionCodes || []
  }));
  res.json(mapped);
});

// server/app.ts
var app = (0, import_express4.default)();
var server = import_http.default.createServer(app);
var io = new import_socket.Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/ws"
});
io.on("connection", (socket) => {
  console.log(`WebSocket client connected: ${socket.id}`);
  socket.on("join", (data) => {
    if (data.resourceId) {
      socket.join(`resource:${data.resourceId}`);
    }
    if (data.tenantId) {
      socket.join(`tenant:${data.tenantId}`);
    }
    if (data.teamId) {
      socket.join(`team:${data.teamId}`);
    }
  });
  socket.on("ping", () => {
    socket.emit("pong");
  });
  socket.on("position_update", (data) => {
    if (data.resourceId) {
      socket.to(`tenant:${data.tenantId || "default"}`).emit("position_update", data);
    }
  });
  socket.on("disconnect", () => {
    console.log(`WebSocket client disconnected: ${socket.id}`);
  });
});
app.io = io;
app.use((0, import_cors.default)());
app.use(import_express4.default.json({ limit: "10mb" }));
app.use("/api/mobile", router);
app.use("/api/mobile/ai", router2);
app.use("/api/planner", router3);
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "nordnav-api" });
});
var projectRoot = import_fs.default.existsSync(import_path.default.resolve(__dirname, "..", "app.json")) ? import_path.default.resolve(__dirname, "..") : process.cwd();
var metroDir = import_path.default.join(projectRoot, "dist-metro");
var templatesDir = import_path.default.join(projectRoot, "server", "templates");
console.log(`[init] projectRoot=${projectRoot}, templatesDir=${templatesDir}, exists=${import_fs.default.existsSync(templatesDir)}`);
var cachedAppJson = null;
var cachedSdkVersion = "54.0.0";
function loadAppJson() {
  try {
    cachedAppJson = JSON.parse(import_fs.default.readFileSync(import_path.default.join(projectRoot, "app.json"), "utf-8"));
  } catch (e) {
    console.error("Failed to load app.json:", e);
    cachedAppJson = { expo: { name: "Nordnav Go", slug: "fltapp", splash: {} } };
  }
}
function loadSdkVersion() {
  try {
    cachedSdkVersion = JSON.parse(import_fs.default.readFileSync(import_path.default.join(projectRoot, "node_modules", "expo", "package.json"), "utf-8")).version;
  } catch {
    cachedSdkVersion = "54.0.0";
  }
}
loadAppJson();
loadSdkVersion();
function getAppJson() {
  return cachedAppJson;
}
function getExpoSdkVersion() {
  return cachedSdkVersion;
}
function getHostUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}
function getHostUri(req) {
  return req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
}
function buildManifest(platform, req) {
  const appJson = getAppJson();
  const expo = appJson.expo;
  const hostUrl = getHostUrl(req);
  const hostUri = getHostUri(req);
  const sdkVersion = getExpoSdkVersion();
  const sdkMajor = sdkVersion.split(".")[0] + ".0.0";
  const bundlePath = import_path.default.join(metroDir, platform, "index.bundle");
  let bundleHash = "";
  try {
    const stat = import_fs.default.statSync(bundlePath);
    bundleHash = `?v=${stat.mtimeMs.toString(36)}`;
  } catch {
  }
  const bundleUrl = `${hostUrl}/bundles/${platform}/index.bundle${bundleHash}`;
  return {
    id: import_crypto.default.randomUUID(),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    runtimeVersion: `exposdk:${sdkMajor}`,
    launchAsset: {
      key: "bundle",
      contentType: "application/javascript",
      url: bundleUrl
    },
    assets: [],
    metadata: {},
    extra: {
      eas: {},
      expoClient: {
        ...expo,
        sdkVersion: sdkMajor,
        platforms: ["ios", "android", "web"],
        iconUrl: `${hostUrl}/assets/icon.png`,
        hostUri,
        splash: {
          ...expo.splash,
          imageUrl: `${hostUrl}/assets/${expo.splash?.image?.replace("./", "") || "splash-icon.png"}`
        },
        _internal: {
          isDebug: false,
          projectRoot: "/home/runner/workspace",
          dynamicConfigPath: null,
          staticConfigPath: "/home/runner/workspace/app.json",
          packageJsonPath: "/home/runner/workspace/package.json"
        }
      },
      expoGo: {
        debuggerHost: hostUri,
        developer: {
          tool: "expo-cli",
          projectRoot: "/home/runner/workspace"
        },
        packagerOpts: {
          dev: false
        },
        mainModuleName: "index"
      },
      scopeKey: `@anonymous/${expo.slug}`
    }
  };
}
function serveManifest(platform, req, res) {
  try {
    const manifest = buildManifest(platform, req);
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("expo-protocol-version", "0");
    res.setHeader("expo-sfv-version", "0");
    res.setHeader("cache-control", "private, max-age=0");
    res.send(JSON.stringify(manifest));
  } catch (e) {
    console.error("Failed to serve manifest:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate manifest" });
    }
  }
}
app.get("/manifest/:platform", (req, res) => {
  const platform = req.params.platform;
  if (platform !== "ios" && platform !== "android") {
    return res.status(404).json({ error: "Invalid platform" });
  }
  serveManifest(platform, req, res);
});
var bundleCache = {};
var DEV_DOMAIN = "143744bc-0950-40ae-a71f-7334bd02d088-00-2jqn3h1bml74q.kirk.replit.dev";
app.get("/bundles/:platform/index.bundle", (req, res) => {
  const platform = req.params.platform;
  if (platform !== "ios" && platform !== "android") {
    return res.status(404).send("Invalid platform");
  }
  const bundlePath = import_path.default.join(metroDir, platform, "index.bundle");
  if (!import_fs.default.existsSync(bundlePath)) {
    return res.status(404).send("Bundle not found. Run: bash scripts/build.sh");
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const cacheKey = `${platform}:${host}`;
  try {
    const stat = import_fs.default.statSync(bundlePath);
    const mtime = stat.mtimeMs;
    const cached = bundleCache[cacheKey];
    if (!cached || cached.mtime !== mtime) {
      let bundle = import_fs.default.readFileSync(bundlePath, "utf-8");
      if (host && host !== "localhost:5000" && host !== "localhost") {
        bundle = bundle.replaceAll(DEV_DOMAIN, host);
      }
      bundleCache[cacheKey] = { content: bundle, mtime };
    }
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(bundleCache[cacheKey].content);
  } catch (e) {
    console.error("Bundle serve error:", e);
    res.status(500).send("Failed to serve bundle");
  }
});
app.use("/assets", import_express4.default.static(import_path.default.join(projectRoot, "assets"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".ttf")) {
      res.setHeader("Content-Type", "font/ttf");
    } else if (filePath.endsWith(".png")) {
      res.setHeader("Content-Type", "image/png");
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
}));
app.get("/api/qrcode", async (req, res) => {
  const host = getHostUri(req);
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const expoProto = proto === "https" ? "exps" : "exp";
  const expoUrl = `${expoProto}://${host}`;
  try {
    const svg = await import_qrcode.default.toString(expoUrl, {
      type: "svg",
      width: 220,
      margin: 2,
      color: { dark: "#1B4F72", light: "#FFFFFF" }
    });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch {
    res.status(500).json({ error: "QR generation failed" });
  }
});
app.get("/api/qrcode/:platform", async (req, res) => {
  const host = getHostUri(req);
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const expoProto = proto === "https" ? "exps" : "exp";
  const expoUrl = `${expoProto}://${host}`;
  try {
    const svg = await import_qrcode.default.toString(expoUrl, {
      type: "svg",
      width: 220,
      margin: 2,
      color: { dark: "#1B4F72", light: "#FFFFFF" }
    });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch {
    res.status(500).json({ error: "QR generation failed" });
  }
});
app.get("/status", (_req, res) => {
  res.send("packager-status:running");
});
app.use(import_express4.default.static(templatesDir));
app.get("/planner/map", (_req, res) => {
  res.sendFile(import_path.default.join(templatesDir, "planner-map.html"));
});
app.get("/support", (_req, res) => {
  res.sendFile(import_path.default.join(templatesDir, "support.html"));
});
app.get("/", (req, res) => {
  try {
    const expoPlatform = req.headers["expo-platform"];
    if (expoPlatform === "ios" || expoPlatform === "android") {
      return serveManifest(expoPlatform, req, res);
    }
    const userAgent = req.headers["user-agent"] || "";
    if (userAgent.includes("Expo") || userAgent.includes("okhttp")) {
      const platform = userAgent.includes("iPhone") || userAgent.includes("iOS") ? "ios" : "android";
      return serveManifest(platform, req, res);
    }
    const landingPath = import_path.default.join(templatesDir, "landing-page.html");
    res.sendFile(landingPath, (err) => {
      if (err && !res.headersSent) {
        res.status(200).send(`<!DOCTYPE html><html><head><title>Nordnav Go</title></head><body><h1>Nordnav Go API</h1><p>Server is running.</p></body></html>`);
      }
    });
  } catch (e) {
    if (!res.headersSent) {
      res.status(200).send(`<!DOCTYPE html><html><head><title>Nordnav Go</title></head><body><h1>Nordnav Go API</h1><p>Server is running.</p></body></html>`);
    }
  }
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err.message);
  console.error(err.stack);
  setTimeout(() => process.exit(1), 500);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3e3);
});
process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3e3);
});
var PORT = 5e3;
server.listen(PORT, "0.0.0.0", () => {
  const traivoUrl = process.env.TRAIVO_API_URL || process.env.KINAB_API_URL;
  const mockMode = !traivoUrl || process.env.TRAIVO_MOCK_MODE === "true" || process.env.KINAB_MOCK_MODE === "true";
  console.log(`Nordnav Go API running on port ${PORT}`);
  console.log(`Traivo backend: ${mockMode ? "MOCK MODE (no TRAIVO_API_URL set)" : `LIVE \u2192 ${traivoUrl}`}`);
  const iosBundle = import_path.default.join(metroDir, "ios", "index.bundle");
  const androidBundle = import_path.default.join(metroDir, "android", "index.bundle");
  const hasIos = import_fs.default.existsSync(iosBundle);
  const hasAndroid = import_fs.default.existsSync(androidBundle);
  console.log(`Metro JS bundles: iOS=${hasIos}, Android=${hasAndroid}`);
  if (hasIos) console.log(`  iOS: ${(import_fs.default.statSync(iosBundle).size / 1024 / 1024).toFixed(1)} MB`);
  if (hasAndroid) console.log(`  Android: ${(import_fs.default.statSync(androidBundle).size / 1024 / 1024).toFixed(1)} MB`);
  if (!hasIos || !hasAndroid) {
    console.log("Warning: Bundles missing. Run: bash scripts/build.sh");
  }
});
server.on("error", (err) => {
  console.error("Server error:", err.message);
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});
setInterval(() => {
  process.stdout.write("");
}, 15e3);
