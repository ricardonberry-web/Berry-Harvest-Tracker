import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workersRouter from "./workers";
import weighRecordsRouter from "./weighRecords";
import reportsRouter from "./reports";
import attendanceRouter from "./attendance";
import timesheetRouter from "./timesheet";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workersRouter);
router.use(weighRecordsRouter);
router.use(reportsRouter);
router.use(attendanceRouter);
router.use(timesheetRouter);

export default router;
