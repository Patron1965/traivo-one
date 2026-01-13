import { db } from "./db";
import { sql, eq, and, inArray } from "drizzle-orm";
import { 
  objects, 
  metadataKatalog, 
  metadataVarden,
  MetadataKatalog,
  MetadataVarden,
  MetadataVardenWithKatalog,
  ObjectWithAllMetadataEAV,
  GeographicPosition
} from "@shared/schema";

// ============================================================================
// HÄMTA OBJEKT MED ALL METADATA (INKL. ÄRVD)
// Rekursiv CTE som går uppåt i hierarkin och samlar metadata
// ============================================================================

export async function getObjectWithAllMetadata(
  objektId: string,
  tenantId: string
): Promise<ObjectWithAllMetadataEAV | null> {
  const [objekt] = await db
    .select()
    .from(objects)
    .where(and(eq(objects.id, objektId), eq(objects.tenantId, tenantId)));

  if (!objekt) return null;

  // Build parent chain with stoppaVidareArvning tracking
  // The CTE now tracks which metadata types should be blocked from further inheritance
  const parentChainQuery = sql`
    WITH RECURSIVE parent_chain AS (
      SELECT
        id,
        parent_id,
        name,
        0 as level,
        ARRAY[]::varchar[] as blocked_katalog_ids
      FROM objects
      WHERE id = ${objektId} AND tenant_id = ${tenantId}

      UNION ALL

      SELECT
        o.id,
        o.parent_id,
        o.name,
        pc.level + 1,
        -- Accumulate blocked katalog IDs when we encounter stoppaVidareArvning
        pc.blocked_katalog_ids || COALESCE(
          (SELECT ARRAY_AGG(mv.metadata_katalog_id) 
           FROM metadata_varden mv 
           WHERE mv.objekt_id = pc.id 
             AND mv.stoppa_vidare_arvning = TRUE
             AND mv.tenant_id = ${tenantId}),
          ARRAY[]::varchar[]
        )
      FROM objects o
      INNER JOIN parent_chain pc ON o.id = pc.parent_id
      WHERE o.tenant_id = ${tenantId}
    ),
    metadata_with_context AS (
      SELECT
        mv.id,
        mv.objekt_id,
        mv.metadata_katalog_id,
        mv.varde_string,
        mv.varde_integer,
        mv.varde_decimal,
        mv.varde_boolean,
        mv.varde_datetime,
        mv.varde_json,
        mv.varde_referens,
        mv.arvs_nedat,
        mv.stoppa_vidare_arvning,
        mv.kopplad_till_metadata_id,
        mv.skapad_av,
        mv.uppdaterad_av,
        mv.created_at,
        mv.updated_at,
        mk.id as katalog_id,
        mk.namn as katalog_namn,
        mk.beskrivning as katalog_beskrivning,
        mk.datatyp as katalog_datatyp,
        mk.referens_tabell as katalog_referens_tabell,
        mk.ar_logisk as katalog_ar_logisk,
        mk.standard_arvs as katalog_standard_arvs,
        mk.kategori as katalog_kategori,
        mk.sort_order as katalog_sort_order,
        mk.icon as katalog_icon,
        pc.level,
        pc.name as from_objekt_namn,
        pc.blocked_katalog_ids,
        CASE
          WHEN mv.objekt_id = ${objektId} THEN 'local'
          ELSE 'inherited'
        END as source,
        -- Rank by level (0 = local object, higher = further ancestor)
        ROW_NUMBER() OVER (
          PARTITION BY mv.metadata_katalog_id 
          ORDER BY pc.level ASC
        ) as rn
      FROM parent_chain pc
      INNER JOIN metadata_varden mv ON mv.objekt_id = pc.id
      INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
      WHERE
        -- Include if local OR (inheritable AND not blocked by stoppa_vidare_arvning)
        (
          mv.objekt_id = ${objektId} 
          OR (mv.arvs_nedat = TRUE AND NOT (mv.metadata_katalog_id = ANY(pc.blocked_katalog_ids)))
        )
        AND mv.tenant_id = ${tenantId}
        AND mk.tenant_id = ${tenantId}
    )
    SELECT * FROM metadata_with_context
    WHERE rn = 1  -- Only take the nearest value for each metadata type
    ORDER BY
      katalog_kategori,
      katalog_sort_order,
      CASE WHEN source = 'local' THEN 0 ELSE 1 END
  `;

  const metadataResults = await db.execute(parentChainQuery);

  const seenMetadataKatalogIds = new Set<string>();
  const metadataWithKatalog: MetadataVardenWithKatalog[] = [];

  for (const row of metadataResults.rows as any[]) {
    // Use katalog_id for deduplication (not namn) to handle tenant isolation correctly
    if (seenMetadataKatalogIds.has(row.katalog_id)) {
      continue;
    }
    seenMetadataKatalogIds.add(row.katalog_id);

    metadataWithKatalog.push({
      id: row.id,
      tenantId: tenantId,
      objektId: row.objekt_id,
      workOrderId: null, // Object metadata doesn't have workOrderId
      metadataKatalogId: row.metadata_katalog_id,
      vardeString: row.varde_string,
      vardeInteger: row.varde_integer,
      vardeDecimal: row.varde_decimal,
      vardeBoolean: row.varde_boolean,
      vardeDatetime: row.varde_datetime,
      vardeJson: row.varde_json,
      vardeReferens: row.varde_referens,
      arvsNedat: row.arvs_nedat,
      stoppaVidareArvning: row.stoppa_vidare_arvning,
      koppladTillMetadataId: row.kopplad_till_metadata_id,
      skapadAv: row.skapad_av,
      uppdateradAv: row.uppdaterad_av,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      katalog: {
        id: row.katalog_id,
        tenantId: tenantId,
        namn: row.katalog_namn,
        beskrivning: row.katalog_beskrivning,
        datatyp: row.katalog_datatyp,
        referensTabell: row.katalog_referens_tabell,
        arLogisk: row.katalog_ar_logisk,
        standardArvs: row.katalog_standard_arvs,
        kategori: row.katalog_kategori,
        sortOrder: row.katalog_sort_order,
        icon: row.katalog_icon,
        createdAt: row.created_at,
      },
      source: row.source,
      fromObject: row.source === 'inherited' ? {
        id: row.objekt_id,
        namn: row.from_objekt_namn,
        level: row.level,
      } : undefined,
    });
  }

  return {
    id: objekt.id,
    name: objekt.name,
    objectType: objekt.objectType,
    parentId: objekt.parentId,
    metadata: metadataWithKatalog,
  };
}

// ============================================================================
// HÄMTA METADATA-VÄRDE (med ärvning)
// ============================================================================

export async function getMetadataValue(
  objektId: string,
  metadataTypNamn: string,
  tenantId: string
): Promise<any | null> {
  const objectWithMetadata = await getObjectWithAllMetadata(objektId, tenantId);
  
  if (!objectWithMetadata) return null;

  const metadata = objectWithMetadata.metadata.find(m => m.katalog.namn === metadataTypNamn);
  
  if (!metadata) return null;

  switch (metadata.katalog.datatyp) {
    case 'string':
      return metadata.vardeString;
    case 'integer':
      return metadata.vardeInteger;
    case 'decimal':
      return metadata.vardeDecimal;
    case 'boolean':
      return metadata.vardeBoolean;
    case 'datetime':
      return metadata.vardeDatetime;
    case 'json':
      return metadata.vardeJson;
    case 'referens':
      return metadata.vardeReferens;
    default:
      return null;
  }
}

// ============================================================================
// SKAPA METADATA
// ============================================================================

export async function createMetadata(data: {
  tenantId: string;
  objektId: string;
  metadataTypNamn: string;
  varde: any;
  arvsNedat?: boolean;
  koppladTillMetadataId?: string | null;
  skapadAv?: string;
}): Promise<MetadataVarden> {
  // SECURITY: Verify object belongs to tenant before allowing metadata creation
  const [objekt] = await db
    .select()
    .from(objects)
    .where(and(
      eq(objects.id, data.objektId),
      eq(objects.tenantId, data.tenantId)
    ));

  if (!objekt) {
    throw new Error(`Object "${data.objektId}" not found or does not belong to tenant`);
  }

  // Verify metadata type exists for this tenant
  const [metadataTyp] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.namn, data.metadataTypNamn),
      eq(metadataKatalog.tenantId, data.tenantId)
    ));

  if (!metadataTyp) {
    throw new Error(`Metadata type "${data.metadataTypNamn}" not found for this tenant`);
  }

  const vardeFields: any = {
    vardeString: null,
    vardeInteger: null,
    vardeDecimal: null,
    vardeBoolean: null,
    vardeDatetime: null,
    vardeJson: null,
    vardeReferens: null,
  };

  // VALIDATION: Strict datatype validation for all types
  switch (metadataTyp.datatyp) {
    case 'string':
      vardeFields.vardeString = String(data.varde);
      break;
    case 'integer':
      vardeFields.vardeInteger = parseInt(String(data.varde));
      if (isNaN(vardeFields.vardeInteger)) {
        throw new Error(`Invalid integer value: ${data.varde}`);
      }
      break;
    case 'decimal':
      vardeFields.vardeDecimal = parseFloat(String(data.varde));
      if (isNaN(vardeFields.vardeDecimal)) {
        throw new Error(`Invalid decimal value: ${data.varde}`);
      }
      break;
    case 'boolean':
      // Strict boolean parsing - reject ambiguous values
      if (typeof data.varde === 'boolean') {
        vardeFields.vardeBoolean = data.varde;
      } else if (data.varde === 'true' || data.varde === '1') {
        vardeFields.vardeBoolean = true;
      } else if (data.varde === 'false' || data.varde === '0') {
        vardeFields.vardeBoolean = false;
      } else {
        throw new Error(`Invalid boolean value: ${data.varde}`);
      }
      break;
    case 'datetime':
      vardeFields.vardeDatetime = new Date(data.varde);
      if (isNaN(vardeFields.vardeDatetime.getTime())) {
        throw new Error(`Invalid datetime value: ${data.varde}`);
      }
      break;
    case 'json':
      try {
        vardeFields.vardeJson = typeof data.varde === 'string' ? JSON.parse(data.varde) : data.varde;
      } catch (e) {
        throw new Error(`Invalid JSON value: ${data.varde}`);
      }
      break;
    case 'referens':
      vardeFields.vardeReferens = String(data.varde);
      break;
    default:
      throw new Error(`Unknown datatype: ${metadataTyp.datatyp}`);
  }

  const [newMetadata] = await db.insert(metadataVarden).values({
    tenantId: data.tenantId,
    objektId: data.objektId,
    metadataKatalogId: metadataTyp.id,
    ...vardeFields,
    arvsNedat: data.arvsNedat ?? metadataTyp.standardArvs,
    koppladTillMetadataId: data.koppladTillMetadataId ?? null,
    skapadAv: data.skapadAv,
  }).returning();

  return newMetadata;
}

// ============================================================================
// UPPDATERA METADATA
// ============================================================================

export async function updateMetadata(
  metadataId: string,
  varde: any,
  tenantId: string,
  uppdateradAv?: string
): Promise<MetadataVarden> {
  const [existing] = await db
    .select()
    .from(metadataVarden)
    .where(and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId)));

  if (!existing) {
    throw new Error(`Metadata with id ${metadataId} not found`);
  }

  // SECURITY: Also verify the metadata type belongs to this tenant
  const [metadataTyp] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.id, existing.metadataKatalogId),
      eq(metadataKatalog.tenantId, tenantId)
    ));

  if (!metadataTyp) {
    throw new Error(`Metadata type not found for this tenant`);
  }

  const vardeFields: any = {
    vardeString: null,
    vardeInteger: null,
    vardeDecimal: null,
    vardeBoolean: null,
    vardeDatetime: null,
    vardeJson: null,
    vardeReferens: null,
  };

  // VALIDATION: Proper datatype validation matching createMetadata
  switch (metadataTyp.datatyp) {
    case 'string':
      vardeFields.vardeString = String(varde);
      break;
    case 'integer':
      vardeFields.vardeInteger = parseInt(String(varde));
      if (isNaN(vardeFields.vardeInteger)) {
        throw new Error(`Invalid integer value: ${varde}`);
      }
      break;
    case 'decimal':
      vardeFields.vardeDecimal = parseFloat(String(varde));
      if (isNaN(vardeFields.vardeDecimal)) {
        throw new Error(`Invalid decimal value: ${varde}`);
      }
      break;
    case 'boolean':
      // Strict boolean parsing
      if (typeof varde === 'boolean') {
        vardeFields.vardeBoolean = varde;
      } else if (varde === 'true' || varde === '1') {
        vardeFields.vardeBoolean = true;
      } else if (varde === 'false' || varde === '0') {
        vardeFields.vardeBoolean = false;
      } else {
        throw new Error(`Invalid boolean value: ${varde}`);
      }
      break;
    case 'datetime':
      vardeFields.vardeDatetime = new Date(varde);
      if (isNaN(vardeFields.vardeDatetime.getTime())) {
        throw new Error(`Invalid datetime value: ${varde}`);
      }
      break;
    case 'json':
      try {
        vardeFields.vardeJson = typeof varde === 'string' ? JSON.parse(varde) : varde;
      } catch (e) {
        throw new Error(`Invalid JSON value: ${varde}`);
      }
      break;
    case 'referens':
      vardeFields.vardeReferens = String(varde);
      break;
    default:
      throw new Error(`Unknown datatype: ${metadataTyp.datatyp}`);
  }

  const [updated] = await db
    .update(metadataVarden)
    .set({
      ...vardeFields,
      uppdateradAv,
      updatedAt: new Date(),
    })
    .where(and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId)))
    .returning();

  return updated;
}

// ============================================================================
// RADERA METADATA
// ============================================================================

export async function deleteMetadata(metadataId: string, tenantId: string): Promise<void> {
  await db.delete(metadataVarden).where(
    and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId))
  );
}

// ============================================================================
// HÄMTA KORSBEFRUKTAD METADATA
// ============================================================================

export async function getCrossFertilizedMetadata(
  objektId: string,
  baseMetadataTypNamn: string,
  tenantId: string
): Promise<any[]> {
  const query = sql`
    SELECT
      mv_base.id as base_id,
      mk_base.namn as base_typ,
      COALESCE(
        mv_base.varde_string,
        CAST(mv_base.varde_integer AS TEXT),
        CAST(mv_base.varde_decimal AS TEXT),
        CAST(mv_base.varde_boolean AS TEXT),
        mv_base.varde_referens
      ) as base_varde,
      mv_related.id as related_id,
      mk_related.namn as related_typ,
      COALESCE(
        mv_related.varde_string,
        CAST(mv_related.varde_integer AS TEXT),
        CAST(mv_related.varde_decimal AS TEXT),
        CAST(mv_related.varde_boolean AS TEXT),
        mv_related.varde_referens
      ) as related_varde
    FROM metadata_varden mv_base
    INNER JOIN metadata_katalog mk_base ON mv_base.metadata_katalog_id = mk_base.id
    LEFT JOIN metadata_varden mv_related ON mv_related.kopplad_till_metadata_id = mv_base.id
    LEFT JOIN metadata_katalog mk_related ON mv_related.metadata_katalog_id = mk_related.id
    WHERE
      mv_base.objekt_id = ${objektId}
      AND mk_base.namn = ${baseMetadataTypNamn}
      AND mv_base.tenant_id = ${tenantId}
  `;

  const result = await db.execute(query);
  return result.rows as any[];
}

// ============================================================================
// GEOGRAFISK UPPLÖSNINGSORDNING
// GPS (exakt) > What3words (medel) > Adress (grov)
// ============================================================================

export async function getGeographicPosition(
  objektId: string,
  tenantId: string
): Promise<GeographicPosition | null> {
  const objectWithMetadata = await getObjectWithAllMetadata(objektId, tenantId);
  
  if (!objectWithMetadata) return null;

  const gpsMetadata = objectWithMetadata.metadata.find(m => m.katalog.namn === 'GPS');
  if (gpsMetadata && gpsMetadata.vardeString) {
    return {
      typ: 'GPS',
      precision: 'exakt',
      varde: gpsMetadata.vardeString,
      fromObject: gpsMetadata.fromObject,
    };
  }

  const w3wMetadata = objectWithMetadata.metadata.find(m => m.katalog.namn === 'What3words');
  if (w3wMetadata && w3wMetadata.vardeString) {
    return {
      typ: 'What3words',
      precision: 'medel',
      varde: w3wMetadata.vardeString,
      fromObject: w3wMetadata.fromObject,
    };
  }

  const adressMetadata = objectWithMetadata.metadata.find(m => m.katalog.namn === 'Adress');
  if (adressMetadata && adressMetadata.vardeString) {
    return {
      typ: 'Adress',
      precision: 'grov',
      varde: adressMetadata.vardeString,
      fromObject: adressMetadata.fromObject,
    };
  }

  return null;
}

// ============================================================================
// HÄMTA KLUSTERTRÄD
// ============================================================================

export interface ClusterTreeNode {
  id: string;
  namn: string;
  typ: string;
  parentId: string | null;
  children: ClusterTreeNode[];
  level: number;
}

export async function getClusterTree(
  rootId: string,
  tenantId: string
): Promise<ClusterTreeNode | null> {
  const treeQuery = sql`
    WITH RECURSIVE tree AS (
      SELECT
        id,
        name,
        object_type,
        parent_id,
        0 as level,
        ARRAY[id] as path
      FROM objects
      WHERE id = ${rootId} AND tenant_id = ${tenantId}

      UNION ALL

      SELECT
        o.id,
        o.name,
        o.object_type,
        o.parent_id,
        t.level + 1,
        t.path || o.id
      FROM objects o
      INNER JOIN tree t ON o.parent_id = t.id
      WHERE o.tenant_id = ${tenantId}
    )
    SELECT * FROM tree
    ORDER BY path
  `;

  const result = await db.execute(treeQuery);
  const rows = result.rows as any[];

  if (rows.length === 0) return null;

  const nodeMap = new Map<string, ClusterTreeNode>();

  rows.forEach(row => {
    nodeMap.set(row.id, {
      id: row.id,
      namn: row.name,
      typ: row.object_type,
      parentId: row.parent_id,
      children: [],
      level: row.level,
    });
  });

  rows.forEach(row => {
    if (row.parent_id !== null) {
      const parent = nodeMap.get(row.parent_id);
      const child = nodeMap.get(row.id);
      if (parent && child) {
        parent.children.push(child);
      }
    }
  });

  return nodeMap.get(rootId) || null;
}

// ============================================================================
// HITTA OBJEKT MED SPECIFIK METADATA
// ============================================================================

export async function findObjectsWithMetadata(
  metadataTypNamn: string,
  tenantId: string,
  varde?: any
): Promise<ObjectWithAllMetadataEAV[]> {
  let baseQuery = sql`
    SELECT DISTINCT o.id
    FROM objects o
    INNER JOIN metadata_varden mv ON mv.objekt_id = o.id
    INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
    WHERE mk.namn = ${metadataTypNamn}
      AND o.tenant_id = ${tenantId}
  `;

  if (varde !== undefined) {
    baseQuery = sql`
      SELECT DISTINCT o.id
      FROM objects o
      INNER JOIN metadata_varden mv ON mv.objekt_id = o.id
      INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
      WHERE mk.namn = ${metadataTypNamn}
        AND o.tenant_id = ${tenantId}
        AND (
          mv.varde_string = ${String(varde)}
          OR CAST(mv.varde_integer AS TEXT) = ${String(varde)}
          OR mv.varde_referens = ${String(varde)}
        )
    `;
  }

  const result = await db.execute(baseQuery);
  const objectIds = (result.rows as any[]).map(row => row.id);

  const objectsWithMetadata: ObjectWithAllMetadataEAV[] = [];
  for (const objectId of objectIds) {
    const obj = await getObjectWithAllMetadata(objectId, tenantId);
    if (obj) {
      objectsWithMetadata.push(obj);
    }
  }

  return objectsWithMetadata;
}

// ============================================================================
// HÄMTA ALLA METADATATYPER FÖR EN TENANT
// ============================================================================

export async function getAllMetadataTypes(tenantId: string): Promise<MetadataKatalog[]> {
  return await db
    .select()
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId))
    .orderBy(metadataKatalog.kategori, metadataKatalog.sortOrder);
}

// ============================================================================
// SEED STANDARD METADATATYPER FÖR EN TENANT
// ============================================================================

export async function seedDefaultMetadataTypes(tenantId: string): Promise<void> {
  const existingTypes = await db
    .select()
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId));

  if (existingTypes.length > 0) {
    return;
  }

  const defaultTypes = [
    { namn: 'Adress', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'geografi', beskrivning: 'Postadress (grov position)', sortOrder: 1, icon: 'MapPin' },
    { namn: 'GPS', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'geografi', beskrivning: 'GPS-koordinater (longitud, latitud)', sortOrder: 2, icon: 'Navigation' },
    { namn: 'What3words', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'geografi', beskrivning: 'What3words adress (3x3 meter precision)', sortOrder: 3, icon: 'Grid3x3' },
    
    { namn: 'Antal', datatyp: 'integer', arLogisk: true, standardArvs: false, kategori: 'kvantitet', beskrivning: 'Antal av objektet', sortOrder: 10, icon: 'Hash' },
    { namn: 'Area', datatyp: 'decimal', arLogisk: true, standardArvs: false, kategori: 'kvantitet', beskrivning: 'Storlek i kvadratmeter', sortOrder: 11, icon: 'Square' },
    { namn: 'Volym', datatyp: 'integer', arLogisk: true, standardArvs: false, kategori: 'kvantitet', beskrivning: 'Volym i liter', sortOrder: 12, icon: 'Box' },
    
    { namn: 'Kund', datatyp: 'referens', referensTabell: 'customers', arLogisk: true, standardArvs: true, kategori: 'administrativ', beskrivning: 'Kund-referens', sortOrder: 20, icon: 'Building' },
    { namn: 'Kundnummer', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'administrativ', beskrivning: 'Kundnummer', sortOrder: 21, icon: 'FileText' },
    { namn: 'Er_Referens', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'administrativ', beskrivning: 'Kundens referens', sortOrder: 22, icon: 'FileSearch' },
    { namn: 'Er_Ordernummer', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'administrativ', beskrivning: 'Kundens ordernummer', sortOrder: 23, icon: 'ClipboardList' },
    
    { namn: 'Kontaktperson_Namn', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'kontakt', beskrivning: 'Kontaktpersonens namn', sortOrder: 30, icon: 'User' },
    { namn: 'Kontaktperson_Telefon', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'kontakt', beskrivning: 'Kontaktpersonens telefonnummer', sortOrder: 31, icon: 'Phone' },
    { namn: 'Kontaktperson_Epost', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'kontakt', beskrivning: 'Kontaktpersonens e-post', sortOrder: 32, icon: 'Mail' },
    { namn: 'Kontaktperson_Roll', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'kontakt', beskrivning: 'Kontaktpersonens roll (t.ex. Bovärd, Förvaltare)', sortOrder: 33, icon: 'Badge' },
    
    { namn: 'Beskrivning', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'beskrivning', beskrivning: 'Fritextbeskrivning', sortOrder: 40, icon: 'FileText' },
    { namn: 'Anteckningar', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'beskrivning', beskrivning: 'Praktiska anteckningar', sortOrder: 41, icon: 'StickyNote' },
    { namn: 'Markning', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'beskrivning', beskrivning: 'Taggar/etiketter', sortOrder: 42, icon: 'Tag' },
    
    { namn: 'Artikel', datatyp: 'referens', referensTabell: 'articles', arLogisk: true, standardArvs: false, kategori: 'artikel', beskrivning: 'Artikel-referens', sortOrder: 50, icon: 'Package' },
    { namn: 'Prislista', datatyp: 'referens', referensTabell: 'price_lists', arLogisk: true, standardArvs: true, kategori: 'artikel', beskrivning: 'Prislista-referens', sortOrder: 51, icon: 'DollarSign' },
    
    { namn: 'Frekvens', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'tid', beskrivning: 'Hur ofta något ska göras', sortOrder: 60, icon: 'RefreshCw' },
    { namn: 'Tidsfonster', datatyp: 'json', arLogisk: true, standardArvs: true, kategori: 'tid', beskrivning: 'När något får/måste göras', sortOrder: 61, icon: 'Clock' },
    
    { namn: 'Detaljtyp', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'klassificering', beskrivning: 'Specifik typ av objekt (t.ex. Pantkärl_160L, Miljörum)', sortOrder: 70, icon: 'Layers' },
    { namn: 'Kod', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'atkomst', beskrivning: 'Åtkomstkod till objekt/område', sortOrder: 80, icon: 'Key' },
    { namn: 'Rating', datatyp: 'integer', arLogisk: true, standardArvs: false, kategori: 'betyg', beskrivning: 'Betyg/rating (t.ex. 4 av 5)', sortOrder: 90, icon: 'Star' },
    
    { namn: 'Foto', datatyp: 'json', arLogisk: false, standardArvs: false, kategori: 'bilagor', beskrivning: 'Foton kopplade till objektet', sortOrder: 100, icon: 'Image' },
    { namn: 'Filer', datatyp: 'json', arLogisk: false, standardArvs: false, kategori: 'bilagor', beskrivning: 'Dokument/filer kopplade till objektet', sortOrder: 101, icon: 'File' },
  ];

  for (const type of defaultTypes) {
    await db.insert(metadataKatalog).values({
      tenantId,
      ...type,
    });
  }
}
