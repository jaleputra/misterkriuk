import { rupiah } from "@/lib/format";

interface ReceiptProps {
  tx: {
    id: string;
    created_at: string;
    total: number | string;
    discount_amount?: number | string | null;
    payment_method: string;
    cash_received: number | string | null;
    change_amount: number | string | null;
    sale_category?: string;
    partner_name?: string | null;
    buyer_name?: string | null;
    house_block?: string | null;
    items: { product_name: string; price: number; quantity: number; subtotal: number }[];
  };
  settings?: {
    shop_name?: string | null;
    shop_address?: string | null;
    shop_phone?: string | null;
  } | null;
}

export function Receipt({ tx, settings }: ReceiptProps) {
  return (
    <div id="receipt-print" className="text-xs bg-white text-black pt-4 px-4 pb-1 rounded-md border max-w-[300px] w-full mx-auto box-border shadow-sm my-2">
      <div className="center text-center">
        <div className="font-bold text-sm">{settings?.shop_name ?? "Mr Kriuk Ami"}</div>
        {settings?.shop_address && <div className="break-words">{settings.shop_address}</div>}
        {settings?.shop_phone && <div>{settings.shop_phone}</div>}
      </div>
      <hr className="border-t border-dashed border-black my-2" />
      <div className="row flex justify-between flex-nowrap gap-1">
        <span className="shrink-0">No.</span>
        <span className="text-right truncate font-mono min-w-0 flex-1 pl-2">{tx.id.slice(0, 8).toUpperCase()}</span>
      </div>
      <div className="row flex justify-between flex-nowrap gap-1">
        <span className="shrink-0">Tanggal</span>
        <span className="text-right break-words min-w-0 flex-1 pl-2">{new Date(tx.created_at).toLocaleString("id-ID")}</span>
      </div>
      {tx.partner_name && (
        <div className="row flex justify-between flex-nowrap gap-1">
          <span className="shrink-0">Partner</span>
          <span className="text-right break-words min-w-0 flex-1 pl-2">{tx.partner_name}</span>
        </div>
      )}
      <hr className="border-t border-dashed border-black my-2" />
      {tx.items.map((i, idx) => (
        <div key={idx} className="mb-1">
          <div className="break-words">{i.product_name}</div>
          <div className="row flex justify-between flex-nowrap gap-1">
            <span className="shrink-0 text-muted-foreground">
              {i.quantity} x {rupiah(i.price)}
            </span>
            <span className="shrink-0">{rupiah(i.subtotal)}</span>
          </div>
        </div>
      ))}
      <hr className="border-t border-dashed border-black my-2" />
      {Number(tx.discount_amount) > 0 && (
        <div className="row flex justify-between flex-nowrap gap-1">
          <span className="shrink-0">Diskon</span>
          <span className="font-semibold shrink-0">-{rupiah(tx.discount_amount ?? 0)}</span>
        </div>
      )}
      <div className="row flex justify-between font-bold flex-nowrap gap-1">
        <span className="shrink-0">TOTAL</span>
        <span className="shrink-0">{rupiah(tx.total)}</span>
      </div>
      <div className="row flex justify-between flex-nowrap gap-1">
        <span className="shrink-0">Bayar</span>
        <span className="text-right break-words min-w-0 flex-1 pl-2">{tx.payment_method.toUpperCase()}</span>
      </div>
      {tx.payment_method === "cash" && (
        <>
          <div className="row flex justify-between flex-nowrap gap-1">
            <span className="shrink-0">Tunai</span>
            <span className="shrink-0">{rupiah(tx.cash_received ?? 0)}</span>
          </div>
          <div className="row flex justify-between flex-nowrap gap-1">
            <span className="shrink-0">Kembalian</span>
            <span className="shrink-0">{rupiah(tx.change_amount ?? 0)}</span>
          </div>
        </>
      )}
      <hr className="border-t border-dashed border-black my-2" />
      <div className="center text-center break-words">
        Terima kasih {tx.partner_name || tx.buyer_name || "Pelanggan"} 🙏
      </div>
      <div className="center text-center break-words text-[10px] text-muted-foreground mt-2 leading-tight">
        Gratis pengantaran dan terima pesanan acara, Hubungi 082281384529
      </div>
      {tx.house_block && (
        <div className="center text-center font-bold text-lg mt-3 border border-black p-1.5 rounded bg-black/5">
          {tx.house_block.toUpperCase()}
        </div>
      )}
    </div>
  );
}
