import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

export function getUserId(req: Parameters<typeof getAuth>[0]): string {
  const userId = getAuth(req)?.userId;
  if (!userId) {
    throw new Error("Expected an authenticated request");
  }
  return userId;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req)?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};
