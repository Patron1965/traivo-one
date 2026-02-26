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

// server/routes/mobile.ts
var router = (0, import_express.Router)();
var KINAB_API_URL = process.env.KINAB_API_URL || "";
var IS_MOCK_MODE = !KINAB_API_URL || process.env.KINAB_MOCK_MODE === "true";
async function kinabFetch(path2, options = {}) {
  const url = `${KINAB_API_URL}${path2}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...options.headers || {}
      }
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.error(`Kinab API returned non-JSON (${contentType}) for ${path2}`);
      throw new Error("Kinab-servern svarade inte med JSON (kan vara nere)");
    }
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (error) {
    console.error(`Kinab API error (${path2}):`, error.message);
    throw new Error(`Kunde inte n\xE5 Kinab-servern: ${error.message}`);
  }
}
function getAuthHeader(req) {
  const auth = req.headers.authorization;
  return auth ? { "Authorization": auth } : {};
}
var MOCK_RESOURCE = {
  id: 101,
  tenantId: "kinab-demo",
  name: "Erik Lindqvist",
  type: "driver",
  phone: "070-111 22 33",
  email: "erik.lindqvist@kinab.se",
  vehicleRegNo: "ABC 123",
  homeLatitude: 57.7089,
  homeLongitude: 11.9746,
  competencies: ["ADR", "YKB", "C-k\xF6rkort"],
  executionCodes: ["T\xD6M", "H\xC4MT", "FARL"]
};
var MOCK_TOKEN = "mock-driver-token-001";
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
    tenantId: "kinab-demo"
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
    tenantId: "kinab-demo"
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
    tenantId: "kinab-demo"
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
    tenantId: "kinab-demo"
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
    tenantId: "kinab-demo"
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
function mapKinabStatus(kinabStatus, orderStatus) {
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
  return statusMap[kinabStatus] || statusMap[orderStatus || ""] || "planned";
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
function transformKinabOrder(raw) {
  const addrParts = parseAddressParts(raw.objectAddress || "");
  return {
    id: raw.id,
    orderNumber: raw.title || raw.externalReference || `ORD-${(raw.id || "").toString().slice(0, 8)}`,
    status: mapKinabStatus(raw.status, raw.orderStatus),
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
    creationMethod: raw.creationMethod || "manual",
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
    const { username, password, pin } = req.body;
    if (pin) {
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
    const { status, data } = await kinabFetch("/api/mobile/login", {
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
    console.error("Login proxy error:", error.message);
    res.status(503).json({
      success: false,
      error: "Kunde inte n\xE5 inloggningsservern. F\xF6rs\xF6k igen om en stund."
    });
  }
});
router.post("/logout", async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ success: true });
    return;
  }
  try {
    const { status, data } = await kinabFetch("/api/mobile/logout", {
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
    const { status, data } = await kinabFetch("/api/mobile/me", {
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
router.get("/my-orders", async (req, res) => {
  if (IS_MOCK_MODE) {
    const date = req.query.date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const orders = MOCK_ORDERS.filter((o) => o.scheduledDate === date);
    res.json(orders);
    return;
  }
  try {
    const queryString = req.query.date ? `?date=${req.query.date}` : "";
    const { status, data } = await kinabFetch(`/api/mobile/my-orders${queryString}`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (status === 200) {
      const rawOrders = Array.isArray(data) ? data : data.orders || [];
      const transformed = rawOrders.map(transformKinabOrder);
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    if (status === 200 && data) {
      res.json(transformKinabOrder(data));
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/checklist`, {
      method: "GET",
      headers: getAuthHeader(req)
    });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte h\xE4mta checklista. F\xF6rs\xF6k igen." });
  }
});
router.patch("/orders/:id/status", async (req, res) => {
  const io2 = req.app.io;
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find((o) => o.id === parseInt(req.params.id));
    if (order) {
      if (order.isLocked) {
        res.status(403).json({ error: "Uppdraget \xE4r l\xE5st - beroende uppdrag ej slutf\xF6rda" });
        return;
      }
      order.status = req.body.status;
      if (req.body.status === "on_site" || req.body.status === "in_progress" || req.body.status === "planerad_las") {
        order.actualStartTime = order.actualStartTime || (/* @__PURE__ */ new Date()).toISOString();
      }
      if (req.body.status === "completed" || req.body.status === "utford") {
        order.completedAt = (/* @__PURE__ */ new Date()).toISOString();
        order.actualEndTime = (/* @__PURE__ */ new Date()).toISOString();
      }
      if (req.body.status === "failed" || req.body.status === "impossible") {
        order.actualEndTime = (/* @__PURE__ */ new Date()).toISOString();
        if (req.body.impossibleReason) {
          order.impossibleReason = req.body.impossibleReason;
          order.impossibleAt = (/* @__PURE__ */ new Date()).toISOString();
        }
      }
      if (req.body.status === "fakturerad") {
        order.completedAt = order.completedAt || (/* @__PURE__ */ new Date()).toISOString();
      }
      if (io2) {
        io2.emit("order:updated", { orderId: order.id, status: order.status, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      }
      res.json(order);
    } else {
      res.status(404).json({ error: "Order hittades inte" });
    }
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/status`, {
      method: "PATCH",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch (error) {
    res.status(503).json({ error: "Kunde inte uppdatera status. F\xF6rs\xF6k igen." });
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/deviations`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte rapportera avvikelse." });
  }
});
router.post("/orders/:id/materials", async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ id: Date.now(), orderId: parseInt(req.params.id), ...req.body, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/materials`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/signature`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/notes`, {
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/substeps/${req.params.stepId}`, {
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/inspections`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte spara inspektion." });
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/upload-photo`, {
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
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/confirm-photo`, {
      method: "POST",
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body)
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: "Kunde inte bekr\xE4fta foto." });
  }
});
router.get("/notifications", async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json(MOCK_NOTIFICATIONS);
    return;
  }
  try {
    const { status, data } = await kinabFetch("/api/mobile/notifications", { method: "GET", headers: getAuthHeader(req) });
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
    const { status, data } = await kinabFetch(`/api/mobile/notifications/${req.params.id}/read`, {
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
    const { status, data } = await kinabFetch("/api/mobile/notifications/read-all", {
      method: "PATCH",
      headers: getAuthHeader(req)
    });
    res.status(status).json(data);
  } catch {
    res.json({ success: true });
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
    const { status, data } = await kinabFetch("/api/mobile/sync", {
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
router.post("/position", async (req, res) => {
  const { latitude, longitude, speed, heading, accuracy } = req.body;
  if (!IS_MOCK_MODE) {
    try {
      await kinabFetch("/api/mobile/position", {
        method: "POST",
        headers: getAuthHeader(req),
        body: JSON.stringify(req.body)
      });
    } catch (e) {
      console.error("Kinab position proxy error:", e.message);
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
    const { status: summaryStatus, data: summaryData } = await kinabFetch("/api/mobile/summary", {
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
    const { status: ordersStatus, data: ordersData } = await kinabFetch("/api/mobile/my-orders", {
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
    const systemPrompt = `Du \xE4r "Unicorn Assist", en AI-assistent f\xF6r f\xE4ltservicetekniker inom avfallshantering och logistik.

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
router2.post("/transcribe", async (req, res) => {
  try {
    const { audio } = req.body;
    if (!audio) {
      return res.status(400).json({ error: "Ljuddata kr\xE4vs" });
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
5. "unknown" - Kommandot kunde inte tolkas

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
  });
  socket.on("disconnect", () => {
    console.log(`WebSocket client disconnected: ${socket.id}`);
  });
});
app.io = io;
app.use((0, import_cors.default)());
app.use(import_express4.default.json({ limit: "50mb" }));
app.use("/api/mobile", router);
app.use("/api/mobile/ai", router2);
app.use("/api/planner", router3);
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "driver-core-api" });
});
var projectRoot = import_path.default.resolve(__dirname, "..");
var metroDir = import_path.default.join(projectRoot, "dist-metro");
var templatesDir = import_path.default.join(projectRoot, "server", "templates");
function getAppJson() {
  return JSON.parse(import_fs.default.readFileSync(import_path.default.join(projectRoot, "app.json"), "utf-8"));
}
function getExpoSdkVersion() {
  try {
    return JSON.parse(import_fs.default.readFileSync(import_path.default.join(projectRoot, "node_modules", "expo", "package.json"), "utf-8")).version;
  } catch {
    return "54.0.0";
  }
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
  const bundleUrl = `${hostUrl}/bundles/${platform}/index.bundle`;
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
  const manifest = buildManifest(platform, req);
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("expo-protocol-version", "0");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("cache-control", "private, max-age=0");
  res.send(JSON.stringify(manifest));
}
app.get("/manifest/:platform", (req, res) => {
  const platform = req.params.platform;
  if (platform !== "ios" && platform !== "android") {
    return res.status(404).json({ error: "Invalid platform" });
  }
  serveManifest(platform, req, res);
});
app.get("/bundles/:platform/index.bundle", (req, res) => {
  const platform = req.params.platform;
  if (platform !== "ios" && platform !== "android") {
    return res.status(404).send("Invalid platform");
  }
  const bundlePath = import_path.default.join(metroDir, platform, "index.bundle");
  if (!import_fs.default.existsSync(bundlePath)) {
    return res.status(404).send("Bundle not found. Run: bash scripts/build.sh");
  }
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(bundlePath);
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
app.get("/", (req, res) => {
  const expoPlatform = req.headers["expo-platform"];
  if (expoPlatform === "ios" || expoPlatform === "android") {
    return serveManifest(expoPlatform, req, res);
  }
  const userAgent = req.headers["user-agent"] || "";
  if (userAgent.includes("Expo") || userAgent.includes("okhttp")) {
    const platform = userAgent.includes("iPhone") || userAgent.includes("iOS") ? "ios" : "android";
    return serveManifest(platform, req, res);
  }
  res.sendFile(import_path.default.join(templatesDir, "landing-page.html"));
});
var PORT = 5e3;
server.listen(PORT, "0.0.0.0", () => {
  const kinabUrl = process.env.KINAB_API_URL;
  const mockMode = !kinabUrl || process.env.KINAB_MOCK_MODE === "true";
  console.log(`Driver Core API running on port ${PORT}`);
  console.log(`Kinab Core Concept: ${mockMode ? "MOCK MODE (no KINAB_API_URL set)" : `LIVE \u2192 ${kinabUrl}`}`);
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
