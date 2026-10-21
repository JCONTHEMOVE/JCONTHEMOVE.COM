import { bookingDateTimeToUtc } from "../../shared/homepageBooking";
import { quickBookHoursCoverWork } from "./quickBookAvailability";
import type { BookingSql } from "./publicBookingRequests";

export async function lockBookingCapacity(client: BookingSql, date: string) {
  // All overlapping starts on a service date share this lock, not only equal starts.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`booking-capacity:${date}`]);
}

export async function instantCrewCapacity(client: BookingSql, input: {
  date: string; time: string; durationMinutes: number; crewSize: number;
}) {
  const startAt = bookingDateTimeToUtc(input.date, input.time);
  const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
  const dayOfWeek = new Date(`${input.date}T12:00:00Z`).getUTCDay();
  const workers = await client.query(`
    SELECT u.id,
      EXISTS(SELECT 1 FROM worker_day_blocks b WHERE b.user_id=u.id AND b.date=$1) AS blocked,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('start_hour',s.start_hour,'end_hour',s.end_hour,'is_available',s.is_available))
        FROM worker_schedule s WHERE s.user_id=u.id AND s.day_of_week=$2),'[]'::jsonb) AS weekly,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('start_hour',o.start_hour,'end_hour',o.end_hour))
        FROM worker_hour_overrides o WHERE o.user_id=u.id AND o.date=$1),'[]'::jsonb) AS overrides
    FROM users u WHERE u.is_approved=true AND u.status='approved' AND u.is_available=true
      AND (u.role='employee' OR (u.role IN ('admin','business_owner') AND COALESCE(u.capabilities,'{}') @> ARRAY['mover']::text[]))`, [input.date, dayOfWeek]);
  const hour = Number(input.time.slice(0, 2));
  const work = { arrivalWindow: `${hour % 12 || 12}:00 ${hour >= 12 ? "PM" : "AM"}`, hours: input.durationMinutes / 60 };
  // Fail closed for an unconfigured public schedule; use the same working-hour
  // coverage rule as staff Quick Book once weekly hours/overrides exist.
  const capacity = workers.rows.filter(w => (w.weekly.length || w.overrides.length)
    && quickBookHoursCoverWork(work, w.weekly, w.overrides, w.blocked)).length;
  const legacy = await client.query(`
    SELECT COALESCE(SUM(COALESCE(l.crew_size,2)),0)::int AS reserved FROM leads l
    WHERE COALESCE(NULLIF(l.confirmed_date,''),l.move_date)=$1
      AND l.archived_at IS NULL AND l.status NOT IN ('cancelled','completed','closed','archived')
      AND NOT EXISTS(SELECT 1 FROM booking_slot_holds h WHERE h.lead_id=l.id)
      AND NOT EXISTS(SELECT 1 FROM lead_schedule_requests s WHERE s.lead_id=l.id)`, [input.date]);
  const holds = await client.query(`
    SELECT COALESCE(SUM(crew_size),0)::int AS reserved FROM booking_slot_holds
    WHERE (status='confirmed' OR (status IN ('pending_review','awaiting_deposit') AND expires_at > clock_timestamp()))
      AND start_at < $2::timestamptz AND start_at + duration_minutes * INTERVAL '1 minute' > $1::timestamptz`, [startAt, endAt]);
  const schedules = await client.query(`
    SELECT COALESCE(SUM(selected_crew_size),0)::int AS reserved FROM lead_schedule_requests
    WHERE status='confirmed'
      AND (preferred_date+preferred_start_time) AT TIME ZONE timezone < $2::timestamptz
      AND (preferred_date+preferred_start_time) AT TIME ZONE timezone + planning_minutes * INTERVAL '1 minute' > $1::timestamptz`, [startAt, endAt]);
  const legacyReserved = Number(legacy.rows[0]?.reserved || 0) + Number(schedules.rows[0]?.reserved || 0);
  const heldReserved = Number(holds.rows[0]?.reserved || 0);
  const availableCrew = Math.max(0, capacity - legacyReserved - heldReserved);
  return { startAt, endAt, capacity, legacyReserved, heldReserved, availableCrew, available: availableCrew >= input.crewSize };
}

// Caller owns the transaction. Expiry and booking state move together; callers
// cannot observe a freed slot with a still-confirmable pending booking.
export async function expireBookingHolds(client: BookingSql) {
  const result = await client.query(`
    WITH due AS (SELECT id FROM booking_slot_holds
      WHERE status IN ('pending_review','awaiting_deposit') AND expires_at <= clock_timestamp()
      ORDER BY id FOR UPDATE SKIP LOCKED)
    UPDATE booking_slot_holds h SET status='expired',updated_at=NOW() FROM due WHERE h.id=due.id
    RETURNING h.lead_id,h.booking_id`);
  for (const row of result.rows) {
    await client.query("UPDATE bookings SET status='expired' WHERE id=$1 AND status IN ('pending_review','awaiting_deposit')", [row.booking_id]);
    await client.query(`UPDATE leads SET status=CASE WHEN status='awaiting_deposit' THEN 'quote_requested' ELSE status END,
      financial_status=CASE WHEN financial_status='awaiting_deposit' THEN 'deposit_expired' ELSE financial_status END WHERE id=$1`, [row.lead_id]);
  }
  return result.rows as Array<{ lead_id: string; booking_id: string }>;
}

export async function lockActiveBookingHold(client: BookingSql, id: string) {
  const { rows } = await client.query(`SELECT *, expires_at > clock_timestamp() AS active
    FROM booking_slot_holds WHERE id=$1 FOR UPDATE`, [id]);
  const hold = rows[0];
  if (hold) {
    await lockBookingCapacity(client, hold.service_date instanceof Date ? hold.service_date.toISOString().slice(0, 10) : String(hold.service_date).slice(0, 10));
    hold.active = (await client.query("SELECT expires_at > clock_timestamp() AS active FROM booking_slot_holds WHERE id=$1", [hold.id])).rows[0]?.active;
  }
  if (!hold || !hold.active || !["pending_review", "awaiting_deposit"].includes(hold.status)) {
    throw new Error("This hold is no longer active. Check its current state before continuing.");
  }
  return hold;
}

/** Called only after signed-event validation AND a Square GetInvoice PAID read.
 * The row lock serializes payment against expiry/release/review. A late payment
 * is recorded for reconciliation, but can never reacquire capacity implicitly. */
export async function settleVerifiedBookingHold(client: BookingSql, leadId: string, verifiedInvoiceStatus: string, quoteRevisionId?: string | null) {
  if (verifiedInvoiceStatus !== "PAID") throw new Error("A server-verified paid invoice is required");
  const { rows } = await client.query(`SELECT *, expires_at > clock_timestamp() AS active
    FROM booking_slot_holds WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [leadId]);
  const hold = rows[0];
  if (!hold) return "not_applicable" as const;
  await lockBookingCapacity(client, hold.service_date instanceof Date ? hold.service_date.toISOString().slice(0, 10) : String(hold.service_date).slice(0, 10));
  hold.active = (await client.query("SELECT expires_at > clock_timestamp() AS active FROM booking_slot_holds WHERE id=$1", [hold.id])).rows[0]?.active;
  if (hold.status === "confirmed") return "confirmed" as const;
  const latestQuote = await client.query("SELECT id FROM quote_revisions WHERE lead_id=$1 AND status IN ('approved','sent') ORDER BY revision DESC LIMIT 1", [leadId]);
  const matchesQuote = Boolean(quoteRevisionId && latestQuote.rows[0]?.id === quoteRevisionId);
  if (hold.status === "awaiting_deposit" && hold.active && matchesQuote) {
    await client.query("UPDATE booking_slot_holds SET status='confirmed',expires_at=NULL,updated_at=NOW() WHERE id=$1", [hold.id]);
    await client.query("UPDATE bookings SET status='booked' WHERE id=$1", [hold.booking_id]);
    return "confirmed" as const;
  }
  await client.query("UPDATE booking_slot_holds SET status='payment_review',review_required=true,updated_at=NOW() WHERE id=$1", [hold.id]);
  await client.query("UPDATE bookings SET status='payment_review' WHERE id=$1", [hold.booking_id]);
  await client.query("UPDATE leads SET status='quote_requested',financial_status='payment_review' WHERE id=$1", [leadId]);
  return "payment_review" as const;
}
