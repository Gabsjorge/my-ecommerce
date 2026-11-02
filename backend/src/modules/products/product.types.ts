export interface Product {
  id: number;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
}

export interface ProductListResponse {
  data: Product[];
  total: number;
}

export interface ProductRepositoryPort {
  findAll(): Promise<Product[]>;
  findById(id: number): Promise<Product | null>;
  // Locks the rows (FOR UPDATE) ordered by id; must run inside a transaction (RN-008).
  lockByIds(ids: readonly number[]): Promise<Product[]>;
  // Guarded by `stock >= quantity`; false when no row was updated.
  decrementStock(id: number, quantity: number): Promise<boolean>;
}
