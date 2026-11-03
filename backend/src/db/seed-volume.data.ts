import { Faker, base, en, pt_BR } from '@faker-js/faker';
import type { NewCoupon, NewProduct } from './schema';

// Pure generation of the high-volume dataset (no database access), so the invariants can be unit tested.
// Entities reference each other by array index; the persistence layer (seed-volume.ts) maps indexes to ids.

export const VOLUME_COUPON_PREFIX = 'VOL-';
// Matches the development default (CART_INACTIVITY_TIMEOUT_SECONDS = 600).
export const CART_TIMEOUT_MS = 600_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 180;
const MAX_PRICE_CENTS = 999_999;
const FAR_FUTURE = new Date('2099-12-31T23:59:59Z');

export interface VolumeCartItem {
  productIndex: number;
  quantity: number;
  unitPriceCents: number;
}

export interface VolumeOrder {
  createdAt: Date;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export interface VolumeCart {
  status: 'empty' | 'with_items' | 'in_checkout' | 'order_created' | 'abandoned';
  couponIndex: number | null;
  createdAt: Date;
  lastActivityAt: Date;
  items: VolumeCartItem[];
  // Present only for 'order_created' carts; the order shares the cart's items.
  order: VolumeOrder | null;
}

export interface VolumeDataset {
  products: NewProduct[];
  coupons: NewCoupon[];
  carts: VolumeCart[];
}

export interface VolumeOptions {
  now: Date;
  seed?: number;
  productCount?: number;
  couponCount?: number;
  cartCount?: number;
}

interface Category {
  types: string[];
  features: string[];
  minCents: number;
  maxCents: number;
}

const CATEGORIES: Category[] = [
  {
    types: [
      'Smartphone',
      'Notebook',
      'Tablet',
      'Smart TV 50"',
      'Fone Bluetooth',
      'Caixa de Som',
      'Carregador Turbo',
      'Smartwatch',
    ],
    features: [
      'Bateria de longa duração.',
      'Garantia de 12 meses.',
      'Conexão sem fio estável.',
      'Compatível com Android e iOS.',
      'Design compacto e leve.',
    ],
    minCents: 4_990,
    maxCents: 799_900,
  },
  {
    types: [
      'Camiseta',
      'Calça Jeans',
      'Jaqueta',
      'Vestido',
      'Bermuda',
      'Moletom',
      'Camisa Social',
      'Meia Esportiva',
    ],
    features: [
      'Tecido macio e respirável.',
      'Disponível em vários tamanhos.',
      'Lavagem fácil, não desbota.',
      'Modelagem confortável.',
      'Acabamento reforçado.',
    ],
    minCents: 1_990,
    maxCents: 49_990,
  },
  {
    types: ['Tênis', 'Sandália', 'Bota', 'Sapatênis', 'Chinelo', 'Sapato Social'],
    features: [
      'Solado antiderrapante.',
      'Palmilha anatômica.',
      'Material resistente e leve.',
      'Ótimo para o uso diário.',
    ],
    minCents: 2_990,
    maxCents: 69_990,
  },
  {
    types: [
      'Sofá',
      'Mesa de Jantar',
      'Estante',
      'Cadeira de Escritório',
      'Luminária',
      'Tapete',
      'Jogo de Cama',
      'Cortina',
    ],
    features: [
      'Montagem simples, acompanha manual.',
      'Estrutura reforçada.',
      'Acabamento premium.',
      'Ideal para ambientes pequenos.',
    ],
    minCents: 3_990,
    maxCents: 299_900,
  },
  {
    types: [
      'Liquidificador',
      'Air Fryer',
      'Cafeteira',
      'Panela de Pressão',
      'Jogo de Facas',
      'Batedeira',
      'Frigideira Antiaderente',
    ],
    features: [
      'Fácil de limpar.',
      'Baixo consumo de energia.',
      'Potência para o dia a dia.',
      'Acompanha receitas de bolso.',
    ],
    minCents: 2_490,
    maxCents: 89_990,
  },
  {
    types: [
      'Romance',
      'Livro de Ficção Científica',
      'Biografia',
      'Guia de Culinária',
      'Livro Infantil',
      'Manual de Programação',
      'HQ',
    ],
    features: [
      'Edição revisada.',
      'Capa brochura.',
      'Papel pólen de alta qualidade.',
      'Best-seller entre os leitores.',
    ],
    minCents: 1_990,
    maxCents: 18_990,
  },
  {
    types: [
      'Bola de Futebol',
      'Halteres',
      'Tapete de Yoga',
      'Bicicleta Aro 29',
      'Corda de Pular',
      'Luva de Treino',
      'Barraca de Camping',
    ],
    features: [
      'Alta durabilidade.',
      'Aprovado por atletas amadores.',
      'Fácil de transportar.',
      'Indicado para treinos diários.',
    ],
    minCents: 1_490,
    maxCents: 149_990,
  },
  {
    types: [
      'Shampoo',
      'Perfume',
      'Hidratante Corporal',
      'Protetor Solar FPS 50',
      'Kit de Maquiagem',
      'Secador de Cabelo',
    ],
    features: [
      'Dermatologicamente testado.',
      'Fragrância suave.',
      'Não testado em animais.',
      'Resultado visível em poucos dias.',
    ],
    minCents: 990,
    maxCents: 39_990,
  },
  {
    types: [
      'Quebra-Cabeça 1000 peças',
      'Boneca Articulada',
      'Carrinho de Controle Remoto',
      'Jogo de Tabuleiro',
      'Bloco de Montar',
      'Pelúcia',
    ],
    features: [
      'Indicado a partir de 6 anos.',
      'Material atóxico.',
      'Estimula a criatividade.',
      'Diversão para toda a família.',
    ],
    minCents: 1_990,
    maxCents: 59_990,
  },
  {
    types: [
      'Caderno',
      'Mochila Escolar',
      'Estojo',
      'Agenda',
      'Kit de Canetas',
      'Calculadora Científica',
      'Pasta Arquivo',
    ],
    features: [
      'Ideal para estudantes.',
      'Papel de alta gramatura.',
      'Cores variadas.',
      'Resistente ao uso diário.',
    ],
    minCents: 490,
    maxCents: 24_990,
  },
  {
    types: [
      'Ração Premium',
      'Coleira Ajustável',
      'Cama para Pet',
      'Brinquedo Mordedor',
      'Arranhador',
      'Comedouro Automático',
    ],
    features: [
      'Aprovado por veterinários.',
      'Fácil de higienizar.',
      'Para cães e gatos de todos os portes.',
      'Material seguro e atóxico.',
    ],
    minCents: 990,
    maxCents: 29_990,
  },
  {
    types: [
      'Furadeira',
      'Jogo de Chaves',
      'Escada Dobrável',
      'Trena Digital',
      'Caixa de Ferramentas',
      'Parafusadeira a Bateria',
    ],
    features: [
      'Uso doméstico e profissional.',
      'Acompanha maleta.',
      'Garantia de fábrica.',
      'Aço de alta resistência.',
    ],
    minCents: 1_990,
    maxCents: 99_990,
  },
];

const VARIANTS = [
  'Preto',
  'Branco',
  'Azul',
  'Vermelho',
  'Verde',
  'Cinza',
  'Pequeno',
  'Médio',
  'Grande',
  'Pro',
  'Plus',
  'Lite',
  'Edição 2026',
];

const COUPON_MIN_ORDERS = [5_000, 10_000, 20_000, 30_000, 50_000, 100_000];
const PERCENTAGES = [5, 10, 15, 20, 25, 30, 40, 50];

type CouponKind = 'used' | 'expired' | 'active';

interface CouponSpec {
  kind: CouponKind;
  type: 'percentage' | 'fixed';
  value: number;
  minOrderCents: number;
  // Only for 'active': expiry far in the future instead of the regular horizon.
  farFuture?: boolean;
}

const pad = (n: number, width = 4) => String(n + 1).padStart(width, '0');

export function generateVolumeDataset(options: VolumeOptions): VolumeDataset {
  const {
    now,
    seed = 20260101,
    productCount = 1000,
    couponCount = 1200,
    cartCount = 3000,
  } = options;
  const faker = new Faker({ locale: [pt_BR, en, base] });
  faker.seed(seed);
  faker.setDefaultRefDate(now);

  const int = (min: number, max: number) => faker.number.int({ min, max });
  const chance = (p: number) => faker.number.float({ min: 0, max: 1 }) < p;
  const msAgo = (minMs: number, maxMs: number) => new Date(now.getTime() - int(minMs, maxMs));

  // ---- Products -----------------------------------------------------------------------------
  const products: NewProduct[] = [];
  for (let i = 0; i < productCount; i++) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const type = faker.helpers.arrayElement(category.types);
    const brand = faker.company.name().split(/[-,]/)[0].trim().slice(0, 30);
    const suffix = ` #${pad(i)}`;
    let name = `${type} ${brand} ${faker.helpers.arrayElement(VARIANTS)}`;

    let priceCents = int(category.minCents, category.maxCents);
    if (chance(0.6)) priceCents = Math.max(100, Math.round(priceCents / 100) * 100 - 10); // charm pricing (x,90)
    priceCents = Math.min(priceCents, MAX_PRICE_CENTS);

    const roll = faker.number.float({ min: 0, max: 1 });
    let stock: number;
    if (roll < 0.05) stock = 0;
    else if (roll < 0.1) stock = int(1, 3);
    else if (roll < 0.2) stock = int(5_000, 20_000);
    else stock = int(10, 500);

    const feature = faker.helpers.arrayElements(
      category.features,
      chance(0.1) ? category.features.length : 1,
    );
    const intro = `${type} da marca ${brand}.`;
    const long = feature.length > 1;
    const extra = long
      ? ' Produto selecionado pela nossa curadoria, com acabamento cuidadoso, ótimo custo-benefício e avaliações positivas de clientes. Acompanha embalagem original e nota fiscal.'
      : '';
    const description = `${intro} ${feature.join(' ')}${extra}`;

    // Boundary values, always present regardless of the seed.
    if (i === 0) ({ priceCents, stock } = { priceCents: 0, stock: 50 }); // free item
    if (i === 1) ({ priceCents, stock } = { priceCents: 1, stock: 100 }); // minimum paid price (R$ 0,01)
    if (i === 2) ({ priceCents, stock } = { priceCents: MAX_PRICE_CENTS, stock: 5 }); // R$ 9.999,99
    if (i === 3) {
      // Name filling the whole varchar(120) column.
      name = `${name} ${'Edição Especial de Colecionador '.repeat(6)}`;
      name = name.slice(0, 120 - suffix.length).replace(/\s+$/, '-');
    }
    if (i === 4) stock = 0;
    if (i === 5) stock = 1;
    if (i === 6) stock = 3;

    products.push({ name: `${name}${suffix}`, description, priceCents, stock });
  }

  // ---- Coupon specs -------------------------------------------------------------------------
  const usedTarget = Math.round(couponCount * 0.3);
  const expiredTarget = Math.round(couponCount * 0.15);
  const specs: CouponSpec[] = [];
  const edgeSpecs: CouponSpec[] = [
    { kind: 'used', type: 'percentage', value: 100, minOrderCents: 0 }, // zeroes the total
    { kind: 'used', type: 'fixed', value: 500_000, minOrderCents: 0 }, // fixed above most subtotals
    { kind: 'active', type: 'percentage', value: 1, minOrderCents: 0 },
    { kind: 'active', type: 'fixed', value: 1, minOrderCents: 0 },
    { kind: 'expired', type: 'percentage', value: 10, minOrderCents: 0 },
    { kind: 'active', type: 'percentage', value: 15, minOrderCents: 0, farFuture: true },
    { kind: 'used', type: 'percentage', value: 20, minOrderCents: 100_000 },
  ];
  specs.push(...edgeSpecs);
  const edgeCount = (kind: CouponKind) => edgeSpecs.filter((s) => s.kind === kind).length;
  const remaining: Record<CouponKind, number> = {
    used: usedTarget - edgeCount('used'),
    expired: expiredTarget - edgeCount('expired'),
    active: couponCount - usedTarget - expiredTarget - edgeCount('active'),
  };
  for (const kind of ['used', 'expired', 'active'] as const) {
    for (let k = 0; k < remaining[kind]; k++) {
      const isPercentage = chance(0.6);
      specs.push({
        kind,
        type: isPercentage ? 'percentage' : 'fixed',
        value: isPercentage ? faker.helpers.arrayElement(PERCENTAGES) : int(1, 100) * 500,
        minOrderCents: chance(0.6) ? 0 : faker.helpers.arrayElement(COUPON_MIN_ORDERS),
      });
    }
  }
  const shuffledSpecs = faker.helpers.shuffle(specs.slice(edgeSpecs.length));
  const orderedSpecs = [...edgeSpecs, ...shuffledSpecs];

  // ---- Carts: order_created first (they consume stock), then the other states --------------------
  const emptyCount = Math.round(cartCount * 0.08);
  const withItemsCount = Math.round(cartCount * 0.2);
  const checkoutCount = Math.round(cartCount * 0.1);
  const abandonedCount = Math.round(cartCount * 0.22);
  const orderCount = cartCount - emptyCount - withItemsCount - checkoutCount - abandonedCount;

  // Products with stock <= 3 are never sold, so their boundary stock survives the simulated sales.
  const stockLeft = products.map((p) => p.stock);
  const sellable = products.map((_, i) => i).filter((i) => products[i].stock > 3);
  const productIdx = () => faker.helpers.arrayElement(sellable);
  const itemCount = () =>
    faker.helpers.weightedArrayElement([
      { weight: 30, value: 1 },
      { weight: 30, value: 2 },
      { weight: 20, value: 3 },
      { weight: 10, value: 4 },
      { weight: 6, value: 6 },
      { weight: 4, value: 8 },
    ]);
  const quantity = () =>
    faker.helpers.weightedArrayElement([
      { weight: 50, value: 1 },
      { weight: 25, value: 2 },
      { weight: 15, value: int(3, 5) },
      { weight: 10, value: int(6, 10) },
    ]);

  const buildItems = (consumeStock: boolean): VolumeCartItem[] => {
    const items: VolumeCartItem[] = [];
    const used = new Set<number>();
    const wanted = itemCount();
    for (let attempt = 0; items.length < wanted && attempt < wanted * 8; attempt++) {
      // Open carts may hold any in-stock product (including the boundary ones); orders only sellable ones.
      const index = consumeStock ? productIdx() : int(0, products.length - 1);
      if (used.has(index) || stockLeft[index] < 1) continue;
      used.add(index);
      const qty = Math.min(quantity(), stockLeft[index]);
      if (consumeStock) stockLeft[index] -= qty;
      const current = products[index].priceCents;
      // Frozen price (RN-004): in ~10% of the lines the product price changed after the item was added.
      const unitPriceCents =
        !consumeStock && chance(0.1)
          ? Math.max(0, Math.round(current * (0.8 + faker.number.float({ min: 0, max: 0.4 }))))
          : current;
      items.push({ productIndex: index, quantity: qty, unitPriceCents });
    }
    return items;
  };
  const subtotalOf = (items: VolumeCartItem[]) =>
    items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);

  const carts: VolumeCart[] = [];

  for (let k = 0; k < orderCount; k++) {
    const createdAt = msAgo(2 * DAY, HISTORY_DAYS * DAY);
    const lastActivityAt = new Date(createdAt.getTime() + int(MINUTE, 2 * DAY));
    const items = buildItems(true);
    const subtotalCents = subtotalOf(items);
    carts.push({
      status: 'order_created',
      couponIndex: null,
      createdAt,
      lastActivityAt,
      items,
      order: {
        createdAt: lastActivityAt,
        subtotalCents,
        discountCents: 0,
        totalCents: subtotalCents,
      },
    });
  }

  // Single-use coupons (orders_coupon_id_unique): each used coupon is bound to one order that satisfies its minimum.
  const coupons: NewCoupon[] = [];
  const orderCarts = faker.helpers.shuffle(carts.map((_, i) => i));
  const taken = new Set<number>();
  const activeIdx: number[] = [];
  const expiredIdx: number[] = [];

  orderedSpecs.forEach((spec, index) => {
    const code = `${VOLUME_COUPON_PREFIX}${spec.type === 'percentage' ? 'P' : 'F'}${spec.value}-${pad(index)}`;
    let kind = spec.kind;
    let usedAt: Date | null = null;
    let expiresAt = FAR_FUTURE;

    if (kind === 'used') {
      const cartIndex = orderCarts.find(
        (c) => !taken.has(c) && carts[c].order!.subtotalCents >= spec.minOrderCents,
      );
      if (cartIndex === undefined) {
        kind = 'active'; // no order can honor this minimum: fall back to an unused coupon
      } else {
        taken.add(cartIndex);
        const cart = carts[cartIndex];
        const order = cart.order!;
        usedAt = order.createdAt;
        expiresAt = new Date(usedAt.getTime() + int(HOUR, 120 * DAY));
        order.discountCents =
          spec.type === 'percentage'
            ? Math.floor((order.subtotalCents * spec.value) / 100)
            : Math.min(spec.value, order.subtotalCents);
        order.totalCents = order.subtotalCents - order.discountCents;
        cart.couponIndex = index;
      }
    }
    if (kind === 'expired') {
      expiresAt = msAgo(DAY, 400 * DAY);
      expiredIdx.push(index);
    } else if (kind === 'active') {
      expiresAt =
        spec.farFuture || chance(0.1) ? FAR_FUTURE : new Date(now.getTime() + int(HOUR, 730 * DAY));
      activeIdx.push(index);
    }

    coupons.push({
      code,
      type: spec.type,
      value: spec.value,
      minOrderCents: spec.minOrderCents,
      expiresAt,
      usedAt,
    });
  });

  const withCoupon = (pool: number[]) =>
    pool.length > 0 && chance(0.35) ? faker.helpers.arrayElement(pool) : null;

  for (let k = 0; k < emptyCount; k++) {
    const createdAt = msAgo(0, HISTORY_DAYS * DAY);
    carts.push({
      status: 'empty',
      couponIndex: null,
      createdAt,
      lastActivityAt: createdAt,
      items: [],
      order: null,
    });
  }
  // Open carts stay inside the inactivity window; they become 'abandoned' lazily once the timeout elapses (RN-020).
  for (const [status, total] of [
    ['with_items', withItemsCount],
    ['in_checkout', checkoutCount],
  ] as const) {
    for (let k = 0; k < total; k++) {
      const createdAt = msAgo(MINUTE, CART_TIMEOUT_MS - MINUTE);
      const lastActivityAt = new Date(
        createdAt.getTime() + int(0, now.getTime() - createdAt.getTime()),
      );
      carts.push({
        status,
        couponIndex: withCoupon(activeIdx),
        createdAt,
        lastActivityAt,
        items: buildItems(false),
        order: null,
      });
    }
  }
  for (let k = 0; k < abandonedCount; k++) {
    const createdAt = msAgo(CART_TIMEOUT_MS + 2 * MINUTE, HISTORY_DAYS * DAY);
    const idle = int(
      0,
      Math.min(3 * DAY, now.getTime() - CART_TIMEOUT_MS - 1 - createdAt.getTime()),
    );
    carts.push({
      status: 'abandoned',
      couponIndex: withCoupon([...activeIdx, ...expiredIdx]),
      createdAt,
      lastActivityAt: new Date(createdAt.getTime() + idle),
      items: buildItems(false),
      order: null,
    });
  }

  // Final stock = initial stock minus the units sold in orders.
  products.forEach((p, i) => {
    p.stock = stockLeft[i];
  });

  return { products, coupons, carts: faker.helpers.shuffle(carts) };
}
