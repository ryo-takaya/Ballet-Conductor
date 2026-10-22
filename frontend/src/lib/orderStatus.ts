import type { CdOrderStatus, CdPaymentStatus, Price } from "./api";

/** CD の依頼の状態を、画面に出す言葉にする */
export const ORDER_STATUS_LABEL: Record<CdOrderStatus, string> = {
  awaiting_payment: "支払い待ち",
  paid: "支払い済み",
  requested: "依頼済み",
  accepted: "受付済み",
  in_production: "作成中",
  shipped: "発送済み",
  cancelled: "取り消し",
  refunded: "返金済み",
};

export const PAYMENT_STATUS_LABEL: Record<CdPaymentStatus, string> = {
  unpaid: "未払い",
  paid: "支払い済み",
  expired: "期限切れ",
  refunded: "返金済み",
};

export function formatPrice(price: Price) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: price.currency.toUpperCase() }).format(
    price.amount,
  );
}

/** 金額と支払いの状態をまとめた一言（有料化する前の依頼は「料金なし」） */
export function paymentSummary(order: { price: Price; paymentStatus: CdPaymentStatus | null }) {
  if (order.price.amount === 0 || !order.paymentStatus) return "料金なし";
  return `${formatPrice(order.price)}（${PAYMENT_STATUS_LABEL[order.paymentStatus]}）`;
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
