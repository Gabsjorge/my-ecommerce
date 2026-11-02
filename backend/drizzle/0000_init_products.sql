CREATE TABLE IF NOT EXISTS "products" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"price_cents" integer NOT NULL,
	"stock" integer NOT NULL,
	CONSTRAINT "products_price_cents_nonneg" CHECK ("products"."price_cents" >= 0),
	CONSTRAINT "products_stock_nonneg" CHECK ("products"."stock" >= 0)
);
