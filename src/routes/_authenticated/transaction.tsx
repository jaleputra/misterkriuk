import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { rupiah } from "@/lib/format";
import { toast } from "sonner";
import {
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Printer,
  Share2,
  X,
  Drumstick,
  Banknote,
  QrCode,
  Search,
  Users,
} from "lucide-react";
import { Receipt } from "@/components/Receipt";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { printReceiptPdf, shareReceiptPdf } from "@/lib/receipt-pdf.client";

export const Route = createFileRoute("/_authenticated/transaction")({
  ssr: false,
  component: TransactionPage,
});

type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  image_url?: string | null;
  originalPrice?: number;
  costPrice?: number;
};
type CartItem = { product: Product; qty: number };

function TransactionPage() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: rawProducts = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*").order("name");
      return (data ?? []) as Product[];
    },
  });
  const { data: stockCosts = [] } = useQuery({
    queryKey: ["latest_stock_costs"],
    queryFn: async () =>
      (
        await supabase
          .from("stock_movements")
          .select("product_id,initial_price,created_at")
          .order("created_at", { ascending: false })
      ).data ?? [],
  });
  const { data: settings } = useQuery({
    queryKey: ["printer_settings"],
    queryFn: async () =>
      (await supabase.from("printer_settings").select("*").eq("id", 1).maybeSingle()).data,
  });
  const { data: activeEvent } = useQuery({
    queryKey: ["events_today", today],
    queryFn: async () =>
      (
        await supabase
          .from("events")
          .select("*")
          .eq("event_date", today)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });
  const { data: eventItems = [] } = useQuery({
    queryKey: ["event_items_today", activeEvent?.id],
    enabled: !!activeEvent?.id,
    queryFn: async () => {
      if (!activeEvent?.id) return [];
      return (
        (await supabase.from("event_items").select("*").eq("event_id", activeEvent.id)).data ?? []
      );
    },
  });

  const applyAdj = (price: number, type: string, value: number) => {
    if (type === "percent_discount") return Math.max(0, Math.round(price * (1 - value / 100)));
    if (type === "fixed_discount") return Math.max(0, price - value);
    if (type === "set_price") return Math.max(0, value);
    return price;
  };
  const applyEvent = (price: number, productId: string) => {
    if (!activeEvent) return price;
    const override = eventItems.find((it: any) => it.product_id === productId);
    if (override)
      return applyAdj(price, override.adjustment_type, Number(override.adjustment_value));
    return applyAdj(price, activeEvent.adjustment_type, Number(activeEvent.adjustment_value));
  };

  const products = useMemo(
    () =>
      rawProducts.map((p) => ({
        ...p,
        originalPrice: Number(p.price),
        price: applyEvent(Number(p.price), p.id),
        costPrice: Number(stockCosts.find((cost) => cost.product_id === p.id)?.initial_price ?? 0),
      })),
    [rawProducts, activeEvent, eventItems, stockCosts],
  );

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "qris">("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [saleCategory, setSaleCategory] = useState<"customer" | "partner">("customer");
  const [partnerName, setPartnerName] = useState("");
  const [search, setSearch] = useState("");
  const [lastTx, setLastTx] = useState<any>(null);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("id-ID");
    return products.filter(
      (product) =>
        product.category === saleCategory &&
        (term.length < 3 || product.name.toLocaleLowerCase("id-ID").includes(term)),
    );
  }, [products, saleCategory, search]);

  const total = useMemo(
    () => cart.reduce((s, i) => s + Number(i.product.price) * i.qty, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);
  const change = Math.max(0, Number(cashReceived || 0) - total);

  const addToCart = (p: Product) => {
    if (p.stock <= 0) return;
    setCart((c) => {
      const ex = c.find((i) => i.product.id === p.id);
      if (ex) {
        if (ex.qty >= p.stock) {
          toast.warning("Stok tidak cukup");
          return c;
        }
        return c.map((i) => (i.product.id === p.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...c, { product: p, qty: 1 }];
    });
  };
  const changeQty = (id: string, d: number) => {
    setCart((c) =>
      c.flatMap((i) => {
        if (i.product.id !== id) return [i];
        const q = i.qty + d;
        if (q <= 0) return [];
        if (q > i.product.stock) {
          toast.warning("Stok tidak cukup");
          return [i];
        }
        return [{ ...i, qty: q }];
      }),
    );
  };
  const removeItem = (id: string) => setCart((c) => c.filter((i) => i.product.id !== id));

  const checkout = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("Keranjang kosong");
      if (saleCategory === "partner" && !partnerName.trim())
        throw new Error("Nama partner wajib diisi");
      if (payMethod === "cash" && Number(cashReceived) < total)
        throw new Error("Uang tunai kurang");
      const { data: u } = await supabase.auth.getUser();
      const { data: tx, error } = await supabase
        .from("transactions")
        .insert({
          total,
          payment_method: payMethod,
          cash_received: payMethod === "cash" ? Number(cashReceived) : null,
          change_amount: payMethod === "cash" ? change : null,
          cashier_id: u.user?.id,
          sale_category: saleCategory,
          partner_name: saleCategory === "partner" ? partnerName.trim() : null,
        })
        .select()
        .single();
      if (error) throw error;

      const items = cart.map((i) => ({
        transaction_id: tx.id,
        product_id: i.product.id,
        product_name: i.product.name,
        price: Number(i.product.price),
        quantity: i.qty,
        subtotal: Number(i.product.price) * i.qty,
        cost_price: Number(i.product.costPrice ?? 0),
      }));
      const { error: e2 } = await supabase.from("transaction_items").insert(items);
      if (e2) throw e2;

      for (const i of cart) {
        await supabase
          .from("products")
          .update({ stock: i.product.stock - i.qty })
          .eq("id", i.product.id);
      }
      return { tx, items };
    },
    onSuccess: ({ tx, items }) => {
      setLastTx({ ...tx, items });
      setCheckoutOpen(false);
      setCartOpen(false);
      setReceiptOpen(true);
      setCart([]);
      setCashReceived("");
      setPartnerName("");
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ProductGrid = (
    <>
      <div className="mb-3 grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
        <Select
          value={saleCategory}
          onValueChange={(value) => {
            setSaleCategory(value as "customer" | "partner");
            setCart([]);
            setPartnerName("");
          }}
        >
          <SelectTrigger aria-label="Kategori checkout">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            placeholder="Ketik minimal 3 huruf untuk mencari produk"
          />
        </div>
      </div>
      {activeEvent && (
        <div className="mb-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary flex items-center gap-2">
          🎉 Event aktif: <span className="font-bold">{activeEvent.name}</span>
          <span className="text-xs opacity-80">
            (
            {activeEvent.adjustment_type === "percent_discount"
              ? `Diskon ${activeEvent.adjustment_value}%`
              : activeEvent.adjustment_type === "fixed_discount"
                ? `Potongan ${rupiah(activeEvent.adjustment_value)}`
                : `Harga ${rupiah(activeEvent.adjustment_value)}`}
            )
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {visibleProducts.map((p) => {
          const out = p.stock <= 0;
          return (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              disabled={out}
              className={[
                "group relative text-left rounded-2xl border bg-card p-3 transition-all",
                out
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:border-primary hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98]",
              ].join(" ")}
            >
              <div className="aspect-square rounded-xl bg-gradient-to-br from-secondary/40 to-accent/40 grid place-items-center mb-2 overflow-hidden">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <Drumstick className="h-10 w-10 text-primary/70" />
                )}
              </div>
              <div className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
                {p.name}
              </div>
              <div className="flex items-center justify-between mt-1">
                <div className="flex flex-col leading-tight">
                  <span className="text-primary font-bold text-sm">{rupiah(p.price)}</span>
                  {activeEvent && p.originalPrice !== p.price && (
                    <span className="text-[10px] text-muted-foreground line-through">
                      {rupiah(p.originalPrice)}
                    </span>
                  )}
                </div>
                {out ? (
                  <Badge variant="destructive" className="text-[10px]">
                    Habis
                  </Badge>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Stok {p.stock}</span>
                )}
              </div>
            </button>
          );
        })}
        {visibleProducts.length === 0 && (
          <div className="col-span-full text-center text-muted-foreground py-10">
            Tidak ada produk {saleCategory === "partner" ? "partner" : "customer"} yang sesuai.
          </div>
        )}
      </div>
    </>
  );

  const CartPanel = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-1 pb-2">
        <h2 className="font-bold text-base flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" />
          Keranjang
          {cartCount > 0 && <Badge variant="secondary">{cartCount}</Badge>}
        </h2>
        {cart.length > 0 && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCart([])}>
            <X className="h-3 w-3 mr-1" />
            Kosongkan
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[100px]">
        {cart.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-10">
            Pilih produk untuk mulai
          </div>
        )}
        {cart.map((i) => (
          <div key={i.product.id} className="flex items-center gap-2 p-2 rounded-lg border bg-card">
            <div className="h-10 w-10 rounded-md overflow-hidden bg-muted shrink-0 grid place-items-center">
              {i.product.image_url ? (
                <img src={i.product.image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <Drumstick className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{i.product.name}</div>
              <div className="text-xs text-muted-foreground">{rupiah(i.product.price * i.qty)}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => changeQty(i.product.id, -1)}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-6 text-center text-sm font-semibold">{i.qty}</span>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => changeQty(i.product.id, 1)}
              >
                <Plus className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => removeItem(i.product.id)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t pt-3 mt-2 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Total</span>
          <span className="text-2xl font-bold text-primary">{rupiah(total)}</span>
        </div>
        <Button
          className="w-full h-12 text-base"
          disabled={cart.length === 0}
          onClick={() => setCheckoutOpen(true)}
        >
          Checkout
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop / tablet: split layout */}
      <div className="md:grid md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_400px] md:gap-4">
        <div className="pb-4">{ProductGrid}</div>
        <aside className="hidden md:flex md:flex-col sticky top-20 self-start h-[calc(100dvh-11rem)] rounded-2xl border bg-card/50 p-3">
          {CartPanel}
        </aside>
      </div>

      {/* Mobile floating cart */}
      {cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="md:hidden fixed bottom-24 right-4 z-30 h-14 px-5 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center gap-3 hover:scale-105 transition"
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="font-semibold">
            {cartCount} item · {rupiah(total)}
          </span>
        </button>
      )}

      {/* Mobile cart drawer */}
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="max-w-md md:hidden">
          <DialogHeader>
            <DialogTitle>Keranjang</DialogTitle>
          </DialogHeader>
          <div className="h-[60vh]">{CartPanel}</div>
        </DialogContent>
      </Dialog>

      {/* Checkout */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pembayaran</DialogTitle>
          </DialogHeader>
          <div className="text-center py-3">
            <div className="text-xs text-muted-foreground">Total Tagihan</div>
            <div className="text-3xl font-bold text-primary">{rupiah(total)}</div>
          </div>
          {saleCategory === "partner" && (
            <div className="space-y-1.5">
              <Label htmlFor="partner-name">Nama Partner</Label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="partner-name"
                  value={partnerName}
                  onChange={(event) => setPartnerName(event.target.value)}
                  className="pl-9"
                  placeholder="Masukkan nama partner"
                  required
                />
              </div>
            </div>
          )}
          <Tabs value={payMethod} onValueChange={(v) => setPayMethod(v as any)}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="cash">
                <Banknote className="h-4 w-4 mr-2" />
                Cash
              </TabsTrigger>
              <TabsTrigger value="qris">
                <QrCode className="h-4 w-4 mr-2" />
                QRIS
              </TabsTrigger>
            </TabsList>
            <TabsContent value="cash" className="space-y-3 pt-3">
              <div>
                <label className="text-sm font-medium">Uang Diterima</label>
                <Input
                  type="number"
                  min="0"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  className="text-lg font-semibold"
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  {[total, 50000, 100000, 200000].map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCashReceived(String(q))}
                      className="px-3 py-1.5 rounded-md border text-xs hover:bg-accent"
                    >
                      {rupiah(q)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-success/10 border border-success/30">
                <span className="font-medium">Kembalian</span>
                <span className="text-xl font-bold text-success">{rupiah(change)}</span>
              </div>
            </TabsContent>
            <TabsContent value="qris" className="pt-3">
              <div className="aspect-square max-w-[220px] mx-auto rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/30 grid place-items-center border-2 border-dashed">
                <div className="text-center">
                  <QrCode className="h-20 w-20 text-primary mx-auto" />
                  <div className="text-xs mt-2 text-muted-foreground">Scan untuk membayar</div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckoutOpen(false)}>
              Batal
            </Button>
            <Button onClick={() => checkout.mutate()} disabled={checkout.isPending}>
              Bayar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Struk Pembayaran</DialogTitle>
          </DialogHeader>
          {lastTx && <Receipt tx={lastTx} settings={settings} />}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                try {
                  printReceiptPdf(lastTx, settings);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Gagal membuka PDF");
                }
              }}
            >
              <Printer className="h-4 w-4 mr-2" />
              Cetak PDF
            </Button>
            <Button
              className="flex-1 bg-success text-success-foreground hover:bg-success/90"
              onClick={async () => {
                try {
                  await shareReceiptPdf(lastTx, settings);
                } catch (error) {
                  toast.info(
                    error instanceof Error ? error.message : "Tidak dapat membagikan PDF",
                  );
                }
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Bagikan PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
