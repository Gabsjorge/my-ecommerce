import type { ProductListResponse, ProductRepositoryPort } from './product.types';

export class ProductService {
  constructor(private readonly repository: ProductRepositoryPort) {}

  async list(): Promise<ProductListResponse> {
    const data = await this.repository.findAll();
    return { data, total: data.length };
  }
}
