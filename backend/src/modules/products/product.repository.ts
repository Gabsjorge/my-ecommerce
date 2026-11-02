import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { products } from '../../db/schema';
import type { Product, ProductRepositoryPort } from './product.types';

type ProductRow = typeof products.$inferSelect;

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    stock: row.stock,
  };
}

// The only layer allowed to import db/schema.
export class ProductRepository implements ProductRepositoryPort {
  constructor(private readonly db: Executor) {}

  async findAll(): Promise<Product[]> {
    const rows = await this.db.select().from(products).orderBy(asc(products.id));
    return rows.map(toProduct);
  }

  async findById(id: number): Promise<Product | null> {
    const [row] = await this.db.select().from(products).where(eq(products.id, id));
    return row ? toProduct(row) : null;
  }

  async lockByIds(ids: readonly number[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(products)
      .where(inArray(products.id, [...ids]))
      .orderBy(asc(products.id))
      .for('update');
    return rows.map(toProduct);
  }

  async decrementStock(id: number, quantity: number): Promise<boolean> {
    const updated = await this.db
      .update(products)
      .set({ stock: sql`${products.stock} - ${quantity}` })
      .where(and(eq(products.id, id), gte(products.stock, quantity)))
      .returning({ id: products.id });
    return updated.length > 0;
  }
}
