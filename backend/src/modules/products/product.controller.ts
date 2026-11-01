import type { Request, Response } from 'express';
import type { ProductService } from './product.service';

export class ProductController {
  constructor(private readonly service: ProductService) {}

  // Express 5 forwards rejected promises to the error handler.
  list = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.list());
  };
}
