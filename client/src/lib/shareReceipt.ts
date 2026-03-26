import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function shareReceiptAsPdf(element: HTMLElement, filename: string): Promise<void> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.position = "fixed";
  clone.style.left = "-9999px";
  clone.style.top = "0";
  clone.style.width = "794px";
  clone.style.backgroundColor = "#ffffff";
  clone.style.padding = "20px";
  document.body.appendChild(clone);

  try {
    const canvas = await html2canvas(clone, {
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
    document.body.removeChild(clone);
  }
}
