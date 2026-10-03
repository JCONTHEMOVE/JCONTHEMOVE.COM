import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, Mail, Phone, KeyRound, CheckCircle, ArrowLeft, Eye, EyeOff } from "lucide-react";

type Step = "contact" | "verify" | "reset" | "done";

export default function ForgotAccessPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("contact");
  const [contact, setContact] = useState("");
  const [masked, setMasked] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact.trim()) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/recover/request", { contact: contact.trim() });
      const data = await res.json();
      if (data.success) {
        setMasked(data.masked);
        setStep("verify");
        toast({ title: "Check your email", description: data.message || "If an account matches, a recovery code will arrive by email." });
      } else {
        toast({ title: "Error", description: data.error || "Failed to send code", variant: "destructive" });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/recover/verify", { contact: contact.trim(), token: otp.trim() });
      const data = await res.json();
      if (data.success) {
        setResetToken(data.resetToken);
        setStep("reset");
      } else {
        toast({ title: "Invalid code", description: data.error || "The code is incorrect or expired.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Verification failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "Must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/recover/reset", { newPassword, resetToken });
      const data = await res.json();
      if (data.success) {
        setStep("done");
      } else {
        toast({ title: "Reset failed", description: data.error || "Please start over.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Password reset failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/">
            <h1 className="text-2xl font-black text-primary cursor-pointer">JC ON THE MOVE</h1>
          </Link>
          <p className="text-sm text-muted-foreground mt-1">Northwoods Moving & More</p>
        </div>

        <Card className="shadow-lg border-border">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-14 h-14 bg-blue-100 dark:bg-blue-950 rounded-full flex items-center justify-center mb-3">
              <Shield className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            </div>
            <CardTitle className="text-xl">
              {step === "contact" && "Recover Your Account"}
              {step === "verify" && "Enter Your Code"}
              {step === "reset" && "Set New Password"}
              {step === "done" && "All Done!"}
            </CardTitle>
            <CardDescription>
              {step === "contact" && "Enter your account email, or the phone number linked to it. Recovery codes are delivered by email."}
              {step === "verify" && `If an account matches, check ${masked} for a 6-digit code. It expires in 15 minutes.`}
              {step === "reset" && "Choose a new password to secure your account."}
              {step === "done" && "Your password has been reset. Your JCMOVES balance, job history, and profile are all safe."}
            </CardDescription>
          </CardHeader>

          <CardContent>

            {/* Step 1 — Enter email or phone */}
            {step === "contact" && (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="contact">Email address or phone number</Label>
                  <div className="relative">
                    {contact && /^[\d\s\-\+\(\)]{4,}$/.test(contact)
                      ? <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      : <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    }
                    <Input
                      id="contact"
                      type="text"
                      placeholder="Email or phone on your account"
                      value={contact}
                      onChange={e => setContact(e.target.value)}
                      className="pl-10"
                      autoFocus
                      required
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Codes arrive by email, not text. Check spam too. If you cannot access your account email, call (906) 285-9312.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={loading || !contact.trim()}>
                  {loading ? "Sending..." : "Send Recovery Code"}
                </Button>
                <div className="text-center">
                  <Link href="/login" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    <ArrowLeft className="inline h-3 w-3 mr-1" />Back to login
                  </Link>
                </div>
              </form>
            )}

            {/* Step 2 — Enter OTP */}
            {step === "verify" && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp">6-digit verification code</Label>
                  <Input
                    id="otp"
                    autoComplete="one-time-code"
                    type="text"
                    inputMode="numeric"
                    placeholder="123456"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="text-center text-2xl font-bold tracking-widest"
                    maxLength={6}
                    autoFocus
                    required
                  />
                  <p className="text-xs text-muted-foreground text-center">
                    Check your inbox and spam folder. Use the newest code.
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={loading || otp.length < 6}>
                  {loading ? "Verifying..." : "Verify Code"}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setStep("contact"); setOtp(""); }}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    <ArrowLeft className="inline h-3 w-3 mr-1" />Request a new code or change contact
                  </button>
                </div>
              </form>
            )}

            {/* Step 3 — Set new password */}
            {step === "reset" && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPass">New password</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="newPass"
                      autoComplete="new-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 6 characters"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="pl-10 pr-10"
                      autoFocus
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPass">Confirm new password</Label>
                  <Input
                    id="confirmPass"
                    autoComplete="new-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Same password again"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-destructive">Passwords don't match</p>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}
                >
                  {loading ? "Saving..." : "Save New Password"}
                </Button>
              </form>
            )}

            {/* Step 4 — Done */}
            {step === "done" && (
              <div className="text-center space-y-4">
                <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-950 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-9 w-9 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Your JCMOVES tokens, job history, and profile are exactly where you left them.
                </p>
                <Button className="w-full" onClick={() => navigate("/login")}>
                  Log In Now
                </Button>
                <Link href="/login">
                  <button className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    Customer login instead
                  </button>
                </Link>
              </div>
            )}

          </CardContent>
        </Card>

        {/* Security note */}
        {step !== "done" && (
          <p className="text-center text-xs text-muted-foreground mt-4">
            Your JCMOVES balance, job history, and profile are always protected.
          </p>
        )}

      </div>
    </div>
  );
}
