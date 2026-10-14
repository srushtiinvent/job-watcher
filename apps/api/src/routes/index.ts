import { Router, type IRouter } from "express";
import alertsRouter from "./alerts";
import healthRouter from "./health";
import insightsRouter from "./insights";
import jobsRouter from "./jobs";
import watchlistRouter from "./watchlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use(alertsRouter);
router.use(insightsRouter);
router.use(jobsRouter);
router.use(watchlistRouter);

export default router;
