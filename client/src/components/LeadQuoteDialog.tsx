import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X, Users, Award, Pencil, Check, Zap, Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { type Lead, type User } from "@shared/schema";
import { z } from "zod";

const quoteFormSchema = z.object({
  status: z.string().min(1, "Status is required"),
  confirmedDate: z.string().min(1, "Date is required"),
  confirmedFromAddress: z.string().min(1, "From address is required"),
  confirmedToAddress: z.string().min(1, "To address is required"),
  basePrice: z.string().min(1, "Base price is required"),
  tokenAllocation: z.string().min(1, "Token allocation is required"),
  crewMembers: z.array(z.string()).min(1, "At least one crew member is required"),
  hasHotTub: z.boolean(),
  hotTubWeight: z.number().optional(),
  hasHeavySafe: z.boolean(),
  heavySafeWeight: z.number().optional(),
  hasPoolTable: z.boolean(),
  poolTableWeight: z.number().optional(),
  hasPiano: z.boolean(),
  pianoWeight: z.number().optional(),
  quoteNotes: z.string().optional(),
});

type QuoteFormData = z.infer<typeof quoteFormSchema>;

interface LeadQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  employees: User[];
  onSave: (data: QuoteFormData & { crewMembers: string[] }) => void;
}

export function LeadQuoteDialog({ open, onOpenChange, lead, employees, onSave }: LeadQuoteDialogProps) {
  const { toast } = useToast();
  const [selectedCrewMembers, setSelectedCrewMembers] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [dispatchNotesDraft, setDispatchNotesDraft] = useState("");
  const [dispatchResult, setDispatchResult] = useState<{ sentCount: number; failedCount: number; results: any[] } | null>(null);

  const saveFieldMutation = useMutation({
    mutationFn: async (updates: Record<string, string>) => {
      if (!lead) return;
      const res = await apiRequest("PATCH", `/api/leads/${lead.id}/contact`, updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Updated successfully" });
      setEditingField(null);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      if (!lead) throw new Error("No lead selected");
      const res = await apiRequest("POST", `/api/admin/leads/${lead.id}/dispatch`, {
        dispatchNotes: dispatchNotesDraft,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Dispatch failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setDispatchResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/schedule"] });
      if (data.sentCount > 0) {
        toast({ title: `✅ Emails sent to ${data.sentCount} crew member${data.sentCount !== 1 ? "s" : ""}` });
      } else {
        toast({ title: "No emails sent", description: "Check that crew members have emails on file.", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Dispatch failed", description: err.message, variant: "destructive" });
    },
  });

  const quoteForm = useForm<QuoteFormData>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: {
      status: "",
      confirmedDate: "",
      confirmedFromAddress: "",
      confirmedToAddress: "",
      basePrice: "",
      tokenAllocation: "",
      crewMembers: [],
      hasHotTub: false,
      hotTubWeight: undefined,
      hasHeavySafe: false,
      heavySafeWeight: undefined,
      hasPoolTable: false,
      poolTableWeight: undefined,
      hasPiano: false,
      pianoWeight: undefined,
      quoteNotes: "",
    },
  });

  // Watch form values for calculations
  const watchedValues = quoteForm.watch();
  const basePrice = parseFloat(watchedValues.basePrice) || 0;
  const tokenAllocation = parseFloat(watchedValues.tokenAllocation) || 0;
  const tokensPerWorker = selectedCrewMembers.length > 0 ? tokenAllocation / selectedCrewMembers.length : 0;

  // Calculate heavy item fee: $200 base + $150 per 100 lbs (max 1000 lbs)
  const calculateHeavyItemFee = (weight: number | undefined): number => {
    if (!weight || weight <= 0) return 0;
    const cappedWeight = Math.min(weight, 1000);
    const hundredPounds = Math.floor(cappedWeight / 100);
    return 200 + (hundredPounds * 150);
  };

  const hotTubFee = watchedValues.hasHotTub ? calculateHeavyItemFee(watchedValues.hotTubWeight) : 0;
  const heavySafeFee = watchedValues.hasHeavySafe ? calculateHeavyItemFee(watchedValues.heavySafeWeight) : 0;
  const poolTableFee = watchedValues.hasPoolTable ? calculateHeavyItemFee(watchedValues.poolTableWeight) : 0;
  const pianoFee = watchedValues.hasPiano ? calculateHeavyItemFee(watchedValues.pianoWeight) : 0;

  const totalSpecialItemsFee = hotTubFee + heavySafeFee + poolTableFee + pianoFee;
  const totalPrice = basePrice + totalSpecialItemsFee;

  // Update form when lead is selected or dialog opens
  useEffect(() => {
    if (lead && open) {
      quoteForm.reset({
        status: lead.status || "",
        confirmedDate: lead.confirmedDate || "",
        confirmedFromAddress: lead.confirmedFromAddress || lead.fromAddress,
        confirmedToAddress: lead.confirmedToAddress || lead.toAddress || "",
        basePrice: lead.basePrice?.toString() || "",
        tokenAllocation: lead.tokenAllocation?.toString() || "",
        crewMembers: lead.crewMembers || [],
        hasHotTub: lead.hasHotTub || false,
        hotTubWeight: lead.hotTubWeight || undefined,
        hasHeavySafe: lead.hasHeavySafe || false,
        heavySafeWeight: lead.heavySafeWeight || undefined,
        hasPoolTable: lead.hasPoolTable || false,
        poolTableWeight: lead.poolTableWeight || undefined,
        hasPiano: lead.hasPiano || false,
        pianoWeight: lead.pianoWeight || undefined,
        quoteNotes: lead.quoteNotes || "",
      });
      setSelectedCrewMembers(lead.crewMembers || []);
      setSelectedStatus(lead.status || "");
      setDispatchNotesDraft((lead as any).dispatchNotes || "");
      setDispatchResult(null);
    }
  }, [lead, open, quoteForm]);

  const toggleCrewMember = (employeeId: string) => {
    setSelectedCrewMembers(prev => {
      const updated = prev.includes(employeeId) 
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId];
      quoteForm.setValue("crewMembers", updated);
      return updated;
    });
  };

  const onQuoteSubmit = quoteForm.handleSubmit((data) => {
    onSave({
      ...data,
      crewMembers: selectedCrewMembers,
    });
  });

  const getServiceBadgeColor = (serviceType: string) => {
    switch (serviceType) {
      case "residential": return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200";
      case "commercial": return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200";
      case "junk": return "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200";
      default: return "bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200";
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "new": return "default";
      case "contacted": return "secondary";
      case "quoted": return "secondary";
      case "confirmed": return "default";
      default: return "secondary";
    }
  };

  // Fetch created by user from API
  const { data: createdByUser } = useQuery<User>({
    queryKey: ["/api/users", lead?.createdByUserId],
    enabled: !!lead?.createdByUserId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-lead-details">
        <DialogHeader>
          <DialogTitle data-testid="dialog-title">Lead Details & Quote</DialogTitle>
          <DialogDescription>
            View customer information and create/edit quote
          </DialogDescription>
        </DialogHeader>

        {lead && (
          <div className="space-y-6">
            {/* Customer Information Section */}
            <div>
              <h3 className="text-xl font-semibold mb-4" data-testid="text-customer-details-title">Customer Information</h3>
              <div className="space-y-4">
                <div>
                  <Label className="text-sm text-muted-foreground">Name</Label>
                  {editingField === "name" ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        value={editFirstName}
                        onChange={e => setEditFirstName(e.target.value)}
                        placeholder="First"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={editLastName}
                        onChange={e => setEditLastName(e.target.value)}
                        placeholder="Last"
                        className="h-8 text-sm"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-green-500"
                        disabled={saveFieldMutation.isPending}
                        onClick={() => saveFieldMutation.mutate({ firstName: editFirstName, lastName: editLastName })}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditingField(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-base font-normal" data-testid="text-customer-name">
                        {lead.firstName} {lead.lastName}
                      </p>
                      <button
                        onClick={() => { setEditFirstName(lead.firstName); setEditLastName(lead.lastName); setEditingField("name"); }}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Email</Label>
                  <p className="text-base font-normal" data-testid="text-customer-email">{lead.email}</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Phone</Label>
                  {editingField === "phone" ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        type="tel" legacyPhoneValue={lead.phone} value={editPhone}
                        onChange={e => setEditPhone(e.target.value)}
                        placeholder="Phone number"
                        className="h-8 text-sm flex-1"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-green-500"
                        disabled={saveFieldMutation.isPending}
                        onClick={() => saveFieldMutation.mutate({ phone: editPhone })}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditingField(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-base font-normal" data-testid="text-customer-phone">{lead.phone}</p>
                      <button
                        onClick={() => { setEditPhone(lead.phone); setEditingField("phone"); }}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Service Type</Label>
                  <p className="text-base font-normal" data-testid="badge-service-type">
                    {lead.serviceType === "residential" && "Residential"}
                    {lead.serviceType === "commercial" && "Commercial"}
                    {lead.serviceType === "junk" && "Junk Removal"}
                  </p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">From Address</Label>
                  <p className="text-base font-normal" data-testid="text-from-address">{lead.fromAddress}</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">To Address</Label>
                  <p className="text-base font-normal" data-testid="text-to-address">{lead.toAddress || "Not specified"}</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Requested Move Date</Label>
                  <p className="text-base font-normal" data-testid="text-move-date">{lead.moveDate || "Not specified"}</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Property Size</Label>
                  <p className="text-base font-normal" data-testid="text-property-size">{lead.propertySize || "Not specified"}</p>
                </div>
                <div>
                  <Label className="text-sm text-muted-foreground">Status</Label>
                  <Select
                    value={selectedStatus}
                    onValueChange={(value) => {
                      setSelectedStatus(value);
                      quoteForm.setValue("status", value);
                    }}
                  >
                    <SelectTrigger className="w-[180px]" data-testid="select-status-badge">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quote_requested" data-testid="option-status-quote-requested">
                        Quote Requested
                      </SelectItem>
                      <SelectItem value="available" data-testid="option-status-available">
                        Job Available
                      </SelectItem>
                      <SelectItem value="completed" data-testid="option-status-completed">
                        Completed
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {lead.createdByUserId && (
                  <div>
                    <Label className="text-sm text-muted-foreground">Created By</Label>
                    <p className="text-base font-normal" data-testid="text-created-by">
                      {createdByUser ? `${createdByUser.firstName} ${createdByUser.lastName}` : "Loading..."}
                    </p>
                  </div>
                )}
                {lead.details && (
                  <div>
                    <Label className="text-sm text-muted-foreground">Additional Details</Label>
                    <p className="text-base font-normal" data-testid="text-additional-details">{lead.details}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Edit Quote Section */}
            <form onSubmit={onQuoteSubmit} className="space-y-6">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2" data-testid="text-edit-quote-title">
                <Award className="h-5 w-5" />
                Job Management
              </h3>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="basePrice">Base Price ($)</Label>
                    <Input
                      id="basePrice"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      {...quoteForm.register("basePrice")}
                      data-testid="input-base-price"
                      className="mt-1"
                    />
                    {quoteForm.formState.errors.basePrice && (
                      <p className="text-destructive text-sm mt-1" data-testid="error-base-price">
                        {quoteForm.formState.errors.basePrice.message}
                      </p>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="tokenAllocation">JCMOVES Tokens</Label>
                    <Input
                      id="tokenAllocation"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      {...quoteForm.register("tokenAllocation")}
                      data-testid="input-token-allocation"
                      className="mt-1"
                    />
                    {quoteForm.formState.errors.tokenAllocation && (
                      <p className="text-destructive text-sm mt-1" data-testid="error-token-allocation">
                        {quoteForm.formState.errors.tokenAllocation.message}
                      </p>
                    )}
                  </div>
                </div>

                {basePrice > 0 && (() => {
                  const customerTokens = Math.round(totalPrice * 15);
                  const workerPool = Math.round(totalPrice * 15);
                  const crewCount = selectedCrewMembers.length;
                  const perWorker = crewCount > 0 ? Math.round(workerPool / crewCount) : workerPool;
                  return (
                    <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/25 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500/70 flex items-center gap-1.5">
                        <Zap className="h-3 w-3" />
                        $1 = 15 JCMOVES · Auto-conversion on ${totalPrice.toFixed(2)}
                      </p>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400">Customer earns on completion</span>
                          <span className="font-bold text-amber-400">~{customerTokens.toLocaleString()} JCMOVES</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400">
                            Worker pool {crewCount > 0 ? `(÷${crewCount} = ~${perWorker.toLocaleString()} each)` : ""}
                          </span>
                          <span className="font-bold text-orange-400">~{workerPool.toLocaleString()} JCMOVES</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {basePrice === 0 && (
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-amber-500/50" />
                      Enter a base price above to see the $1 = 15 JCMOVES token conversion
                    </p>
                  </div>
                )}

                <div>
                  <Label className="text-sm text-muted-foreground">Confirmed Move Date</Label>
                  <div className="mt-1">
                    <DatePicker
                      value={quoteForm.watch("confirmedDate") || undefined}
                      onChange={(v) => quoteForm.setValue("confirmedDate", v)}
                      placeholder="Pick a confirmed date"
                    />
                  </div>
                  {quoteForm.formState.errors.confirmedDate && (
                    <p className="text-destructive text-sm mt-1" data-testid="error-confirmed-date">
                      {quoteForm.formState.errors.confirmedDate.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="confirmedFromAddress" className="text-sm text-muted-foreground">Confirmed Pickup Address</Label>
                  <Input
                    id="confirmedFromAddress"
                    placeholder="Pickup address"
                    {...quoteForm.register("confirmedFromAddress")}
                    data-testid="input-confirmed-from-address"
                    className="mt-1"
                  />
                  {quoteForm.formState.errors.confirmedFromAddress && (
                    <p className="text-destructive text-sm mt-1" data-testid="error-confirmed-from-address">
                      {quoteForm.formState.errors.confirmedFromAddress.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="confirmedToAddress" className="text-sm text-muted-foreground">Confirmed Delivery Address</Label>
                  <Input
                    id="confirmedToAddress"
                    placeholder="Delivery address"
                    {...quoteForm.register("confirmedToAddress")}
                    data-testid="input-confirmed-to-address"
                    className="mt-1"
                  />
                  {quoteForm.formState.errors.confirmedToAddress && (
                    <p className="text-destructive text-sm mt-1" data-testid="error-confirmed-to-address">
                      {quoteForm.formState.errors.confirmedToAddress.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Crew Members Selection */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4" />
                  Crew Members *
                </Label>
                <div className="border border-border rounded-lg p-4 space-y-2 max-h-48 overflow-y-auto" data-testid="crew-members-list">
                  {employees.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Loading employees...</p>
                  ) : (
                    employees.map((employee) => (
                      <div key={employee.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`crew-${employee.id}`}
                          checked={selectedCrewMembers.includes(employee.id)}
                          onCheckedChange={() => toggleCrewMember(employee.id)}
                          data-testid={`checkbox-crew-${employee.id}`}
                        />
                        <label
                          htmlFor={`crew-${employee.id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {employee.firstName} {employee.lastName}
                        </label>
                      </div>
                    ))
                  )}
                </div>
                {selectedCrewMembers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2" data-testid="selected-crew-members">
                    {selectedCrewMembers.map((memberId) => {
                      const employee = employees.find(e => e.id === memberId);
                      return employee ? (
                        <Badge key={memberId} variant="secondary" className="flex items-center gap-1">
                          {employee.firstName} {employee.lastName}
                          <X
                            className="h-3 w-3 cursor-pointer"
                            onClick={() => toggleCrewMember(memberId)}
                          />
                        </Badge>
                      ) : null;
                    })}
                  </div>
                )}
                {quoteForm.formState.errors.crewMembers && (
                  <p className="text-destructive text-sm mt-1" data-testid="error-crew-members">
                    {quoteForm.formState.errors.crewMembers.message}
                  </p>
                )}
                {selectedCrewMembers.length > 0 && (
                  <div className="p-2 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg mt-2">
                    <p className="text-xs font-semibold text-green-800 dark:text-green-200">
                      ✅ {selectedCrewMembers.length} worker{selectedCrewMembers.length > 1 ? 's' : ''} assigned
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Each worker will earn: {tokensPerWorker.toFixed(2)} JCMOVES
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              {/* Special Moving Items */}
              <div>
                <h4 className="font-semibold mb-4" data-testid="text-special-items-title">
                  Special Moving Items
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ($200 base + $150 per 100 lbs, max 1000 lbs)
                  </span>
                </h4>

                <div className="space-y-4">
                  {/* Hot Tub */}
                  <div className="flex items-start gap-4">
                    <Checkbox
                      id="hasHotTub"
                      checked={watchedValues.hasHotTub}
                      onCheckedChange={(checked) => quoteForm.setValue("hasHotTub", checked as boolean)}
                      data-testid="checkbox-hot-tub"
                    />
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Label htmlFor="hasHotTub" className="font-medium cursor-pointer">
                        Hot Tub
                      </Label>
                      {watchedValues.hasHotTub && (
                        <div>
                          <Input
                            type="number"
                            placeholder="Weight in lbs"
                            {...quoteForm.register("hotTubWeight", { valueAsNumber: true })}
                            data-testid="input-hot-tub-weight"
                          />
                          <p className="text-sm text-muted-foreground mt-1" data-testid="text-hot-tub-fee">
                            Fee: ${hotTubFee.toFixed(2)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Heavy Safe */}
                  <div className="flex items-start gap-4">
                    <Checkbox
                      id="hasHeavySafe"
                      checked={watchedValues.hasHeavySafe}
                      onCheckedChange={(checked) => quoteForm.setValue("hasHeavySafe", checked as boolean)}
                      data-testid="checkbox-heavy-safe"
                    />
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Label htmlFor="hasHeavySafe" className="font-medium cursor-pointer">
                        Heavy Safe
                      </Label>
                      {watchedValues.hasHeavySafe && (
                        <div>
                          <Input
                            type="number"
                            placeholder="Weight in lbs"
                            {...quoteForm.register("heavySafeWeight", { valueAsNumber: true })}
                            data-testid="input-heavy-safe-weight"
                          />
                          <p className="text-sm text-muted-foreground mt-1" data-testid="text-heavy-safe-fee">
                            Fee: ${heavySafeFee.toFixed(2)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pool Table */}
                  <div className="flex items-start gap-4">
                    <Checkbox
                      id="hasPoolTable"
                      checked={watchedValues.hasPoolTable}
                      onCheckedChange={(checked) => quoteForm.setValue("hasPoolTable", checked as boolean)}
                      data-testid="checkbox-pool-table"
                    />
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Label htmlFor="hasPoolTable" className="font-medium cursor-pointer">
                        Pool Table
                      </Label>
                      {watchedValues.hasPoolTable && (
                        <div>
                          <Input
                            type="number"
                            placeholder="Weight in lbs"
                            {...quoteForm.register("poolTableWeight", { valueAsNumber: true })}
                            data-testid="input-pool-table-weight"
                          />
                          <p className="text-sm text-muted-foreground mt-1" data-testid="text-pool-table-fee">
                            Fee: ${poolTableFee.toFixed(2)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Piano */}
                  <div className="flex items-start gap-4">
                    <Checkbox
                      id="hasPiano"
                      checked={watchedValues.hasPiano}
                      onCheckedChange={(checked) => quoteForm.setValue("hasPiano", checked as boolean)}
                      data-testid="checkbox-piano"
                    />
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Label htmlFor="hasPiano" className="font-medium cursor-pointer">
                        Piano
                      </Label>
                      {watchedValues.hasPiano && (
                        <div>
                          <Input
                            type="number"
                            placeholder="Weight in lbs"
                            {...quoteForm.register("pianoWeight", { valueAsNumber: true })}
                            data-testid="input-piano-weight"
                          />
                          <p className="text-sm text-muted-foreground mt-1" data-testid="text-piano-fee">
                            Fee: ${pianoFee.toFixed(2)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Price Summary */}
              <div className="bg-primary/5 dark:bg-primary/10 p-4 rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Base Price:</span>
                  <span className="font-semibold" data-testid="text-summary-base-price">${basePrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total Special Items Fee:</span>
                  <span className="font-semibold" data-testid="text-summary-special-items-fee">${totalSpecialItemsFee.toFixed(2)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total Price:</span>
                  <span className="text-primary" data-testid="text-summary-total-price">${totalPrice.toFixed(2)}</span>
                </div>
              </div>

              {/* Quote Notes */}
              <div>
                <Label htmlFor="quoteNotes" className="text-sm text-muted-foreground">Quote Notes</Label>
                <Textarea
                  id="quoteNotes"
                  placeholder="Add any project-specific notes, updates, or special instructions..."
                  rows={4}
                  {...quoteForm.register("quoteNotes")}
                  data-testid="textarea-quote-notes"
                  className="mt-1"
                />
              </div>

              {/* Crew Dispatch Section */}
              <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50 dark:bg-blue-950/30 space-y-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="font-semibold text-sm text-blue-900 dark:text-blue-100">Dispatch Crew Emails</span>
                  {(lead as any)?.dispatchSentAt && !dispatchResult && (
                    <span className="ml-auto text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Last sent {new Date((lead as any).dispatchSentAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Sends each assigned crew member an email with the job date, city/state, customer first name, service type, estimated hours, and pay — no full address or last name shared.
                </p>
                <div>
                  <Label className="text-xs font-medium text-blue-800 dark:text-blue-200">Notes for workers (optional)</Label>
                  <Textarea
                    placeholder="e.g. Park in the back, bring extra dollies, customer has fragile antiques..."
                    rows={2}
                    value={dispatchNotesDraft}
                    onChange={e => setDispatchNotesDraft(e.target.value)}
                    className="mt-1 text-sm"
                  />
                </div>
                {dispatchResult && (
                  <div className="space-y-1">
                    {dispatchResult.results.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        {r.sent
                          ? <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                          : <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />}
                        <span className="font-medium">{r.name}</span>
                        {r.email && <span className="text-muted-foreground">{r.email}</span>}
                        {!r.sent && r.error && <span className="text-red-500">{r.error}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="default"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={dispatchMutation.isPending || !selectedCrewMembers.length}
                  onClick={() => dispatchMutation.mutate()}
                  data-testid="button-dispatch-crew"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  {dispatchMutation.isPending
                    ? "Sending..."
                    : dispatchResult
                    ? `Resend to ${selectedCrewMembers.length} Crew Member${selectedCrewMembers.length !== 1 ? "s" : ""}`
                    : selectedCrewMembers.length === 0
                    ? "Assign Crew First"
                    : `Send Job Details to ${selectedCrewMembers.length} Crew Member${selectedCrewMembers.length !== 1 ? "s" : ""}`}
                </Button>
              </div>

              <div className="flex gap-4 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel-quote"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-testid="button-save-quote"
                >
                  Save Quote
                </Button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
