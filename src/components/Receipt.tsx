import { rupiah } from "@/lib/format";

interface ReceiptProps {
  tx: {
    id: string;
    created_at: string;
    total: number | string;
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
    <div id="receipt-print" className="text-xs bg-white text-black p-3 rounded-md border">
      <div className="center text-center">
        <div className="font-bold text-sm">{settings?.shop_name ?? "AMI Fried Chicken"}</div>
        {settings?.shop_address && <div>{settings.shop_address}</div>}
        {settings?.shop_phone && <div>{settings.shop_phone}</div>}
      </div>
      <hr className="border-t border-dashed border-black my-2" />
      <div className="row flex justify-between">
        <span>No.</span>
        <span>{tx.id.slice(0, 8).toUpperCase()}</span>
      </div>
      <div className="row flex justify-between">
        <span>Tanggal</span>
        <span>{new Date(tx.created_at).toLocaleString("id-ID")}</span>
      </div>
      {tx.sale_category === "partner" && tx.partner_name && (
        <div className="row flex justify-between">
          <span>Partner</span>
          <span>{tx.partner_name}</span>
        </div>
      )}
      <hr className="border-t border-dashed border-black my-2" />
      {tx.items.map((i, idx) => (
        <div key={idx} className="mb-1">
          <div>{i.product_name}</div>
          <div className="row flex justify-between">
            <span>
              {i.quantity} x {rupiah(i.price)}
            </span>
            <span>{rupiah(i.subtotal)}</span>
          </div>
        </div>
      ))}
      <hr className="border-t border-dashed border-black my-2" />
      <div className="row flex justify-between font-bold">
        <span>TOTAL</span>
        <span>{rupiah(tx.total)}</span>
      </div>
      <div className="row flex justify-between">
        <span>Bayar</span>
        <span>{tx.payment_method.toUpperCase()}</span>
      </div>
      {tx.payment_method === "cash" && (
        <>
          <div className="row flex justify-between">
            <span>Tunai</span>
            <span>{rupiah(tx.cash_received ?? 0)}</span>
          </div>
          <div className="row flex justify-between">
            <span>Kembalian</span>
            <span>{rupiah(tx.change_amount ?? 0)}</span>
          </div>
        </>
      )}
      <hr className="border-t border-dashed border-black my-2" />
      <div className="center text-center">
        Terima kasih {tx.buyer_name ?? "Pelanggan"} {tx.house_block ? `Blok ${tx.house_block}` : ""} 🙏
      </div>
    </div>
  );
}
