export type ReceiptPdfTransaction = {
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

export type ReceiptPdfSettings = {
  shop_name?: string | null;
  branch_name?: string | null;
  shop_address?: string | null;
  shop_phone?: string | null;
  paper_width?: number | null;
} | null;
