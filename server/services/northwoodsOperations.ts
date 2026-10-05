import { normalizeCustomerPhone, phoneError } from "@shared/phone";
import type { NorthwoodsAvailabilityInput } from "@shared/northwoodsMarketing";
import { pool } from "../db";
import { dispatchJob } from "../dispatch";
import { auditNorthwoods, ensureNorthwoodsSchema } from "./northwoodsSchema";
import { northwoodsGmailHealth } from "./northwoodsGmailImporter";

function centralDateTimeToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wantedWallTime = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = wantedWallTime;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
    const rendered = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), 0);
    instant += wantedWallTime - rendered;
  }
  return new Date(instant);
}

function timeLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, hours, minutes)));
}

function dateOnly(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value || "");
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Reservation service date is invalid");
  return parsed.toISOString().slice(0, 10);
}

type TransactionClient = { query: <T = any>(text: string, values?: any[]) => Promise<{ rows: T[] }> };

function addWallMinutes(value: string, minutesToAdd: number) {
  const [hours, minutes] = value.split(":").map(Number);
  const total = hours * 60 + minutes + minutesToAdd;
  return `${String(Math.floor((total % (24 * 60)) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function reservationMissing(row: any) {
  return [
    "external_order_id", "customer_first_name", "customer_last_name", "customer_email", "customer_phone",
    "service_date", "start_time", "duration_hours", "crew_size", "from_address", "focus", "market_id",
  ].filter((field) => row[field] === null || row[field] === "" || row[field] === undefined);
}

export async function getNorthwoodsDashboard() {
  await ensureNorthwoodsSchema();
  const [markets, availability, scans, reservations, campaign, importer, messageStats, importIssues] = await Promise.all([
    pool.query(`
      SELECT m.*,c.verification_status,c.ads_enabled,c.auto_book_enabled,
             latest.id AS latest_scan_listing_id,latest.two_hour_rate_cents,latest.additional_hour_rate_cents,
             latest.piano_fee_cents,latest.safe_fee_cents,latest.rating,latest.review_count,
             latest.captured_at AS snapshot_captured_at,latest.provider_count,latest.price_rank,
             next_avail.service_date::text AS next_service_date,next_avail.status AS next_availability_status,
             next_avail.open_slots AS next_open_slots,next_avail.services AS next_services
      FROM northwoods_markets m
      JOIN service_area_capabilities c ON c.code=m.service_area_code
      LEFT JOIN LATERAL (
        SELECT mine.*,
          (SELECT COUNT(*)::int FROM northwoods_scan_listings all_l WHERE all_l.run_id=mine.run_id AND all_l.market_id=mine.market_id AND all_l.listed_for_target_date=true) AS provider_count,
          (SELECT COUNT(*)::int+1 FROM northwoods_scan_listings cheaper WHERE cheaper.run_id=mine.run_id AND cheaper.market_id=mine.market_id
             AND cheaper.two_hour_rate_cents IS NOT NULL AND mine.two_hour_rate_cents IS NOT NULL AND cheaper.two_hour_rate_cents<mine.two_hour_rate_cents) AS price_rank
        FROM northwoods_scan_listings mine JOIN northwoods_scan_runs sr ON sr.id=mine.run_id
        WHERE mine.market_id=m.id AND mine.is_northwoods=true AND sr.status='approved'
        ORDER BY sr.reviewed_at DESC NULLS LAST,mine.captured_at DESC LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT * FROM northwoods_market_availability na WHERE na.market_id=m.id AND na.service_date>=CURRENT_DATE
          AND na.confirmed_at IS NOT NULL ORDER BY na.service_date LIMIT 1
      ) next_avail ON true
      WHERE m.active=true ORDER BY m.priority DESC,m.city
    `),
    pool.query(`SELECT a.*,m.slug,m.city,m.state_code FROM northwoods_market_availability a JOIN northwoods_markets m ON m.id=a.market_id WHERE a.service_date BETWEEN CURRENT_DATE AND CURRENT_DATE+14 ORDER BY a.service_date,m.priority DESC`),
    pool.query(`SELECT * FROM northwoods_scan_runs ORDER BY created_at DESC LIMIT 12`),
    pool.query(`SELECT r.*,m.slug AS market_slug,m.city AS market_city,m.state_code FROM northwoods_reservations r LEFT JOIN northwoods_markets m ON m.id=r.market_id ORDER BY CASE r.status WHEN 'new' THEN 0 WHEN 'needs_review' THEN 1 WHEN 'changed' THEN 2 ELSE 3 END,r.updated_at DESC LIMIT 100`),
    pool.query(`SELECT id,headline,status,northwoods_focus,created_at FROM marketing_bot_campaigns WHERE brand='northwoods_moving' AND status IN ('pending_approval','approved','failed','partially_published') ORDER BY created_at DESC LIMIT 1`),
    pool.query(`SELECT MAX(processed_at) AS last_processed_at,COUNT(*) FILTER (WHERE processed_at>=NOW()-INTERVAL '24 hours')::int AS processed_24h FROM northwoods_inbound_messages`),
    pool.query(`SELECT parse_status,COUNT(*)::int AS count FROM northwoods_inbound_messages GROUP BY parse_status`),
    pool.query(`
      SELECT id,gmail_message_id,sender,subject,received_at,parse_status,parse_errors,external_order_id,processed_at
        FROM northwoods_inbound_messages
       WHERE parse_status IN ('error','unmatched')
       ORDER BY received_at DESC NULLS LAST,processed_at DESC
       LIMIT 50
    `),
  ]);
  const marketRows = markets.rows;
  return {
    providerId: "404EEC12FC5143",
    markets: marketRows,
    availability: availability.rows,
    scans: scans.rows,
    reservations: reservations.rows,
    importIssues: importIssues.rows,
    activeCampaign: campaign.rows[0] || null,
    metrics: {
      confirmedOpenings: availability.rows.filter((row: any) => row.confirmed_at && row.status !== "closed" && Number(row.open_slots) > 0).length,
      advertisingMarkets: marketRows.filter((row: any) => row.ads_enabled && row.verification_status === "verified").length,
      newReservations: reservations.rows.filter((row: any) => ["new", "needs_review", "changed"].includes(row.status)).length,
      importIssues: importIssues.rows.length,
      pendingScans: scans.rows.filter((row: any) => row.status === "pending_review").length,
    },
    gmail: { ...northwoodsGmailHealth(), ...(importer.rows[0] || {}), statuses: messageStats.rows },
    scanner: { enabled: process.env.NORTHWOODS_MARKET_SCAN_ENABLED === "true", mode: "admin_triggered_review_gate" },
    scheduler: { enabled: process.env.NORTHWOODS_MARKETING_SCHEDULER_ENABLED === "true", autoPublish: false, proposalTime: "6:30 AM America/Chicago" },
  };
}

export async function upsertNorthwoodsAvailability(input: {
  marketId: string;
  actorUserId: string;
  data: NorthwoodsAvailabilityInput;
}) {
  await ensureNorthwoodsSchema();
  if (input.data.endTime <= input.data.startTime) throw new Error("End time must be later than start time");
  const result = await pool.query(`
    INSERT INTO northwoods_market_availability
      (market_id,service_date,start_time,end_time,services,planned_crew_size,open_slots,status,source,notes,confirmed_by_user_id,confirmed_at)
    VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,'manual',$9,$10,NOW())
    ON CONFLICT (market_id,service_date) DO UPDATE SET
      start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,services=EXCLUDED.services,
      planned_crew_size=EXCLUDED.planned_crew_size,open_slots=EXCLUDED.open_slots,status=EXCLUDED.status,
      source='manual',notes=EXCLUDED.notes,confirmed_by_user_id=EXCLUDED.confirmed_by_user_id,confirmed_at=NOW(),updated_at=NOW()
    RETURNING *
  `, [input.marketId, input.data.serviceDate, input.data.startTime, input.data.endTime, input.data.services,
    input.data.plannedCrewSize, input.data.openSlots, input.data.status, input.data.notes || null, input.actorUserId]);
  await auditNorthwoods({ actorUserId: input.actorUserId, action: "availability_confirmed", targetType: "market", targetId: input.marketId, metadata: input.data });
  return result.rows[0];
}

export async function patchNorthwoodsReservation(id: string, patch: Record<string, unknown>, actorUserId: string) {
  await ensureNorthwoodsSchema();
  const mapping: Record<string, string> = {
    customerFirstName: "customer_first_name", customerLastName: "customer_last_name", customerEmail: "customer_email",
    customerPhone: "customer_phone", serviceDate: "service_date", startTime: "start_time", durationHours: "duration_hours",
    crewSize: "crew_size", fromAddress: "from_address", toAddress: "to_address", marketId: "market_id", focus: "focus",
    quotedAmountCents: "quoted_amount_cents", notes: "notes",
  };
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = mapping[key];
    if (!column) continue;
    values.push(value === "" ? null : value);
    fields.push(`${column}=$${values.length + 1}${column === "service_date" ? "::date" : ""}`);
  }
  if (!fields.length) throw new Error("No reservation changes supplied");
  values.unshift(id);
  const result = await pool.query(`UPDATE northwoods_reservations SET ${fields.join(",")},updated_at=NOW() WHERE id=$1 RETURNING *`, values);
  const row = result.rows[0];
  if (!row) throw new Error("Reservation not found");
  const missing = reservationMissing(row);
  if (!row.linked_lead_id && row.status !== "cancelled" && row.status !== "ignored") {
    const status = missing.length ? "needs_review" : "new";
    await pool.query("UPDATE northwoods_reservations SET status=$2 WHERE id=$1", [id, status]);
    row.status = status;
  }
  await auditNorthwoods({ actorUserId, action: "reservation_corrected", targetType: "reservation", targetId: id, metadata: { fields: Object.keys(patch), missing } });
  return row;
}

export async function ignoreNorthwoodsReservation(id: string, actorUserId: string) {
  await ensureNorthwoodsSchema();
  const result = await pool.query(`UPDATE northwoods_reservations SET status='ignored',ignored_by_user_id=$2,ignored_at=NOW(),updated_at=NOW() WHERE id=$1 AND linked_lead_id IS NULL RETURNING *`, [id, actorUserId]);
  if (!result.rows[0]) throw new Error("A confirmed reservation cannot be ignored");
  await auditNorthwoods({ actorUserId, action: "reservation_ignored", targetType: "reservation", targetId: id });
  return result.rows[0];
}

async function createOperationalJob(tx: TransactionClient, reservation: any, actorUserId: string) {
  const normalizedPhone = normalizeCustomerPhone(reservation.customer_phone);
  if (!normalizedPhone) throw new Error(phoneError(String(reservation.customer_phone || "")) || "Correct the customer phone number before confirming this reservation.");
  reservation = { ...reservation, customer_phone: normalizedPhone };
  const marketResult = await tx.query<any>(`
    SELECT m.*,c.verification_status,c.ads_enabled FROM northwoods_markets m
    JOIN service_area_capabilities c ON c.code=m.service_area_code WHERE m.id=$1 LIMIT 1
  `, [reservation.market_id]);
  const market = marketResult.rows[0];
  if (!market) throw new Error("Select a configured Northwoods market");
  const durationHours = Number(reservation.duration_hours);
  const crewSize = Number(reservation.crew_size);
  const serviceDate = dateOnly(reservation.service_date);
  const startAt = centralDateTimeToUtc(serviceDate, reservation.start_time);
  const endWallTime = addWallMinutes(reservation.start_time, Math.round(durationHours * 60));
  const customerName = `${reservation.customer_first_name} ${reservation.customer_last_name}`.trim();
  const focus = String(reservation.focus);
  const isUBox = focus === "u_box";
  const externalSnapshot = {
    operationalOnly: true,
    source: "moving_help_uhaul",
    providerId: market.provider_id,
    externalOrderId: reservation.external_order_id,
    market: { id: market.id, slug: market.slug, city: market.city, state: market.state_code, serviceAreaCode: market.service_area_code },
    focus,
    quotedAmountCents: reservation.quoted_amount_cents,
    automaticFinancialEffectsEnabled: false,
    requiredCapabilities: isUBox ? ["mover", "driver", "uhaul"] : ["mover"],
  };
  const booking = await tx.query<{ id: string }>(`
    INSERT INTO bookings
      (customer_name,customer_email,customer_phone,service_address,notes,subtotal,discount_total,final_total,token_estimate,status,source,pricing_snapshot)
    VALUES ($1,$2,$3,$4,$5,0,0,0,0,'booked','moving_help_uhaul',$6::jsonb) RETURNING id
  `, [customerName, reservation.customer_email, reservation.customer_phone, reservation.from_address,
      `Operational-only Moving Help reservation ${reservation.external_order_id}`, JSON.stringify(externalSnapshot)]);
  const bookingId = booking.rows[0].id;
  const lead = await tx.query<{ id: string }>(`
    INSERT INTO leads
      (first_name,last_name,email,phone,service_type,from_address,to_address,move_date,confirmed_date,
       status,source,crew_size,confirmed_hours,arrival_window,deposit_required,deposit_paid,is_quote_only,
       financial_status,booking_id,quote_snapshot,job_plan_details,has_piano,has_heavy_safe,created_by_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,'available','moving_help_uhaul',$9,$10,$11,false,false,false,
            'external_marketplace',$12,$13::jsonb,$13::jsonb,$14,$15,$16)
    RETURNING id
  `, [reservation.customer_first_name, reservation.customer_last_name, reservation.customer_email, reservation.customer_phone,
      isUBox ? "moving" : "labor", reservation.from_address, reservation.to_address || null, serviceDate,
      crewSize, Math.ceil(durationHours), `${timeLabel(reservation.start_time)}–${timeLabel(endWallTime)}`,
      bookingId, JSON.stringify(externalSnapshot), focus === "piano", focus === "safe", actorUserId]);
  const leadId = lead.rows[0].id;
  await tx.query(`
    INSERT INTO booking_service_items
      (booking_id,service_code,service_label,quantity,unit_price,line_subtotal,price_mode,details,status,scheduled_at)
    VALUES ($1,$2,$3,1,0,0,'external_marketplace',$4::jsonb,'scheduled',$5)
  `, [bookingId, isUBox ? "moving" : "labor", focus.replaceAll("_", " "), JSON.stringify(externalSnapshot), startAt]);
  await tx.query(`
    INSERT INTO booking_slot_holds
      (booking_id,lead_id,service_date,start_at,duration_minutes,crew_size,status,review_required,zone_code,quote_snapshot,reviewed_by_user_id,reviewed_at)
    VALUES ($1,$2,$3::date,$4,$5,$6,'confirmed',false,$7,$8::jsonb,$9,NOW())
  `, [bookingId, leadId, serviceDate, startAt, Math.round(durationHours * 60), crewSize,
      market.service_area_code, JSON.stringify(externalSnapshot), actorUserId]);
  return { leadId, bookingId, market };
}

export async function confirmNorthwoodsReservation(id: string, actorUserId: string) {
  await ensureNorthwoodsSchema();
  const client = await pool.connect();
  let created: { leadId: string; bookingId: string; market: any } | null = null;
  try {
    await client.query("BEGIN");
    const selected = await client.query<any>("SELECT * FROM northwoods_reservations WHERE id=$1 FOR UPDATE", [id]);
    const reservation = selected.rows[0];
    if (!reservation) throw new Error("Reservation not found");
    if (reservation.linked_lead_id) {
      await client.query("COMMIT");
      return { reservation, leadId: reservation.linked_lead_id, alreadyConfirmed: true, dispatch: null };
    }
    if (["cancelled", "ignored"].includes(reservation.status)) throw new Error(`A ${reservation.status} reservation cannot be confirmed`);
    const missing = reservationMissing(reservation);
    if (missing.length) throw new Error(`Complete these reservation fields first: ${missing.join(", ")}`);
    created = await createOperationalJob(client, reservation, actorUserId);
    const confirmed = await client.query(`
      UPDATE northwoods_reservations SET status='confirmed',linked_lead_id=$2,confirmed_by_user_id=$3,
        confirmed_at=NOW(),pending_changes='{}'::jsonb,updated_at=NOW() WHERE id=$1 RETURNING *
    `, [id, created.leadId, actorUserId]);
    await client.query("COMMIT");
    const verified = created.market.verification_status === "verified";
    const dispatch = verified
      ? await dispatchJob(created.leadId, { actorUserId, reason: "moving_help_email_admin_confirmed" })
      : { ok: false, state: "pending", message: "Service area needs verification before automatic crew offers" };
    await auditNorthwoods({ actorUserId, action: "reservation_confirmed", targetType: "reservation", targetId: id, metadata: { leadId: created.leadId, bookingId: created.bookingId, dispatch } });
    return { reservation: confirmed.rows[0], leadId: created.leadId, bookingId: created.bookingId, dispatch };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function applyNorthwoodsReservationChanges(id: string, actorUserId: string) {
  await ensureNorthwoodsSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<any>("SELECT * FROM northwoods_reservations WHERE id=$1 FOR UPDATE", [id]);
    const reservation = selected.rows[0];
    if (!reservation?.linked_lead_id) throw new Error("Confirm the reservation before applying message changes");
    const changes = reservation.pending_changes || {};
    if (!Object.keys(changes).length) throw new Error("No pending reservation changes");
    if (changes.emailKind === "cancel") {
      await client.query("UPDATE leads SET status='cancelled',dispatch_state='failed',last_quote_updated_at=NOW() WHERE id=$1", [reservation.linked_lead_id]);
      await client.query("UPDATE booking_slot_holds SET status='released',updated_at=NOW() WHERE lead_id=$1", [reservation.linked_lead_id]);
      await client.query("UPDATE northwoods_reservations SET status='cancelled',pending_changes='{}'::jsonb,updated_at=NOW() WHERE id=$1", [id]);
    } else {
      const serviceDate = changes.serviceDate || dateOnly(reservation.service_date);
      const startTime = changes.startTime || reservation.start_time;
      const durationHours = Number(changes.durationHours || reservation.duration_hours);
      const crewSize = Number(changes.crewSize || reservation.crew_size);
      const startAt = centralDateTimeToUtc(serviceDate, startTime);
      if (changes.customerPhone !== undefined && changes.customerPhone !== reservation.customer_phone) {
        const normalizedPhone = normalizeCustomerPhone(changes.customerPhone);
        if (!normalizedPhone) throw new Error(phoneError(String(changes.customerPhone || "")) || "Correct the customer phone number.");
        changes.customerPhone = normalizedPhone;
      }
      await client.query(`
        UPDATE leads SET first_name=COALESCE($2,first_name),last_name=COALESCE($3,last_name),email=COALESCE($4,email),
          phone=COALESCE($5,phone),from_address=COALESCE($6,from_address),to_address=COALESCE($7,to_address),
          move_date=$8,confirmed_date=$8,crew_size=$9,confirmed_hours=$10,last_quote_updated_at=NOW()
        WHERE id=$1
      `, [reservation.linked_lead_id, changes.customerFirstName, changes.customerLastName, changes.customerEmail, changes.customerPhone,
        changes.fromAddress, changes.toAddress, serviceDate, crewSize, Math.ceil(durationHours)]);
      await client.query(`UPDATE booking_slot_holds SET service_date=$2::date,start_at=$3,duration_minutes=$4,crew_size=$5,updated_at=NOW() WHERE lead_id=$1`,
        [reservation.linked_lead_id, serviceDate, startAt, Math.round(durationHours * 60), crewSize]);
      await client.query(`
        UPDATE northwoods_reservations SET status='confirmed',customer_first_name=COALESCE($2,customer_first_name),
          customer_last_name=COALESCE($3,customer_last_name),customer_email=COALESCE($4,customer_email),
          customer_phone=COALESCE($5,customer_phone),service_date=$6::date,start_time=$7,duration_hours=$8,
          crew_size=$9,from_address=COALESCE($10,from_address),to_address=COALESCE($11,to_address),
          market_id=COALESCE($12,market_id),focus=COALESCE($13,focus),quoted_amount_cents=COALESCE($14,quoted_amount_cents),
          notes=COALESCE($15,notes),pending_changes='{}'::jsonb,updated_at=NOW() WHERE id=$1
      `, [id, changes.customerFirstName, changes.customerLastName, changes.customerEmail, changes.customerPhone,
        serviceDate, startTime, durationHours, crewSize, changes.fromAddress, changes.toAddress, changes.marketId,
        changes.focus, changes.quotedAmountCents, changes.notes]);
    }
    await client.query("COMMIT");
    await auditNorthwoods({ actorUserId, action: "reservation_changes_applied", targetType: "reservation", targetId: id, metadata: { leadId: reservation.linked_lead_id } });
    return (await pool.query("SELECT * FROM northwoods_reservations WHERE id=$1", [id])).rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPublicNorthwoodsMarket(slug: string) {
  await ensureNorthwoodsSchema();
  const result = await pool.query<any>(`
    SELECT m.slug,m.city,m.state_code,m.postal_code,m.provider_id,m.services,m.profile_url,m.service_booking_urls,
           c.ads_enabled,c.verification_status
    FROM northwoods_markets m JOIN service_area_capabilities c ON c.code=m.service_area_code
    WHERE m.slug=$1 AND m.active=true LIMIT 1
  `, [slug]);
  const market = result.rows[0];
  if (!market) return null;
  const urls = market.service_booking_urls || {};
  return {
    slug: market.slug,
    city: market.city,
    stateCode: market.state_code,
    postalCode: market.postal_code,
    providerId: market.provider_id,
    services: market.services,
    bookingUrls: Object.fromEntries((market.services || []).map((service: string) => [service, urls[service] || market.profile_url])),
    bookingDisclosure: "Live pricing and reservations are handled through Moving Help powered by U-Haul.",
  };
}
