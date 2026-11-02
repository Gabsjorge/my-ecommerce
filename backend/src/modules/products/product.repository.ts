import { asc } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { products } from '../../db/schema';
import type { Product, ProductRepositoryPort } from './product.types';

// The only layer allowed to import db/schema.
export class ProductRepository implements ProductRepositoryPort {
  constructor(private readonly db: Database) {}

  async findAll(): Promise<Product[]> {
    const rows = await this.db.select().from(products).orderBy(asc(products.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      priceCents: row.priceCents,
      stock: row.stock,
    }));
  }
}
