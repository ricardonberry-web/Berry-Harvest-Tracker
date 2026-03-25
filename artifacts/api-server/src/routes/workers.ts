import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, workersTable } from "@workspace/db";
import {
  CreateWorkerBody,
  UpdateWorkerBody,
  UpdateWorkerParams,
  DeleteWorkerParams,
  GetWorkerParams,
  GetWorkerResponse,
  UpdateWorkerResponse,
  ListWorkersResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/workers", async (_req, res): Promise<void> => {
  const workers = await db
    .select()
    .from(workersTable)
    .orderBy(workersTable.createdAt);
  res.json(ListWorkersResponse.parse(workers));
});

router.post("/workers", async (req, res): Promise<void> => {
  const parsed = CreateWorkerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.id, parsed.data.id));

  if (existing.length > 0) {
    res.status(409).json({ error: "Worker ID already exists" });
    return;
  }

  const [worker] = await db
    .insert(workersTable)
    .values(parsed.data)
    .returning();
  res.status(201).json(GetWorkerResponse.parse(worker));
});

router.get("/workers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetWorkerParams.safeParse({ id: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [worker] = await db
    .select()
    .from(workersTable)
    .where(eq(workersTable.id, params.data.id));

  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  res.json(GetWorkerResponse.parse(worker));
});

router.patch("/workers/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateWorkerParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateWorkerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [worker] = await db
    .update(workersTable)
    .set(parsed.data)
    .where(eq(workersTable.id, params.data.id))
    .returning();

  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  res.json(UpdateWorkerResponse.parse(worker));
});

router.delete("/workers/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteWorkerParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [worker] = await db
    .delete(workersTable)
    .where(eq(workersTable.id, params.data.id))
    .returning();

  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
