import { count } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { createDb, createPool, type Database } from './client';
import { products, type NewProduct } from './schema';

// Fixed dataset shared by dev and test (E2E asserts rely on it). Product 6 is out of stock.
export const seedProducts: NewProduct[] = [
  {
    name: 'Camiseta Básica Algodão',
    description: 'Camiseta de algodão macio, corte reto, ideal para o dia a dia.',
    priceCents: 4990,
    stock: 25,
  },
  {
    name: 'Tênis Esportivo Runner',
    description: 'Tênis leve e confortável para corrida e caminhada.',
    priceCents: 29990,
    stock: 10,
  },
  {
    name: 'Mochila Urbana 20L',
    description: 'Mochila resistente à água com compartimento para notebook.',
    priceCents: 15990,
    stock: 8,
  },
  {
    name: 'Fone de Ouvido Bluetooth',
    description: 'Fone sem fio com cancelamento de ruído e bateria de 20 horas.',
    priceCents: 19990,
    stock: 15,
  },
  {
    name: 'Garrafa Térmica 500ml',
    description: 'Garrafa em aço inox que mantém a temperatura por até 12 horas.',
    priceCents: 7990,
    stock: 40,
  },
  {
    name: 'Caderno Universitário 200 folhas',
    description: 'Caderno espiral com capa dura e 10 matérias.',
    priceCents: 3490,
    stock: 0,
  },
];

// Idempotent: only inserts when the products table is empty.
export async function runSeed(db: Database): Promise<{ inserted: number }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ value: count() }).from(products);
    if (row.value > 0) {
      console.log('Seed skipped: products table is not empty');
      return { inserted: 0 };
    }
    await tx.insert(products).values(seedProducts);
    return { inserted: seedProducts.length };
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  try {
    const result = await runSeed(createDb(pool));
    console.log(`Seed finished: ${result.inserted} product(s) inserted`);
  } finally {
    await pool.end();
  }
}

// CLI guard: importing runSeed in tests must not execute the seed.
if (require.main === module) {
  main().catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  });
}
