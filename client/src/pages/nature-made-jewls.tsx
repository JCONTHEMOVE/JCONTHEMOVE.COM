import { ShopSwitcher } from "@/components/shop-switcher";
import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Gem, Search, Plus, ChevronLeft, ChevronRight, Mail, Phone, ImagePlus, X, Heart, Pencil, Trash2, Video, Tag, RotateCcw, ShoppingCart, Check, CheckCircle2, Bitcoin, Bot, Send, RefreshCw, Star, Sparkles, Share2, ExternalLink, MapPin, Leaf } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/hooks/useCart";
import { ShopConcierge } from "@/components/shop-concierge";

const jewelryVideoSrc = "/jewelry-video.mp4";

const isVideoUrl = (url: string) => /\.(mp4|webm|ogg|mov)$/i.test(url);

function MediaItem({ src, alt, className }: { src: string; alt: string; className?: string }) {
  if (isVideoUrl(src)) {
    return (
      <video
        src={src}
        className={className}
        controls
        playsInline
        muted
        loop
      />
    );
  }
  return <img src={src} alt={alt} className={className} />;
}

function MediaThumb({ src, alt, className }: { src: string; alt: string; className?: string }) {
  if (isVideoUrl(src)) {
    return (
      <video
        src={src}
        className={className}
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  return <img src={src} alt={alt} className={className} />;
}

interface JewelryItem {
  id: string;
  postedBy?: string;
  title: string;
  description?: string;
  shortDescription?: string;
  price?: string;
  category?: string;
  materials?: string;
  imageUrl?: string;
  photos?: string[];
  inStock?: boolean;
  featured?: boolean;
  status: string;
  createdAt: string;
}

const COLLECTIONS = [
  { value: "all", label: "All Pieces", emoji: "✨" },
  { value: "earrings", label: "Earrings", emoji: "✨" },
  { value: "rings", label: "Rings", emoji: "💍" },
  { value: "necklaces", label: "Necklaces", emoji: "🌿" },
  { value: "bracelets", label: "Bracelets", emoji: "💛" },
  { value: "custom", label: "Custom Orders", emoji: "🎁" },
];

function CartButtons({ item }: { item: JewelryItem }) {
  const { addItem, removeItem, isInCart } = useCart();
  const cartId = `jewelry-${item.id}`;
  const inCart = isInCart(cartId);

  if (!item.price || item.inStock === false) return null;

  return (
    <div className="pt-3 border-t border-rose-100 space-y-2.5">
      <Button
        className={`w-full py-5 text-base font-semibold rounded-xl ${
          inCart
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "bg-rose-500 hover:bg-rose-600 text-white"
        }`}
        onClick={() => {
          if (inCart) {
            removeItem(cartId);
          } else {
            addItem({
              id: cartId,
              referenceId: item.id,
              name: item.title,
              price: parseFloat(item.price!),
              image: item.imageUrl || "",
              type: "jewelry",
            });
          }
        }}
      >
        {inCart ? (
          <><Check className="h-5 w-5 mr-2" /> In Cart</>
        ) : (
          <><ShoppingCart className="h-5 w-5 mr-2" /> Add to Cart</>
        )}
      </Button>

      <Link
        href="/cart"
        onClick={() => {
          if (!inCart) addItem({
            id: cartId,
            referenceId: item.id,
            name: item.title,
            price: parseFloat(item.price!),
            image: item.imageUrl || "",
            type: "jewelry",
          });
        }}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-orange-400/40 bg-orange-50 hover:bg-orange-100 transition-colors"
      >
        <Bitcoin className="h-4 w-4 text-orange-500" />
        <span className="text-orange-600 text-sm font-medium">Crypto checkout</span>
        <span className="inline-flex items-center bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Save 5%</span>
      </Link>
    </div>
  );
}

function WalletUsdBalanceBanner() {
  const { data } = useQuery<{ cashBalance?: string }>({ queryKey: ["/api/wallet/balance"] });
  const balance = parseFloat(data?.cashBalance || "0");
  if (balance <= 0) return null;
  return (
    <div className="mb-3 bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-300 rounded-xl px-4 py-3 flex items-center gap-3">
      <span className="text-xl">💵</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-emerald-800">
          You have ${balance.toFixed(2)} in JCMOVES USD shop credit
        </p>
        <p className="text-xs text-emerald-700">
          Tap any piece you can afford to pay in full with your balance — no card needed.
        </p>
      </div>
    </div>
  );
}

function WishlistHeart({ item, wishlist, onToggle }: { item: JewelryItem; wishlist: Set<string>; onToggle: (id: string) => void }) {
  const isWishlisted = wishlist.has(item.id);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(item.id); }}
      className={`absolute top-2.5 right-2.5 z-10 w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-all duration-200 ${
        isWishlisted ? "bg-rose-500 text-white" : "bg-white/90 text-rose-400 hover:bg-rose-50"
      }`}
      aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
    >
      <Heart className={`h-4 w-4 ${isWishlisted ? "fill-white" : ""}`} />
    </button>
  );
}

export default function AshleyShop() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedItem, setSelectedItem] = useState<JewelryItem | null>(null);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hoveredItem, setHoveredItem] = useState<JewelryItem | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wishlist, setWishlist] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("ashley-wishlist") || "[]")); } catch { return new Set(); }
  });
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [customOrderOpen, setCustomOrderOpen] = useState(false);
  const [customOrderForm, setCustomOrderForm] = useState({ name: "", description: "", materials: "", budget: "", contact: "" });
  const [customOrderSubmitting, setCustomOrderSubmitting] = useState(false);
  const [newItemFeatured, setNewItemFeatured] = useState(false);

  const toggleWishlist = (id: string) => {
    setWishlist(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("ashley-wishlist", JSON.stringify([...next]));
      return next;
    });
  };

  useEffect(() => {
    return () => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); };
  }, []);

  useEffect(() => {
    if (selectedItem) {
      document.body.style.overflow = 'hidden';
      const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedItem(null); };
      window.addEventListener('keydown', handleEsc);
      return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', handleEsc); };
    } else {
      document.body.style.overflow = '';
    }
  }, [selectedItem]);

  const [newItem, setNewItem] = useState({
    title: "",
    shortDescription: "",
    description: "",
    price: "",
    category: "",
    materials: "",
    imageUrl: "",
  });

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<JewelryItem | null>(null);
  const [editPhotoUrls, setEditPhotoUrls] = useState<string[]>([]);
  const [editPhotoUrl, setEditPhotoUrl] = useState("");
  const [isEditUploading, setIsEditUploading] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<JewelryItem | null>(null);

  type ChatStep = 'photos' | 'title' | 'category' | 'price' | 'materials' | 'shortDesc' | 'description' | 'confirm' | 'done';
  type ChatMsg = { role: 'bot' | 'user'; content: string };
  const [chatOpen, setChatOpen] = useState(false);
  const [chatStep, setChatStep] = useState<ChatStep>('photos');
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatUploading, setChatUploading] = useState(false);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [chatData, setChatData] = useState({ photos: [] as string[], title: '', category: '', price: '', materials: '', shortDesc: '', description: '' });

  const scrollChat = () => setTimeout(() => chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' }), 60);
  const botSay = (content: string) => { setChatMessages(prev => [...prev, { role: 'bot', content }]); scrollChat(); };
  const userSay = (content: string) => { setChatMessages(prev => [...prev, { role: 'user', content }]); scrollChat(); };

  const chatCreateMutation = useMutation({
    mutationFn: (item: any) => apiRequest("POST", "/api/jewelry", item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jewelry"] });
      botSay("🌸 It's live! Your piece has been added to the shop. Want to add another? Type \"yes\" to start over.");
      setChatStep('done');
    },
    onError: (err: any) => botSay(`Something went wrong: ${err.message}. Try again?`),
  });

  useEffect(() => {
    if (chatOpen && chatMessages.length === 0) {
      setChatStep('photos');
      setChatData({ photos: [], title: '', category: '', price: '', materials: '', shortDesc: '', description: '' });
      botSay("Hey! I'm your Ashley Shop listing assistant 🌸\n\nLet's get a new piece added to the shop. Start by uploading photos or videos — tap the button below!");
    }
  }, [chatOpen]);

  async function handleChatUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setChatUploading(true);
    const uploaded: string[] = [];
    let videoCount = 0;
    for (const file of Array.from(files)) {
      try {
        if (file.type.startsWith('video/')) videoCount++;
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/jewelry/upload', { method: 'POST', body: fd, credentials: 'include' });
        const data = await res.json();
        if (data.url) uploaded.push(data.url);
      } catch { /* skip */ }
    }
    setChatUploading(false);
    if (uploaded.length === 0) { botSay("Hmm, that upload failed. Please try again."); return; }
    setChatData(prev => ({ ...prev, photos: [...prev.photos, ...uploaded] }));
    const photoCount = uploaded.length - videoCount;
    const label = videoCount > 0 && photoCount > 0
      ? `${photoCount} photo${photoCount > 1 ? 's' : ''} & ${videoCount} video${videoCount > 1 ? 's' : ''}`
      : videoCount > 0
        ? `${videoCount} video${videoCount > 1 ? 's' : ''}`
        : `${uploaded.length} photo${uploaded.length > 1 ? 's' : ''}`;
    userSay(`📸 Uploaded ${label}`);
    setTimeout(() => {
      botSay(`Got it! ${uploaded.length > 1 ? 'Looking great — beautiful media.' : 'Looks great!'} You can upload more or move on.\n\nWhat's the name of this piece?`);
      setChatStep('title');
    }, 400);
  }

  function handleChatSend() {
    const text = chatInput.trim();
    if (!text && chatStep !== 'done') return;
    if (text) { userSay(text); setChatInput(''); }

    if (chatStep === 'title') {
      setChatData(d => ({ ...d, title: text }));
      const lower = text.toLowerCase();
      const suggested = lower.match(/earring|stud|hoop|dangle/) ? 'earrings'
        : lower.match(/ring|band|solitaire/) ? 'rings'
        : lower.match(/necklace|pendant|chain|choker|lariat/) ? 'necklaces'
        : lower.match(/bracelet|bangle|cuff|anklet/) ? 'bracelets'
        : lower.match(/custom|commission|request|order/) ? 'custom'
        : null;
      if (suggested) {
        const match = COLLECTIONS.find(c => c.value === suggested)!;
        setChatData(d => ({ ...d, category: suggested }));
        setTimeout(() => {
          botSay(`Beautiful name! I'm guessing this is in ${match.emoji} ${match.label} — does that sound right? Tap to confirm or pick a different category.`);
          setChatStep('category');
        }, 400);
      } else {
        setTimeout(() => { botSay("Beautiful name! What category does it fall under?"); setChatStep('category'); }, 400);
      }
    } else if (chatStep === 'price') {
      const clean = text.replace(/[$,\s]/g, '');
      if (isNaN(Number(clean))) { botSay("Just the number please — like 45 or 120."); return; }
      setChatData(d => ({ ...d, price: clean }));
      setTimeout(() => { botSay("Got it! What materials is it made from?\n(e.g. sterling silver, turquoise, copper wire)"); setChatStep('materials'); }, 400);
    } else if (chatStep === 'materials') {
      setChatData(d => ({ ...d, materials: text }));
      setTimeout(() => { botSay("Love it! Now give me a short tagline — one or two punchy sentences customers will see first."); setChatStep('shortDesc'); }, 400);
    } else if (chatStep === 'shortDesc') {
      setChatData(d => ({ ...d, shortDesc: text }));
      setTimeout(() => { botSay("Perfect. Any longer description — story behind it, sizing, care tips? Or type \"skip\" to leave it blank."); setChatStep('description'); }, 400);
    } else if (chatStep === 'description') {
      const desc = text.toLowerCase() === 'skip' ? '' : text;
      const updated = { ...chatData, description: desc };
      setChatData(updated);
      const summary = `Here's your listing preview:\n\n📸 ${updated.photos.length} media file${updated.photos.length > 1 ? 's' : ''}\n✏️ Name: ${updated.title}\n🏷 Category: ${updated.category}\n💲 Price: $${updated.price}\n🔮 Materials: ${updated.materials}\n📝 Tagline: ${updated.shortDesc}${updated.description ? '\n📖 Description: ' + updated.description.slice(0, 80) + (updated.description.length > 80 ? '…' : '') : ''}\n\nReady to publish? Reply "yes" to list it or "no" to cancel.`;
      setTimeout(() => { botSay(summary); setChatStep('confirm'); }, 400);
    } else if (chatStep === 'confirm') {
      if (text.toLowerCase().startsWith('y')) {
        botSay("Adding it to the shop with love… 🌸");
        chatCreateMutation.mutate({ title: chatData.title, shortDescription: chatData.shortDesc, description: chatData.description, price: chatData.price, category: chatData.category, materials: chatData.materials, imageUrl: chatData.photos[0] || '', photos: chatData.photos.slice(1), inStock: true, featured: false, status: 'active' });
      } else {
        botSay("No problem! I've cleared everything. Type \"restart\" whenever you want to add a new piece.");
        setChatStep('done');
      }
    } else if (chatStep === 'done') {
      setChatMessages([]);
      setChatData({ photos: [], title: '', category: '', price: '', materials: '', shortDesc: '', description: '' });
      botSay("Let's add another piece! 🌸 Upload a photo to get started.");
      setChatStep('photos');
    }
  }

  const [, navigate] = useLocation();
  const isAdmin = user?.role === 'admin' || user?.role === 'business_owner';
  const canAdd = isAdmin || user?.role === 'employee';

  const canEditItem = (item: JewelryItem) => {
    if (!user) return false;
    if (isAdmin) return true;
    return item.postedBy === user.id;
  };

  const { data: items = [], isLoading, isError: catalogError, refetch: retryCatalog } = useQuery<JewelryItem[]>({
    queryKey: ["/api/jewelry", { category: selectedCategory !== "all" ? selectedCategory : undefined, search: searchQuery }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCategory !== "all") params.append("category", selectedCategory);
      if (searchQuery) params.append("search", searchQuery);
      const res = await fetch(`/api/jewelry?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
  });

  const { data: dailyFeatured } = useQuery<JewelryItem & { featuredDiscountPercent?: number; featuredRewardBonusMoves?: number }>({
    queryKey: ["/api/ashley-shop/featured"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: ratingStats } = useQuery<{ averageRating?: number; totalCount?: number }>({
    queryKey: ["/api/testimonials/stats"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: allItems = [] } = useQuery<JewelryItem[]>({
    queryKey: ["/api/jewelry"],
    queryFn: async () => {
      const res = await fetch("/api/jewelry", { credentials: 'include' });
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: wishlist.size > 0,
    staleTime: 30 * 1000,
  });

  const wishlistedItems = (allItems.length > 0 ? allItems : items).filter(i => wishlist.has(i.id));

  const createMutation = useMutation({
    mutationFn: (item: any) => apiRequest("POST", "/api/jewelry", item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jewelry"] });
      setIsCreateOpen(false);
      setNewItem({ title: "", shortDescription: "", description: "", price: "", category: "", materials: "", imageUrl: "" });
      setPhotoUrls([]);
      setNewItemFeatured(false);
      toast({ title: "Piece added to the shop!" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/jewelry/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jewelry"] });
      setIsEditOpen(false);
      setEditItem(null);
      setSelectedItem(null);
      toast({ title: "Item updated!" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/jewelry/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jewelry"] });
      setSelectedItem(null);
      setDeleteConfirmOpen(false);
      setItemToDelete(null);
      toast({ title: "Item deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const soldMutation = useMutation({
    mutationFn: async ({ id, sold }: { id: string; sold: boolean }) => {
      return await apiRequest("PATCH", `/api/jewelry/${id}/sold`, { sold });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jewelry"] });
      if (selectedItem && selectedItem.id === variables.id) {
        setSelectedItem({ ...selectedItem, inStock: !variables.sold, status: variables.sold ? 'sold' : 'active' });
      }
      toast({ title: variables.sold ? "Item marked as sold" : "Item marked as available" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const startEdit = (item: JewelryItem) => {
    setEditItem({ ...item });
    setEditPhotoUrls(getItemPhotos(item));
    setSelectedItem(null);
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!editItem) return;
    const updateData = {
      title: editItem.title,
      shortDescription: editItem.shortDescription,
      description: editItem.description,
      price: editItem.price && editItem.price !== '' ? editItem.price : '0.00',
      category: editItem.category,
      materials: editItem.materials,
      featured: editItem.featured,
      imageUrl: editPhotoUrls[0] || editItem.imageUrl,
      photos: editPhotoUrls,
    };
    updateMutation.mutate({ id: editItem.id, data: updateData });
  };

  const handleEditFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = 10 - editPhotoUrls.length;
    const filesToUpload = Array.from(files).slice(0, remaining);
    setIsEditUploading(true);
    try {
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/jewelry/upload', { method: 'POST', credentials: 'include', body: formData });
        if (!res.ok) { const errData = await res.json().catch(() => ({})); throw new Error(errData.detail || errData.error || `Server error ${res.status}`); }
        const { url } = await res.json();
        setEditPhotoUrls(prev => [...prev, url]);
      }
      toast({ title: `${filesToUpload.length} file(s) uploaded` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsEditUploading(false);
      if (editFileInputRef.current) editFileInputRef.current.value = '';
    }
  };

  const handleCreate = () => {
    if (!newItem.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    createMutation.mutate({
      ...newItem,
      imageUrl: photoUrls[0] || newItem.imageUrl,
      photos: photoUrls,
      featured: newItemFeatured,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = 10 - photoUrls.length;
    const filesToUpload = Array.from(files).slice(0, remaining);
    setIsUploading(true);
    try {
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/jewelry/upload', { method: 'POST', credentials: 'include', body: formData });
        if (!res.ok) { const errData = await res.json().catch(() => ({})); throw new Error(errData.detail || errData.error || `Server error ${res.status}`); }
        const { url } = await res.json();
        setPhotoUrls(prev => [...prev, url]);
      }
      toast({ title: `${filesToUpload.length} file(s) uploaded` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getItemPhotos = (item: JewelryItem) => {
    const photos: string[] = [];
    if (item.imageUrl) photos.push(item.imageUrl);
    if (item.photos && Array.isArray(item.photos)) {
      photos.push(...item.photos.filter((p: string) => p && !photos.includes(p)));
    }
    return photos.length > 0 ? photos : [];
  };

  const nextPhoto = () => {
    if (selectedItem) {
      const photos = getItemPhotos(selectedItem);
      setCurrentPhotoIndex((prev) => (prev + 1) % photos.length);
    }
  };

  const prevPhoto = () => {
    if (selectedItem) {
      const photos = getItemPhotos(selectedItem);
      setCurrentPhotoIndex((prev) => (prev - 1 + photos.length) % photos.length);
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const openItem = (item: JewelryItem) => {
    if (isMobile) {
      navigate(`/handmade-jewels-by-ashley/${item.id}`);
    } else {
      setSelectedItem(item);
      setCurrentPhotoIndex(0);
    }
  };

  const handleCustomOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustomOrderSubmitting(true);
    try {
      const res = await fetch('/api/jewelry/custom-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customOrderForm),
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }
      toast({ title: "Request sent! Ashley will reach out soon." });
      setCustomOrderOpen(false);
      setCustomOrderForm({ name: "", description: "", materials: "", budget: "", contact: "" });
    } catch (err: any) {
      toast({ title: "Failed to send request", description: err.message, variant: "destructive" });
    } finally {
      setCustomOrderSubmitting(false);
    }
  };

  const shareItem = (item: JewelryItem) => {
    const url = `${window.location.origin}/handmade-jewels-by-ashley/${item.id}`;
    navigator.clipboard.writeText(url)
      .then(() => toast({ title: "Link copied!" }))
      .catch(() => toast({ title: "Share link", description: url }));
  };

  const heights = ['aspect-[3/4]', 'aspect-[4/5]', 'aspect-square', 'aspect-[2/3]', 'aspect-[5/6]'];

  const avgPrice = (() => {
    const priced = items.filter(i => i.price && i.inStock !== false).map(i => parseFloat(i.price!));
    return priced.length > 0 ? priced.reduce((a, b) => a + b, 0) / priced.length : 0;
  })();

  const isGreatPrice = (item: JewelryItem) => {
    if (!item.price || item.inStock === false || avgPrice === 0) return false;
    return parseFloat(item.price) < avgPrice * 0.8;
  };

  const renderCard = (item: JewelryItem, origIdx: number) => {
    const photos = getItemPhotos(item);
    const itemHeight = heights[origIdx % heights.length];
    const greatPrice = isGreatPrice(item);
    const featuredToday = dailyFeatured?.id === item.id;
    return (
      <div
        key={item.id}
        className="relative group"
      >
        <Card
          className="overflow-hidden cursor-pointer group hover:shadow-xl transition-all duration-300 border-0 bg-white shadow-md shadow-rose-100/60"
          onClick={() => openItem(item)}
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const viewportW = window.innerWidth;
            const popupW = 320;
            let x = rect.right + 12;
            if (x + popupW > viewportW) x = rect.left - popupW - 12;
            if (x < 8) x = rect.left + rect.width / 2 - popupW / 2;
            let y = rect.top;
            if (y + 400 > window.innerHeight) y = window.innerHeight - 410;
            if (y < 8) y = 8;
            setHoverPos({ x, y });
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            hoverTimeout.current = setTimeout(() => setHoveredItem(item), 400);
          }}
          onMouseLeave={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            setHoveredItem(null);
          }}
        >
          <div className={`${itemHeight} relative overflow-hidden bg-rose-50`}>
            {photos.length > 0 ? (
              <MediaThumb
                src={photos[0]}
                alt={item.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Gem className="w-10 h-10 text-rose-200" />
              </div>
            )}

            {featuredToday && (
              <div className="absolute top-2 left-2 flex items-center gap-1 bg-amber-400/95 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                <Sparkles className="h-2.5 w-2.5" /> Today: 5% off + 500 Moves
              </div>
            )}

            {!featuredToday && greatPrice && (
              <div className="absolute top-2 left-2 flex items-center gap-1 bg-emerald-500/95 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                <Star className="h-2.5 w-2.5 fill-white" /> Great Price
              </div>
            )}

            {item.price && item.inStock !== false && (
              <div className="absolute bottom-2 left-2">
                <span className="bg-white/95 text-rose-600 font-bold text-xs px-2 py-0.5 rounded-full shadow">
                  ${item.price}
                </span>
              </div>
            )}

            {photos.length > 1 && (
              <span className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                +{photos.length - 1}
              </span>
            )}

            {!item.inStock && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="bg-white text-stone-800 px-2 py-0.5 rounded-full text-xs font-medium">Sold</span>
              </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>

          <div className="p-2.5">
            <h3 className="font-medium text-stone-800 text-sm line-clamp-1">{item.title}</h3>
            <p className="text-stone-400 text-xs line-clamp-1 mt-0.5">{item.shortDescription || item.category || "Handcrafted with love"}</p>
          </div>
        </Card>

        <WishlistHeart item={item} wishlist={wishlist} onToggle={toggleWishlist} />
      </div>
    );
  };

  const col0 = items.filter((_, i) => i % 2 === 0);
  const col1 = items.filter((_, i) => i % 2 === 1);
  const lg0 = items.filter((_, i) => i % 4 === 0);
  const lg1 = items.filter((_, i) => i % 4 === 1);
  const lg2 = items.filter((_, i) => i % 4 === 2);
  const lg3 = items.filter((_, i) => i % 4 === 3);

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(160deg, #fdf6f0 0%, #fef1f2 40%, #fff8f0 100%)" }}>

      <ShopSwitcher />
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur border-b border-rose-100/80 shadow-sm" style={{ background: "rgba(253,246,240,0.97)" }}>
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-stone-500 hover:text-rose-500">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-rose-400">🌸</span>
            <h1 className="font-serif text-base md:text-lg font-bold text-stone-700 leading-tight text-center">
              Handmade Jewels by Ashley<br className="hidden sm:block" /> <span className="text-rose-500">Made with Love</span>
            </h1>
            <span className="text-amber-400">✨</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setWishlistOpen(true)}
              className="relative p-2 rounded-full hover:bg-rose-50 transition-colors"
              aria-label="Wishlist"
            >
              <Heart className={`h-5 w-5 ${wishlist.size > 0 ? "fill-rose-500 text-rose-500" : "text-stone-400"}`} />
              {wishlist.size > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{wishlist.size}</span>
              )}
            </button>
            {!user && (
              <Link href="/login?redirect=/handmade-jewels-by-ashley">
                <Button variant="ghost" size="sm" className="text-rose-500 font-semibold text-xs">Login</Button>
              </Link>
            )}
            <a href="mailto:ashleyseegert64@gmail.com">
              <Button variant="ghost" size="sm"><Mail className="h-4 w-4 text-stone-500" /></Button>
            </a>
            <a href="tel:906-285-9312">
              <Button variant="ghost" size="sm"><Phone className="h-4 w-4 text-stone-500" /></Button>
            </a>
          </div>
        </div>
      </header>

      {/* Meet Ashley Hero */}
      <section className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #fff1f2 100%)" }}>
        <div className="container mx-auto px-4 py-10 md:py-14">
          <div className="flex flex-col md:flex-row items-center gap-8 max-w-4xl mx-auto">
            <div className="flex-shrink-0">
              <div className="relative w-32 h-32 md:w-44 md:h-44 rounded-full overflow-hidden border-4 border-white shadow-xl shadow-rose-200/50">
                <div className="w-full h-full bg-gradient-to-br from-rose-200 to-amber-100 flex items-center justify-center">
                  <video src={jewelryVideoSrc} autoPlay loop muted playsInline className="w-full h-full object-cover" />
                </div>
              </div>
              <div className="mt-3 text-center">
                <span className="text-xs text-rose-400 font-medium flex items-center justify-center gap-1">
                  <MapPin className="h-3 w-3" /> Michigan, with love 💛
                </span>
              </div>
            </div>
            <div className="text-center md:text-left">
              <p className="text-rose-400 text-sm font-semibold uppercase tracking-widest mb-1">Meet the Maker</p>
              <h2 className="text-3xl md:text-4xl font-serif font-bold text-stone-800 mb-3 leading-tight">
                Hi, I'm Ashley 🌸
              </h2>
              <p className="text-stone-600 leading-relaxed text-sm md:text-base max-w-lg">
                Every piece I make is hand-crafted with love right here in Michigan. I work with natural stones, copper wire, sterling silver, and materials I choose for their beauty and energy. Each creation is one-of-a-kind — made slowly, mindfully, and with intention.
              </p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center md:justify-start">
                {["Natural Stones", "Copper Wire", "Sterling Silver", "Custom Orders"].map(tag => (
                  <span key={tag} className="text-xs bg-rose-100 text-rose-600 px-2.5 py-1 rounded-full font-medium">{tag}</span>
                ))}
              </div>
              <div className="mt-4 flex gap-3 justify-center md:justify-start">
                <Button
                  onClick={() => setCustomOrderOpen(true)}
                  className="bg-rose-500 hover:bg-rose-600 text-white rounded-full px-5 py-2 text-sm font-semibold shadow-md"
                >
                  🎁 Request Custom Order
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-b from-transparent" style={{ background: "linear-gradient(to bottom, transparent, #fdf6f0)" }} />
      </section>

      {/* Collections Filter Row */}
      <div className="sticky top-14 z-40 border-b border-rose-100/80" style={{ background: "rgba(253,246,240,0.97)" }}>
        <div className="container mx-auto px-3 py-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {COLLECTIONS.map((col) => (
              <button
                key={col.value}
                onClick={() => setSelectedCategory(col.value)}
                className={`flex items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  selectedCategory === col.value
                    ? "bg-rose-500 text-white shadow-md shadow-rose-300/40"
                    : "bg-white text-stone-600 border border-stone-200 hover:border-rose-300 hover:text-rose-500"
                }`}
              >
                <span>{col.emoji}</span> {col.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search + Admin Controls */}
        <div className="container mx-auto px-3 pb-2 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
            <Input
              placeholder="Search pieces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-white/80 border-rose-200 h-8 text-sm rounded-full"
            />
          </div>
          {canAdd && (
            <div className="flex gap-2 ml-auto">
              {isAdmin && (
                <Button
                  onClick={() => setChatOpen(true)}
                  size="sm"
                  className="bg-gradient-to-r from-rose-400 to-amber-400 hover:from-rose-500 hover:to-amber-500 text-white rounded-full text-xs"
                >
                  <Bot className="h-3.5 w-3.5 mr-1" /> AI List
                </Button>
              )}
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-rose-500 hover:bg-rose-600 text-white rounded-full text-xs">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Piece
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="font-serif">Add New Piece</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Title *</Label>
                      <Input value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} placeholder="e.g., Turquoise Drop Earrings" />
                    </div>
                    <div>
                      <Label>Photos & Videos</Label>
                      <div className="space-y-2">
                        {photoUrls.map((url, index) => (
                          <div key={index} className="flex gap-2 items-center">
                            {isVideoUrl(url) ? (
                              <div className="w-12 h-12 rounded bg-rose-100 flex items-center justify-center"><Video className="h-5 w-5 text-rose-400" /></div>
                            ) : (
                              <img src={url} alt="" className="w-12 h-12 object-cover rounded" />
                            )}
                            <span className="text-sm text-stone-600 truncate flex-1">{url.split('/').pop()}</span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setPhotoUrls(photoUrls.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <Input value={newPhotoUrl} onChange={(e) => setNewPhotoUrl(e.target.value)} placeholder="Paste image URL..." onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newPhotoUrl.trim() && photoUrls.length < 10) { setPhotoUrls([...photoUrls, newPhotoUrl.trim()]); setNewPhotoUrl(""); } } }} className="flex-1" />
                          <Button type="button" variant="outline" onClick={() => { if (newPhotoUrl.trim() && photoUrls.length < 10) { setPhotoUrls([...photoUrls, newPhotoUrl.trim()]); setNewPhotoUrl(""); } }} disabled={!newPhotoUrl.trim() || photoUrls.length >= 10}><Plus className="h-4 w-4" /></Button>
                          <label className={`inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 w-10 cursor-pointer ${photoUrls.length >= 10 || isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,video/mp4,video/webm,video/ogg,video/quicktime" multiple className="sr-only" />
                            {isUploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ImagePlus className="h-4 w-4" />}
                          </label>
                        </div>
                        <p className="text-xs text-stone-500">{photoUrls.length}/10 photos & videos</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Price</Label>
                        <Input value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} placeholder="25.00" />
                      </div>
                      <div>
                        <Label>Category</Label>
                        <Select value={newItem.category} onValueChange={(v) => setNewItem({ ...newItem, category: v })}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            {COLLECTIONS.filter(c => c.value !== "all").map((cat) => (
                              <SelectItem key={cat.value} value={cat.value}>{cat.emoji} {cat.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Short Description</Label>
                      <Input value={newItem.shortDescription} onChange={(e) => setNewItem({ ...newItem, shortDescription: e.target.value })} placeholder="One line for thumbnail" />
                    </div>
                    <div>
                      <Label>Materials</Label>
                      <Input value={newItem.materials} onChange={(e) => setNewItem({ ...newItem, materials: e.target.value })} placeholder="Sterling silver, turquoise..." />
                    </div>
                    <div>
                      <Label>Full Description</Label>
                      <Textarea value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} placeholder="Tell the story of this piece..." rows={3} />
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                      <button
                        type="button"
                        onClick={() => setNewItemFeatured(!newItemFeatured)}
                        className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ${newItemFeatured ? "bg-amber-400" : "bg-stone-300"}`}
                      >
                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${newItemFeatured ? "left-5" : "left-1"}`} />
                      </button>
                      <div>
                        <p className="text-sm font-semibold text-stone-700 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-amber-500" /> Mark as Featured</p>
                        <p className="text-xs text-stone-400">Shows sparkle badge on the card</p>
                      </div>
                    </div>
                    <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full bg-rose-500 hover:bg-rose-600">
                      {createMutation.isPending ? "Adding..." : "Add to Shop"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </div>

      {/* Slim Video Banner */}
      <div className="w-full"
        style={{ background: "linear-gradient(90deg, #0d0704 0%, #2d1a0f 25%, #1e1208 50%, #2d1a0f 75%, #0d0704 100%)" }}>
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ backgroundImage: "repeating-linear-gradient(60deg, transparent, transparent 3px, rgba(180,100,30,0.12) 3px, rgba(180,100,30,0.12) 6px)" }} />
        <div className="relative flex items-center justify-between px-4 py-2.5 max-w-5xl mx-auto gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden border border-amber-700/50 shadow">
              <video
                src={jewelryVideoSrc}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="text-amber-400/80 text-[9px] uppercase tracking-widest leading-none mb-0.5">Handmade with love ♡</p>
              <p className="text-amber-100 font-serif font-bold text-sm md:text-base leading-tight truncate"
                style={{ fontFamily: "'Georgia', serif" }}>
                Handmade Jewels by Ashley — Made with Love
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
            <div className="flex items-center gap-2">
              {["Copper Wire", "Natural Stone", "Custom Designs"].map(f => (
                <span key={f} className="flex items-center gap-1 text-amber-100/70 text-[10px]">
                  <CheckCircle2 className="h-2.5 w-2.5 text-amber-500" />{f}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-amber-700/50 to-transparent" />
      </div>

      <main className="container mx-auto px-2 sm:px-3 py-3 sm:py-6">

        {/* JCMOVES Rewards Banner */}
        {!user ? (
          <div className="mb-4 bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-xl">🪙</span>
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-800">Earn JCMOVES Rewards on Every Purchase!</p>
              <p className="text-xs text-amber-700">Get 15 JCMOVES per $1 spent — usable on jewelry, moving, and more. <Link href="/register" className="underline font-semibold">Sign up free &rarr;</Link></p>
            </div>
          </div>
        ) : (
          <>
            <WalletUsdBalanceBanner />
            <div className="mb-4 bg-gradient-to-r from-purple-50 to-violet-50 border border-purple-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl">💎</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-purple-800">Earn JCMOVES on Every Purchase</p>
                <p className="text-xs text-purple-600">Tap any item to see your balance and apply a discount at checkout.</p>
              </div>
            </div>
          </>
        )}


        {isLoading ? (
          <div className="text-center text-rose-400 py-16 font-serif italic">Loading beautiful pieces...</div>
        ) : catalogError ? (
          <div role="alert" className="py-12 text-center text-stone-700">
            <p>Could not load Ashley’s shop. Please try again.</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => void retryCatalog()}>Retry shop</Button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🌸</div>
            <p className="text-stone-500 text-lg font-serif">No pieces found</p>
            <p className="text-stone-400 text-sm mt-2">
              {searchQuery ? "Try a different search" : "New pieces coming soon!"}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 items-start lg:hidden">
              <div className="flex flex-col gap-2 sm:gap-3">
                {col0.map((item, i) => renderCard(item, i * 2))}
              </div>
              <div className="flex flex-col gap-2 sm:gap-3 pt-12 sm:pt-16">
                {col1.map((item, i) => renderCard(item, i * 2 + 1))}
              </div>
            </div>

            <div className="hidden lg:grid lg:grid-cols-4 lg:gap-3 items-start">
              <div className="flex flex-col gap-3">
                {lg0.map((item, i) => renderCard(item, i * 4))}
              </div>
              <div className="flex flex-col gap-3 pt-16">
                {lg1.map((item, i) => renderCard(item, i * 4 + 1))}
              </div>
              <div className="flex flex-col gap-3 pt-8">
                {lg2.map((item, i) => renderCard(item, i * 4 + 2))}
              </div>
              <div className="flex flex-col gap-3 pt-20">
                {lg3.map((item, i) => renderCard(item, i * 4 + 3))}
              </div>
            </div>

            {hoveredItem && (
              <div
                className="fixed z-[100] pointer-events-none animate-in fade-in zoom-in-95 duration-200"
                style={{ left: hoverPos.x, top: hoverPos.y }}
              >
                <div className="w-80 bg-white rounded-xl shadow-2xl shadow-rose-200/60 border border-rose-100 overflow-hidden">
                  {getItemPhotos(hoveredItem).length > 0 ? (
                    <MediaThumb src={getItemPhotos(hoveredItem)[0]} alt={hoveredItem.title} className="w-full aspect-square object-cover" />
                  ) : (
                    <div className="w-full aspect-square bg-rose-50 flex items-center justify-center">
                      <Gem className="w-16 h-16 text-rose-200" />
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="font-serif font-bold text-stone-800 text-lg">{hoveredItem.title}</h3>
                    {hoveredItem.category && <p className="text-rose-500 text-sm capitalize">{hoveredItem.category}</p>}
                    {hoveredItem.price && <p className="text-rose-600 font-bold text-xl mt-1">${hoveredItem.price}</p>}
                    {hoveredItem.shortDescription && <p className="text-stone-500 text-sm mt-2 line-clamp-2">{hoveredItem.shortDescription}</p>}
                    <p className="text-rose-300 text-xs mt-3 italic">Click to view full details</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-rose-100 py-8 mt-8" style={{ background: "linear-gradient(135deg, #fdf2f8 0%, #fff8f0 100%)" }}>
        <div className="container mx-auto px-4 text-center space-y-3">
          <p className="font-serif text-stone-700 font-bold text-lg">Handmade Jewels by Ashley — Made with Love</p>
          <p className="text-rose-400 text-sm flex items-center justify-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Ships from Michigan with love 💛
          </p>
          <div className="flex items-center justify-center gap-4 text-sm text-stone-500">
            <a href="mailto:upmichiganstatemovers@gmail.com" className="flex items-center gap-1.5 hover:text-rose-500 transition-colors">
              <Mail className="h-3.5 w-3.5" /> Email Ashley
            </a>
            <a href="tel:906-285-9312" className="flex items-center gap-1.5 hover:text-rose-500 transition-colors">
              <Phone className="h-3.5 w-3.5" /> (906) 285-9312
            </a>
          </div>
          <div className="flex items-center justify-center gap-3 text-stone-400">
            <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" className="p-2 rounded-full hover:bg-rose-100 hover:text-rose-500 transition-colors" aria-label="Facebook">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="p-2 rounded-full hover:bg-rose-100 hover:text-rose-500 transition-colors" aria-label="Instagram">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
            </a>
            <a href="https://pinterest.com" target="_blank" rel="noopener noreferrer" className="p-2 rounded-full hover:bg-rose-100 hover:text-rose-500 transition-colors" aria-label="Pinterest">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z"/></svg>
            </a>
          </div>
          <button
            onClick={() => setCustomOrderOpen(true)}
            className="inline-flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-5 py-2 rounded-full text-sm font-semibold transition-colors"
          >
            🎁 Request a Custom Order
          </button>
        </div>
      </footer>

      {/* Wishlist Drawer */}
      {wishlistOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setWishlistOpen(false)} />
          <div className="relative z-50 w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-rose-100">
              <h2 className="font-serif font-bold text-stone-800 flex items-center gap-2">
                <Heart className="h-5 w-5 text-rose-500 fill-rose-500" /> My Wishlist ({wishlist.size})
              </h2>
              <button onClick={() => setWishlistOpen(false)} className="text-stone-400 hover:text-stone-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {wishlistedItems.length === 0 ? (
                <div className="text-center py-10">
                  <Heart className="h-12 w-12 text-rose-200 mx-auto mb-3" />
                  <p className="text-stone-400 font-serif italic">No saved pieces yet</p>
                  <p className="text-stone-400 text-xs mt-1">Tap the heart on any piece to save it here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {wishlistedItems.map(item => {
                    const photos = getItemPhotos(item);
                    return (
                      <div key={item.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-rose-50 transition-colors">
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-rose-50 flex-shrink-0">
                          {photos.length > 0 ? (
                            <img src={photos[0]} alt={item.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Gem className="h-6 w-6 text-rose-200" /></div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-stone-800 text-sm truncate">{item.title}</p>
                          {item.price && <p className="text-rose-500 font-bold text-sm">${item.price}</p>}
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => openItem(item)} className="p-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-600 transition-colors"><ExternalLink className="h-3.5 w-3.5" /></button>
                          <button onClick={() => toggleWishlist(item.id)} className="p-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-600 transition-colors"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedItem(null)} />
          <div className="relative z-50 w-full h-full md:w-[95vw] md:max-w-5xl md:h-[90vh] md:rounded-2xl bg-white overflow-hidden flex flex-col md:flex-row">
            <button
              onClick={() => setSelectedItem(null)}
              className="absolute top-3 right-3 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-2"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="relative w-full md:w-3/5 h-[50vh] md:h-full bg-rose-50 flex-shrink-0">
              {selectedItem.inStock === false && (
                <div className="absolute top-4 left-4 z-20">
                  <span className="bg-red-500 text-white font-bold text-sm px-4 py-1.5 rounded-full shadow-lg uppercase tracking-wider">Sold</span>
                </div>
              )}
              {selectedItem.featured && (
                <div className="absolute top-4 left-4 z-20 flex items-center gap-1 bg-amber-400 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                  <Sparkles className="h-3 w-3" /> Featured
                </div>
              )}
              {getItemPhotos(selectedItem).length > 0 ? (
                <>
                  <MediaItem src={getItemPhotos(selectedItem)[currentPhotoIndex]} alt={selectedItem.title} className="w-full h-full object-contain" />
                  {getItemPhotos(selectedItem).length > 1 && (
                    <>
                      <button onClick={prevPhoto} className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white rounded-full p-2.5 shadow-lg">
                        <ChevronLeft className="h-6 w-6" />
                      </button>
                      <button onClick={nextPhoto} className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/90 hover:bg-white rounded-full p-2.5 shadow-lg">
                        <ChevronRight className="h-6 w-6" />
                      </button>
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {getItemPhotos(selectedItem).map((_, i) => (
                          <button key={i} onClick={() => setCurrentPhotoIndex(i)} className={`w-2.5 h-2.5 rounded-full transition-colors shadow ${i === currentPhotoIndex ? 'bg-rose-500 scale-110' : 'bg-white/70'}`} />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center"><Gem className="w-24 h-24 text-rose-200" /></div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h1 className="text-2xl font-serif font-bold text-stone-800">{selectedItem.title}</h1>
                  {selectedItem.category && <p className="text-rose-500 capitalize text-sm mt-0.5">{selectedItem.category}</p>}
                  {ratingStats?.averageRating && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="flex items-center gap-0.5">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} className={`h-3.5 w-3.5 ${s <= Math.round(ratingStats.averageRating!) ? "fill-amber-400 text-amber-400" : "text-stone-300"}`} />
                        ))}
                      </div>
                      <span className="text-xs text-stone-500">{ratingStats.averageRating.toFixed(1)} · Ashley's Shop</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => shareItem(selectedItem)} className="p-2 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-500 transition-colors" title="Share"><Share2 className="h-4 w-4" /></button>
                  <WishlistHeart item={selectedItem} wishlist={wishlist} onToggle={toggleWishlist} />
                </div>
              </div>

              {selectedItem.price && (
                <p className="text-2xl font-bold text-rose-600">${selectedItem.price}</p>
              )}

              {selectedItem.materials && (
                <div className="bg-rose-50 rounded-xl p-3 border border-rose-100">
                  <p className="text-xs font-semibold text-rose-400 uppercase tracking-wide mb-1">Made With</p>
                  <p className="text-stone-700 text-sm">{selectedItem.materials}</p>
                </div>
              )}

              <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-1">Made with Love</p>
                <p className="text-stone-600 text-sm italic">Each piece is handcrafted by Ashley in Michigan — no two are exactly alike. Made slowly, mindfully, and with care.</p>
              </div>

              {selectedItem.shortDescription && (
                <p className="text-stone-600 text-sm font-medium italic">"{selectedItem.shortDescription}"</p>
              )}

              {selectedItem.description && (
                <div>
                  <p className="text-xs font-medium text-stone-400 uppercase tracking-wide">About this Piece</p>
                  <p className="text-stone-600 text-sm whitespace-pre-wrap mt-1">{selectedItem.description}</p>
                </div>
              )}

              <button
                onClick={() => { setSelectedItem(null); setCustomOrderOpen(true); }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-600 text-sm font-semibold transition-colors"
              >
                🎁 Request a Custom Order Like This
              </button>

              <CartButtons item={selectedItem} />

              {!selectedItem.inStock && (
                <div className="bg-stone-100 rounded-lg p-3 text-center">
                  <p className="text-stone-500 font-medium text-sm">This item has been sold — request a custom version!</p>
                </div>
              )}

              {canEditItem(selectedItem) && (
                <div className="space-y-2 pt-2 border-t border-stone-200">
                  <Button
                    variant={selectedItem.inStock === false ? "outline" : "default"}
                    size="sm"
                    className={selectedItem.inStock === false
                      ? "w-full border-green-400 text-green-600 hover:bg-green-50"
                      : "w-full bg-amber-500 hover:bg-amber-600 text-white"}
                    onClick={() => soldMutation.mutate({ id: selectedItem.id, sold: selectedItem.inStock !== false })}
                    disabled={soldMutation.isPending}
                  >
                    {selectedItem.inStock === false ? (
                      <><RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Mark Available</>
                    ) : (
                      <><Tag className="h-3.5 w-3.5 mr-1.5" /> Mark as Sold</>
                    )}
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 border-rose-300 text-rose-600" onClick={() => startEdit(selectedItem)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 border-red-300 text-red-600" onClick={() => { setItemToDelete(selectedItem); setDeleteConfirmOpen(true); }}>
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif">Edit Piece</DialogTitle>
          </DialogHeader>
          {editItem && (
            <div className="space-y-4">
              <div><Label>Title</Label><Input value={editItem.title} onChange={(e) => setEditItem({ ...editItem, title: e.target.value })} /></div>
              <div><Label>Price</Label><Input value={editItem.price || ""} onChange={(e) => setEditItem({ ...editItem, price: e.target.value })} placeholder="25.00" /></div>
              <div>
                <Label>Category</Label>
                <Select value={editItem.category || ""} onValueChange={(v) => setEditItem({ ...editItem, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {COLLECTIONS.filter(c => c.value !== "all").map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.emoji} {cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Materials</Label><Input value={editItem.materials || ""} onChange={(e) => setEditItem({ ...editItem, materials: e.target.value })} /></div>
              <div><Label>Short Description</Label><Input value={editItem.shortDescription || ""} onChange={(e) => setEditItem({ ...editItem, shortDescription: e.target.value })} /></div>
              <div><Label>Full Description</Label><Textarea value={editItem.description || ""} onChange={(e) => setEditItem({ ...editItem, description: e.target.value })} rows={4} /></div>
              <div>
                <Label>Photos</Label>
                <div className="space-y-2">
                  {editPhotoUrls.map((url, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      {isVideoUrl(url) ? (
                        <div className="w-12 h-12 rounded bg-rose-100 flex items-center justify-center"><Video className="h-5 w-5 text-rose-400" /></div>
                      ) : (
                        <img src={url} alt="" className="w-12 h-12 object-cover rounded" />
                      )}
                      <span className="text-sm text-stone-600 truncate flex-1">{url.split('/').pop()}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditPhotoUrls(editPhotoUrls.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input value={editPhotoUrl} onChange={(e) => setEditPhotoUrl(e.target.value)} placeholder="Paste image URL..." className="flex-1" />
                    <Button type="button" variant="outline" onClick={() => { if (editPhotoUrl.trim() && editPhotoUrls.length < 10) { setEditPhotoUrls([...editPhotoUrls, editPhotoUrl.trim()]); setEditPhotoUrl(""); } }}><Plus className="h-4 w-4" /></Button>
                    <label className={`inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 w-10 cursor-pointer ${editPhotoUrls.length >= 10 || isEditUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                      <input type="file" ref={editFileInputRef} onChange={handleEditFileUpload} accept="image/*,video/mp4,video/webm,video/ogg,video/quicktime" multiple className="sr-only" />
                      {isEditUploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ImagePlus className="h-4 w-4" />}
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <button
                  type="button"
                  onClick={() => setEditItem({ ...editItem, featured: !editItem.featured })}
                  className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ${editItem.featured ? "bg-amber-400" : "bg-stone-300"}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${editItem.featured ? "left-5" : "left-1"}`} />
                </button>
                <div>
                  <p className="text-sm font-semibold text-stone-700 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5 text-amber-500" /> Featured</p>
                  <p className="text-xs text-stone-400">Sparkle badge on card</p>
                </div>
              </div>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending} className="w-full bg-rose-500 hover:bg-rose-600">
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => itemToDelete && deleteMutation.mutate(itemToDelete.id)} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Custom Order Dialog */}
      <Dialog open={customOrderOpen} onOpenChange={setCustomOrderOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-stone-800">Request a Custom Order</DialogTitle>
          </DialogHeader>
          <p className="text-stone-500 text-sm -mt-2">Describe what you'd love - Ashley will reach out to discuss the details and pricing.</p>
          <form onSubmit={handleCustomOrderSubmit} className="space-y-4">
            <div><Label>Your Name *</Label><Input required value={customOrderForm.name} onChange={(e) => setCustomOrderForm({ ...customOrderForm, name: e.target.value })} placeholder="Your full name" /></div>
            <div><Label>What would you like? *</Label><Textarea required value={customOrderForm.description} onChange={(e) => setCustomOrderForm({ ...customOrderForm, description: e.target.value })} placeholder="Describe the piece - style, size, occasion..." rows={4} /></div>
            <div><Label>Preferred Materials</Label><Input value={customOrderForm.materials} onChange={(e) => setCustomOrderForm({ ...customOrderForm, materials: e.target.value })} placeholder="e.g. copper wire, rose quartz, sterling silver..." /></div>
            <div><Label>Budget Range</Label><Input value={customOrderForm.budget} onChange={(e) => setCustomOrderForm({ ...customOrderForm, budget: e.target.value })} placeholder="e.g. $25-$75" /></div>
            <div><Label>Contact (email or phone) *</Label><Input required value={customOrderForm.contact} onChange={(e) => setCustomOrderForm({ ...customOrderForm, contact: e.target.value })} placeholder="Best email or phone number" /></div>
            <Button type="submit" disabled={customOrderSubmitting} className="w-full bg-rose-500 hover:bg-rose-600">
              {customOrderSubmitting ? "Sending..." : "Send Request"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* AI Listing Chat */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/60" onClick={() => setChatOpen(false)} />
          <div className="relative z-50 w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col" style={{ height: '80vh' }}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-rose-100" style={{ background: "linear-gradient(135deg, #fdf2f8, #fff8f0)" }}>
              <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center"><Bot className="h-4 w-4 text-rose-500" /></div>
              <div>
                <p className="font-semibold text-stone-800 text-sm">Ashley Shop Assistant</p>
                <p className="text-rose-400 text-[10px]">AI Listing Creator</p>
              </div>
              <button onClick={() => { setChatOpen(false); setChatMessages([]); setChatStep('photos'); }} className="ml-auto text-stone-400 hover:text-stone-600"><X className="h-5 w-5" /></button>
            </div>

            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-rose-500 text-white rounded-br-sm'
                      : 'bg-rose-50 text-stone-700 rounded-bl-sm border border-rose-100'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatStep === 'category' && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {COLLECTIONS.filter(c => c.value !== "all").map(cat => (
                    <button key={cat.value} onClick={() => {
                      setChatData(d => ({ ...d, category: cat.value }));
                      userSay(`${cat.emoji} ${cat.label}`);
                      setTimeout(() => { botSay("Perfect! What's the price for this piece?"); setChatStep('price'); }, 400);
                    }} className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-full text-sm font-medium transition-colors">
                      {cat.emoji} {cat.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-rose-100 p-3 flex gap-2">
              {chatStep === 'photos' && (
                <label className={`flex items-center justify-center gap-1 px-3 h-10 rounded-full bg-rose-100 text-rose-500 cursor-pointer hover:bg-rose-200 transition-colors flex-shrink-0 ${chatUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input type="file" ref={chatFileRef} onChange={(e) => handleChatUpload(e.target.files)} accept="image/*,video/mp4,video/webm,video/ogg,video/quicktime" multiple className="sr-only" />
                  {chatUploading
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    : (<><ImagePlus className="h-4 w-4" /><Video className="h-4 w-4" /></>)}
                </label>
              )}
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                placeholder={chatStep === 'photos' ? "Upload a photo or video to start..." : "Type your reply..."}
                className="flex-1 rounded-full border-rose-200"
                disabled={chatStep === 'photos' || chatStep === 'category'}
              />
              <button
                onClick={handleChatSend}
                disabled={chatStep === 'photos' || chatStep === 'category' || !chatInput.trim()}
                className="w-10 h-10 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <ShopConcierge />
    </div>
  );
}
