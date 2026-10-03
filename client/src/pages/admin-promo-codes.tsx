import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { PersonalPromoRequests } from "@/components/PersonalPromoRequests";
import {
  ArrowLeft, Tag, Plus, Edit2, Trash2, Loader2, CheckCircle2, XCircle,
  Coins, Percent, Calendar, Users, BarChart3, Copy, RefreshCw
} from "lucide-react";

interface PromoCode {
  id: string;
  code: string;
  description: string;
  discountPercent: string;
  discountPercentJewelry: string;
  rewardTokens: string;
  referralUserId: string | null;
  referralRewardTokens: string;
  jobOffer?: {
    kind?: string;
    fixedBasePrice?: number;
    requiredCrewSize?: number;
    requiredHours?: number;
    localMilesMax?: number;
    requiresCompanyTruck?: boolean;
    requiresTrailer?: boolean;
  } | null;
  maxUses: number | null;
  usesCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const emptyForm = {
  code: "",
  description: "",
  discountPercent: "0",
  discountPercentJewelry: "0",
  rewardTokens: "0",
  referralUserId: "",
  referralRewardTokens: "0",
  maxUses: "",
  isActive: true,
  expiresAt: "",
};

export default function AdminPromoCodesPage() {
  const { hasAdminAccess } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingCode, setEditingCode] = useState<PromoCode | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: codes, isLoading } = useQuery<PromoCode[]>({
    queryKey: ["/api/admin/promo-codes"],
    enabled: !!hasAdminAccess,
  });

  const { data: staffUsers } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    enabled: !!hasAdminAccess,
    select: (users) => (users || []).filter((u: any) =>
      ['admin', 'business_owner', 'employee'].includes(u.role) &&
      ['approved', 'active'].includes(u.status)
    ),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/promo-codes", data).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Promo code created!" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] });
      setShowForm(false);
      setForm({ ...emptyForm });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest("PATCH", `/api/admin/promo-codes/${id}`, data).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Promo code updated!" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] });
      setEditingCode(null);
      setShowForm(false);
      setForm({ ...emptyForm });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/promo-codes/${id}`).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Promo code deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] });
      setDeleteId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/promo-codes/${id}`, { isActive }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/promo-codes"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openEdit = (code: PromoCode) => {
    setEditingCode(code);
    setForm({
      code: code.code,
      description: code.description,
      discountPercent: code.discountPercent,
      discountPercentJewelry: code.discountPercentJewelry,
      rewardTokens: code.rewardTokens,
      referralUserId: code.referralUserId || "",
      referralRewardTokens: code.referralRewardTokens,
      maxUses: code.maxUses?.toString() || "",
      isActive: code.isActive,
      expiresAt: code.expiresAt ? code.expiresAt.slice(0, 16) : "",
    });
    setShowForm(true);
  };

  const openCreate = () => {
    setEditingCode(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const handleSubmit = () => {
    const payload: any = {
      code: form.code.toUpperCase().trim(),
      description: form.description,
      discountPercent: form.discountPercent || "0",
      discountPercentJewelry: form.discountPercentJewelry || "0",
      rewardTokens: form.rewardTokens || "0",
      referralUserId: form.referralUserId || null,
      referralRewardTokens: form.referralRewardTokens || "0",
      maxUses: form.maxUses ? parseInt(form.maxUses) : null,
      isActive: form.isActive,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    };

    if (!payload.code) {
      toast({ title: "Code is required", variant: "destructive" });
      return;
    }

    if (editingCode) {
      updateMutation.mutate({ id: editingCode.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Copied!", description: `${code} copied to clipboard` });
  };

  const totalUses = codes?.reduce((sum, c) => sum + c.usesCount, 0) || 0;
  const activeCodes = codes?.filter(c => c.isActive).length || 0;

  if (!hasAdminAccess) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-white">Access denied</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <Link href="/dashboard">
          <Button variant="ghost" className="text-white hover:bg-white/10 mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Tag className="h-7 w-7 text-green-400" />
              Promo Codes
            </h1>
            <p className="text-slate-400 text-sm mt-1">Create and manage marketing & referral codes</p>
          </div>
          <Button onClick={openCreate} className="bg-green-600 hover:bg-green-700 text-white">
            <Plus className="h-4 w-4 mr-2" />
            New Code
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="bg-slate-800/80 border-slate-600">
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold text-white">{codes?.length || 0}</p>
              <p className="text-xs text-slate-400">Total Codes</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/80 border-slate-600">
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold text-green-400">{activeCodes}</p>
              <p className="text-xs text-slate-400">Active</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/80 border-slate-600">
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold text-orange-400">{totalUses}</p>
              <p className="text-xs text-slate-400">Total Uses</p>
            </CardContent>
          </Card>
        </div>

        <PersonalPromoRequests enabled={Boolean(hasAdminAccess)} />

        {/* Codes List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
          </div>
        ) : codes?.length === 0 ? (
          <Card className="bg-slate-800/80 border-slate-600">
            <CardContent className="py-12 text-center">
              <Tag className="h-12 w-12 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-400">No promo codes yet. Create your first one!</p>
              <Button onClick={openCreate} className="mt-4 bg-green-600 hover:bg-green-700">
                <Plus className="h-4 w-4 mr-2" />
                Create Code
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {codes?.map((code) => (
              <Card key={code.id} className={`border ${code.isActive ? "bg-slate-800/80 border-slate-600" : "bg-slate-900/60 border-slate-700 opacity-60"}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <button
                          onClick={() => copyCode(code.code)}
                          className="flex items-center gap-1.5 font-mono font-bold text-lg text-green-300 hover:text-green-200 transition-colors"
                        >
                          {code.code}
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <Badge variant={code.isActive ? "default" : "secondary"} className={code.isActive ? "bg-green-700/50 text-green-300 border-green-600" : ""}>
                          {code.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {code.expiresAt && new Date(code.expiresAt) < new Date() && (
                          <Badge variant="destructive" className="text-xs">Expired</Badge>
                        )}
                      </div>
                      <p className="text-slate-400 text-sm mb-2 truncate">{code.description}</p>

                      {code.jobOffer?.kind === "fixed_moving_package" && (
                        <p className="mb-2 text-xs font-medium text-emerald-300">
                          Fixed package: {code.jobOffer.requiredCrewSize} movers x {code.jobOffer.requiredHours} hours · ${code.jobOffer.fixedBasePrice} · local within {code.jobOffer.localMilesMax ?? 10} miles · truck + trailer included
                        </p>
                      )}

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                        {parseFloat(code.discountPercent) > 0 && (
                          <span className="flex items-center gap-1 text-blue-400">
                            <Percent className="h-3 w-3" />
                            {code.discountPercent}% off services
                          </span>
                        )}
                        {parseFloat(code.discountPercentJewelry) > 0 && (
                          <span className="flex items-center gap-1 text-purple-400">
                            <Percent className="h-3 w-3" />
                            {code.discountPercentJewelry}% off jewelry
                          </span>
                        )}
                        {parseFloat(code.rewardTokens) > 0 && (
                          <span className="flex items-center gap-1 text-orange-400">
                            <Coins className="h-3 w-3" />
                            {code.rewardTokens} tokens to customer
                          </span>
                        )}
                        {parseFloat(code.referralRewardTokens) > 0 && (
                          <span className="flex items-center gap-1 text-yellow-400">
                            <Users className="h-3 w-3" />
                            {code.referralRewardTokens} tokens to referrer
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <BarChart3 className="h-3 w-3" />
                          {code.usesCount} use{code.usesCount !== 1 ? "s" : ""}{code.maxUses ? ` / ${code.maxUses} max` : ""}
                        </span>
                        {code.expiresAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Expires {new Date(code.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={code.isActive}
                        onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: code.id, isActive: checked })}
                        className="data-[state=checked]:bg-green-600"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(code)}
                        className="text-slate-400 hover:text-white hover:bg-slate-700"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteId(code.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create / Edit Dialog */}
        <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditingCode(null); setForm({ ...emptyForm }); } }}>
          <DialogContent className="bg-slate-800 border-slate-600 text-white max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Tag className="h-5 w-5 text-green-400" />
                {editingCode ? "Edit Promo Code" : "Create Promo Code"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <Label className="text-slate-200">Code *</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. SUMMER25"
                  className="bg-slate-700 border-slate-600 text-white font-mono uppercase"
                  disabled={!!editingCode}
                />
              </div>

              <div>
                <Label className="text-slate-200">Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What does this code offer?"
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-200 flex items-center gap-1">
                    <Percent className="h-3 w-3 text-blue-400" />
                    Service Discount %
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.discountPercent}
                    onChange={(e) => setForm(f => ({ ...f, discountPercent: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">% off moving/service orders</p>
                </div>
                <div>
                  <Label className="text-slate-200 flex items-center gap-1">
                    <Percent className="h-3 w-3 text-purple-400" />
                    Jewelry Discount %
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.discountPercentJewelry}
                    onChange={(e) => setForm(f => ({ ...f, discountPercentJewelry: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">% off jewelry/shop orders</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-200 flex items-center gap-1">
                    <Coins className="h-3 w-3 text-orange-400" />
                    Customer Token Reward
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.rewardTokens}
                    onChange={(e) => setForm(f => ({ ...f, rewardTokens: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">JCMOVES tokens to customer</p>
                </div>
                <div>
                  <Label className="text-slate-200 flex items-center gap-1">
                    <Users className="h-3 w-3 text-yellow-400" />
                    Referrer Token Reward
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.referralRewardTokens}
                    onChange={(e) => setForm(f => ({ ...f, referralRewardTokens: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">JCMOVES tokens to code owner</p>
                </div>
              </div>

              <div>
                <Label className="text-slate-200">Referrer (optional)</Label>
                <Select
                  value={form.referralUserId || "__none__"}
                  onValueChange={(val) => setForm(f => ({ ...f, referralUserId: val === "__none__" ? "" : val }))}
                >
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                    <SelectValue placeholder="Select employee or admin..." />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    <SelectItem value="__none__" className="text-slate-400">— No referrer —</SelectItem>
                    {(staffUsers || []).map((u: any) => (
                      <SelectItem key={u.id} value={u.id} className="text-white">
                        {u.firstName} {u.lastName}
                        <span className="ml-2 text-xs text-slate-400 capitalize">({u.role.replace('_', ' ')})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 mt-1">This person earns the referrer reward every time the code is used</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-200">Max Uses (leave empty = unlimited)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={form.maxUses}
                    onChange={(e) => setForm(f => ({ ...f, maxUses: e.target.value }))}
                    placeholder="Unlimited"
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
                <div>
                  <Label className="text-slate-200 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Expiry Date (optional)
                  </Label>
                  <Input
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(e) => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-slate-200">Active</p>
                  <p className="text-xs text-slate-400">Code can be used by customers</p>
                </div>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(checked) => setForm(f => ({ ...f, isActive: checked }))}
                  className="data-[state=checked]:bg-green-600"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setShowForm(false); setEditingCode(null); setForm({ ...emptyForm }); }} className="border-slate-600 text-slate-300">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Tag className="h-4 w-4 mr-2" />
                )}
                {editingCode ? "Save Changes" : "Create Code"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm Dialog */}
        <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <DialogContent className="bg-slate-800 border-slate-600 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-white">Delete Promo Code?</DialogTitle>
            </DialogHeader>
            <p className="text-slate-400 text-sm">This action cannot be undone. All usage history will be lost.</p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteId(null)} className="border-slate-600 text-slate-300">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
