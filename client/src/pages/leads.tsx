import { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Home, Building, Trash2, Mail, Phone, MapPin, Calendar as CalendarIcon, ChevronRight, Coins, TrendingUp, CheckCheck, Search, X, Square, CheckSquare, Settings, Archive, ArchiveRestore } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { formatOrderNumber } from "@shared/schema";
import { getStatusColors } from "@/lib/job-status";
import { JobCard } from "@/components/JobCard";
import { calculateJCMovesReward, LOYALTY_TIERS, formatTokens, type LoyaltyTierKey } from "@/lib/loyalty";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PlacesAutocomplete } from "@/components/places-autocomplete";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { insertLeadSchema, type InsertLead, type Lead, type User } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { LeadQuoteDialog } from "@/components/LeadQuoteDialog";
import { StaffJobForm } from "@/components/StaffJobForm";
import { LeadCleanupPanel } from "@/components/LeadCleanupPanel";

export default function LeadsPage() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isStaff = ["admin", "business_owner", "employee"].includes(currentUser?.role || "");
  const [estimatedBudget, setEstimatedBudget] = useState("");
  const [bookingConfirmed, setBookingConfirmed] = useState<{ tokens: number; tier: LoyaltyTierKey; orderNumber?: number | null } | null>(null);

  const userTier = ((currentUser as any)?.loyaltyTier || 'bronze') as LoyaltyTierKey;
  const estimatedTokens = useMemo(() => {
    const val = parseFloat(estimatedBudget);
    if (!val || val <= 0) return 0;
    return calculateJCMovesReward(val, userTier);
  }, [estimatedBudget, userTier]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);
  const [isManageDialogOpen, setIsManageDialogOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const isAdmin = ["admin", "business_owner"].includes(currentUser?.role || "");
  const requestedTab = new URLSearchParams(location.split("?")[1] || "").get("tab");
  const requestedDate = new URLSearchParams(location.split("?")[1] || "").get("date") || undefined;
  const [activeTab, setActiveTab] = useState(requestedTab === "add" || (requestedTab === "cleanup" && isAdmin) ? requestedTab : "view");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  const [lookupResult, setLookupResult] = useState<Lead | null>(null);
  const [lookupError, setLookupError] = useState("");

  useEffect(() => {
    if (requestedTab === "add" || (requestedTab === "cleanup" && isAdmin)) setActiveTab(requestedTab);
  }, [requestedTab, isAdmin]);

  const serviceOptions = [
    { value: "residential", label: "Residential Moving", icon: Home },
    { value: "commercial", label: "Commercial Moving", icon: Building },
    { value: "junk", label: "Junk Removal", icon: Trash2 },
  ];

  // Fetch all active leads (excludes archived)
  const { data: leads = [], isLoading, isError, refetch: refetchLeads } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    staleTime: 0,
    refetchOnMount: true,
    retry: 2,
  });

  // Fetch archived leads (admin only, lazy)
  const { data: archivedLeads = [], isLoading: isLoadingArchived } = useQuery<Lead[]>({
    queryKey: ["/api/leads/archived"],
    staleTime: 30000,
    enabled: isAdmin,
  });

  // Order number / email lookup
  const orderLookup = useMutation({
    mutationFn: async (q: string) => {
      const response = await apiRequest("GET", `/api/leads/lookup?q=${encodeURIComponent(q)}`);
      return response.json();
    },
    onSuccess: (data: Lead) => {
      setLookupResult(data);
      setLookupError("");
    },
    onError: () => {
      setLookupResult(null);
      setLookupError("No job found. Try the order number (JC-000001) or the customer's email address.");
    },
  });

  const handleOrderSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderSearch.trim()) return;
    setLookupError("");
    setLookupResult(null);
    orderLookup.mutate(orderSearch.trim());
  };

  // Fetch employees
  const { data: employees = [] } = useQuery<User[]>({
    queryKey: ["/api/employees"],
    enabled: isManageDialogOpen,
  });

  // Find created by user from employees list
  const createdByUser = employees.find(emp => emp.id === selectedLead?.createdByUserId);

  const form = useForm<InsertLead>({
    resolver: zodResolver(insertLeadSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      serviceType: "",
      fromAddress: "",
      toAddress: "",
      moveDate: "",
      propertySize: "",
      details: "",
    },
  });

  const submitLead = useMutation({
    mutationFn: async (data: InsertLead) => {
      const response = await apiRequest("POST", "/api/leads/employee", data);
      return response.json() as Promise<{ id: string; orderNumber?: number | null; [key: string]: unknown }>;
    },
    onSuccess: (createdLead) => {
      const tokens = estimatedTokens;
      const orderNum = createdLead?.orderNumber ?? null;
      if (tokens > 0 || orderNum != null) {
        setBookingConfirmed({ tokens, tier: userTier, orderNumber: orderNum });
      }
      toast({
        title: isStaff ? "Job created!" : "Booking submitted!",
        description: tokens > 0
          ? `You'll earn approximately ${formatTokens(tokens)} JCMOVES when the job completes.`
          : "You'll earn JCMOVES tokens when the job is confirmed and completed.",
      });
      form.reset();
      setSelectedService("");
      setEstimatedBudget("");
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/available"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add lead. Please try again.",
        variant: "destructive",
      });
    },
  });

  const saveQuote = useMutation({
    mutationFn: async (data: any) => {
      const { status: newStatus, ...quoteFields } = data;
      const response = await apiRequest("PATCH", `/api/leads/${selectedLead?.id}/quote`, quoteFields);
      const result = await response.json();
      if (newStatus && newStatus !== selectedLead?.status) {
        await apiRequest("PATCH", `/api/leads/${selectedLead?.id}/status`, { status: newStatus });
      }
      return result;
    },
    onSuccess: () => {
      toast({
        title: "Quote saved successfully!",
        description: "The quote has been updated for this lead.",
      });
      setIsManageDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/status/quoted"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save quote. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteLead = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/leads/${id}`);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Job archived",
        description: "The job was removed from active leads and can be restored from Archived Jobs.",
      });
      setLeadToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete lead. Please try again.",
        variant: "destructive",
      });
    },
  });

  const bulkDeleteLeads = useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await apiRequest("DELETE", "/api/leads", { ids });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Jobs archived",
        description: `${data.deleted} job${data.deleted !== 1 ? "s" : ""} archived successfully.`,
      });
      setSelectedLeadIds(new Set());
      setBulkDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/archived"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to archive jobs. Please try again.",
        variant: "destructive",
      });
    },
  });

  const unarchiveLead = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("PATCH", `/api/leads/${id}/unarchive`);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Job restored", description: "The job has been moved back to active leads." });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/archived"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to restore the job.", variant: "destructive" });
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    submitLead.mutate(data);
  });

  const handleSaveQuote = (data: any) => {
    saveQuote.mutate(data);
  };

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return leads;
    const q = searchQuery.trim().toLowerCase();
    return leads.filter(l => {
      const orderStr = l.orderNumber != null ? formatOrderNumber(l.orderNumber).toLowerCase() : "";
      const fullName = `${l.firstName} ${l.lastName}`.toLowerCase();
      const phone = (l.phone || "").toLowerCase().replace(/\D/g, "");
      const searchPhone = q.replace(/\D/g, "");
      return (
        orderStr.includes(q) ||
        fullName.includes(q) ||
        (searchPhone.length >= 3 && phone.includes(searchPhone)) ||
        (l.email || "").toLowerCase().includes(q)
      );
    });
  }, [leads, searchQuery]);

  const handleViewLead = (lead: Lead) => {
    setSelectedLead(lead);
    setIsQuickViewOpen(true);
  };

  const handleManageJob = (lead: Lead) => {
    setSelectedLead(lead);
    setIsQuickViewOpen(false);
    setIsManageDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-4xl font-bold text-white">Management</h1>
                <p className="text-slate-300 mt-2 text-lg">
                  View and manage customer leads
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => setLocation("/dashboard")}
                className="flex items-center gap-2 text-white/70 hover:text-white hover:bg-white/10"
                data-testid="button-back-to-dashboard"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
            </div>
          </div>

          {/* Traffic Light Legend */}
          <div className="flex items-center gap-4 flex-wrap bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-2.5 mb-6 text-xs text-slate-400">
            <span className="font-semibold text-slate-300 mr-1">Status Key:</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shadow shadow-red-500/60 animate-pulse" /> Lead / Quote Request</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block shadow shadow-yellow-400/60" /> Confirmed Job</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block shadow shadow-green-500/60" /> Completed</span>
          </div>

          {/* Search bar — filters visible leads in real time */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by order # (JC-000001), name, phone, or email…"
              className="pl-9 pr-9 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-blue-500/40"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Order / Customer Lookup — server-side exact lookup by order number or email */}
          <form onSubmit={handleOrderSearch} className="mb-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  placeholder="Look up exact order by order number (JC-000001) or email…"
                  className="pl-9 bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500"
                />
              </div>
              <Button type="submit" disabled={orderLookup.isPending} className="shrink-0">
                {orderLookup.isPending ? "Searching…" : "Look Up"}
              </Button>
            </div>
            {lookupError && <p className="text-sm text-red-400 mt-1.5 pl-1">{lookupError}</p>}
          </form>

          {lookupResult && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-slate-400 font-medium">Lookup result:</p>
                <button onClick={() => { setLookupResult(null); setOrderSearch(""); }} className="text-xs text-slate-500 hover:text-slate-300">Clear</button>
              </div>
              <JobCard lead={lookupResult} onDelete={isAdmin ? setLeadToDelete : undefined} />
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="bg-slate-800/80 border border-slate-700 flex-wrap h-auto gap-1">
              <TabsTrigger value="view" data-testid="tab-view-leads">Active Leads</TabsTrigger>
              <TabsTrigger value="completed" data-testid="tab-completed-leads" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                Completed ({leads.filter(l => l.status === 'completed').length})
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="archived" className="data-[state=active]:bg-slate-600 data-[state=active]:text-white">
                  <Archive className="h-3.5 w-3.5 mr-1.5" />
                  Archived ({archivedLeads.length})
                </TabsTrigger>
              )}
              {isAdmin && <TabsTrigger value="cleanup" data-testid="tab-cleanup-leads">Cleanup</TabsTrigger>}
              <TabsTrigger value="add" data-testid="tab-add-lead">+ Add a Job</TabsTrigger>
            </TabsList>

            <TabsContent value="view">
              {isLoading ? (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardContent className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto"></div>
                    <p className="mt-4 text-slate-400">Loading leads...</p>
                  </CardContent>
                </Card>
              ) : isError ? (
                <Card className="bg-slate-800/50 border-red-800/40">
                  <CardContent className="text-center py-12">
                    <p className="text-red-400 font-semibold mb-2">Failed to load leads</p>
                    <p className="text-slate-400 text-sm mb-4">There was a problem fetching the jobs list. Please try again.</p>
                    <Button variant="outline" size="sm" onClick={() => refetchLeads()} className="border-slate-600 text-slate-300 hover:text-white">
                      Retry
                    </Button>
                  </CardContent>
                </Card>
              ) : filteredLeads.filter(l => l.status !== 'completed').length === 0 ? (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardContent className="py-12">
                    <div className="text-center">
                      {searchQuery ? (
                        <>
                          <Search className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                          <p className="text-slate-400">No active leads match your search.</p>
                          <button onClick={() => setSearchQuery("")} className="text-blue-400 text-sm mt-2 hover:underline">Clear search</button>
                        </>
                      ) : (
                        <p className="text-slate-400">No active leads at this time.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (() => {
                const activeLeads = [...filteredLeads]
                  .filter(l => !["completed", "cancelled", "paid"].includes(l.status))
                  .sort((a, b) => {
                    const ORDER: Record<string, number> = {
                      new: 0, contacted: 1, quote_requested: 2, quoted: 3,
                      confirmed: 10, available: 11, accepted: 12, in_progress: 13,
                    };
                    const aIdx = ORDER[a.status] ?? 99;
                    const bIdx = ORDER[b.status] ?? 99;
                    if (aIdx !== bIdx) return aIdx - bIdx;
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                  });
                const totalActive = leads.filter(l => !["completed", "cancelled", "paid"].includes(l.status)).length;
                const allSelected = activeLeads.length > 0 && activeLeads.every(l => selectedLeadIds.has(String(l.id)));
                const someSelected = selectedLeadIds.size > 0;
                const toggleAll = () => {
                  if (allSelected) {
                    setSelectedLeadIds(new Set());
                  } else {
                    setSelectedLeadIds(new Set(activeLeads.map(l => String(l.id))));
                  }
                };
                const toggleOne = (id: string) => {
                  setSelectedLeadIds(prev => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                };
                return (
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader>
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div>
                          <CardTitle className="text-2xl text-white">
                            Active Leads ({activeLeads.length}{searchQuery ? ` of ${totalActive}` : ""})
                          </CardTitle>
                          <CardDescription className="text-slate-400">Customer leads in progress</CardDescription>
                        </div>
                        {isAdmin && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={toggleAll}
                              className="text-slate-400 hover:text-white gap-1.5 h-8"
                            >
                              {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                              {allSelected ? "Deselect All" : "Select All"}
                            </Button>
                            {someSelected && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setBulkDeleteConfirm(true)}
                                className="gap-1.5 h-8"
                                data-testid="button-bulk-delete"
                              >
                                <Archive className="h-4 w-4" />
                                Archive {selectedLeadIds.size} Selected
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {activeLeads.map(lead => (
                          <div key={lead.id} className="flex items-start gap-2">
                            {isAdmin && (
                              <div className="mt-4 shrink-0" onClick={e => e.stopPropagation()}>
                                <Checkbox
                                  checked={selectedLeadIds.has(String(lead.id))}
                                  onCheckedChange={() => toggleOne(String(lead.id))}
                                  data-testid={`checkbox-lead-${lead.id}`}
                                  className="border-slate-500"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <JobCard lead={lead} onDelete={isAdmin ? setLeadToDelete : undefined} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </TabsContent>

            <TabsContent value="completed">
              {isLoading ? (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardContent className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto"></div>
                    <p className="mt-4 text-slate-400">Loading completed jobs...</p>
                  </CardContent>
                </Card>
              ) : filteredLeads.filter(l => l.status === 'completed').length === 0 ? (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardContent className="py-12">
                    <div className="text-center">
                      <CheckCheck className="h-12 w-12 text-slate-600 mx-auto mb-3" />
                      {searchQuery ? (
                        <>
                          <p className="text-slate-400">No completed jobs match your search.</p>
                          <button onClick={() => setSearchQuery("")} className="text-blue-400 text-sm mt-2 hover:underline">Clear search</button>
                        </>
                      ) : (
                        <p className="text-slate-400">No completed jobs yet.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="bg-slate-800/50 border-emerald-800/30">
                  <CardHeader>
                    <CardTitle className="text-2xl text-white flex items-center gap-2">
                      <CheckCheck className="h-6 w-6 text-emerald-500" />
                      Completed Jobs ({filteredLeads.filter(l => l.status === 'completed').length}{searchQuery ? ` of ${leads.filter(l => l.status === 'completed').length}` : ""})
                    </CardTitle>
                    <CardDescription className="text-slate-400">Jobs that have been finished</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {[...filteredLeads]
                        .filter(l => l.status === 'completed')
                        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        .map(lead => <JobCard key={lead.id} lead={lead} onDelete={setLeadToDelete} />)}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {isAdmin && (
              <TabsContent value="archived">
                {isLoadingArchived ? (
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardContent className="text-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-500 mx-auto"></div>
                      <p className="mt-4 text-slate-400">Loading archived jobs…</p>
                    </CardContent>
                  </Card>
                ) : archivedLeads.length === 0 ? (
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardContent className="py-12 text-center">
                      <Archive className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                      <p className="text-slate-400">No archived jobs yet.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="bg-slate-800/50 border-slate-700/60">
                    <CardHeader>
                      <CardTitle className="text-xl text-white flex items-center gap-2">
                        <Archive className="h-5 w-5 text-slate-400" />
                        Archived Jobs ({archivedLeads.length})
                      </CardTitle>
                      <CardDescription className="text-slate-400">Jobs removed from active views — no data is lost. Restore any job to make it active again.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {archivedLeads.map(lead => (
                          <div key={lead.id} className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <JobCard lead={lead} showContact compact />
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => unarchiveLead.mutate(String(lead.id))}
                              disabled={unarchiveLead.isPending}
                              className="shrink-0 border-slate-600 text-slate-300 hover:text-white mt-3"
                              title="Restore this job to active leads"
                            >
                              <ArchiveRestore className="h-4 w-4 mr-1.5" />
                              Restore
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            )}

            {isAdmin && (
              <TabsContent value="cleanup">
                <LeadCleanupPanel />
              </TabsContent>
            )}

            <TabsContent value="add">
              {isStaff ? (
                <StaffJobForm prefilledDate={requestedDate} />
              ) : (
                <Card className="border-slate-700 bg-slate-800/50">
                  <CardHeader>
                    <CardTitle className="text-white">Book a service</CardTitle>
                    <CardDescription className="text-slate-400">The staff intake form is for approved crew. Use the full booking flow for a detailed customer request.</CardDescription>
                  </CardHeader>
                  <CardContent><Link href="/book"><Button>Open booking wizard</Button></Link></CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="legacy-add" className="hidden" aria-hidden="true">
              {/* Booking Confirmation Banner */}
              {bookingConfirmed && (
                <div className="mb-4 rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Coins className="h-6 w-6 text-yellow-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-orange-400">Booking submitted — tokens on the way!</p>
                      {bookingConfirmed.orderNumber != null && (
                        <p className="text-sm text-slate-300 mt-1">
                          Your order number is{" "}
                          <span className="font-mono font-bold text-blue-400 text-base">{formatOrderNumber(bookingConfirmed.orderNumber)}</span>
                          {" "}— use it to track or reference your job.
                        </p>
                      )}
                      {bookingConfirmed.tokens > 0 && (
                        <p className="text-sm text-slate-300 mt-0.5">
                          Once your job is confirmed and completed, you'll earn approximately{" "}
                          <span className="font-bold text-yellow-400">{formatTokens(bookingConfirmed.tokens)} JCMOVES</span>{" "}
                          <span className="text-slate-400">({LOYALTY_TIERS[bookingConfirmed.tier].emoji} {LOYALTY_TIERS[bookingConfirmed.tier].label} {Math.round(LOYALTY_TIERS[bookingConfirmed.tier].rate * 100)}% rate)</span>.
                          Spend them on service credits, gift cards & local deals in the marketplace.
                        </p>
                      )}
                      <Link href="/rewards" className="text-xs text-orange-400 hover:text-orange-300 mt-1 inline-block">
                        Browse the Rewards Marketplace →
                      </Link>
                    </div>
                  </div>
                  <button onClick={() => setBookingConfirmed(null)} className="text-slate-500 hover:text-slate-300 shrink-0 text-lg leading-none">×</button>
                </div>
              )}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-2xl text-white">
                    {isStaff ? "Create a New Job" : "Book a Service"}
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    {isStaff
                      ? "Create a job on behalf of a customer — phone call, walk-in, or referral. You'll earn rewards when the job is confirmed and completed."
                      : "Book a moving, junk removal, or other service directly. Your job goes straight into our pipeline and you earn JCMOVES tokens when it's completed. You can track your order here anytime."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={onSubmit} className="space-y-6">
                    <div>
                      <Label className="block text-sm font-medium text-slate-300 mb-3">Service Type *</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {serviceOptions.map((service) => {
                          const IconComponent = service.icon;
                          return (
                            <label key={service.value} className="relative">
                              <input
                                type="radio"
                                value={service.value}
                                className="peer sr-only"
                                {...form.register("serviceType", { required: true })}
                                onChange={(e) => setSelectedService(e.target.value)}
                                data-testid={`radio-service-${service.value}`}
                              />
                              <div className="p-4 border-2 border-slate-600 rounded-lg cursor-pointer peer-checked:border-orange-500 peer-checked:bg-orange-500/10 transition-colors bg-slate-700/30">
                                <IconComponent className="text-orange-400 text-2xl mb-2 mx-auto h-8 w-8" />
                                <span className="font-medium block text-center text-white">{service.label}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      {form.formState.errors.serviceType && (
                        <p className="text-destructive text-sm mt-1" data-testid="error-service-type">Service type is required</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label htmlFor="firstName" className="text-slate-300">Customer First Name *</Label>
                        <Input
                          id="firstName"
                          placeholder="Customer first name"
                          className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                          {...form.register("firstName")}
                          data-testid="input-first-name"
                        />
                        {form.formState.errors.firstName && (
                          <p className="text-destructive text-sm mt-1" data-testid="error-first-name">{form.formState.errors.firstName.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="lastName" className="text-slate-300">Customer Last Name *</Label>
                        <Input
                          id="lastName"
                          placeholder="Customer last name"
                          className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                          {...form.register("lastName")}
                          data-testid="input-last-name"
                        />
                        {form.formState.errors.lastName && (
                          <p className="text-destructive text-sm mt-1" data-testid="error-last-name">{form.formState.errors.lastName.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label htmlFor="email" className="text-slate-300">Customer Email *</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="Customer email address"
                          className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                          {...form.register("email")}
                          data-testid="input-email"
                        />
                        {form.formState.errors.email && (
                          <p className="text-destructive text-sm mt-1" data-testid="error-email">{form.formState.errors.email.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="phone" className="text-slate-300">Customer Phone *</Label>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="Customer phone number"
                          className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                          {...form.register("phone")}
                          data-testid="input-phone"
                        />
                        {form.formState.errors.phone && (
                          <p className="text-destructive text-sm mt-1" data-testid="error-phone">{form.formState.errors.phone.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label htmlFor="fromAddress" className="text-slate-300">From Address *</Label>
                        <PlacesAutocomplete
                          id="fromAddress"
                          placeholder="Current address"
                          inputClassName="min-h-11 w-full rounded-md border bg-slate-700/50 border-slate-600 px-3 py-2 text-white placeholder:text-slate-500"
                          name="fromAddress"
                          ref={form.register("fromAddress").ref}
                          value={form.watch("fromAddress") || ""}
                          onChange={(value) => form.setValue("fromAddress", value, { shouldDirty: true, shouldValidate: true })}
                          onBlur={form.register("fromAddress").onBlur}
                          aria-invalid={Boolean(form.formState.errors.fromAddress)}
                          inputTestId="input-from-address"
                        />
                        {form.formState.errors.fromAddress && (
                          <p className="text-destructive text-sm mt-1" data-testid="error-from-address">{form.formState.errors.fromAddress.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="toAddress" className="text-slate-300">To Address</Label>
                        <PlacesAutocomplete
                          id="toAddress"
                          placeholder="Destination address"
                          inputClassName="min-h-11 w-full rounded-md border bg-slate-700/50 border-slate-600 px-3 py-2 text-white placeholder:text-slate-500"
                          name="toAddress"
                          ref={form.register("toAddress").ref}
                          value={form.watch("toAddress") || ""}
                          onChange={(value) => form.setValue("toAddress", value, { shouldDirty: true, shouldValidate: true })}
                          onBlur={form.register("toAddress").onBlur}
                          inputTestId="input-to-address"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label className="text-slate-300">Preferred Move Date</Label>
                        <DatePicker
                          value={form.watch("moveDate") ?? undefined}
                          onChange={(v) => form.setValue("moveDate", v || null)}
                          placeholder="Pick a move date"
                        />
                      </div>
                      <div>
                        <Label htmlFor="propertySize" className="text-slate-300">Property Size</Label>
                        <Input
                          id="propertySize"
                          placeholder="e.g., 2 bedroom, 1500 sq ft"
                          className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                          {...form.register("propertySize")}
                          data-testid="input-property-size"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="details" className="text-slate-300">Additional Details</Label>
                      <Textarea
                        id="details"
                        placeholder="Any special requirements, items to move, or important notes"
                        rows={4}
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                        {...form.register("details")}
                        data-testid="textarea-details"
                      />
                    </div>

                    {/* Estimated Budget + Token Preview */}
                    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-yellow-400" />
                        <span className="text-sm font-medium text-yellow-400">Estimate your JCMOVES earnings</span>
                        <span className="text-xs text-slate-500">(optional)</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <Input
                            type="number"
                            placeholder="e.g. 250"
                            value={estimatedBudget}
                            onChange={e => setEstimatedBudget(e.target.value)}
                            className="pl-7 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
                            min="0"
                          />
                        </div>
                        {estimatedTokens > 0 && (
                          <div className="flex items-center gap-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 whitespace-nowrap">
                            <Coins className="h-4 w-4 text-yellow-400" />
                            <span className="font-bold text-yellow-400">{formatTokens(estimatedTokens)}</span>
                            <span className="text-xs text-slate-400">JCMOVES</span>
                          </div>
                        )}
                      </div>
                      {estimatedTokens > 0 ? (
                        <p className="text-xs text-slate-400">
                          {LOYALTY_TIERS[userTier].emoji} {LOYALTY_TIERS[userTier].label} tier — earn{" "}
                          <strong className="text-slate-300">{LOYALTY_TIERS[userTier].tokensPerDollar} JCMOVES per $1</strong>{" "}
                          ({Math.round(LOYALTY_TIERS[userTier].rate * 100)}% back in tokens)
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">Enter an estimated job value to see how many JCMOVES you'll earn. Earn 50–100 tokens per $1 spent.</p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      disabled={submitLead.isPending}
                      className="w-full"
                      data-testid="button-submit-lead"
                    >
                      {submitLead.isPending ? "Submitting..." : isStaff ? "Create Job" : "Submit Booking"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="mt-6 bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-950/30 dark:to-blue-950/30 border-green-200 dark:border-green-800">
                <CardContent className="pt-6">
                  <h3 className="font-semibold mb-2">💰 Earn Rewards</h3>
                  <p className="text-sm text-muted-foreground">
                    When leads you create are confirmed and completed, you'll earn 50% of the rewards when other employees complete the job. This encourages teamwork and business growth!
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Quick View Dialog */}
      <Dialog open={isQuickViewOpen} onOpenChange={setIsQuickViewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lead Details</DialogTitle>
            <DialogDescription>
              View lead information and take action
            </DialogDescription>
          </DialogHeader>
          {selectedLead && (
            <Card className="border" data-testid={`lead-quick-view-${selectedLead.id}`}>
              <CardContent className="p-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">
                      {selectedLead.firstName} {selectedLead.lastName}
                    </h3>
                    <Badge
                      variant={selectedLead.status === 'completed' ? 'default' : 'secondary'}
                      className={selectedLead.status === 'completed' ? 'bg-green-600' : ''}
                    >
                      {selectedLead.status.charAt(0).toUpperCase() + selectedLead.status.slice(1).replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Badge className={
                        selectedLead.serviceType === 'residential' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                        selectedLead.serviceType === 'commercial' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                        'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                      }>
                        {selectedLead.serviceType === 'residential' ? 'Residential' : 
                         selectedLead.serviceType === 'commercial' ? 'Commercial' : 
                         'Junk Removal'}
                      </Badge>
                    </div>
                    <p className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      <a href={`tel:${selectedLead.phone}`} className="hover:underline">
                        {selectedLead.phone}
                      </a>
                    </p>
                    <p className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      <a href={`mailto:${selectedLead.email}`} className="hover:underline">
                        {selectedLead.email}
                      </a>
                    </p>
                    <p className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {selectedLead.fromAddress}
                    </p>
                    {selectedLead.toAddress && (
                      <p className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        To: {selectedLead.toAddress}
                      </p>
                    )}
                    {selectedLead.moveDate && (
                      <p className="flex items-center gap-2">
                        <CalendarIcon className="h-4 w-4" />
                        Move Date: {new Date(selectedLead.moveDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {selectedLead.details && (
                    <p className="text-sm mt-2 p-2 bg-muted rounded">
                      {selectedLead.details}
                    </p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button 
                      size="sm" 
                      onClick={() => handleManageJob(selectedLead)}
                      data-testid={`button-manage-job-${selectedLead.id}`}
                    >
                      <Settings className="h-4 w-4 mr-1" />
                      Manage Job
                    </Button>
                    <Button variant="outline" size="sm" asChild data-testid={`button-call-${selectedLead.id}`}>
                      <a href={`tel:${selectedLead.phone}`}>
                        <Phone className="h-4 w-4 mr-1" />
                        Call
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild data-testid={`button-email-${selectedLead.id}`}>
                      <a href={`mailto:${selectedLead.email}`}>
                        <Mail className="h-4 w-4 mr-1" />
                        Email
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </DialogContent>
      </Dialog>

      {/* Full Management Dialog */}
      <LeadQuoteDialog
        open={isManageDialogOpen}
        onOpenChange={setIsManageDialogOpen}
        lead={selectedLead}
        employees={employees}
        onSave={handleSaveQuote}
      />

      {/* Archive Confirmation Dialog (single lead) */}
      <AlertDialog open={!!leadToDelete} onOpenChange={(open) => !open && setLeadToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this job?</AlertDialogTitle>
            <AlertDialogDescription>
              The job for{" "}
              <strong>{leadToDelete?.firstName} {leadToDelete?.lastName}</strong>{" "}
              will be moved to the Archived tab. No data is lost — you can restore it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => leadToDelete && deleteLead.mutate(leadToDelete.id)}
              className="bg-slate-600 hover:bg-slate-500"
              data-testid="button-confirm-delete"
            >
              {deleteLead.isPending ? "Archiving…" : "Archive Job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Archive Confirmation Dialog */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={(open) => !open && setBulkDeleteConfirm(false)}>
        <AlertDialogContent data-testid="dialog-bulk-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {selectedLeadIds.size} job{selectedLeadIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{selectedLeadIds.size} selected job{selectedLeadIds.size !== 1 ? "s" : ""}</strong>{" "}
              will be moved to the Archived tab. No data is lost — you can restore any of them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDeleteLeads.mutate(Array.from(selectedLeadIds))}
              className="bg-slate-600 hover:bg-slate-500"
              data-testid="button-confirm-bulk-delete"
              disabled={bulkDeleteLeads.isPending}
            >
              {bulkDeleteLeads.isPending ? "Archiving…" : `Archive ${selectedLeadIds.size} Job${selectedLeadIds.size !== 1 ? "s" : ""}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
