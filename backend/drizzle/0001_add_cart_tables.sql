CREATE TABLE "cart_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cart_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cart_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	CONSTRAINT "cart_items_cart_id_product_id_unique" UNIQUE("cart_id","product_id"),
	CONSTRAINT "cart_items_quantity_min" CHECK ("cart_items"."quantity" >= 1),
	CONSTRAINT "cart_items_unit_price_cents_nonneg" CHECK ("cart_items"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "carts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" varchar(20) DEFAULT 'empty' NOT NULL,
	"coupon_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	CONSTRAINT "carts_status_valid" CHECK ("carts"."status" IN ('empty', 'with_items', 'in_checkout', 'order_created', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coupons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(30) NOT NULL,
	"type" varchar(10) NOT NULL,
	"value" integer NOT NULL,
	"min_order_cents" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_type_valid" CHECK ("coupons"."type" IN ('percentage', 'fixed')),
	CONSTRAINT "coupons_value_range" CHECK (("coupons"."type" = 'percentage' AND "coupons"."value" BETWEEN 1 AND 100) OR ("coupons"."type" = 'fixed' AND "coupons"."value" > 0)),
	CONSTRAINT "coupons_min_order_cents_nonneg" CHECK ("coupons"."min_order_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	CONSTRAINT "order_items_quantity_min" CHECK ("order_items"."quantity" >= 1),
	CONSTRAINT "order_items_unit_price_cents_nonneg" CHECK ("order_items"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cart_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'created' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"coupon_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_cart_id_unique" UNIQUE("cart_id"),
	CONSTRAINT "orders_coupon_id_unique" UNIQUE("coupon_id"),
	CONSTRAINT "orders_status_valid" CHECK ("orders"."status" = 'created'),
	CONSTRAINT "orders_subtotal_cents_nonneg" CHECK ("orders"."subtotal_cents" >= 0),
	CONSTRAINT "orders_discount_cents_nonneg" CHECK ("orders"."discount_cents" >= 0),
	CONSTRAINT "orders_total_cents_nonneg" CHECK ("orders"."total_cents" >= 0),
	CONSTRAINT "orders_total_consistent" CHECK ("orders"."total_cents" = "orders"."subtotal_cents" - "orders"."discount_cents")
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_status_idx" ON "carts" USING btree ("status");