import type { SquareClient } from "square";
import { storage } from "../storage";
import type { InsertSquareInvoice, Lead } from "@shared/schema";
import type { InvoicePurpose } from "@shared/regionalAutomation";
import { getSquareAccessToken, getSquareEnvironment, getSquareLocationId } from "./squareConfig";
import { squareInvoiceRequestKeys, persistSquareInvoiceOnce } from './squareInvoiceRetry';
import { recordSquareInvoicePublication } from './squareInvoicePublication';
import { assertCanonicalFinalInvoicePublication } from './canonicalInvoicePublication';
import { cancelSquareInvoiceWithRecovery, recordSquareInvoiceCancellation } from './squareInvoiceCancellation';
import { reserveSquareInvoiceIntent, recoverSquareInvoicePhase } from './squareInvoiceIntent';

export type InvoiceDeliveryMethod = "email" | "sms" | "both" | "none";

/**
 * Subset of `Lead` that `createItemizedInvoiceForLead` actually reads.
 * Lawn-care quotes don't have a leads-table row, so they pass a typed
 * shim that satisfies this shape — no `as unknown as Lead` casts.
 */
export interface InvoiceRecipient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  totalPrice?: string | number | null;
  bundleDiscountAmount?: string | number | null;
  serviceType?: string | null;
}

export interface LeadInvoiceOptions {
  idempotencyKey?: string;
  purpose?: InvoicePurpose;
  quoteRevisionId?: string | null;
  closeoutId?: string | null;
}

export interface ItemizedInvoiceDiscount {
  code: string;
  name: string;
  amount: number;
}

export interface ItemizedInvoiceOptions extends LeadInvoiceOptions {
  discounts?: ItemizedInvoiceDiscount[];
  expectedTotal?: number;
  catalogRevision?: number | null;
  pricingRevision?: string | null;
  idempotencyKey?: string;
  description?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safeLeadId(id: string | undefined | null): string | null {
  if (!id || typeof id !== "string") return null;
  return UUID_RE.test(id) ? id : null;
}

async function getSquareClient(): Promise<SquareClient> {
  const { SquareClient, SquareEnvironment } = await import("square");
  return new SquareClient({
    token: getSquareAccessToken(),
    environment: getSquareEnvironment() === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
  });
}

function primarySquareDeliveryMethod(method: InvoiceDeliveryMethod): any {
  // Square supports API email delivery or a manually shared payment link.
  // Consent-aware SMS delivery is sent by the application after publication.
  return method === "email" ? "EMAIL" : "SHARE_MANUALLY";
}

function isDeliverableEmail(email: string | null | undefined): email is string {
  const value = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  return !/@(?:jconthemove\.local|example\.(?:com|org|net)|test)$/i.test(value);
}

async function applyDualDelivery(
  client: SquareClient,
  invoiceId: string,
  version: number,
  lead: { phone?: string | null }
): Promise<void> {
  if (!lead.phone) {
    console.warn("[dual-delivery] Skipping SMS — no phone on file for lead");
    return;
  }
  try {
    await client.invoices.update({
      invoiceId,
      invoice: {
        version,
        deliveryMethod: "SMS",
      },
      idempotencyKey: `sms-delivery-${invoiceId}-${Date.now()}`,
    });
  } catch (smsErr: unknown) {
    const msg = smsErr instanceof Error ? smsErr.message : String(smsErr);
    console.warn("[dual-delivery] Could not send additional SMS delivery:", msg);
  }
}

export class SquareInvoiceService {
  private locationId: string | null = null;

  constructor(private readonly dependencies: {
    getClient?: () => Promise<SquareClient>;
    getLocationId?: () => string | undefined | null;
    invoiceStore?: Pick<typeof storage, 'getSquareInvoiceBySquareId' | 'createSquareInvoice'>;
    recordPublication?: typeof recordSquareInvoicePublication;
    recordCancellation?: typeof recordSquareInvoiceCancellation;
  } = {}) {}

  async getLocationId(): Promise<string> {
    if (this.locationId) return this.locationId;
    const configuredLocation = (this.dependencies.getLocationId || getSquareLocationId)();
    if (configuredLocation) {
      this.locationId = configuredLocation;
      return configuredLocation;
    }

    try {
      const client = await (this.dependencies.getClient || getSquareClient)();
      const response = await client.locations.list();
      const locations = response.locations;
      if (!locations || locations.length === 0) {
        throw new Error("No Square locations found. Please set up a location in your Square dashboard.");
      }
      this.locationId = locations[0].id || null;
      if (!this.locationId) {
        throw new Error("Location ID is missing");
      }
      return this.locationId;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Error fetching Square locations:", msg);
      const env = process.env.SQUARE_ENVIRONMENT || "sandbox";
      if (msg.includes("401") || msg.includes("UNAUTHORIZED") || msg.includes("AUTHENTICATION_ERROR")) {
        throw new Error(`Square authentication failed. Your access token may be invalid or expired. Make sure SQUARE_ACCESS_TOKEN matches your ${env} environment. Get a new token from developer.squareup.com.`);
      }
      throw new Error(`Failed to get Square location: ${msg}`);
    }
  }

  async createOrGetCustomer(email: string | null | undefined, name: string, phone?: string, idempotencyKey?: string): Promise<string> {
    try {
      const client = await (this.dependencies.getClient || getSquareClient)();
      const customerEmail = isDeliverableEmail(email) ? email.trim() : undefined;

      if (customerEmail) {
        const searchResponse = await client.customers.search({
          query: {
            filter: {
              emailAddress: {
                exact: customerEmail,
              },
            },
          },
        });

        if (searchResponse.customers && searchResponse.customers.length > 0) {
          const existing = searchResponse.customers[0];
          if (phone && !existing.phoneNumber) {
            await client.customers.update({
              customerId: existing.id!,
              phoneNumber: phone,
            });
          }
          return existing.id!;
        }
      }

      const nameParts = name.split(" ");
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(" ") || "";

      const createResponse = await client.customers.create({
        ...(customerEmail ? { emailAddress: customerEmail } : {}),
        givenName: firstName,
        familyName: lastName,
        phoneNumber: phone,
        idempotencyKey: idempotencyKey || `customer-${customerEmail || phone || name}-${Date.now()}`,
      });

      return createResponse.customer!.id!;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Error creating/getting Square customer:", msg);
      throw new Error(`Failed to create customer: ${msg}`);
    }
  }

  async createInvoiceForLead(
    lead: Lead,
    amount: number,
    description?: string,
    dueDate?: string,
    deliveryMethod: InvoiceDeliveryMethod = "email",
    options: LeadInvoiceOptions = {},
  ): Promise<{ invoiceId: string; invoiceUrl: string; squareInvoiceId: string }> {
    const canonicalFinal = process.env.JOB_PAYMENT_LEDGER_ENABLED === 'true' && options.purpose === 'final_balance';
    lead = { ...lead };
    options = { ...options };
    let intentLocation: string | undefined;
    const invoiceDueDate = dueDate || this.getDefaultDueDate();
    if (canonicalFinal) {
      const configuredLocation=(this.dependencies.getLocationId || getSquareLocationId)();
      if (!options.idempotencyKey || !options.quoteRevisionId || !options.closeoutId || !dueDate || !configuredLocation
        || !Number.isSafeInteger(Math.round(amount*100)) || amount<=0 || amount!==Math.round(amount*100)/100) throw new Error('Canonical invoice intent requires stable financial inputs');
      intentLocation=configuredLocation;
      await reserveSquareInvoiceIntent(options.idempotencyKey,lead.id,{
        version:1,environment:getSquareEnvironment(),locationId:configuredLocation,
        quoteRevisionId:options.quoteRevisionId,closeoutId:options.closeoutId,amountCents:Math.round(amount*100),
        dueDate:invoiceDueDate,deliveryMethod,firstName:lead.firstName || '',lastName:lead.lastName || '',
        email:lead.email || null,phone:lead.phone || null,serviceType:lead.serviceType || null,description:description || null,
      });
    }
    const client = await (this.dependencies.getClient || getSquareClient)();
    const locationId = intentLocation || await this.getLocationId();
    const customerName = `${lead.firstName} ${lead.lastName}`;
    const requestKeys = squareInvoiceRequestKeys(options.idempotencyKey);
    const createCustomer = async () => ({ id:await this.createOrGetCustomer(lead.email, customerName, lead.phone || undefined, requestKeys.customer) });
    const customer = canonicalFinal ? await recoverSquareInvoicePhase(options.idempotencyKey!,'customer',createCustomer) : await createCustomer();
    const customerId = customer.id;

    const amountInCents = BigInt(Math.round(amount * 100));

    const createOrder = async () => {
      const orderResponse = await client.orders.create({
        idempotencyKey: requestKeys.order,
        order: {
          locationId,
          customerId,
          lineItems: [
            {
              name: description || `Moving Service - ${lead.serviceType}`,
              quantity: "1",
              basePriceMoney: {
                amount: amountInCents,
                currency: "USD",
              },
            },
          ],
        },
      });

      return { id:orderResponse.order?.id! };
    };
    const order = canonicalFinal ? await recoverSquareInvoicePhase(options.idempotencyKey!,'order',createOrder) : await createOrder();
    const orderId = order.id;
    const squareDelivery = primarySquareDeliveryMethod(deliveryMethod);

    const createInvoice = async () => {
      const invoiceResponse = await client.invoices.create({
        idempotencyKey: requestKeys.invoice,
        invoice: {
          orderId,
          locationId,
          primaryRecipient: {
            customerId,
          },
          paymentRequests: [
            {
              requestType: "BALANCE",
              dueDate: invoiceDueDate,
            },
          ],
          deliveryMethod: squareDelivery,
          acceptedPaymentMethods: {
            card: true,
            bankAccount: true,
            squareGiftCard: true,
            buyNowPayLater: false,
            cashAppPay: true,
          },
          title: `Invoice - JC ON THE MOVE`,
          description: description || `Moving service for ${customerName}`,
        },
      });

      return { id:invoiceResponse.invoice?.id!,version:invoiceResponse.invoice?.version!,invoiceNumber:invoiceResponse.invoice?.invoiceNumber ?? undefined };
    };
    const squareInvoice = canonicalFinal ? await recoverSquareInvoicePhase(options.idempotencyKey!,'invoice',createInvoice) : await createInvoice();

    // Persist provider identity and financial bindings before making the invoice
    // collectible. A lost publish response must leave a recoverable draft row.
    const invoiceData: InsertSquareInvoice = {
      leadId: safeLeadId(lead.id),
      squareInvoiceId: squareInvoice.id!,
      squareInvoiceNumber: squareInvoice.invoiceNumber ?? undefined,
      squareOrderId: orderId,
      customerId,
      customerEmail: lead.email,
      customerName,
      amount: amount.toString(),
      currency: "USD",
      description: description || `Moving service - ${lead.serviceType}`,
      status: "draft",
      dueDate: invoiceDueDate,
      purpose: options.purpose || "legacy_unknown",
      quoteRevisionId: options.quoteRevisionId || undefined,
      closeoutId: options.closeoutId || undefined,
    };

    const savedInvoice = await persistSquareInvoiceOnce(invoiceData, {
      find: id => (this.dependencies.invoiceStore || storage).getSquareInvoiceBySquareId(id),
      create: data => (this.dependencies.invoiceStore || storage).createSquareInvoice(data),
    });

    if (['canceled', 'failed', 'refunded'].includes(savedInvoice.status)) {
      throw new Error('Square invoice is closed; reconciliation is required before retrying');
    }
    if (process.env.JOB_PAYMENT_LEDGER_ENABLED === 'true' && options.purpose === 'final_balance') {
      await assertCanonicalFinalInvoicePublication({ leadId: lead.id, amount,
        closeoutId: options.closeoutId, quoteRevisionId: options.quoteRevisionId });
      if (savedInvoice.status === 'sent') {
        if (!savedInvoice.invoiceUrl || !savedInvoice.squareInvoiceId || savedInvoice.squareInvoiceId!==squareInvoice.id) {
          throw new Error('Published invoice URL requires reconciliation');
        }
        return {invoiceId:savedInvoice.id,squareInvoiceId:savedInvoice.squareInvoiceId,invoiceUrl:savedInvoice.invoiceUrl};
      }
    }
    const publishResponse = await client.invoices.publish({
      invoiceId: squareInvoice.id!,
      version: squareInvoice.version!,
      idempotencyKey: requestKeys.publish,
    });
    const publishedInvoice = publishResponse.invoice!;
    if (publishedInvoice?.id !== squareInvoice.id) {
      throw new Error('Square publication identity requires reconciliation');
    }
    await (this.dependencies.recordPublication || recordSquareInvoicePublication)({
      squareInvoiceId: publishedInvoice.id!, invoiceUrl: publishedInvoice.publicUrl,
      invoiceNumber: publishedInvoice.invoiceNumber,
    });

    return {
      invoiceId: savedInvoice.id,
      invoiceUrl: publishedInvoice.publicUrl || "",
      squareInvoiceId: publishedInvoice.id!,
    };
  }

  async createStandaloneInvoice(
    email: string,
    name: string,
    phone: string | undefined,
    amount: number,
    description: string,
    dueDate?: string,
    deliveryMethod: InvoiceDeliveryMethod = "email",
    options: { idempotencyKey?: string; purpose?: InvoicePurpose } = {},
  ): Promise<{ invoiceId: string; invoiceUrl: string; squareInvoiceId: string }> {
    const client = await (this.dependencies.getClient || getSquareClient)();
    const locationId = await this.getLocationId();
    const customerId = await this.createOrGetCustomer(email, name, phone);

    const amountInCents = BigInt(Math.round(amount * 100));

    const orderResponse = await client.orders.create({
      idempotencyKey: options.idempotencyKey ? `order-${options.idempotencyKey}` : `order-standalone-${Date.now()}`,
      order: {
        locationId,
        customerId,
        lineItems: [
          {
            name: description,
            quantity: "1",
            basePriceMoney: {
              amount: amountInCents,
              currency: "USD",
            },
          },
        ],
      },
    });

    const orderId = orderResponse.order!.id!;
    const squareDelivery = primarySquareDeliveryMethod(deliveryMethod);

    const invoiceResponse = await client.invoices.create({
      idempotencyKey: options.idempotencyKey ? `invoice-${options.idempotencyKey}` : `invoice-standalone-${Date.now()}`,
      invoice: {
        orderId,
        locationId,
        primaryRecipient: {
          customerId,
        },
        paymentRequests: [
          {
            requestType: "BALANCE",
            dueDate: dueDate || this.getDefaultDueDate(),
          },
        ],
        deliveryMethod: squareDelivery,
        acceptedPaymentMethods: {
          card: true,
          bankAccount: true,
          squareGiftCard: true,
          buyNowPayLater: false,
          cashAppPay: true,
        },
        title: `Invoice - JC ON THE MOVE`,
        description,
      },
    });

    const squareInvoice = invoiceResponse.invoice!;

    const publishResponse = await client.invoices.publish({
      invoiceId: squareInvoice.id!,
      version: squareInvoice.version!,
      idempotencyKey: options.idempotencyKey ? `publish-${options.idempotencyKey}` : `publish-${squareInvoice.id}-${Date.now()}`,
    });

    const publishedInvoice = publishResponse.invoice!;

    const invoiceData: InsertSquareInvoice = {
      squareInvoiceId: publishedInvoice.id!,
      squareInvoiceNumber: publishedInvoice.invoiceNumber ?? undefined,
      squareOrderId: orderId,
      customerId,
      customerEmail: email,
      customerName: name,
      amount: amount.toString(),
      currency: "USD",
      description,
      status: "sent",
      invoiceUrl: publishedInvoice.publicUrl,
      dueDate: dueDate || this.getDefaultDueDate(),
      purpose: options.purpose || "legacy_unknown",
    };

    const savedInvoice = await storage.createSquareInvoice(invoiceData);

    return {
      invoiceId: savedInvoice.id,
      invoiceUrl: publishedInvoice.publicUrl || "",
      squareInvoiceId: publishedInvoice.id!,
    };
  }

  async getCatalogMappings(): Promise<Record<string, string>> {
    try {
      const { pool } = await import("../db");
      const [legacy, managed] = await Promise.all([
        pool.query(`SELECT setting_value FROM spin_config WHERE setting_key='square_catalog_mappings' LIMIT 1`),
        pool.query(`
          SELECT local_code, square_object_id
          FROM commerce_square_mappings
          WHERE local_type='variation' AND sync_status IN ('synced','drifted')
        `).catch(() => ({ rows: [] as any[] })),
      ]);
      const mappings = legacy.rows.length > 0 ? JSON.parse(legacy.rows[0].setting_value) : {};
      for (const row of managed.rows as any[]) mappings[row.local_code] = row.square_object_id;
      return mappings;
    } catch (_) { return {}; }
  }

  async createItemizedInvoiceForLead(
    lead: InvoiceRecipient,
    lineItems: Array<{ id?: string; name: string; qty: number; unitPrice: number; total: number; excludeFromBundleDiscount?: boolean }>,
    dueDate?: string,
    deliveryMethod: InvoiceDeliveryMethod = "email",
    options: ItemizedInvoiceOptions = {},
  ): Promise<{ invoiceId: string; invoiceUrl: string; squareInvoiceId: string }> {
    const client = await (this.dependencies.getClient || getSquareClient)();
    const locationId = await this.getLocationId();
    const customerName = `${lead.firstName} ${lead.lastName}`;
    const customerId = await this.createOrGetCustomer(lead.email, customerName, lead.phone || undefined);

    const catalogMappings = await this.getCatalogMappings();

    const squareLineItems = lineItems.map(li => {
      const catalogVariationId = li.id ? catalogMappings[li.id] : undefined;
      if (catalogVariationId) {
        return {
          catalogObjectId: catalogVariationId,
          quantity: String(li.qty),
        };
      }
      return {
        name: li.name,
        quantity: String(li.qty),
        basePriceMoney: {
          amount: BigInt(Math.round(li.unitPrice * 100)),
          currency: "USD" as const,
        },
      };
    });

    const explicitDiscounts = (options.discounts || [])
      .filter((discount) => Number.isFinite(discount.amount) && discount.amount > 0)
      .map((discount) => ({
          name: discount.name,
          type: "FIXED_AMOUNT" as const,
          amountMoney: {
            amount: BigInt(Math.round(discount.amount * 100)),
            currency: "USD" as const,
          },
          scope: "ORDER" as const,
          metadata: { jcDiscountCode: discount.code },
        }));
    const grossTotal = lineItems.reduce((sum, line) => sum + Number(line.unitPrice) * Number(line.qty), 0);
    const savedLeadTotal = Math.max(0, parseFloat(String(lead.totalPrice || "0")) || 0);
    const possibleLegacyBundleAmount = Math.max(0, parseFloat(String(lead.bundleDiscountAmount || "0")) || 0);
    // Older callers sometimes stored already-discounted line prices. Only add
    // a visible legacy discount when the submitted lines are demonstrably the
    // gross amount; never infer it by inflating catalog prices.
    const legacyBundleAmount = options.discounts
      ? 0
      : possibleLegacyBundleAmount > 0 && Math.abs(grossTotal - (savedLeadTotal + possibleLegacyBundleAmount)) <= 0.02
        ? possibleLegacyBundleAmount
        : 0;
    if (legacyBundleAmount > 0) {
      explicitDiscounts.push({
        name: "Bundle Discount (10%, capped at $50)",
        type: "FIXED_AMOUNT" as const,
        amountMoney: { amount: BigInt(Math.round(legacyBundleAmount * 100)), currency: "USD" as const },
        scope: "ORDER" as const,
        metadata: { jcDiscountCode: "BUNDLE_10" },
      });
    }
    const discountTotal = explicitDiscounts.reduce((sum, discount) => sum + Number(discount.amountMoney.amount) / 100, 0);
    const expectedTotal = options.expectedTotal ?? Math.max(0, grossTotal - discountTotal);
    const requestKey = options.idempotencyKey || `${lead.id}-${Date.now()}`;

    const orderResponse = await client.orders.create({
      idempotencyKey: `order-itemized-${requestKey}`,
      order: {
        locationId,
        customerId,
        lineItems: squareLineItems,
        ...(explicitDiscounts.length ? { discounts: explicitDiscounts } : {}),
        metadata: {
          jcCatalogRevision: String(options.catalogRevision || "legacy"),
          jcPricingRevision: String(options.pricingRevision || "legacy"),
        },
      },
    });

    const orderId = orderResponse.order!.id!;
    const squareTotal = Number(orderResponse.order?.totalMoney?.amount || 0n) / 100;
    if (Math.abs(squareTotal - expectedTotal) > 0.01) {
      try { await client.orders.update({ orderId, order: { locationId, version: orderResponse.order?.version, state: "CANCELED" } as any }); } catch (_) { /* best effort */ }
      throw new Error(`Square order total $${squareTotal.toFixed(2)} does not match the approved JC total $${expectedTotal.toFixed(2)}. The invoice was not published.`);
    }
    const squareDelivery = primarySquareDeliveryMethod(deliveryMethod);

    const invoiceResponse = await client.invoices.create({
      idempotencyKey: `invoice-itemized-${requestKey}`,
      invoice: {
        orderId,
        locationId,
        primaryRecipient: { customerId },
        paymentRequests: [{ requestType: "BALANCE", dueDate: dueDate || this.getDefaultDueDate() }],
        deliveryMethod: squareDelivery,
        acceptedPaymentMethods: { card: true, bankAccount: true, squareGiftCard: true, buyNowPayLater: false, cashAppPay: true },
        title: `Invoice - JC ON THE MOVE`,
        description: options.description || `JC ON THE MOVE service for ${customerName}`,
      },
    });

    const squareInvoice = invoiceResponse.invoice!;
    const publishResponse = await client.invoices.publish({
      invoiceId: squareInvoice.id!,
      version: squareInvoice.version!,
      idempotencyKey: `publish-itemized-${requestKey}`,
    });
    const publishedInvoice = publishResponse.invoice!;

    const invoiceData: InsertSquareInvoice = {
      leadId: safeLeadId(lead.id),
      squareInvoiceId: publishedInvoice.id!,
      squareInvoiceNumber: publishedInvoice.invoiceNumber ?? undefined,
      squareOrderId: orderId,
      customerId,
      customerEmail: lead.email,
      customerName,
      amount: expectedTotal.toFixed(2),
      currency: "USD",
      description: `${options.description || "Itemized order"} — ${lineItems.length} line item(s); catalog ${options.catalogRevision || "legacy"}; pricing ${options.pricingRevision || "legacy"}`,
      status: "sent",
      invoiceUrl: publishedInvoice.publicUrl,
      dueDate: dueDate || this.getDefaultDueDate(),
      purpose: options.purpose || "legacy_unknown",
      quoteRevisionId: options.quoteRevisionId || undefined,
      closeoutId: options.closeoutId || undefined,
    };

    const savedInvoice = await storage.createSquareInvoice(invoiceData);
    return {
      invoiceId: savedInvoice.id,
      invoiceUrl: publishedInvoice.publicUrl || "",
      squareInvoiceId: publishedInvoice.id!,
    };
  }

  async getInvoiceStatus(squareInvoiceId: string): Promise<string> {
    try {
      const client = await (this.dependencies.getClient || getSquareClient)();
      const response = await client.invoices.get({ invoiceId: squareInvoiceId });
      return response.invoice?.status || "UNKNOWN";
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Error getting invoice status:", msg);
      throw new Error(`Failed to get invoice status: ${msg}`);
    }
  }

  async cancelInvoice(squareInvoiceId: string): Promise<void> {
    const client = await (this.dependencies.getClient || getSquareClient)();
    await cancelSquareInvoiceWithRecovery(squareInvoiceId, {
      get: async () => (await client.invoices.get({ invoiceId: squareInvoiceId }, { timeoutInSeconds: 10, maxRetries: 0 })).invoice,
      cancel: async version => (await client.invoices.cancel({ invoiceId: squareInvoiceId, version }, { timeoutInSeconds: 10, maxRetries: 0 })).invoice,
      recordCanceled: () => (this.dependencies.recordCancellation || recordSquareInvoiceCancellation)(squareInvoiceId),
    });
  }

  async syncInvoiceStatus(squareInvoiceId: string): Promise<string> {
    try {
      const client = await (this.dependencies.getClient || getSquareClient)();
      const response = await client.invoices.get({ invoiceId: squareInvoiceId });
      const invoice = response.invoice;

      if (!invoice) {
        throw new Error("Invoice not found");
      }

      const status = this.mapSquareStatus(invoice.status || "DRAFT");
      await storage.updateSquareInvoiceStatus(squareInvoiceId, status);

      return status;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Error syncing invoice status:", msg);
      throw new Error(`Failed to sync invoice status: ${msg}`);
    }
  }

  mapSquareStatus(squareStatus: string): string {
    const statusMap: Record<string, string> = {
      DRAFT: "draft",
      UNPAID: "sent",
      SCHEDULED: "sent",
      PARTIALLY_PAID: "sent",
      PAID: "paid",
      PARTIALLY_REFUNDED: "paid",
      REFUNDED: "paid",
      CANCELED: "canceled",
      FAILED: "failed",
      PAYMENT_PENDING: "sent",
    };
    return statusMap[squareStatus] || "sent";
  }

  private getDefaultDueDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return date.toISOString().split("T")[0];
  }

  isConfigured(): boolean {
    return Boolean(getSquareAccessToken());
  }
}

export const squareInvoiceService = new SquareInvoiceService();
