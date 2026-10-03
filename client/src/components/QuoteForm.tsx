import { PhoneRewardsEnrollment } from "@/components/phone-rewards-enrollment";
import { z } from "zod";
import { useState, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertLeadSchema, type InsertLead, formatOrderNumber } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, Camera, X, ImagePlus } from "lucide-react";
import { getService } from "@/lib/services";
import { DatePicker } from "@/components/ui/date-picker";
import ServiceBundleAddon from "@/components/ServiceBundleAddon";
import { PlacesAutocomplete } from "@/components/places-autocomplete";

interface QuotePhoto {
  id: string;
  dataUrl: string;
  name: string;
}

interface QuoteFormProps {
  variant?: "customer" | "employee";
  prefilledDate?: string;
  prefilledService?: string;
  prefilledPromoCode?: string;
  onSuccess?: () => void;
  showRewardsInfo?: boolean;
}

const QUOTE_FORM_SERVICE_KEYS = [
  "residential", "junk", "snow", "cleaning", "handyman", "demolition", "flooring", "painting",
];

export default function QuoteForm({ 
  variant = "customer", 
  prefilledDate = "", 
  prefilledService = "",
  prefilledPromoCode = "",
  onSuccess,
  showRewardsInfo = false
}: QuoteFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedService, setSelectedService] = useState<string>(prefilledService);
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<QuotePhoto[]>([]);
  const [bundleAddons, setBundleAddons] = useState<string[]>([]);

  const isEmployee = variant === "employee";
  const apiEndpoint = isEmployee ? "/api/leads/employee" : "/api/leads";

  const form = useForm<InsertLead>({
    resolver: zodResolver(insertLeadSchema.extend({
      serviceType: z.string().trim().min(1, "Choose a service."),
      firstName: z.string().trim().min(1, "Enter a first name."),
      lastName: z.string().trim().min(1, "Enter a last name."),
      email: z.string().trim().email("Enter an email address for your quote."),
      fromAddress: z.string().trim().min(1, "Enter the service address."),
    })),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      serviceType: prefilledService,
      fromAddress: "",
      toAddress: "",
      moveDate: prefilledDate,
      propertySize: "",
      details: "",
      promoCode: prefilledPromoCode,
    },
  });

  useEffect(() => {
    if (prefilledDate) {
      form.setValue('moveDate', prefilledDate);
    }
  }, [prefilledDate, form]);

  useEffect(() => {
    if (prefilledService) {
      setSelectedService(prefilledService);
      form.setValue('serviceType', prefilledService);
    }
  }, [prefilledService, form]);

  useEffect(() => {
    if (prefilledPromoCode) {
      form.setValue('promoCode', prefilledPromoCode);
    }
  }, [prefilledPromoCode, form]);

  const handlePhotoUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    if (photos.length + files.length > 5) {
      toast({
        title: "Too many photos",
        description: "You can upload up to 5 photos.",
        variant: "destructive",
      });
      return;
    }

    Array.from(files).forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: `${file.name} is larger than 10MB.`,
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setPhotos((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            dataUrl,
            name: file.name,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });

    event.target.value = "";
  }, [photos.length, toast]);

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const submitLead = useMutation({
    mutationFn: async (data: InsertLead) => {
      const payload: Record<string, unknown> = { ...data };
      
      if (photos.length > 0) {
        payload.photos = photos.map((p) => ({
          id: p.id,
          url: p.dataUrl,
          type: "before" as const,
          timestamp: new Date().toISOString(),
        }));
      }

      if (bundleAddons.length > 0) {
        payload.bundleAddons = bundleAddons;
      }
      
      const response = await apiRequest("POST", apiEndpoint, payload);
      return response.json() as Promise<{ success: boolean; leadId?: string; orderNumber?: number | null; message?: string }>;
    },
    onSuccess: (result) => {
      const orderPart = result?.orderNumber != null ? ` Your order number is ${formatOrderNumber(result.orderNumber)}.` : "";
      toast({
        title: isEmployee ? "Job request submitted!" : "Quote request submitted!",
        description: isEmployee 
          ? `The job has been added to the system.${orderPart} You'll earn rewards when it's confirmed and completed.`
          : `We will contact you within 24 hours with your quote.${orderPart}`,
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      if (isEmployee) {
        queryClient.invalidateQueries({ queryKey: ["/api/leads/available"] });
        queryClient.invalidateQueries({ queryKey: ["/api/leads/my-jobs"] });
      }
      
      form.reset();
      setSelectedService("");
      setPhotos([]);
      setStep(0);
      setBundleAddons([]);
      
      onSuccess?.();
    },
    onError: (error: Error) => {
      if (error.message.includes('401')) return;
      toast({
        title: "Error",
        description: isEmployee 
          ? "Failed to submit job request. Please try again."
          : "Failed to submit quote request. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertLead) => {
    if (step !== 2) return;
    submitLead.mutate({ ...data, toAddress: ["residential", "commercial"].includes(selectedService) ? data.toAddress : "" });
  };

  const getServiceTitle = () => {
    const svc = getService(selectedService);
    return svc ? `${svc.label} Quote` : (isEmployee ? "Add a Job" : "Get Your Free Quote");
  };

  const cardClasses = isEmployee 
    ? "border border-slate-700/50 bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm shadow-xl overflow-hidden" 
    : "shadow-2xl bg-slate-800/50 border-slate-700";
  
  const labelClasses = isEmployee 
    ? "text-slate-200" 
    : "text-slate-200";
  
  const inputClasses = isEmployee 
    ? "bg-slate-800/50 border-slate-600 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500/20" 
    : "bg-slate-700 border-slate-600 text-white placeholder:text-slate-400";

  const errorClasses = isEmployee 
    ? "text-red-400 text-sm mt-1" 
    : "text-red-400 text-sm mt-1";

  return (
    <Card className={cardClasses}>
      {isEmployee && (
        <CardHeader className="border-b border-slate-700/50 bg-slate-800/50">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-orange-500 to-blue-500"></div>
          <CardTitle className="flex items-center gap-3 text-slate-100 text-xl">
            Job Request Details
          </CardTitle>
          <CardDescription className="text-slate-400">
            Fill out the customer's information and job details
          </CardDescription>
        </CardHeader>
      )}
      <CardContent className={isEmployee ? "pt-6" : "p-6 md:p-8"}>
        <form noValidate onSubmit={form.handleSubmit(onSubmit, (errors) => {
          setStep(errors.serviceType ? 0 : errors.fromAddress ? 1 : 2);
        })} className="space-y-5 [&_input]:min-h-12 [&_input]:text-base [&_textarea]:text-base [&_button]:min-h-11">
          <nav aria-label="Quote progress" className="grid grid-cols-3 gap-2">
            {["Service", "Job details", "Contact"].map((label, index) => <button key={label} type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)} className={`rounded-lg px-2 py-3 text-sm font-semibold ${step === index ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-200"}`}>{index + 1}. {label}</button>)}
          </nav>
          <p className="text-sm text-slate-300">Step {step + 1} of 3 · No payment needed for a quote.</p>
          <div hidden={step !== 0}>
          <div>
            <Label className={`block text-sm font-medium ${labelClasses} mb-3`}>Service Type *</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {QUOTE_FORM_SERVICE_KEYS.map(key => {
                const svc = getService(key);
                if (!svc) return null;
                const Icon = svc.icon;
                return (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={selectedService === key}
                    className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border-2 p-3 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 ${selectedService === key ? "border-blue-400 bg-blue-950" : "border-slate-600 bg-slate-800"}`}
                    onClick={() => {
                      setSelectedService(key);
                      form.setValue("serviceType", key);
                    }}
                  ><Icon aria-hidden="true" className="h-6 w-6 text-blue-300" />{svc.label}</button>
                );
              })}
            </div>
            {form.formState.errors.serviceType && (
              <p className={`${errorClasses} mt-2`} data-testid="error-service-type">Please select a service type</p>
            )}
          </div>

          </div>
          <div hidden={step !== 1} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="fromAddress" className={labelClasses}>Service Address *</Label>
              <PlacesAutocomplete
                value={form.watch("fromAddress") || ""}
                onChange={(v) => form.setValue("fromAddress", v, { shouldValidate: true })}
                onPlaceSelect={(p) => form.setValue("fromAddress", p.fullAddress, { shouldValidate: true })}
                placeholder="Where do you need service?"
                inputClassName={`w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${inputClasses}`}
              />
              {form.formState.errors.fromAddress && (
                <p className={errorClasses}>{form.formState.errors.fromAddress.message}</p>
              )}
            </div>
            <div hidden={!["residential", "commercial"].includes(selectedService)}>
              <Label htmlFor="toAddress" className={labelClasses}>Destination (if moving)</Label>
              <PlacesAutocomplete
                value={form.watch("toAddress") || ""}
                onChange={(v) => form.setValue("toAddress", v)}
                onPlaceSelect={(p) => form.setValue("toAddress", p.fullAddress)}
                placeholder="Destination address"
                inputClassName={`w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${inputClasses}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className={labelClasses}>Preferred Date</Label>
              <DatePicker
                value={form.watch("moveDate") ?? undefined}
                onChange={(v) => form.setValue("moveDate", v || null)}
                placeholder="Pick a move date"
              />
            </div>
            <div>
              <Label htmlFor="propertySize" className={labelClasses}>Property Size</Label>
              <Select value={form.watch("propertySize") || ""} onValueChange={(value) => form.setValue("propertySize", value)} data-testid="select-property-size">
                <SelectTrigger className={inputClasses}>
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent className={isEmployee ? "bg-slate-800 border-slate-600" : "bg-slate-700 border-slate-600"}>
                  <SelectItem value="studio" className={isEmployee ? "text-slate-200 focus:bg-slate-700" : ""}>Studio/1 BR</SelectItem>
                  <SelectItem value="2br" className={isEmployee ? "text-slate-200 focus:bg-slate-700" : ""}>2-3 Bedroom</SelectItem>
                  <SelectItem value="4br" className={isEmployee ? "text-slate-200 focus:bg-slate-700" : ""}>4+ Bedroom</SelectItem>
                  <SelectItem value="office" className={isEmployee ? "text-slate-200 focus:bg-slate-700" : ""}>Small Office</SelectItem>
                  <SelectItem value="large-office" className={isEmployee ? "text-slate-200 focus:bg-slate-700" : ""}>Large Office</SelectItem>
                  <SelectItem value="driveway" className={isEmployee ? "text-slate-200 focus:bg-slate-700" : ""}>Driveway</SelectItem>
                  <SelectItem value="parking-lot" className={isEmployee ? "text-slate-200 focus:bg-slate-700" : ""}>Parking Lot</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="details" className={labelClasses}>Items, work & access</Label>
            <Textarea
              id="details"
              rows={4}
              placeholder="What needs moving or work? Include quantities, stairs at each address, elevators, parking / carry distance, and unusually heavy items."
              className={inputClasses}
              {...form.register("details")}
              data-testid="textarea-details"
            />
          </div>

          <div>
            <Label className={`${labelClasses} mb-3 block`}>
              <Camera className="inline-block mr-2 h-4 w-4 text-blue-400" />
              Add Photos (optional)
            </Label>
            <p className={`${isEmployee ? 'text-slate-400' : 'text-slate-400'} text-sm mb-3`}>
              Upload up to 5 photos to help {isEmployee ? 'assess the job' : 'us provide an accurate quote'}.
            </p>
            
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                {photos.map((photo) => (
                  <div key={photo.id} className={`relative aspect-square rounded-xl overflow-hidden ${isEmployee ? 'bg-slate-800 ring-2 ring-slate-700' : 'bg-slate-700'}`}>
                    <img
                      src={photo.dataUrl}
                      alt={photo.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`Remove photo ${photo.name}`}
                      onClick={() => removePhoto(photo.id)}
                      className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg transition-colors"
                      data-testid={`button-remove-photo-${photo.id}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {photos.length < 5 && (
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotoUpload}
                  className="hidden"
                  data-testid="input-photo-upload"
                />
                <div className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-xl transition-colors ${
                  isEmployee 
                    ? 'border-slate-600 hover:border-blue-500/50 hover:bg-slate-700/50' 
                    : 'border-slate-600 hover:border-primary hover:bg-slate-700/50'
                }`}>
                  <ImagePlus className={`h-6 w-6 ${isEmployee ? 'text-slate-400' : 'text-slate-400'}`} />
                  <span className={isEmployee ? 'text-slate-400' : 'text-slate-300'}>
                    {photos.length === 0 ? "Tap to add photos" : `Add more photos (${5 - photos.length} remaining)`}
                  </span>
                </div>
              </label>
            )}
          </div>

          </div>
          <div hidden={step !== 2} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName" className={labelClasses}>
                {isEmployee ? "Customer First Name *" : "First Name *"}
              </Label>
              <Input
                id="firstName"
                autoComplete="given-name"
                placeholder={isEmployee ? "John" : "Enter your first name"}
                className={inputClasses}
                {...form.register("firstName")}
                data-testid="input-first-name"
              />
              {form.formState.errors.firstName && (
                <p className={errorClasses}>{form.formState.errors.firstName.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="lastName" className={labelClasses}>
                {isEmployee ? "Customer Last Name *" : "Last Name *"}
              </Label>
              <Input
                id="lastName"
                autoComplete="family-name"
                placeholder={isEmployee ? "Doe" : "Enter your last name"}
                className={inputClasses}
                {...form.register("lastName")}
                data-testid="input-last-name"
              />
              {form.formState.errors.lastName && (
                <p className={errorClasses}>{form.formState.errors.lastName.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="email" className={labelClasses}>
                {isEmployee ? "Customer Email *" : "Email Address *"}
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={isEmployee ? "Customer email address" : "Best email address"}
                className={inputClasses}
                {...form.register("email")}
                data-testid="input-email"
              />
              {form.formState.errors.email && (
                <p className={errorClasses}>{form.formState.errors.email.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="phone" className={labelClasses}>
                {isEmployee ? "Customer Phone *" : "Phone Number *"}
              </Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="(906) 285-9312"
                className={inputClasses}
                {...form.register("phone")}
                data-testid="input-phone"
              />
              {form.formState.errors.phone && (
                <p className={errorClasses}>{form.formState.errors.phone.message}</p>
              )}
            </div>
          </div>


          <div className="rounded-xl bg-slate-900 p-4 text-sm text-slate-200"><strong>Review your request</strong><p>{getService(selectedService)?.label || "Choose a service"} · {form.watch("moveDate") || "Date flexible"}</p><p className="break-words">{form.watch("fromAddress") || "Add the service address"}</p><p className="whitespace-pre-wrap break-words">{form.watch("details")}</p><button type="button" className="text-blue-300 underline" onClick={() => setStep(1)}>Edit job details</button></div>
          <details><summary className="min-h-12 cursor-pointer py-3 text-slate-200">Promo code or extra services (optional)</summary><div className="space-y-4">          <div>
            <Label htmlFor="promoCode" className={labelClasses}>Promo Code (optional)</Label>
            <Input
              id="promoCode"
              placeholder="Enter promo code for savings"
              className={inputClasses}
              {...form.register("promoCode")}
              data-testid="input-promo-code"
            />
          </div>

          {/* Cross-sell: other services customer might want */}
          <ServiceBundleAddon
            currentService={selectedService === "residential" ? "moving" : selectedService === "junk" ? "junk_removal" : selectedService === "snow" ? "snow_removal" : selectedService === "cleaning" ? "cleaning" : undefined}
            selected={bundleAddons}
            onChange={setBundleAddons}
            theme="slate"
          />

</div></details>
          <PhoneRewardsEnrollment phone={form.watch("phone")} crew={isEmployee} />
          </div>
          <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-slate-700 bg-slate-900 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <Button type="button" variant="outline" disabled={step === 0 || submitLead.isPending} onClick={() => setStep(value => value - 1)}>Back</Button>
          {step < 2 ? <Button key="continue" type="button" onClick={async () => {
            const valid = await form.trigger(step === 0 ? ["serviceType"] : ["fromAddress"]);
            if (valid) setStep(value => value + 1);
          }}>Continue</Button> : (
          <Button
            key="submit"
            type="submit"
            className={isEmployee 
              ? "w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-lg shadow-orange-500/25 py-6 text-lg font-bold" 
              : "w-full bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 text-white px-8 py-4 text-lg font-semibold shadow-lg"
            }
            disabled={submitLead.isPending}
            data-testid="button-submit-quote"
          >
            <Send className="mr-2 h-5 w-5" />
            {submitLead.isPending 
              ? "Submitting..." 
              : isEmployee 
                ? "Send request"
                : "Get my quote"
            }
          </Button>)}
          </div>
        </form>
      </CardContent>

      {showRewardsInfo && (
        <div className="mx-6 mb-6 p-4 bg-gradient-to-r from-blue-500/10 to-orange-500/10 border border-blue-500/30 rounded-xl">
          <h3 className="font-bold mb-2 text-slate-100 flex items-center gap-2">
            <span className="text-orange-400">$</span> Earn Rewards
          </h3>
          <p className="text-sm text-slate-400">
            When jobs you create are confirmed and completed, you'll earn JCMOVES tokens as a reward for bringing in business!
          </p>
        </div>
      )}

    </Card>
  );
}
