import type { Request, Response } from 'express';
import { describeError } from '../../shared/error-handler.middleware';

export class HealthController {
  constructor(private readonly checkDb: () => Promise<void>) {}

  check = async (_req: Request, res: Response): Promise<void> => {
    try {
      await this.checkDb();
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('Health check failed:', describeError(error));
      res.status(503).json({ status: 'unavailable' });
    }
  };
}
