import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../lib/app-error';

/** Catch-all for unmatched routes; the error handler renders the standard 404 envelope. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} does not exist.`));
}
