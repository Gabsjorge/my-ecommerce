import { inArray } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { createDb, createPool, type Database } from './client';
import { coupons, products, type NewCoupon, type NewProduct } from './schema';

// Fixed dataset shared by dev and test (E2E asserts rely on it). The 'Caderno Universitário' product is out of stock.
// The products after the first 6 are dedicated to cart tests (the last 7 to the flow specs): tests find them by name, never by id.
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
  {
    name: 'Caneta Esferográfica Azul (Estoque Alto)',
    description:
      'Caneta esferográfica azul com bastante estoque para testes que consomem unidades.',
    priceCents: 1000,
    stock: 1000,
  },
  {
    name: 'Edição Limitada Caderno Artesanal (Último Item)',
    description: 'Caderno artesanal em edição limitada, resta apenas uma unidade.',
    priceCents: 2500,
    stock: 1,
  },
  {
    name: 'Mochila Escolar Compacta (Estoque Limitado)',
    description: 'Mochila escolar compacta com poucas unidades disponíveis.',
    priceCents: 1500,
    stock: 3,
  },
  {
    name: 'Agenda Anual Última Unidade (UI)',
    description: 'Agenda anual com uma única unidade em estoque.',
    priceCents: 2500,
    stock: 1,
  },
  {
    name: 'Kit Fluxo Alfa (E2E Endpoint)',
    description: 'Produto dedicado aos fluxos E2E de endpoint, com estoque medido de forma exata.',
    priceCents: 5000,
    stock: 200,
  },
  {
    name: 'Kit Fluxo Beta (E2E Endpoint)',
    description: 'Segundo produto dedicado aos fluxos E2E de endpoint.',
    priceCents: 15000,
    stock: 200,
  },
  {
    name: 'Kit Fluxo Alfa (E2E UI)',
    description: 'Produto dedicado aos fluxos E2E de interface, com estoque medido de forma exata.',
    priceCents: 4000,
    stock: 200,
  },
  {
    name: 'Kit Fluxo Beta (E2E UI)',
    description: 'Segundo produto dedicado aos fluxos E2E de interface.',
    priceCents: 6000,
    stock: 200,
  },
  {
    name: 'Fluxo Último Item 1 (Estoque 1)',
    description: 'Única unidade em estoque, consumida por um fluxo E2E de endpoint.',
    priceCents: 2000,
    stock: 1,
  },
  {
    name: 'Fluxo Último Item 2 (Estoque 1)',
    description: 'Única unidade em estoque, consumida por um fluxo E2E de endpoint.',
    priceCents: 2000,
    stock: 1,
  },
  {
    name: 'Fluxo Último Item 3 (UI, Estoque 1)',
    description: 'Única unidade em estoque, consumida por um fluxo E2E de interface.',
    priceCents: 2000,
    stock: 1,
  },
];

const FAR_FUTURE = new Date('2099-12-31T23:59:59Z');

// Codes are stored normalized (upper case). 'consumable' coupons are used up by a single test.
// FLUXO-* / UI-FLUXO-* are dedicated to the end-to-end flow specs (one confirmation each at most).
export const seedCoupons: NewCoupon[] = [
  { code: 'DESC10', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'FIXO20', type: 'fixed', value: 2000, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'MEGA100', type: 'percentage', value: 100, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'FIXO5000', type: 'fixed', value: 500000, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'MIN200', type: 'percentage', value: 15, minOrderCents: 20000, expiresAt: FAR_FUTURE },
  {
    code: 'EXPIRADO10',
    type: 'percentage',
    value: 10,
    minOrderCents: 0,
    expiresAt: new Date('2020-01-01T00:00:00Z'),
  },
  {
    code: 'USADO10',
    type: 'percentage',
    value: 10,
    minOrderCents: 0,
    expiresAt: FAR_FUTURE,
    usedAt: new Date('2025-01-01T00:00:00Z'),
  },
  { code: 'CONFIRMA10', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'ZERA-FIXO', type: 'fixed', value: 500000, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'DISPUTA10', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'UI-CONFIRMA10', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'UI-ZERA-FIXO', type: 'fixed', value: 500000, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'UI-DISPUTA10', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'FLUXO-PCT', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'FLUXO-F5', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'FLUXO-F6', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'FLUXO-F9', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'UI-FLUXO-U1', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'UI-FLUXO-U3', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'UI-FLUXO-U4', type: 'percentage', value: 10, minOrderCents: 0, expiresAt: FAR_FUTURE },
  { code: 'FLUXO-FIXO', type: 'fixed', value: 2000, minOrderCents: 0, expiresAt: FAR_FUTURE },
];

export interface SeedResult {
  insertedProducts: number;
  insertedCoupons: number;
}

// Idempotent per row: products are matched by name, coupons by code. Rows already present
// (including used coupons) are left untouched, so a populated database only receives what is missing.
export async function runSeed(db: Database): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ name: products.name })
      .from(products)
      .where(
        inArray(
          products.name,
          seedProducts.map((p) => p.name),
        ),
      );
    const existingNames = new Set(existing.map((row) => row.name));
    const missing = seedProducts.filter((p) => !existingNames.has(p.name));
    if (missing.length > 0) {
      await tx.insert(products).values(missing);
    }

    const insertedCouponRows = await tx
      .insert(coupons)
      .values(seedCoupons)
      .onConflictDoNothing({ target: coupons.code })
      .returning({ id: coupons.id });

    return { insertedProducts: missing.length, insertedCoupons: insertedCouponRows.length };
  });
}

export function isSeedAllowed(nodeEnv: string): boolean {
  return nodeEnv !== 'production';
}

async function main(): Promise<void> {
  const env = loadEnv();
  // The demo data includes 100%-off coupons valid until 2099: never load it in production.
  // Exits successfully so `migrate && seed` in the base Compose file still completes.
  if (!isSeedAllowed(env.NODE_ENV)) {
    console.log(`Seed skipped: demo data is not loaded with NODE_ENV=${env.NODE_ENV}`);
    return;
  }
  const pool = createPool(env.DATABASE_URL);
  try {
    const result = await runSeed(createDb(pool));
    console.log(
      `Seed finished: ${result.insertedProducts} product(s) and ${result.insertedCoupons} coupon(s) inserted`,
    );
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
