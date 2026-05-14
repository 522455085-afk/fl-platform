"use client";

import { Coins, Search, SlidersHorizontal, Plus, Menu, X, Trash2, Loader2, ArrowLeftRight, Gavel, Clock, Copy, Check, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { rarityColor, rarityLabel } from "@/lib/mock-data";
import { supabase, type DbTradeListing, type DbAuctionListing } from "@/lib/supabase";
import { useTradeDm } from "@/lib/trade-dm-store";
import { useAuth } from "@/lib/auth-store";
import { useIsAdmin } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit-log";
import StaffBadge, { staffNameClass } from "@/components/AdminBadge";
import { cn } from "@/lib/utils";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";
import { confirm, alert } from "@/lib/confirm-store";
import { useBalance, creditGoldRaw } from "@/lib/balance-store";

type Rarity = DbTradeListing["item_rarity"];
type Sort = "new" | "price-asc" | "price-desc";
type Tab = "items" | "coins" | "auction" | "misc";

// Module-level caches so switching tabs never shows a loading flash
// for data already fetched this session.
const auctionCache = new Map<string, DbAuctionListing[]>();
const miscAuctionCache = new Map<string, DbAuctionListing[]>();
const tradeCache = new Map<string, DbTradeListing[]>();

const RARITY_FILTERS: (Rarity | "all")[] = ["all", "common", "uncommon", "rare", "epic", "legendary", "darklegen"];

const ITEM_CLASSES = ["武器", "防具", "饰品", "消耗品", "材料", "杂项"];

export default function TradeMarketView({
  channelName,
  onOpenNav,
  serverId = "global",
  requireGate,
  defaultTab = "items",
  onTabChange,
}: {
  channelName: string;
  onOpenNav?: () => void;
  serverId?: string;
  /** Returns true if user passes the gate; otherwise opens Security Center. */
  requireGate?: () => boolean;
  defaultTab?: Tab;
  /** Called when the user clicks a tab so the parent can sync the sidebar. */
  onTabChange?: (tab: Tab) => void;
}) {
  const [listings, setListings] = useState<DbTradeListing[]>(() => tradeCache.get(serverId) ?? []);
  const [loading, setLoading] = useState(() => !tradeCache.has(serverId));
  const [search, setSearch] = useState("");
  const [rarity, setRarity] = useState<Rarity | "all">("all");
  const [sort, setSort] = useState<Sort>("new");
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<Tab>(defaultTab);
  // Sync when the user switches to a different trade channel within
  // the same server — component is reused so useState initial value
  // doesn't re-run, but defaultTab prop does change.
  useEffect(() => { setTab(defaultTab); }, [defaultTab]);

  const handleTabClick = (t: Tab) => {
    setTab(t);
    onTabChange?.(t);
  };
  const { user } = useAuth();
  const addTradeDm = useTradeDm((s) => s.add);
  const { balance, fetch: fetchBalance, deductGold, creditRmb, creditGold } = useBalance();
  useEffect(() => { if (user) fetchBalance(user.id); }, [user?.id]);
  const [buyTarget, setBuyTarget] = useState<DbTradeListing | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);

  const openSellerDm = (sellerId: string, sellerName: string) => {
    addTradeDm(sellerId);
    document.dispatchEvent(
      new CustomEvent("fl:navigate-dm", {
        detail: {
          partnerId: sellerId,
          partnerName: sellerName,
          partnerAvatar: sellerName[0]?.toUpperCase() || "?",
          partnerColor: "#c9a44c",
          partnerAvatarUrl: null,
        },
      }),
    );
  };

  // Initial load + realtime subscribe
  useEffect(() => {
    let mounted = true;

    const fetchListings = () =>
      supabase
        .from("trade_listings")
        .select("*")
        .eq("server_id", serverId)
        .order("created_at", { ascending: false })
        .limit(200)
        .then(({ data, error }) => {
          if (!mounted) return;
          if (error) console.warn("[trade] load failed:", error);
          else {
            const rows = (data || []) as DbTradeListing[];
            tradeCache.set(serverId, rows);
            setListings(rows);
          }
          setLoading(false);
        });

    fetchListings();

    // Periodic full refresh — CloudBase's watch/poll miss DELETE events when
    // an admin force-delists. 20 s keeps listings eventually consistent.
    const refreshId = setInterval(fetchListings, 60_000);

    const channel = supabase
      .channel(`trade:${serverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trade_listings", filter: `server_id=eq.${serverId}` },
        (payload) => {
          if (!mounted) return;
          if (payload.eventType === "INSERT") {
            const row = payload.new as DbTradeListing;
            setListings((prev) => (prev.some((l) => l.id === row.id) ? prev : [row, ...prev]));
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as DbTradeListing;
            setListings((prev) => prev.filter((l) => l.id !== row.id));
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as DbTradeListing;
            setListings((prev) => prev.map((l) => (l.id === row.id ? row : l)));
          }
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      clearInterval(refreshId);
      supabase.removeChannel(channel);
    };
  }, [serverId]);

  const filtered = useMemo(() => {
    const nowMs = Date.now();
    let list = listings.filter((l) => {
      if (!l.expires_at) return true;
      const exp = typeof l.expires_at === "number" ? l.expires_at : Date.parse(l.expires_at as string);
      return isNaN(exp) || exp > nowMs;
    });
    if (rarity !== "all") list = list.filter((l) => l.item_rarity === rarity);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.item_name.toLowerCase().includes(q) ||
          l.affixes.some((a) => a.toLowerCase().includes(q)),
      );
    }
    if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
    return list;
  }, [listings, rarity, search, sort]);

  const isPlatformAdmin = useIsAdmin();

  const handleDelete = async (l: DbTradeListing) => {
    const isAdminAction = !!user && l.seller_id !== user.id && isPlatformAdmin;
    const prompt = isAdminAction
      ? `主教强制下架「${l.item_name}」（卖家：${l.seller_name}）？`
      : "确认下架此物品？";
    if (!(await confirm(prompt))) return;
    // Optimistic removal: same rationale as PartyView — Supabase
    // realtime DELETE events with filters are unreliable, polling is
    // not always in place here. Strip locally then call DB.
    setListings((prev) => prev.filter((x) => x.id !== l.id));
    const { error } = await supabase.from("trade_listings").delete().eq("id", l.id);
    if (error) {
      await alert("下架失败：" + error.message);
      // Rollback if delete failed.
      setListings((prev) => (prev.some((x) => x.id === l.id) ? prev : [l, ...prev]));
      return;
    }
    // Immediately re-fetch so the local state reflects DB truth
    // (guards against edge cases where optimistic removal got a stale snapshot).
    supabase
      .from("trade_listings")
      .select("*")
      .eq("server_id", serverId)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => { if (data) setListings(data as DbTradeListing[]); });
    if (isAdminAction && user) {
      recordAuditEvent({
        actor_id: user.id,
        actor_name: user.username,
        action: "force_delist_listing",
        target_type: "trade_listing",
        target_id: l.id,
        target_label: `${l.item_name} / 卖家 ${l.seller_name}`,
      });
    }
  };

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-[var(--bg-dark)]">
      {/* Header */}
      <header className="h-14 px-4 flex items-center gap-3 border-b border-black/30 shadow-sm shrink-0">
        {onOpenNav && (
          <button
            onClick={onOpenNav}
            className="md:hidden size-8 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
            aria-label="打开频道列表"
          >
            <Menu size={20} />
          </button>
        )}
        <Coins size={20} className="text-[var(--warning)] shrink-0" />
        <h2 className="font-semibold text-white truncate">{channelName}</h2>
        {user && balance && (
          <div className="hidden sm:flex items-center gap-3 text-xs text-[var(--text-muted)] ml-2 shrink-0">
            <span>💰 人民币：<span className="text-white font-semibold">¥{balance.rmb.toFixed(2)}</span></span>
            <span>🪙 游戏币：<span className="text-[var(--warning)] font-semibold">{balance.gold.toLocaleString()}</span></span>
            <button onClick={() => setShowTopUp(true)}
              className="px-2 py-0.5 rounded bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-[var(--text-muted)] hover:text-white text-xs border border-[var(--bg-mid)]">
              充値
            </button>
          </div>
        )}
        {/* Tab bar */}
        <div className="ml-4 flex items-center gap-1 bg-[var(--bg-darkest)] rounded-lg p-0.5">
          {(["items", "coins", "auction", "misc"] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleTabClick(t)}
              className={cn(
                "px-3 py-1 rounded text-base font-medium transition-colors flex items-center gap-1",
                tab === t
                  ? "bg-[var(--bg-mid)] text-white"
                  : "text-[var(--text-muted)] hover:text-white",
              )}
            >
              {t === "items" ? "物品交易" : t === "coins" ? "金币兑换" : t === "auction" ? "拍卖行" : "杂项拍卖"}
            </button>
          ))}
        </div>
        {tab === "items" && (
          <button
            onClick={() => {
              if (requireGate && !requireGate()) return;
              setShowCreate(true);
            }}
            className="ml-auto bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325] text-sm font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 shrink-0"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">上架物品</span>
          </button>
        )}
      </header>

      {tab === "coins" && (
        <CoinTradeSection serverId={serverId} requireGate={requireGate} />
      )}
      {tab === "auction" && (
        <AuctionSection serverId={serverId} requireGate={requireGate} />
      )}
      {tab === "misc" && (
        <MiscAuctionSection serverId={serverId} requireGate={requireGate} />
      )}
      {/* Filters — items tab only */}
      {tab === "items" && (<>
      <div className="px-4 md:px-6 py-3 border-b border-black/20 flex flex-wrap gap-3 items-center">
        <div className="flex items-center bg-[var(--bg-darkest)] rounded h-9 px-3 gap-2 w-full sm:w-72 max-w-full">
          <Search size={16} className="text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索物品名 / 词条"
            className="flex-1 bg-transparent text-sm placeholder:text-[var(--text-muted)] focus:outline-none text-white"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {RARITY_FILTERS.map((r) => (
            <button
              key={r}
              onClick={() => setRarity(r)}
              className={cn(
                "h-8 px-3 rounded text-xs font-medium transition-colors",
                rarity === r
                  ? "bg-[var(--bg-light)] text-white"
                  : "bg-[var(--bg-darker)] text-[var(--text-muted)] hover:text-white",
              )}
              style={
                rarity === r && r !== "all"
                  ? { color: rarityColor[r as Rarity] }
                  : undefined
              }
            >
              {r === "all" ? "全部" : rarityLabel[r as Rarity]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <SlidersHorizontal size={16} />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="bg-[var(--bg-darkest)] text-white rounded px-2 py-1 text-sm focus:outline-none"
          >
            <option value="new">最新</option>
            <option value="price-asc">价格升序</option>
            <option value="price-desc">价格降序</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="text-center text-[var(--text-muted)] mt-20">加载挂单中…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] mt-20">
            <p className="mb-2">还没有符合条件的物品</p>
            <button
              onClick={() => {
                if (requireGate && !requireGate()) return;
                setShowCreate(true);
              }}
              className="text-[var(--accent)] hover:underline text-sm"
            >
              上架第一件物品
            </button>
          </div>
        ) : (
          <div
            className="grid gap-4"
            // Auto-fit: keeps listing cards readable at any width, so
            // a narrow pane falls back to 2 or 1 column cleanly instead
            // of compressing 3+ cards into a sliver.
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 360px))" }}
          >
            {filtered.map((l) => (
              <ListingCard
                key={l.id}
                listing={l}
                isOwner={user?.id === l.seller_id}
                onContact={() => openSellerDm(l.seller_id, l.seller_name)}
                onBuy={() => setBuyTarget(l)}
                isPlatformAdmin={isPlatformAdmin}
                onDelete={() => handleDelete(l)}
              />
            ))}
          </div>
        )}
      </div>
      </>)}

      {showCreate && (
        <CreateListingModal
          serverId={serverId}
          onClose={() => setShowCreate(false)}
        />
      )}
      {buyTarget && (
        <BuyListingModal
          listing={buyTarget}
          balance={balance}
          onClose={() => setBuyTarget(null)}
          onDone={async () => {
            if (!user) return;
            const ok = await deductGold(user.id, buyTarget.price);
            if (ok) {
              setListings((prev) => prev.filter((x) => x.id !== buyTarget.id));
              await supabase.from("trade_listings").delete().eq("id", buyTarget.id);
            }
            setBuyTarget(null);
          }}
        />
      )}
      {showTopUp && user && (
        <TopUpModal
          userId={user.id}
          isAdmin={isPlatformAdmin}
          balance={balance}
          onClose={() => setShowTopUp(false)}
          onCreditRmb={(amt) => creditRmb(user.id, amt)}
          onCreditGold={(amt) => creditGold(user.id, amt)}
        />
      )}
    </section>
  );
}

// ── Top-Up Modal ──────────────────────────────────────────────────────────────

function TopUpModal({ userId, isAdmin, balance, onClose, onCreditRmb, onCreditGold }: {
  userId: string;
  isAdmin: boolean;
  balance: import("@/lib/balance-store").UserBalance | null;
  onClose: () => void;
  onCreditRmb: (amt: number) => Promise<void>;
  onCreditGold: (amt: number) => Promise<void>;
}) {
  const backdrop = useDismissOnBackdrop(onClose);
  const [type, setType] = useState<"rmb" | "gold">("rmb");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    setSubmitting(true);
    if (type === "rmb") await onCreditRmb(n);
    else await onCreditGold(Math.floor(n));
    setSubmitting(false);
    setDone(true);
    setTimeout(onClose, 1200);
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/70" {...backdrop}>
      <div onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 flex flex-col gap-4">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Check size={36} className="text-[var(--success)]" />
            <p className="text-white font-semibold">充值成功</p>
          </div>
        ) : isAdmin ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[var(--text-bright)]">余额充值（管理员）</h3>
              <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white"><X size={18} /></button>
            </div>
            <div className="bg-[var(--bg-darkest)] rounded-lg p-3 text-xs text-[var(--text-muted)] flex gap-4">
              <span>人民币：<span className="text-white">¥{(balance?.rmb ?? 0).toFixed(2)}</span></span>
              <span>游戏币：<span className="text-[var(--warning)]">{(balance?.gold ?? 0).toLocaleString()}</span></span>
            </div>
            <div className="flex gap-2">
              {(["rmb", "gold"] as const).map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={cn("flex-1 py-1.5 rounded text-sm font-medium border transition-colors",
                    type === t ? "bg-[var(--bg-light)] text-white border-[var(--bg-light)]"
                      : "border-[var(--bg-mid)] text-[var(--text-muted)] hover:bg-[var(--bg-mid)]")}>
                  {t === "rmb" ? "人民币 (¥)" : "游戏币"}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1 block">充值金额</label>
              <input type="number" min="0.01" step={type === "rmb" ? "0.01" : "1"}
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder={type === "rmb" ? "如 100.00" : "如 5000"}
                className="w-full bg-[var(--bg-darkest)] border border-[var(--bg-mid)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold">取消</button>
              <button onClick={handleSubmit} disabled={submitting || !amount}
                className="flex-1 h-10 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {submitting && <Loader2 size={14} className="animate-spin" />}确认充值
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[var(--text-bright)]">充值</h3>
              <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              充值功能需通过支付渠道完成，请联系管理员或等待支付接口上线。
            </p>
            <div className="bg-[var(--bg-darkest)] rounded-lg p-3 text-xs text-[var(--text-muted)] flex gap-4">
              <span>人民币：<span className="text-white">¥{(balance?.rmb ?? 0).toFixed(2)}</span></span>
              <span>游戏币：<span className="text-[var(--warning)]">{(balance?.gold ?? 0).toLocaleString()}</span></span>
            </div>
            <button onClick={onClose} className="h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold">关闭</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Buy Listing Modal ─────────────────────────────────────────────────────────

function BuyListingModal({ listing, balance, onClose, onDone }: {
  listing: DbTradeListing;
  balance: import("@/lib/balance-store").UserBalance | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const backdrop = useDismissOnBackdrop(onClose);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasEnough = (balance?.gold ?? 0) >= listing.price;

  const handleConfirm = async () => {
    if (!hasEnough) { setErr("游戏币余额不足"); return; }
    setSubmitting(true); setErr(null);
    await onDone();
    setSubmitting(false);
    setDone(true);
    setTimeout(onClose, 1500);
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/70" {...backdrop}>
      <div onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 flex flex-col gap-4">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Check size={40} className="text-[var(--success)]" />
            <p className="text-white font-semibold">购买成功</p>
            <p className="text-sm text-[var(--text-muted)]">已扣除 {listing.price.toLocaleString()} 游戏币</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[var(--text-bright)]">确认购买</h3>
              <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white"><X size={18} /></button>
            </div>
            <div className="bg-[var(--bg-darkest)] rounded-lg p-4 flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">物品</span>
                <span className="font-semibold text-white truncate max-w-[160px]">{listing.item_name || "（待定）"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">售价</span>
                <span className="text-[var(--warning)] font-bold">{listing.price.toLocaleString()} 游戏币</span>
              </div>
              <div className="flex justify-between text-sm border-t border-[var(--bg-mid)] pt-2 mt-1">
                <span className="text-[var(--text-muted)]">当前余额</span>
                <span className={hasEnough ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                  {(balance?.gold ?? 0).toLocaleString()} 游戏币
                </span>
              </div>
            </div>
            {!hasEnough && <p className="text-xs text-[var(--danger)]">游戏币余额不足，请先充值</p>}
            {err && <p className="text-xs text-[var(--danger)]">{err}</p>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold">取消</button>
              <button onClick={handleConfirm} disabled={submitting || !hasEnough}
                className="flex-1 h-10 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {submitting && <Loader2 size={14} className="animate-spin" />}
                确认购买
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Gold Coin Trading Section ────────────────────────────────────────────────

function CreateCoinModal({
  formType, setFormType, formAmount, setFormAmount,
  formPrice, setFormPrice, formNote, setFormNote,
  formError, submitting, onSubmit, onClose,
}: {
  formType: "sell" | "buy"; setFormType: (t: "sell" | "buy") => void;
  formAmount: string; setFormAmount: (v: string) => void;
  formPrice: string; setFormPrice: (v: string) => void;
  formNote: string; setFormNote: (v: string) => void;
  formError: string | null; submitting: boolean;
  onSubmit: () => void; onClose: () => void;
}) {
  const backdrop = useDismissOnBackdrop(onClose);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" {...backdrop}>
      <div onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-[var(--text-bright)] flex items-center gap-2">
            <Coins size={18} className="text-[var(--warning)]" />发布金币挂单
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white"><X size={18} /></button>
        </div>
        <div className="flex gap-2">
          {(["sell", "buy"] as const).map((t) => (
            <button key={t} onClick={() => setFormType(t)}
              className={cn("flex-1 py-1.5 rounded text-sm font-medium border transition-colors",
                formType === t
                  ? t === "sell"
                    ? "bg-[var(--warning)]/20 border-[var(--warning)] text-[var(--warning)]"
                    : "bg-[var(--success)]/20 border-[var(--success)] text-[var(--success)]"
                  : "border-[var(--bg-mid)] text-[var(--text-muted)] hover:bg-[var(--bg-mid)]")}>
              {t === "sell" ? "出售金币" : "求购金币"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">金币数量</label>
            <input value={formAmount} onChange={(e) => setFormAmount(e.target.value)}
              placeholder="如 5000" type="number" min="1"
              className="w-full bg-[var(--bg-darkest)] rounded px-3 py-2 text-sm text-white border border-[var(--bg-mid)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)] mb-1 block">每千金币价格（元）</label>
            <input value={formPrice} onChange={(e) => setFormPrice(e.target.value)}
              placeholder="如 2.5" type="number" min="0.01" step="0.01"
              className="w-full bg-[var(--bg-darkest)] rounded px-3 py-2 text-sm text-white border border-[var(--bg-mid)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
          </div>
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)] mb-1 block">备注（可选）</label>
          <input value={formNote} onChange={(e) => setFormNote(e.target.value)}
            placeholder="如：限时优惠、仅限当日等"
            className="w-full bg-[var(--bg-darkest)] rounded px-3 py-2 text-sm text-white border border-[var(--bg-mid)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">挂单有效期 4 小时，到期自动下架。</p>
        {formError && <p className="text-xs text-[var(--danger)]">{formError}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold">取消</button>
          <button onClick={onSubmit} disabled={submitting}
            className="flex-1 h-10 rounded-md bg-[var(--warning)] hover:opacity-90 text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            发布
          </button>
        </div>
      </div>
    </div>
  );
}

const coinOrdersCache = new Map<string, CoinOrder[]>();

type CoinOrder = {
  id: string;
  server_id: string;
  order_type: "sell" | "buy";
  seller_id: string;
  seller_name: string;
  amount: number;
  price_per_thousand: number;
  note?: string | null;
  created_at: string;
  expires_at?: number | null;
};

function CoinTradeSection({
  serverId = "global",
  requireGate,
}: {
  serverId?: string;
  requireGate?: () => boolean;
}) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<CoinOrder[]>(
    () => coinOrdersCache.get(serverId) ?? [],
  );
  const [buyTarget, setBuyTarget] = useState<CoinOrder | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(
    () => !coinOrdersCache.has(serverId),
  );
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"sell" | "buy">("sell");
  const [formAmount, setFormAmount] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formNote, setFormNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase
      .from("coin_orders")
      .select("*")
      .eq("server_id", serverId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (!mounted) return;
        const now = Date.now();
        const rows = (data || []) as CoinOrder[];
        coinOrdersCache.set(serverId, rows);
        setOrders(rows.filter((o) => !o.expires_at || o.expires_at > now));
        setLoadingOrders(false);
      });
    return () => { mounted = false; };
  }, [serverId]);

  const handlePost = async () => {
    if (!user) return;
    const amount = parseInt(formAmount, 10);
    const price = parseFloat(formPrice);
    if (!amount || amount <= 0 || !price || price <= 0) {
      setFormError("请填写有效的数量和单价");
      return;
    }
    setSubmitting(true);
    setFormError(null);

    const row: Omit<CoinOrder, "id"> = {
      server_id: serverId,
      order_type: formType,
      seller_id: user.id,
      seller_name: user.username,
      amount,
      price_per_thousand: price,
      note: formNote.trim() || null,
      created_at: new Date().toISOString(),
      expires_at: Date.now() + 4 * 3600 * 1000,
    };
    const { error } = await supabase.from("coin_orders").insert(row as never);
    setSubmitting(false);
    if (error) { setFormError(`发布失败：${error.message ?? "请稍后再试"}`); return; }
    setShowForm(false);
    setFormAmount(""); setFormPrice(""); setFormNote("");
    // Refresh
    const { data } = await supabase.from("coin_orders").select("*").eq("server_id", serverId).order("created_at", { ascending: false }).limit(100);
    const nowMs = Date.now();
    setOrders(((data || []) as CoinOrder[]).filter((o) => !o.expires_at || o.expires_at > nowMs));
  };

  const handleDelete = async (o: CoinOrder) => {
    if (!user || user.id !== o.seller_id) return;
    await supabase.from("coin_orders").delete().eq("id", o.id);
    setOrders((prev) => prev.filter((x) => x.id !== o.id));
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-[var(--text-muted)]">
            发布挂单（出售或求购金币），其他玩家通过私聊联系你交易。
          </p>
        </div>
        <button
          onClick={() => {
            if (requireGate && !requireGate()) return;
            setShowForm((v) => !v);
          }}
          className="bg-[var(--warning)] hover:opacity-90 text-[#1a1325] text-sm font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 shrink-0"
        >
          <Plus size={16} />
          发布挂单
        </button>
      </div>

      {showForm && (
        <CreateCoinModal
          formType={formType} setFormType={setFormType}
          formAmount={formAmount} setFormAmount={setFormAmount}
          formPrice={formPrice} setFormPrice={setFormPrice}
          formNote={formNote} setFormNote={setFormNote}
          formError={formError} submitting={submitting}
          onSubmit={handlePost}
          onClose={() => setShowForm(false)}
        />
      )}

      {loadingOrders ? (
        <div className="text-sm text-[var(--text-muted)]">加载中…</div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--text-muted)]">
          <ArrowLeftRight size={40} className="opacity-30" />
          <p className="text-sm">暂无挂单</p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 360px))" }}>
          {orders.map((o) => (
            <div key={o.id} className={cn(
              "bg-[var(--bg-darker)] rounded-lg border-l-4 p-4 flex flex-col gap-2",
              o.order_type === "sell" ? "border-[var(--warning)]" : "border-[var(--success)]",
            )}>
              <div className="flex items-center justify-between">
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full",
                  o.order_type === "sell"
                    ? "bg-[var(--warning)]/20 text-[var(--warning)]"
                    : "bg-[var(--success)]/20 text-[var(--success)]")}>
                  {o.order_type === "sell" ? "出售" : "求购"}
                </span>
                <span className="text-xs text-[var(--text-muted)]">{timeAgo(o.created_at)}</span>
              </div>
              <div className="text-lg font-bold text-[var(--warning)]">
                {o.amount.toLocaleString()} <span className="text-sm font-normal text-[var(--text-muted)]">金币</span>
              </div>
              <div className="text-sm text-[var(--text-normal)]">
                ¥{o.price_per_thousand} / 千金币
                <span className="ml-2 text-[var(--text-muted)]">
                  合计 ≈ ¥{((o.amount / 1000) * o.price_per_thousand).toFixed(2)}
                </span>
              </div>
              <div className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                <StaffBadge userId={o.seller_id} size={11} />
                <span className={staffNameClass(o.seller_id)}>{o.seller_name}</span>
              </div>
              {o.note && <p className="text-xs text-[var(--text-muted)] italic">{o.note}</p>}
              <div className="flex gap-2 mt-1">
                {user?.id !== o.seller_id && (
                  <button
                    onClick={() => setBuyTarget(o)}
                    className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325] text-sm font-semibold py-1.5 rounded">
                    {o.order_type === "sell" ? "购买" : "出售"}
                  </button>
                )}
                {user?.id === o.seller_id && (
                  <button onClick={() => handleDelete(o)}
                    className="flex-1 text-xs text-[var(--danger)] border border-[var(--danger)]/40 hover:bg-[var(--danger)]/10 rounded py-1.5">
                    撤单
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {buyTarget && (
        <ConfirmBuyModal
          order={buyTarget}
          user={user!}
          onClose={() => setBuyTarget(null)}
          onDone={() => {
            setOrders((prev) => prev.filter((x) => x.id !== buyTarget.id));
            setBuyTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ConfirmBuyModal({
  order, user, onClose, onDone,
}: {
  order: CoinOrder;
  user: { id: string; username: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const backdrop = useDismissOnBackdrop(onClose);
  const { balance, fetch: fetchBal, deductRmb, creditGold } = useBalance();
  useEffect(() => { fetchBal(user.id); }, [user.id]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = parseFloat(((order.amount / 1000) * order.price_per_thousand).toFixed(2));
  const isBuy = order.order_type === "sell";
  const hasEnough = isBuy ? (balance?.rmb ?? 0) >= total : (balance?.gold ?? 0) >= order.amount;

  const handleConfirm = async () => {
    if (!hasEnough) { setErr(isBuy ? "人民币余额不足" : "游戏币余额不足"); return; }
    setSubmitting(true); setErr(null);
    const deducted = isBuy
      ? await deductRmb(user.id, total)
      : await (async () => { await creditGold(user.id, order.amount); return true; })();
    if (!deducted) { setErr("余额扣除失败，请重试"); setSubmitting(false); return; }
    const { error } = await supabase.from("coin_transactions").insert({
      order_id: order.id, order_type: order.order_type,
      seller_id: order.seller_id, seller_name: order.seller_name,
      buyer_id: user.id, buyer_name: user.username,
      amount: order.amount, price_per_thousand: order.price_per_thousand,
      total_price: total, created_at: new Date().toISOString(),
    } as never);
    if (error) { setErr("记录失败：" + error.message); setSubmitting(false); return; }
    await supabase.from("coin_orders").delete().eq("id", order.id);
    setSubmitting(false); setDone(true);
    setTimeout(onDone, 1500);
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/70" {...backdrop}>
      <div onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 flex flex-col gap-4">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Check size={40} className="text-[var(--success)]" />
            <p className="text-white font-semibold">{isBuy ? "购买成功" : "出售成功"}</p>
            <p className="text-sm text-[var(--text-muted)]">{isBuy ? `已扣除 ¥${total}` : `已入账 ${order.amount.toLocaleString()} 游戏币`}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[var(--text-bright)]">确认{isBuy ? "购买" : "出售"}</h3>
              <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white"><X size={18} /></button>
            </div>
            <div className="bg-[var(--bg-darkest)] rounded-lg p-4 flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">金币数量</span>
                <span className="text-[var(--warning)] font-bold">{order.amount.toLocaleString()} 金币</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">单价</span>
                <span>¥{order.price_per_thousand} / 千金币</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t border-[var(--bg-mid)] pt-2 mt-1">
                <span className="text-[var(--text-muted)]">合计</span>
                <span className="text-white">¥{total}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-[var(--bg-mid)] pt-2 mt-1">
                <span className="text-[var(--text-muted)]">当前{isBuy ? "人民币" : "游戏币"}余额</span>
                <span className={hasEnough ? "text-[var(--success)]" : "text-[var(--danger)]" }>
                  {isBuy ? `¥${(balance?.rmb ?? 0).toFixed(2)}` : `${(balance?.gold ?? 0).toLocaleString()}`}
                </span>
              </div>
            </div>
            {!hasEnough && <p className="text-xs text-[var(--danger)]">{isBuy ? "人民币余额不足" : "游戏币余额不足"}</p>}
            {order.note && <p className="text-xs text-[var(--text-muted)] italic">{order.note}</p>}
            {err && <p className="text-xs text-[var(--danger)]">{err}</p>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold">取消</button>
              <button onClick={handleConfirm} disabled={submitting || !hasEnough}
                className="flex-1 h-10 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {submitting && <Loader2 size={14} className="animate-spin" />}
                确认{isBuy ? "购买" : "出售"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Misc Auction Section (消耗品 / 材料) ──────────────────────────────────────

const MISC_CLASSES = ["消耗品", "材料"] as const;
type MiscClass = typeof MISC_CLASSES[number];

function MiscAuctionSection({ serverId = "global", requireGate }: { serverId?: string; requireGate?: () => boolean }) {
  const { user } = useAuth();
  const isPlatformAdmin = useIsAdmin();
  const miscKey = `misc:${serverId}`;
  const [auctions, setAuctions] = useState<DbAuctionListing[]>(
    () => miscAuctionCache.get(miscKey) ?? [],
  );
  const [loading, setLoading] = useState(() => !miscAuctionCache.has(miscKey));
  const [classFilter, setClassFilter] = useState<MiscClass | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [bidTarget, setBidTarget] = useState<DbAuctionListing | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.from("auction_listings").select("*")
      .eq("server_id", serverId)
      .in("item_class", [...MISC_CLASSES])
      .order("ends_at", { ascending: true }).limit(100)
      .then(({ data }) => {
        if (!mounted) return;
        const rows = (data || []) as DbAuctionListing[];
        miscAuctionCache.set(miscKey, rows);
        setAuctions(rows);
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [serverId]);

  const handleCancel = async (a: DbAuctionListing) => {
    await supabase.from("auction_listings").delete().eq("id", a.id);
    setAuctions((p) => p.filter((x) => x.id !== a.id));
  };
  const handleBidPlaced = (updated: DbAuctionListing) => {
    setAuctions((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    setBidTarget(null);
  };
  const openSellerDm = (sellerId: string, sellerName: string) => {
    document.dispatchEvent(new CustomEvent("fl:navigate-dm", {
      detail: { partnerId: sellerId, partnerName: sellerName,
        partnerAvatar: sellerName[0]?.toUpperCase() || "?",
        partnerColor: "#c9a44c", partnerAvatarUrl: null },
    }));
  };

  const filtered = auctions.filter((a) => classFilter === "all" || a.item_class === classFilter);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          {(["all", ...MISC_CLASSES] as const).map((c) => (
            <button key={c} onClick={() => setClassFilter(c)}
              className={cn("px-3 py-1 rounded text-sm font-medium border transition-colors",
                classFilter === c
                  ? "bg-[var(--bg-light)] text-white border-[var(--bg-light)]"
                  : "border-[var(--bg-mid)] text-[var(--text-muted)] hover:bg-[var(--bg-mid)]")}>
              {c === "all" ? "全部" : c}
            </button>
          ))}
        </div>
        <button onClick={() => { if (requireGate && !requireGate()) return; setShowCreate(true); }}
          className="bg-[var(--warning)] hover:opacity-90 text-[#1a1325] text-sm font-semibold px-3 py-1.5 rounded flex items-center gap-1.5">
          <Plus size={16} />发起拍卖
        </button>
      </div>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--text-muted)]">
          <Loader2 size={32} className="opacity-40 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--text-muted)]">
          <Gavel size={40} className="opacity-30" />
          <p className="text-sm">暂无杂项拍卖</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 360px))" }}>
          {filtered.map((a) => (
            <AuctionCard key={a.id} auction={a}
              isOwner={user?.id === a.seller_id}
              isPlatformAdmin={isPlatformAdmin}
              onBid={() => setBidTarget(a)}
              onCancel={() => handleCancel(a)}
              onContact={() => openSellerDm(a.seller_id, a.seller_name)} />
          ))}
        </div>
      )}
      {showCreate && (
        <CreateMiscAuctionModal serverId={serverId} onClose={() => setShowCreate(false)}
          onCreate={(a) => { setAuctions((p) => [a, ...p]); setShowCreate(false); }} />
      )}
      {bidTarget && (
        <BidModal auction={bidTarget} onClose={() => setBidTarget(null)} onBidPlaced={handleBidPlaced} />
      )}
    </div>
  );
}

function CreateMiscAuctionModal({ serverId, onClose, onCreate }: {
  serverId: string; onClose: () => void; onCreate: (a: DbAuctionListing) => void;
}) {
  const { user } = useAuth();
  const backdrop = useDismissOnBackdrop(onClose);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  type AucRarity = DbAuctionListing["item_rarity"];
  const [form, setForm] = useState({
    item_name: "", item_rarity: "common" as AucRarity,
    item_class: "消耗品" as MiscClass,
    affixesText: "", starting_price: 0, buyout_price: 0, min_bid_step: 1, note: "", duration_m: 60,
  });
  const maxM = 120;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.item_name.trim()) return setErr("请填写物品名");
    if (form.starting_price < 1) return setErr("起拍价至少 1 金币");
    if (form.duration_m < 30 || form.duration_m > maxM) return setErr(`时长必须在30–${maxM}分钟之间`);
    setSubmitting(true); setErr(null);
    const affixes = form.affixesText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 8);
    const now = Date.now();
    const row = {
      server_id: serverId, seller_id: user.id, seller_name: user.username,
      item_name: form.item_name.trim(), item_rarity: form.item_rarity, item_class: form.item_class,
      affixes, note: form.note.trim() || null, starting_price: form.starting_price,
      current_bid: form.starting_price, bidder_id: null, bidder_name: null, bid_count: 0,
      buyout_price: form.buyout_price > 0 ? form.buyout_price : null,
      min_bid_step: form.min_bid_step > 0 ? form.min_bid_step : null,
      ends_at: now + form.duration_m * 60 * 1000, created_at: now,
    };
    const { data, error } = await supabase.from("auction_listings").insert(row as never).select().single();
    setSubmitting(false);
    if (error) { setErr(error.message); return; }
    if (data) onCreate(data as unknown as DbAuctionListing);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" {...backdrop}>
      <form onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}
        className="w-full max-w-lg bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--text-bright)] flex items-center gap-2"><Gavel size={18} />杂项拍卖</h3>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-white"><X size={20} /></button>
        </div>
        <Field label="物品名">
          <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })}
            placeholder="例：回血药 x20" className="modal-input" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="分类">
            <select value={form.item_class} onChange={(e) => setForm({ ...form, item_class: e.target.value as MiscClass })} className="modal-input">
              {MISC_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="品质">
            <select value={form.item_rarity} onChange={(e) => setForm({ ...form, item_rarity: e.target.value as AucRarity })} className="modal-input">
              {(["common","uncommon","rare","epic","legendary","darklegen"] as AucRarity[]).map((r) => (
                <option key={r} value={r}>{rarityLabel[r]}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="起拍价（金币）">
            <input type="number" min={1} value={form.starting_price}
              onChange={(e) => setForm({ ...form, starting_price: parseInt(e.target.value) || 0 })} className="modal-input" />
          </Field>
          <Field label="一口价（可选）">
            <input type="number" min={0} value={form.buyout_price}
              onChange={(e) => setForm({ ...form, buyout_price: parseInt(e.target.value) || 0 })} className="modal-input" />
          </Field>
          <Field label="最低加价">
            <input type="number" min={1} value={form.min_bid_step}
              onChange={(e) => setForm({ ...form, min_bid_step: parseInt(e.target.value) || 1 })} className="modal-input" />
          </Field>
        </div>
        <Field label={`时长（分钟，30–${maxM}）`}>
          <input type="number" min={30} max={maxM} value={form.duration_m}
            onChange={(e) => { const v = Math.max(30, Math.min(parseInt(e.target.value) || 30, maxM)); setForm({ ...form, duration_m: v }); }}
            className="modal-input" />
        </Field>
        <Field label="词条（每行一条，最多 8 条）">
          <textarea value={form.affixesText} onChange={(e) => setForm({ ...form, affixesText: e.target.value })}
            placeholder={"数量 x50\n+12% 冷却缩减"} rows={3} className="modal-input resize-none font-mono text-xs" />
        </Field>
        <Field label="备注（选填）">
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="物品说明等" className="modal-input" />
        </Field>
        {err && <div className="text-sm text-[var(--danger)]">{err}</div>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold">取消</button>
          <button type="submit" disabled={submitting}
            className="flex-1 h-10 rounded-md bg-gradient-to-b from-[var(--warning)] to-amber-600 text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {submitting && <Loader2 size={16} className="animate-spin" />}发起拍卖
          </button>
        </div>
        <style jsx>{`
          .modal-input { width:100%; height:38px; padding:0 10px; border-radius:6px; background:var(--bg-darkest); color:white; border:1px solid var(--bg-mid); font-size:14px; }
          textarea.modal-input { height:auto; padding:8px 10px; }
          .modal-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 10px var(--accent-glow); }
        `}</style>
      </form>
    </div>
  );
}

function tsToMs(ts: string | number | null | undefined): number {
  if (ts == null) return NaN;
  return typeof ts === "number" ? ts : Date.parse(ts as string);
}

function timeAgo(ts: string | number | null | undefined): string {
  const ms = tsToMs(ts);
  if (isNaN(ms)) return "未知时间";
  const diff = (Date.now() - ms) / 1000;
  if (diff < 0) return "刚刚";
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function expiresIn(ts: string | number | null | undefined): string {
  const ms = tsToMs(ts);
  if (isNaN(ms)) return "";
  const rem = (ms - Date.now()) / 1000;
  if (rem <= 0) return "已过期";
  if (rem < 3600) return `剩 ${Math.floor(rem / 60)} 分`;
  if (rem < 86400) return `剩 ${Math.floor(rem / 3600)} 时`;
  return `剩 ${Math.floor(rem / 86400)} 天`;
}

function ListingCard({
  listing,
  isOwner,
  isPlatformAdmin,
  onDelete,
  onContact,
  onBuy,
}: {
  listing: DbTradeListing;
  isOwner: boolean;
  isPlatformAdmin?: boolean;
  onDelete: () => void;
  onContact?: () => void;
  onBuy?: () => void;
}) {
  const color = rarityColor[listing.item_rarity];
  return (
    <article
      className="bg-[var(--bg-darker)] rounded-lg border-l-4 p-4 hover:bg-[var(--bg-mid)] transition-colors flex flex-col"
      style={{ borderColor: color }}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className="size-12 rounded grid place-items-center text-xl shrink-0"
          style={{ background: `${color}22`, color }}
        >
          {listing.item_class[0] || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate" style={{ color }}>
            {listing.item_name}
          </h3>
          <div className="text-xs" style={{ color }}>
            {rarityLabel[listing.item_rarity]} · {listing.item_class}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold text-[var(--warning)]">{listing.price.toLocaleString()}</div>
          <div className="text-[10px] text-[var(--text-muted)]">金币</div>
        </div>
      </div>
      {listing.affixes.length > 0 && (
        <ul className="text-xs text-[var(--text-normal)] space-y-0.5 mb-3 flex-1">
          {listing.affixes.slice(0, 4).map((a, i) => (
            <li key={`${a}-${i}`}>· {a}</li>
          ))}
        </ul>
      )}
      {listing.note && (
        <p className="text-xs text-[var(--text-muted)] italic mb-3 line-clamp-2">{listing.note}</p>
      )}
      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-3">
        <span className="truncate inline-flex items-center gap-1">
          <span>
            卖家：
            <span className={cn(staffNameClass(listing.seller_id))}>
              {listing.seller_name}
            </span>
          </span>
          <StaffBadge userId={listing.seller_id} size={11} />
        </span>
        <span className="shrink-0 ml-2 flex items-center gap-1.5">
          {timeAgo(listing.created_at)}
          {listing.expires_at && (
            <span className={cn(
              "text-[10px] px-1 py-0.5 rounded",
              expiresIn(listing.expires_at) === "已过期"
                ? "bg-[var(--danger)]/20 text-[var(--danger)]"
                : "bg-[var(--bg-mid)] text-[var(--text-muted)]"
            )}>
              <Timer size={9} className="inline mr-0.5" />{expiresIn(listing.expires_at)}
            </span>
          )}
        </span>
      </div>
      <div className="flex gap-2">
        {isOwner ? (
          <button
            onClick={onDelete}
            className="flex-1 bg-[var(--danger)]/20 hover:bg-[var(--danger)]/40 text-[var(--danger)] text-sm font-semibold py-1.5 rounded flex items-center justify-center gap-1.5"
          >
            <Trash2 size={14} />
            下架
          </button>
        ) : isPlatformAdmin ? (
          <>
            <button onClick={onBuy} className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325] text-sm font-semibold py-1.5 rounded">购买</button>
            <button onClick={onContact} className="flex-1 bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold py-1.5 rounded">私聊</button>
            <button onClick={onDelete} title="主教强制下架"
              className="shrink-0 bg-[var(--danger)]/30 hover:bg-[var(--danger)]/50 text-[var(--danger)] text-sm font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 ring-1 ring-[var(--danger)]/40">
              <Trash2 size={14} />强下
            </button>
          </>
        ) : (
          <>
            <button onClick={onBuy} className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325] text-sm font-semibold py-1.5 rounded">购买</button>
            <button onClick={onContact} className="flex-1 bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold py-1.5 rounded">私聊</button>
          </>
        )}
      </div>
    </article>
  );
}

function CreateListingModal({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const backdrop = useDismissOnBackdrop(onClose);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ price: 0, note: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (form.price <= 0) return setErr("请填写价格");
    setSubmitting(true);
    setErr(null);
    const { error } = await supabase.from("trade_listings").insert({
      server_id: serverId,
      seller_id: user.id,
      seller_name: user.username,
      item_name: "",
      item_rarity: "common",
      item_class: "未知",
      affixes: [],
      price: form.price,
      stock: 1,
      note: form.note.trim() || null,
      created_at: Date.now(),
      expires_at: Date.now() + 48 * 3600 * 1000,
    });
    setSubmitting(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" {...backdrop}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--text-bright)]">上架物品</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-[var(--text-muted)]">物品信息将通过游戏接口自动填写，此处仅需填写价格。</p>

        <Field label="价格（金币）">
          <input type="number" min={1} value={form.price} autoFocus
            onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
            className="modal-input" />
        </Field>

        <Field label="备注（选填）">
          <input value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="例：限时优惠、仅限当日等"
            className="modal-input" />
        </Field>

        {err && <div className="text-sm text-[var(--danger)]">{err}</div>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 h-10 rounded-md bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            上架
          </button>
        </div>

        <style jsx>{`
          .modal-input {
            width: 100%;
            height: 38px;
            padding: 0 10px;
            border-radius: 6px;
            background: var(--bg-darkest);
            color: white;
            border: 1px solid var(--bg-mid);
            font-size: 14px;
          }
          textarea.modal-input {
            height: auto;
            padding: 8px 10px;
          }
          .modal-input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 10px var(--accent-glow);
          }
        `}</style>
      </form>
    </div>
  );
}

function AuctionSection({
  serverId = "global",
  requireGate,
}: {
  serverId?: string;
  requireGate?: () => boolean;
}) {
  const { user } = useAuth();
  const isPlatformAdmin = useIsAdmin();
  const [auctions, setAuctions] = useState<DbAuctionListing[]>(
    () => auctionCache.get(serverId) ?? [],
  );
  const [loading, setLoading] = useState(() => !auctionCache.has(serverId));
  const [showCreate, setShowCreate] = useState(false);
  const [bidTarget, setBidTarget] = useState<DbAuctionListing | null>(null);

  const openSellerDm = (sellerId: string, sellerName: string) => {
    document.dispatchEvent(
      new CustomEvent("fl:navigate-dm", {
        detail: {
          partnerId: sellerId,
          partnerName: sellerName,
          partnerAvatar: sellerName[0]?.toUpperCase() || "?",
          partnerColor: "#c9a44c",
          partnerAvatarUrl: null,
        },
      }),
    );
  };

  useEffect(() => {
    let mounted = true;
    const nowMs = Date.now();

    const fetchAuctions = () =>
      supabase
        .from("auction_listings")
        .select("*")
        .eq("server_id", serverId)
        .order("created_at", { ascending: false })
        .limit(100)
        .then(({ data, error }) => {
          if (!mounted) return;
          if (error) { console.warn("[auction] load failed:", error); setLoading(false); return; }
          const rows = ((data || []) as DbAuctionListing[]).filter(
            (a) => tsToMs(a.ends_at) > nowMs,
          );
          auctionCache.set(serverId, rows);
          setAuctions(rows);
          setLoading(false);
        });

    fetchAuctions();
    const refreshId = setInterval(fetchAuctions, 60_000);

    const channel = supabase
      .channel(`auction:${serverId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "auction_listings", filter: `server_id=eq.${serverId}` },
        (payload) => {
          if (!mounted) return;
          if (payload.eventType === "INSERT") {
            const row = payload.new as DbAuctionListing;
            if (tsToMs(row.ends_at) > Date.now()) {
              setAuctions((prev) => {
                const next = prev.some((a) => a.id === row.id) ? prev : [row, ...prev];
                auctionCache.set(serverId, next);
                return next;
              });
            }
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as DbAuctionListing;
            setAuctions((prev) => {
              const next = prev.map((a) => (a.id === row.id ? row : a));
              auctionCache.set(serverId, next);
              return next;
            });
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as DbAuctionListing;
            setAuctions((prev) => {
              const next = prev.filter((a) => a.id !== row.id);
              auctionCache.set(serverId, next);
              return next;
            });
          }
        },
      )
      .subscribe();

    return () => { mounted = false; clearInterval(refreshId); supabase.removeChannel(channel); };
  }, [serverId]);

  const handleCancelAuction = async (a: DbAuctionListing) => {
    if (!user) return;
    if (a.bid_count > 0) {
      await alert("已有出价，无法撤销拍卖。");
      return;
    }
    if (!(await confirm(`确认撤销「${a.item_name}」的拍卖？`))) return;
    setAuctions((prev) => prev.filter((x) => x.id !== a.id));
    const { error } = await supabase.from("auction_listings").delete().eq("id", a.id);
    if (error) {
      await alert("撤销失败：" + error.message);
      setAuctions((prev) => (prev.some((x) => x.id === a.id) ? prev : [a, ...prev]));
    }
  };

  const handleBidPlaced = (updated: DbAuctionListing) => {
    setAuctions((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setBidTarget(null);
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">加载拍卖中…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">物品拍卖——48小时限时，价高者得。结束后买卖双方通过联系方式私下交割。</p>
        <button
          onClick={() => {
            if (requireGate && !requireGate()) return;
            setShowCreate(true);
          }}
          className="ml-4 bg-[var(--warning)] hover:opacity-90 text-[#1a1325] text-sm font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 shrink-0"
        >
          <Gavel size={15} />
          发起拍卖
        </button>
      </div>

      {auctions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-[var(--text-muted)]">
          <Gavel size={44} className="opacity-20" />
          <p className="text-sm">暂无进行中的拍卖</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 360px))" }}>
          {auctions.map((a) => (
            <AuctionCard
              key={a.id}
              auction={a}
              isOwner={user?.id === a.seller_id}
              isPlatformAdmin={isPlatformAdmin}
              onBid={() => setBidTarget(a)}
              onCancel={() => handleCancelAuction(a)}
              onContact={() => openSellerDm(a.seller_id, a.seller_name)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateAuctionModal
          serverId={serverId}
          onClose={() => setShowCreate(false)}
          onCreate={(a) => { setAuctions((prev) => [a, ...prev]); setShowCreate(false); }}
        />
      )}
      {bidTarget && (
        <BidModal
          auction={bidTarget}
          onClose={() => setBidTarget(null)}
          onBidPlaced={handleBidPlaced}
        />
      )}
    </div>
  );
}

function AuctionCard({
  auction,
  isOwner,
  isPlatformAdmin,
  onBid,
  onCancel,
  onContact,
}: {
  auction: DbAuctionListing;
  isOwner: boolean;
  isPlatformAdmin?: boolean;
  onBid: () => void;
  onCancel: () => void;
  onContact: () => void;
}) {
  const color = rarityColor[auction.item_rarity];
  const ended = tsToMs(auction.ends_at) <= Date.now();
  return (
    <article
      className="bg-[var(--bg-darker)] rounded-lg border-l-4 p-4 flex flex-col gap-2"
      style={{ borderColor: color, opacity: ended ? 0.6 : 1 }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-11 rounded grid place-items-center text-xl shrink-0"
          style={{ background: `${color}22`, color }}
        >
          {auction.item_class[0] || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate" style={{ color }}>{auction.item_name}</h3>
          <div className="text-xs" style={{ color }}>
            {rarityLabel[auction.item_rarity]} · {auction.item_class}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-xs px-1.5 py-0.5 rounded font-medium", ended ? "bg-[var(--danger)]/20 text-[var(--danger)]" : "bg-[var(--warning)]/20 text-[var(--warning)]")}>
            <Clock size={9} className="inline mr-0.5" />
            {ended ? "已结束" : expiresIn(auction.ends_at)}
          </div>
        </div>
      </div>

      {auction.affixes.length > 0 && (
        <ul className="text-xs text-[var(--text-normal)] space-y-0.5">
          {auction.affixes.slice(0, 3).map((a, i) => <li key={i}>· {a}</li>)}
        </ul>
      )}

      {(auction.buyout_price ?? 0) > 0 && (
        <div className="text-xs text-[var(--text-muted)] flex gap-3">
          <span>一口价：<span className="text-[var(--warning)] font-semibold">{auction.buyout_price!.toLocaleString()}</span> 金币</span>
          {(auction.min_bid_step ?? 0) > 0 && <span>最低加价：{auction.min_bid_step} 金币</span>}
        </div>
      )}
      {(auction.buyout_price ?? 0) <= 0 && (auction.min_bid_step ?? 0) > 0 && (
        <div className="text-xs text-[var(--text-muted)]">最低加价：{auction.min_bid_step} 金币</div>
      )}
      <div className="bg-[var(--bg-darkest)] rounded p-2 flex items-center justify-between">
        <div>
          <div className="text-[10px] text-[var(--text-muted)]">{auction.bid_count > 0 ? "当前出价" : "起拍价"}</div>
          <div className="font-bold text-[var(--warning)] text-lg leading-none">
            {auction.current_bid.toLocaleString()}
            <span className="text-xs font-normal text-[var(--text-muted)] ml-1">金币</span>
          </div>
          {auction.bidder_name && (
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{auction.bid_count} 次出价 · 最高: {auction.bidder_name}</div>
          )}
        </div>
        <div className="text-[10px] text-[var(--text-muted)] text-right">
          <div>卖家: <span className={cn(staffNameClass(auction.seller_id))}>{auction.seller_name}</span></div>
          <StaffBadge userId={auction.seller_id} size={10} />
        </div>
      </div>

      {auction.note && <p className="text-xs text-[var(--text-muted)] italic">{auction.note}</p>}

      <div className="flex gap-2 mt-1">
        {isOwner ? (
          <button
            onClick={onCancel}
            disabled={auction.bid_count > 0}
            className="flex-1 bg-[var(--danger)]/20 hover:bg-[var(--danger)]/40 text-[var(--danger)] text-sm font-semibold py-1.5 rounded flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={13} />
            {auction.bid_count > 0 ? "已有出价" : "撤销"}
          </button>
        ) : ended ? (
          <span className="flex-1 text-center text-xs text-[var(--text-muted)] py-1.5">拍卖已结束</span>
        ) : (
          <button
            onClick={onBid}
            className="flex-1 bg-[var(--warning)] hover:opacity-90 text-[#1a1325] text-sm font-semibold py-1.5 rounded flex items-center justify-center gap-1"
          >
            <Gavel size={13} />
            出价
          </button>
        )}
        {isPlatformAdmin && !isOwner && (
          <button
            onClick={onCancel}
            title="主教强制撤拍"
            className="shrink-0 bg-[var(--danger)]/30 hover:bg-[var(--danger)]/50 text-[var(--danger)] text-sm font-semibold px-2.5 py-1.5 rounded"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </article>
  );
}

function CreateAuctionModal({
  serverId,
  onClose,
  onCreate,
}: {
  serverId: string;
  onClose: () => void;
  onCreate: (a: DbAuctionListing) => void;
}) {
  const { user } = useAuth();
  const backdrop = useDismissOnBackdrop(onClose);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  type AucRarity = DbAuctionListing["item_rarity"];
  const AUC_RARITIES: AucRarity[] = ["epic", "legendary", "darklegen"];
  const maxMinFor = (r: AucRarity) => r === "darklegen" ? 600 : 120;
  const [form, setForm] = useState({
    item_name: "",
    item_rarity: "epic" as AucRarity,
    item_class: "武器",
    affixesText: "",
    starting_price: 0,
    buyout_price: 0,
    min_bid_step: 1,
    note: "",
    duration_m: 60,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.item_name.trim()) return setErr("请填写物品名");
    if (form.starting_price < 1) return setErr("起拍价至少 1 金币");
    const maxM = maxMinFor(form.item_rarity);
    if (form.duration_m < 30 || form.duration_m > maxM) return setErr(`时长必须在30–${maxM}分钟之间`);
    setSubmitting(true);
    setErr(null);
    const affixes = form.affixesText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 8);
    const now = Date.now();
    const row = {
      server_id: serverId,
      seller_id: user.id,
      seller_name: user.username,
      item_name: form.item_name.trim(),
      item_rarity: form.item_rarity,
      item_class: form.item_class,
      affixes,
      note: form.note.trim() || null,
      starting_price: form.starting_price,
      current_bid: form.starting_price,
      bidder_id: null,
      bidder_name: null,
      bid_count: 0,
      buyout_price: form.buyout_price > 0 ? form.buyout_price : null,
      min_bid_step: form.min_bid_step > 0 ? form.min_bid_step : null,
      ends_at: now + form.duration_m * 60 * 1000,
      created_at: now,
    };
    const { data, error } = await supabase.from("auction_listings").insert(row as never).select().single();
    setSubmitting(false);
    if (error) { setErr(error.message); return; }
    if (data) onCreate(data as unknown as DbAuctionListing);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" {...backdrop}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--text-bright)] flex items-center gap-2"><Gavel size={18} />发起拍卖</h3>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-white"><X size={20} /></button>
        </div>

        <Field label="物品名">
          <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })}
            placeholder="例：晨曦之刃 +7" className="modal-input" autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="品质">
            <select value={form.item_rarity} onChange={(e) => {
              const r = e.target.value as AucRarity;
              const maxM = maxMinFor(r);
              setForm({ ...form, item_rarity: r, duration_m: Math.min(form.duration_m, maxM) });
            }} className="modal-input">
              {AUC_RARITIES.map((r) => (
                <option key={r} value={r}>{rarityLabel[r]}</option>
              ))}
            </select>
          </Field>
          <Field label="类型">
            <select value={form.item_class} onChange={(e) => setForm({ ...form, item_class: e.target.value })} className="modal-input">
              {ITEM_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="起拍价（金币）">
            <input type="number" min={1} value={form.starting_price}
              onChange={(e) => setForm({ ...form, starting_price: parseInt(e.target.value) || 0 })} className="modal-input" />
          </Field>
          <Field label="一口价（金币，可选）">
            <input type="number" min={0} value={form.buyout_price}
              onChange={(e) => setForm({ ...form, buyout_price: parseInt(e.target.value) || 0 })} className="modal-input" />
          </Field>
          <Field label="最低加价（金币）">
            <input type="number" min={1} value={form.min_bid_step}
              onChange={(e) => setForm({ ...form, min_bid_step: parseInt(e.target.value) || 1 })} className="modal-input" />
          </Field>
        </div>
        <Field label={`时长（分钟，30–${maxMinFor(form.item_rarity)}）`}>
          <input
            type="number" min={30} max={maxMinFor(form.item_rarity)}
            value={form.duration_m}
            onChange={(e) => {
              const v = Math.max(30, Math.min(parseInt(e.target.value) || 30, maxMinFor(form.item_rarity)));
              setForm({ ...form, duration_m: v });
            }}
            className="modal-input"
          />
        </Field>

        <Field label="词条（每行一条，最多 8 条）">
          <textarea value={form.affixesText} onChange={(e) => setForm({ ...form, affixesText: e.target.value })}
            placeholder={"+45 力量\n暴击率 +12%"} rows={3} className="modal-input resize-none font-mono text-xs" />
        </Field>

        <Field label="备注（选填）">
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="物品说明、交易条件等" className="modal-input" />
        </Field>

        {err && <div className="text-sm text-[var(--danger)]">{err}</div>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold">取消</button>
          <button type="submit" disabled={submitting}
            className="flex-1 h-10 rounded-md bg-gradient-to-b from-[var(--warning)] to-amber-600 text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {submitting && <Loader2 size={16} className="animate-spin" />}
            发起拍卖
          </button>
        </div>
        <style jsx>{`
          .modal-input { width:100%; height:38px; padding:0 10px; border-radius:6px; background:var(--bg-darkest); color:white; border:1px solid var(--bg-mid); font-size:14px; }
          textarea.modal-input { height:auto; padding:8px 10px; }
          .modal-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 10px var(--accent-glow); }
        `}</style>
      </form>
    </div>
  );
}

function BidModal({
  auction,
  onClose,
  onBidPlaced,
}: {
  auction: DbAuctionListing;
  onClose: () => void;
  onBidPlaced: (updated: DbAuctionListing) => void;
}) {
  const { user } = useAuth();
  const backdrop = useDismissOnBackdrop(onClose);
  const { balance, fetch: fetchBal, deductGold } = useBalance();
  useEffect(() => { if (user) fetchBal(user.id); }, [user?.id]);
  const minBid = auction.current_bid + (auction.min_bid_step ?? 1);
  const [amount, setAmount] = useState(minBid);
  const [submitting, setSubmitting] = useState(false);
  const [buyingOut, setBuyingOut] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const buyout = auction.buyout_price ?? 0;
  const gold = balance?.gold ?? 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (user.id === auction.seller_id) { setErr("不能对自己的拍卖出价"); return; }
    if (amount < minBid) { setErr(`出价不能低于 ${minBid.toLocaleString()} 金币`); return; }
    if (gold < amount) { setErr(`游戏币不足（当前 ${gold.toLocaleString()}）`); return; }
    setSubmitting(true);
    setErr(null);
    const { data, error } = await supabase
      .from("auction_listings")
      .update({
        current_bid: amount,
        bidder_id: user.id,
        bidder_name: user.username,
        bid_count: (auction.bid_count || 0) + 1,
      })
      .eq("id", auction.id)
      .select()
      .single();
    setSubmitting(false);
    if (error) { setErr("出价失败：" + error.message); return; }
    onBidPlaced(data as unknown as DbAuctionListing);
  };

  const handleBuyout = async () => {
    if (!user) return;
    if (user.id === auction.seller_id) { setErr("不能购买自己的物品"); return; }
    if (gold < buyout) { setErr(`游戏币不足，需要 ${buyout.toLocaleString()}，当前 ${gold.toLocaleString()}`); return; }
    if (!(await confirm(`以 ${buyout.toLocaleString()} 金币一口价购买「${auction.item_name}」？`))) return;
    setBuyingOut(true);
    setErr(null);
    // 1. Deduct buyer gold
    const deducted = await deductGold(user.id, buyout);
    if (!deducted) { setErr("游戏币扮除失败，请重试"); setBuyingOut(false); return; }
    // 2. Credit seller gold
    await creditGoldRaw(auction.seller_id, buyout);
    // 3. Mark auction as ended with buyer as winner
    const { data, error } = await supabase
      .from("auction_listings")
      .update({
        current_bid: buyout,
        bidder_id: user.id,
        bidder_name: user.username,
        bid_count: (auction.bid_count || 0) + 1,
        ends_at: Date.now() - 1,
      })
      .eq("id", auction.id)
      .select()
      .single();
    setBuyingOut(false);
    if (error) { setErr("更新失败：" + error.message); return; }
    setDone(true);
    setTimeout(() => { onBidPlaced(data as unknown as DbAuctionListing); }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" {...backdrop}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6"
      >
        {done ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Check size={44} className="text-[var(--success)]" />
            <p className="text-white font-semibold text-lg">购买成功！</p>
            <p className="text-sm text-[var(--text-muted)] text-center">
              <span style={{ color: rarityColor[auction.item_rarity] }}>{auction.item_name}</span>
              {" "}已入账，扣除 {buyout.toLocaleString()} 金币
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[var(--text-bright)] flex items-center gap-2"><Gavel size={16} />出价</h3>
              <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-white"><X size={18} /></button>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: rarityColor[auction.item_rarity] }} className="font-medium">{auction.item_name}</span>
              <span className="text-[var(--text-muted)]">当前: {auction.current_bid.toLocaleString()} 金</span>
            </div>
            <div className="text-xs text-[var(--text-muted)] flex items-center justify-between bg-[var(--bg-darkest)] rounded px-3 py-1.5">
              <span>我的游戏币</span>
              <span className={cn("font-semibold", gold > 0 ? "text-[var(--warning)]" : "text-[var(--danger)]")}>
                {gold.toLocaleString()}
              </span>
            </div>

            {buyout > 0 && (
              <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/5 p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-[var(--warning)] font-semibold uppercase tracking-wider">一口价</p>
                  <p className="text-lg font-bold text-white">{buyout.toLocaleString()} <span className="text-xs font-normal text-[var(--text-muted)]">金币</span></p>
                </div>
                <button
                  type="button"
                  onClick={handleBuyout}
                  disabled={buyingOut || submitting}
                  className="px-4 h-9 rounded-md bg-[var(--warning)] hover:opacity-90 text-[#1a1325] text-sm font-bold flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                >
                  {buyingOut ? <Loader2 size={14} className="animate-spin" /> : null}
                  立即购买
                </button>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]/80 mb-1">
                出价金额（最低 {minBid.toLocaleString()}）
              </label>
              <input
                type="number"
                min={minBid}
                value={amount}
                onChange={(e) => setAmount(parseInt(e.target.value) || minBid)}
                className="w-full h-10 px-3 rounded-md bg-[var(--bg-darkest)] text-white border border-[var(--bg-mid)] focus:outline-none focus:border-[var(--accent)] text-sm"
                autoFocus
              />
            </div>
            {err && <div className="text-sm text-[var(--danger)]">{err}</div>}
            <div className="flex gap-3">
              <button type="button" onClick={onClose}
                className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold">取消</button>
              <button type="submit" disabled={submitting || buyingOut}
                className="flex-1 h-10 rounded-md bg-[var(--warning)] hover:opacity-90 text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {submitting && <Loader2 size={16} className="animate-spin" />}
                确认出价
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]/80 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
