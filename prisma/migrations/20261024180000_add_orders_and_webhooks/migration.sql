-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "currencyCode" TEXT NOT NULL,
    "subtotal" DECIMAL(19,4),
    "total" DECIMAL(19,4),
    "tax" DECIMAL(19,4),
    "shipping" DECIMAL(19,4),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(19,4),
    "lineTotal" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventId" TEXT,
    "topic" TEXT NOT NULL,
    "shopDomain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopifyId_key" ON "Order"("shopifyId");
CREATE INDEX "Order_orderedAt_idx" ON "Order"("orderedAt");
CREATE INDEX "Order_financialStatus_idx" ON "Order"("financialStatus");
CREATE INDEX "Order_fulfillmentStatus_idx" ON "Order"("fulfillmentStatus");
CREATE INDEX "Order_customerName_idx" ON "Order"("customerName");

CREATE UNIQUE INDEX "OrderItem_shopifyId_key" ON "OrderItem"("shopifyId");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_shopifyProductId_idx" ON "OrderItem"("shopifyProductId");
CREATE INDEX "OrderItem_shopifyVariantId_idx" ON "OrderItem"("shopifyVariantId");

CREATE UNIQUE INDEX "WebhookEvent_deliveryId_key" ON "WebhookEvent"("deliveryId");
CREATE INDEX "WebhookEvent_eventId_idx" ON "WebhookEvent"("eventId");
CREATE INDEX "WebhookEvent_topic_receivedAt_idx" ON "WebhookEvent"("topic", "receivedAt");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
