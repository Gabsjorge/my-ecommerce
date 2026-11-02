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
}
