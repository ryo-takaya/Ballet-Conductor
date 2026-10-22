// バックエンド API の呼び出し。接続先は NEXT_PUBLIC_API_URL（compose.yaml で設定）
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787/api";

/** 支払いのあとに Stripe から戻ってくる、このサイトの URL（GitHub Pages では basePath つき） */
export const returnBaseUrl = () => `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}`;

export type User = { id: number; name: string; email: string };
export type AuthResponse = { token: string; user: User };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError("サーバーに接続できませんでした。時間をおいてもう一度お試しください。", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? "うまくいきませんでした。もう一度お試しください。", res.status);
  return body as T;
}

export type Music = { id: number; name: string; url: string };
export type TrackSummary = { id: number; name: string; createdAt: string; musicCount: number };
export type TrackMusic = {
  trackMusicId: number;
  musicId: number;
  name: string;
  url: string;
  /** この曲に保存してある変更区間の数 */
  editCount: number;
};
export type TrackDetail = { id: number; name: string; createdAt: string; musics: TrackMusic[] };
export type TrackMusicInfo = {
  id: number;
  track: { id: number; name: string };
  music: { id: number; name: string; url: string };
};

export type UserDetail = User & { createdAt: string; trackCount: number };

export type ShippingAddress = {
  id: number;
  recipientName: string;
  postalCode: string;
  prefecture: string;
  city: string;
  addressLine1: string;
  addressLine2: string | null;
  isDefault: boolean;
};

export type CdOrderStatus =
  | "awaiting_payment"
  | "paid"
  | "requested"
  | "accepted"
  | "in_production"
  | "shipped"
  | "cancelled"
  | "refunded";
export type CdPaymentStatus = "unpaid" | "paid" | "expired" | "refunded";
export type Price = { amount: number; currency: string };
export type CdOrderSummary = {
  id: number;
  trackId: number | null;
  trackName: string;
  status: CdOrderStatus;
  createdAt: string;
  musicCount: number;
  /** 依頼した時点の金額（税込・送料込）。有料化する前の依頼は 0 */
  price: Price;
  /** 有料化する前の依頼は null */
  paymentStatus: CdPaymentStatus | null;
};
export type CdOrderDetail = CdOrderSummary & {
  track: {
    musics: {
      position: number;
      musicId: number;
      name: string;
      url: string;
      edits: { startSecond: number; endSecond: number; tempo: number }[];
    }[];
  };
  shippingAddress: Omit<ShippingAddress, "id" | "isDefault">;
  events: { event: CdOrderStatus; note: string | null; createdAt: string }[];
};
