import type { Express } from "express";
import { db } from "../db";
import { sql, and, gte, lte, isNull, eq } from "drizzle-orm";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { workOrders, workOrderLines, articles, resources, workEntries } from "@shared/schema";

export async function registerFeedbackLoopRoutes(app: Express) {

  app.get("/api/feedback-loop/service-accuracy", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const weeks = parseInt(req.query.weeks as string) || 12;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - weeks * 7);

    const rows = await db.execute(sql`
      SELECT
        EXTRACT(ISOYEAR FROM wo.completed_at)::int AS year,
        EXTRACT(WEEK FROM wo.completed_at)::int AS week,
        COUNT(*)::int AS count,
        ROUND(AVG(wo.estimated_duration))::int AS avg_estimated,
        ROUND(AVG(wo.actual_duration))::int AS avg_actual,
        ROUND(AVG(wo.actual_duration - wo.estimated_duration))::int AS avg_delta,
        ROUND(AVG(CASE WHEN wo.estimated_duration > 0
          THEN ((wo.actual_duration - wo.estimated_duration)::numeric / wo.estimated_duration) * 100
          ELSE 0 END), 1) AS avg_deviation_pct
      FROM work_orders wo
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.completed_at IS NOT NULL
        AND wo.actual_duration IS NOT NULL
        AND wo.estimated_duration IS NOT NULL
        AND wo.estimated_duration > 0
        AND wo.completed_at >= ${startDate}
        AND wo.completed_at <= ${endDate}
      GROUP BY year, week
      ORDER BY year, week
    `);

    res.json(rows.rows || []);
  }));

  app.get("/api/feedback-loop/article-accuracy", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const days = parseInt(req.query.days as string) || 90;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const rows = await db.execute(sql`
      SELECT
        a.id AS article_id,
        a.name AS article_name,
        a.article_number,
        a.article_type,
        a.production_time AS standard_time,
        COUNT(wo.id)::int AS sample_count,
        ROUND(AVG(wo.estimated_duration))::int AS avg_estimated,
        ROUND(AVG(wo.actual_duration))::int AS avg_actual,
        ROUND(AVG(wo.actual_duration - wo.estimated_duration))::int AS avg_delta_min,
        ROUND(AVG(CASE WHEN wo.estimated_duration > 0
          THEN ((wo.actual_duration - wo.estimated_duration)::numeric / wo.estimated_duration) * 100
          ELSE 0 END), 1) AS avg_deviation_pct,
        ROUND(STDDEV(wo.actual_duration), 1) AS stddev_actual,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wo.actual_duration)::int AS median_actual
      FROM work_orders wo
      JOIN work_order_lines wol ON wol.work_order_id = wo.id
      JOIN articles a ON a.id = wol.article_id
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.completed_at IS NOT NULL
        AND wo.actual_duration IS NOT NULL
        AND wo.estimated_duration IS NOT NULL
        AND wo.estimated_duration > 0
        AND wo.completed_at >= ${startDate}
      GROUP BY a.id, a.name, a.article_number, a.article_type, a.production_time
      HAVING COUNT(wo.id) >= 3
      ORDER BY ABS(AVG(wo.actual_duration - wo.estimated_duration)) DESC
    `);

    res.json(rows.rows || []);
  }));

  app.get("/api/feedback-loop/resource-accuracy", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const days = parseInt(req.query.days as string) || 90;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const rows = await db.execute(sql`
      SELECT
        r.id AS resource_id,
        r.name AS resource_name,
        COUNT(wo.id)::int AS sample_count,
        ROUND(AVG(wo.estimated_duration))::int AS avg_estimated,
        ROUND(AVG(wo.actual_duration))::int AS avg_actual,
        ROUND(AVG(wo.actual_duration - wo.estimated_duration))::int AS avg_delta_min,
        ROUND(AVG(CASE WHEN wo.estimated_duration > 0
          THEN ((wo.actual_duration - wo.estimated_duration)::numeric / wo.estimated_duration) * 100
          ELSE 0 END), 1) AS avg_deviation_pct
      FROM work_orders wo
      JOIN resources r ON r.id = wo.resource_id
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.completed_at IS NOT NULL
        AND wo.actual_duration IS NOT NULL
        AND wo.estimated_duration IS NOT NULL
        AND wo.estimated_duration > 0
        AND wo.completed_at >= ${startDate}
      GROUP BY r.id, r.name
      HAVING COUNT(wo.id) >= 3
      ORDER BY ABS(AVG(wo.actual_duration - wo.estimated_duration)) DESC
    `);

    res.json(rows.rows || []);
  }));

  app.get("/api/feedback-loop/carry-over", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const days = parseInt(req.query.days as string) || 90;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const rows = await db.execute(sql`
      SELECT
        COALESCE(wo.impossible_reason, 'okänd') AS reason,
        COUNT(*)::int AS count,
        ROUND(AVG(wo.estimated_duration))::int AS avg_planned_duration
      FROM work_orders wo
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.scheduled_date >= ${startDate}
        AND wo.scheduled_date <= NOW()
        AND (wo.order_status NOT IN ('utford', 'fakturerad'))
        AND wo.completed_at IS NULL
        AND (wo.impossible_reason IS NOT NULL OR wo.order_status = 'skapad')
      GROUP BY COALESCE(wo.impossible_reason, 'okänd')
      ORDER BY count DESC
    `);

    const totalIncomplete = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM work_orders wo
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.scheduled_date >= ${startDate}
        AND wo.scheduled_date <= NOW()
        AND (wo.order_status NOT IN ('utford', 'fakturerad'))
        AND wo.completed_at IS NULL
    `);

    const totalScheduled = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM work_orders wo
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.scheduled_date >= ${startDate}
        AND wo.scheduled_date <= NOW()
    `);

    res.json({
      reasons: rows.rows || [],
      totalIncomplete: (totalIncomplete.rows[0] as any)?.total || 0,
      totalScheduled: (totalScheduled.rows[0] as any)?.total || 0,
    });
  }));

  app.get("/api/feedback-loop/suggested-durations", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const rows = await db.execute(sql`
      SELECT
        a.id AS article_id,
        a.name AS article_name,
        a.article_number,
        a.production_time AS current_standard,
        COUNT(wo.id)::int AS sample_count,
        ROUND(AVG(wo.actual_duration))::int AS rolling_avg,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wo.actual_duration)::int AS median_actual,
        ROUND(
          (AVG(wo.actual_duration) * 0.6 + PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wo.actual_duration) * 0.4)
        )::int AS suggested_duration,
        ROUND(AVG(CASE WHEN wo.estimated_duration > 0
          THEN ((wo.actual_duration - wo.estimated_duration)::numeric / wo.estimated_duration) * 100
          ELSE 0 END), 1) AS current_deviation_pct
      FROM work_orders wo
      JOIN work_order_lines wol ON wol.work_order_id = wo.id
      JOIN articles a ON a.id = wol.article_id
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.completed_at IS NOT NULL
        AND wo.actual_duration IS NOT NULL
        AND wo.estimated_duration IS NOT NULL
        AND wo.completed_at >= NOW() - INTERVAL '30 days'
      GROUP BY a.id, a.name, a.article_number, a.production_time
      HAVING COUNT(wo.id) >= 5
        AND ABS(AVG(wo.actual_duration) - COALESCE(a.production_time, 0)) > 5
      ORDER BY ABS(AVG(wo.actual_duration) - COALESCE(a.production_time, 0)) DESC
    `);

    res.json(rows.rows || []);
  }));

  app.post("/api/feedback-loop/apply-duration/:articleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { articleId } = req.params;
    const { newDuration } = req.body;

    if (!newDuration || typeof newDuration !== "number" || newDuration < 1 || newDuration > 480) {
      return res.status(400).json({ error: "Ogiltig duration (1-480 min)" });
    }

    await db.execute(sql`
      UPDATE articles
      SET production_time = ${newDuration}
      WHERE id = ${articleId} AND tenant_id = ${tenantId}
    `);

    res.json({ success: true, articleId, newDuration });
  }));

  app.get("/api/feedback-loop/overview-kpis", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const days = parseInt(req.query.days as string) || 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const kpiRow = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_with_actual,
        ROUND(AVG(ABS(wo.actual_duration - wo.estimated_duration)))::int AS mae_minutes,
        ROUND(AVG(CASE WHEN wo.estimated_duration > 0
          THEN ((wo.actual_duration - wo.estimated_duration)::numeric / wo.estimated_duration) * 100
          ELSE 0 END), 1) AS mean_deviation_pct,
        ROUND(AVG(CASE WHEN wo.estimated_duration > 0
          THEN ABS((wo.actual_duration - wo.estimated_duration)::numeric / wo.estimated_duration) * 100
          ELSE 0 END), 1) AS mape,
        COUNT(CASE WHEN ABS(wo.actual_duration - wo.estimated_duration) <= wo.estimated_duration * 0.15 THEN 1 END)::int AS within_15pct,
        COUNT(CASE WHEN wo.actual_duration > wo.estimated_duration * 1.3 THEN 1 END)::int AS over_30pct,
        COUNT(CASE WHEN wo.actual_duration < wo.estimated_duration * 0.7 THEN 1 END)::int AS under_30pct
      FROM work_orders wo
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.completed_at IS NOT NULL
        AND wo.actual_duration IS NOT NULL
        AND wo.estimated_duration IS NOT NULL
        AND wo.estimated_duration > 0
        AND wo.completed_at >= ${startDate}
    `);

    const prevStartDate = new Date(startDate);
    prevStartDate.setDate(prevStartDate.getDate() - days);

    const prevRow = await db.execute(sql`
      SELECT
        ROUND(AVG(CASE WHEN wo.estimated_duration > 0
          THEN ABS((wo.actual_duration - wo.estimated_duration)::numeric / wo.estimated_duration) * 100
          ELSE 0 END), 1) AS prev_mape
      FROM work_orders wo
      WHERE wo.tenant_id = ${tenantId}
        AND wo.deleted_at IS NULL
        AND wo.completed_at IS NOT NULL
        AND wo.actual_duration IS NOT NULL
        AND wo.estimated_duration IS NOT NULL
        AND wo.estimated_duration > 0
        AND wo.completed_at >= ${prevStartDate}
        AND wo.completed_at < ${startDate}
    `);

    const kpi = (kpiRow.rows[0] || {}) as any;
    const prev = (prevRow.rows[0] || {}) as any;

    res.json({
      totalWithActual: kpi.total_with_actual || 0,
      maeMinutes: kpi.mae_minutes || 0,
      meanDeviationPct: parseFloat(kpi.mean_deviation_pct) || 0,
      mape: parseFloat(kpi.mape) || 0,
      within15pct: kpi.within_15pct || 0,
      over30pct: kpi.over_30pct || 0,
      under30pct: kpi.under_30pct || 0,
      accuracyRate: kpi.total_with_actual > 0
        ? Math.round((kpi.within_15pct / kpi.total_with_actual) * 100)
        : 0,
      prevMape: parseFloat(prev.prev_mape) || 0,
      mapeTrend: prev.prev_mape
        ? parseFloat(kpi.mape) - parseFloat(prev.prev_mape)
        : 0,
    });
  }));
}
