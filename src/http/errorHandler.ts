import * as Sentry from "@sentry/node";
import { ErrorRequestHandler } from "express";
import { logger } from "../logger";
import { BotServiceError } from "../services/botClient";
import { ClientError } from "./errors";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ClientError) {
    res.status(error.status).json({
      error: error.message,
      ...error.details,
    });
    return;
  }

  if (error instanceof BotServiceError) {
    (req.log ?? logger).warn({ err: error }, "bot_service_unavailable");
    res.status(503).json({ error: "Bot service unavailable" });
    return;
  }

  Sentry.captureException(error);
  (req.log ?? logger).error({ err: error }, "unhandled_error");
  res.status(500).json({ error: "Internal server error" });
};
