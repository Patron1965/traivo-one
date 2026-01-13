import { Router, Request, Response } from "express";
import { z, ZodError } from "zod";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { metadataKatalog, metadataVarden } from "@shared/schema";
import {
  getObjectWithAllMetadata,
  getMetadataValue,
  createMetadata,
  updateMetadata,
  deleteMetadata,
  getCrossFertilizedMetadata,
  getGeographicPosition,
  getClusterTree,
  findObjectsWithMetadata,
  getAllMetadataTypes,
  seedDefaultMetadataTypes,
  getWorkOrderMetadata,
  createWorkOrderMetadata,
  deleteWorkOrderMetadata,
} from "./metadata-queries";
import { getTenantIdWithFallback } from "./tenant-middleware";

export const metadataRouter = Router();

// ============================================================================
// METADATATYPER (KATALOG) ENDPOINTS
// ============================================================================

metadataRouter.get("/types", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const types = await getAllMetadataTypes(tenantId);
    res.json(types);
  } catch (error) {
    console.error("Error fetching metadata types:", error);
    res.status(500).json({ error: "Kunde inte hämta metadatatyper" });
  }
});

metadataRouter.post("/types/seed", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    await seedDefaultMetadataTypes(tenantId);
    res.json({ message: "Standardmetadatatyper skapade" });
  } catch (error) {
    console.error("Error seeding metadata types:", error);
    res.status(500).json({ error: "Kunde inte skapa metadatatyper" });
  }
});

const createMetadataTypeSchema = z.object({
  namn: z.string().min(1),
  beskrivning: z.string().optional(),
  datatyp: z.enum(['string', 'integer', 'decimal', 'boolean', 'datetime', 'json', 'referens']),
  referensTabell: z.string().optional(),
  arLogisk: z.boolean().optional().default(true),
  standardArvs: z.boolean().optional().default(false),
  kategori: z.string().optional().default('annat'),
  sortOrder: z.number().optional().default(0),
  icon: z.string().optional(),
});

metadataRouter.post("/types", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const validated = createMetadataTypeSchema.parse(req.body);

    const [newType] = await db.insert(metadataKatalog).values({
      tenantId,
      ...validated,
    }).returning();

    res.status(201).json(newType);
  } catch (error: any) {
    console.error("Error creating metadata type:", error);
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    res.status(500).json({ error: "Kunde inte skapa metadatatyp" });
  }
});

metadataRouter.put("/types/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;
    const validated = createMetadataTypeSchema.partial().parse(req.body);

    const [updated] = await db
      .update(metadataKatalog)
      .set(validated)
      .where(and(eq(metadataKatalog.id, id), eq(metadataKatalog.tenantId, tenantId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Metadatatyp hittades inte" });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating metadata type:", error);
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    res.status(500).json({ error: "Kunde inte uppdatera metadatatyp" });
  }
});

metadataRouter.delete("/types/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;

    await db
      .delete(metadataKatalog)
      .where(and(eq(metadataKatalog.id, id), eq(metadataKatalog.tenantId, tenantId)));

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting metadata type:", error);
    res.status(500).json({ error: "Kunde inte radera metadatatyp" });
  }
});

// ============================================================================
// OBJEKTMETADATA ENDPOINTS
// ============================================================================

metadataRouter.get("/objects/:objectId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;

    const objectWithMetadata = await getObjectWithAllMetadata(objectId, tenantId);

    if (!objectWithMetadata) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }

    res.json(objectWithMetadata);
  } catch (error) {
    console.error("Error fetching object metadata:", error);
    res.status(500).json({ error: "Kunde inte hämta metadata" });
  }
});

metadataRouter.get("/objects/:objectId/value/:typNamn", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId, typNamn } = req.params;

    const value = await getMetadataValue(objectId, typNamn, tenantId);

    res.json({ value });
  } catch (error) {
    console.error("Error fetching metadata value:", error);
    res.status(500).json({ error: "Kunde inte hämta metadata-värde" });
  }
});

metadataRouter.get("/objects/:objectId/position", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;

    const position = await getGeographicPosition(objectId, tenantId);

    res.json(position);
  } catch (error) {
    console.error("Error fetching geographic position:", error);
    res.status(500).json({ error: "Kunde inte hämta position" });
  }
});

metadataRouter.get("/objects/:objectId/tree", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId } = req.params;

    const tree = await getClusterTree(objectId, tenantId);

    if (!tree) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }

    res.json(tree);
  } catch (error) {
    console.error("Error fetching cluster tree:", error);
    res.status(500).json({ error: "Kunde inte hämta träd" });
  }
});

metadataRouter.get("/objects/:objectId/crossfertilized/:typNamn", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { objectId, typNamn } = req.params;

    const crossFertilized = await getCrossFertilizedMetadata(objectId, typNamn, tenantId);

    res.json(crossFertilized);
  } catch (error) {
    console.error("Error fetching cross-fertilized metadata:", error);
    res.status(500).json({ error: "Kunde inte hämta korsbefruktad metadata" });
  }
});

const createMetadataSchema = z.object({
  objektId: z.string(),
  metadataTypNamn: z.string(),
  varde: z.any(),
  arvsNedat: z.boolean().optional(),
  koppladTillMetadataId: z.string().nullable().optional(),
  skapadAv: z.string().optional(),
});

metadataRouter.post("/", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const validated = createMetadataSchema.parse(req.body);

    const newMetadata = await createMetadata({
      tenantId,
      ...validated,
    });

    res.status(201).json(newMetadata);
  } catch (error: any) {
    console.error("Error creating metadata:", error);
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    // Return 400 for validation errors (invalid values, missing objects, etc.)
    if (error.message?.includes('Invalid') || 
        error.message?.includes('not found') ||
        error.message?.includes('does not belong') ||
        error.message?.includes('Unknown datatype')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte skapa metadata" });
  }
});

const updateMetadataSchema = z.object({
  varde: z.any(),
  uppdateradAv: z.string().optional(),
});

metadataRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;
    const validated = updateMetadataSchema.parse(req.body);

    const updated = await updateMetadata(id, validated.varde, tenantId, validated.uppdateradAv);

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating metadata:", error);
    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    // Return 400 for validation errors (invalid values, not found, etc.)
    if (error.message?.includes('Invalid') || 
        error.message?.includes('not found') ||
        error.message?.includes('Unknown datatype')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte uppdatera metadata" });
  }
});

metadataRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;

    await deleteMetadata(id, tenantId);

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting metadata:", error);
    res.status(500).json({ error: "Kunde inte radera metadata" });
  }
});

metadataRouter.get("/search", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { typNamn, varde } = req.query;

    if (!typNamn || typeof typNamn !== 'string') {
      return res.status(400).json({ error: "typNamn krävs" });
    }

    const results = await findObjectsWithMetadata(typNamn, tenantId, varde);

    res.json(results);
  } catch (error) {
    console.error("Error searching metadata:", error);
    res.status(500).json({ error: "Kunde inte söka metadata" });
  }
});

metadataRouter.patch("/:id/inheritance", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;
    const { arvsNedat, stoppaVidareArvning } = req.body;

    const [updated] = await db
      .update(metadataVarden)
      .set({
        arvsNedat: arvsNedat !== undefined ? arvsNedat : undefined,
        stoppaVidareArvning: stoppaVidareArvning !== undefined ? stoppaVidareArvning : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(metadataVarden.id, id), eq(metadataVarden.tenantId, tenantId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Metadata hittades inte" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating metadata inheritance:", error);
    res.status(500).json({ error: "Kunde inte uppdatera ärvning" });
  }
});

// ============================================================================
// WORK ORDER METADATA ENDPOINTS
// ============================================================================

metadataRouter.get("/work-orders/:workOrderId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { workOrderId } = req.params;
    const metadata = await getWorkOrderMetadata(workOrderId, tenantId);
    res.json(metadata);
  } catch (error) {
    console.error("Error fetching work order metadata:", error);
    res.status(500).json({ error: "Kunde inte hämta arbetsordermetadata" });
  }
});

const createWorkOrderMetadataSchema = z.object({
  metadataTypNamn: z.string(),
  varde: z.any(),
  skapadAv: z.string().optional(),
});

metadataRouter.post("/work-orders/:workOrderId", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { workOrderId } = req.params;
    const validated = createWorkOrderMetadataSchema.parse(req.body);

    const newMetadata = await createWorkOrderMetadata({
      tenantId,
      workOrderId,
      ...validated,
    });

    res.status(201).json(newMetadata);
  } catch (error: any) {
    console.error("Error creating work order metadata:", error);
    if (error instanceof ZodError) {
      return res.status(400).json({ 
        error: "Valideringsfel", 
        details: error.errors 
      });
    }
    if (error.message?.includes('Invalid') || 
        error.message?.includes('not found') ||
        error.message?.includes('Unknown datatype')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte skapa arbetsordermetadata" });
  }
});

metadataRouter.delete("/work-orders/metadata/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) {
      return res.status(401).json({ error: "Ingen tenant hittad" });
    }

    const { id } = req.params;
    await deleteWorkOrderMetadata(id, tenantId);
    res.status(204).send();
  } catch (error: any) {
    console.error("Error deleting work order metadata:", error);
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Kunde inte radera arbetsordermetadata" });
  }
});
