export type DocType = "FAKTURA" | "DOBROPIS";
export type LifecycleStatus = "KONCEPT" | "VYSTAVENA" | "STORNOVANA";
export type PaymentMethod = "PREVOD" | "HOTOVOST";
export type LineKind = "STANDARD" | "SERVICE_ADVANCE";

/** Údaje dodavatele zmrazené v okamžiku vystavení – přesně to, co je na dokladu. */
export type SupplierSnapshot = {
  name: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  ico: string | null;
  dic: string | null;
  registerText: string | null;
  email: string | null;
  phone: string | null;
  web: string | null;
  bankAccount: string;
  iban: string;
  bic: string | null;
  vatNote: string;
  footerText: string | null;
};

export type CustomerSnapshot = {
  kind: "BUSINESS" | "PERSON";
  name: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  ico: string | null;
  dic: string | null;
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  PREVOD: "převodem",
  HOTOVOST: "v hotovosti",
};

export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
  KONCEPT: "Koncept",
  VYSTAVENA: "Vystavena",
  STORNOVANA: "Stornována",
};

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  FAKTURA: "Faktura",
  DOBROPIS: "Dobropis",
};
