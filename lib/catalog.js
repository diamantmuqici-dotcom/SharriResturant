/* ============================================================
   SHARRI — Katalogu bazë (produkte, kategori, cilësime)
   Ky skedar përdoret nga faqja, nga ekrani i kamarierit dhe
   nga serveri. Asnjë tekst anglez në ndërfaqe.
   ============================================================ */

export const DB_KEY = "sharri_pos_v1";
export const CART_KEY = "sharri_cart_v1";
export const SESSION_KEY = "sharri_session_v1";
export const WAITER_KEY = "sharri_waiter_v1";
export const LOGIN_LIMIT_KEY = "sharri_login_limit_v1";

/* Numri fizik i tavolinave — gjithmonë 50 (mund të ndryshohet nga administratori) */
export const TABLE_COUNT = 50;

export function defaultCategories() {
  return [
    { id: "skara", name: "Skara" },
    { id: "pula", name: "Pula" },
    { id: "sandwich", name: "Sandwich" },
    { id: "pizza", name: "Pizza" },
    { id: "gjelle", name: "Gjellë" },
    { id: "torte", name: "Torte" },
    { id: "kafe", name: "Kafe & Çaj" },
    { id: "pije", name: "Pije" }
  ];
}

export function defaultProducts() {
  const now = Date.now();
  const product = (id, name, category, price, desc, emoji, extra = {}) => ({
    id,
    name,
    category,
    price,
    desc,
    emoji,
    image: "",
    available: true,
    hidden: false,
    unit: extra.unit || null,
    /* "ushqim" ose "pije" — vendos nëse "Me veti" / "Për këtu" lejohen */
    kind: extra.kind || null,
    keywords: extra.keywords || "",
    popular: Boolean(extra.popular),
    daily: Boolean(extra.daily),
    family: Boolean(extra.family),
    special: Boolean(extra.special),
    created: now
  });

  return [
    product("kombinim-skare", "Kombinim Skare", "skara", 4, "Përzierje e mishit të zgjedhur në skarë.", "🔥", { popular: true }),
    product("mish-viqi-natyral", "Mish Viqi Natyral", "skara", 5, "Mish viqi i freskët i pjekur në skarë.", "🥩"),
    product("mish-viqi-1kg", "Mish Viqi (1kg)", "skara", 25, "Mish viqi i zgjedhur me cilësi të lartë.", "🥩"),
    product("pleskavice-sharri", "Pleskavicë Sharri", "skara", 4, "Specialiteti ynë i veçantë me erëza tradicionale.", "🍖", { special: true, popular: true }),
    product("qebapa", "Qebapa", "skara", 0.5, "Qebapa tradicionale për copë.", "🍢", { popular: true, unit: "piece" }),
    product("file-pule", "File Pule", "pula", 3, "File pule i butë dhe i shijshëm në skarë.", "🍗", { keywords: "fileto pule" }),
    product("gjys-pule", "Gjysmë Pule", "pula", 3.5, "Gjysmë pule e pjekur në skarë.", "🍗", { keywords: "gjys pule gjysem" }),
    product("pule-komplete", "Pulë Kompletë", "pula", 6, "Pulë e tërë e pjekur në mënyrë perfekte.", "🍗", { family: true }),
    product("hamburger-pomfrit", "Hamburger + Pomfrit", "sandwich", 2.5, "Hamburger i shijshëm shoqëruar me patate.", "🍔", { popular: true }),
    product("sandwich-tuna", "Sandwich Tuna", "sandwich", 2, "Sandwich i freskët me tunë dhe sallatë.", "🥪"),
    product("pice-familjare", "Picë Familjare", "pizza", 7, "Picë e madhe me përbërës të freskët.", "🍕", { family: true }),
    product("pice-mesme", "Picë e Mesme", "pizza", 3, "Ideale për 1-2 persona.", "🍕"),
    product("gullash", "Gullash Tradicional", "gjelle", 2.5, "Gatuar sipas recetës së vjetër shtëpiake.", "🍲", { daily: true }),
    product("pasul", "Pasul", "gjelle", 2.5, "Pasul i gatuar me kujdes dhe dashuri.", "🍲", { daily: true }),
    product("cheese-cake", "Cheese Cake", "torte", 1.5, "Krem djathi i freskët me fruta pylli.", "🍰"),
    product("trileqe", "Torte Trileqe", "torte", 1.5, "Ëmbëlsira tradicionale me tre lloje qumështi.", "🍰", { popular: true }),
    product("torte-dubai", "Torte Dubai", "torte", 1.5, "Shije ekzotike dhe aromatike.", "🍫"),
    product("torte-snikers", "Torte Snikers", "torte", 1.5, "Torte me çokollatë dhe karamel.", "🍫", { keywords: "snikers" }),
    product("kafe", "Kafe", "kafe", 0.7, "Kafe turke e freskët.", "☕", { popular: true, keywords: "kafe kafeja" }),
    product("kafe-espresso", "Kafe Ekspres", "kafe", 1, "Ekspres i fortë.", "☕", { keywords: "espresso ekspres" }),
    product("caj", "Çaj", "kafe", 0.5, "Çaj i ngrohtë mali.", "🍵", { keywords: "caj çaj" }),
    product("coca-cola", "Kokakolla", "pije", 1, "Pije freskuese 0.33l.", "🥤", { popular: true, keywords: "coca cola kokakolla" }),
    product("fanta", "Fanta", "pije", 1, "Pije freskuese 0.33l.", "🥤"),
    product("sprite", "Sprite", "pije", 1, "Pije freskuese 0.33l.", "🥤"),
    product("schweppes", "Schweppes", "pije", 1, "Ujë i gazuar me tonik.", "🥤"),
    product("red-bull", "Red Bull", "pije", 1.5, "Pije energjetike.", "⚡"),
    product("golden-eagle", "Golden Eagle", "pije", 1, "Pije energjetike.", "⚡"),
    product("birra", "Birrë", "pije", 1.5, "Birrë e ftohtë vendase.", "🍺", { keywords: "birre birra" }),
    product("uje", "Ujë", "pije", 0.5, "Ujë i ftohtë 0.5l.", "💧", { keywords: "uje" }),
    product("fructal", "Lëng Fructal", "pije", 1, "Lëng frutash natyral.", "🧃"),
    product("multisola", "Multisola", "pije", 1, "Pije freskuese.", "🧃"),
    product("relax", "Relax", "pije", 1, "Pije freskuese.", "🧃"),
    product("laqin", "Laqin", "pije", 0.5, "Pije freskuese.", "🧃"),
    product("ice-tea", "Ice Tea", "pije", 1, "Çaj i ftohtë freskues.", "🧊")
  ];
}

export function defaultSettings() {
  return {
    restaurantName: "SHARRI",
    tagline: "TRADITA TAKON MODERNEN NË ÇDO SHIJE",
    phone: "048 589 002",
    address: "Komoran-Glogovc, Rruga Nazmi Gashi",
    hours: "E Hënë - E Diel • 08:00 - 23:00",
    currency: "€",
    taxRate: 18,
    taxIncluded: true,
    tableCount: TABLE_COUNT,
    waiters: ["Kamarieri 1", "Kamarieri 2", "Kamarieri 3"]
  };
}

export function defaultDB() {
  return {
    settings: defaultSettings(),
    categories: defaultCategories(),
    products: defaultProducts(),
    orders: [],
    cashReports: [],
    users: [],
    logs: [],
    counters: { orders: 0, cashReports: 0 }
  };
}
