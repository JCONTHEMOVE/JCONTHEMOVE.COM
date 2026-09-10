import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Snowflake, 
  Users, 
  Calendar,
  DollarSign,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  Clock,
  MapPin,
  Phone,
  ArrowLeft,
  Download,
  Upload,
  FileSpreadsheet
} from "lucide-react";
import { Link } from "wouter";

interface SnowCustomer {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string | null;
  contactMethod: string | null;
  pricePerVisit: string;
  notes: string | null;
  isPrepaid: boolean;
  isActive: boolean;
  createdAt: string;
}

interface SnowServiceType {
  id: string;
  name: string;
  description: string | null;
  defaultPrice: string | null;
  sortOrder: number;
  isActive: boolean;
}

interface SnowServiceLog {
  id: string;
  serviceDate: string;
  customerId: string;
  serviceTypeId: string | null;
  status: string;
  price: string;
  notes: string | null;
  monthKey: string;
}

interface MonthlySummary {
  customerId: string;
  customerName: string;
  visits: number;
  totalAmount: number;
  paidAmount: number;
}

export default function SnowRemovalPage() {
  const { user, hasAdminAccess, isLoading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("customers");
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [editingCustomer, setEditingCustomer] = useState<SnowCustomer | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);

  const hasAccess = hasAdminAccess || user?.role === 'business_owner' || user?.role === 'employee';

  // Fetch customers
  const { data: customers = [], isLoading: customersLoading } = useQuery<SnowCustomer[]>({
    queryKey: ["/api/snow/customers"],
    enabled: !!hasAccess,
  });

  // Fetch service types
  const { data: serviceTypes = [] } = useQuery<SnowServiceType[]>({
    queryKey: ["/api/snow/service-types"],
    enabled: !!hasAccess,
  });

  // Fetch logs for selected month
  const { data: logs = [], isLoading: logsLoading } = useQuery<SnowServiceLog[]>({
    queryKey: ["/api/snow/logs", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/snow/logs?monthKey=${selectedMonth}`, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = "/";
        throw new Error("Session expired");
      }
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    enabled: !!hasAccess,
  });

  // Fetch monthly summary
  const { data: summary = [], isLoading: summaryLoading } = useQuery<MonthlySummary[]>({
    queryKey: ["/api/snow/summary", selectedMonth],
    enabled: !!hasAccess,
  });

  // Customer mutations
  const createCustomerMutation = useMutation({
    mutationFn: (data: Partial<SnowCustomer>) => apiRequest("POST", "/api/snow/customers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snow/customers"] });
      setCustomerModalOpen(false);
      setEditingCustomer(null);
      toast({ title: "Customer created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateCustomerMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SnowCustomer> }) => 
      apiRequest("PUT", `/api/snow/customers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snow/customers"] });
      setCustomerModalOpen(false);
      setEditingCustomer(null);
      toast({ title: "Customer updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  // Log mutations
  const createLogMutation = useMutation({
    mutationFn: (data: Partial<SnowServiceLog>) => apiRequest("POST", "/api/snow/logs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snow/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/snow/summary"] });
      setLogModalOpen(false);
      toast({ title: "Service logged successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateLogStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => 
      apiRequest("PUT", `/api/snow/logs/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/snow/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/snow/summary"] });
      toast({ title: "Status updated" });
    },
  });

  const seedCustomersMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/snow/seed-customers"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/snow/customers"] });
      toast({ 
        title: "Customers Added", 
        description: data.added?.length > 0 
          ? `Added: ${data.added.join(", ")}` 
          : "All customers already exist"
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const importCsvMutation = useMutation({
    mutationFn: (rows: any[]) => apiRequest("POST", "/api/snow/import-csv", { rows }),
    onSuccess: async (response: Response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/snow/customers"] });
      setImportModalOpen(false);
      setCsvPreview([]);
      toast({ 
        title: "Import Complete", 
        description: data.message
      });
    },
    onError: (error: any) => {
      toast({ title: "Import Error", description: error.message, variant: "destructive" });
    },
  });

  // Import logs from CSV
  const [importLogsModalOpen, setImportLogsModalOpen] = useState(false);
  const [logsPreview, setLogsPreview] = useState<any[]>([]);

  const importLogsCsvMutation = useMutation({
    mutationFn: (rows: any[]) => apiRequest("POST", "/api/snow/import-logs-csv", { rows }),
    onSuccess: async (response: Response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/snow/logs"] });
      setImportLogsModalOpen(false);
      setLogsPreview([]);
      toast({ 
        title: "Import Complete", 
        description: `Added ${data.added} logs. ${data.skipped?.length || 0} skipped.`
      });
    },
    onError: (error: any) => {
      toast({ title: "Import Error", description: error.message, variant: "destructive" });
    },
  });

  const parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      toast({ title: "Error", description: "File too large (max 1MB)", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) {
        toast({ title: "Error", description: "CSV file appears empty", variant: "destructive" });
        return;
      }

      if (lines.length > 101) {
        toast({ title: "Error", description: "Too many rows (max 100 customers)", variant: "destructive" });
        return;
      }

      const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, ''));
      const nameIdx = headers.findIndex(h => h === 'name' || h === 'customer');
      
      if (nameIdx < 0) {
        toast({ title: "Error", description: "CSV must have a 'name' or 'customer' column", variant: "destructive" });
        return;
      }

      const addressIdx = headers.findIndex(h => h === 'address');
      const cityIdx = headers.findIndex(h => h === 'city');
      const phoneIdx = headers.findIndex(h => h === 'phone');
      const priceIdx = headers.findIndex(h => h === 'price' || h === 'pricepervisit' || h === 'rate');
      const notesIdx = headers.findIndex(h => h === 'notes' || h === 'note');
      const prepaidIdx = headers.findIndex(h => h === 'prepaid');

      const allRows = lines.slice(1).map(line => {
        const cols = parseCsvLine(line);
        const name = (nameIdx >= 0 ? cols[nameIdx] : '').replace(/['"]/g, '').trim().slice(0, 100);
        return {
          name,
          address: (addressIdx >= 0 ? cols[addressIdx] : '').replace(/['"]/g, '').slice(0, 200),
          city: (cityIdx >= 0 ? cols[cityIdx] : '').replace(/['"]/g, '').slice(0, 100),
          phone: (phoneIdx >= 0 ? cols[phoneIdx] : '').replace(/['"]/g, '').slice(0, 20),
          price: String(parseFloat((priceIdx >= 0 ? cols[priceIdx] : '0').replace(/['"$]/g, '')) || 0),
          notes: (notesIdx >= 0 ? cols[notesIdx] : '').replace(/['"]/g, '').slice(0, 500),
          prepaid: prepaidIdx >= 0 ? cols[prepaidIdx] : 'false',
        };
      }).filter(row => row.name);

      // Deduplicate by name - keep first occurrence only
      const seen = new Set<string>();
      const rows = allRows.filter(row => {
        const key = row.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setCsvPreview(rows);
    };
    reader.readAsText(file);
  };

  const handleLogsCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
      toast({ title: "Error", description: "File too large (max 1MB)", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) {
        toast({ title: "Error", description: "CSV file appears empty", variant: "destructive" });
        return;
      }

      if (lines.length > 501) {
        toast({ title: "Error", description: "Too many rows (max 500 logs)", variant: "destructive" });
        return;
      }

      const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, ''));
      const dateIdx = headers.findIndex(h => h === 'date');
      const customerIdx = headers.findIndex(h => h === 'customer' || h === 'name');
      
      if (dateIdx < 0 || customerIdx < 0) {
        toast({ title: "Error", description: "CSV must have 'date' and 'customer' columns", variant: "destructive" });
        return;
      }

      const serviceTypeIdx = headers.findIndex(h => h === 'service type' || h === 'servicetype' || h === 'service');
      const notesIdx = headers.findIndex(h => h === 'notes' || h === 'note');
      const priceIdx = headers.findIndex(h => h === 'price' || h === 'amount');

      const rows = lines.slice(1).map(line => {
        const cols = parseCsvLine(line);
        return {
          date: (dateIdx >= 0 ? cols[dateIdx] : '').replace(/['"]/g, ''),
          customer: (customerIdx >= 0 ? cols[customerIdx] : '').replace(/['"]/g, '').trim(),
          serviceType: (serviceTypeIdx >= 0 ? cols[serviceTypeIdx] : 'Snow Removal').replace(/['"]/g, ''),
          notes: (notesIdx >= 0 ? cols[notesIdx] : '').replace(/['"]/g, ''),
          price: String(parseFloat((priceIdx >= 0 ? cols[priceIdx] : '0').replace(/['"$]/g, '')) || 0),
        };
      }).filter(row => row.date && row.customer);

      setLogsPreview(rows);
    };
    reader.readAsText(file);
  };

  // Customer form state
  const [customerForm, setCustomerForm] = useState({
    name: "",
    address: "",
    city: "",
    phone: "",
    contactMethod: "",
    pricePerVisit: "",
    notes: "",
    isPrepaid: false,
  });

  // Log form state
  const [logForm, setLogForm] = useState({
    customerId: "",
    serviceTypeId: "",
    serviceDate: selectedDate,
    price: "",
    notes: "",
    status: "done",
  });

  const openCustomerModal = (customer?: SnowCustomer) => {
    if (customer) {
      setEditingCustomer(customer);
      setCustomerForm({
        name: customer.name,
        address: customer.address,
        city: customer.city,
        phone: customer.phone || "",
        contactMethod: customer.contactMethod || "",
        pricePerVisit: customer.pricePerVisit,
        notes: customer.notes || "",
        isPrepaid: customer.isPrepaid,
      });
    } else {
      setEditingCustomer(null);
      setCustomerForm({
        name: "",
        address: "",
        city: "",
        phone: "",
        contactMethod: "",
        pricePerVisit: "",
        notes: "",
        isPrepaid: false,
      });
    }
    setCustomerModalOpen(true);
  };

  const handleSaveCustomer = () => {
    if (editingCustomer) {
      updateCustomerMutation.mutate({ id: editingCustomer.id, data: customerForm });
    } else {
      createCustomerMutation.mutate(customerForm);
    }
  };

  const openLogModal = (customerId?: string) => {
    setLogForm({
      customerId: customerId || "",
      serviceTypeId: "",
      serviceDate: selectedDate,
      price: "",
      notes: "",
      status: "done",
    });
    setLogModalOpen(true);
  };

  const handleSaveLog = () => {
    const customer = customers.find(c => c.id === logForm.customerId);
    const finalPrice = logForm.price || (customer?.pricePerVisit || "0");
    createLogMutation.mutate({
      ...logForm,
      price: finalPrice,
    });
  };

  const getCustomerName = (customerId: string) => {
    return customers.find(c => c.id === customerId)?.name || "Unknown";
  };

  const getServiceTypeName = (serviceTypeId: string | null) => {
    if (!serviceTypeId) return "Standard";
    return serviceTypes.find(t => t.id === serviceTypeId)?.name || "Unknown";
  };

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p>You don't have permission to view this page.</p>
        <Link href="/">
          <Button variant="outline"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Home</Button>
        </Link>
      </div>
    );
  }

  const totalMonthlyRevenue = summary.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalPaid = summary.reduce((sum, s) => sum + s.paidAmount, 0);
  const totalUnpaid = totalMonthlyRevenue - totalPaid;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/in-god-we-trust">
              <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Snowflake className="w-6 h-6 text-blue-500" />
                Snow Removal
              </h1>
              <p className="text-sm text-muted-foreground">Manage customers and service logs</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Customers</p>
                  <p className="text-2xl font-bold">{customers.filter(c => c.isActive).length}</p>
                </div>
                <Users className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">This Month</p>
                  <p className="text-2xl font-bold">{logs.length} visits</p>
                </div>
                <Calendar className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Revenue</p>
                  <p className="text-2xl font-bold text-green-600">${totalMonthlyRevenue.toFixed(0)}</p>
                </div>
                <DollarSign className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Unpaid</p>
                  <p className="text-2xl font-bold text-orange-600">${totalUnpaid.toFixed(0)}</p>
                </div>
                <Clock className="w-8 h-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="logs">Service Logs</TabsTrigger>
            <TabsTrigger value="summary">Monthly Summary</TabsTrigger>
          </TabsList>

          <TabsContent value="customers">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Snow Removal Customers</CardTitle>
                  <CardDescription>Manage your recurring snow removal customers</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => setImportModalOpen(true)}
                  >
                    <Upload className="w-4 h-4 mr-2" /> Import CSV
                  </Button>
                  {customers.length < 5 && (
                    <Button 
                      variant="outline" 
                      onClick={() => seedCustomersMutation.mutate()}
                      disabled={seedCustomersMutation.isPending}
                    >
                      <Download className="w-4 h-4 mr-2" /> 
                      {seedCustomersMutation.isPending ? "Loading..." : "Import Default"}
                    </Button>
                  )}
                  <Button onClick={() => openCustomerModal()}>
                    <Plus className="w-4 h-4 mr-2" /> Add Customer
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {customersLoading ? (
                  <p>Loading customers...</p>
                ) : (
                  <div className="space-y-3">
                    {customers.filter(c => c.isActive).map((customer) => (
                      <div key={customer.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{customer.name}</span>
                            {customer.isPrepaid && <Badge variant="secondary">Prepaid</Badge>}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {customer.address}, {customer.city}
                            </span>
                            {customer.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="w-3 h-3" /> {customer.phone}
                              </span>
                            )}
                          </div>
                          {customer.notes && (
                            <p className="text-sm text-muted-foreground mt-1">{customer.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-lg font-bold">
                            ${parseFloat(customer.pricePerVisit).toFixed(0)}
                          </Badge>
                          <Button size="sm" variant="ghost" onClick={() => openLogModal(customer.id)}>
                            <Plus className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openCustomerModal(customer)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Service Logs</CardTitle>
                  <CardDescription>Track daily snow removal services</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-40"
                  />
                  <Button 
                    variant="outline" 
                    onClick={() => setImportLogsModalOpen(true)}
                  >
                    <Upload className="w-4 h-4 mr-2" /> Import Logs
                  </Button>
                  <Button onClick={() => openLogModal()}>
                    <Plus className="w-4 h-4 mr-2" /> Log Service
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {logsLoading ? (
                  <p>Loading logs...</p>
                ) : logs.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No service logs for this month</p>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log) => (
                      <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{getCustomerName(log.customerId)}</span>
                            <Badge variant="outline">{getServiceTypeName(log.serviceTypeId)}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {new Date(log.serviceDate).toLocaleDateString()}
                            {log.notes && ` - ${log.notes}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold">${parseFloat(log.price).toFixed(0)}</span>
                          <Badge 
                            variant={log.status === 'paid' ? 'default' : 'secondary'}
                            className={`cursor-pointer ${log.status === 'paid' ? 'bg-green-600' : ''}`}
                            onClick={() => updateLogStatusMutation.mutate({ 
                              id: log.id, 
                              status: log.status === 'paid' ? 'done' : 'paid' 
                            })}
                          >
                            {log.status === 'paid' ? 'PAID' : 'Done'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="summary">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Monthly Summary</CardTitle>
                    <CardDescription>Billing summary for {selectedMonth}</CardDescription>
                  </div>
                  <Input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-40"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {summaryLoading ? (
                  <p>Loading summary...</p>
                ) : summary.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No data for this month</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-4 p-3 bg-muted rounded-lg font-medium">
                      <span>Customer</span>
                      <span className="text-center">Visits</span>
                      <span className="text-right">Total</span>
                      <span className="text-right">Paid</span>
                    </div>
                    {summary.map((item) => (
                      <div key={item.customerId} className="grid grid-cols-4 gap-4 p-3 border rounded-lg">
                        <span className="font-medium">{item.customerName}</span>
                        <span className="text-center">{item.visits}</span>
                        <span className="text-right">${item.totalAmount.toFixed(0)}</span>
                        <span className={`text-right ${item.paidAmount >= item.totalAmount ? 'text-green-600' : 'text-orange-600'}`}>
                          ${item.paidAmount.toFixed(0)}
                        </span>
                      </div>
                    ))}
                    <div className="grid grid-cols-4 gap-4 p-3 bg-muted rounded-lg font-bold border-t-2">
                      <span>TOTAL</span>
                      <span className="text-center">{summary.reduce((s, i) => s + i.visits, 0)}</span>
                      <span className="text-right text-green-600">${totalMonthlyRevenue.toFixed(0)}</span>
                      <span className="text-right">${totalPaid.toFixed(0)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={customerModalOpen} onOpenChange={setCustomerModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCustomer ? "Edit Customer" : "Add Customer"}</DialogTitle>
              <DialogDescription>
                {editingCustomer ? "Update customer information" : "Add a new snow removal customer"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Name *</Label>
                  <Input
                    value={customerForm.name}
                    onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                    placeholder="Customer name"
                  />
                </div>
                <div>
                  <Label>City *</Label>
                  <Input
                    value={customerForm.city}
                    onChange={(e) => setCustomerForm({ ...customerForm, city: e.target.value })}
                    placeholder="Hurley, Ironwood, etc."
                  />
                </div>
              </div>
              <div>
                <Label>Address *</Label>
                <Input
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                  placeholder="Street address"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Phone</Label>
                  <Input type="tel"
                    value={customerForm.phone}
                    onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                    placeholder="Phone number"
                  />
                </div>
                <div>
                  <Label>Price Per Visit *</Label>
                  <Input
                    type="number"
                    value={customerForm.pricePerVisit}
                    onChange={(e) => setCustomerForm({ ...customerForm, pricePerVisit: e.target.value })}
                    placeholder="30"
                  />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea
                  value={customerForm.notes}
                  onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
                  placeholder="Service notes (e.g., 'just end of driveway', 'double wide plus back path')"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={customerForm.isPrepaid}
                  onCheckedChange={(checked) => setCustomerForm({ ...customerForm, isPrepaid: checked })}
                />
                <Label>Prepaid customer (auto-mark as paid)</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCustomerModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveCustomer} disabled={createCustomerMutation.isPending || updateCustomerMutation.isPending}>
                {editingCustomer ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={logModalOpen} onOpenChange={setLogModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log Service</DialogTitle>
              <DialogDescription>Record a snow removal service</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Customer *</Label>
                <Select value={logForm.customerId} onValueChange={(v) => {
                  const customer = customers.find(c => c.id === v);
                  setLogForm({ 
                    ...logForm, 
                    customerId: v,
                    price: customer?.pricePerVisit || logForm.price,
                    status: customer?.isPrepaid ? 'paid' : 'done'
                  });
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.filter(c => c.isActive).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} - ${parseFloat(c.pricePerVisit).toFixed(0)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Date *</Label>
                  <DatePicker
                    value={logForm.serviceDate || undefined}
                    onChange={(v) => setLogForm({ ...logForm, serviceDate: v || "" })}
                    placeholder="Pick service date"
                    disablePast={false}
                  />
                </div>
                <div>
                  <Label>Price</Label>
                  <Input
                    type="number"
                    value={logForm.price}
                    onChange={(e) => setLogForm({ ...logForm, price: e.target.value })}
                    placeholder="Uses customer default"
                  />
                </div>
              </div>
              <div>
                <Label>Service Type</Label>
                <Select value={logForm.serviceTypeId} onValueChange={(v) => setLogForm({ ...logForm, serviceTypeId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Input
                  value={logForm.notes}
                  onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })}
                  placeholder="Optional notes"
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={logForm.status} onValueChange={(v) => setLogForm({ ...logForm, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="done">Done</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLogModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveLog} disabled={createLogMutation.isPending || !logForm.customerId}>
                Log Service
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import CSV Modal */}
        <Dialog open={importModalOpen} onOpenChange={(open) => {
          setImportModalOpen(open);
          if (!open) setCsvPreview([]);
        }}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                Import Customers from CSV
              </DialogTitle>
              <DialogDescription>
                Upload a CSV file exported from Google Sheets. Required column: "name". Optional: address, city, phone, price, notes, prepaid.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Select CSV File</Label>
                <Input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleCsvFile}
                  className="mt-2"
                />
              </div>

              {csvPreview.length > 0 && (
                <div className="space-y-2">
                  <Label>Preview ({csvPreview.length} customers found)</Label>
                  <div className="border rounded-lg max-h-60 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="p-2 text-left">Name</th>
                          <th className="p-2 text-left">Address</th>
                          <th className="p-2 text-right">Price</th>
                          <th className="p-2 text-left">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.map((row, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2 font-medium">{row.name}</td>
                            <td className="p-2 text-muted-foreground">{row.address || '-'}</td>
                            <td className="p-2 text-right">${row.price || '0'}</td>
                            <td className="p-2 text-muted-foreground truncate max-w-[150px]">{row.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setImportModalOpen(false);
                setCsvPreview([]);
              }}>
                Cancel
              </Button>
              <Button 
                onClick={() => importCsvMutation.mutate(csvPreview)}
                disabled={csvPreview.length === 0 || importCsvMutation.isPending}
              >
                {importCsvMutation.isPending ? "Importing..." : `Import ${csvPreview.length} Customers`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import Logs CSV Modal */}
        <Dialog open={importLogsModalOpen} onOpenChange={(open) => {
          setImportLogsModalOpen(open);
          if (!open) setLogsPreview([]);
        }}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                Import Service Logs from CSV
              </DialogTitle>
              <DialogDescription>
                Upload a CSV file with service logs. Required columns: "date" and "customer". Optional: service type, price, notes.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Select CSV File</Label>
                <Input 
                  type="file" 
                  accept=".csv" 
                  onChange={handleLogsCsvFile}
                  className="mt-2"
                />
              </div>

              {logsPreview.length > 0 && (
                <div className="space-y-2">
                  <Label>Preview ({logsPreview.length} logs found)</Label>
                  <div className="border rounded-lg max-h-60 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="p-2 text-left">Date</th>
                          <th className="p-2 text-left">Customer</th>
                          <th className="p-2 text-left">Service</th>
                          <th className="p-2 text-right">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logsPreview.slice(0, 20).map((row, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2">{row.date}</td>
                            <td className="p-2 font-medium">{row.customer}</td>
                            <td className="p-2 text-muted-foreground truncate max-w-[150px]">{row.serviceType}</td>
                            <td className="p-2 text-right">${row.price}</td>
                          </tr>
                        ))}
                        {logsPreview.length > 20 && (
                          <tr className="border-t">
                            <td colSpan={4} className="p-2 text-center text-muted-foreground">
                              ...and {logsPreview.length - 20} more rows
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setImportLogsModalOpen(false);
                setLogsPreview([]);
              }}>
                Cancel
              </Button>
              <Button 
                onClick={() => importLogsCsvMutation.mutate(logsPreview)}
                disabled={logsPreview.length === 0 || importLogsCsvMutation.isPending}
              >
                {importLogsCsvMutation.isPending ? "Importing..." : `Import ${logsPreview.length} Logs`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
