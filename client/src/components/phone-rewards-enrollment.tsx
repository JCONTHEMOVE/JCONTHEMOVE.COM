import { useState } from "react";
import { Gift, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { normalizeCustomerPhone, phoneError } from "@shared/phone";

export function PhoneRewardsEnrollment({ phone: contactPhone, crew = false }: { phone?: string; crew?: boolean }) {
  const [ownPhone, setOwnPhone] = useState("");
  const phone = contactPhone ?? ownPhone;
  const [chosen, setChosen] = useState(false);
  const [challenge, setChallenge] = useState<{ id: string; phone: string } | null>(null);
  const [code, setCode] = useState("");
  const [enrolledPhone, setEnrolledPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const normalized = normalizeCustomerPhone(phone);
  const activeChallenge = challenge?.phone === normalized ? challenge : null;
  async function requestCode() {
    const problem = phoneError(phone);
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      const response = await apiRequest("POST", "/api/rewards/phone/code", { phone, consent: true });
      const data = await response.json();
      setChallenge({ id: data.challengeId, phone: normalized! }); setCode("");
    } catch (error) { setError(readError(error)); } finally { setBusy(false); }
  }
  async function verify() {
    if (!activeChallenge) return;
    setBusy(true); setError("");
    try {
      await apiRequest("POST", "/api/rewards/phone/verify", { challengeId: activeChallenge.id, code });
      setEnrolledPhone(activeChallenge.phone);
    } catch (error) { setError(readError(error)); } finally { setBusy(false); }
  }
  return <section aria-label="Optional JCMOVES rewards" className="rounded-xl border border-orange-400/30 bg-slate-900 p-4 text-slate-100">
    <h3 className="flex items-center gap-2 font-bold"><Gift aria-hidden="true" className="h-5 w-5 text-orange-300" />JCMOVES rewards · Optional</h3>
    {enrolledPhone && enrolledPhone === normalized ? <div><p role="status" className="mt-3 text-sm text-emerald-300"><CheckCircle2 aria-hidden="true" className="mr-1 inline h-5 w-5" />Rewards enrolled for {enrolledPhone}. Use this number for your booking. Eligible rewards follow the existing confirmed-job and payment rules.</p><p className="mt-2 text-xs text-slate-300">New here? <a href="/login" target="_blank" rel="noreferrer" className="underline">Finish account setup</a> with this phone number to access your rewards. Booking and payment can continue now.</p></div> : <>
      <p className="mt-2 text-sm text-slate-300">{crew ? "Let the customer choose and enter their own verification code." : "Use your booking phone number to join or reconnect with JCMOVES rewards."} Payment is handled separately through the secure checkout provided for your order.</p>
      <label className="mt-2 flex min-h-12 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={chosen} disabled={busy} onChange={event => { setChosen(event.target.checked); setError(""); }} className="h-5 w-5 accent-orange-400" />{crew ? "Customer agrees to join rewards and receive a verification text" : "Join rewards and text me a verification code"}</label>
      {chosen && <div className="space-y-3">
        {contactPhone !== undefined ? <p className="text-sm text-slate-300">{phone ? `Booking phone: ${phone}` : "Enter your contact phone number above. We will use the same number for rewards."}</p> : <label className="block space-y-1 text-sm">Booking phone number<Input type="tel" inputMode="tel" autoComplete="tel" value={ownPhone} disabled={busy} onChange={event => setOwnPhone(event.target.value)} placeholder="(906) 285-9312" className="min-h-12 bg-slate-800 text-white" /></label>}
        <p className="text-xs text-slate-400">This requests one verification text, not marketing messages. Message and data rates may apply. <a className="underline" href="/privacy" target="_blank" rel="noreferrer">Privacy</a></p>
        {activeChallenge && <label className="block space-y-1 text-sm">Six-digit code<Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} className="min-h-12 bg-slate-800 text-white" /></label>}
        <div className="flex flex-wrap gap-2">
          {activeChallenge && <Button type="button" disabled={busy || code.length !== 6} onClick={verify} className="min-h-12">{busy ? "Please wait…" : "Verify & join"}</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={requestCode} className="min-h-12 border-slate-600 bg-slate-800 text-white">{busy ? "Please wait…" : activeChallenge ? "Send a new code" : "Text my code"}</Button>
        </div>
      </div>}
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
      <p className="mt-2 text-xs text-slate-400">You can continue your quote or payment without joining.</p>
    </>}
  </section>;
}

function readError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Please try again.";
  try { return JSON.parse(raw.replace(/^\d+:\s*/, "")).error || "Please try again."; } catch { return "Could not connect. Please retry or continue without rewards."; }
}
