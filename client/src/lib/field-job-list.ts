import { haversineDistanceKm } from "./geo";

// Pure helpers för fältappens uppgiftslista: ruttsortering, plats-/kundgruppering
// och fritextsök. Hålls fristående från SimpleFieldApp för testbarhet och för att
// inte blåsa upp den redan stora komponenten.

export interface FieldJobMeta {
  id: string;
  routeSequence: number | null;
  scheduledStartTime: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  customerId: string | null;
  customerName: string | null;
  // Ordernummer (kort referens, t.ex. WO-id-prefix) för gruppering/sök (G8).
  orderNumber: string | null;
  // Förlågrad (lowercased) sök-sträng byggd av anroparen.
  searchText: string;
}

export interface JobGroup {
  key: string;
  label: string;
  sublabel?: string;
  items: FieldJobMeta[];
}

// 30 meter = standardradie för platsgruppering enligt G3. Konfigurerbar per anrop
// (t.ex. tenant-inställning) via radiusKm-argumentet till groupByLocation, så att
// radien inte längre är en begravd magisk konstant (Å5).
export const DEFAULT_LOCATION_GROUP_RADIUS_KM = 0.03;

export function normalizeAddress(addr: string | null | undefined): string {
  if (!addr) return "";
  return addr.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;]+$/, "");
}

// Ruttordning: planerarens stopp-sekvens först (nulls last), därefter leveranstid,
// med fallback till kronologisk ordning när ruttdata saknas (G1).
export function compareByRoute(a: FieldJobMeta, b: FieldJobMeta): number {
  const sa = a.routeSequence;
  const sb = b.routeSequence;
  if (sa != null && sb != null && sa !== sb) return sa - sb;
  if (sa != null && sb == null) return -1;
  if (sa == null && sb != null) return 1;
  const ta = a.scheduledStartTime || "99:99";
  const tb = b.scheduledStartTime || "99:99";
  return ta.localeCompare(tb);
}

export function sortByRoute(metas: FieldJobMeta[]): FieldJobMeta[] {
  return [...metas].sort(compareByRoute);
}

// Greedy gruppering över en redan ruttsorterad lista: samma normaliserade
// gatuadress ELLER inom 30 m från gruppens ankare (G2/G3, täcker C8). Jobb utan
// koordinater och adress hamnar i egna grupper.
export function groupByLocation(
  metas: FieldJobMeta[],
  radiusKm: number = DEFAULT_LOCATION_GROUP_RADIUS_KM,
): JobGroup[] {
  const groups: JobGroup[] = [];
  for (const m of metas) {
    let placed = false;
    for (const g of groups) {
      const anchor = g.items[0];
      const mAddr = normalizeAddress(m.address);
      const aAddr = normalizeAddress(anchor.address);
      const sameAddr = mAddr !== "" && mAddr === aAddr;
      let near = false;
      if (
        m.lat != null && m.lng != null &&
        anchor.lat != null && anchor.lng != null
      ) {
        near = haversineDistanceKm(m.lat, m.lng, anchor.lat, anchor.lng) <= radiusKm;
      }
      if (sameAddr || near) {
        g.items.push(m);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({
        key: `loc-${m.id}`,
        label: m.address || "Okänd plats",
        items: [m],
      });
    }
  }
  return groups;
}

// Gruppering per kund (G8). Bevarar inkommande (ruttsorterad) ordning.
export function groupByCustomer(metas: FieldJobMeta[]): JobGroup[] {
  const map = new Map<string, JobGroup>();
  const order: string[] = [];
  for (const m of metas) {
    const key = m.customerId || "__ingen__";
    let group = map.get(key);
    if (!group) {
      group = { key: `cust-${key}`, label: m.customerName || "Ingen kund", items: [] };
      map.set(key, group);
      order.push(key);
    }
    group.items.push(m);
  }
  return order.map(k => map.get(k)!);
}

// Gruppering per ordernummer (G8). Varje order blir en utfällbar sektion och
// inkommande (ruttsorterad) ordning bevaras. Ordrar utan nummer samlas under en
// fallback-etikett.
export function groupByOrderNumber(metas: FieldJobMeta[]): JobGroup[] {
  const map = new Map<string, JobGroup>();
  const order: string[] = [];
  for (const m of metas) {
    const num = m.orderNumber;
    const key = num || "__utan__";
    let group = map.get(key);
    if (!group) {
      group = {
        key: `order-${key}`,
        label: num ? `Order #${num}` : "Utan ordernummer",
        items: [],
      };
      map.set(key, group);
      order.push(key);
    }
    group.items.push(m);
  }
  return order.map(k => map.get(k)!);
}

// Fritextsök (G9): alla termer måste matcha någonstans i den förlågrade söksträngen.
export function jobMatchesSearch(m: FieldJobMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  return terms.every(t => m.searchText.includes(t));
}

export function filterBySearch(metas: FieldJobMeta[], query: string): FieldJobMeta[] {
  if (!query.trim()) return metas;
  return metas.filter(m => jobMatchesSearch(m, query));
}
