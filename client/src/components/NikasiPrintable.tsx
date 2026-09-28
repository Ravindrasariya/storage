import { format } from "date-fns";
import type { ColdStorage } from "@shared/schema";
import { translations } from "@/lib/i18n";

// Task #401 — the printed Nikasi receipt always renders in Hindi,
// regardless of the app's current language toggle. This local helper
// ignores the caller's `t` prop/current language entirely so the print
// output stays consistent for every operator.
function th(key: string): string {
  const entry = translations[key];
  return entry ? entry.hi : key;
}

export interface NikasiReceiptData {
  sharedExitBillNumber: number;
  exitDate: string | Date;
  farmer: {
    farmerName: string;
    village: string;
    contactNumber: string;
  };
  buyerName?: string | null;
  // Task #393 — Delivery Type selected in the Individual Sale Dialog.
  // Only individual (non-Master-Nikasi) exit receipts populate this.
  deliveryType?: string | null;
  sales: Array<{
    saleId: string;
    lotNo: string;
    marka: string | null;
    bagsExited: number;
    bagType: string;
    variety?: string | null;
    chamberName: string;
    floor: number;
    position: string;
    // Task #401 — Remaining Bags (unsold) + Sold-but-not-yet-exited bags
    // for this sale's lot, as of print time. Undefined when the caller
    // could not resolve it (e.g. lookup failure) so we can show "—".
    balance?: number | null;
  }>;
}

// Task #393 — map the stored delivery type code to its localized label.
// Task #401 — always resolves via the forced-Hindi helper above.
function deliveryTypeLabel(code: string): string {
  switch (code) {
    case "gate": return th("gateCut");
    case "gateWeighing": return th("gateCutWeighing");
    case "bilty": return th("biltyCut");
    case "biltyWeighing": return th("biltyCutWeighing");
    default: return code;
  }
}

export const nikasiPrintStyles = `
  @page { size: A4; margin: 8mm; }
  body { font-family: 'Noto Sans Devanagari', Arial, sans-serif; padding: 0; margin: 0; font-size: 17px; }
  .copies-container { display: flex; flex-direction: column; height: 100vh; }
  .copy { flex: 1; padding: 10px 18px; border-bottom: 2px dashed #000; page-break-inside: avoid; }
  .copy:last-child { border-bottom: none; }
  .copy-label { text-align: right; font-size: 15px; font-weight: bold; color: #666; margin-bottom: 6px; }
  .header { text-align: center; margin-bottom: 8px; }
  .header h1 { font-size: 22px; margin: 0 0 4px; }
  .header h2 { font-size: 18px; margin: 0; font-weight: normal; border: 1px solid #000; padding: 3px 10px; display: inline-block; }
  .header h3 { font-size: 18px; margin: 6px 0 0; }
  .meta { display: flex; justify-content: space-between; font-size: 17px; margin: 6px 0; }
  .party { font-size: 17px; margin-bottom: 6px; }
  table.lots { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; table-layout: fixed; }
  table.lots th, table.lots td { border: 1px solid #000; padding: 3px 4px; text-align: center; word-wrap: break-word; overflow-wrap: break-word; white-space: normal; }
  table.lots th { background: #f3f3f3; }
  table.lots td.lft, table.lots th.lft { text-align: left; }
  table.lots tr.tot td { font-weight: bold; background: #f8f8f8; }
  .delivery-type { margin-top: 8px; font-size: 17px; }
  .signature { margin-top: 14px; text-align: right; font-size: 17px; }
  .signature-line { border-top: 1px solid #000; width: 200px; margin-left: auto; padding-top: 4px; }
  .footer { text-align: center; margin-top: 8px; font-size: 14px; color: #666; }
`;

export function printNikasiReceipt(innerHTML: string, title: string) {
  // Task #401 — copy labels are Hindi-only, matching the forced-Hindi body.
  const htmlContent = `<!DOCTYPE html><html><head><title>${title}</title><style>${nikasiPrintStyles}</style></head><body><div class="copies-container"><div class="copy"><div class="copy-label">कार्यालय प्रति</div>${innerHTML}</div><div class="copy"><div class="copy-label">ग्राहक प्रति</div>${innerHTML}</div></div></body></html>`;
  const printWindow = window.open("", "_blank", "width=595,height=842");
  if (printWindow) {
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:absolute;width:0;height:0;border:none;left:-9999px;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (doc) {
    doc.open(); doc.write(htmlContent); doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 250);
  }
}

interface NikasiPrintableProps {
  data: NikasiReceiptData;
  coldStorage?: ColdStorage | null;
  partyRowLabel: string;
  t: (key: string) => string;
}

// Task #401 — `t` is accepted for prop-compatibility with existing callers
// but intentionally unused: the printed receipt always renders in Hindi via
// the `th` helper above, independent of the app's language toggle.
export function NikasiPrintable({ data, coldStorage, partyRowLabel }: NikasiPrintableProps) {
  const totalBags = data.sales.reduce((s, r) => s + r.bagsExited, 0);
  const address = [
    coldStorage?.address,
    coldStorage?.tehsil,
    coldStorage?.district,
    coldStorage?.state,
    coldStorage?.pincode,
  ].filter(Boolean).join(", ");

  const buyerDisplay = data.buyerName && data.buyerName.trim().length > 0
    ? data.buyerName
    : th("self");

  return (
    <>
      <div className="header">
        <h1>{coldStorage?.name || "Cold Storage"}</h1>
        {address && <div style={{ fontSize: 11 }}>{address}</div>}
        <h2>{th("exitReceipt")}</h2>
        <h3>निकासी बिल नं. {data.sharedExitBillNumber || "-"}</h3>
      </div>
      <div className="meta">
        <span><strong>{th("exitDate")}:</strong> {format(new Date(data.exitDate), "dd/MM/yyyy")}</span>
      </div>
      <div className="party">
        <strong>{partyRowLabel}:</strong> {data.farmer.farmerName} &nbsp;|&nbsp;
        <strong>{th("village")}:</strong> {data.farmer.village} &nbsp;|&nbsp;
        <strong>{th("phone")}:</strong> {data.farmer.contactNumber}
      </div>
      <div className="party" data-testid="text-nikasi-buyer">
        <strong>{th("buyer")}:</strong> {buyerDisplay}
      </div>
      <table className="lots">
        <thead>
          <tr>
            <th>#</th>
            <th className="lft">{th("receiptNo")}</th>
            <th className="lft">{th("marka")}</th>
            <th>{th("bagsExited")}</th>
            <th>बैलेंस</th>
            <th>{th("bagTypeLabel")}</th>
            <th className="lft">{th("variety")}</th>
            <th>{th("chamber")}</th>
            <th>{th("floor")}</th>
            <th>{th("position")}</th>
          </tr>
        </thead>
        <tbody>
          {data.sales.map((s, i) => (
            <tr key={s.saleId}>
              <td>{i + 1}</td>
              <td className="lft">{s.lotNo}</td>
              <td className="lft">{s.marka || "—"}</td>
              <td><strong>{s.bagsExited}</strong></td>
              <td>{s.balance == null ? "—" : s.balance}</td>
              <td>
                {s.bagType?.toLowerCase() === "wafer"
                  ? th("wafer")
                  : s.bagType?.toLowerCase() === "ration"
                  ? th("ration")
                  : th("seed")}
              </td>
              <td className="lft">{s.variety || ""}</td>
              <td>{s.chamberName}</td>
              <td>{s.floor}</td>
              <td>{s.position}</td>
            </tr>
          ))}
          {data.sales.length > 1 && (
            <tr className="tot">
              <td colSpan={3} className="lft">{th("total")}</td>
              <td>{totalBags}</td>
              <td colSpan={6}></td>
            </tr>
          )}
        </tbody>
      </table>
      {data.deliveryType && (
        <div className="delivery-type" data-testid="text-nikasi-delivery-type">
          <strong>{th("deliveryType")}:</strong> {deliveryTypeLabel(data.deliveryType)}
        </div>
      )}
      <div className="signature">
        <div className="signature-line">{th("authorisedSignatory")}</div>
      </div>
    </>
  );
}
