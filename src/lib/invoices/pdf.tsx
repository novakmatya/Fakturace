import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { formatIban } from "@/lib/bank";
import { formatCzDate } from "@/lib/dates";
import {
  type CustomerSnapshot,
  type DocType,
  type PaymentMethod,
  PAYMENT_METHOD_LABEL,
  type SupplierSnapshot,
} from "@/lib/invoices/types";
import { formatCzk, formatQuantity } from "@/lib/money";
import { buildSpayd } from "@/lib/spayd";

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(dir, "Inter-Regular.otf"), fontWeight: 400 },
      { src: path.join(dir, "Inter-Medium.otf"), fontWeight: 500 },
      { src: path.join(dir, "Inter-SemiBold.otf"), fontWeight: 600 },
    ],
  });
  // Dělení slov by v češtině kazilo názvy firem – vypnuto.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

export type InvoicePdfData = {
  type: DocType;
  number: string;
  issueDate: string;
  dueDate: string;
  paymentMethod: PaymentMethod;
  variableSymbol: string | null;
  constantSymbol: string | null;
  specificSymbol: string | null;
  note: string | null;
  totalHalere: number;
  roundingHalere: number;
  amountDueHalere: number;
  correctsNumber: string | null;
  supplier: SupplierSnapshot;
  customer: CustomerSnapshot;
  lines: {
    description: string;
    quantityMilli: number;
    unit: string | null;
    unitPriceHalere: number;
    totalHalere: number;
  }[];
};

const INK = "#1C1C1A";
const MUTED = "#6B6A65";
const RULE = "#E4E2DC";
const PANEL = "#F6F5F1";
const ACCENT = "#1F3A5F";

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, color: INK, paddingTop: 44, paddingBottom: 56, paddingHorizontal: 48, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  docLabel: { fontSize: 8, letterSpacing: 2.2, color: ACCENT, fontWeight: 600, textTransform: "uppercase" },
  docNumber: { fontSize: 22, fontWeight: 600, marginTop: 3, letterSpacing: 0.3 },
  docSub: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  supplierName: { fontSize: 11, fontWeight: 600, textAlign: "right" },
  contact: { fontSize: 8, color: MUTED, textAlign: "right", marginTop: 2 },
  rule: { borderBottomWidth: 0.6, borderBottomColor: RULE, marginTop: 18, marginBottom: 18 },
  parties: { flexDirection: "row", gap: 32 },
  party: { flex: 1 },
  label: { fontSize: 7, letterSpacing: 1.3, color: MUTED, textTransform: "uppercase", marginBottom: 5, fontWeight: 500 },
  partyName: { fontSize: 10.5, fontWeight: 600, marginBottom: 2 },
  small: { fontSize: 7.5, color: MUTED, marginTop: 4 },
  meta: { flexDirection: "row", backgroundColor: PANEL, borderRadius: 4, paddingVertical: 10, paddingHorizontal: 14, marginTop: 22 },
  metaCell: { flex: 1 },
  metaValue: { fontSize: 9.5, fontWeight: 500 },
  metaValueStrong: { fontSize: 9.5, fontWeight: 600, color: ACCENT },
  table: { marginTop: 24 },
  th: { flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: INK, paddingBottom: 5 },
  thText: { fontSize: 7, letterSpacing: 1.1, color: MUTED, textTransform: "uppercase", fontWeight: 500 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 7 },
  cDesc: { flex: 5, paddingRight: 10 },
  cQty: { flex: 1.5, textAlign: "right" },
  cPrice: { flex: 1.7, textAlign: "right" },
  cTotal: { flex: 1.8, textAlign: "right" },
  note: { marginTop: 14, fontSize: 8.5, color: MUTED },
  totals: { marginTop: 16, alignSelf: "flex-end", width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderTopWidth: 0.8, borderTopColor: INK, marginTop: 4, paddingTop: 8 },
  grandLabel: { fontSize: 9, fontWeight: 600 },
  grandValue: { fontSize: 15, fontWeight: 600, color: ACCENT },
  vatNote: { marginTop: 8, fontSize: 8.5, textAlign: "right", fontWeight: 500 },
  pay: { flexDirection: "row", marginTop: 28, padding: 14, backgroundColor: PANEL, borderRadius: 4, gap: 18, alignItems: "center" },
  qrBox: { alignItems: "center", width: 96 },
  qr: { width: 92, height: 92 },
  qrLabel: { fontSize: 7, color: MUTED, marginTop: 4, letterSpacing: 0.6 },
  payGrid: { flex: 1, flexDirection: "row", flexWrap: "wrap" },
  payCell: { width: "50%", marginBottom: 8 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

function addressLines(p: { street: string; zip: string; city: string; country: string }) {
  return [p.street, `${p.zip} ${p.city}`, p.country !== "CZ" ? p.country : null].filter(Boolean) as string[];
}

function MetaCell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.label}>{label}</Text>
      <Text style={strong ? s.metaValueStrong : s.metaValue}>{value}</Text>
    </View>
  );
}

function PayCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.payCell}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

export function InvoicePdfDocument({ data, qrDataUrl }: { data: InvoicePdfData; qrDataUrl: string | null }) {
  const isCredit = data.type === "DOBROPIS";
  const title = isCredit ? "Dobropis" : "Faktura";
  const sup = data.supplier;
  const cus = data.customer;
  const contact = [sup.email, sup.phone, sup.web].filter(Boolean).join("  ·  ");

  return (
    <Document title={`${title} ${data.number}`} author={sup.name} creator="Fakturace" producer="Fakturace" language="cs">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.docLabel}>{title}</Text>
            <Text style={s.docNumber}>{data.number}</Text>
            {isCredit && data.correctsNumber ? <Text style={s.docSub}>k faktuře č. {data.correctsNumber}</Text> : null}
          </View>
          <View style={{ maxWidth: 260 }}>
            <Text style={s.supplierName}>{sup.name}</Text>
            {contact ? <Text style={s.contact}>{contact}</Text> : null}
          </View>
        </View>

        <View style={s.rule} />

        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.label}>Dodavatel</Text>
            <Text style={s.partyName}>{sup.name}</Text>
            {addressLines(sup).map((line) => (
              <Text key={line}>{line}</Text>
            ))}
            {sup.ico ? <Text style={{ marginTop: 4 }}>IČO: {sup.ico}</Text> : null}
            {sup.dic ? <Text>DIČ: {sup.dic}</Text> : null}
            {sup.registerText ? <Text style={s.small}>{sup.registerText}</Text> : null}
          </View>
          <View style={s.party}>
            <Text style={s.label}>Odběratel</Text>
            <Text style={s.partyName}>{cus.name}</Text>
            {addressLines(cus).map((line) => (
              <Text key={line}>{line}</Text>
            ))}
            {cus.ico ? <Text style={{ marginTop: 4 }}>IČO: {cus.ico}</Text> : null}
            {cus.dic ? <Text>DIČ: {cus.dic}</Text> : null}
          </View>
        </View>

        <View style={s.meta}>
          <MetaCell label="Datum vystavení" value={formatCzDate(data.issueDate)} />
          <MetaCell label="Datum splatnosti" value={formatCzDate(data.dueDate)} strong />
          <MetaCell label="Způsob úhrady" value={PAYMENT_METHOD_LABEL[data.paymentMethod]} />
          <MetaCell label="Variabilní symbol" value={data.variableSymbol ?? "—"} />
        </View>

        <View style={s.table}>
          <View style={s.th}>
            <Text style={[s.thText, s.cDesc]}>Popis</Text>
            <Text style={[s.thText, s.cQty]}>Množství</Text>
            <Text style={[s.thText, s.cPrice]}>Jedn. cena</Text>
            <Text style={[s.thText, s.cTotal]}>Celkem</Text>
          </View>
          {data.lines.map((line, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={s.cDesc}>{line.description}</Text>
              <Text style={s.cQty}>
                {formatQuantity(line.quantityMilli)}
                {line.unit ? ` ${line.unit}` : ""}
              </Text>
              <Text style={s.cPrice}>{formatCzk(line.unitPriceHalere)}</Text>
              <Text style={s.cTotal}>{formatCzk(line.totalHalere)}</Text>
            </View>
          ))}
        </View>

        {data.note ? <Text style={s.note}>{data.note}</Text> : null}

        <View style={s.totals} wrap={false}>
          {data.roundingHalere !== 0 ? (
            <>
              <View style={s.totalRow}>
                <Text style={{ color: MUTED }}>Součet položek</Text>
                <Text>{formatCzk(data.totalHalere)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text style={{ color: MUTED }}>Zaokrouhlení</Text>
                <Text>{formatCzk(data.roundingHalere)}</Text>
              </View>
            </>
          ) : null}
          <View style={s.grandRow}>
            <Text style={s.grandLabel}>{isCredit ? "Celkem k vrácení" : "Celkem k úhradě"}</Text>
            <Text style={s.grandValue}>{formatCzk(isCredit ? -data.amountDueHalere : data.amountDueHalere)}</Text>
          </View>
          <Text style={s.vatNote}>{sup.vatNote}</Text>
        </View>

        {!isCredit && data.paymentMethod === "PREVOD" ? (
          <View style={s.pay} wrap={false}>
            {qrDataUrl ? (
              <View style={s.qrBox}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image nemá alt */}
                <Image style={s.qr} src={qrDataUrl} />
                <Text style={s.qrLabel}>QR Platba</Text>
              </View>
            ) : null}
            <View style={s.payGrid}>
              <PayCell label="Číslo účtu" value={sup.bankAccount} />
              <PayCell label="Variabilní symbol" value={data.variableSymbol ?? "—"} />
              <PayCell label="IBAN" value={formatIban(sup.iban)} />
              <PayCell label="Částka" value={formatCzk(data.amountDueHalere)} />
              {sup.bic ? <PayCell label="BIC" value={sup.bic} /> : null}
              <PayCell label="Splatnost" value={formatCzDate(data.dueDate)} />
              {data.constantSymbol ? <PayCell label="Konstantní symbol" value={data.constantSymbol} /> : null}
              {data.specificSymbol ? <PayCell label="Specifický symbol" value={data.specificSymbol} /> : null}
            </View>
          </View>
        ) : null}

        {sup.footerText ? <Text style={[s.note, { marginTop: 22 }]}>{sup.footerText}</Text> : null}

        <View style={s.footer} fixed>
          <Text>
            {title} {data.number} · {sup.name}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Strana ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Řetězec QR platby pro fakturu (u dobropisu a hotovosti se QR netiskne). */
export function invoiceSpayd(data: InvoicePdfData): string | null {
  if (data.type !== "FAKTURA" || data.paymentMethod !== "PREVOD" || data.amountDueHalere <= 0) return null;
  return buildSpayd({
    iban: data.supplier.iban,
    bic: data.supplier.bic,
    amountHalere: data.amountDueHalere,
    currency: "CZK",
    dueDate: data.dueDate,
    variableSymbol: data.variableSymbol,
    constantSymbol: data.constantSymbol,
    specificSymbol: data.specificSymbol,
    message: `Faktura ${data.number}`,
    recipientName: data.supplier.name,
  });
}

export async function qrPngForSpayd(spayd: string): Promise<Buffer> {
  return QRCode.toBuffer(spayd, { errorCorrectionLevel: "M", margin: 0, width: 420, type: "png" });
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<{ pdf: Buffer; spayd: string | null }> {
  registerFonts();
  const spayd = invoiceSpayd(data);
  const qrDataUrl = spayd ? `data:image/png;base64,${(await qrPngForSpayd(spayd)).toString("base64")}` : null;
  const pdf = await renderToBuffer(<InvoicePdfDocument data={data} qrDataUrl={qrDataUrl} />);
  return { pdf: Buffer.from(pdf), spayd };
}
