import { format } from "date-fns";
import type { ColdStorage } from "@shared/schema";

export interface NikasiReceiptData {
  sharedExitBillNumber: number;
  exitDate: string | Date;
  farmer: {
    farmerName: string;
    village: string;
    contactNumber: string;
  };
  sales: Array<{
    saleId: string;
    lotNo: string;
    marka: string | null;
    bagsExited: number;
    bagType: string;
    chamberName: string;
    floor: number;
    position: string;
  }>;
}

export const nikasiPrintStyles = `
  @page { size: A4; margin: 8mm; }
  body { font-family: 'Noto Sans Devanagari', Arial, sans-serif; padding: 0; margin: 0; font-size: 13px; }
  .copies-container { display: flex; flex-direction: column; height: 100vh; }
  .copy { flex: 1; padding: 10px 18px; border-bottom: 2px dashed #000; page-break-inside: avoid; }
  .copy:last-child { border-bottom: none; }
  .copy-label { text-align: right; font-size: 11px; font-weight: bold; color: #666; margin-bottom: 6px; }
  .header { text-align: center; margin-bottom: 8px; }
  .header h1 { font-size: 18px; margin: 0 0 4px; }
  .header h2 { font-size: 14px; margin: 0; font-weight: normal; border: 1px solid #000; padding: 3px 10px; display: inline-block; }
  .header h3 { font-size: 14px; margin: 6px 0 0; }
  .meta { display: flex; justify-content: space-between; font-size: 12px; margin: 6px 0; }
  .party { font-size: 13px; margin-bottom: 6px; }
  table.lots { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
  table.lots th, table.lots td { border: 1px solid #000; padding: 3px 4px; text-align: center; }
  table.lots th { background: #f3f3f3; }
  table.lots td.lft, table.lots th.lft { text-align: left; }
  table.lots tr.tot td { font-weight: bold; background: #f8f8f8; }
  .signature { margin-top: 14px; text-align: right; font-size: 12px; }
  .signature-line { border-top: 1px solid #000; width: 200px; margin-left: auto; padding-top: 4px; }
  .footer { text-align: center; margin-top: 8px; font-size: 10px; color: #666; }
`;

export function printNikasiReceipt(innerHTML: string, title: string) {
  const htmlContent = `<!DOCTYPE html><html><head><title>${title}</title><style>${nikasiPrintStyles}</style></head><body><div class="copies-container"><div class="copy"><div class="copy-label">OFFICE COPY / कार्यालय प्रति</div>${innerHTML}</div><div class="copy"><div class="copy-label">CUSTOMER COPY / ग्राहक प्रति</div>${innerHTML}</div></div></body></html>`;
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

export function NikasiPrintable({ data, coldStorage, partyRowLabel, t }: NikasiPrintableProps) {
  const totalBags = data.sales.reduce((s, r) => s + r.bagsExited, 0);
  const address = [
    coldStorage?.address,
    coldStorage?.tehsil,
    coldStorage?.district,
    coldStorage?.state,
    coldStorage?.pincode,
  ].filter(Boolean).join(", ");

  return (
    <>
      <div className="header">
        <h1>{coldStorage?.name || "Cold Storage"}</h1>
        {address && <div style={{ fontSize: 11 }}>{address}</div>}
        <h2>{t("masterNikasi")} / Master Nikasi</h2>
        <h3>{t("exitBillNumber")} #{data.sharedExitBillNumber}</h3>
      </div>
      <div className="meta">
        <span><strong>{t("exitDate")}:</strong> {format(new Date(data.exitDate), "dd/MM/yyyy")}</span>
        <span><strong>{t("printedOn") || "Printed"}:</strong> {format(new Date(), "dd/MM/yyyy HH:mm")}</span>
      </div>
      <div className="party">
        <strong>{partyRowLabel}:</strong> {data.farmer.farmerName} &nbsp;|&nbsp;
        <strong>{t("village")}:</strong> {data.farmer.village} &nbsp;|&nbsp;
        <strong>{t("phone") || "Phone"}:</strong> {data.farmer.contactNumber}
      </div>
      <table className="lots">
        <thead>
          <tr>
            <th>#</th>
            <th className="lft">{t("receiptNo")}</th>
            <th className="lft">{t("marka") || "Marka"}</th>
            <th>{t("soldBags")}</th>
            <th>{t("bagsExited")}</th>
            <th>{t("bagTypeLabel")}</th>
            <th>{t("chamber")}</th>
            <th>{t("floor")}</th>
            <th>{t("position")}</th>
          </tr>
        </thead>
        <tbody>
          {data.sales.map((s, i) => (
            <tr key={s.saleId}>
              <td>{i + 1}</td>
              <td className="lft">{s.lotNo}</td>
              <td className="lft">{s.marka || "—"}</td>
              <td>{s.bagsExited}</td>
              <td><strong>{s.bagsExited}</strong></td>
              <td>{s.bagType === "wafer" ? "Wafer" : "Seed"}</td>
              <td>{s.chamberName}</td>
              <td>{s.floor}</td>
              <td>{s.position}</td>
            </tr>
          ))}
          <tr className="tot">
            <td colSpan={3} className="lft">{t("total") || "Total"}</td>
            <td>{totalBags}</td>
            <td>{totalBags}</td>
            <td colSpan={4}></td>
          </tr>
        </tbody>
      </table>
      <div className="signature">
        <div className="signature-line">{t("authorisedSignatory") || "Authorised Signatory"}</div>
      </div>
      <div className="footer">{t("paymentStatus") || "Payment"}: {t("due")} (Self-Sale)</div>
    </>
  );
}
