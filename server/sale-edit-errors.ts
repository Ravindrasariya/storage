export class SaleBuyerAdjustmentError extends Error {
  constructor() {
    super("Cannot change the buyer to Self while Adj Receivable & Self Due is greater than zero.");
    this.name = "SaleBuyerAdjustmentError";
  }
}
