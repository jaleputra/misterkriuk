import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { rupiah } from "@/lib/format";
import { useMemo, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/sold-products")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      dateFilter: (search.dateFilter as "today" | "7" | "14" | "30" | "month" | "all") || "14",
    };
  },
  ssr: false,
  component: SoldProductsDetail,
});

const CATEGORY_NAMES: Record<string, string> = {
  customer: "Customer",
  partner: "Partner",
  gudang: "Gudang",
};

const getCategoryDisplayName = (cat: string) => {
  return CATEGORY_NAMES[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
};

function SoldProductsDetail() {
  const navigate = useNavigate({ from: Route.fullPath });
  const searchParams = Route.useSearch();
  const dateFilter = searchParams.dateFilter || "14";
  const [search, setSearch] = useState("");

  const handleDateFilterChange = (val: "today" | "7" | "14" | "30" | "month" | "all") => {
    navigate({
      search: (prev) => ({
        ...prev,
        dateFilter: val,
      }),
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["sold-products-detail", dateFilter],
    queryFn: async () => {
      const since = new Date();
      if (dateFilter === "today") since.setHours(0, 0, 0, 0);
      else if (dateFilter === "7") since.setDate(since.getDate() - 6);
      else if (dateFilter === "14") since.setDate(since.getDate() - 13);
      else if (dateFilter === "30") since.setDate(since.getDate() - 29);
      else if (dateFilter === "month") since.setDate(1);
      else since.setFullYear(2020, 0, 1);
      since.setHours(0, 0, 0, 0);

      const [tx, items, prods] = await Promise.all([
        supabase.from("transactions").select("*").gte("created_at", since.toISOString()),
        supabase.from("transaction_items").select("*"),
        supabase.from("products").select("*"),
      ]);
      return {
        transactions: tx.data ?? [],
        items: items.data ?? [],
        products: prods.data ?? [],
      };
    },
    refetchInterval: 30000,
  });

  const transactions = data?.transactions ?? [];
  const items = data?.items ?? [];
  const products = data?.products ?? [];

  // Create product category lookup map
  const productCategoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    products.forEach((p) => {
      let cat = p.category || "customer";
      if (cat.startsWith("deleted_")) {
        cat = cat.replace("deleted_", "");
      }
      map[p.id] = cat;
    });
    return map;
  }, [products]);

  // Aggregate product sales
  const productSalesMap = useMemo(() => {
    const txIds = new Set(transactions.map((t) => t.id));
    const map: Record<string, {
      product_id: string | null;
      product_name: string;
      category: string;
      quantity: number;
      revenue: number;
    }> = {};

    items.forEach((item) => {
      if (txIds.has(item.transaction_id)) {
        const key = item.product_id || item.product_name;
        
        let cat = "customer";
        if (item.product_id && productCategoryMap[item.product_id]) {
          cat = productCategoryMap[item.product_id];
        } else if (item.product_name?.startsWith("[GUDANG]")) {
          cat = "gudang";
        }

        if (!map[key]) {
          map[key] = {
            product_id: item.product_id,
            product_name: item.product_name,
            category: cat,
            quantity: 0,
            revenue: 0,
          };
        }
        map[key].quantity += Number(item.quantity ?? 0);
        map[key].revenue += Number(item.subtotal ?? 0);
      }
    });

    return Object.values(map);
  }, [transactions, items, productCategoryMap]);

  // Calculate chicken pack information
  const packInfo = useMemo(() => {
    let dada = 0;
    let pahaAtas = 0;
    let pahaBawah = 0;
    let sayap = 0;

    productSalesMap.forEach((ps) => {
      const name = (ps.product_name || "").toLowerCase();
      const qty = ps.quantity;
      if (name.includes("dada")) {
        dada += qty;
      } else if (name.includes("paha atas")) {
        pahaAtas += qty;
      } else if (name.includes("paha bawah")) {
        pahaBawah += qty;
      } else if (name.includes("sayap")) {
        sayap += qty;
      }
    });

    const pDada = Math.floor(dada / 4);
    const pPahaAtas = Math.floor(pahaAtas / 2);
    const pPahaBawah = Math.floor(pahaBawah / 2);
    const pSayap = Math.floor(sayap / 2);

    const packs = Math.min(pDada, pPahaAtas, pPahaBawah, pSayap);

    return { packs, dada, pahaAtas, pahaBawah, sayap };
  }, [productSalesMap]);

  // Group and search sales by category
  const groupedSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    const groups: Record<string, typeof productSalesMap> = {};

    productSalesMap.forEach((ps) => {
      if (term && !ps.product_name.toLowerCase().includes(term)) {
        return;
      }
      const cat = ps.category;
      if (!groups[cat]) {
        groups[cat] = [];
      }
      groups[cat].push(ps);
    });

    // Sort each group by quantity descending
    Object.keys(groups).forEach((cat) => {
      groups[cat].sort((a, b) => b.quantity - a.quantity);
    });

    return groups;
  }, [productSalesMap, search]);

  const totalQty = useMemo(() => {
    return productSalesMap
      .filter((ps) => {
        if (!search.trim()) return true;
        return ps.product_name.toLowerCase().includes(search.trim().toLowerCase());
      })
      .reduce((sum, item) => sum + item.quantity, 0);
  }, [productSalesMap, search]);

  const totalRevenue = useMemo(() => {
    return productSalesMap
      .filter((ps) => {
        if (!search.trim()) return true;
        return ps.product_name.toLowerCase().includes(search.trim().toLowerCase());
      })
      .reduce((sum, item) => sum + item.revenue, 0);
  }, [productSalesMap, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Detail Produk Terjual</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter Waktu:</span>
          <Select value={dateFilter} onValueChange={handleDateFilterChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hari Ini</SelectItem>
              <SelectItem value="7">7 Hari Terakhir</SelectItem>
              <SelectItem value="14">14 Hari Terakhir</SelectItem>
              <SelectItem value="30">30 Hari Terakhir</SelectItem>
              <SelectItem value="month">Bulan Ini</SelectItem>
              <SelectItem value="all">Semua Waktu</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          placeholder="Cari nama produk..."
        />
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Memuat data produk terjual...</div>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Total Produk Terjual</div>
                <div className="text-2xl font-bold text-primary">{totalQty} Pcs</div>
                <div className="text-xs text-muted-foreground mt-0.5 font-semibold text-primary">
                  ({packInfo.packs} Pack Ayam Utuh)
                </div>
              </div>
              <div className="border-t pt-3 md:border-t-0 md:pt-0 md:border-x md:px-4 space-y-1">
                <div className="text-xs text-muted-foreground">Rincian Bagian Terjual:</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <div>Dada: <span className="font-semibold text-foreground">{packInfo.dada} pcs</span> <span className="text-[9px]">(4/pack)</span></div>
                  <div>Paha Atas: <span className="font-semibold text-foreground">{packInfo.pahaAtas} pcs</span> <span className="text-[9px]">(2/pack)</span></div>
                  <div>Paha Bawah: <span className="font-semibold text-foreground">{packInfo.pahaBawah} pcs</span> <span className="text-[9px]">(2/pack)</span></div>
                  <div>Sayap: <span className="font-semibold text-foreground">{packInfo.sayap} pcs</span> <span className="text-[9px]">(2/pack)</span></div>
                </div>
              </div>
              <div className="border-t pt-3 md:border-t-0 md:pt-0 md:text-right">
                <div className="text-xs text-muted-foreground">Total Omzet</div>
                <div className="text-2xl font-bold text-success">{rupiah(totalRevenue)}</div>
              </div>
            </CardContent>
          </Card>

          {Object.keys(groupedSales).length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground text-sm">
                Tidak ada produk terjual yang cocok.
              </CardContent>
            </Card>
          ) : (
            Object.entries(groupedSales).map(([category, salesItems]) => {
              const categoryQty = salesItems.reduce((s, it) => s + it.quantity, 0);
              const categoryRevenue = salesItems.reduce((s, it) => s + it.revenue, 0);

              return (
                <Card key={category} className="mt-4">
                  <div className="px-4 pt-4 pb-2 border-b">
                    <h2 className="text-base font-bold flex justify-between items-center">
                      <span>Kategori: {getCategoryDisplayName(category)}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {salesItems.length} Jenis Produk
                      </span>
                    </h2>
                  </div>
                  <CardContent className="p-2 md:p-4">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[80px]">No</TableHead>
                            <TableHead>Nama Produk</TableHead>
                            <TableHead className="text-right">Jumlah Terjual</TableHead>
                            <TableHead className="text-right">Omzet</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {salesItems.map((ps, idx) => (
                            <TableRow key={ps.product_id || ps.product_name}>
                              <TableCell className="font-medium">{idx + 1}</TableCell>
                              <TableCell className="font-semibold">{ps.product_name}</TableCell>
                              <TableCell className="text-right font-semibold text-primary">
                                {ps.quantity} Pcs
                              </TableCell>
                              <TableCell className="text-right font-bold text-success">
                                {rupiah(ps.revenue)}
                              </TableCell>
                            </TableRow>
                          ))}
                          {/* Summary Row for Category */}
                          <TableRow className="bg-muted/40 font-bold hover:bg-muted/40">
                            <TableCell colSpan={2}>
                              Total Kategori {getCategoryDisplayName(category)}
                            </TableCell>
                            <TableCell className="text-right text-primary">
                              {categoryQty} Pcs
                            </TableCell>
                            <TableCell className="text-right text-success">
                              {rupiah(categoryRevenue)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
