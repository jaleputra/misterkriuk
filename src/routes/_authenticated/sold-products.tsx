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
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/sold-products")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      dateFilter: (search.dateFilter as "today" | "7" | "14" | "30" | "month" | "all") || "14",
      fromDate: (search.fromDate as string) || undefined,
      toDate: (search.toDate as string) || undefined,
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
  const { role: rawRole, user, branchName } = useAuth();
  const isExplicitKasir = user?.email?.toLowerCase().trim() === "kasir@gmail.com" || user?.email?.toLowerCase().includes("kasir");
  const role: "admin" | "cashier" = isExplicitKasir
    ? "cashier"
    : rawRole || (user?.email?.toLowerCase().trim() === "jaleputra69@gmail.com" ? "admin" : "cashier");

  const { data: userRoles = [] } = useQuery({
    queryKey: ["user_roles_branch_map"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id, role, branch_name");
      return data ?? [];
    },
  });

  const cashierBranchMap = useMemo(() => {
    const map: Record<string, string> = {};
    userRoles.forEach((ur: any) => {
      if (ur.user_id && ur.branch_name) {
        map[ur.user_id] = ur.branch_name;
      }
    });
    return map;
  }, [userRoles]);

  const branchMatch = (b1?: string | null, b2?: string | null) => {
    if (!b1 || !b2) return false;
    return b1.trim().toLowerCase() === b2.trim().toLowerCase();
  };

  const getTxBranch = (t: any) => {
    if (t.branch_name?.trim()) return t.branch_name.trim();
    if (t.cashier_id && cashierBranchMap[t.cashier_id]) return cashierBranchMap[t.cashier_id];
    return null;
  };

  const searchParams = Route.useSearch();
  const dateFilter = searchParams.dateFilter || "14";
  const [fromDate, setFromDate] = useState(searchParams.fromDate || "");
  const [toDate, setToDate] = useState(searchParams.toDate || "");
  const customRange = !!(fromDate && toDate);
  const [search, setSearch] = useState("");

  const handleDateFilterChange = (val: "today" | "7" | "14" | "30" | "month" | "all") => {
    navigate({
      search: (prev: any) => ({
        ...prev,
        dateFilter: val,
      }),
    });
  };

  const handleFromDateChange = (val: string) => {
    setFromDate(val);
    navigate({
      search: (prev: any) => ({
        ...prev,
        fromDate: val || undefined,
      }),
    });
  };

  const handleToDateChange = (val: string) => {
    setToDate(val);
    navigate({
      search: (prev: any) => ({
        ...prev,
        toDate: val || undefined,
      }),
    });
  };

  const handleResetCustomRange = () => {
    setFromDate("");
    setToDate("");
    navigate({
      search: (prev: any) => {
        const next = { ...prev };
        delete next.fromDate;
        delete next.toDate;
        return next;
      },
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["sold-products-detail", dateFilter, fromDate, toDate],
    queryFn: async () => {
      let since: Date;
      let until: Date | null = null;
      if (customRange) {
        since = new Date(`${fromDate}T00:00:00`);
        until = new Date(`${toDate}T23:59:59.999`);
      } else {
        since = new Date();
        if (dateFilter === "today") since.setHours(0, 0, 0, 0);
        else if (dateFilter === "7") since.setDate(since.getDate() - 6);
        else if (dateFilter === "14") since.setDate(since.getDate() - 13);
        else if (dateFilter === "30") since.setDate(since.getDate() - 29);
        else if (dateFilter === "month") since.setDate(1);
        else since.setFullYear(2020, 0, 1);
        since.setHours(0, 0, 0, 0);
      }

      let txQ = supabase
        .from("transactions")
        .select("*")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .range(0, 9999);
      if (until) txQ = txQ.lte("created_at", until.toISOString());

      const [txRes, productsRes] = await Promise.all([
        txQ,
        supabase.from("products").select("*"),
      ]);

      if (txRes.error) console.error("sold-products tx query error:", txRes.error);

      const txs = txRes.data ?? [];
      const txIds = txs.map((t) => t.id);

      let itemsData: any[] = [];
      if (txIds.length > 0) {
        // Chunk transaction IDs to avoid HTTP 414 Request-URI Too Long errors
        const chunkSize = 100;
        const chunks = [];
        for (let i = 0; i < txIds.length; i += chunkSize) {
          chunks.push(txIds.slice(i, i + chunkSize));
        }

        const results = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("transaction_items")
              .select("*")
              .in("transaction_id", chunk)
              .range(0, 19999)
          )
        );

        for (const res of results) {
          if (res.error) {
            console.error("sold-products items query error in chunk:", res.error);
          } else {
            itemsData.push(...(res.data ?? []));
          }
        }
      }

      return {
        transactions: txs,
        items: itemsData,
        products: productsRes.data ?? [],
      };
    },
    refetchInterval: 30000,
  });

  const allTransactions = data?.transactions ?? [];
  const transactions = useMemo(() => {
    if (role === "cashier") {
      const myBranch = branchName || cashierBranchMap[user?.id || ""] || "";
      return allTransactions.filter((t: any) => {
        if (user?.id && t.cashier_id === user.id) return true;
        const b = getTxBranch(t);
        if (myBranch && b) return branchMatch(b, myBranch);
        return false;
      });
    }
    return allTransactions;
  }, [allTransactions, role, branchName, user?.id, cashierBranchMap]);
  const items = data?.items ?? [];
  const products = data?.products ?? [];

  console.log("DEBUG sold-products:", {
    dateFilter,
    transactionsCount: transactions.length,
    itemsCount: items.length,
    productsCount: products.length,
  });

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
    const txMap = new Map(transactions.map((t) => [t.id, t]));
    const map: Record<string, {
      product_id: string | null;
      product_name: string;
      category: string;
      quantity: number;
      revenue: number;
    }> = {};

    items.forEach((item) => {
      const tx = txMap.get(item.transaction_id);
      if (tx) {
        // Exclude partner transactions
        if (tx.sale_category === "partner") return;

        let cat = "customer";
        if (item.product_id && productCategoryMap[item.product_id]) {
          cat = productCategoryMap[item.product_id];
        } else if (item.product_name?.startsWith("[GUDANG]")) {
          cat = "gudang";
        }

        // Exclude partner products
        if (cat === "partner") return;

        const key = item.product_id || item.product_name;
        
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

    const totalAyam = dada + pahaAtas + pahaBawah + sayap;
    const packs = Math.ceil(totalAyam / 10);

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

      {/* Custom date range filter */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground">Rentang Kustom:</span>
        <Input type="date" value={fromDate} onChange={(e) => handleFromDateChange(e.target.value)} className="h-8 w-[150px]" />
        <span className="text-muted-foreground">s/d</span>
        <Input type="date" value={toDate} onChange={(e) => handleToDateChange(e.target.value)} className="h-8 w-[150px]" />
        {(fromDate || toDate) && (
          <Button size="sm" variant="ghost" className="h-8" onClick={handleResetCustomRange}>Reset</Button>
        )}
        {customRange && (
          <span className="text-[10px] text-primary">(Rentang kustom aktif — filter waktu di atas diabaikan)</span>
        )}
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
