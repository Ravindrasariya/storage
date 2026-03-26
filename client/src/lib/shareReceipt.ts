import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function shareReceiptAsPdf(
  element: HTMLElement,
  filename: string,
  css?: string
): Promise<void> {
  // Build a render container that mirrors the print environment
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "794px"; // ~A4 at 96dpi
  container.style.backgroundColor = "#ffffff";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.fontSize = "14px";
  container.style.lineHeight = "1.4";
  container.style.padding = "20px";
  container.style.boxSizing = "border-box";

  if (css) {
    const styleTag = document.createElement("style");
    // Strip @page rules — they only apply to print, not screen rendering
    styleTag.textContent = css.replace(/@page\s*\{[^}]*\}/g, "");
    container.appendChild(styleTag);
  }

  const clone = element.cloneNode(true) as HTMLElement;
  container.appendChild(clone);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    const pdfPageWidth = pdf.internal.pageSize.getWidth();
    const pdfPageHeight = pdf.internal.pageSize.getHeight();

    const imgWidthPx = canvas.width;
    const imgHeightPx = canvas.height;
    const aspectRatio = imgHeightPx / imgWidthPx;

    const imgPdfWidth = pdfPageWidth;
    const imgPdfHeight = imgPdfWidth * aspectRatio;

    let remainingHeight = imgPdfHeight;
    let srcY = 0;

    while (remainingHeight > 0) {
      const pageHeightInImg = Math.min(pdfPageHeight, remainingHeight);
      const srcYPx = (srcY / imgPdfHeight) * imgHeightPx;
      const pageHeightPx = (pageHeightInImg / imgPdfHeight) * imgHeightPx;

      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = imgWidthPx;
      pageCanvas.height = pageHeightPx;
      const ctx = pageCanvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, srcYPx, imgWidthPx, pageHeightPx, 0, 0, imgWidthPx, pageHeightPx);

      const pageImgData = pageCanvas.toDataURL("image/png");
      if (srcY > 0) pdf.addPage();
      pdf.addImage(pageImgData, "PNG", 0, 0, pdfPageWidth, pageHeightInImg);

      srcY += pageHeightInImg;
      remainingHeight -= pageHeightInImg;
    }

    const blob = pdf.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });

    const canShareFiles =
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] });

    if (canShareFiles) {
      await navigator.share({ files: [file], title: filename });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } finally {
    document.body.removeChild(container);
  }
}
